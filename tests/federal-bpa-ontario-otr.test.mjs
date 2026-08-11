import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTaxData } from "../calculators/canada-income-tax/js/tax.data.js";
import { computePersonalTax } from "../calculators/canada-income-tax/js/tax.engine.js";
import {
  calculateBCTaxReduction,
  calculateLowIncomeTaxReduction,
  calculateOntarioTaxReduction,
  resolveEnhancedBasicPersonalAmount
} from "../calculators/canada-income-tax/js/tax.bpa.js";

const FS_DATA_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../calculators/canada-income-tax/data"
);

async function data(year) {
  return loadTaxData(year, { fsDataRoot: FS_DATA_ROOT });
}

function tax(input, override) {
  return computePersonalTax(input, { dataOverride: override, roundToDollar: false });
}

test("2026 BPA formula: below / inside / above phase-out", async () => {
  const d = await data(2026);
  const bpa = d.federal.credits.basicPersonalAmount;
  assert.equal(bpa.maximum, 16452);
  assert.equal(bpa.minimum, 14829);
  assert.equal(bpa.phaseOutStart, 181440);
  assert.equal(bpa.phaseOutEnd, 258482);

  assert.equal(resolveEnhancedBasicPersonalAmount(bpa, 181440).amount, 16452);
  assert.equal(resolveEnhancedBasicPersonalAmount(bpa, 181439).amount, 16452);
  assert.equal(resolveEnhancedBasicPersonalAmount(bpa, 258482).amount, 14829);
  assert.equal(resolveEnhancedBasicPersonalAmount(bpa, 300000).amount, 14829);

  const mid = resolveEnhancedBasicPersonalAmount(bpa, (181440 + 258482) / 2);
  assert.ok(Math.abs(mid.amount - (16452 + 14829) / 2) < 0.02);
  assert.equal(mid.phased, true);
});

test("2025 BPA matches CRA indexation table", async () => {
  const d = await data(2025);
  const bpa = d.federal.credits.basicPersonalAmount;
  assert.equal(bpa.maximum, 16129);
  assert.equal(bpa.minimum, 14538);
  assert.equal(bpa.phaseOutStart, 177882);
  assert.equal(bpa.phaseOutEnd, 253414);
});

test("RRSP deduction can increase BPA by moving into/through phase-out", async () => {
  const d = await data(2026);
  // otherIncome path avoids CPP/CEA noise; net income ≈ taxable income.
  const high = tax(
    { year: 2026, province: "ON", otherIncome: 260000, rrspDeduction: 0 },
    d
  );
  const withDeduction = tax(
    { year: 2026, province: "ON", otherIncome: 260000, rrspDeduction: 90000 },
    d
  );
  const bpaHigh = high.breakdown.federal.creditBases.find((c) => c.name === "Basic Personal Amount");
  const bpaLow = withDeduction.breakdown.federal.creditBases.find((c) => c.name === "Basic Personal Amount");
  assert.ok(bpaHigh.base <= 14829 + 1);
  assert.ok(bpaLow.base > bpaHigh.base + 100);
  // Incremental tax saving exceeds a fixed-min-BPA approximation.
  const saving = high.totals.totalIncomeTax - withDeduction.totals.totalIncomeTax;
  assert.ok(saving > 0);
});

test("RRSP deduction crossing lower BPA phase-out boundary", async () => {
  const d = await data(2026);
  const income = 190000;
  const before = tax({ year: 2026, province: "AB", otherIncome: income, rrspDeduction: 0 }, d);
  const after = tax({ year: 2026, province: "AB", otherIncome: income, rrspDeduction: 20000 }, d);
  const bpa0 = before.breakdown.federal.creditBases.find((c) => c.name === "Basic Personal Amount");
  const bpa1 = after.breakdown.federal.creditBases.find((c) => c.name === "Basic Personal Amount");
  assert.ok(bpa0.phased || bpa0.base < 16452);
  assert.ok(bpa1.base > bpa0.base);
  assert.ok(before.totals.federalTax > after.totals.federalTax);
});

test("Ontario Tax Reduction formula corners", () => {
  assert.equal(calculateOntarioTaxReduction(0, { basicPersonalAmount: 300 }).reduction, 0);
  assert.equal(calculateOntarioTaxReduction(200, { basicPersonalAmount: 300 }).reduction, 200);
  assert.equal(calculateOntarioTaxReduction(300, { basicPersonalAmount: 300 }).reduction, 300);
  assert.equal(calculateOntarioTaxReduction(400, { basicPersonalAmount: 300 }).reduction, 200);
  assert.equal(calculateOntarioTaxReduction(600, { basicPersonalAmount: 300 }).reduction, 0);
  assert.equal(calculateOntarioTaxReduction(700, { basicPersonalAmount: 300 }).reduction, 0);
});

test("Ontario Tax Reduction applies at low income and not at high income", async () => {
  const d = await data(2026);
  const low = tax({ year: 2026, province: "ON", otherIncome: 20000, rrspDeduction: 0 }, d);
  const high = tax({ year: 2026, province: "ON", otherIncome: 120000, rrspDeduction: 0 }, d);
  assert.ok(low.breakdown.provincial.provincialTaxReduction > 0);
  assert.equal(high.breakdown.provincial.provincialTaxReduction, 0);
});

test("RRSP deduction can move taxpayer into Ontario Tax Reduction range", async () => {
  const d = await data(2026);
  // Just above the OTR extinguishment point (~$24,900 other-income in this model).
  const before = tax({ year: 2026, province: "ON", otherIncome: 25500, rrspDeduction: 0 }, d);
  const after = tax({ year: 2026, province: "ON", otherIncome: 25500, rrspDeduction: 2000 }, d);
  assert.equal(before.breakdown.provincial.provincialTaxReduction, 0);
  assert.ok(after.breakdown.provincial.provincialTaxReduction > 0);
  assert.ok(before.totals.provTax > after.totals.provTax);
});

test("Ontario order: reduction before OHP; full OTR can zero Ontario tax before premium", async () => {
  const d = await data(2026);
  const wiped = tax({ year: 2026, province: "ON", otherIncome: 18000, rrspDeduction: 0 }, d);
  assert.ok(wiped.breakdown.provincial.provincialTaxReduction > 0);
  assert.equal(wiped.breakdown.provincial.taxAfterReductions, 0);

  const withOhp = tax({ year: 2026, province: "ON", otherIncome: 22000, rrspDeduction: 0 }, d);
  const otr = withOhp.breakdown.provincial.provincialTaxReduction;
  const ohp = withOhp.breakdown.provincial.premiums?.[0]?.amount ?? 0;
  assert.ok(otr > 0);
  assert.ok(ohp > 0);
  assert.ok(
    Math.abs(withOhp.breakdown.provincial.taxAfterReductions + ohp - withOhp.totals.provTax) < 0.02
  );
});

test("NL 2026 BPA is annual $13,094", async () => {
  const d = await data(2026);
  assert.equal(d.provinces.NL.credits.basicPersonalAmount.amount, 13094);
});

test("B.C. tax reduction formula corners (2026)", () => {
  const cfg = {
    type: "bc",
    baseAmount: 690,
    netIncomeThreshold: 25570,
    reductionFactor: 0.0356
  };
  assert.equal(calculateBCTaxReduction(1000, 20000, cfg).reduction, 690);
  assert.equal(calculateBCTaxReduction(1000, 25570, cfg).reduction, 690);
  const mid = calculateBCTaxReduction(1000, 30000, cfg);
  assert.ok(Math.abs(mid.rawReduction - Math.round((690 - 0.0356 * (30000 - 25570)) * 100) / 100) < 1e-9);
  assert.equal(
    calculateBCTaxReduction(1000, 44952, { ...cfg, maximumNetIncome: 44952 }).reduction,
    0
  );
  assert.equal(calculateBCTaxReduction(200, 20000, cfg).reduction, 200);
});

test("B.C. tax reduction applies in engine; RRSP can restore it", async () => {
  const d = await data(2026);
  assert.equal(d.provinces.BC.taxReduction.baseAmount, 690);
  assert.equal(d.provinces.BC.taxReduction.netIncomeThreshold, 25570);

  const low = tax({ year: 2026, province: "BC", otherIncome: 22000, rrspDeduction: 0 }, d);
  const high = tax({ year: 2026, province: "BC", otherIncome: 50000, rrspDeduction: 0 }, d);
  assert.ok(low.breakdown.provincial.provincialTaxReduction > 0);
  assert.equal(high.breakdown.provincial.provincialTaxReduction, 0);

  // Above extinguishment ($44,952); a $15k RRSP deduction moves NI into the phase-out range.
  const before = tax({ year: 2026, province: "BC", otherIncome: 50000, rrspDeduction: 0 }, d);
  const after = tax({ year: 2026, province: "BC", otherIncome: 50000, rrspDeduction: 15000 }, d);
  assert.equal(before.breakdown.provincial.provincialTaxReduction, 0);
  assert.ok(after.breakdown.provincial.provincialTaxReduction > 0);
  assert.ok(before.totals.provTax > after.totals.provTax);
});

test("NL low-income tax reduction single-filer path (2025 form amounts)", async () => {
  const d = await data(2025);
  const cfg = d.provinces.NL.taxReduction;
  assert.equal(cfg.basicReduction, 997);
  assert.equal(cfg.phaseOutBase, 23928);
  assert.equal(cfg.phaseOutRate, 0.16);

  const full = calculateLowIncomeTaxReduction(2000, 20000, cfg);
  assert.equal(full.reduction, 997);
  const partial = calculateLowIncomeTaxReduction(2000, 26000, cfg);
  assert.ok(Math.abs(partial.rawReduction - (997 - 0.16 * (26000 - 23928))) < 1e-9);
  const gone = calculateLowIncomeTaxReduction(2000, 30160, cfg);
  assert.equal(gone.reduction, 0);

  const eng = tax({ year: 2025, province: "NL", otherIncome: 22000, rrspDeduction: 0 }, d);
  assert.ok(eng.breakdown.provincial.provincialTaxReduction > 0);
});

test("NB and NS low-income tax reductions activate at low income", async () => {
  const d = await data(2026);
  const nb = tax({ year: 2026, province: "NB", otherIncome: 25000, rrspDeduction: 0 }, d);
  const ns = tax({ year: 2026, province: "NS", otherIncome: 18000, rrspDeduction: 0 }, d);
  const nbHigh = tax({ year: 2026, province: "NB", otherIncome: 80000, rrspDeduction: 0 }, d);
  assert.ok(nb.breakdown.provincial.provincialTaxReduction > 0);
  assert.ok(ns.breakdown.provincial.provincialTaxReduction > 0);
  assert.equal(nbHigh.breakdown.provincial.provincialTaxReduction, 0);
});

test("getTaxBreakpoints exposes federal BPA phase-out and ON OHP points", async () => {
  const { getTaxBreakpoints } = await import("../calculators/canada-income-tax/js/tax.kinks.js");
  const d = await data(2026);
  const points = getTaxBreakpoints(d, "ON");
  const incomes = points.map((p) => p.income);
  assert.ok(incomes.includes(181440));
  assert.ok(incomes.includes(258482));
  assert.ok(incomes.includes(20000));
  assert.ok(incomes.includes(53891));
  assert.ok(points.some((p) => /BPA phase-out/i.test(p.reason)));

  const bc = getTaxBreakpoints(d, "BC");
  assert.ok(bc.some((p) => p.income === 25570));
  assert.ok(bc.some((p) => p.income === 44952));
  const nl = getTaxBreakpoints(d, "NL");
  assert.ok(nl.some((p) => p.income === 24191));
});
