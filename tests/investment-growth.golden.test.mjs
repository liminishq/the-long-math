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
