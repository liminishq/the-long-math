import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTaxData } from "../calculators/canada-income-tax/js/tax.data.js";
import {
  projectTaxData,
  resolveTaxDataForYear,
  isOfficialTaxYear
} from "../calculators/canada-income-tax/js/tax.projection.js";

const FS_DATA_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../calculators/canada-income-tax/data"
);

async function loadOfficial(year) {
  return loadTaxData(year, { fsDataRoot: FS_DATA_ROOT });
}

test("official years are not projected", async () => {
  const resolved = await resolveTaxDataForYear(2026, {
    loadOfficialYear: loadOfficial,
    federalInflationRate: 0.02
  });
  assert.equal(resolved.meta.projected, false);
  assert.equal(resolved.meta.source, "official");
  assert.equal(resolved.federal.brackets[1].threshold, 58523);
  assert.equal(isOfficialTaxYear(2026), true);
  assert.equal(isOfficialTaxYear(2028), false);
});

test("0% inflation projection leaves indexed thresholds unchanged", async () => {
  const base = await loadOfficial(2026);
  const projected = projectTaxData(base, {
    baseYear: 2026,
    targetYear: 2028,
    federalInflationRate: 0,
    defaultProvincialInflationRate: 0
  });
  assert.equal(projected.meta.projected, true);
  assert.equal(projected.federal.brackets[1].threshold, base.federal.brackets[1].threshold);
  assert.equal(
    projected.provinces.ON.credits.basicPersonalAmount.amount,
    base.provinces.ON.credits.basicPersonalAmount.amount
  );
  assert.equal(projected.federal.brackets[1].rate, base.federal.brackets[1].rate);
});

test("2% inflation compounds indexed federal thresholds over multiple years", async () => {
  const base = await loadOfficial(2026);
  const projected = projectTaxData(base, {
    baseYear: 2026,
    targetYear: 2028,
    federalInflationRate: 0.02
  });
  const expected = Math.round(58523 * 1.02 * 1.02);
  assert.equal(projected.federal.brackets[1].threshold, expected);
  assert.equal(projected.federal.brackets[1].rate, 0.205);
  assert.equal(projected.payroll.cpp.basicExemption, 3500);
});

test("federal and provincial inflation factors can differ", async () => {
  const base = await loadOfficial(2026);
  const projected = projectTaxData(base, {
    baseYear: 2026,
    targetYear: 2027,
    federalInflationRate: 0.02,
    provincialInflationRates: { ON: 0.019 }
  });
  assert.equal(projected.federal.brackets[1].threshold, Math.round(58523 * 1.02));
  assert.equal(projected.provinces.ON.brackets[1].threshold, Math.round(53891 * 1.019));
  assert.equal(projected.provinces.ON.surtaxes[0].threshold, Math.round(5818 * 1.019));
});

test("resolveTaxDataForYear falls back to projection only when unpublished", async () => {
  const resolved = await resolveTaxDataForYear(2028, {
    loadOfficialYear: loadOfficial,
    federalInflationRate: 0.02,
    defaultProvincialInflationRate: 0.02
  });
  assert.equal(resolved.meta.projected, true);
  assert.equal(resolved.meta.baseYear, 2026);
  assert.equal(resolved.meta.yearsAhead, 2);
  assert.equal(resolved.federal.brackets[1].threshold, Math.round(58523 * 1.02 * 1.02));
});

test("Ontario Health Premium bands are not in projected JSON (engine-side statutory)", async () => {
  const base = await loadOfficial(2026);
  const projected = projectTaxData(base, {
    baseYear: 2026,
    targetYear: 2030,
    federalInflationRate: 0.02
  });
  const premium = projected.provinces.ON.premiums[0];
  assert.equal(premium.formula, "ontarioHealthPremium");
  assert.equal(premium.brackets, undefined);
});

test("projection base year is latest official before target, not an older selected year", async () => {
  // Even if a caller might prefer 2025 historically, default resolution for 2030
  // must project from 2026 (newest official ≤ target).
  const resolved = await resolveTaxDataForYear(2030, {
    loadOfficialYear: loadOfficial,
    federalInflationRate: 0.02,
    defaultProvincialInflationRate: 0.02
  });
  assert.equal(resolved.meta.baseYear, 2026);
  assert.equal(resolved.meta.yearsAhead, 4);
  assert.equal(resolved.federal.brackets[1].threshold, Math.round(58523 * 1.02 ** 4));
  // Enhanced BPA structure preserved (not collapsed to one scalar).
  assert.ok(resolved.federal.credits.basicPersonalAmount.maximum > resolved.federal.credits.basicPersonalAmount.minimum);
  assert.ok(resolved.federal.credits.basicPersonalAmount.phaseOutEnd > resolved.federal.credits.basicPersonalAmount.phaseOutStart);
});

test("Manitoba frozen brackets stay fixed under projection; federal still indexes", async () => {
  const resolved = await resolveTaxDataForYear(2028, {
    loadOfficialYear: loadOfficial,
    federalInflationRate: 0.02,
    defaultProvincialInflationRate: 0.02
  });
  const base = await loadOfficial(2026);
  assert.equal(resolved.provinces.MB.brackets[1].threshold, base.provinces.MB.brackets[1].threshold);
  assert.equal(resolved.provinces.MB.credits.basicPersonalAmount.amount, base.provinces.MB.credits.basicPersonalAmount.amount);
  assert.equal(resolved.federal.brackets[1].threshold, Math.round(58523 * 1.02 * 1.02));
});

test("BC projected brackets and basic personal credits stay frozen 2027–2030", async () => {
  const resolved = await resolveTaxDataForYear(2029, {
    loadOfficialYear: loadOfficial,
    federalInflationRate: 0.02,
    defaultProvincialInflationRate: 0.022
  });
  const base = await loadOfficial(2026);
  assert.equal(resolved.provinces.BC.brackets[1].threshold, base.provinces.BC.brackets[1].threshold);
  assert.equal(resolved.provinces.BC.brackets[0].rate, 0.056);
  assert.equal(
    resolved.provinces.BC.credits.basicPersonalAmount.amount,
    base.provinces.BC.credits.basicPersonalAmount.amount
  );
  assert.equal(resolved.provinces.BC.taxReduction.baseAmount, base.provinces.BC.taxReduction.baseAmount);
  assert.equal(
    resolved.provinces.BC.taxReduction.netIncomeThreshold,
    base.provinces.BC.taxReduction.netIncomeThreshold
  );
  assert.equal(
    resolved.provinces.BC.taxReduction.maximumNetIncome,
    base.provinces.BC.taxReduction.maximumNetIncome
  );
  // Contrast: a normally indexed province still moves BPA.
  assert.ok(
    resolved.provinces.ON.credits.basicPersonalAmount.amount >
      base.provinces.ON.credits.basicPersonalAmount.amount
  );
});

test("PEI BPA floor stays $15,000 under projection", async () => {
  const resolved = await resolveTaxDataForYear(2028, {
    loadOfficialYear: loadOfficial,
    federalInflationRate: 0.02,
    defaultProvincialInflationRate: 0.02
  });
  assert.equal(resolved.provinces.PE.credits.basicPersonalAmount.amount, 15000);
});
