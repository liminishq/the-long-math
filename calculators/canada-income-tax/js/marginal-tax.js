/**
 * Shared marginal tax-rate helpers.
 * Used by the personal tax engine, RRSP room/refund calculator, and tests.
 */

/** Income bump for finite-difference marginal estimates (avoids $0 delta when net tax is rounded to dollars). */
export const MARGINAL_DELTA = 100;

export function isMarginalRateInBounds(rate) {
  return typeof rate === "number" && !Number.isNaN(rate) && rate >= 0 && rate <= 1;
}

/**
 * Statutory bracket marginal rate at a given taxable income (last bracket with income above its threshold).
 */
export function bracketMarginalRate(taxableIncome, brackets) {
  const income = Math.max(0, taxableIncome || 0);
  let marginalRate = 0;

  for (let i = 0; i < (brackets || []).length; i++) {
    const current = brackets[i];
    const next = brackets[i + 1];
    const lower = current.threshold;
    const upper = next ? next.threshold : Infinity;

    if (income <= lower) {
      break;
    }

    const taxableInBracket = Math.min(income, upper) - lower;
    if (taxableInBracket > 0 && income > lower) {
      marginalRate = current.rate;
    }
  }

  return marginalRate;
}

/**
 * Combined federal + provincial bracket marginal rate at taxable income.
 * Matches the RRSP calculator "simple marginal-rate" estimate (before credits).
 */
export function combinedBracketMarginalRate(taxableIncome, federalBrackets, provincialBrackets) {
  const fed = bracketMarginalRate(taxableIncome, federalBrackets);
  const prov = bracketMarginalRate(taxableIncome, provincialBrackets);
  return fed + prov;
}

/**
 * Bracket tax (for progressive refund estimates); returns { tax, marginalRate }.
 */
export function computeTaxFromBrackets(taxableIncome, brackets) {
  const income = Math.max(0, taxableIncome || 0);
  let tax = 0;
  let marginalRate = 0;

  for (let i = 0; i < (brackets || []).length; i++) {
    const current = brackets[i];
    const next = brackets[i + 1];
    const lower = current.threshold;
    const upper = next ? next.threshold : Infinity;

    if (income <= lower) {
      break;
    }

    const taxableInBracket = Math.min(income, upper) - lower;
    if (taxableInBracket > 0) {
      tax += taxableInBracket * current.rate;
      if (income > lower) {
        marginalRate = current.rate;
      }
    }
  }

  return { tax, marginalRate };
}

/**
 * Finite-difference marginal: (tax(income + delta) - tax(income)) / delta.
 * Returns null when income is zero (type not active — do not perturb inactive fields).
 */
export function marginalRateByPerturbation(currentIncome, delta, taxAtIncome) {
  const base = Math.max(0, Number(currentIncome) || 0);
  if (base <= 0) return null;
  const bump = Number(delta) || MARGINAL_DELTA;
  const rate = (taxAtIncome(base + bump) - taxAtIncome(base)) / bump;
  return isMarginalRateInBounds(rate) ? rate : null;
}
