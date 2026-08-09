import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineUrl = pathToFileURL(join(root, "assets", "js", "investment-growth.engine.js")).href;

await import(engineUrl);

const Engine = globalThis.InvestmentGrowthEngine;
assert.ok(Engine, "InvestmentGrowthEngine should be on globalThis");

test("zero return: ending equals starting plus contributions (real, indexed)", () => {
  const result = Engine.simulateInvestment({
    startingAmount: 10000,
    contributionPerPeriod: 500,
    years: 5,
    nominalAnnualReturn: 0,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
  });
  assert.equal(result.finalBalanceReal, 10000 + 500 * 60);
});

test("solveRequiredNominalReturn inverts forward simulation", () => {
  const forward = Engine.simulateInvestment({
    startingAmount: 20000,
    contributionPerPeriod: 500,
    years: 25,
    nominalAnnualReturn: 0.07,
    inflationAnnual: 0.025,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
  });

  const solved = Engine.solveRequiredNominalReturn({
    startingAmount: 20000,
    contributionPerPeriod: 500,
    years: 25,
    inflationAnnual: 0.025,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
    targetBalanceReal: forward.finalBalanceReal,
  });

  assert.ok(!solved.error);
  assert.ok(Math.abs(solved.nominalAnnualReturn - 0.07) < 0.0005);
  assert.ok(Math.abs(solved.projectedFinalReal - forward.finalBalanceReal) < 1);
});

test("fractional years keep exact horizon; contribution dates stay inside Y", () => {
  const monthly = Engine.simulateInvestment({
    startingAmount: 0,
    contributionPerPeriod: 1000,
    years: 9.5,
    nominalAnnualReturn: 0,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
  });
  assert.equal(monthly.years, 9.5);
  assert.equal(monthly.periods, 114);
  assert.equal(monthly.finalBalanceReal, 1000 * 114);

  const yearly = Engine.simulateInvestment({
    startingAmount: 100000,
    contributionPerPeriod: 0,
    years: 9.5,
    nominalAnnualReturn: 0.07,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 1,
    contributionAtBeginning: false,
  });
  assert.equal(yearly.years, 9.5);
  assert.ok(Math.abs(yearly.finalBalanceReal - 100000 * Math.pow(1.07, 9.5)) < 1e-6);
});

test("zero-contribution fractional horizon ignores contribution frequency", () => {
  const expected = Math.pow(2, 1 / 9.5) - 1;
  for (const m of [1, 12]) {
    for (const beginning of [false, true]) {
      const solved = Engine.solveRequiredNominalReturn({
        startingAmount: 100000,
        contributionPerPeriod: 0,
        years: 9.5,
        inflationAnnual: 0,
        contributionPeriodsPerYear: m,
        contributionAtBeginning: beginning,
        targetBalanceReal: 200000,
      });
      assert.ok(Math.abs(solved.nominalAnnualReturn - expected) < 1e-7);
    }
  }
});

test("goal solver and forward simulator match on fractional horizon", () => {
  const inputs = {
    startingAmount: 975000,
    contributionPerPeriod: 6000,
    years: 9.5,
    inflationAnnual: 0.023,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: true,
    indexContributionsToInflation: true,
  };
  const solved = Engine.solveRequiredNominalReturn(Object.assign({}, inputs, {
    targetBalanceReal: 4600000,
  }));
  const forward = Engine.simulateInvestment(Object.assign({}, inputs, {
    nominalAnnualReturn: solved.nominalAnnualReturn,
  }));
  assert.ok(Math.abs(forward.finalBalanceReal - 4600000) < 1);
  assert.ok(Math.abs(forward.finalBalanceNominal - 4600000 * Math.pow(1.023, 9.5)) < 1);
  assert.equal(forward.years, 9.5);
});

test("indexed vs flat nominal contributions differ over long horizons", () => {
  const indexed = Engine.simulateInvestment({
    startingAmount: 0,
    contributionPerPeriod: 1000,
    years: 20,
    nominalAnnualReturn: 0.07,
    inflationAnnual: 0.025,
    contributionPeriodsPerYear: 12,
    indexContributionsToInflation: true,
  });
  const flatNominal = Engine.simulateInvestment({
    startingAmount: 0,
    contributionPerPeriod: 1000,
    years: 20,
    nominalAnnualReturn: 0.07,
    inflationAnnual: 0.025,
    contributionPeriodsPerYear: 12,
    indexContributionsToInflation: false,
  });
  assert.ok(indexed.finalBalanceReal > flatNominal.finalBalanceReal);
});

function closedFormFv(P0, PMT, periodsPerYear, years, rAnnual) {
  const N = Math.round(periodsPerYear * years);
  if (N <= 0) return P0;
  const i = Math.pow(1 + rAnnual, 1 / periodsPerYear) - 1;
  if (Math.abs(i) < 1e-15) return P0 + PMT * N;
  const growth = Math.pow(1 + i, N);
  return P0 * growth + PMT * ((growth - 1) / i);
}

test("weekly and biweekly frequencies match closed-form ordinary annuity", () => {
  for (const ppy of [26, 52]) {
    const result = Engine.simulateInvestment({
      startingAmount: 10000,
      contributionPerPeriod: 200,
      years: 10,
      nominalAnnualReturn: 0.07,
      inflationAnnual: 0,
      contributionPeriodsPerYear: ppy,
      contributionAtBeginning: false,
      indexContributionsToInflation: true,
    });
    const expected = closedFormFv(10000, 200, ppy, 10, 0.07);
    assert.equal(result.contributionPeriodsPerYear, ppy);
    assert.ok(Math.abs(result.finalBalanceReal - expected) < 1e-6);
  }
});

test("zero horizon returns starting balance only", () => {
  const result = Engine.simulateInvestment({
    startingAmount: 50000,
    contributionPerPeriod: 1000,
    years: 0,
    nominalAnnualReturn: 0.08,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
  });
  assert.equal(result.periods, 0);
  assert.equal(result.finalBalanceReal, 50000);
  assert.equal(result.totalContributions, 0);
});

test("real mode matches closed form at Fisher real return", () => {
  const rNom = 0.07;
  const infl = 0.025;
  const rReal = (1 + rNom) / (1 + infl) - 1;
  const result = Engine.simulateInvestment({
    startingAmount: 25000,
    contributionPerPeriod: 500,
    years: 15,
    nominalAnnualReturn: rNom,
    inflationAnnual: infl,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
  });
  const expected = closedFormFv(25000, 500, 12, 15, rReal);
  assert.ok(Math.abs(result.finalBalanceReal - expected) < 1e-4);
});
