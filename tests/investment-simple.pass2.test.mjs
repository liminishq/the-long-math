/**
 * Pass 2: Simple Investment keeps contributions fixed in nominal dollars.
 * Real mode is a display conversion of that same path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(join(root, "assets", "js", "investment-growth.engine.js")).href);

const Engine = globalThis.InvestmentGrowthEngine;

const SIMPLE_DEFAULTS = {
  startingAmount: 10_000,
  contributionPerPeriod: 500,
  years: 25,
  nominalAnnualReturn: 0.07,
  contributionPeriodsPerYear: 12,
  contributionAtBeginning: false,
  indexContributionsToInflation: false,
};

test("Simple Investment real path uses fixed nominal contributions, not indexed deposits", () => {
  const indexed = Engine.simulateInvestment({
    ...SIMPLE_DEFAULTS,
    inflationAnnual: 0.025,
    indexContributionsToInflation: true,
  });
  const fixed = Engine.simulateInvestment({
    ...SIMPLE_DEFAULTS,
    inflationAnnual: 0.025,
  });
  const nominal = Engine.simulateInvestment({
    ...SIMPLE_DEFAULTS,
    inflationAnnual: 0,
  });

  assert.ok(Math.abs(fixed.finalBalanceReal - 240457.77181243207) < 1e-6);
  assert.ok(Math.abs(indexed.finalBalanceReal - 297960.41527583153) < 1e-6);
  assert.ok(indexed.finalBalanceReal - fixed.finalBalanceReal > 50_000);

  const deflatedNominal = nominal.finalBalanceNominal / Math.pow(1.025, 25);
  assert.ok(Math.abs(fixed.finalBalanceReal - deflatedNominal) < 1e-6);
  assert.ok(Math.abs(fixed.finalBalanceNominal - nominal.finalBalanceNominal) < 1e-6);
  assert.equal(fixed.totalContributionsNominal, 150_000);
  assert.ok(fixed.totalContributions < 150_000);
});

test("zero-start $500/month 25y 7% 2.5% inflation: fixed-nominal real ending is about $211,183", () => {
  const result = Engine.simulateInvestment({
    ...SIMPLE_DEFAULTS,
    startingAmount: 0,
    inflationAnnual: 0.025,
  });
  assert.ok(Math.abs(result.finalBalanceReal - 211182.71090291083) < 1e-6);
});
