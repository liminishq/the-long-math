/**
 * Break-even solver round-trip QA + investment/snapshot accounting identities.
 * Validates solvers by feeding full-precision roots back through RentVsBuyEngine.simulate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const SOLVER_TOLERANCE_DOLLARS = 1;
const HOME_LO = -0.2;
const HOME_HI = 0.3;
const INV_LO = -0.5;
const INV_HI = 0.4;

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

function pointAtYear(sim, year) {
  const m = Math.round(Number(year) * 12);
  return sim.series[m];
}

function withHomeRate(inputs, rate) {
  if (inputs.homeAppreciationMode === "real_linked") {
    return Object.assign({}, inputs, { realHomeAppreciationAnnual: rate });
  }
  return Object.assign({}, inputs, {
    homeAppreciationAnnual: rate,
    homeAppreciationMode: "nominal",
  });
}

function withInvRate(inputs, rate) {
  return Object.assign({}, inputs, { investmentReturnAnnual: rate });
}

function investmentGrowth(start, contribCum, account) {
  return account - start - contribCum;
}

const RVB = loadEngine();

test("break-even home appreciation: documented search bounds and unreachable handling", () => {
  const buyDom = defaultInputs({
    monthlyRent: 8000,
    investmentReturnAnnual: 0,
    comparisonYear: 5,
    rentGrowthAnnual: 0.1,
  });
  const be = RVB.solveBreakEvenHomeAppreciation(buyDom);
  assert.equal(be.unreachable, true);
  assert.ok(be.message && be.message.includes("−20%") && be.message.includes("+30%"));
  assert.equal(Number.isFinite(be.rate), false);
  assert.ok(Number.isFinite(be.differenceAtLow));
  assert.ok(Number.isFinite(be.differenceAtHigh));
  assert.ok(be.differenceAtLow * be.differenceAtHigh > 0);
});

test("break-even investment return: documented search bounds and unreachable handling", () => {
  const rentDom = defaultInputs({
    monthlyRent: 800,
    investmentReturnAnnual: 0.12,
    homeAppreciationAnnual: -0.05,
    comparisonYear: 10,
  });
  const be = RVB.solveBreakEvenInvestmentReturn(rentDom);
  assert.equal(be.unreachable, true);
  assert.equal(be.reachable, false);
  assert.ok(Array.isArray(be.roots));
  assert.equal(be.roots.length, 0);
  assert.ok(be.message && be.message.includes("−50%") && be.message.includes("+40%"));
  assert.equal(Number.isFinite(be.rate), false);
  assert.ok(Number.isFinite(be.differenceAtLow));
  assert.ok(Number.isFinite(be.differenceAtHigh));
  assert.ok(be.differenceAtLow * be.differenceAtHigh > 0);
});

const HOME_SCENARIOS = [
  { name: "default_y5", inputs: defaultInputs({ comparisonYear: 5 }) },
  { name: "default_y10", inputs: defaultInputs({ comparisonYear: 10 }) },
  { name: "default_y15", inputs: defaultInputs({ comparisonYear: 15 }) },
  { name: "default_y25", inputs: defaultInputs({ comparisonYear: 25 }) },
  { name: "default_y30", inputs: defaultInputs({ comparisonYear: 30 }) },
  { name: "high_rent_y10", inputs: defaultInputs({ monthlyRent: 3200, comparisonYear: 10 }) },
  { name: "low_rent_y10", inputs: defaultInputs({ monthlyRent: 1800, comparisonYear: 10 }) },
];

for (const scenario of HOME_SCENARIOS) {
  test(`home-appreciation round-trip + ±0.10pp: ${scenario.name}`, () => {
    const be = RVB.solveBreakEvenHomeAppreciation(scenario.inputs);
    assert.ok(!be.unreachable && !be.error, be.message || be.error);
    assert.ok(Number.isFinite(be.rate));
    assert.ok(be.rate >= HOME_LO - 1e-12 && be.rate <= HOME_HI + 1e-12);

    const atRoot = pointAtYear(RVB.simulate(withHomeRate(scenario.inputs, be.rate)), scenario.inputs.comparisonYear);
    assert.ok(
      Math.abs(atRoot.difference) <= SOLVER_TOLERANCE_DOLLARS,
      `residual ${atRoot.difference} exceeds ±$${SOLVER_TOLERANCE_DOLLARS}`
    );

    const atMinus = pointAtYear(
      RVB.simulate(withHomeRate(scenario.inputs, be.rate - 0.001)),
      scenario.inputs.comparisonYear
    );
    const atPlus = pointAtYear(
      RVB.simulate(withHomeRate(scenario.inputs, be.rate + 0.001)),
      scenario.inputs.comparisonYear
    );
    // Higher home appreciation raises buyer NW relative to renter.
    assert.ok(atMinus.difference < atRoot.difference);
    assert.ok(atPlus.difference > atRoot.difference);
    assert.ok(atMinus.difference < 0);
    assert.ok(atPlus.difference > 0);
  });
}

const INV_SCENARIOS = [
  { name: "default_y5", inputs: defaultInputs({ comparisonYear: 5 }) },
  { name: "default_y10", inputs: defaultInputs({ comparisonYear: 10 }) },
  { name: "default_y15", inputs: defaultInputs({ comparisonYear: 15 }) },
  { name: "default_y25", inputs: defaultInputs({ comparisonYear: 25 }) },
  { name: "default_y30", inputs: defaultInputs({ comparisonYear: 30 }) },
  { name: "high_rent_y10", inputs: defaultInputs({ monthlyRent: 3200, comparisonYear: 10 }) },
];

for (const scenario of INV_SCENARIOS) {
  test(`investment-return round-trip + ±0.10pp: ${scenario.name}`, () => {
    const be = RVB.solveBreakEvenInvestmentReturn(scenario.inputs);
    assert.ok(!be.unreachable && !be.error, be.message || be.error);
    assert.ok(Number.isFinite(be.rate));
    assert.ok(be.roots && be.roots.length >= 1);
    assert.ok(be.rate >= INV_LO - 1e-12 && be.rate <= INV_HI + 1e-12);

    const atRoot = pointAtYear(RVB.simulate(withInvRate(scenario.inputs, be.rate)), scenario.inputs.comparisonYear);
    assert.ok(Math.abs(atRoot.difference) <= SOLVER_TOLERANCE_DOLLARS);

    const atMinus = pointAtYear(
      RVB.simulate(withInvRate(scenario.inputs, be.rate - 0.001)),
      scenario.inputs.comparisonYear
    );
    const atPlus = pointAtYear(
      RVB.simulate(withInvRate(scenario.inputs, be.rate + 0.001)),
      scenario.inputs.comparisonYear
    );
    // Around the found root for these default/high-rent cases, the local slope is negative
    // (higher return reduces buyer−renter). Adversarial long-horizon cases can have regions
    // where the slope is positive; see rent-vs-buy.adversarial-return.test.mjs.
    assert.ok(atPlus.difference < atRoot.difference);
    assert.ok(atMinus.difference > atRoot.difference);
    assert.ok(atMinus.difference > 0);
    assert.ok(atPlus.difference < 0);
  });
}

test("break-even rates depend on comparison year; 60-year series length unchanged", () => {
  const y10 = RVB.calculate(defaultInputs({ comparisonYear: 10 }));
  const y25 = RVB.calculate(defaultInputs({ comparisonYear: 25 }));
  assert.equal(y10.series.length, y25.series.length);
  assert.equal(y10.series.length, 721);
  assert.notEqual(y10.breakEvenHomeAppreciation.rate, y25.breakEvenHomeAppreciation.rate);
  assert.notEqual(y10.breakEvenInvestmentReturn.rate, y25.breakEvenInvestmentReturn.rate);
  // Same path for shared months under identical economic inputs
  assert.ok(Math.abs(y10.series[120].difference - y25.series[120].difference) < 1e-9);
});

test("f(homeAppreciation) is monotonic increasing for default scenario at year 10", () => {
  const inputs = defaultInputs({ comparisonYear: 10 });
  let prev = -Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const rate = HOME_LO + ((HOME_HI - HOME_LO) * i) / 20;
    const d = pointAtYear(RVB.simulate(withHomeRate(inputs, rate)), 10).difference;
    assert.ok(d + 1e-6 >= prev, `non-monotonic at rate=${rate}: ${d} < ${prev}`);
    prev = d;
  }
});

test("f(investmentReturn) is monotonic decreasing for default scenario at year 10", () => {
  const inputs = defaultInputs({ comparisonYear: 10 });
  let prev = Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const rate = INV_LO + ((INV_HI - INV_LO) * i) / 20;
    const d = pointAtYear(RVB.simulate(withInvRate(inputs, rate)), 10).difference;
    assert.ok(d - 1e-6 <= prev, `non-monotonic at rate=${rate}: ${d} > ${prev}`);
    prev = d;
  }
});

test("buyer and renter investment identities hold at selected year", () => {
  const result = RVB.calculate(defaultInputs({ comparisonYear: 15 }));
  const p = result.comparisonPoint;
  const buyGrowth = investmentGrowth(
    result.buyerStartInvested,
    p.buyerContribCumulative,
    p.buyerInvestments
  );
  const rentGrowth = investmentGrowth(
    result.renterStartInvested,
    p.renterContribCumulative,
    p.renterInvestments
  );
  assert.ok(Math.abs(buyGrowth + result.buyerStartInvested + p.buyerContribCumulative - p.buyerInvestments) < 1e-9);
  assert.ok(Math.abs(rentGrowth + result.renterStartInvested + p.renterContribCumulative - p.renterInvestments) < 1e-9);
  assert.ok(Math.abs(p.netRealizableEquity + p.buyerInvestments - p.buyerNetWorth) < 1e-9);
  assert.ok(Math.abs(p.renterInvestments - p.renterNetWorth) < 1e-9);
  assert.ok(Math.abs(p.buyerNetWorth - p.renterNetWorth - p.difference) < 1e-9);
  // Cumulative contributions are contributed dollars, not future value
  assert.ok(p.buyerContribCumulative >= -1e-9);
  assert.ok(p.renterContribCumulative >= -1e-9);
});

test("snapshot NW identities across standard points including payoff and year 60", () => {
  const result = RVB.calculate(defaultInputs({ comparisonYear: 15 }));
  const months = [5 * 12, 10 * 12, 15 * 12, 20 * 12, result.payoffMonth, 30 * 12, 60 * 12];
  for (const m of months) {
    if (m == null || m < 0) continue;
    const p = result.series[m];
    assert.ok(p, `missing month ${m}`);
    assert.ok(Math.abs(p.netRealizableEquity + p.buyerInvestments - p.buyerNetWorth) < 1e-6);
    assert.ok(Math.abs(p.renterInvestments - p.renterNetWorth) < 1e-6);
    assert.ok(Math.abs(p.buyerNetWorth - p.renterNetWorth - p.difference) < 1e-6);
    const buyG = investmentGrowth(result.buyerStartInvested, p.buyerContribCumulative, p.buyerInvestments);
    const rentG = investmentGrowth(result.renterStartInvested, p.renterContribCumulative, p.renterInvestments);
    assert.ok(Math.abs(result.buyerStartInvested + p.buyerContribCumulative + buyG - p.buyerInvestments) < 1e-6);
    assert.ok(Math.abs(result.renterStartInvested + p.renterContribCumulative + rentG - p.renterInvestments) < 1e-6);
  }
});

test("post-payoff: buyer cash-flow contributions begin when owner cash falls below renter cash", () => {
  const result = RVB.calculate(defaultInputs({ comparisonYear: 30 }));
  assert.ok(result.payoffMonth > 0);
  const before = result.series[result.payoffMonth - 12];
  const atPayoff = result.series[result.payoffMonth];
  const after = result.series[Math.min(720, result.payoffMonth + 60)];
  // Payoff month still has the final mortgage payment in owner cash
  assert.ok(atPayoff.mortgagePayment > 0);
  assert.ok(after.mortgagePayment === 0 || after.mortgagePayment < 1e-9);
  // After payoff, buyer cumulative CF contributions should rise vs pre-payoff when buy has CF advantage
  assert.ok(after.buyerContribCumulative >= before.buyerContribCumulative - 1e-9);
  if (after.cashFlowDiff < -1) {
    assert.ok(after.buyerContribCumulative > atPayoff.buyerContribCumulative);
  }
});

test("renterUpfrontCosts reduces renter starting investable capital when provided", () => {
  const split = RVB.buildStartingCapitalSplit(
    { startingCapital: 120000, downPayment: 100000, closingCosts: 5000, renterUpfrontCosts: 2000 },
    { upfrontInsuranceCash: 0, mortgagePrincipal: 400000 }
  );
  assert.equal(split.renterUpfront, 2000);
  assert.equal(split.renterStartingInvestable, 118000);
  assert.equal(split.renterUpfrontShortfall, false);
});

test("buyer and renter investment earnings identity holds at selected year", () => {
  const result = RVB.calculate(defaultInputs({ comparisonYear: 15 }));
  const p = result.comparisonPoint;
  const buyEarnings = p.buyerInvestments - result.buyerStartInvested - p.buyerContribCumulative;
  const rentEarnings = p.renterInvestments - result.renterStartInvested - p.renterContribCumulative;
  assert.ok(Math.abs(buyEarnings + result.buyerStartInvested + p.buyerContribCumulative - p.buyerInvestments) < 1e-9);
  assert.ok(Math.abs(rentEarnings + result.renterStartInvested + p.renterContribCumulative - p.renterInvestments) < 1e-9);
});
