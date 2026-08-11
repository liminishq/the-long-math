import { loadTaxData } from "../canada-income-tax/js/tax.data.js";
import { computePersonalTax } from "../canada-income-tax/js/tax.engine.js";
import {
  OFFICIAL_TAX_YEARS,
  isOfficialTaxYear,
  latestOfficialTaxYear,
  resolveTaxDataForYear
} from "../canada-income-tax/js/tax.projection.js";
import { getTaxBreakpoints } from "../canada-income-tax/js/tax.kinks.js";

const SUPPORTED_TAX_YEARS = OFFICIAL_TAX_YEARS.slice();
const DEFAULT_TAX_YEAR = latestOfficialTaxYear();
const TAX_DATA_BASE_PATH = "/calculators/canada-income-tax/data";
const CLOSE_ENOUGH_DOLLARS = 50;
/** Prefer a corner only when the split edge is within floating-point noise. */
const SPLIT_ADVANTAGE_THRESHOLD = 0.01;
const SPLIT_AMOUNT_TOLERANCE = 1;
/** Local $1 polish around the best candidate (catches missed nearby statutory kinks). */
const LOCAL_REFINE_RADIUS = 400;
const DEFAULT_INFLATION = 0.02;

const OFFICIAL_LOADS = new Map();

function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value).replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value) {
  return parseMoney(value) / 100;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function roundMoney(value) {
  return Math.round(Number(value) || 0);
}

/**
 * Years until the future claim year must be a non-negative integer so that
 * compounding horizon and future tax year stay aligned.
 * Fractional values are rejected — never rounded or truncated.
 */
function parseIntegerYears(value) {
  if (value == null || String(value).trim() === "") {
    return { ok: false, error: "yearsRequired", years: null, raw: value };
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) {
    return { ok: false, error: "yearsInvalid", years: null, raw: value };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, error: "fractionalYears", years: null, raw: value };
  }
  if (n < 0 || n > 40) {
    return { ok: false, error: "yearsRange", years: null, raw: value };
  }
  return { ok: true, error: null, years: n, raw: value };
}

function normalizeTaxYear(value) {
  const year = Number.parseInt(value, 10);
  return isOfficialTaxYear(year) ? year : DEFAULT_TAX_YEAR;
}

async function fsDataRootFromImportMeta() {
  try {
    if (typeof process === "undefined" || !process.versions?.node) return null;
    const [{ fileURLToPath }, { dirname, join }] = await Promise.all([
      import("node:url"),
      import("node:path")
    ]);
    return join(dirname(fileURLToPath(import.meta.url)), "../canada-income-tax/data");
  } catch {
    return null;
  }
}

async function loadOfficialYear(year, opts = {}) {
  const taxYear = normalizeTaxYear(year);
  const cacheKey = `${taxYear}|${opts.fsDataRoot || opts.basePath || TAX_DATA_BASE_PATH}`;
  if (!OFFICIAL_LOADS.has(cacheKey)) {
    OFFICIAL_LOADS.set(
      cacheKey,
      (async () => {
        const loadOpts = opts.fsDataRoot
          ? { fsDataRoot: opts.fsDataRoot }
          : { basePath: opts.basePath || TAX_DATA_BASE_PATH };
        if (!opts.fsDataRoot && !opts.basePath) {
          const fsRoot = await fsDataRootFromImportMeta();
          if (fsRoot) {
            loadOpts.fsDataRoot = fsRoot;
            delete loadOpts.basePath;
          }
        }
        return loadTaxData(taxYear, loadOpts);
      })()
    );
  }
  return OFFICIAL_LOADS.get(cacheKey);
}

/**
 * Future value of a refund over n years at annual rate r.
 * Returns null when (1+r) <= 0 and n is not an integer where the power is defined safely.
 */
function isNonNegativeIntegerYears(years) {
  const n = typeof years === "number" ? years : Number(years);
  return Number.isInteger(n) && n >= 0;
}

function futureValueOfRefund(refund, years, annualRate) {
  const amount = Math.max(0, Number(refund) || 0);
  const rate = Number(annualRate);

  // Refuse fractional or negative horizons rather than compounding with a coerced year count.
  if (!isNonNegativeIntegerYears(years)) return null;
  const horizon = years;

  if (horizon === 0) return amount;
  if (!Number.isFinite(rate)) return amount;
  if (1 + rate <= 0) return null;

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

function breakEvenAnnualRate(currentSaving, futureSaving, years) {
  if (!isNonNegativeIntegerYears(years)) return null;
  const n = years;
  const c = Number(currentSaving);
  const f = Number(futureSaving);
  if (!(n > 0) || !(c > 0) || !Number.isFinite(f) || f < 0) return null;
  if (f === 0) return -1;
  const ratio = f / c;
  if (!(ratio > 0)) return null;
  const rate = Math.pow(ratio, 1 / n) - 1;
  return Number.isFinite(rate) ? rate : null;
}

function runTaxScenario({
  year,
  province,
  employmentIncome,
  rrspDeduction,
  dataOverride,
  roundToDollar = false
}) {
  // Optimizer / timing comparisons use exact tax (no dollar rounding). Display layers may round.
  const opts = {
    ...(dataOverride ? { dataOverride } : {}),
    ...(roundToDollar === false ? { roundToDollar: false } : {})
  };
  const before = computePersonalTax(
    {
      year,
      province,
      employmentIncome,
      rrspDeduction: 0
    },
    opts
  );

  const after = computePersonalTax(
    {
      year,
      province,
      employmentIncome,
      rrspDeduction
    },
    opts
  );

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

function taxSavingOnly(args) {
  return runTaxScenario(args).taxSaved;
}

function collectIncomeKinkPoints(taxData, province, year) {
  const code = String(province || "").toUpperCase();
  const probe = (income) =>
    computePersonalTax(
      {
        year,
        province: code,
        employmentIncome: Math.max(0, income),
        rrspDeduction: 0
      },
      { dataOverride: taxData, roundToDollar: false }
    );

  // Shared breakpoints: brackets, BPA phase-outs, OHP, inverted OTR/surtax where applicable.
  return getTaxBreakpoints(taxData, code, {
    computeTaxAfterCredits: (income) => probe(income).breakdown?.provincial?.taxAfterCredits ?? 0,
    // OTR applies after surtax + DTC; taxBeforeReduction ≈ taxAfterDividendCredits.
    computeTaxBeforeReduction: (income) => {
      const p = probe(income).breakdown?.provincial || {};
      return p.taxAfterDividendCredits ?? p.taxAfterSurtax ?? p.taxAfterCredits ?? 0;
    },
    searchUpTo: 400000
  }).map((row) => row.income);
}

function taxableIncomeBeforeDeduction(year, province, employmentIncome, taxData) {
  const base = computePersonalTax(
    { year, province, employmentIncome, rrspDeduction: 0 },
    { dataOverride: taxData, roundToDollar: false }
  );
  return Number(base.totals?.taxableIncome);
}

function taxRowAtNetIncome(year, province, employmentIncome, ti0, ni, taxData) {
  const ded = Math.max(0, ti0 - ni);
  return computePersonalTax(
    { year, province, employmentIncome, rrspDeduction: ded },
    { dataOverride: taxData, roundToDollar: false }
  );
}

/**
 * Lowest net income where predicate(ni) is true, under fixed employment income.
 */
function invertNetIncomePredicate(year, province, employmentIncome, taxData, predicate) {
  const code = String(province || "").toUpperCase();
  const ti0 = taxableIncomeBeforeDeduction(year, code, employmentIncome, taxData);
  if (!(ti0 > 0)) return null;
  if (!predicate(taxRowAtNetIncome(year, code, employmentIncome, ti0, ti0, taxData), ti0)) {
    return null;
  }
  let low = 0;
  let high = ti0;
  for (let i = 0; i < 56; i++) {
    const mid = (low + high) / 2;
    if (predicate(taxRowAtNetIncome(year, code, employmentIncome, ti0, mid, taxData), mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

/**
 * Net-income point where an income-driven provincial reduction stops fully wiping
 * provincial tax, under a fixed employment income (CPP/EI credits held constant).
 */
function findProvincialReductionFullWipeNetIncome(year, province, employmentIncome, taxData) {
  const code = String(province || "").toUpperCase();
  const tr = taxData?.provinces?.[code]?.taxReduction;
  if (!tr || typeof tr !== "object") return null;
  const type = String(tr.type || "").toLowerCase();
  if (type !== "bc" && type !== "lowincome" && type !== "low_income") return null;

  const rawReduction = (ni) => {
    if (type === "bc") {
      const baseAmount = Number(tr.baseAmount) || 0;
      const thr = Number(tr.netIncomeThreshold) || 0;
      const factor = Number(tr.reductionFactor) || 0;
      const maxNi = Number(tr.maximumNetIncome);
      if (Number.isFinite(maxNi) && maxNi > 0 && ni >= maxNi) return 0;
      return Math.max(0, baseAmount - factor * Math.max(0, ni - thr));
    }
    const basic = Number(tr.basicReduction) || 0;
    const phaseOutBase = Number(tr.phaseOutBase) || 0;
    const phaseOutRate = Number(tr.phaseOutRate) || 0;
    return Math.max(0, basic - phaseOutRate * Math.max(0, ni - phaseOutBase));
  };

  return invertNetIncomePredicate(year, code, employmentIncome, taxData, (row, ni) => {
    const p = row.breakdown?.provincial || {};
    const taxBefore = Number(p.taxAfterDividendCredits ?? p.taxAfterSurtax ?? p.taxAfterCredits) || 0;
    return taxBefore > rawReduction(ni);
  });
}

/** Net income where federal (or provincial) net tax becomes positive under fixed employment. */
function findJurisdictionTaxOnsetNetIncome(year, province, employmentIncome, taxData, which) {
  return invertNetIncomePredicate(year, province, employmentIncome, taxData, (row) => {
    if (which === "federal") return Number(row.totals?.federalTax) > 0;
    if (which === "provincial") return Number(row.totals?.provTax) > 0;
    return Number(row.totals?.totalIncomeTax) > 0;
  });
}

/**
 * Map an income kink K into a deduction amount that lands taxable income near K.
 * RRSP deductions reduce net/taxable income approximately dollar-for-dollar.
 */
function deductionToReachIncome(taxableIncomeBefore, kink, maxDeduction) {
  if (!(maxDeduction > 0)) return null;
  if (!Number.isFinite(taxableIncomeBefore) || !Number.isFinite(kink)) return null;
  const x = taxableIncomeBefore - kink;
  if (x <= 0 || x >= maxDeduction) return null;
  return x;
}

function uniqueSortedAmounts(values, maxDeduction) {
  const out = new Set([0, maxDeduction]);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const clamped = Math.min(maxDeduction, Math.max(0, v));
    out.add(clamped);
    // Evaluate just around integer dollar boundaries for rounding discontinuities.
    out.add(Math.min(maxDeduction, Math.max(0, Math.floor(clamped))));
    out.add(Math.min(maxDeduction, Math.max(0, Math.ceil(clamped))));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Claim just enough this year to land taxable income on the next lower
 * federal or provincial tax-bracket threshold, then defer the remainder.
 *
 * This is an illustrative comparison strategy, not the optimizer result.
 * Uses statutory bracket thresholds only (not BPA / OHP / OTR kinks).
 *
 * @returns {{ claimNow: number, targetThreshold: number|null, neededClaim: number }}
 */
function claimAmountToExitCurrentBracket(taxableIncome, taxData, province, maxDeduction) {
  const ti = Number(taxableIncome);
  const D = Math.max(0, Number(maxDeduction) || 0);
  if (!Number.isFinite(ti) || !(ti > 0) || !(D > 0)) {
    return { claimNow: 0, targetThreshold: null, neededClaim: 0 };
  }

  const floors = [];
  for (const b of taxData?.federal?.brackets || []) {
    const t = Number(b.threshold);
    if (Number.isFinite(t) && t > 0 && t < ti) floors.push(t);
  }
  const code = String(province || "").toUpperCase();
  for (const b of taxData?.provinces?.[code]?.brackets || []) {
    const t = Number(b.threshold);
    if (Number.isFinite(t) && t > 0 && t < ti) floors.push(t);
  }
  if (!floors.length) {
    return { claimNow: 0, targetThreshold: null, neededClaim: 0 };
  }

  const targetThreshold = Math.max(...floors);
  const neededClaim = Math.max(0, ti - targetThreshold);
  return {
    claimNow: Math.min(D, neededClaim),
    targetThreshold,
    neededClaim
  };
}

/**
 * Maximize Value(x) = TaxSavingNow(x)*(1+r)^n + TaxSavingLater(D-x)
 * by evaluating breakpoints of the piecewise Canadian tax functions.
 */
function optimizeDeductionSplit({
  deductionAmount,
  currentIncome,
  futureIncome,
  yearsToWait,
  annualRate,
  province,
  currentYear,
  futureYear,
  currentData,
  futureData
}) {
  if (!isNonNegativeIntegerYears(yearsToWait)) {
    return {
      error: {
        code: "fractionalYears",
        field: "yearsToWait",
        raw: yearsToWait,
        message: "Years to wait must be a non-negative integer."
      },
      strategyKind: null,
      optimal: null,
      allNow: null,
      allLater: null,
      bracketExitSplit: null,
      bracketExitInfo: null,
      advantageVersusAllNow: null,
      advantageVersusAllLater: null,
      labels: null,
      sameYearComparison: false
    };
  }

  const D = Math.max(0, Number(deductionAmount) || 0);
  const currentBase = runTaxScenario({
    year: currentYear,
    province,
    employmentIncome: currentIncome,
    rrspDeduction: 0,
    dataOverride: currentData
  });
  const futureBase = runTaxScenario({
    year: futureYear,
    province,
    employmentIncome: futureIncome,
    rrspDeduction: 0,
    dataOverride: futureData
  });

  const currentTI = currentBase.before.totals.taxableIncome;
  const futureTI = futureBase.before.totals.taxableIncome;

  const candidates = [];
  for (const kink of collectIncomeKinkPoints(currentData, province, currentYear)) {
    const x = deductionToReachIncome(currentTI, kink, D);
    if (x != null) candidates.push(x);
  }
  for (const kink of collectIncomeKinkPoints(futureData, province, futureYear)) {
    const later = deductionToReachIncome(futureTI, kink, D);
    if (later != null) candidates.push(D - later);
  }

  // Employment-path credit / reduction full-wipe points (CPP/EI credits fixed with E).
  const addEmploymentPathKinks = (year, income, ti, data, toClaimNow) => {
    const extras = [
      findProvincialReductionFullWipeNetIncome(year, province, income, data),
      findJurisdictionTaxOnsetNetIncome(year, province, income, data, "federal"),
      findJurisdictionTaxOnsetNetIncome(year, province, income, data, "provincial"),
      findJurisdictionTaxOnsetNetIncome(year, province, income, data, "total")
    ];
    for (const kink of extras) {
      if (kink == null) continue;
      const amount = deductionToReachIncome(ti, kink, D);
      if (amount == null) continue;
      candidates.push(toClaimNow ? amount : D - amount);
    }
  };
  addEmploymentPathKinks(currentYear, currentIncome, currentTI, currentData, true);
  addEmploymentPathKinks(futureYear, futureIncome, futureTI, futureData, false);

  // Dense safety net for large deductions crossing many bands (still deterministic).
  if (D > 0) {
    const step = Math.max(250, Math.round(D / 80));
    for (let x = step; x < D; x += step) candidates.push(x);
  }

  const points = uniqueSortedAmounts(candidates, D);
  let best = null;

  const evaluateClaimNow = (claimNow) => {
    const carryForward = D - claimNow;
    const nowSaving = taxSavingOnly({
      year: currentYear,
      province,
      employmentIncome: currentIncome,
      rrspDeduction: claimNow,
      dataOverride: currentData
    });
    const laterSaving = taxSavingOnly({
      year: futureYear,
      province,
      employmentIncome: futureIncome,
      rrspDeduction: carryForward,
      dataOverride: futureData
    });
    const nowFv = futureValueOfRefund(nowSaving, yearsToWait, annualRate);
    if (nowFv == null) return null;
    return {
      claimNow,
      carryForward,
      nowSaving,
      laterSaving,
      nowFutureValue: nowFv,
      totalFutureValue: nowFv + laterSaving
    };
  };

  for (const x of points) {
    const row = evaluateClaimNow(x);
    if (!row) continue;
    if (!best || row.totalFutureValue > best.totalFutureValue + 1e-9) {
      best = row;
    }
  }

  if (best && D > 0) {
    const lo = Math.max(0, Math.floor(best.claimNow - LOCAL_REFINE_RADIUS));
    const hi = Math.min(D, Math.ceil(best.claimNow + LOCAL_REFINE_RADIUS));
    for (let x = lo; x <= hi; x += 1) {
      const row = evaluateClaimNow(x);
      if (row && row.totalFutureValue > best.totalFutureValue + 1e-9) best = row;
    }
  }

  if (!best) {
    best = {
      claimNow: D,
      carryForward: 0,
      nowSaving: 0,
      laterSaving: 0,
      nowFutureValue: 0,
      totalFutureValue: 0
    };
  }

  // Corner scenarios (always computed exactly).
  const cornerNowSaving = taxSavingOnly({
    year: currentYear,
    province,
    employmentIncome: currentIncome,
    rrspDeduction: D,
    dataOverride: currentData
  });
  const cornerNowFv = futureValueOfRefund(cornerNowSaving, yearsToWait, annualRate) ?? 0;
  const cornerLaterSaving = taxSavingOnly({
    year: futureYear,
    province,
    employmentIncome: futureIncome,
    rrspDeduction: D,
    dataOverride: futureData
  });

  const allNowScenario = {
    claimNow: D,
    carryForward: 0,
    nowSaving: cornerNowSaving,
    laterSaving: 0,
    nowFutureValue: cornerNowFv,
    totalFutureValue: cornerNowFv
  };
  const allLaterScenario = {
    claimNow: 0,
    carryForward: D,
    nowSaving: 0,
    laterSaving: cornerLaterSaving,
    nowFutureValue: 0,
    totalFutureValue: cornerLaterSaving
  };

  const bestCorner =
    allNowScenario.totalFutureValue >= allLaterScenario.totalFutureValue
      ? allNowScenario
      : allLaterScenario;

  let strategy = best;
  let strategyKind = "split";

  if (strategy.claimNow <= SPLIT_AMOUNT_TOLERANCE) {
    strategy = allLaterScenario;
    strategyKind = "all_later";
  } else if (strategy.carryForward <= SPLIT_AMOUNT_TOLERANCE) {
    strategy = allNowScenario;
    strategyKind = "all_now";
  } else {
    const splitEdge = strategy.totalFutureValue - bestCorner.totalFutureValue;
    if (splitEdge < SPLIT_ADVANTAGE_THRESHOLD) {
      strategy = bestCorner;
      strategyKind =
        bestCorner === allNowScenario || bestCorner.claimNow === D ? "all_now" : "all_later";
    } else {
      strategy = {
        ...strategy,
        claimNow: roundMoney(strategy.claimNow),
        carryForward: roundMoney(strategy.carryForward)
      };
      // Re-evaluate rounded split so displayed dollars match engine output.
      const roundedNow = strategy.claimNow;
      const roundedLater = Math.max(0, D - roundedNow);
      strategy.claimNow = roundedNow;
      strategy.carryForward = roundedLater;
      strategy.nowSaving = taxSavingOnly({
        year: currentYear,
        province,
        employmentIncome: currentIncome,
        rrspDeduction: roundedNow,
        dataOverride: currentData
      });
      strategy.laterSaving = taxSavingOnly({
        year: futureYear,
        province,
        employmentIncome: futureIncome,
        rrspDeduction: roundedLater,
        dataOverride: futureData
      });
      strategy.nowFutureValue = futureValueOfRefund(strategy.nowSaving, yearsToWait, annualRate) ?? 0;
      strategy.totalFutureValue = strategy.nowFutureValue + strategy.laterSaving;
      if (strategy.totalFutureValue - bestCorner.totalFutureValue < SPLIT_ADVANTAGE_THRESHOLD) {
        strategy = bestCorner;
        strategyKind =
          bestCorner.claimNow === D ? "all_now" : "all_later";
      }
    }
  }

  // Illustrative row for the comparison table when the result is a corner:
  // claim just enough to exit the current top federal/provincial bracket.
  let bracketExitSplit = null;
  const exitPlan = claimAmountToExitCurrentBracket(currentTI, currentData, province, D);
  const bracketExitClaim = roundMoney(exitPlan.claimNow);
  const bracketExitCarry = Math.max(0, roundMoney(D - bracketExitClaim));
  const bracketExitInfo = {
    neededClaim: roundMoney(exitPlan.neededClaim),
    targetThreshold:
      exitPlan.targetThreshold == null ? null : roundMoney(exitPlan.targetThreshold),
    availableDeduction: roundMoney(D),
    claimNow: bracketExitClaim,
    carryForward: bracketExitCarry,
    isInterior:
      bracketExitClaim > SPLIT_AMOUNT_TOLERANCE &&
      bracketExitCarry > SPLIT_AMOUNT_TOLERANCE
  };
  if (bracketExitInfo.isInterior) {
    const evaluated = evaluateClaimNow(bracketExitClaim);
    if (evaluated) {
      bracketExitSplit = {
        ...evaluated,
        claimNow: bracketExitClaim,
        carryForward: Math.max(0, D - bracketExitClaim),
        kind: "bracket_exit",
        targetTaxableIncome: bracketExitInfo.targetThreshold
      };
    }
  }

  return {
    strategyKind,
    optimal: strategy,
    allNow: allNowScenario,
    allLater: allLaterScenario,
    bracketExitSplit,
    bracketExitInfo,
    advantageVersusAllNow: strategy.totalFutureValue - allNowScenario.totalFutureValue,
    advantageVersusAllLater: strategy.totalFutureValue - allLaterScenario.totalFutureValue,
    candidatesEvaluated: points.length,
    labels: scenarioLabelsForYears(yearsToWait),
    sameYearComparison: yearsToWait === 0
  };
}

function buildRecommendation({ deferAdvantage, refundUse, strategyKind, splitAdvantageVsNow, yearsToWait }) {
  // n=0 is a same-year income-profile comparison, not a multi-year timing decision.
  if (yearsToWait === 0) {
    if (strategyKind === "split") {
      return {
        label: "Best allocation across income profiles",
        tone: "split",
        sentence:
          "Under these inputs, splitting the deduction across the two same-year income profiles produces a higher value than placing it all against either profile alone. This is not a multi-year timing decision."
      };
    }
    if (Math.abs(deferAdvantage) <= CLOSE_ENOUGH_DOLLARS) {
      return {
        label: "Mathematically close",
        tone: "neutral",
        sentence:
          "The modeled difference between the two same-year income profiles is small. This is not a multi-year timing decision."
      };
    }
    if (deferAdvantage > 0) {
      return {
        label: "Second income profile yields more tax saving",
        tone: "defer",
        sentence:
          "Under these inputs, the deduction produces a larger tax saving against the second income profile than the first. This is a same-year comparison, not a delay until another tax year."
      };
    }
    return {
      label: "First income profile yields more tax saving",
      tone: "claim",
      sentence:
        "Under these inputs, the deduction produces a larger tax saving against the first income profile. This is a same-year comparison, not a delay until another tax year.",
      splitAdvantageVsNow
    };
  }

  if (strategyKind === "split") {
    return {
      label: "Best deduction timing: partial claim",
      tone: "split",
      sentence:
        "Under these inputs, claiming part of the deduction now and carrying the rest forward produces a higher future-dated value than claiming the full amount all now or all later."
    };
  }

  if (Math.abs(deferAdvantage) <= CLOSE_ENOUGH_DOLLARS) {
    return {
      label: "Mathematically close",
      tone: "neutral",
      sentence:
        "The modeled difference is small. The cleaner answer may depend on certainty, cash-flow needs, and whether the refund would actually be used productively."
    };
  }

  if (deferAdvantage > 0) {
    return {
      label: "Saving the deduction is ahead",
      tone: "defer",
      sentence:
        "Under these inputs, the future tax saving is larger than the compounded value of using the refund now."
    };
  }

  return {
    label: "Claiming now is ahead",
    tone: "claim",
    sentence:
      refundUse === "debt"
        ? "Under these inputs, using the refund now at the debt payoff rate beats waiting for the higher-income year."
        : "Under these inputs, investing the refund now beats waiting for the higher-income year.",
    splitAdvantageVsNow
  };
}

function scenarioLabelsForYears(yearsToWait) {
  if (yearsToWait === 0) {
    return {
      allNow: "Against first income profile",
      allLater: "Against second income profile",
      split: "Split across both income profiles",
      claimNow: "Against first income",
      carryForward: "Against second income"
    };
  }
  return {
    allNow: "All now",
    allLater: "All later",
    split: "Optimized split",
    claimNow: "Claim now",
    carryForward: "Carry forward"
  };
}

async function computeDeductionTiming(rawInputs = {}, runtime = {}) {
  const currentTaxYear = normalizeTaxYear(rawInputs.taxYear ?? rawInputs.currentTaxYear);
  const province = rawInputs.province || "ON";
  const currentIncome = Math.max(0, parseMoney(rawInputs.currentIncome));
  const futureIncome = Math.max(0, parseMoney(rawInputs.futureIncome));
  const deductionAmount = Math.max(0, parseMoney(rawInputs.deductionAmount));
  const parsedYears = parseIntegerYears(rawInputs.yearsToWait);
  const refundUse = rawInputs.refundUse === "debt" ? "debt" : "invest";
  const annualRateRaw = parsePercent(rawInputs.annualRate);
  const annualRate = Number.isFinite(annualRateRaw) ? annualRateRaw : 0;
  const inflationRate = clamp(parsePercent(rawInputs.inflationRate ?? DEFAULT_INFLATION * 100), -0.05, 0.2);

  if (!parsedYears.ok) {
    return {
      error: {
        code: parsedYears.error,
        field: "yearsToWait",
        raw: parsedYears.raw,
        message:
          parsedYears.error === "fractionalYears"
            ? "Years to wait must be a whole number of tax years. Fractional values are not accepted."
            : parsedYears.error === "yearsRange"
              ? "Years to wait must be an integer between 0 and 40."
              : "Years to wait must be a non-negative integer."
      },
      inputs: {
        taxYear: currentTaxYear,
        currentTaxYear,
        futureTaxYear: null,
        province,
        currentIncome,
        futureIncome,
        deductionAmount,
        yearsToWait: parsedYears.raw,
        refundUse,
        annualRate,
        inflationRate
      },
      warnings: [parsedYears.error],
      current: null,
      future: null,
      comparison: null,
      optimization: null,
      taxTables: null
    };
  }

  const yearsToWait = parsedYears.years;

  // Future tax year advances by the same integer year count used for compounding.
  // Projection always bases on the latest official year ≤ future year (not the
  // user's possibly older selected current year).
  const futureTaxYear = currentTaxYear + yearsToWait;

  const loadOfficialYearBound = (year) =>
    loadOfficialYear(year, {
      fsDataRoot: runtime.fsDataRoot,
      basePath: runtime.basePath
    });

  const currentResolved = await resolveTaxDataForYear(currentTaxYear, {
    loadOfficialYear: loadOfficialYearBound,
    federalInflationRate: inflationRate,
    defaultProvincialInflationRate: inflationRate,
    provincialInflationRates: runtime.provincialInflationRates
  });

  const futureResolved = await resolveTaxDataForYear(futureTaxYear, {
    loadOfficialYear: loadOfficialYearBound,
    federalInflationRate: inflationRate,
    defaultProvincialInflationRate: inflationRate,
    provincialInflationRates: runtime.provincialInflationRates
  });

  // loadTaxData mutates module globals to the last loaded year. Ensure current
  // official data is active when no override is passed for current-year runs.
  await loadOfficialYearBound(currentTaxYear);

  const currentDataOverride = {
    federal: currentResolved.federal,
    provinces: currentResolved.provinces,
    payroll: currentResolved.payroll,
    dividends: currentResolved.dividends
  };
  const futureDataOverride = {
    federal: futureResolved.federal,
    provinces: futureResolved.provinces,
    payroll: futureResolved.payroll,
    dividends: futureResolved.dividends
  };

  const current = runTaxScenario({
    year: currentTaxYear,
    province,
    employmentIncome: currentIncome,
    rrspDeduction: deductionAmount,
    dataOverride: currentDataOverride
  });

  const future = runTaxScenario({
    year: futureTaxYear,
    province,
    employmentIncome: futureIncome,
    rrspDeduction: deductionAmount,
    dataOverride: futureDataOverride
  });

  const claimNowFutureValue = futureValueOfRefund(current.taxSaved, yearsToWait, annualRate);
  const deferValue = future.taxSaved;
  const safeClaimNowFv = claimNowFutureValue == null ? null : claimNowFutureValue;
  const deferAdvantage =
    safeClaimNowFv == null ? null : deferValue - safeClaimNowFv;
  const rawTaxDifference = future.taxSaved - current.taxSaved;
  const requiredFutureTaxSaving = safeClaimNowFv;
  const requiredFutureBlendedRate =
    deductionAmount > 0 && requiredFutureTaxSaving != null
      ? requiredFutureTaxSaving / deductionAmount
      : 0;
  const breakEven = breakEvenAnnualRate(current.taxSaved, future.taxSaved, yearsToWait);

  // Bad rates make compounding undefined; use r=0 so FV(now) = now saving without
  // rewriting the year count (which would mis-label a multi-year case as same-year).
  const rateForOptimization = annualRate <= -1 ? 0 : annualRate;
  const optimization = optimizeDeductionSplit({
    deductionAmount,
    currentIncome,
    futureIncome,
    yearsToWait,
    annualRate: rateForOptimization,
    province,
    currentYear: currentTaxYear,
    futureYear: futureTaxYear,
    currentData: currentDataOverride,
    futureData: futureDataOverride
  });

  // Pathological opportunity-cost rates make compounding undefined; fall back to tax-only corners.
  if (annualRate <= -1) {
    const taxOnlyDefer = future.taxSaved - current.taxSaved;
    optimization.strategyKind = taxOnlyDefer > CLOSE_ENOUGH_DOLLARS ? "all_later" : "all_now";
    optimization.optimal =
      optimization.strategyKind === "all_later" ? optimization.allLater : optimization.allNow;
    optimization.advantageVersusAllNow =
      optimization.optimal.totalFutureValue - optimization.allNow.totalFutureValue;
    optimization.advantageVersusAllLater =
      optimization.optimal.totalFutureValue - optimization.allLater.totalFutureValue;
  }

  const recommendation = buildRecommendation({
    deferAdvantage: deferAdvantage ?? 0,
    refundUse,
    strategyKind: optimization.strategyKind,
    splitAdvantageVsNow: optimization.advantageVersusAllNow,
    yearsToWait
  });

  const warnings = [];
  if (deductionAmount <= 0) warnings.push("deduction");
  if (!province) warnings.push("province");
  if (futureIncome <= currentIncome) warnings.push("income");
  if (current.taxSaved === 0 && deductionAmount > 0) warnings.push("noTax");
  if (
    deductionAmount >
    Math.max(current.before.totals.netIncome, future.before.totals.netIncome)
  ) {
    warnings.push("largeDeduction");
  }
  if (annualRate <= -1) warnings.push("badRate");
  if (claimNowFutureValue == null) warnings.push("badRate");
  if (yearsToWait === 0) warnings.push("sameYear");

  return {
    inputs: {
      taxYear: currentTaxYear,
      currentTaxYear,
      futureTaxYear,
      province,
      currentIncome,
      futureIncome,
      deductionAmount,
      yearsToWait,
      refundUse,
      annualRate,
      inflationRate,
      sameYearComparison: yearsToWait === 0
    },
    taxTables: {
      current: {
        year: currentTaxYear,
        source: currentResolved.meta?.source || "official",
        projected: Boolean(currentResolved.meta?.projected)
      },
      future: {
        year: futureTaxYear,
        source: futureResolved.meta?.source || (futureResolved.meta?.projected ? "projected" : "official"),
        projected: Boolean(futureResolved.meta?.projected),
        baseYear: futureResolved.meta?.baseYear ?? futureTaxYear,
        yearsAhead: futureResolved.meta?.yearsAhead ?? 0,
        inflationRate: futureResolved.meta?.federalInflationRate ?? inflationRate
      }
    },
    current,
    future,
    comparison: {
      claimNowFutureValue: safeClaimNowFv,
      deferValue,
      deferAdvantage,
      rawTaxDifference,
      requiredFutureTaxSaving,
      requiredFutureBlendedRate,
      breakEvenAnnualRate: breakEven,
      recommendation
    },
    optimization,
    sameYearComparison: yearsToWait === 0,
    warnings
  };
}

export {
  SUPPORTED_TAX_YEARS,
  DEFAULT_TAX_YEAR,
  OFFICIAL_TAX_YEARS,
  CLOSE_ENOUGH_DOLLARS,
  SPLIT_ADVANTAGE_THRESHOLD,
  parseMoney,
  parsePercent,
  parseIntegerYears,
  isNonNegativeIntegerYears,
  futureValueOfRefund,
  breakEvenAnnualRate,
  optimizeDeductionSplit,
  computeDeductionTiming,
  loadOfficialYear,
  isOfficialTaxYear
};
