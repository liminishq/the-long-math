import { loadTaxData } from "../canada-income-tax/js/tax.data.js";
import { computePersonalTax } from "../canada-income-tax/js/tax.engine.js";

const SUPPORTED_TAX_YEARS = [2025, 2026];
const DEFAULT_TAX_YEAR = 2026;
const TAX_DATA_BASE_PATH = "/calculators/canada-income-tax/data";
const CLOSE_ENOUGH_DOLLARS = 50;

const TAX_DATA_LOADS = new Map();

function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value).replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value) {
  const n = parseMoney(value);
  return n / 100;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeTaxYear(value) {
  const year = Number.parseInt(value, 10);
  return SUPPORTED_TAX_YEARS.includes(year) ? year : DEFAULT_TAX_YEAR;
}

async function ensureTaxDataLoaded(year) {
  const taxYear = normalizeTaxYear(year);
  if (!TAX_DATA_LOADS.has(taxYear)) {
    TAX_DATA_LOADS.set(
      taxYear,
      loadTaxData(taxYear, { basePath: TAX_DATA_BASE_PATH })
    );
  }
  await TAX_DATA_LOADS.get(taxYear);
  return taxYear;
}

function futureValueOfRefund(refund, years, annualRate) {
  const amount = Math.max(0, Number(refund) || 0);
  const horizon = clamp(Math.round(Number(years) || 1), 1, 40);
  const rate = Number.isFinite(annualRate) ? annualRate : 0;
  const engine = globalThis.InvestmentGrowthEngine;

  if (engine && typeof engine.simulateInvestment === "function") {
    const result = engine.simulateInvestment({
      startingAmount: amount,
      contributionPerPeriod: 0,
      years: horizon,
      nominalAnnualReturn: rate,
      inflationAnnual: 0,
      contributionPeriodsPerYear: 1,
      contributionAtBeginning: false,
      indexContributionsToInflation: false
    });
    return result.finalBalanceNominal;
  }

  return amount * Math.pow(1 + rate, horizon);
}

function runTaxScenario({ year, province, employmentIncome, rrspDeduction }) {
  const before = computePersonalTax({
    year,
    province,
    employmentIncome,
    rrspDeduction: 0
  });

  const after = computePersonalTax({
    year,
    province,
    employmentIncome,
    rrspDeduction
  });

  const taxSaved = Math.max(0, before.totals.totalIncomeTax - after.totals.totalIncomeTax);
  const blendedRate = rrspDeduction > 0 ? taxSaved / rrspDeduction : 0;

  return {
    before,
    after,
    taxSaved,
    blendedRate,
    marginalRateBefore: before.marginalRates?.employment ?? before.marginalRates?.combined ?? 0
  };
}

function buildRecommendation(advantage, refundUse) {
  if (Math.abs(advantage) <= CLOSE_ENOUGH_DOLLARS) {
    return {
      label: "Mathematically close",
      tone: "neutral",
      sentence: "The modeled difference is small. The cleaner answer may depend on certainty, cash-flow needs, and whether the refund would actually be used productively."
    };
  }

  if (advantage > 0) {
    return {
      label: "Saving the deduction is ahead",
      tone: "defer",
      sentence: "Under these inputs, the future tax saving is larger than the compounded value of using the refund now."
    };
  }

  return {
    label: "Claiming now is ahead",
    tone: "claim",
    sentence: refundUse === "debt"
      ? "Under these inputs, using the refund now at the debt payoff rate beats waiting for the higher-income year."
      : "Under these inputs, investing the refund now beats waiting for the higher-income year."
  };
}

async function computeDeductionTiming(rawInputs) {
  const taxYear = await ensureTaxDataLoaded(rawInputs.taxYear);
  const province = rawInputs.province || "ON";
  const currentIncome = Math.max(0, parseMoney(rawInputs.currentIncome));
  const futureIncome = Math.max(0, parseMoney(rawInputs.futureIncome));
  const deductionAmount = Math.max(0, parseMoney(rawInputs.deductionAmount));
  const yearsToWait = clamp(Math.round(parseMoney(rawInputs.yearsToWait) || 1), 1, 40);
  const refundUse = rawInputs.refundUse === "debt" ? "debt" : "invest";
  const annualRate = clamp(parsePercent(rawInputs.annualRate), -0.5, 1);

  const current = runTaxScenario({
    year: taxYear,
    province,
    employmentIncome: currentIncome,
    rrspDeduction: deductionAmount
  });

  const future = runTaxScenario({
    year: taxYear,
    province,
    employmentIncome: futureIncome,
    rrspDeduction: deductionAmount
  });

  const claimNowFutureValue = futureValueOfRefund(current.taxSaved, yearsToWait, annualRate);
  const deferValue = future.taxSaved;
  const deferAdvantage = deferValue - claimNowFutureValue;
  const rawTaxDifference = future.taxSaved - current.taxSaved;
  const requiredFutureTaxSaving = claimNowFutureValue;
  const requiredFutureBlendedRate = deductionAmount > 0 ? requiredFutureTaxSaving / deductionAmount : 0;
  const breakEvenAnnualRate = current.taxSaved > 0 && future.taxSaved > 0 && yearsToWait > 0
    ? Math.pow(future.taxSaved / current.taxSaved, 1 / yearsToWait) - 1
    : null;

  const warnings = [];
  if (deductionAmount <= 0) {
    warnings.push("deduction");
  }
  if (!province) {
    warnings.push("province");
  }
  if (futureIncome <= currentIncome) {
    warnings.push("income");
  }
  if (current.taxSaved === 0 && deductionAmount > 0) {
    warnings.push("noTax");
  }
  if (deductionAmount > Math.max(current.before.totals.netIncome, future.before.totals.netIncome)) {
    warnings.push("largeDeduction");
  }

  return {
    inputs: {
      taxYear,
      province,
      currentIncome,
      futureIncome,
      deductionAmount,
      yearsToWait,
      refundUse,
      annualRate
    },
    current,
    future,
    comparison: {
      claimNowFutureValue,
      deferValue,
      deferAdvantage,
      rawTaxDifference,
      requiredFutureTaxSaving,
      requiredFutureBlendedRate,
      breakEvenAnnualRate,
      recommendation: buildRecommendation(deferAdvantage, refundUse)
    },
    warnings
  };
}

export {
  SUPPORTED_TAX_YEARS,
  DEFAULT_TAX_YEAR,
  parseMoney,
  computeDeductionTiming
};
