/**
 * Owner follow-up: capital gains uses source-neutral taxable income (otherIncome),
 * not employmentIncome — no CPP/EI/CEA from the pre-gain amount.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getTaxDataBundle } from "../calculators/canada-income-tax/js/tax.data.js";
import { computePersonalTax } from "../calculators/canada-income-tax/js/tax.engine.js";
import {
  calculateProgressiveCapitalGainsTax,
  CAPITAL_GAINS_INCLUSION_RATE
} from "../calculators/capital-gains-tax-canada/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAX_DATA_ROOT = join(ROOT, "calculators", "canada-income-tax", "data");
const taxData2025 = await getTaxDataBundle(2025, { fsDataRoot: TAX_DATA_ROOT });
const taxData2026 = await getTaxDataBundle(2026, { fsDataRoot: TAX_DATA_ROOT });

function progressive(overrides = {}, taxData = taxData2025) {
  return calculateProgressiveCapitalGainsTax(
    {
      year: 2025,
      province: "ON",
      incomeBeforeGain: 50_000,
      capitalGain: 200_000,
      primaryResidenceExemption: false,
      ...overrides
    },
    { taxData }
  );
}

test("A: generic taxable income does not generate CPP or EI", () => {
  const result = progressive({ capitalGain: 0 });
  assert.equal(result.before.totals.cpp, 0);
  assert.equal(result.before.totals.ei, 0);
  assert.equal(result.before.totals.taxableIncome, 50_000);
});

test("B: generic income does not receive Canada Employment Amount", () => {
  const result = progressive({ capitalGain: 0 });
  const bases = result.before.breakdown?.federal?.creditBases || [];
  const cea = bases.find((c) => c.name === "Canada Employment Amount");
  assert.equal(cea, undefined);
  assert.ok(bases.some((c) => c.name === "Basic Personal Amount"));
});

test("C: same inputs reconcile across taxData bundles / years without legacy contamination", () => {
  const a = progressive({ year: 2025 }, taxData2025);
  const b = progressive({ year: 2025 }, taxData2025);
  assert.equal(a.additionalTax, b.additionalTax);

  const y2026 = calculateProgressiveCapitalGainsTax(
    {
      year: 2026,
      province: "ON",
      incomeBeforeGain: 50_000,
      capitalGain: 200_000
    },
    { taxData: taxData2026 }
  );
  // Explicit year mismatch would throw; here years match their bundles.
  assert.ok(Number.isFinite(y2026.additionalTax));
  assert.equal(y2026.year, 2026);
});

test("D: gain entirely within one bracket still yields positive incremental tax", () => {
  const result = progressive({ incomeBeforeGain: 40_000, capitalGain: 2_000 });
  assert.equal(result.taxableIncluded, 1_000);
  assert.ok(result.additionalTax > 0);
  assert.ok(result.additionalTax < 500);
});

test("E: gain crossing one bracket stacks progressive tax", () => {
  const result = progressive({ incomeBeforeGain: 50_000, capitalGain: 80_000 });
  assert.equal(result.taxableIncluded, 40_000);
  assert.ok(result.additionalTax > 0);
  assert.notEqual(Math.round(result.additionalTax), Math.round(40_000 * 0.2));
});

test("F: multi-bracket gain produces substantial incremental tax", () => {
  const result = progressive({ incomeBeforeGain: 60_000, capitalGain: 500_000 });
  assert.equal(result.taxableIncluded, 250_000);
  assert.ok(result.additionalTax > 50_000);
});

test("G: zero capital gain → zero additional tax", () => {
  const result = progressive({ capitalGain: 0 });
  assert.equal(result.additionalTax, 0);
  assert.equal(result.taxableIncluded, 0);
});

test("H: employment vs otherIncome quantification on Pass 2 reference case", () => {
  // Reconstruct old employment convention for the documented delta.
  const oldBefore = computePersonalTax(
    {
      year: 2025,
      province: "ON",
      employmentIncome: 50_000,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0
    },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );
  const oldAfter = computePersonalTax(
    {
      year: 2025,
      province: "ON",
      employmentIncome: 50_000,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 200_000,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0
    },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );
  const neu = progressive({});
  const oldIncremental = oldAfter.totals.totalIncomeTax - oldBefore.totals.totalIncomeTax;

  assert.ok(Math.abs(oldIncremental - 34_703) < 1);
  assert.ok(Math.abs(neu.additionalTax - 34_904) < 1);
  assert.ok(neu.taxBefore > oldBefore.totals.totalIncomeTax);
  assert.ok(neu.taxAfter > oldAfter.totals.totalIncomeTax);
  assert.ok(Math.abs(neu.additionalTax - oldIncremental - 201) < 2);
  assert.equal(CAPITAL_GAINS_INCLUSION_RATE, 0.5);
});
