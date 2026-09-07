import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULTS,
  monthlyRateFromEffectiveAnnual,
  futureValueOrdinaryAnnuity,
  growBalance,
  findMonotonicRoot,
  validateInputs,
  earlyInvestorAtRate,
  laterInvestorAtRate,
  continuedEarlyInvestor,
  requiredLaterAnnualReturn,
  requiredLaterMonthlyContribution,
  breakEvenAnnualReturn,
  projectPortfoliosByAge,
  computeCostOfWaiting
} from "../calculators/cost-of-waiting-to-invest/engine.js";

function assertApprox(actual, expected, tol = 1e-6, label = "") {
  const prefix = label ? `${label}: ` : "";
  assert.ok(Number.isFinite(actual), `${prefix}expected finite number, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${prefix}expected ${expected}, got ${actual} (tol ${tol})`
  );
}

const DEFAULT_INPUTS = { ...DEFAULTS };

test("default golden: monthly rate from 8% effective annual", () => {
  const rm = monthlyRateFromEffectiveAnnual(0.08);
  assertApprox(rm, 0.00643403011, 1e-11);
  assert.notEqual(rm, 0.08 / 12);
});

test("default golden: early and later retirement values", () => {
  const early = earlyInvestorAtRate(DEFAULT_INPUTS, 0.08);
  const later = laterInvestorAtRate(DEFAULT_INPUTS, 0.08);

  assert.equal(early.totalContributed, 48000);
  assert.equal(later.totalContributed, 144000);
  assertApprox(early.valueAtStop, 72049.7093, 1e-3);
  assertApprox(early.valueAtRetirement, 725011.5034, 1e-3);
  assertApprox(later.valueAtRetirement, 563420.2349, 1e-3);
  assertApprox(early.valueAtRetirement - later.valueAtRetirement, 161591.2686, 1e-3);
  assert.equal(later.totalContributed - early.totalContributed, 96000);
});

test("default golden: catch-up return, contribution, break-even, continued", () => {
  const result = computeCostOfWaiting(DEFAULT_INPUTS);
  assert.equal(result.ok, true);
  assertApprox(result.catchUpReturn.annualReturn, 0.093285646868, 1e-10);
  assertApprox(result.catchUpContribution.monthlyContribution, 514.721665, 1e-5);
  assertApprox(result.breakEven.annualReturn, 0.062832789416, 1e-10);
  assert.equal(result.continued.totalContributed, 192000);
  assertApprox(result.continued.valueAtRetirement, 1288431.7383, 1e-3);
  assert.equal(result.comparison.kind, "early_ahead_contributed_less");
  assert.equal(result.comparison.earlyAhead, true);
});

test("zero return: future values equal total contributions", () => {
  const inputs = { ...DEFAULT_INPUTS, annualReturn: 0 };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.equal(result.early.valueAtStop, 48000);
  assert.equal(result.early.valueAtRetirement, 48000);
  assert.equal(result.later.valueAtRetirement, 144000);
  assert.equal(result.continued.valueAtRetirement, 192000);
  assert.equal(result.early.investmentGrowth, 0);
  assert.equal(result.later.investmentGrowth, 0);
  assert.equal(result.comparison.kind, "later_ahead_contributed_more");
  assert.equal(result.comparison.laterAhead, true);
});

test("negative return produces finite shrinking balances", () => {
  const inputs = { ...DEFAULT_INPUTS, annualReturn: -0.05 };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.early.valueAtRetirement));
  assert.ok(Number.isFinite(result.later.valueAtRetirement));
  assert.ok(result.early.valueAtRetirement > 0);
  assert.ok(result.later.valueAtRetirement > 0);
  assert.ok(result.early.valueAtRetirement < result.early.totalContributed);
  assert.ok(result.later.valueAtRetirement < result.later.totalContributed);
});

test("very small return near zero is numerically stable", () => {
  const tiny = 1e-14;
  const fvTiny = futureValueOrdinaryAnnuity(400, monthlyRateFromEffectiveAnnual(tiny), 120);
  const fvZero = futureValueOrdinaryAnnuity(400, 0, 120);
  assertApprox(fvTiny, fvZero, 1e-6);
  assertApprox(fvZero, 48000, 1e-12);

  const grownTiny = growBalance(72000, monthlyRateFromEffectiveAnnual(tiny), 360);
  assertApprox(grownTiny, 72000, 1e-4);
});

test("overlapping periods remain mathematically consistent", () => {
  const inputs = {
    earlyStartAge: 25,
    earlyStopAge: 50,
    laterStartAge: 30,
    retirementAge: 65,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.early.valueAtRetirement));
  assert.ok(Number.isFinite(result.later.valueAtRetirement));
  assert.equal(result.early.contributeMonths, 25 * 12);
  assert.equal(result.later.contributeMonths, 35 * 12);
  assert.ok(result.comparison.kind.startsWith("early_ahead") || result.comparison.kind.startsWith("later_ahead") || result.comparison.kind === "approximately_equal");
});

test("later investor finishes ahead: comparison is not an early-starter victory", () => {
  const inputs = {
    earlyStartAge: 25,
    earlyStopAge: 30,
    laterStartAge: 30,
    retirementAge: 65,
    monthlyContribution: 400,
    annualReturn: 0.02
  };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.ok(result.later.valueAtRetirement > result.early.valueAtRetirement);
  assert.equal(result.comparison.laterAhead, true);
  assert.equal(result.comparison.earlyAhead, false);
  assert.equal(result.comparison.kind, "later_ahead_contributed_more");
});

test("catch-up return can be negative and is not clamped to 0%", () => {
  const inputs = {
    earlyStartAge: 40,
    earlyStopAge: 45,
    laterStartAge: 30,
    retirementAge: 65,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  const early = earlyInvestorAtRate(inputs, 0.08);
  const solved = requiredLaterAnnualReturn(inputs, early.valueAtRetirement);
  assert.equal(solved.found, true);
  assert.ok(solved.annualReturn < 0, `expected negative required return, got ${solved.annualReturn}`);
  assert.ok(solved.annualReturn > -1);
});

test("no finite break-even when early path strictly contains later contributions", () => {
  const inputs = {
    earlyStartAge: 25,
    earlyStopAge: 65,
    laterStartAge: 35,
    retirementAge: 65,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.equal(result.breakEven.found, false);
  assert.equal(result.breakEven.reason, "no_root");
  assert.equal(result.breakEven.direction, "early_always_ahead");
  assert.ok(result.early.valueAtRetirement > result.later.valueAtRetirement);
});

test("age validation rejects invalid ordering and equal disallowed ages", () => {
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, earlyStartAge: 35, earlyStopAge: 35 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, earlyStartAge: 40, earlyStopAge: 35 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, earlyStopAge: 70 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, laterStartAge: 65 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, laterStartAge: 35, laterStopAge: 35 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, laterStopAge: 70 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, retirementAge: 25 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, earlyStartAge: 25.5 }).ok, false);
  assert.ok(validateInputs(DEFAULT_INPUTS).ok);
  assert.ok(validateInputs({ ...DEFAULT_INPUTS, earlyStopAge: 65 }).ok);
  assert.ok(validateInputs({ ...DEFAULT_INPUTS, laterStopAge: 55, retirementAge: 60 }).ok);
});

test("contribution validation rejects zero and negative amounts", () => {
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, earlyMonthlyContribution: 0 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, laterMonthlyContribution: 0 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, earlyMonthlyContribution: -50 }).ok, false);
  assert.ok(validateInputs({ ...DEFAULT_INPUTS, earlyMonthlyContribution: 25000, laterMonthlyContribution: 600 }).ok);

  const legacy = {
    earlyStartAge: 25,
    earlyStopAge: 35,
    laterStartAge: 35,
    laterStopAge: 65,
    retirementAge: 65,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  assert.ok(validateInputs(legacy).ok);
  assert.equal(validateInputs(legacy).inputs.earlyMonthlyContribution, 400);
  assert.equal(validateInputs(legacy).inputs.laterMonthlyContribution, 400);
  assert.equal(validateInputs({ ...legacy, monthlyContribution: 0 }).ok, false);
});

test("return validation: zero works, negative above -100% works, -100% and below rejected", () => {
  assert.ok(validateInputs({ ...DEFAULT_INPUTS, annualReturn: 0 }).ok);
  assert.ok(validateInputs({ ...DEFAULT_INPUTS, annualReturn: -0.2 }).ok);
  assert.ok(validateInputs({ ...DEFAULT_INPUTS, annualReturn: 0.3 }).ok);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, annualReturn: -1 }).ok, false);
  assert.equal(validateInputs({ ...DEFAULT_INPUTS, annualReturn: -1.2 }).ok, false);
});

test("required contribution inverts the later-investor annuity", () => {
  const early = earlyInvestorAtRate(DEFAULT_INPUTS, 0.08);
  const solved = requiredLaterMonthlyContribution(DEFAULT_INPUTS, early.valueAtRetirement, 0.08);
  assert.equal(solved.found, true);
  const check = laterInvestorAtRate(DEFAULT_INPUTS, 0.08, solved.monthlyContribution);
  assertApprox(check.valueAtRetirement, early.valueAtRetirement, 1e-6);
});

test("required contribution inverts the later-investor path when the later investor also coasts", () => {
  const inputs = {
    earlyStartAge: 25,
    earlyStopAge: 35,
    laterStartAge: 35,
    laterStopAge: 55,
    retirementAge: 60,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  const early = earlyInvestorAtRate(inputs, 0.08);
  const solved = requiredLaterMonthlyContribution(inputs, early.valueAtRetirement, 0.08);
  assert.equal(solved.found, true);
  const check = laterInvestorAtRate(inputs, 0.08, solved.monthlyContribution);
  assertApprox(check.valueAtRetirement, early.valueAtRetirement, 1e-6);
});

test("required return inverts the later-investor future value", () => {
  const early = earlyInvestorAtRate(DEFAULT_INPUTS, 0.08);
  const solved = requiredLaterAnnualReturn(DEFAULT_INPUTS, early.valueAtRetirement);
  assert.equal(solved.found, true);
  const check = laterInvestorAtRate(DEFAULT_INPUTS, solved.annualReturn);
  assertApprox(check.valueAtRetirement, early.valueAtRetirement, 1e-4);
});

test("break-even equates the two strategies at the same shared return", () => {
  const solved = breakEvenAnnualReturn(DEFAULT_INPUTS);
  assert.equal(solved.found, true);
  const early = earlyInvestorAtRate(DEFAULT_INPUTS, solved.annualReturn);
  const later = laterInvestorAtRate(DEFAULT_INPUTS, solved.annualReturn);
  assertApprox(early.valueAtRetirement, later.valueAtRetirement, 1e-4);
  assert.equal(solved.earlyAheadAbove, true);
});

test("chart projection at retirement matches headline engine values", () => {
  const result = computeCostOfWaiting(DEFAULT_INPUTS);
  const last = result.projection[result.projection.length - 1];
  assert.equal(last.age, 65);
  assertApprox(last.early, result.early.valueAtRetirement, 1e-8);
  assertApprox(last.later, result.later.valueAtRetirement, 1e-8);

  const atStop = result.projection.find((p) => p.age === 35);
  assertApprox(atStop.early, result.early.valueAtStop, 1e-8);
  assert.equal(atStop.later, 0);
});

test("findMonotonicRoot solves a simple cubic and reports no root without a sign change", () => {
  const root = findMonotonicRoot((x) => x * x * x - 8, 0, 4);
  assert.equal(root.found, true);
  assertApprox(root.root, 2, 1e-10);

  const none = findMonotonicRoot((x) => x * x + 1, -2, 2);
  assert.equal(none.found, false);
  assert.equal(none.reason, "no_sign_change");
});

test("identical cash-flow windows produce equal values and no unique break-even", () => {
  const inputs = {
    earlyStartAge: 30,
    earlyStopAge: 65,
    laterStartAge: 30,
    laterStopAge: 65,
    retirementAge: 65,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assertApprox(result.early.valueAtRetirement, result.later.valueAtRetirement, 1e-8);
  assert.equal(result.comparison.kind, "approximately_equal");
  assert.equal(result.breakEven.found, false);
  assert.equal(result.breakEven.reason, "always_equal");
});

test("later investor can stop contributing before retirement", () => {
  const inputs = {
    earlyStartAge: 25,
    earlyStopAge: 35,
    laterStartAge: 35,
    laterStopAge: 55,
    retirementAge: 60,
    monthlyContribution: 400,
    annualReturn: 0.08
  };
  const rm = monthlyRateFromEffectiveAnnual(0.08);
  const expectedEarlyStop = futureValueOrdinaryAnnuity(400, rm, 10 * 12);
  const expectedEarly = growBalance(expectedEarlyStop, rm, 25 * 12);
  const expectedLaterStop = futureValueOrdinaryAnnuity(400, rm, 20 * 12);
  const expectedLater = growBalance(expectedLaterStop, rm, 5 * 12);

  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.equal(result.inputs.laterStopAge, 55);
  assert.equal(result.early.contributeMonths, 120);
  assert.equal(result.early.coastMonths, 300);
  assert.equal(result.later.contributeMonths, 240);
  assert.equal(result.later.coastMonths, 60);
  assert.equal(result.early.totalContributed, 48000);
  assert.equal(result.later.totalContributed, 96000);
  assertApprox(result.early.valueAtStop, expectedEarlyStop, 1e-8);
  assertApprox(result.early.valueAtRetirement, expectedEarly, 1e-8);
  assertApprox(result.later.valueAtStop, expectedLaterStop, 1e-8);
  assertApprox(result.later.valueAtRetirement, expectedLater, 1e-8);

  const atLaterStop = result.projection.find((p) => p.age === 55);
  assertApprox(atLaterStop.later, expectedLaterStop, 1e-8);
  const last = result.projection[result.projection.length - 1];
  assert.equal(last.age, 60);
  assertApprox(last.later, result.later.valueAtRetirement, 1e-8);
});

test("omitting laterStopAge is the same as contributing through retirement", () => {
  const withExplicit = computeCostOfWaiting({ ...DEFAULT_INPUTS, laterStopAge: 65 });
  const omitted = { ...DEFAULT_INPUTS };
  delete omitted.laterStopAge;
  const without = computeCostOfWaiting(omitted);
  assert.equal(withExplicit.ok, true);
  assert.equal(without.ok, true);
  assert.equal(without.inputs.laterStopAge, 65);
  assertApprox(without.later.valueAtRetirement, withExplicit.later.valueAtRetirement, 1e-12);
  assert.equal(without.later.coastMonths, 0);
});

test("later investor can use a different monthly contribution", () => {
  const samePay = computeCostOfWaiting(DEFAULT_INPUTS);
  const inputs = {
    ...DEFAULT_INPUTS,
    earlyMonthlyContribution: 400,
    laterMonthlyContribution: 600
  };
  const result = computeCostOfWaiting(inputs);
  assert.equal(result.ok, true);
  assert.equal(result.early.totalContributed, 48000);
  assert.equal(result.later.totalContributed, 216000);
  assertApprox(result.early.valueAtRetirement, samePay.early.valueAtRetirement, 1e-8);
  assertApprox(result.later.valueAtRetirement, samePay.later.valueAtRetirement * 1.5, 1e-6);
  assert.equal(result.catchUpContribution.assumedContribution, 600);
  assertApprox(
    result.catchUpContribution.monthlyContribution,
    samePay.catchUpContribution.monthlyContribution,
    1e-6
  );
  assertApprox(result.catchUpContribution.increase, samePay.catchUpContribution.monthlyContribution - 600, 1e-6);

  const last = result.projection[result.projection.length - 1];
  assertApprox(last.later, result.later.valueAtRetirement, 1e-8);
});
