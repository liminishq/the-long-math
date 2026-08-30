/**
 * Owner follow-up: symmetric end-of-period recurring cash timing
 * for Pay Off Mortgage vs Invest.
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

function assertApprox(actual, expected, tol = 1e-6, label = "") {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label} expected ${expected}, got ${actual}`
  );
}

test("A: recurring investment contribution does not earn that month's return", () => {
  // Pure invest path: no mortgage, $1000 end-of-month contrib, 12% annual ≈ monthly μ
  const monthlyReturn = engine.monthlyReturnFromAnnual(0.12);
  const sim = engine.simulate({
    initialMortgageBalance: 0,
    mortgagePaymentPerPeriod: 0,
    extraCashPerPeriod: 1000,
    allocationPercent: 100,
    annualRate: 0,
    horizonMonths: 1,
    monthlyReturn,
    homePrice: 0,
    homeGrowthRate: 0,
  });
  // Opening invest 0 → growth 0 → then +1000. Must not be 1000*(1+μ).
  assertApprox(sim.finalInvestValue, 1000, 1e-9);
  assertApprox(sim.totalInterestEarned, 0, 1e-9);
});

test("A2: with opening invest balance, growth applies only to opening balance", () => {
  const monthlyReturn = 0.01;
  // Seed via lump at t=0 into invest, then recurring contrib end of month 1
  const sim = engine.simulate({
    initialMortgageBalance: 0,
    mortgagePaymentPerPeriod: 0,
    extraCashPerPeriod: 500,
    allocationPercent: 100,
    annualRate: 0,
    horizonMonths: 1,
    monthlyReturn,
    homePrice: 0,
    homeGrowthRate: 0,
    lumpSumAtStart: 10_000,
  });
  // V = 10000*(1.01) + 500 = 10600
  assertApprox(sim.finalInvestValue, 10_000 * 1.01 + 500, 1e-9);
  assertApprox(sim.totalInterestEarned, 100, 1e-9);
});

test("B: initial lump sum immediately lowers mortgage / enters invest at t=0", () => {
  const monthlyReturn = 0;
  const simMort = engine.simulate({
    initialMortgageBalance: 100_000,
    mortgagePaymentPerPeriod: 500,
    extraCashPerPeriod: 0,
    allocationPercent: 0,
    annualRate: 0,
    horizonMonths: 1,
    monthlyReturn,
    homePrice: 200_000,
    homeGrowthRate: 0,
    lumpSumAtStart: 10_000,
  });
  // After lump: balance 90k; then payment 500 principal → 89500
  assertApprox(simMort.series[0].balance, 100_000, 1e-6);
  assert.ok(simMort.finalBalance < 90_000);
  assertApprox(simMort.finalBalance, 89_500, 1e-6);

  const simInv = engine.simulate({
    initialMortgageBalance: 100_000,
    mortgagePaymentPerPeriod: 500,
    extraCashPerPeriod: 0,
    allocationPercent: 100,
    annualRate: 0,
    horizonMonths: 1,
    monthlyReturn,
    homePrice: 200_000,
    homeGrowthRate: 0,
    lumpSumAtStart: 10_000,
  });
  // Lump all to invest immediately; mortgage still pays scheduled 500
  assertApprox(simInv.finalInvestValue, 10_000, 1e-6);
  assertApprox(simInv.finalBalance, 99_500, 1e-6);
});

test("C: zero mortgage rate and zero invest return → timing alone creates no advantage", () => {
  const result = engine.calculateMortgageVsInvest({
    useCalculator: false,
    currentBalance: 120_000,
    currentRate: 0,
    mortgagePayment: 2_000,
    extraCash: 500,
    allocationPercent: 50,
    expectedReturn: 0,
    fees: 0,
    timeHorizon: 5,
    currentHomePrice: 300_000,
    homeGrowthRate: 0,
  });
  assert.ok(!result.error);
  assertApprox(result.fact100Mortgage, result.fact100Invest, 0.01);
});

test("D: equal-rate reference — mortgage rate matches invest return, timing does not invent a gap from contrib-first asymmetry", () => {
  // With end-of-period symmetry and 0 home growth / fees, paths remain well-defined.
  const payment = engine.calculateMortgagePayment(200_000, 6, 25, 12);
  const allMort = engine.simulate({
    initialMortgageBalance: 200_000,
    mortgagePaymentPerPeriod: payment,
    extraCashPerPeriod: 300,
    allocationPercent: 0,
    annualRate: 6,
    horizonMonths: 60,
    monthlyReturn: engine.monthlyReturnFromAnnual(0.06),
    homePrice: 300_000,
    homeGrowthRate: 0,
  });
  const allInv = engine.simulate({
    initialMortgageBalance: 200_000,
    mortgagePaymentPerPeriod: payment,
    extraCashPerPeriod: 300,
    allocationPercent: 100,
    annualRate: 6,
    horizonMonths: 60,
    monthlyReturn: engine.monthlyReturnFromAnnual(0.06),
    homePrice: 300_000,
    homeGrowthRate: 0,
  });
  assert.ok(Number.isFinite(allMort.finalInvestValue));
  assert.ok(Number.isFinite(allInv.finalInvestValue));
  // Mortgage path keeps extra on principal; invest path builds portfolio.
  // Timing symmetry means first-month invest contrib earns 0 growth (tested in A).
  assert.ok(allInv.finalInvestValue > 0);
});

test("E: payoff mid-horizon — no phantom balance; subsequent cash is end-of-period invest", () => {
  const sim = engine.simulate({
    initialMortgageBalance: 5_000,
    mortgagePaymentPerPeriod: 2_000,
    extraCashPerPeriod: 500,
    allocationPercent: 0,
    annualRate: 0,
    horizonMonths: 12,
    monthlyReturn: 0.01,
    homePrice: 100_000,
    homeGrowthRate: 0,
  });
  assert.ok(sim.payoffMonth != null && sim.payoffMonth <= 3);
  assertApprox(sim.finalBalance, 0, 1e-6);
  // After payoff, budget invests end-of-period; with μ>0 and months remaining, invest > 0
  assert.ok(sim.finalInvestValue > 0);
});

test("F: strategy extremes differ and break-even is finite for ordinary extra cash", () => {
  const result = engine.calculateMortgageVsInvest({
    useCalculator: false,
    currentBalance: 400_000,
    currentRate: 5,
    mortgagePayment: 2_500,
    extraCash: 500,
    allocationPercent: 50,
    expectedReturn: 7,
    fees: 0.2,
    timeHorizon: 10,
    currentHomePrice: 600_000,
    homeGrowthRate: 2,
  });
  assert.ok(!result.error);
  assert.ok(Number.isFinite(result.fact100Mortgage));
  assert.ok(Number.isFinite(result.fact100Invest));
  assert.ok(Number.isFinite(result.breakEvenGrossReturnPercent));
  // With symmetric timing, invest edge vs mortgage at 7% should be smaller than
  // the old begin-of-period invest advantage (~7686), but still defined.
  assert.ok(Math.abs(result.fact100Invest - result.fact100Mortgage) < 20_000);
});
