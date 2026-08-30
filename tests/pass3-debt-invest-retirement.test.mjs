/**
 * Pass 3 medium findings — debt, invest, retirement edge cases.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  simulateRetirementWithdrawal,
  WITHDRAWAL_ADJUSTMENTS
} from "../calculators/retirement-withdrawal-calculator/engine.js";
import { applyCorporateTaxDataSnapshot } from "../calculators/ccpc-tax/js/corporate.data.js";
import { calculateCorporateTax } from "../calculators/ccpc-tax/js/corporate.engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

require(join(root, "calculators/mortgage-calculator/mortgage-engine.js"));
const ME = globalThis.MortgageEngine;

globalThis.window = globalThis;
require(join(root, "calculators/pay-off-mortgage-vs-invest/engine.js"));
const payOff = globalThis.PayOffMortgageVsInvestEngine;

await import(pathToFileURL(join(root, "assets/js/investment-growth.engine.js")).href);
const Invest = globalThis.InvestmentGrowthEngine;

require(join(root, "calculators/inflation-time-machine/engine.js"));
const ITM = globalThis.InflationTimeMachine;

test("mortgage final schedule payment equals interest + principal when clamped", () => {
  const data = ME.computeSchedule(10_000, 5, 1, "monthly");
  assert.equal(data.isValid, true);
  const last = data.schedule[data.schedule.length - 1];
  assert.ok(last);
  assert.ok(
    Math.abs(last.paymentAmount - (last.interestPortion + last.principalPortion)) < 1e-9,
    `final payment ${last.paymentAmount} != interest+principal`
  );
  assert.ok(last.balance <= 1e-6);
});

test("pay-off: explicit zero mortgage balance does not invent a phantom loan", () => {
  const result = payOff.calculateMortgageVsInvest({
    useCalculator: false,
    currentBalance: 0,
    currentRate: 5,
    mortgagePayment: 2500,
    extraCash: 500,
    allocationPercent: 50,
    expectedReturn: 7,
    fees: 0.2,
    timeHorizon: 10,
    currentHomePrice: 600000,
    homeGrowth: 2,
    lumpSumAtStart: 0,
  });
  assert.ok(!result.error, result.error || "ok");
  assert.ok(
    (result.mortgageBalance ?? result.finalBalance ?? 0) <= 1e-6,
    "explicit zero balance must stay debt-free"
  );
});

test("inflation time machine reverse ranges require both endpoints in coverage", () => {
  const meta = { startYear: 2000, endYear: 2020 };
  assert.equal(ITM.isRangeAvailable(meta, 2010, 2015), true);
  assert.equal(ITM.isRangeAvailable(meta, 2015, 2010), true);
  assert.equal(ITM.isRangeAvailable(meta, 1990, 2010), false);
  assert.equal(ITM.isRangeAvailable(meta, 2010, 1990), false);
  assert.equal(ITM.isRangeAvailable(meta, 2010, 2025), false);
  assert.equal(ITM.isRangeAvailable(meta, 2025, 2010), false);
});

test("investment growth rejects returns at or below -100%", () => {
  const bad = Invest.simulateInvestment({
    startingAmount: 10000,
    contributionPerPeriod: 0,
    years: 10,
    nominalAnnualReturn: -1,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    indexContributionsToInflation: false,
  });
  assert.ok(bad.error, "expected error for -100% return");
});

test("retirement: exact end-at-horizon zero is fullHorizon, not premature", () => {
  const sim = simulateRetirementWithdrawal({
    startingPortfolio: 120000,
    annualReturn: 0,
    retirementYears: 10,
    periodsPerYear: 1,
    withdrawalType: "dollar",
    periodicWithdrawal: 12000,
    withdrawalAdjustment: WITHDRAWAL_ADJUSTMENTS.FIXED,
    inflationRate: 0,
  });
  assert.equal(sim.ok, true);
  assert.equal(sim.fullHorizon, true);
  assert.equal(sim.prematureDepletion ?? sim.depleted, false);
  assert.ok(sim.finalNominal <= 1e-6);
});

test("retirement: yearly rows reconcile start + growth - withdrawals = ending", () => {
  const sim = simulateRetirementWithdrawal({
    startingPortfolio: 500000,
    annualReturn: 0.05,
    retirementYears: 25,
    periodsPerYear: 12,
    withdrawalType: "rate",
    initialWithdrawalRate: 0.04,
    withdrawalAdjustment: WITHDRAWAL_ADJUSTMENTS.INFLATION,
    inflationRate: 0.02,
    showInflationAdjustedValues: true,
  });
  assert.equal(sim.ok, true);
  for (const row of sim.yearly) {
    if (row.year === 0) continue;
    const recon = row.starting + row.growth - row.withdrawals;
    assert.ok(
      Math.abs(recon - row.ending) < 1e-6,
      `year ${row.year}: ${recon} !== ${row.ending}`
    );
  }
});

test("retirement: mid-horizon depletion is premature", () => {
  const sim = simulateRetirementWithdrawal({
    startingPortfolio: 100000,
    annualReturn: 0,
    retirementYears: 30,
    periodsPerYear: 1,
    withdrawalType: "dollar",
    periodicWithdrawal: 20000,
    withdrawalAdjustment: WITHDRAWAL_ADJUSTMENTS.FIXED,
    inflationRate: 0,
  });
  assert.equal(sim.ok, true);
  assert.equal(sim.fullHorizon, false);
  assert.equal(sim.depleted, true);
  assert.ok(sim.depletionRetirementYears < 30);
});

test("retirement: unused extreme inflation does not invalidate fixed path", () => {
  const sim = simulateRetirementWithdrawal({
    startingPortfolio: 200000,
    annualReturn: 0.04,
    retirementYears: 5,
    periodsPerYear: 12,
    withdrawalType: "dollar",
    periodicWithdrawal: 1000,
    withdrawalAdjustment: WITHDRAWAL_ADJUSTMENTS.FIXED,
    inflationRate: -0.999,
    showInflationAdjustedValues: false,
  });
  assert.equal(sim.ok, true);
});

test("CCPC corporate API floors negative taxable income at zero", () => {
  const data = join(root, "calculators/ccpc-tax/data/2026");
  const federal = JSON.parse(readFileSync(join(data, "federal-corporate.json"), "utf8"));
  const provinces = JSON.parse(readFileSync(join(data, "provinces-corporate.json"), "utf8"));
  applyCorporateTaxDataSnapshot({ federal, provinces });
  const result = calculateCorporateTax(-50000, "ON", {});
  assert.ok(result.totalCorporateTax >= 0);
  assert.equal(result.taxableIncome, 0);
});
