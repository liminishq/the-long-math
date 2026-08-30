import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annualToPeriodic,
  simulateRetirementWithdrawal
} from "../calculators/retirement-withdrawal-calculator/engine.js";

function assertApprox(actual, expected, tolerance = 1e-6, label = "") {
  const prefix = label ? `${label}: ` : "";
  assert.ok(Number.isFinite(actual), `${prefix}expected a finite number, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${prefix}expected ${expected}, got ${actual} (tolerance ${tolerance})`
  );
}

function dollarInputs(overrides = {}) {
  return {
    startingPortfolio: 500000,
    annualReturn: 0.05,
    retirementYears: 3,
    periodsPerYear: 12,
    withdrawalType: "dollar",
    periodicWithdrawal: 2000,
    initialWithdrawalRate: 0.04,
    withdrawalAdjustment: "inflation",
    inflationRate: 0.025,
    ...overrides
  };
}

function balanceAfterYear(startingBalance, annualReturn, periodsPerYear, periodicWithdrawal) {
  const periodicReturn = annualToPeriodic(annualReturn, periodsPerYear);
  let balance = startingBalance;
  for (let period = 0; period < periodsPerYear; period += 1) {
    balance = balance * (1 + periodicReturn) - periodicWithdrawal;
  }
  return balance;
}

test("inflation adjustment escalates dollar withdrawals annually and deducts them", () => {
  const result = simulateRetirementWithdrawal(dollarInputs());
  assert.equal(result.ok, true);
  assertApprox(result.yearly[1].withdrawals, 24000, 1e-8, "year 1 withdrawals");
  assertApprox(result.yearly[2].withdrawals, 24600, 1e-8, "year 2 withdrawals");
  assertApprox(result.yearly[3].withdrawals, 25215, 1e-8, "year 3 withdrawals");

  const expectedYear1Ending = balanceAfterYear(500000, 0.05, 12, 2000);
  const expectedYear2Ending = balanceAfterYear(expectedYear1Ending, 0.05, 12, 2050);
  const expectedYear3Ending = balanceAfterYear(expectedYear2Ending, 0.05, 12, 2101.25);
  assertApprox(result.yearly[1].ending, expectedYear1Ending, 1e-8, "year 1 ending");
  assertApprox(result.yearly[2].ending, expectedYear2Ending, 1e-8, "year 2 ending");
  assertApprox(result.yearly[3].ending, expectedYear3Ending, 1e-8, "year 3 ending");
});

test("fixed adjustment preserves the same nominal dollar withdrawal", () => {
  const result = simulateRetirementWithdrawal(
    dollarInputs({ withdrawalAdjustment: "fixed" })
  );
  assert.equal(result.ok, true);
  assertApprox(result.yearly[1].withdrawals, 24000, 1e-8);
  assertApprox(result.yearly[2].withdrawals, 24000, 1e-8);
  assertApprox(result.yearly[3].withdrawals, 24000, 1e-8);
});

test("initial withdrawal rate is applied once to the starting portfolio", () => {
  const result = simulateRetirementWithdrawal({
    ...dollarInputs(),
    withdrawalType: "rate",
    initialWithdrawalRate: 0.04
  });
  assert.equal(result.ok, true);
  assertApprox(result.inputs.annualWithdrawal, 20000, 1e-8);
  assertApprox(result.yearly[1].withdrawals, 20000, 1e-8);
  assertApprox(result.yearly[2].withdrawals, 20500, 1e-8);
  assertApprox(result.yearly[3].withdrawals, 21012.5, 1e-8);
  assert.notEqual(
    result.yearly[2].withdrawals,
    result.yearly[1].ending * 0.04,
    "rate must not be recalculated from the changing balance"
  );
});

test("zero inflation leaves inflation-adjusted withdrawals unchanged", () => {
  const result = simulateRetirementWithdrawal(
    dollarInputs({ inflationRate: 0, withdrawalAdjustment: "inflation" })
  );
  assert.equal(result.ok, true);
  assertApprox(result.yearly[1].withdrawals, 24000, 1e-8);
  assertApprox(result.yearly[2].withdrawals, 24000, 1e-8);
  assertApprox(result.yearly[3].withdrawals, 24000, 1e-8);
});

test("display preference does not change nominal cash flows or depletion math", () => {
  const withRealDisplay = simulateRetirementWithdrawal(
    dollarInputs({ showInflationAdjustedValues: true })
  );
  const withoutRealDisplay = simulateRetirementWithdrawal(
    dollarInputs({ showInflationAdjustedValues: false })
  );
  assert.equal(withRealDisplay.ok, true);
  assert.equal(withoutRealDisplay.ok, true);
  assert.deepEqual(withRealDisplay.yearly, withoutRealDisplay.yearly);
  assert.equal(withRealDisplay.finalNominal, withoutRealDisplay.finalNominal);
  assert.equal(
    withRealDisplay.depletionRetirementYears,
    withoutRealDisplay.depletionRetirementYears
  );
});

test("all periods in a year use that year's inflation-adjusted amount", () => {
  const quarterly = simulateRetirementWithdrawal(
    dollarInputs({ periodsPerYear: 4, periodicWithdrawal: 6000 })
  );
  assert.equal(quarterly.ok, true);
  assertApprox(quarterly.yearly[1].withdrawals, 24000, 1e-8);
  assertApprox(quarterly.yearly[2].withdrawals, 24600, 1e-8);
  assertApprox(quarterly.yearly[3].withdrawals, 25215, 1e-8);
});
