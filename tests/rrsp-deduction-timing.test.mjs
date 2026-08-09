import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  breakEvenAnnualRate,
  computeDeductionTiming,
  futureValueOfRefund,
  parseIntegerYears
} from "../calculators/rrsp-deduction-timing/engine.js";

const FS_DATA_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../calculators/canada-income-tax/data"
);

const runtime = { fsDataRoot: FS_DATA_ROOT };

async function run(inputs) {
  return computeDeductionTiming(inputs, runtime);
}

test("basic equivalence: identical incomes, zero return, same official year", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 90000,
    futureIncome: 90000,
    deductionAmount: 10000,
    yearsToWait: 0,
    annualRate: 0,
    inflationRate: 2
  });
  assert.ok(Math.abs(result.current.taxSaved - result.future.taxSaved) <= 1);
  assert.equal(result.comparison.claimNowFutureValue, result.current.taxSaved);
  assert.ok(Math.abs(result.comparison.deferAdvantage) <= 1);
  assert.equal(result.taxTables.future.projected, false);
});

test("current income higher: claiming now is favoured at zero return", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 160000,
    futureIncome: 70000,
    deductionAmount: 15000,
    yearsToWait: 2,
    annualRate: 0,
    inflationRate: 2
  });
  assert.ok(result.current.taxSaved > result.future.taxSaved);
  assert.ok(result.comparison.deferAdvantage < 0);
  assert.equal(result.optimization.strategyKind, "all_now");
});

test("future income higher: deferral can win", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 60000,
    futureIncome: 170000,
    deductionAmount: 15000,
    yearsToWait: 2,
    annualRate: 0,
    inflationRate: 2
  });
  assert.ok(result.future.taxSaved > result.current.taxSaved);
  assert.ok(result.comparison.deferAdvantage > 0);
  assert.ok(["all_later", "split"].includes(result.optimization.strategyKind));
});

test("tax saving uses full engine difference, not a single marginal rate", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 120000,
    futureIncome: 120000,
    deductionAmount: 30000,
    yearsToWait: 0,
    annualRate: 0,
    inflationRate: 0
  });
  const expected =
    result.current.before.totals.totalIncomeTax - result.current.after.totals.totalIncomeTax;
  assert.equal(result.current.taxSaved, Math.max(0, expected));
  assert.ok(result.current.blendedRate > 0.2);
  assert.ok(result.current.blendedRate < 1);
  // Not a single top-bracket shortcut: average value of a large deduction is
  // below the next-dollar rate once lower brackets are included.
  const tiny = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 120000,
    futureIncome: 120000,
    deductionAmount: 100,
    yearsToWait: 0,
    annualRate: 0,
    inflationRate: 0
  });
  assert.ok(result.current.blendedRate < tiny.current.blendedRate);
});

test("deduction crossing multiple brackets produces blended value", async () => {
  const small = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 120000,
    futureIncome: 120000,
    deductionAmount: 1000,
    yearsToWait: 0,
    annualRate: 0
  });
  const large = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 120000,
    futureIncome: 120000,
    deductionAmount: 40000,
    yearsToWait: 0,
    annualRate: 0
  });
  assert.ok(large.current.blendedRate < small.current.blendedRate);
});

test("partial optimization: all-now optimal when incomes equal and return positive", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 100000,
    futureIncome: 100000,
    deductionAmount: 10000,
    yearsToWait: 3,
    annualRate: 8,
    inflationRate: 2
  });
  assert.equal(result.optimization.strategyKind, "all_now");
  assert.equal(result.optimization.optimal.carryForward, 0);
});

test("partial optimization: all-later optimal for large near-term income jump and zero return", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 50000,
    futureIncome: 200000,
    deductionAmount: 20000,
    yearsToWait: 1,
    annualRate: 0,
    inflationRate: 0
  });
  assert.equal(result.optimization.strategyKind, "all_later");
  assert.equal(result.optimization.optimal.claimNow, 0);
});

test("partial optimization: split is optimal for a large deduction across two similar high-income years", async () => {
  // Concavity of tax savings: S(x)+S(D-x) can exceed S(D) when D would otherwise
  // push deep into lower brackets in a single year.
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 100000,
    futureIncome: 100000,
    deductionAmount: 80000,
    yearsToWait: 1,
    annualRate: 0,
    inflationRate: 0
  });
  assert.equal(result.optimization.strategyKind, "split");
  assert.ok(result.optimization.optimal.claimNow > 1);
  assert.ok(result.optimization.optimal.carryForward > 1);
  assert.ok(result.optimization.advantageVersusAllNow >= 25);
  assert.ok(result.optimization.advantageVersusAllLater >= 25);
});

test("future year with official table uses official data (2025 + 1 year -> 2026)", async () => {
  const result = await run({
    taxYear: 2025,
    province: "ON",
    currentIncome: 90000,
    futureIncome: 90000,
    deductionAmount: 5000,
    yearsToWait: 1,
    annualRate: 0,
    inflationRate: 2
  });
  assert.equal(result.inputs.futureTaxYear, 2026);
  assert.equal(result.taxTables.future.projected, false);
  assert.equal(result.taxTables.future.source, "official");
});

test("future unpublished year uses projection and discloses it", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 90000,
    futureIncome: 90000,
    deductionAmount: 5000,
    yearsToWait: 3,
    annualRate: 0,
    inflationRate: 2
  });
  assert.equal(result.inputs.futureTaxYear, 2029);
  assert.equal(result.taxTables.future.projected, true);
  assert.equal(result.taxTables.future.inflationRate, 0.02);
});

test("zero and pathological inputs do not crash or emit NaN", async () => {
  const cases = [
    { deductionAmount: 0, yearsToWait: 2, annualRate: 6 },
    { deductionAmount: 10000, yearsToWait: 0, annualRate: 6 },
    { deductionAmount: 10000, currentIncome: 0, futureIncome: 80000, yearsToWait: 2, annualRate: 6 },
    { deductionAmount: 200000, currentIncome: 50000, futureIncome: 50000, yearsToWait: 1, annualRate: 0 },
    { deductionAmount: 10000, yearsToWait: 2, annualRate: -50 },
    { deductionAmount: 10000, yearsToWait: 2, annualRate: -100 },
    { deductionAmount: 10000, yearsToWait: 2, annualRate: -150 },
    { deductionAmount: 10000, currentIncome: 1e7, futureIncome: 1e7, yearsToWait: 1, annualRate: 3 },
    { deductionAmount: 1234.56, currentIncome: 87654.32, futureIncome: 98765.43, yearsToWait: 2, annualRate: 4.25 }
  ];

  for (const partial of cases) {
    const result = await run({
      taxYear: 2026,
      province: "ON",
      currentIncome: 80000,
      futureIncome: 100000,
      inflationRate: 2,
      ...partial
    });
    const nums = [
      result.current.taxSaved,
      result.future.taxSaved,
      result.optimization.optimal.totalFutureValue,
      result.optimization.allNow.totalFutureValue,
      result.optimization.allLater.totalFutureValue
    ];
    for (const n of nums) {
      assert.equal(Number.isFinite(n), true, `non-finite for ${JSON.stringify(partial)} -> ${n}`);
    }
    if (result.comparison.breakEvenAnnualRate != null) {
      assert.equal(Number.isFinite(result.comparison.breakEvenAnnualRate), true);
      assert.notEqual(result.comparison.breakEvenAnnualRate, Infinity);
    }
  }
});

test("break-even invariant: FV(current saving) ≈ future saving at break-even rate", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 80000,
    futureIncome: 140000,
    deductionAmount: 15000,
    yearsToWait: 2,
    annualRate: 6,
    inflationRate: 2
  });
  const r = result.comparison.breakEvenAnnualRate;
  assert.ok(r != null && Number.isFinite(r));
  const fv = futureValueOfRefund(result.current.taxSaved, result.inputs.yearsToWait, r);
  assert.ok(Math.abs(fv - result.future.taxSaved) < 1);
});

test("breakEvenAnnualRate helper edge cases", () => {
  assert.equal(breakEvenAnnualRate(0, 1000, 2), null);
  assert.equal(breakEvenAnnualRate(1000, 1000, 0), null);
  assert.equal(breakEvenAnnualRate(1000, 0, 2), -1);
  assert.ok(Number.isFinite(breakEvenAnnualRate(1000, 1200, 2)));
});

test("futureValueOfRefund rejects rates at or below -100%", () => {
  assert.equal(futureValueOfRefund(1000, 2, -1), null);
  assert.equal(futureValueOfRefund(1000, 2, -1.5), null);
  assert.equal(futureValueOfRefund(1000, 0, 0.05), 1000);
  assert.ok(Math.abs(futureValueOfRefund(1000, 2, 0.05) - 1102.5) < 1e-9);
});

test("Ontario 2026 surtax thresholds match CRA T4032-ON", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 100000,
    futureIncome: 100000,
    deductionAmount: 1000,
    yearsToWait: 0,
    annualRate: 0
  });
  // dataOverride used internally; validate via loaded official path side effect
  const { loadTaxData } = await import("../calculators/canada-income-tax/js/tax.data.js");
  const data = await loadTaxData(2026, { fsDataRoot: FS_DATA_ROOT });
  assert.equal(data.provinces.ON.surtaxes[0].threshold, 5818);
  assert.equal(data.provinces.ON.surtaxes[0].threshold2, 7446);
  assert.ok(result.current.taxSaved >= 0);
});

test("parseIntegerYears accepts non-negative integers including zero (engine edge case)", () => {
  assert.deepEqual(parseIntegerYears(0), { ok: true, error: null, years: 0, raw: 0 });
  assert.deepEqual(parseIntegerYears(2), { ok: true, error: null, years: 2, raw: 2 });
  assert.deepEqual(parseIntegerYears("3"), { ok: true, error: null, years: 3, raw: "3" });
});

test("n=0 break-even is N/A and recommendation avoids later framing", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 60000,
    futureIncome: 150000,
    deductionAmount: 10000,
    yearsToWait: 0,
    annualRate: 5
  });
  assert.equal(result.comparison.breakEvenAnnualRate, null);
  assert.equal(breakEvenAnnualRate(result.current.taxSaved, result.future.taxSaved, 0), null);
  assert.equal(result.sameYearComparison, true);
  assert.doesNotMatch(result.comparison.recommendation.label, /\blater\b/i);
  assert.doesNotMatch(result.comparison.recommendation.sentence, /\blater\b/i);
  assert.doesNotMatch(result.optimization.labels.allLater, /\blater\b/i);
  assert.doesNotMatch(result.optimization.labels.carryForward, /\blater\b|carry forward/i);
});

test("parseIntegerYears rejects fractional and out-of-range values without coercion", () => {
  assert.equal(parseIntegerYears(2.8).ok, false);
  assert.equal(parseIntegerYears(2.8).error, "fractionalYears");
  assert.equal(parseIntegerYears(2.8).years, null);
  assert.equal(parseIntegerYears(2.8).raw, 2.8);
  assert.equal(parseIntegerYears(-1).error, "yearsRange");
  assert.equal(parseIntegerYears(41).error, "yearsRange");
  assert.equal(parseIntegerYears("").error, "yearsRequired");
});

test("fractional yearsToWait returns validation error and does not compute", async () => {
  const result = await run({
    taxYear: 2026,
    province: "ON",
    currentIncome: 80000,
    futureIncome: 120000,
    deductionAmount: 10000,
    yearsToWait: 2.8,
    annualRate: 6
  });
  assert.equal(result.error.code, "fractionalYears");
  assert.equal(result.inputs.yearsToWait, 2.8);
  assert.equal(result.comparison, null);
  assert.equal(result.current, null);
});

test("futureValueOfRefund and breakEven reject fractional years", () => {
  assert.equal(futureValueOfRefund(1000, 2.5, 0.05), null);
  assert.equal(breakEvenAnnualRate(1000, 1200, 2.5), null);
  assert.equal(futureValueOfRefund(1000, 0, 0.05), 1000);
});
