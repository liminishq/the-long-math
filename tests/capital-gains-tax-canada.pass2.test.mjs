/**
 * Pass 2: progressive incremental capital-gains tax (primary) + manual sensitivity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getTaxDataBundle } from "../calculators/canada-income-tax/js/tax.data.js";
import {
  calculateProgressiveCapitalGainsTax,
  calculateManualMarginalRateEstimate,
  CAPITAL_GAINS_INCLUSION_RATE,
  CALC_MODES,
  buildShareScenario,
  parseShareQuery,
  buildCsvRows
} from "../calculators/capital-gains-tax-canada/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAX_DATA_ROOT = join(ROOT, "calculators", "canada-income-tax", "data");

const taxData2025 = await getTaxDataBundle(2025, { fsDataRoot: TAX_DATA_ROOT });
const taxData2026 = await getTaxDataBundle(2026, { fsDataRoot: TAX_DATA_ROOT });

function progressive(overrides, taxData = taxData2025) {
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

test("inclusion rate constant is 50%", () => {
  assert.equal(CAPITAL_GAINS_INCLUSION_RATE, 0.5);
});

test("Pass 2 ON example (source-neutral taxable income): income 50000, gain 200000 → additional tax ≈ 34904", () => {
  const result = progressive({});
  assert.equal(result.mode, CALC_MODES.PROGRESSIVE);
  assert.equal(result.taxableIncluded, 100_000);
  assert.ok(
    Math.abs(result.additionalTax - 34_904) < 1,
    `expected ~34904, got ${result.additionalTax}`
  );
  assert.equal(Math.round(result.additionalTax), Math.round(result.taxAfter - result.taxBefore));
  const flatAtStartingGuess = result.taxableIncluded * 0.4;
  assert.ok(
    Math.abs(result.additionalTax - flatAtStartingGuess) > 1000,
    "Must not equal included gain × a single 40% rate"
  );
});

test("gain within one bracket (small gain) yields positive additional tax under inclusion", () => {
  const result = progressive({ incomeBeforeGain: 40_000, capitalGain: 2_000 });
  assert.equal(result.taxableIncluded, 1_000);
  assert.ok(result.additionalTax > 0);
  assert.ok(result.additionalTax < 1_000);
  assert.ok(result.taxAfter > result.taxBefore);
});

test("gain crossing brackets: additional tax exceeds a single low-bracket flat estimate", () => {
  const result = progressive({ incomeBeforeGain: 50_000, capitalGain: 80_000 });
  assert.equal(result.taxableIncluded, 40_000);
  // Flat 20% on included would be 8000; progressive stacking should differ and still be > 0
  assert.ok(result.additionalTax > 0);
  assert.notEqual(Math.round(result.additionalTax), Math.round(result.taxableIncluded * 0.2));
});

test("large multi-bracket gain produces substantial additional tax and higher after-gain taxable income", () => {
  const result = progressive({ incomeBeforeGain: 60_000, capitalGain: 500_000 });
  assert.equal(result.taxableIncluded, 250_000);
  assert.ok(result.additionalTax > 50_000);
  assert.ok(result.taxableIncomeAfter > result.taxableIncomeBefore + 200_000);
});

test("zero gain and capital loss produce zero incremental tax", () => {
  const zero = progressive({ capitalGain: 0 });
  assert.equal(zero.taxableIncluded, 0);
  assert.equal(zero.additionalTax, 0);

  const loss = progressive({ capitalGain: -25_000 });
  assert.equal(loss.isLoss, true);
  assert.equal(loss.taxableIncluded, 0);
  assert.equal(loss.additionalTax, 0);
});

test("low income vs high income change additional tax on the same gain", () => {
  const low = progressive({ incomeBeforeGain: 20_000, capitalGain: 100_000 });
  const high = progressive({ incomeBeforeGain: 200_000, capitalGain: 100_000 });
  assert.notEqual(Math.round(low.additionalTax), Math.round(high.additionalTax));
  assert.ok(high.additionalTax > low.additionalTax);
});

test("province and year changes alter progressive additional tax", () => {
  const on2025 = progressive({ province: "ON", year: 2025 }, taxData2025);
  const ab2025 = progressive({ province: "AB", year: 2025 }, taxData2025);
  const on2026 = progressive({ province: "ON", year: 2026 }, taxData2026);

  assert.notEqual(Math.round(on2025.additionalTax), Math.round(ab2025.additionalTax));
  assert.notEqual(Math.round(on2025.additionalTax), Math.round(on2026.additionalTax));
});

test("manual mode still does taxableGain × rate", () => {
  const result = calculateManualMarginalRateEstimate({
    capitalGain: 50_000,
    inclusionRate: 50,
    marginalTaxRate: 40,
    primaryResidenceExemption: false
  });
  assert.equal(result.mode, CALC_MODES.MANUAL);
  assert.equal(result.taxableGain, 25_000);
  assert.equal(result.taxOwing, 10_000);
  assert.equal(result.additionalTax, 10_000);
});

test("PRE zeroes incremental tax in progressive mode", () => {
  const result = progressive({
    capitalGain: 200_000,
    primaryResidenceExemption: true
  });
  assert.equal(result.taxableIncluded, 0);
  assert.equal(result.additionalTax, 0);
  assert.equal(result.taxAfter, result.taxBefore);
});

test("PRE zeroes tax in manual mode", () => {
  const result = calculateManualMarginalRateEstimate({
    capitalGain: 50_000,
    inclusionRate: 50,
    marginalTaxRate: 40,
    primaryResidenceExemption: true
  });
  assert.equal(result.taxableGain, 0);
  assert.equal(result.taxOwing, 0);
});

test("share/query round-trip restores progressive scenario", () => {
  const inputs = {
    mode: CALC_MODES.PROGRESSIVE,
    year: 2026,
    province: "BC",
    incomeBeforeGain: 72000,
    capitalGain: 150000,
    primaryResidenceExemption: false
  };
  const scenario = buildShareScenario(inputs);
  const parsed = parseShareQuery(scenario);
  assert.equal(parsed.mode, CALC_MODES.PROGRESSIVE);
  assert.equal(parsed.year, 2026);
  assert.equal(parsed.province, "BC");
  assert.equal(parsed.incomeBeforeGain, 72000);
  assert.equal(parsed.capitalGain, 150000);
  assert.equal(parsed.primaryResidenceExemption, false);

  const fromUrl = parseShareQuery(
    new URLSearchParams(
      Object.entries(scenario).map(([k, v]) => [k, String(v)])
    )
  );
  assert.equal(fromUrl.year, 2026);
  assert.equal(fromUrl.province, "BC");
  assert.equal(fromUrl.incomeBeforeGain, 72000);
});

test("CSV export rows reconcile with headline additional tax", () => {
  const inputs = {
    year: 2025,
    province: "ON",
    incomeBeforeGain: 50_000,
    capitalGain: 200_000,
    primaryResidenceExemption: false
  };
  const result = progressive(inputs);
  const rows = buildCsvRows(inputs, result);
  const csv = rows.join("\n");
  assert.match(csv, /Additional tax,/);
  assert.ok(csv.includes("Additional tax," + result.additionalTax));
  assert.ok(csv.includes("Tax before," + result.taxBefore));
  assert.ok(csv.includes("Tax after," + result.taxAfter));
  assert.equal(result.additionalTax, result.taxAfter - result.taxBefore);
});

