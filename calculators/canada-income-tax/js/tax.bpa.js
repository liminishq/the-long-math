/**
 * Federal (and Yukon-style) enhanced Basic Personal Amount.
 *
 * CRA: the maximum BPA applies when net income ≤ the start of the 29% bracket;
 * the minimum BPA applies when net income ≥ the start of the 33% bracket;
 * between those thresholds the enhanced portion phases out linearly.
 *
 * Sources:
 * - https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html
 * - Schedule 1 / TD1 personal amounts
 */

/**
 * @param {object} bpaConfig - credits.basicPersonalAmount from federal.json (or YT)
 * @param {number} netIncome - net income for the year
 * @param {object} [brackets] - optional federal/YT brackets used as fallback phase-out bounds
 * @returns {{ amount: number, maximum: number, minimum: number, phaseOutStart: number, phaseOutEnd: number, phased: boolean }}
 */
export function resolveEnhancedBasicPersonalAmount(bpaConfig, netIncome, brackets = null) {
  if (!bpaConfig || typeof bpaConfig !== "object") {
    return { amount: 0, maximum: 0, minimum: 0, phaseOutStart: 0, phaseOutEnd: 0, phased: false };
  }

  const maximum = Number(
    bpaConfig.maximum != null ? bpaConfig.maximum : bpaConfig.amount
  );
  const minimum = Number(
    bpaConfig.minimum != null ? bpaConfig.minimum : maximum
  );

  let phaseOutStart = Number(bpaConfig.phaseOutStart);
  let phaseOutEnd = Number(bpaConfig.phaseOutEnd);

  // Fallback: CRA ties phase-out bounds to the 29% and 33% bracket thresholds.
  if ((!Number.isFinite(phaseOutStart) || !Number.isFinite(phaseOutEnd)) && Array.isArray(brackets)) {
    const sorted = brackets
      .filter((b) => b && Number.isFinite(b.threshold) && b.threshold > 0)
      .slice()
      .sort((a, b) => a.threshold - b.threshold);
    // Federal schedule: 5 brackets → indices 2 and 3 are 29% / 33% starts (0-based among positive thresholds: 3rd/4th).
    if (sorted.length >= 4) {
      phaseOutStart = sorted[2].threshold; // start of 29%
      phaseOutEnd = sorted[3].threshold; // start of 33%
    }
  }

  if (!Number.isFinite(maximum) || maximum < 0) {
    return { amount: 0, maximum: 0, minimum: 0, phaseOutStart: 0, phaseOutEnd: 0, phased: false };
  }

  // Flat BPA (no phase-out configured).
  if (!Number.isFinite(minimum) || minimum >= maximum || !Number.isFinite(phaseOutStart) || !Number.isFinite(phaseOutEnd) || phaseOutEnd <= phaseOutStart) {
    return {
      amount: maximum,
      maximum,
      minimum: Number.isFinite(minimum) ? minimum : maximum,
      phaseOutStart: Number.isFinite(phaseOutStart) ? phaseOutStart : 0,
      phaseOutEnd: Number.isFinite(phaseOutEnd) ? phaseOutEnd : 0,
      phased: false
    };
  }

  const ni = Math.max(0, Number(netIncome) || 0);
  let amount;
  let phased = false;
  if (ni <= phaseOutStart) {
    amount = maximum;
  } else if (ni >= phaseOutEnd) {
    amount = minimum;
  } else {
    const t = (ni - phaseOutStart) / (phaseOutEnd - phaseOutStart);
    amount = maximum - (maximum - minimum) * t;
    phased = true;
  }

  return {
    amount,
    maximum,
    minimum,
    phaseOutStart,
    phaseOutEnd,
    phased
  };
}

/**
 * Ontario Tax Reduction (basic personal amount only in this engine).
 *
 * CRA T4032-ON:
 *   reduction = max(0, min(taxBeforeReduction, 2 × personalAmounts − taxBeforeReduction))
 * where personalAmounts for a filer with only the basic amount is the published
 * "Basic personal amount" for the Ontario tax reduction (e.g. $300 in 2026).
 *
 * Applied after Ontario dividend tax credit and before Ontario Health Premium.
 */
export function calculateOntarioTaxReduction(taxBeforeReduction, taxReductionConfig = {}) {
  const tax = Math.max(0, Number(taxBeforeReduction) || 0);
  const basic = Number(taxReductionConfig.basicPersonalAmount) || 0;
  // Dependant amounts exist in statute; employment-path calculator does not model dependants.
  const personalAmounts = basic;
  if (!(personalAmounts > 0) || !(tax > 0)) {
    return { reduction: 0, personalAmounts, taxBeforeReduction: tax };
  }
  const raw = 2 * personalAmounts - tax;
  const reduction = Math.max(0, Math.min(tax, raw));
  return { reduction, personalAmounts, taxBeforeReduction: tax };
}
