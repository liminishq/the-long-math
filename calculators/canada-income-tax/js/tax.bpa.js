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

/**
 * B.C. tax reduction credit (BC428 / gov.bc.ca basic credits).
 *
 * reduction = max(0, baseAmount − reductionFactor × max(0, netIncome − netIncomeThreshold))
 * then capped at tax before reduction (non-refundable).
 *
 * 2026: base $690, threshold $25,570, factor 3.56%, zero by $44,952.
 */
function roundCents(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

export function calculateBCTaxReduction(taxBeforeReduction, netIncome, taxReductionConfig = {}) {
  const tax = Math.max(0, Number(taxBeforeReduction) || 0);
  const baseAmount = Number(taxReductionConfig.baseAmount) || 0;
  const threshold = Number(taxReductionConfig.netIncomeThreshold) || 0;
  const factor = Number(taxReductionConfig.reductionFactor) || 0;
  const maxNi = Number(taxReductionConfig.maximumNetIncome);
  const ni = Math.max(0, Number(netIncome) || 0);

  if (!(baseAmount > 0) || !(tax > 0) || !(factor > 0)) {
    return { reduction: 0, rawReduction: 0, taxBeforeReduction: tax, netIncome: ni };
  }
  if (Number.isFinite(maxNi) && maxNi > 0 && ni >= maxNi) {
    return { reduction: 0, rawReduction: 0, taxBeforeReduction: tax, netIncome: ni };
  }

  const rawReduction = Math.max(0, roundCents(baseAmount - factor * Math.max(0, ni - threshold)));
  const reduction = Math.max(0, Math.min(tax, rawReduction));
  return { reduction, rawReduction, taxBeforeReduction: tax, netIncome: ni };
}

/**
 * Atlantic-style low-income tax reduction (NL428 / NB428 / NS428), single-filer path.
 *
 * basicReduction − phaseOutRate × max(0, adjustedFamilyIncome − phaseOutBase),
 * capped at tax before reduction. Under employment-path assumptions with no spouse
 * or dependant inputs, adjusted family income = the filer's own net income.
 *
 * Spouse / eligible-dependant / child add-ons are out of scope (need extra facts).
 */
export function calculateLowIncomeTaxReduction(taxBeforeReduction, netIncome, taxReductionConfig = {}) {
  const tax = Math.max(0, Number(taxBeforeReduction) || 0);
  const basic = Number(taxReductionConfig.basicReduction) || 0;
  const phaseOutBase = Number(taxReductionConfig.phaseOutBase) || 0;
  const phaseOutRate = Number(taxReductionConfig.phaseOutRate) || 0;
  const ni = Math.max(0, Number(netIncome) || 0);

  if (!(basic > 0) || !(tax > 0) || !(phaseOutRate > 0)) {
    return { reduction: 0, rawReduction: 0, taxBeforeReduction: tax, adjustedFamilyIncome: ni };
  }

  const rawReduction = Math.max(
    0,
    roundCents(basic - phaseOutRate * Math.max(0, ni - phaseOutBase))
  );
  const reduction = Math.max(0, Math.min(tax, rawReduction));
  return { reduction, rawReduction, taxBeforeReduction: tax, adjustedFamilyIncome: ni };
}

/**
 * Dispatch provincial tax-reduction configs used after dividend tax credit.
 * Ontario keeps its dedicated ON428 path; this covers BC + Atlantic LITR styles.
 */
export function calculateProvincialTaxReduction(taxBeforeReduction, netIncome, taxReductionConfig = {}) {
  if (!taxReductionConfig || typeof taxReductionConfig !== "object") {
    return { reduction: 0, type: null };
  }
  const type = String(taxReductionConfig.type || "").toLowerCase();
  if (type === "bc") {
    return { type: "bc", ...calculateBCTaxReduction(taxBeforeReduction, netIncome, taxReductionConfig) };
  }
  if (type === "lowincome" || type === "low_income") {
    return {
      type: "lowIncome",
      ...calculateLowIncomeTaxReduction(taxBeforeReduction, netIncome, taxReductionConfig)
    };
  }
  if (type === "ontario" || taxReductionConfig.basicPersonalAmount != null) {
    return { type: "ontario", ...calculateOntarioTaxReduction(taxBeforeReduction, taxReductionConfig) };
  }
  return { reduction: 0, type: type || null };
}
