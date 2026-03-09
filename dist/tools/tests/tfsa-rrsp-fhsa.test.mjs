import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const engineUrl = pathToFileURL(join(root, "calculators", "tfsa-rrsp-fhsa", "engine.js")).href;

const { runAccountStrategySimulation } = await import(engineUrl);

function getStrategy(result, key) {
  const s = result.strategies[key];
  assert.ok(s, `Missing strategy ${key}`);
  return s;
}

// 1) r=0, f=0, refund spent: TFSA should equal total contributions; RRSP after-tax should be contributions*(1-t_ret)
test("lump sum, zero growth, refund spent – TFSA vs RRSP arithmetic", () => {
  const C = 10000;
  const horizonYears = 10;
  const tRet = 40;

  const result = runAccountStrategySimulation({
    contributionMode: "lump",
    contributionAmount: C,
    horizonYears,
    annualReturn: 0,
    annualFees: 0,
    useRealDollars: false,
    t_now: 30,
    t_ret: tRet,
    refundMode: "spend",
    fhsaEligible: false
  });

  const tfsa = getStrategy(result, "ALL_TFSA");
  const rrsp = getStrategy(result, "ALL_RRSP");

  assert.ok(Math.abs(tfsa.finalAfterTax - C) < 1e-6, "TFSA should equal total contributions when r=0,f=0");

  const expectedRrsp = C * (1 - tRet / 100);
  assert.ok(
    Math.abs(rrsp.finalAfterTax - expectedRrsp) < 1e-6,
    `RRSP after-tax should be contributions*(1-t_ret); expected ${expectedRrsp}, got ${rrsp.finalAfterTax}`
  );
});

// 2) With refund reinvested and equal non-zero t_now=t_ret, RRSP should not be worse than TFSA for a lump sum.
//    Under this engine's cash-definition, RRSP generally dominates TFSA in this configuration.
test("lump sum, equal non-zero tax rates, refund reinvested – RRSP at least as strong as TFSA", () => {
  const C = 15000;

  const result = runAccountStrategySimulation({
    contributionMode: "lump",
    contributionAmount: C,
    horizonYears: 20,
    annualReturn: 5,
    annualFees: 0,
    useRealDollars: false,
    t_now: 40,
    t_ret: 40,
    refundMode: "reinvest",
    fhsaEligible: false
  });

  const tfsa = getStrategy(result, "ALL_TFSA");
  const rrsp = getStrategy(result, "ALL_RRSP");

  assert.ok(
    rrsp.finalAfterTax >= tfsa.finalAfterTax - 1e-6,
    "With refund reinvested and equal non-zero tax rates, RRSP should not be worse than TFSA for a lump sum."
  );
});

// 3) FHSA home-qualified should dominate RRSP given same inputs when eligible and room not binding
test("FHSA home-qualified dominates RRSP when room not binding", () => {
  const C = 5000;

  const result = runAccountStrategySimulation({
    contributionMode: "annual",
    contributionAmount: C,
    horizonYears: 20,
    annualReturn: 5,
    annualFees: 0.2,
    useRealDollars: false,
    t_now: 40,
    t_ret: 40,
    refundMode: "reinvest",
    fhsaEligible: true,
    fhsaHomeQualified: true,
    fhsaAnnualRoom: 20000 // well above C, so room not binding
  });

  const fhsaAll = getStrategy(result, "ALL_FHSA");
  const rrspAll = getStrategy(result, "ALL_RRSP");

  assert.ok(
    fhsaAll.finalAfterTax > rrspAll.finalAfterTax,
    "When FHSA is home-qualified and room not binding, FHSA-allocation should beat RRSP-only under same assumptions."
  );
});

// 4) FHSA room binding: for a large annual contribution, ensure FHSA is capped and remainder allocated
test("FHSA room binding and spillover", () => {
  const annualContribution = 30000;
  const fhsaRoom = 8000;

  const result = runAccountStrategySimulation({
    contributionMode: "annual",
    contributionAmount: annualContribution,
    horizonYears: 5,
    annualReturn: 5,
    annualFees: 0.2,
    useRealDollars: false,
    t_now: 40,
    t_ret: 30,
    refundMode: "spend",
    fhsaEligible: true,
    fhsaHomeQualified: true,
    fhsaAnnualRoom: fhsaRoom
  });

  const optimalSummary = result.allocationSummary;
  assert.ok(optimalSummary, "Expected allocation summary on optimal strategy");

  // FHSA usage should not exceed annual room in the summary
  assert.ok(
    optimalSummary.fhsaUsedAnnual <= fhsaRoom + 1e-6,
    "FHSA annual usage should be capped at the modeled annual room"
  );

  // Remainder should be positive given large contribution
  assert.ok(
    optimalSummary.remainderAnnual > 0,
    "Remainder annual contribution should be positive when annual contribution exceeds FHSA room"
  );
});

