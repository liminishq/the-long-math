/**
 * Combined marginal-rate thresholds for ordinary taxable income.
 *
 * Architecture: canonical tax data → computePersonalTax → threshold analysis.
 * Does not maintain a separate tax-rate table.
 *
 * Ordinary taxable income is modeled as `otherIncome` so CPP/EI and the
 * Canada Employment Amount do not distort the progressive income-tax schedule.
 *
 * Threshold T means: at income just below T the next-dollar combined income-tax
 * rate differs from the rate at income T (engine bracket tops are exclusive of
 * the next band; new statutory rates apply to income above the published threshold).
 */

import { computePersonalTax, MARGINAL_DELTA } from './tax.engine.js';
import { normalizeProvince } from './tax.data.js';
import { isMarginalRateInBounds } from './marginal-tax.js';
import { OFFICIAL_TAX_YEARS } from './tax.indexation.js';
import { ONTARIO_HEALTH_PREMIUM_KINKS } from './tax.kinks.js';

/** Keep in sync with folders under calculators/canada-income-tax/data/. */
export const SUPPORTED_TAX_YEARS = OFFICIAL_TAX_YEARS.slice();

export const TAX_DATA_BASE_PATH = '/calculators/canada-income-tax/data';

/** Probe for next-dollar rate on unrounded tax (avoids dollar-rounding artefacts). */
export const ORDINARY_MARGINAL_DELTA = 1;

const RATE_CHANGE_EPS = 5e-5; // 0.005 percentage points
const INCOME_MERGE_EPS = 0.005; // merge candidates within half a cent
const BINARY_SEARCH_ITERS = 56;

function emptyIncomeFields() {
  return {
    employmentIncome: 0,
    selfEmploymentIncome: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    capitalGains: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0
  };
}

/**
 * @param {number} year
 * @param {string} province
 * @param {number} taxableIncome
 * @param {object} [opts] - passed to computePersonalTax (dataOverride, roundToDollar, …)
 */
export function ordinaryIncomeInput(year, province, taxableIncome) {
  return {
    year,
    province,
    otherIncome: Math.max(0, Number(taxableIncome) || 0),
    ...emptyIncomeFields()
  };
}

/**
 * Full engine result for ordinary taxable income.
 * Defaults to rounded display totals (matches Canada Income Tax Calculator).
 */
export function computeOrdinaryIncomeTax(year, province, taxableIncome, opts = {}) {
  return computePersonalTax(ordinaryIncomeInput(year, province, taxableIncome), opts);
}

/**
 * Unrounded ordinary-income tax result (for marginal / threshold analysis).
 */
export function computeOrdinaryIncomeTaxExact(year, province, taxableIncome, opts = {}) {
  return computePersonalTax(ordinaryIncomeInput(year, province, taxableIncome), {
    ...opts,
    roundToDollar: false
  });
}

/**
 * Combined next-dollar income-tax rate on ordinary taxable income.
 * Uses unrounded tax and a $1 bump unless a custom delta is supplied.
 */
export function ordinaryMarginalRate(year, province, taxableIncome, opts = {}) {
  const income = Math.max(0, Number(taxableIncome) || 0);
  const delta = Number(opts.delta) > 0 ? Number(opts.delta) : ORDINARY_MARGINAL_DELTA;
  const base = computeOrdinaryIncomeTaxExact(year, province, income, opts);
  const bumped = computeOrdinaryIncomeTaxExact(year, province, income + delta, opts);
  const rate = (bumped.totals.totalIncomeTax - base.totals.totalIncomeTax) / delta;
  if (!isMarginalRateInBounds(rate)) {
    // Pathological numerical noise — clamp only after flagging via NaN check.
    if (!Number.isFinite(rate)) return 0;
    return Math.min(1, Math.max(0, rate));
  }
  return rate;
}

function ratesDiffer(a, b) {
  return Math.abs((a ?? 0) - (b ?? 0)) > RATE_CHANGE_EPS;
}

function addCandidate(map, income, reason) {
  const value = Number(income);
  if (!Number.isFinite(value) || value <= 0) return;
  const key = Math.round(value * 100) / 100;
  if (!map.has(key)) map.set(key, new Set());
  if (reason) map.get(key).add(reason);
}

function binarySearchCrossing(isAbove, lo, hi) {
  let low = lo;
  let high = hi;
  for (let i = 0; i < BINARY_SEARCH_ITERS; i++) {
    const mid = (low + high) / 2;
    if (isAbove(mid)) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * Find smallest income in (lo, hi] where predicate becomes true.
 * Returns null if never true at hi.
 */
function findFirstWhere(predicate, lo, hi) {
  if (!predicate(hi)) return null;
  if (predicate(lo)) return lo > 0 ? lo : null;
  return binarySearchCrossing(predicate, lo, hi);
}

/**
 * Invert Ontario surtax (thresholds are on post-credit Ontario tax, not income).
 */
function findOntarioSurtaxIncomeThresholds(year, province, surtax, opts) {
  const out = [];
  if (!surtax || province !== 'ON') return out;

  const taxAfterCredits = (income) => {
    const r = computeOrdinaryIncomeTaxExact(year, province, income, opts);
    return r.breakdown?.provincial?.taxAfterCredits ?? 0;
  };

  const searchUpTo = 400000;
  for (const [threshold, label] of [
    [surtax.threshold, 'Ontario surtax'],
    [surtax.threshold2, 'Ontario surtax']
  ]) {
    if (!(threshold > 0)) continue;
    if (!(taxAfterCredits(searchUpTo) > threshold)) continue;
    const incomeAt = findFirstWhere((inc) => taxAfterCredits(inc) > threshold, 0, searchUpTo);
    if (incomeAt != null) out.push({ income: incomeAt, reason: label });
  }
  return out;
}

/**
 * Collect candidate kink points from canonical parameters + known engine formulas,
 * then keep only points where the combined next-dollar rate actually changes.
 *
 * @returns {{ income: number, reason: string|null, rateBelow: number, rateAtOrAbove: number }[]}
 */
export function findCombinedTaxThresholds(year, province, opts = {}) {
  const code = normalizeProvince(province);
  if (!code) throw new Error(`Unrecognized province "${province}"`);

  // Need data: load via a probe calculation (opts.dataOverride or previously loaded data).
  const probe = computeOrdinaryIncomeTaxExact(year, code, 100000, opts);
  const federal = opts.dataOverride?.federal;
  const provinces = opts.dataOverride?.provinces;
  // Prefer override; otherwise read bracket lines / re-derive from a second source.
  // computePersonalTax does not return raw data objects — require dataOverride in Node,
  // or pass federal/provincial via opts.taxData.
  const taxData = opts.taxData || opts.dataOverride;
  if (!taxData?.federal?.brackets || !taxData?.provinces?.[code]) {
    throw new Error(
      'findCombinedTaxThresholds requires opts.taxData or opts.dataOverride with federal + provinces.'
    );
  }

  void probe;
  const fed = taxData.federal;
  const prov = taxData.provinces[code];
  const candidates = new Map();

  for (const b of fed.brackets || []) {
    if (b.threshold > 0) addCandidate(candidates, b.threshold, 'Federal tax bracket');
  }
  for (const b of prov.brackets || []) {
    if (b.threshold > 0) {
      addCandidate(candidates, b.threshold, `${prov.name || code} tax bracket`);
    }
  }

  // Credit exhaustion: where federal / provincial / combined income tax becomes positive.
  const searchHi = 80000;
  const fedTax = (inc) => computeOrdinaryIncomeTaxExact(year, code, inc, opts).totals.federalTax;
  const provTax = (inc) => computeOrdinaryIncomeTaxExact(year, code, inc, opts).totals.provTax;
  const totTax = (inc) => computeOrdinaryIncomeTaxExact(year, code, inc, opts).totals.totalIncomeTax;

  const fedStart = findFirstWhere((inc) => fedTax(inc) > 0, 0, searchHi);
  if (fedStart != null) addCandidate(candidates, fedStart, 'Federal tax begins (credits exhausted)');

  const provStart = findFirstWhere((inc) => provTax(inc) > 0, 0, searchHi);
  if (provStart != null) {
    addCandidate(candidates, provStart, `${prov.name || code} tax begins (credits exhausted)`);
  }

  // Combined may coincide with one of the above; still useful if they differ slightly.
  const totStart = findFirstWhere((inc) => totTax(inc) > 0, 0, searchHi);
  if (totStart != null) addCandidate(candidates, totStart, null);

  if (code === 'ON') {
    for (const kink of ONTARIO_HEALTH_PREMIUM_KINKS) {
      addCandidate(candidates, kink.income, kink.reason);
    }
    const surtax = (prov.surtaxes && prov.surtaxes[0]) || null;
    for (const { income, reason } of findOntarioSurtaxIncomeThresholds(year, code, surtax, opts)) {
      addCandidate(candidates, income, reason);
    }
  }

  // Generic provincial surtax income inversion (non-ON path uses tax-after-credits base).
  if (code !== 'ON') {
    for (const surtax of prov.surtaxes || []) {
      const taxAfterCredits = (income) => {
        const r = computeOrdinaryIncomeTaxExact(year, code, income, opts);
        return r.breakdown?.provincial?.taxAfterCredits ?? 0;
      };
      for (const thr of [surtax.threshold, surtax.threshold2]) {
        if (!(thr > 0)) continue;
        const hit = findFirstWhere((inc) => taxAfterCredits(inc) > thr, 0, 500000);
        if (hit != null) addCandidate(candidates, hit, surtax.name || 'Provincial surtax');
      }
    }
  }

  const sortedIncomes = [...candidates.keys()].sort((a, b) => a - b);
  const verified = [];

  for (const income of sortedIncomes) {
    const belowIncome = Math.max(0, income - ORDINARY_MARGINAL_DELTA);
    const rateBelow = ordinaryMarginalRate(year, code, belowIncome, opts);
    const rateAt = ordinaryMarginalRate(year, code, income, opts);
    if (!ratesDiffer(rateBelow, rateAt)) continue;

    const reasons = [...(candidates.get(income) || [])].filter(Boolean);
    // Prefer a single clean reason; if multiple, join only confident labels.
    let reason = null;
    if (reasons.length === 1) reason = reasons[0];
    else if (reasons.length > 1) {
      // Drop null-ish / generic duplicates; if still ambiguous, omit reason.
      const unique = [...new Set(reasons)];
      reason = unique.length === 1 ? unique[0] : unique.join('; ');
      // If joined string is noisy (credit + bracket at same point), keep it — informative.
    }

    // Merge with previous if extremely close.
    const prev = verified[verified.length - 1];
    if (prev && Math.abs(prev.income - income) <= INCOME_MERGE_EPS) {
      if (reason && prev.reason && prev.reason !== reason) {
        prev.reason = `${prev.reason}; ${reason}`;
      } else if (reason && !prev.reason) {
        prev.reason = reason;
      }
      prev.rateAtOrAbove = rateAt;
      continue;
    }

    verified.push({
      income,
      reason,
      rateBelow,
      rateAtOrAbove: rateAt
    });
  }

  return verified;
}

/**
 * Build the combined marginal-rate schedule (ranges between verified thresholds).
 */
export function buildCombinedMarginalSchedule(year, province, opts = {}) {
  const code = normalizeProvince(province);
  const thresholds = findCombinedTaxThresholds(year, code, opts);
  const bands = [];

  const points = [0, ...thresholds.map((t) => t.income), Infinity];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    // Sample mid-band (or just above lower bound) for the prevailing next-dollar rate.
    const sample =
      to === Infinity
        ? from + 1000
        : from + Math.min(100, Math.max(ORDINARY_MARGINAL_DELTA, (to - from) / 2));
    const marginalRate = ordinaryMarginalRate(year, code, sample, opts);
    const changeAtStart = i === 0 ? null : thresholds[i - 1];
    bands.push({
      from,
      to: to === Infinity ? null : to,
      marginalRate,
      changeReason: changeAtStart?.reason ?? null
    });
  }

  return { thresholds, bands };
}

/**
 * Locate previous / next verified thresholds relative to taxable income.
 *
 * Convention: a threshold at T applies to the next-dollar rate for income ≥ T.
 * - previous: largest T where T ≤ income (the band floor), or null if none
 * - next: smallest T where T > income, or null if none
 *
 * For the "previous threshold" UX (income needed to fall below), we use the
 * largest T with T ≤ income when income is strictly above T; when income is
 * exactly T, previous is still T (user is at the boundary of the current band).
 */
export function locateThresholds(thresholds, taxableIncome) {
  const income = Math.max(0, Number(taxableIncome) || 0);
  const sorted = [...thresholds].sort((a, b) => a.income - b.income);

  let previous = null;
  let next = null;
  for (const t of sorted) {
    if (t.income <= income + INCOME_MERGE_EPS) previous = t;
    if (t.income > income + INCOME_MERGE_EPS) {
      next = t;
      break;
    }
  }

  return { previous, next };
}

/**
 * Full analysis for the bracket calculator UI.
 */
export function analyzeOrdinaryTaxPosition(year, province, taxableIncome, opts = {}) {
  const code = normalizeProvince(province);
  if (!code) throw new Error(`Unrecognized province "${province}"`);

  const income = Math.max(0, Number(taxableIncome) || 0);
  const rounded = computeOrdinaryIncomeTax(year, code, income, opts);
  const exact = computeOrdinaryIncomeTaxExact(year, code, income, opts);
  const marginalRate = ordinaryMarginalRate(year, code, income, opts);
  const avgRate = income > 0 ? rounded.totals.totalIncomeTax / income : 0;

  const { thresholds, bands } = buildCombinedMarginalSchedule(year, code, opts);
  const { previous, next } = locateThresholds(thresholds, income);

  const currentBand = bands.find((b) => {
    const lo = b.from;
    const hi = b.to == null ? Infinity : b.to;
    return income >= lo - INCOME_MERGE_EPS && income < hi - INCOME_MERGE_EPS;
  }) || bands[bands.length - 1];

  let nextCard = null;
  if (next) {
    const atThreshold = computeOrdinaryIncomeTax(year, code, next.income, opts);
    const aboveIncome = next.income; // next-dollar rate at T
    const aboveMarginal = ordinaryMarginalRate(year, code, aboveIncome, opts);
    const aboveAvg =
      next.income > 0 ? atThreshold.totals.totalIncomeTax / next.income : 0;
    const additionalTax = atThreshold.totals.totalIncomeTax - rounded.totals.totalIncomeTax;
    const additionalAfterTax =
      atThreshold.totals.afterTaxIncome - rounded.totals.afterTaxIncome;
    nextCard = {
      threshold: next.income,
      reason: next.reason,
      distanceBelow: next.income - income,
      current: {
        taxableIncome: income,
        marginalRate,
        averageRate: avgRate
      },
      above: {
        taxableIncome: next.income,
        marginalRate: aboveMarginal,
        averageRate: aboveAvg,
        totalIncomeTax: atThreshold.totals.totalIncomeTax,
        afterTaxIncome: atThreshold.totals.afterTaxIncome
      },
      additionalTax,
      additionalAfterTax
    };
  }

  let previousCard = null;
  if (!previous) {
    previousCard = { none: true };
  } else {
    const belowIncome = Math.max(0, previous.income - ORDINARY_MARGINAL_DELTA);
    const belowResult = computeOrdinaryIncomeTax(year, code, belowIncome, opts);
    const belowMarginal = ordinaryMarginalRate(year, code, belowIncome, opts);
    const belowAvg =
      belowIncome > 0 ? belowResult.totals.totalIncomeTax / belowIncome : 0;
    // Dollars of income reduction needed to sit immediately below the threshold.
    const distanceToFallBelow = Math.max(0, income - belowIncome);
    previousCard = {
      threshold: previous.income,
      reason: previous.reason,
      distanceAbove: Math.max(0, income - previous.income),
      distanceToFallBelow,
      atExactThreshold: income <= previous.income + INCOME_MERGE_EPS,
      current: {
        taxableIncome: income,
        marginalRate,
        averageRate: avgRate
      },
      below: {
        taxableIncome: belowIncome,
        marginalRate: belowMarginal,
        averageRate: belowAvg,
        totalIncomeTax: belowResult.totals.totalIncomeTax,
        afterTaxIncome: belowResult.totals.afterTaxIncome
      },
      reductionInTaxableIncome: distanceToFallBelow,
      reductionInIncomeTax: rounded.totals.totalIncomeTax - belowResult.totals.totalIncomeTax,
      reductionInAfterTaxIncome:
        rounded.totals.afterTaxIncome - belowResult.totals.afterTaxIncome
    };
  }

  return {
    year,
    province: code,
    taxableIncome: income,
    federalTax: rounded.totals.federalTax,
    provincialTax: rounded.totals.provTax,
    totalIncomeTax: rounded.totals.totalIncomeTax,
    afterTaxIncome: rounded.totals.afterTaxIncome,
    averageRate: avgRate,
    marginalRate,
    exactTotalIncomeTax: exact.totals.totalIncomeTax,
    currentBand,
    thresholds,
    bands,
    next: nextCard,
    previous: previousCard,
    engine: rounded
  };
}

/**
 * Independent finite-difference check (for tests).
 */
export function finiteDifferenceMarginal(year, province, taxableIncome, delta, opts = {}) {
  return ordinaryMarginalRate(year, province, taxableIncome, { ...opts, delta });
}

export { MARGINAL_DELTA };
