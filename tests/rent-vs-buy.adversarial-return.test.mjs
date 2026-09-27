/**
 * Adversarial investment-return monotonicity + renter upfront + earnings identity.
 * Documents non-monotonic f(return)=buyerNW−renterNW cases without changing the solver.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const INV_LO = -0.5;
const INV_HI = 0.4;
const N_SWEEP = 41;

function loadEngine() {
  const ctx = {
    console,
    Math,
    Number,
    Array,
    Object,
    JSON,
    Date,
    String,
    isFinite,
    parseInt,
    parseFloat,
    Infinity,
    NaN,
  };
  ctx.globalThis = ctx;
  for (const f of [
    "assets/js/investment-growth.engine.js",
    "calculators/mortgage-calculator/mortgage-engine.js",
    "assets/js/mortgage-loan-insurance.canada.js",
    "calculators/rent-vs-buy/engine.js",
  ]) {
    runInNewContext(readFileSync(join(root, f), "utf8"), ctx);
  }
  return ctx.RentVsBuyEngine;
}

function defaultInputs(overrides) {
  return Object.assign(
    {
      purchasePrice: 500000,
      downPayment: 100000,
      startingCapital: 120000,
      closingCosts: 5000,
      mortgageRatePct: 5,
      amortizationYears: 25,
      mortgageInsuranceMode: "automatic_canadian",
      insuranceProvince: "none",
      financeInsurancePremium: true,
      thirtyYearEligibility: "neither",
      sellingCostPercent: 0.05,
      sellingCostFixed: 0,
      propertyTaxAnnual: 4000,
      propertyTaxUseInflation: true,
      maintenanceAnnual: 5000,
      homeInsuranceAnnual: 1500,
      condoFeesMonthly: 0,
      ownerUtilitiesMonthly: 250,
      ownerUtilitiesUseInflation: true,
      ownerOtherExpenses: [],
      monthlyRent: 2200,
      rentGrowthAnnual: 0.02,
      tenantInsuranceAnnual: 300,
      renterUtilitiesMonthly: 100,
      renterUtilitiesUseInflation: true,
      renterOtherExpenses: [],
      renterUpfrontCosts: 0,
      investmentReturnAnnual: 0.06,
      investCashFlowDifference: true,
      inflationAnnual: 0.02,
      homeAppreciationMode: "nominal",
      homeAppreciationAnnual: 0.03,
      comparisonYear: 10,
    },
    overrides || {}
  );
}

function sweepDiffs(RVB, inputs, year) {
  const diffs = [];
  const rates = [];
  for (let i = 0; i < N_SWEEP; i += 1) {
    const rate = INV_LO + ((INV_HI - INV_LO) * i) / (N_SWEEP - 1);
    const sim = RVB.simulate(
      Object.assign({}, inputs, { investmentReturnAnnual: rate, comparisonYear: year })
    );
    diffs.push(sim.series[Math.round(year * 12)].difference);
    rates.push(rate);
  }
  return { diffs, rates };
}

function classifySweep(diffs) {
  let inc = 0;
  let dec = 0;
  let turns = 0;
  let prevDir = 0;
  for (let i = 1; i < diffs.length; i += 1) {
    const d = diffs[i] - diffs[i - 1];
    const dir = d > 1 ? 1 : d < -1 ? -1 : 0;
    if (d > 1) inc += 1;
    else if (d < -1) dec += 1;
    if (dir && prevDir && dir !== prevDir) turns += 1;
    if (dir) prevDir = dir;
  }
  let crossings = 0;
  for (let i = 1; i < diffs.length; i += 1) {
    if (diffs[i - 1] * diffs[i] < 0) crossings += 1;
  }
  const kind =
    inc > 0 && dec === 0
      ? "monotonic_increasing"
      : dec > 0 && inc === 0
        ? "monotonic_decreasing"
        : "non_monotonic";
  return { kind, inc, dec, turns, crossings };
}

function investmentEarnings(start, contrib, account) {
  return account - start - contrib;
}

const RVB = loadEngine();

const SCENARIO_A = defaultInputs({
  monthlyRent: 3800,
  rentGrowthAnnual: 0.04,
  amortizationYears: 15,
  homeAppreciationAnnual: 0.02,
  comparisonYear: 35,
});

const SCENARIO_B = defaultInputs({
  amortizationYears: 10,
  monthlyRent: 4200,
  rentGrowthAnnual: 0.035,
  homeAppreciationAnnual: 0.025,
});

const SCENARIO_D = defaultInputs({
  downPayment: 25000,
  startingCapital: 200000,
  closingCosts: 3000,
  monthlyRent: 2400,
  rentGrowthAnnual: 0.03,
});

const SCENARIO_E = defaultInputs({
  amortizationYears: 10,
  monthlyRent: 4500,
  rentGrowthAnnual: 0.04,
  homeAppreciationAnnual: 0.02,
  propertyTaxAnnual: 3000,
  maintenanceAnnual: 3500,
  ownerUtilitiesMonthly: 180,
});

test("Scenario A: buyer investment account larger by year 35; f(return) non-monotonic with one root", () => {
  const at = RVB.simulate(Object.assign({}, SCENARIO_A, { investmentReturnAnnual: 0.05 }));
  const p = at.series[35 * 12];
  assert.ok(p.buyerInvestments > p.renterInvestments);
  assert.ok(p.buyerContribCumulative > 100000);
  const { diffs } = sweepDiffs(RVB, SCENARIO_A, 35);
  const c = classifySweep(diffs);
  assert.equal(c.kind, "non_monotonic");
  assert.equal(c.crossings, 1);
  assert.ok(c.turns >= 1);
  // Endpoint brackets — bisection can find the unique sampled root
  assert.ok(diffs[0] * diffs[diffs.length - 1] < 0);
});

test("Scenario A: higher return can favor buyer at moderate rates (positive local slope)", () => {
  const h = 0.005;
  const year = 35;
  const fLo = RVB.simulate(
    Object.assign({}, SCENARIO_A, { investmentReturnAnnual: 0.05 - h, comparisonYear: year })
  ).series[year * 12].difference;
  const fHi = RVB.simulate(
    Object.assign({}, SCENARIO_A, { investmentReturnAnnual: 0.05 + h, comparisonYear: year })
  ).series[year * 12].difference;
  assert.ok(fHi > fLo, "at ~5%, higher return increases buyer−renter (favors buyer)");
});

for (const year of [20, 30, 40, 50, 60]) {
  test(`Scenario B (short amort + high rent) year ${year}: non-monotonic but unique root round-trips`, () => {
    const inputs = Object.assign({}, SCENARIO_B, { comparisonYear: year });
    const { diffs } = sweepDiffs(RVB, inputs, year);
    const c = classifySweep(diffs);
    assert.equal(c.kind, "non_monotonic");
    assert.equal(c.crossings, 1);
    assert.ok(diffs[0] * diffs[diffs.length - 1] < 0);

    const be = RVB.solveBreakEvenInvestmentReturn(inputs);
    assert.ok(!be.unreachable && Number.isFinite(be.rate));
    const atRoot = RVB.simulate(
      Object.assign({}, inputs, { investmentReturnAnnual: be.rate })
    ).series[year * 12];
    assert.ok(Math.abs(atRoot.difference) <= 1);
    const atMinus = RVB.simulate(
      Object.assign({}, inputs, { investmentReturnAnnual: be.rate - 0.001 })
    ).series[year * 12];
    const atPlus = RVB.simulate(
      Object.assign({}, inputs, { investmentReturnAnnual: be.rate + 0.001 })
    ).series[year * 12];
    // Around the found root (descending limb), higher return reduces buyer−renter
    assert.ok(atPlus.difference < atRoot.difference);
    assert.ok(atMinus.difference > atRoot.difference);
  });
}

for (const year of [10, 20]) {
  test(`Scenario D year ${year}: monotonic decreasing (near-equal start; short horizon)`, () => {
    const { diffs } = sweepDiffs(RVB, SCENARIO_D, year);
    assert.equal(classifySweep(diffs).kind, "monotonic_decreasing");
  });
}

for (const year of [30, 40, 60]) {
  test(`Scenario D year ${year}: becomes non-monotonic at long horizon`, () => {
    const { diffs } = sweepDiffs(RVB, SCENARIO_D, year);
    assert.equal(classifySweep(diffs).kind, "non_monotonic");
    assert.equal(classifySweep(diffs).crossings, 1);
  });
}

for (const year of [30, 40, 50, 60]) {
  test(`Scenario E year ${year}: buyer dominates contributions; non-monotonic; single root`, () => {
    const at = RVB.simulate(Object.assign({}, SCENARIO_E, { investmentReturnAnnual: 0.06 }));
    const p = at.series[year * 12];
    assert.ok(p.buyerContribCumulative > p.renterContribCumulative * 10);
    const { diffs } = sweepDiffs(RVB, SCENARIO_E, year);
    const c = classifySweep(diffs);
    assert.equal(c.kind, "non_monotonic");
    assert.equal(c.crossings, 1);
    assert.ok(c.turns >= 1);
  });
}

test("solver uses endpoint bracketing only (no hardcoded renter-favor direction in unreachable path)", () => {
  const src = readFileSync(join(root, "calculators/rent-vs-buy/engine.js"), "utf8");
  assert.ok(src.includes("atLo.difference * atHi.difference > 0"));
  assert.ok(src.includes("atLo.difference * atMid.difference <= 0"));
  assert.ok(!/higher return favou?rs renting/i.test(src));
});

test("no multi-root missed-bracket case in adversarial suite (endpoints opposite ⇒ one crossing)", () => {
  const cases = [
    [SCENARIO_A, 35],
    [SCENARIO_A, 50],
    [SCENARIO_B, 40],
    [SCENARIO_B, 60],
    [SCENARIO_E, 40],
    [SCENARIO_E, 60],
  ];
  for (const [base, year] of cases) {
    const { diffs } = sweepDiffs(RVB, base, year);
    const c = classifySweep(diffs);
    assert.equal(c.crossings, 1, `year ${year}`);
    assert.ok(diffs[0] * diffs[diffs.length - 1] < 0);
    assert.equal(c.kind, "non_monotonic");
  }
});

// --- Renter upfront costs ---

test("renter upfront Case A: $0 leaves full starting capital invested", () => {
  const r = RVB.calculate(
    defaultInputs({
      purchasePrice: 400000,
      downPayment: 80000,
      startingCapital: 100000,
      closingCosts: 0,
      mortgageInsuranceMode: "none",
      renterUpfrontCosts: 0,
    })
  );
  assert.ok(!r.error, r.error);
  assert.equal(r.renterStartInvested, 100000);
});

test("renter upfront Case B: $5,000 reduces renter start to $95,000", () => {
  const shared = {
    purchasePrice: 400000,
    downPayment: 80000,
    startingCapital: 100000,
    closingCosts: 0,
    mortgageInsuranceMode: "none",
    comparisonYear: 5,
  };
  const r = RVB.calculate(defaultInputs(Object.assign({}, shared, { renterUpfrontCosts: 5000 })));
  assert.ok(!r.error, r.error);
  assert.equal(r.renterStartInvested, 95000);
  assert.equal(r.capital.renterUpfront, 5000);
  const control = RVB.calculate(defaultInputs(Object.assign({}, shared, { renterUpfrontCosts: 0 })));
  assert.equal(r.buyerStartInvested, control.buyerStartInvested);
  assert.ok(Math.abs(r.series[60].buyerNetWorth - control.series[60].buyerNetWorth) < 1e-6);
  assert.ok(r.series[60].renterNetWorth < control.series[60].renterNetWorth);
});

test("renter upfront Case C: equals starting capital → renter starts at $0", () => {
  const r = RVB.calculate(
    defaultInputs({
      purchasePrice: 400000,
      downPayment: 80000,
      startingCapital: 100000,
      closingCosts: 0,
      mortgageInsuranceMode: "none",
      renterUpfrontCosts: 100000,
    })
  );
  assert.ok(!r.error, r.error);
  assert.equal(r.renterStartInvested, 0);
});

test("renter upfront Case D: exceeds starting capital → validation error", () => {
  const r = RVB.calculate(
    defaultInputs({
      purchasePrice: 400000,
      downPayment: 80000,
      startingCapital: 100000,
      closingCosts: 0,
      mortgageInsuranceMode: "none",
      renterUpfrontCosts: 100001,
    })
  );
  assert.ok(r.error);
  assert.equal(r.errorCode, "renter_upfront_exceeds_capital");
  assert.match(r.error, /cannot exceed available starting capital/i);
});

test("investment earnings identity allows negative earnings", () => {
  const r = RVB.calculate(
    defaultInputs({
      investmentReturnAnnual: -0.2,
      comparisonYear: 10,
      investCashFlowDifference: true,
    })
  );
  assert.ok(!r.error);
  const p = r.comparisonPoint;
  const earnings = investmentEarnings(
    r.renterStartInvested,
    p.renterContribCumulative,
    p.renterInvestments
  );
  assert.ok(earnings < 0);
  assert.ok(
    Math.abs(r.renterStartInvested + p.renterContribCumulative + earnings - p.renterInvestments) < 1e-9
  );
  const buyEarn = investmentEarnings(
    r.buyerStartInvested,
    p.buyerContribCumulative,
    p.buyerInvestments
  );
  assert.ok(
    Math.abs(r.buyerStartInvested + p.buyerContribCumulative + buyEarn - p.buyerInvestments) < 1e-9
  );
});
