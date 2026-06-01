import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const engineUrl = pathToFileURL(join(root, "calculators", "tfsa-rrsp-fhsa", "engine.js")).href;

const { runAccountStrategySimulation, computeRrspNewAnnualRoom } = await import(engineUrl);

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
    fhsaEligible: false,
    tfsaRemainingRoom: 1e9,
    rrspRemainingRoom: 1e9
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

// 5) Lifetime FHSA contribution cap: cumulative deposits stop at L even with high income and large annual room
test("FHSA lifetime contribution cap binds cumulative deposits", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 5000,
    horizonYears: 10,
    annualReturn: 0,
    annualFees: 0,
    useRealDollars: false,
    t_now: 0,
    t_ret: 0,
    refundMode: "spend",
    fhsaEligible: true,
    fhsaHomeQualified: true,
    fhsaAnnualRoom: 8000,
    fhsaLifetimeCap: 40000
  });

  const fhsaAll = getStrategy(result, "ALL_FHSA");
  assert.ok(
    Math.abs(fhsaAll.breakdown.fhsa - 40000) < 1,
    "With zero growth, FHSA balance should equal lifetime contributions capped at 40,000"
  );
  assert.ok(
    Math.abs(fhsaAll.meta.fhsaLifetimeContributed - 40000) < 1,
    "Meta should report 40,000 in cumulative FHSA contributions"
  );
});

test("RRSP new annual room is min(18% of income, dollar cap)", () => {
  assert.ok(Math.abs(computeRrspNewAnnualRoom(250000, 33810) - 33810) < 1e-6);
  assert.ok(Math.abs(computeRrspNewAnnualRoom(100000, 33810) - 18000) < 1e-6);
});

test("when FHSA eligible, engine runs six distinct account-priority strategies", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 100,
    horizonYears: 2,
    annualReturn: 0,
    annualFees: 0,
    t_now: 0,
    t_ret: 0,
    refundMode: "spend",
    fhsaEligible: true,
    fhsaHomeQualified: true,
    fhsaAnnualRoom: 8000,
    tfsaRemainingRoom: 10000,
    rrspRemainingRoom: 10000
  });
  assert.equal(result.priorityRanking.length, 6);
  const keys = new Set(result.priorityRanking.map((r) => r.key));
  assert.ok(keys.has("TFSA_FHSA_RRSP"));
  assert.ok(keys.has("RRSP_FHSA_TFSA"));
  assert.ok(keys.has("ALL_FHSA"));
});

test("January top-ups add to remaining TFSA and RRSP room (no contributions)", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 0,
    horizonYears: 2,
    annualReturn: 0,
    annualFees: 0,
    t_now: 0,
    t_ret: 0,
    refundMode: "spend",
    fhsaEligible: false,
    tfsaRemainingRoom: 10000,
    rrspRemainingRoom: 5000,
    tfsaNewAnnualRoom: 7000,
    currentTaxableIncome: 200000,
    rrspAnnualNewRoomCap: 33810
  });

  const strat = getStrategy(result, "ALL_TFSA");
  assert.ok(Math.abs(strat.meta.remainingTfsaRoom - 17000) < 0.01, "TFSA room should be 10k + 7k");
  assert.ok(
    Math.abs(strat.meta.remainingRrspRoom - 38810) < 0.01,
    "RRSP room should be 5k + min(36k, 33.81k)"
  );
});

// 8) With refund reinvested, RRSP wins when t_now > t_ret (even with large TFSA room).
//    This covers the bug scenario where the UI might seem to incorrectly favour TFSA
//    when the "reinvest refund" checkbox is checked.
test("monthly contributions, t_now > t_ret, reinvest – RRSP beats TFSA", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 1000,
    horizonYears: 25,
    annualReturn: 7,
    annualFees: 0,
    useRealDollars: false,
    t_now: 43,
    t_ret: 30,
    refundMode: "reinvest",
    fhsaEligible: false,
    tfsaRemainingRoom: 100000,
    rrspRemainingRoom: 200000
  });

  const tfsa = getStrategy(result, "ALL_TFSA");
  const rrsp = getStrategy(result, "ALL_RRSP");

  assert.ok(
    rrsp.finalAfterTax > tfsa.finalAfterTax,
    `RRSP+reinvest should beat TFSA when t_now (43%) > t_ret (30%); ` +
    `got RRSP=${Math.round(rrsp.finalAfterTax)}, TFSA=${Math.round(tfsa.finalAfterTax)}`
  );
});

// 9) With refund reinvested, TFSA wins when t_now < t_ret.
//    The optimal strategy should have $0 RRSP in year-1 allocation (TFSA fills first).
test("monthly contributions, t_now < t_ret, reinvest – TFSA optimal with no year-1 RRSP", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 500,
    horizonYears: 20,
    annualReturn: 7,
    annualFees: 0,
    useRealDollars: false,
    t_now: 26,
    t_ret: 43,
    refundMode: "reinvest",
    fhsaEligible: false,
    tfsaRemainingRoom: 80000,
    rrspRemainingRoom: 150000
  });

  assert.equal(result.optimalStrategyKey, "ALL_TFSA", "TFSA should be optimal when t_now < t_ret");

  // Optimal strategy in year 1 should have no RRSP contributions (TFSA has room)
  const y1 = result.strategies.OPTIMAL?.meta?.year1Allocation || {};
  assert.ok(
    (y1.rrspDirect || 0) < 0.01,
    "Optimal strategy should have no year-1 RRSP contributions when TFSA has ample room"
  );
});

// 10) Default-like scenario: $2k/mo, limited TFSA room, reinvest refund, t_now > t_ret → RRSP first wins.
//    (Requires realistic marginal rates; broken $1-delta tax rounding used to yield t_now ≈ 0% and wrongly favour TFSA.)
test("monthly 2k, 7k TFSA room, reinvest, t_now > t_ret – RRSP beats TFSA", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 2000,
    horizonYears: 25,
    annualReturn: 7,
    annualFees: 0.5,
    useRealDollars: false,
    t_now: 43,
    t_ret: 28,
    refundMode: "reinvest",
    fhsaEligible: false,
    tfsaRemainingRoom: 7000,
    rrspRemainingRoom: 21600,
    tfsaNewAnnualRoom: 7000,
    currentTaxableIncome: 120000,
    rrspAnnualNewRoomCap: 32490
  });

  assert.equal(result.optimalStrategyKey, "ALL_RRSP");
  assert.ok(
    result.strategies.ALL_RRSP.finalAfterTax > result.strategies.ALL_TFSA.finalAfterTax,
    "RRSP-first should beat TFSA-first when current rate exceeds retirement rate and refunds are reinvested"
  );
});
