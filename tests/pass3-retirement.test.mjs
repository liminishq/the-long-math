import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateRetirementWithdrawal } from "../calculators/retirement-withdrawal-calculator/engine.js";

function assertApprox(actual, expected, tolerance = 1e-6, label = "") {
  const prefix = label ? `${label}: ` : "";
  assert.ok(Number.isFinite(actual), `${prefix}expected a finite number, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${prefix}expected ${expected}, got ${actual} (tolerance ${tolerance})`
  );
}

function assertYearlyIdentity(result, tolerance = 1e-6) {
  assert.equal(result.ok, true);
  for (const row of result.yearly) {
    assertApprox(
      row.starting + row.growth - row.withdrawals,
      row.ending,
      tolerance,
      `year ${row.year} start+growth-withdrawals`
    );
  }
}

function annualDollar(overrides = {}) {
  return {
    startingPortfolio: 100000,
    annualReturn: 0,
    retirementYears: 5,
    periodsPerYear: 1,
    withdrawalType: "dollar",
    periodicWithdrawal: 20000,
    initialWithdrawalRate: 0.04,
    withdrawalAdjustment: "fixed",
    inflationRate: 0,
    ...overrides
  };
}

test("exact end-at-zero at horizon is fullHorizon, not premature depletion", () => {
  const result = simulateRetirementWithdrawal(annualDollar());
  assert.equal(result.ok, true);
  assert.equal(result.fullHorizon, true);
  assert.equal(result.depleted, false);
  assert.equal(result.endsAtZero, true);
  assertApprox(result.finalNominal, 0, 1e-8);
  assertYearlyIdentity(result);
});

test("depletion mid-horizon is still depleted", () => {
  const result = simulateRetirementWithdrawal(annualDollar({ retirementYears: 10 }));
  assert.equal(result.ok, true);
  assert.equal(result.depleted, true);
  assert.equal(result.fullHorizon, false);
  assertApprox(result.depletionRetirementYears, 5, 1e-8);
  assertApprox(result.finalNominal, 0, 1e-8);
  assertYearlyIdentity(result);
});

test("yearly rows reconcile on a growth-and-depletion final row", () => {
  const result = simulateRetirementWithdrawal(
    annualDollar({
      startingPortfolio: 110,
      annualReturn: 0.1,
      retirementYears: 3,
      periodicWithdrawal: 200
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.depleted, true);
  const last = result.yearly[result.yearly.length - 1];
  assertApprox(last.starting, 110, 1e-8, "depletion-row start");
  assertApprox(last.growth, 11, 1e-8, "depletion-row growth");
  assertApprox(last.withdrawals, 121, 1e-8, "depletion-row withdrawal");
  assertApprox(last.ending, 0, 1e-8, "depletion-row end");
  assertYearlyIdentity(result);
});

test("inflation unused does not invalidate the fixed path", () => {
  const unused = simulateRetirementWithdrawal(
    annualDollar({
      withdrawalAdjustment: "fixed",
      inflationRate: Number.NaN,
      showInflationAdjustedValues: false
    })
  );
  assert.equal(unused.ok, true);
  assert.equal(unused.fullHorizon, true);

  const displayNeedsInflation = simulateRetirementWithdrawal(
    annualDollar({
      withdrawalAdjustment: "fixed",
      inflationRate: Number.NaN,
      showInflationAdjustedValues: true
    })
  );
  assert.equal(displayNeedsInflation.ok, false);

  const escalationNeedsInflation = simulateRetirementWithdrawal(
    annualDollar({
      withdrawalAdjustment: "inflation",
      inflationRate: Number.NaN,
      showInflationAdjustedValues: false
    })
  );
  assert.equal(escalationNeedsInflation.ok, false);
});

test("zero portfolio reports no starting withdrawal rate", () => {
  const result = simulateRetirementWithdrawal(
    annualDollar({ startingPortfolio: 0, periodicWithdrawal: 1000, retirementYears: 2 })
  );
  assert.equal(result.ok, true);
  assert.equal(result.inputs.startingWR, null);
});

test("requested years are stored separately from the period-rounded horizon", () => {
  const result = simulateRetirementWithdrawal(
    annualDollar({
      retirementYears: 1.08,
      periodsPerYear: 12,
      periodicWithdrawal: 100
    })
  );
  assert.equal(result.ok, true);
  assertApprox(result.inputs.requestedRetirementYears, 1.08, 1e-12);
  assertApprox(result.inputs.retirementYears, 13 / 12, 1e-12);
});
