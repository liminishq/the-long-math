/**
 * Pay off mortgage vs invest — mortgage-rate conversion checks.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
require(join(__dirname, "..", "calculators", "pay-off-mortgage-vs-invest", "engine.js"));

const engine = globalThis.PayOffMortgageVsInvestEngine;
assert.ok(engine, "PayOffMortgageVsInvestEngine should be exported on globalThis");

function assertApprox(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("monthly mortgage rate uses Canadian semi-annual conversion", () => {
  const monthlyRate = engine.canadianMortgagePeriodicRate(6, 12);
  assertApprox(monthlyRate, Math.pow(1 + 0.06 / 2, 1 / 6) - 1);
  assertApprox(monthlyRate, 0.004938622031196827, 1e-15);
  assert.ok(Math.abs(monthlyRate - 0.005) > 0.00001, "monthly rate should not be simple APR / 12");
});

test("computed mortgage payment uses Canadian monthly rate", () => {
  const payment = engine.calculateMortgagePayment(400_000, 6, 25, 12);
  const monthlyRate = Math.pow(1 + 0.06 / 2, 1 / 6) - 1;
  const expected = 400_000 * monthlyRate / (1 - Math.pow(1 + monthlyRate, -25 * 12));
  assertApprox(payment, expected);
});

test("zero-interest mortgage payment remains linear", () => {
  const payment = engine.calculateMortgagePayment(120_000, 0, 25, 12);
  assert.equal(payment, 400);
});

test("payoff search uses the same Canadian monthly rate as payment calculation", () => {
  const payment = engine.calculateMortgagePayment(400_000, 6, 25, 12);
  const payoffMonth = engine.findMortgagePayoffMonth({
    initialMortgageBalance: 400_000,
    mortgagePaymentPerPeriod: payment,
    extraCashPerPeriod: 0,
    allocationPercent: 100,
    annualRate: 6,
  });
  assert.equal(payoffMonth, 300);
});

test("underwater homes use signed equity in net worth and strategy comparisons", () => {
  const inputs = {
    mortgagePayment: 2_806,
    monthlyBudget: 3_306,
    extraCash: 500,
    allocationPercent: 50,
    expectedReturn: 7,
    fees: 0,
    timeHorizon: 5,
    homeGrowthRate: 0,
    useCalculator: false,
    currentBalance: 480_000,
    currentRate: 5,
    currentHomePrice: 400_000,
  };

  const underwater = engine.calculateMortgageVsInvest(inputs);
  const aboveWater = engine.calculateMortgageVsInvest({
    ...inputs,
    currentHomePrice: 1_000_000,
  });

  assert.equal(underwater.series[0].netWorth, -80_000);
  assertApprox(aboveWater.netWorth - underwater.netWorth, 600_000, 1e-8);
  assertApprox(aboveWater.fact100Mortgage - underwater.fact100Mortgage, 600_000, 1e-8);
  assertApprox(aboveWater.fact100Invest - underwater.fact100Invest, 600_000, 1e-8);
  assertApprox(
    underwater.breakEvenGrossReturnPercent,
    aboveWater.breakEvenGrossReturnPercent,
    1e-12,
  );

  const atBreakEven = engine.calculateMortgageVsInvest({
    ...inputs,
    expectedReturn: underwater.breakEvenGrossReturnPercent,
  });
  assertApprox(atBreakEven.fact100Mortgage, atBreakEven.fact100Invest, 1);
});

test("$480k at 5% with a $1000 monthly payment is rejected as non-amortizing", () => {
  const monthlyInterest = 480_000 * engine.canadianMortgagePeriodicRate(5, 12);
  assert.ok(monthlyInterest > 1_000);

  const simulation = engine.simulate({
    initialMortgageBalance: 480_000,
    mortgagePaymentPerPeriod: 1_000,
    extraCashPerPeriod: 0,
    allocationPercent: 100,
    annualRate: 5,
    horizonMonths: 12,
    monthlyReturn: 0,
    homePrice: 400_000,
    homeGrowthRate: 0,
  });
  assert.equal(simulation.errorCode, "non_amortizing_payment");
  assertApprox(simulation.interestDue, monthlyInterest);
  assert.equal(simulation.payment, 1_000);

  const payoffMonth = engine.findMortgagePayoffMonth({
    initialMortgageBalance: 480_000,
    mortgagePaymentPerPeriod: 1_000,
    extraCashPerPeriod: 0,
    allocationPercent: 100,
    annualRate: 5,
  });
  assert.equal(payoffMonth, null);

  const result = engine.calculateMortgageVsInvest({
    mortgagePayment: 1_000,
    monthlyBudget: 1_000,
    extraCash: 0,
    allocationPercent: 100,
    expectedReturn: 7,
    fees: 0,
    timeHorizon: 5,
    homeGrowthRate: 0,
    useCalculator: false,
    currentBalance: 480_000,
    currentRate: 5,
    currentHomePrice: 400_000,
  });
  assert.equal(result.errorCode, "non_amortizing_payment");
  assertApprox(result.interestDue, monthlyInterest);
});

test("a start-of-horizon lump sum can fully clear the mortgage", () => {
  const payoffMonth = engine.findMortgagePayoffMonth({
    initialMortgageBalance: 100_000,
    mortgagePaymentPerPeriod: 0,
    extraCashPerPeriod: 0,
    allocationPercent: 0,
    annualRate: 5,
    lumpSumAtStart: 100_000,
  });
  assert.equal(payoffMonth, 1);
});

test("mortgage cash paid equals principal plus interest actually paid", () => {
  const result = engine.simulate({
    initialMortgageBalance: 480_000,
    mortgagePaymentPerPeriod: 2_806,
    extraCashPerPeriod: 0,
    allocationPercent: 100,
    annualRate: 5,
    horizonMonths: 1,
    monthlyReturn: 0,
    homePrice: 600_000,
    homeGrowthRate: 0,
  });

  assertApprox(
    result.totalMortgageCashPaid,
    result.totalPrincipalPaid + result.totalInterestPaid,
  );
  assertApprox(result.totalMortgageCashPaid, 2_806);
  assertApprox(480_000 - result.finalBalance, result.totalPrincipalPaid, 1e-9);
});

test("full monthly budget is still invested after payoff", () => {
  const result = engine.simulate({
    initialMortgageBalance: 1_000,
    mortgagePaymentPerPeriod: 600,
    extraCashPerPeriod: 400,
    allocationPercent: 100,
    annualRate: 0,
    horizonMonths: 3,
    monthlyReturn: 0,
    homePrice: 1_000,
    homeGrowthRate: 0,
  });

  assert.equal(result.payoffMonth, 2);
  assert.equal(result.finalBalance, 0);
  assert.equal(result.finalInvestValue, 2_000);
  assert.equal(result.series[2].investValue, 1_000);
  assert.equal(result.series[3].investValue, 2_000);
});
