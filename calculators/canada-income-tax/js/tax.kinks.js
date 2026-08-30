/**
 * Shared income kink / breakpoint collectors for progressive Canadian tax.
 *
 * Used by threshold analysis and by the RRSP deduction-timing optimizer so
 * tax-law kink knowledge is not duplicated inside calculator UI code.
 */

import { resolveEnhancedBasicPersonalAmount } from "./tax.bpa.js";

/**
 * Ontario Health Premium statutory kink incomes (Taxation Act, 2007). Not CPI-indexed.
 * Phase-in bands temporarily raise the combined next-dollar rate; flat bands do not
 * (the premium is a fixed dollar amount, so its marginal contribution is zero).
 */
export const ONTARIO_HEALTH_PREMIUM_KINKS = [
  { income: 20000, reason: "Ontario Health Premium phase-in begins" },
  { income: 25000, reason: "Ontario Health Premium becomes flat" },
  { income: 36000, reason: "Ontario Health Premium phase-in begins" },
  { income: 38500, reason: "Ontario Health Premium becomes flat" },
  { income: 48000, reason: "Ontario Health Premium phase-in begins" },
  { income: 48600, reason: "Ontario Health Premium becomes flat" },
  { income: 72000, reason: "Ontario Health Premium phase-in begins" },
  { income: 72600, reason: "Ontario Health Premium becomes flat" },
  { income: 200000, reason: "Ontario Health Premium phase-in begins" },
  { income: 200600, reason: "Ontario Health Premium becomes flat" }
];

export const ONTARIO_HEALTH_PREMIUM_KINK_POINTS = ONTARIO_HEALTH_PREMIUM_KINKS.map(
  (k) => k.income
);

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

  const fedAge = federal?.credits?.ageAmount;
  if (fedAge?.amount > 0) {
    const start = Number(fedAge.phaseOutStart) || 0;
    const rate = Number(fedAge.phaseOutRate) || 0.15;
    if (start > 0) add(start, "Federal age amount phase-out start");
    if (start > 0 && rate > 0) {
      add(start + Number(fedAge.amount) / rate, "Federal age amount extinguishment");
    }
  }

  const oasThreshold = Number(federal?.oasRecovery?.threshold) || 0;
  if (oasThreshold > 0) add(oasThreshold, "OAS recovery tax threshold");

  const provAge = prov?.credits?.ageAmount;
  if (provAge?.amount > 0) {
    const start = Number(provAge.phaseOutStart) || 0;
    const rate = Number(provAge.phaseOutRate) || 0.15;
    if (start > 0) add(start, `${code} age amount phase-out start`);
    if (start > 0 && rate > 0) {
      add(start + Number(provAge.amount) / rate, `${code} age amount extinguishment`);
    }
  }

  const provBpa = prov?.credits?.basicPersonalAmount;
  if (provBpa && (provBpa.minimum != null || provBpa.phaseOutStart != null)) {
    const resolved = resolveEnhancedBasicPersonalAmount(provBpa, 0, null);
    if (resolved.phaseOutStart > 0) add(resolved.phaseOutStart, `${code} BPA phase-out start`);
    if (resolved.phaseOutEnd > 0) add(resolved.phaseOutEnd, `${code} BPA phase-out end`);
  }

  if (code === "ON") {
    for (const kink of ONTARIO_HEALTH_PREMIUM_KINKS) {
      add(kink.income, kink.reason);
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

  const tr = prov?.taxReduction;
  const trType = String(tr?.type || "").toLowerCase();
  if (trType === "bc") {
    const thr = Number(tr.netIncomeThreshold) || 0;
    const maxNi = Number(tr.maximumNetIncome) || 0;
    const baseAmount = Number(tr.baseAmount) || 0;
    const factor = Number(tr.reductionFactor) || 0;
    if (thr > 0) add(thr, "B.C. tax reduction phase-out start");
    if (maxNi > 0) add(maxNi, "B.C. tax reduction extinguishment");
    // Where tax-before-reduction crosses the income-dependent raw credit (full-wipe ends).
    if (
      baseAmount > 0 &&
      factor > 0 &&
      typeof incomeContext.computeTaxBeforeReduction === "function"
    ) {
      const hit = invertCrossing(
        (income) => Number(incomeContext.computeTaxBeforeReduction(income)) || 0,
        (income) => {
          const ni = Math.max(0, Number(income) || 0);
          if (Number.isFinite(maxNi) && maxNi > 0 && ni >= maxNi) return 0;
          return Math.max(0, baseAmount - factor * Math.max(0, ni - thr));
        },
        incomeContext.searchUpTo || 120000
      );
      if (hit != null) add(hit, "B.C. tax reduction full-wipe end");
    } else if (thr > 0) {
      add(thr + 5000, "B.C. tax reduction region");
      add(thr + 15000, "B.C. tax reduction region");
    }
  } else if (trType === "lowincome" || trType === "low_income") {
    const base = Number(tr.phaseOutBase) || 0;
    const basic = Number(tr.basicReduction) || 0;
    const rate = Number(tr.phaseOutRate) || 0;
    if (base > 0) add(base, `${code} low-income tax reduction phase-out start`);
    if (base > 0 && basic > 0 && rate > 0) {
      add(base + basic / rate, `${code} low-income tax reduction extinguishment`);
    }
    // Where tax-before-reduction crosses the raw LITR (provincial tax becomes positive).
    if (
      basic > 0 &&
      rate > 0 &&
      typeof incomeContext.computeTaxBeforeReduction === "function"
    ) {
      const hit = invertCrossing(
        (income) => Number(incomeContext.computeTaxBeforeReduction(income)) || 0,
        (income) => {
          const ni = Math.max(0, Number(income) || 0);
          return Math.max(0, basic - rate * Math.max(0, ni - base));
        },
        incomeContext.searchUpTo || 120000
      );
      if (hit != null) add(hit, `${code} low-income tax reduction full-wipe end`);
    } else if (base > 0) {
      add(base - 2000, `${code} low-income tax reduction region`);
      add(base + 2000, `${code} low-income tax reduction region`);
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
 * Find the lowest income where left(income) exceeds right(income).
 * Used for reduction full-wipe boundaries (tax-before-reduction vs raw reduction).
 */
function invertCrossing(leftFn, rightFn, searchUpTo) {
  if (typeof leftFn !== "function" || typeof rightFn !== "function") return null;
  const pred = (income) => Number(leftFn(income)) > Number(rightFn(income));
  if (!pred(searchUpTo)) return null;
  let low = 0;
  let high = searchUpTo;
  for (let i = 0; i < 56; i++) {
    const mid = (low + high) / 2;
    if (pred(mid)) high = mid;
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
