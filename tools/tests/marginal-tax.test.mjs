import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function loadDataOverride() {
  const dataPath = join(root, "calculators", "canada-income-tax", "data", "2025");
  return {
    federal: JSON.parse(readFileSync(join(dataPath, "federal.json"), "utf8")),
    provinces: JSON.parse(readFileSync(join(dataPath, "provinces.json"), "utf8")),
    payroll: JSON.parse(readFileSync(join(dataPath, "payroll.json"), "utf8")),
    dividends: JSON.parse(readFileSync(join(dataPath, "dividends.json"), "utf8"))
  };
}

const marginalTaxUrl = pathToFileURL(
  join(root, "calculators", "canada-income-tax", "js", "marginal-tax.js")
).href;
const taxEngineUrl = pathToFileURL(
  join(root, "calculators", "canada-income-tax", "js", "tax.engine.js")
).href;

const {
  MARGINAL_DELTA,
  combinedBracketMarginalRate,
  isMarginalRateInBounds
} = await import(marginalTaxUrl);
const { computePersonalTax } = await import(taxEngineUrl);

const dataOverride = loadDataOverride();

function personalTax(fields) {
  return computePersonalTax(
    {
      year: 2025,
      province: "ON",
      selfEmploymentIncome: 0,
      otherIncome: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0,
      ...fields
    },
    { dataOverride }
  );
}

test("MARGINAL_DELTA is 100 (not $1) to survive dollar-rounded net tax", () => {
  assert.equal(MARGINAL_DELTA, 100);
});

test("ON employment 120k: reported marginal matches $100 finite difference", () => {
  const base = personalTax({ employmentIncome: 120000 });
  const bumped = personalTax({ employmentIncome: 120000 + MARGINAL_DELTA });
  const fd = (bumped.totals.totalIncomeTax - base.totals.totalIncomeTax) / MARGINAL_DELTA;
  assert.ok(Math.abs(base.breakdown.marginalRates.employment - fd) < 0.02);
  assert.ok(base.totals.marginalRate > 0.35 && base.totals.marginalRate < 0.5);
});

test("ON employment 120k vs 70k: current marginal exceeds retirement marginal", () => {
  const now = personalTax({ employmentIncome: 120000 });
  const ret = personalTax({ employmentIncome: 70000 });
  assert.ok(now.totals.marginalRate > ret.totals.marginalRate);
});

test("eligible dividends only: employment marginal is null, combined uses dividend marginal", () => {
  const r = personalTax({ employmentIncome: 0, eligibleDividends: 100000 });
  assert.equal(r.breakdown.marginalRates.employment, null);
  assert.ok(isMarginalRateInBounds(r.totals.marginalRate));
  assert.ok(r.totals.marginalRate > 0);
});

test("RRSP simple bracket marginal uses pre-credit statutory stacks; personal engine includes credits", () => {
  const r = personalTax({ employmentIncome: 120000 });
  const ti = r.totals.taxableIncome;
  const bracketMarg = combinedBracketMarginalRate(
    ti,
    dataOverride.federal.brackets,
    dataOverride.provinces.ON.brackets
  );
  // Simple RRSP mode ignores credits; finite-difference personal rate is usually higher but same order of magnitude.
  assert.ok(isMarginalRateInBounds(bracketMarg));
  assert.ok(isMarginalRateInBounds(r.totals.marginalRate));
  assert.ok(Math.abs(r.totals.marginalRate - bracketMarg) < 0.12);
});

test("TFSA/RRSP scenario: 2k/mo reinvest picks RRSP when derived ON rates used", async () => {
  const engineUrl = pathToFileURL(
    join(root, "calculators", "tfsa-rrsp-fhsa", "engine.js")
  ).href;
  const { runAccountStrategySimulation } = await import(engineUrl);
  const now = personalTax({ employmentIncome: 120000 });
  const ret = personalTax({ employmentIncome: 70000 });
  const result = runAccountStrategySimulation({
    contributionMode: "monthly",
    contributionAmount: 2000,
    horizonYears: 25,
    annualReturn: 7,
    annualFees: 0.5,
    t_now: now.totals.marginalRate * 100,
    t_ret: ret.totals.marginalRate * 100,
    refundMode: "reinvest",
    fhsaEligible: false,
    tfsaRemainingRoom: 7000,
    rrspRemainingRoom: 21600,
    tfsaNewAnnualRoom: 7000,
    currentTaxableIncome: 120000,
    rrspAnnualNewRoomCap: 32490
  });
  assert.equal(result.optimalStrategyKey, "ALL_RRSP");
});
