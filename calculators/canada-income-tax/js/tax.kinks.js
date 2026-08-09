/**
 * Shared income kink / breakpoint collectors for progressive Canadian tax.
 *
 * Used by threshold analysis and by the RRSP deduction-timing optimizer so
 * tax-law kink knowledge is not duplicated inside calculator UI code.
 */

import { resolveEnhancedBasicPersonalAmount } from "./tax.bpa.js";

/** Ontario Health Premium statutory kink incomes (Taxation Act, 2007). Not CPI-indexed. */
export const ONTARIO_HEALTH_PREMIUM_KINK_POINTS = [
  20000, 25000, 36000, 38500, 48000, 48600, 72000, 72600, 200000, 200600
];

/**
 * Collect statutory income points where the combined tax function can change slope.
 *
 * @param {object} taxData - { federal, provinces }
 * @param {string} provinceCode
 * @param {object} [incomeContext]
 * @param {(income:number)=>number} [incomeContext.computeTaxAfterCredits] - for ON surtax inversion
 * @param {(income:number)=>number} [incomeContext.computeTaxBeforeReduction] - for ON OTR inversion
 * @param {number} [incomeContext.searchUpTo]
 * @returns {{ income: number, reason: string }[]}
 */
export function collectTaxIncomeKinks(taxData, provinceCode, incomeContext = {}) {
  const code = String(provinceCode || "").toUpperCase();
  const out = [];
  const add = (income, reason) => {
    const n = Number(income);
    if (!Number.isFinite(n) || n <= 0) return;
    out.push({ income: n, reason: reason || "Tax kink" });
  };

  const federal = taxData?.federal;
  const prov = taxData?.provinces?.[code];

  for (const b of federal?.brackets || []) {
    if (b.threshold > 0) add(b.threshold, "Federal tax bracket");
  }
  for (const b of prov?.brackets || []) {
    if (b.threshold > 0) add(b.threshold, `${prov.name || code} tax bracket`);
  }

  const fedBpa = federal?.credits?.basicPersonalAmount;
  if (fedBpa) {
    const resolved = resolveEnhancedBasicPersonalAmount(fedBpa, 0, federal.brackets);
    if (resolved.phaseOutStart > 0) add(resolved.phaseOutStart, "Federal BPA phase-out start");
    if (resolved.phaseOutEnd > 0) add(resolved.phaseOutEnd, "Federal BPA phase-out end");
  }

  const provBpa = prov?.credits?.basicPersonalAmount;
  if (provBpa && (provBpa.minimum != null || provBpa.phaseOutStart != null)) {
    const resolved = resolveEnhancedBasicPersonalAmount(provBpa, 0, null);
    if (resolved.phaseOutStart > 0) add(resolved.phaseOutStart, `${code} BPA phase-out start`);
    if (resolved.phaseOutEnd > 0) add(resolved.phaseOutEnd, `${code} BPA phase-out end`);
  }

  if (code === "ON") {
    for (const t of ONTARIO_HEALTH_PREMIUM_KINK_POINTS) {
      add(t, "Ontario Health Premium");
    }

    // Ontario Tax Reduction becomes nil when tax before reduction ≥ 2 × basic amount.
    const otrBasic = Number(prov?.taxReduction?.basicPersonalAmount) || 0;
    if (otrBasic > 0) {
      const extinguishTax = 2 * otrBasic;
      if (typeof incomeContext.computeTaxBeforeReduction === "function") {
        const hit = invertTaxLevelToIncome(
          incomeContext.computeTaxBeforeReduction,
          extinguishTax,
          incomeContext.searchUpTo || 120000
        );
        if (hit != null) add(hit, "Ontario Tax Reduction extinguishment");
        const onset = invertTaxLevelToIncome(
          incomeContext.computeTaxBeforeReduction,
          otrBasic,
          incomeContext.searchUpTo || 120000
        );
        if (onset != null) add(onset, "Ontario Tax Reduction onset");
      } else {
        // Soft candidates when no tax probe is supplied (optimizer also grids).
        add(25000, "Ontario Tax Reduction region");
        add(35000, "Ontario Tax Reduction region");
        add(45000, "Ontario Tax Reduction region");
      }
    }

    const surtax = prov?.surtaxes?.[0];
    if (surtax && typeof incomeContext.computeTaxAfterCredits === "function") {
      for (const row of invertSurtaxThresholdsToIncome(
        surtax,
        incomeContext.computeTaxAfterCredits,
        incomeContext.searchUpTo || 400000
      )) {
        add(row.income, row.reason);
      }
    }
  }

  // Deduplicate by rounded cent; merge reasons when the same income is a kink for multiple mechanisms.
  const map = new Map();
  for (const row of out) {
    const key = Math.round(row.income * 100) / 100;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { income: key, reason: row.reason });
    } else if (!prev.reason.includes(row.reason)) {
      prev.reason = `${prev.reason}; ${row.reason}`;
    }
  }
  return [...map.values()].sort((a, b) => a.income - b.income);
}

/**
 * Public breakpoint API for calculators (RRSP optimizer, threshold tools).
 *
 * @param {object} taxData
 * @param {string} jurisdiction - province/territory code
 * @param {object} [incomeContext]
 * @returns {{ income: number, reason: string }[]}
 */
export function getTaxBreakpoints(taxData, jurisdiction, incomeContext = {}) {
  return collectTaxIncomeKinks(taxData, jurisdiction, incomeContext);
}

function invertTaxLevelToIncome(computeTax, targetTax, searchUpTo) {
  if (!(targetTax > 0) || typeof computeTax !== "function") return null;
  const hiTax = Number(computeTax(searchUpTo));
  if (!(hiTax > targetTax)) return null;
  let low = 0;
  let high = searchUpTo;
  for (let i = 0; i < 56; i++) {
    const mid = (low + high) / 2;
    if (Number(computeTax(mid)) > targetTax) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * Invert Ontario surtax thresholds (on tax-after-credits) to approximate incomes
 * by probing the tax engine. Optional; requires computeFn(income) → taxAfterCredits.
 */
export function invertSurtaxThresholdsToIncome(surtax, computeTaxAfterCredits, searchUpTo = 400000) {
  const out = [];
  if (!surtax || typeof computeTaxAfterCredits !== "function") return out;

  function findFirst(pred, lo, hi) {
    if (!pred(hi)) return null;
    let low = lo;
    let high = hi;
    for (let i = 0; i < 56; i++) {
      const mid = (low + high) / 2;
      if (pred(mid)) high = mid;
      else low = mid;
    }
    return high;
  }

  for (const [thr, label] of [
    [surtax.threshold, surtax.name || "Provincial surtax"],
    [surtax.threshold2, surtax.name || "Provincial surtax"]
  ]) {
    if (!(thr > 0)) continue;
    const hit = findFirst((inc) => computeTaxAfterCredits(inc) > thr, 0, searchUpTo);
    if (hit != null) out.push({ income: hit, reason: label });
  }
  return out;
}
