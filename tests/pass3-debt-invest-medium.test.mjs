/**
 * Pass 3 engine-level checks: mortgage final payment, pay-off zero balance,
 * inflation reverse-range availability, and investment return floor.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

require(join(root, "calculators", "mortgage-calculator", "mortgage-engine.js"));
globalThis.window = globalThis;
require(join(root, "calculators", "pay-off-mortgage-vs-invest", "engine.js"));
require(join(root, "calculators", "inflation-time-machine", "engine.js"));
await import(pathToFileURL(join(root, "assets", "js", "investment-growth.engine.js")).href);

const ME = globalThis.MortgageEngine;
const payOff = globalThis.PayOffMortgageVsInvestEngine;
const Infl = globalThis.InflationTimeMachine;
const Growth = globalThis.InvestmentGrowthEngine;

assert.ok(ME, "MortgageEngine should load");
assert.ok(payOff, "PayOffMortgageVsInvestEngine should load");
assert.ok(Infl, "InflationTimeMachine should load");
assert.ok(Growth, "InvestmentGrowthEngine should load");

function assertApprox(actual, expected, tolerance = 1e-8, label = "value") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

test("mortgage final schedule payment equals interest + principal when clamped", () => {
  const r = ME.computeSchedule(10_000, 5, 1, "monthly");
  assert.equal(r.isValid, true);
  assert.ok(r.schedule.length > 1);
  const last = r.schedule[r.schedule.length - 1];
  assertApprox(last.paymentAmount, last.interestPortion + last.principalPortion, 1e-9, "final payment");
  assertApprox(last.balance, 0, 1e-6, "final balance");

  const contractual = ME.calculatePaymentAmount(10_000, 5, 1, "monthly");
  assert.ok(last.paymentAmount <= contractual + 1e-8);

  const summedPayments = r.schedule.reduce((sum, row) => sum + row.paymentAmount, 0);
  assertApprox(summedPayments, r.totalPaid, 1e-6, "schedule sum vs totalPaid");
});

test("pay-off: explicit balance 0 does not invent a mortgage", () => {
  const result = payOff.calculateMortgageVsInvest({
    mortgagePayment: 2_806,
    monthlyBudget: 3_306,
    extraCash: 500,
    allocationPercent: 50,
    expectedReturn: 7,
    fees: 0,
    timeHorizon: 5,
    homeGrowthRate: 0,
    useCalculator: false,
    currentBalance: 0,
    currentRate: 5,
    currentHomePrice: 600_000,
  });

  assert.ok(!result.error, result.error || "no error");
  assert.equal(result.payoffMonth, 0);
  assert.equal(result.mortgageBalance, 0);
  assert.equal(result.totalInterestPaid, 0);
  const opening = result.series[0];
  assert.equal(opening.balance, 0);
  assert.ok(opening.netWorth >= 0);
});

test("inflation reverse range availability checks both endpoints", () => {
  const uk = { startYear: 1988, endYear: 2025 };
  assert.equal(Infl.availability(uk, 1914, 2024), false);
  assert.equal(Infl.isRangeAvailable(uk, 2024, 1914), false);
  assert.equal(Infl.availability(uk, 1990, 2020), true);
  assert.equal(Infl.isRangeAvailable(uk, 2020, 1990), true);
  assert.equal(Infl.currencySymbolFor({ code: "GBR" }), "£");
  assert.equal(Infl.currencySymbolFor({ code: "CAN" }), "$");
  assert.equal(Infl.currencySymbolFor({ currencySymbol: "€", code: "FRA" }), "€");
});

test("investment return ≤ -100% is rejected", () => {
  const base = {
    startingAmount: 10_000,
    contributionPerPeriod: 100,
    years: 10,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
  };

  const atFloor = Growth.simulateInvestment({ ...base, nominalAnnualReturn: -1 });
  assert.ok(atFloor.error);
  assert.match(atFloor.error, /-100%/);
  assert.equal(atFloor.finalBalanceReal, undefined);

  const below = Growth.simulateInvestment({ ...base, nominalAnnualReturn: -1.5 });
  assert.ok(below.error);

  const mildDeflation = Growth.simulateInvestment({
    ...base,
    nominalAnnualReturn: 0.07,
    inflationAnnual: -0.01,
  });
  const zeroInflation = Growth.simulateInvestment({
    ...base,
    nominalAnnualReturn: 0.07,
    inflationAnnual: 0,
  });
  assert.ok(!mildDeflation.error);
  assert.ok(Number.isFinite(mildDeflation.finalBalanceReal));
  assert.notEqual(mildDeflation.finalBalanceReal, zeroInflation.finalBalanceReal);

  const deadInflation = Growth.simulateInvestment({
    ...base,
    nominalAnnualReturn: 0.07,
    inflationAnnual: -1,
  });
  assert.ok(deadInflation.error);
  assert.match(deadInflation.error, /Inflation/);
});
