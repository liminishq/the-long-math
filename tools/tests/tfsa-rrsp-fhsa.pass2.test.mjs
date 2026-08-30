/**
 * Pass 2: progressive contribution-year RRSP/FHSA tax benefits
 * (tax(income,0) − tax(income, rrsp+fhsa)), not contribution × one marginal rate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const engineUrl = pathToFileURL(join(root, "calculators", "tfsa-rrsp-fhsa", "engine.js")).href;
const taxDataUrl = pathToFileURL(join(root, "calculators", "canada-income-tax", "js", "tax.data.js")).href;
const taxEngineUrl = pathToFileURL(join(root, "calculators", "canada-income-tax", "js", "tax.engine.js")).href;

const {
  runAccountStrategySimulation,
  createProgressiveDeductionBenefit,
  buildTfsaShareScenario,
  parseTfsaShareQuery
} = await import(engineUrl);
const { getTaxDataBundle } = await import(taxDataUrl);
const { computePersonalTax } = await import(taxEngineUrl);

const taxData = await getTaxDataBundle(2025, {
  fsDataRoot: join(root, "calculators", "canada-income-tax", "data")
});

function progressiveOpts(extra = {}) {
  return {
    taxYear: 2025,
    taxProvince: "ON",
    taxData,
    currentTaxableIncome: 120000,
    contributionYearIncome: 120000,
    ...extra
  };
}

function getStrategy(result, key) {
  const s = result.strategies[key];
  assert.ok(s, `Missing strategy ${key}`);
  return s;
}

test("Pass2: small deduction within one bracket ≈ rate × amount", () => {
  const income = 80000;
  const amount = 500;
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: income,
    taxData
  });
  const benefit = benefitCalc.totalBenefit(amount, 0);
  const base = computePersonalTax(
    {
      year: 2025,
      province: "ON",
      employmentIncome: income,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0
    },
    { taxData }
  );
  const marginal = base.totals.marginalRate;
  const approx = amount * marginal;
  // Finite-difference marginal vs a finite deduction can differ slightly (credits / rounding).
  assert.ok(
    Math.abs(benefit - approx) < 20,
    `Small-bracket benefit should ≈ rate×amount; got ${benefit} vs ${approx}`
  );
  assert.ok(
    Math.abs(benefit / amount - marginal) < 0.02,
    `Effective rate ${benefit / amount} should be near marginal ${marginal}`
  );
});

test("Pass2: deduction crossing a bracket — benefit < startingMarginal × amount", () => {
  const income = 120000;
  const amount = 30000;
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: income,
    taxData
  });
  const benefit = benefitCalc.totalBenefit(amount, 0);
  const base = computePersonalTax(
    {
      year: 2025,
      province: "ON",
      employmentIncome: income,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0
    },
    { taxData }
  );
  const flat = amount * base.totals.marginalRate;
  assert.ok(benefit < flat - 100, `Cross-bracket benefit ${benefit} should be well below flat ${flat}`);
});

test("Pass2: Ontario $120,000 / $30,000 RRSP progressive benefit ≈ 10158 (not 13023)", () => {
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: 120000,
    taxData
  });
  const benefit = benefitCalc.totalBenefit(30000, 0);
  assert.ok(
    Math.abs(benefit - 10158) < 2,
    `Expected progressive benefit ≈ 10158, got ${benefit}`
  );
  const flatApprox = 30000 * 0.4341;
  assert.ok(Math.abs(flatApprox - 13023) < 5, "Sanity: flat ≈ 13023");
  assert.ok(Math.abs(benefit - 13023) > 500, "Must not equal flat ≈ 13023");

  const result = runAccountStrategySimulation({
    contributionMode: "lump",
    contributionAmount: 30000,
    horizonYears: 1,
    annualReturn: 0,
    annualFees: 0,
    t_now: 43.41,
    t_ret: 30,
    refundMode: "spend",
    fhsaEligible: false,
    tfsaRemainingRoom: 0,
    rrspRemainingRoom: 30000,
    ...progressiveOpts()
  });
  const rrsp = getStrategy(result, "ALL_RRSP");
  assert.ok(
    Math.abs(rrsp.meta.year1ProgressiveRefund - 10158) < 2,
    `Simulation year1ProgressiveRefund should ≈ 10158, got ${rrsp.meta.year1ProgressiveRefund}`
  );
});

test("Pass2: large multi-threshold deduction still reconciles increments", () => {
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: 200000,
    taxData
  });
  const chunks = [5000, 10000, 15000, 20000];
  let prevR = 0;
  let sum = 0;
  for (const c of chunks) {
    sum += benefitCalc.benefitForIncrement(prevR, 0, c, 0);
    prevR += c;
  }
  const total = benefitCalc.totalBenefit(prevR, 0);
  assert.ok(Math.abs(sum - total) < 0.01, `Increment sum ${sum} vs totalBenefit ${total}`);
  assert.ok(total > 15000, "Large deduction should produce a material progressive benefit");
});

test("Pass2: RRSP only / FHSA only / RRSP+FHSA cumulative", () => {
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: 100000,
    taxData
  });
  const rrspOnly = benefitCalc.totalBenefit(8000, 0);
  const fhsaOnly = benefitCalc.totalBenefit(0, 8000);
  const both = benefitCalc.totalBenefit(8000, 8000);
  assert.ok(Math.abs(both - (benefitCalc.totalIncomeTax(0, 0) - benefitCalc.totalIncomeTax(8000, 8000))) < 1e-9);

  const incR = benefitCalc.benefitForIncrement(0, 0, 8000, 0);
  const incF = benefitCalc.benefitForIncrement(8000, 0, 0, 8000);
  assert.ok(Math.abs(incR - rrspOnly) < 0.01);
  assert.ok(Math.abs(incR + incF - both) < 0.01);
  assert.ok(Math.abs(fhsaOnly - benefitCalc.benefitForIncrement(0, 0, 0, 8000)) < 0.01);

  // Order independence of totalBenefit(rrsp, fhsa)
  assert.ok(Math.abs(both - benefitCalc.totalBenefit(8000, 8000)) < 1e-9);
});

test("Pass2: refund spent vs reinvested changes RRSP outcome when progressive", () => {
  const base = {
    contributionMode: "lump",
    contributionAmount: 20000,
    horizonYears: 10,
    annualReturn: 5,
    annualFees: 0,
    t_now: 40,
    t_ret: 30,
    fhsaEligible: false,
    tfsaRemainingRoom: 1e9,
    rrspRemainingRoom: 1e9,
    ...progressiveOpts({ currentTaxableIncome: 120000, contributionYearIncome: 120000 })
  };
  const spent = runAccountStrategySimulation({ ...base, refundMode: "spend" });
  const reinvest = runAccountStrategySimulation({ ...base, refundMode: "reinvest" });
  const rrspSpent = getStrategy(spent, "ALL_RRSP").finalAfterTax;
  const rrspReinvest = getStrategy(reinvest, "ALL_RRSP").finalAfterTax;
  assert.ok(
    rrspReinvest > rrspSpent + 1000,
    `Reinvest should lift RRSP FV; spent=${Math.round(rrspSpent)} reinvest=${Math.round(rrspReinvest)}`
  );
  assert.ok(getStrategy(reinvest, "ALL_RRSP").meta.year1ProgressiveRefund > 5000);
});

test("Pass2: progressive refund can flip ranking vs flat t_now (ON 120k / 30k)", () => {
  // Flat overstates refund (~13023 vs ~10158). With t_ret between effective and flat,
  // zero-growth lump + reinvest: flat RRSP beats TFSA; progressive TFSA beats RRSP.
  const C = 30000;
  const tRet = 36;
  const flatTNow = 43.41;

  const common = {
    contributionMode: "lump",
    contributionAmount: C,
    horizonYears: 1,
    annualReturn: 0,
    annualFees: 0,
    t_ret: tRet,
    refundMode: "reinvest",
    fhsaEligible: false,
    tfsaRemainingRoom: 1e9,
    rrspRemainingRoom: 1e9
  };

  const flat = runAccountStrategySimulation({
    ...common,
    t_now: flatTNow
    // no taxData → legacy flat refund
  });
  const progressive = runAccountStrategySimulation({
    ...common,
    t_now: flatTNow,
    ...progressiveOpts()
  });

  const flatRrsp = getStrategy(flat, "ALL_RRSP").finalAfterTax;
  const flatTfsa = getStrategy(flat, "ALL_TFSA").finalAfterTax;
  const progRrsp = getStrategy(progressive, "ALL_RRSP").finalAfterTax;
  const progTfsa = getStrategy(progressive, "ALL_TFSA").finalAfterTax;
  const progRefund = getStrategy(progressive, "ALL_RRSP").meta.year1ProgressiveRefund;

  assert.ok(Math.abs(progRefund - 10158) < 2, `Progressive refund ≈ 10158, got ${progRefund}`);
  assert.ok(
    Math.abs(progRefund - C * (flatTNow / 100)) > 2000,
    "Progressive refund must differ materially from flat t_now × contribution"
  );

  assert.ok(flatRrsp > flatTfsa, `Flat should favour RRSP: RRSP=${flatRrsp} TFSA=${flatTfsa}`);
  assert.ok(progTfsa > progRrsp, `Progressive should favour TFSA: RRSP=${progRrsp} TFSA=${progTfsa}`);
  assert.equal(progressive.optimalStrategyKey, "ALL_TFSA");
  assert.equal(flat.optimalStrategyKey, "ALL_RRSP");
});

test("Pass2: hypothetical future contribution-year income (80000) works", () => {
  const result = runAccountStrategySimulation({
    contributionMode: "lump",
    contributionAmount: 10000,
    horizonYears: 1,
    annualReturn: 0,
    annualFees: 0,
    t_now: 30,
    t_ret: 25,
    refundMode: "spend",
    fhsaEligible: false,
    tfsaRemainingRoom: 0,
    rrspRemainingRoom: 10000,
    ...progressiveOpts({
      currentTaxableIncome: 80000,
      contributionYearIncome: 80000
    })
  });
  const rrsp = getStrategy(result, "ALL_RRSP");
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: 80000,
    taxData
  });
  const expected = benefitCalc.totalBenefit(10000, 0);
  assert.ok(
    Math.abs(rrsp.meta.year1ProgressiveRefund - expected) < 0.02,
    `80k income refund ${rrsp.meta.year1ProgressiveRefund} should match ${expected}`
  );
  assert.ok(expected > 2000 && expected < 4500, "Sanity band for 80k / 10k ON");
});

test("Pass2: year-boundary resets deduction trackers (each tax year separate)", () => {
  // Two years of annual $5k RRSP; progressive benefit each year starts from zero deductions.
  const result = runAccountStrategySimulation({
    contributionMode: "annual",
    contributionAmount: 5000,
    horizonYears: 2,
    annualReturn: 0,
    annualFees: 0,
    t_now: 40,
    t_ret: 30,
    refundMode: "spend",
    fhsaEligible: false,
    tfsaRemainingRoom: 0,
    rrspRemainingRoom: 1e9,
    ...progressiveOpts({ currentTaxableIncome: 90000, contributionYearIncome: 90000 })
  });
  const benefitCalc = createProgressiveDeductionBenefit({
    year: 2025,
    province: "ON",
    employmentIncome: 90000,
    taxData
  });
  const oneYear = benefitCalc.totalBenefit(5000, 0);
  // Year-1 meta only covers first 12 months of deposits ($5k annual → ~$5k).
  const y1 = getStrategy(result, "ALL_RRSP").meta.year1ProgressiveRefund;
  assert.ok(Math.abs(y1 - oneYear) < 1, `Year-1 refund ${y1} should match single-year benefit ${oneYear}`);
});

test("Pass2: share/query round-trip restores contribution-year income and refund mode", () => {
  const inputs = {
    contributionMode: "lump",
    contributionAmount: 30000,
    horizonYears: 20,
    annualReturn: 7,
    annualFees: 0.5,
    inflation: 2,
    useRealDollars: false,
    taxProvince: "ON",
    currentTaxableIncome: 80000,
    retirementTaxableIncome: 55000,
    manualRateOverride: false,
    t_now: 31.5,
    t_ret: 24.1,
    refundMode: "reinvest",
    tfsaRemainingRoom: 15000,
    rrspRemainingRoom: 40000,
    rrspUnusedCarryforward: 2000,
    fhsaEligible: true,
    fhsaAnnualRoom: 8000,
    fhsaLifetimeCap: 40000,
    tfsaNewAnnualRoom: 7000
  };
  const scenario = buildTfsaShareScenario(inputs);
  const parsed = parseTfsaShareQuery(scenario);
  assert.equal(parsed.contributionMode, "lump");
  assert.equal(parsed.currentTaxableIncome, 80000);
  assert.equal(parsed.taxProvince, "ON");
  assert.equal(parsed.refundMode, "reinvest");
  assert.equal(parsed.fhsaEligible, true);
  assert.equal(parsed.contributionAmount, 30000);
  assert.equal(parsed.rrspRemainingRoomSpecified, true);
});
