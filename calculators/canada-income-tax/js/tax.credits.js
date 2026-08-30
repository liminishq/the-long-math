/**
 * Optional retirement-related credits and OAS recovery tax.
 *
 * These apply only when the caller supplies age / eligiblePensionIncome / oasBenefits.
 * Existing employment-path calculations are unchanged when those fields are omitted or zero.
 *
 * Official sources (do not use third-party tax-table sites):
 * - Age amount (line 30100): ITA 118(2); CRA line 30100; CRA indexation table
 * - Pension income amount (line 31400): ITA 118(3); CRA line 31400
 * - OAS recovery: ITA OAS repayment; CRA indexation "Old age security repayment threshold";
 *   canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html
 */

export const DEFAULT_AGE_AMOUNT_MIN_AGE = 65;
export const DEFAULT_AGE_AMOUNT_PHASE_OUT_RATE = 0.15;
export const DEFAULT_OAS_RECOVERY_RATE = 0.15;

/**
 * Federal/provincial age amount base (before multiplying by the lowest credit rate).
 * Phases out at `phaseOutRate` of net income above `phaseOutStart` (ITA 118(2) uses 15%).
 */
export function resolveAgeAmountBase(config, netIncome, age) {
  if (!config) return 0;
  const minAge = Number(config.minimumAge) || DEFAULT_AGE_AMOUNT_MIN_AGE;
  const years = Number(age);
  if (!Number.isFinite(years) || years < minAge) return 0;
  const amount = Number(config.amount) || 0;
  if (!(amount > 0)) return 0;
  const start = Number(config.phaseOutStart) || 0;
  const rate = Number.isFinite(Number(config.phaseOutRate))
    ? Number(config.phaseOutRate)
    : DEFAULT_AGE_AMOUNT_PHASE_OUT_RATE;
  const ni = Math.max(0, Number(netIncome) || 0);
  if (ni <= start) return amount;
  return Math.max(0, amount - rate * (ni - start));
}

/**
 * Pension income amount base: min(statutory cap, eligible pension income).
 * Eligibility of the income itself is the caller's responsibility (RRIF vs RRSP, age 65, RPP).
 */
export function resolvePensionIncomeAmountBase(config, eligiblePensionIncome) {
  const cap = Number(config?.amount) || 0;
  const eligible = Math.max(0, Number(eligiblePensionIncome) || 0);
  if (!(cap > 0) || eligible <= 0) return 0;
  return Math.min(cap, eligible);
}

/**
 * OAS recovery tax for the income year.
 *
 * CRA: repay 15% of net income above the threshold, not exceeding OAS received.
 * Resident T1: calculated from line 23400 (net income before the repayment),
 * reported on line 23500 (reduces net income) and line 42200 (added to federal tax).
 *
 * `oasBenefits` is the OAS included in income for the year. It is not added to
 * income here — the caller must already include OAS in otherIncome.
 */
export function computeOasRecovery(netIncomeBeforeRepayment, oasBenefits, config) {
  const oas = Math.max(0, Number(oasBenefits) || 0);
  if (!(oas > 0) || !config) return 0;
  const threshold = Number(config.threshold);
  const rate = Number.isFinite(Number(config.rate)) ? Number(config.rate) : DEFAULT_OAS_RECOVERY_RATE;
  if (!Number.isFinite(threshold) || !(rate >= 0)) return 0;
  const excess = Math.max(0, (Number(netIncomeBeforeRepayment) || 0) - threshold);
  return Math.min(oas, excess * rate);
}

/**
 * Push age and pension-income credits onto the running credit arrays.
 * @returns {number} extra credit dollars (rate × base)
 */
export function addAgeAndPensionCredits({
  creditsConfig,
  creditRate,
  age,
  netIncome,
  eligiblePensionIncome,
  creditBases,
  credits
}) {
  let extra = 0;
  const ageBase = resolveAgeAmountBase(creditsConfig?.ageAmount, netIncome, age);
  if (ageBase > 0) {
    const credit = ageBase * creditRate;
    creditBases.push({ name: "Age amount", base: ageBase, rate: creditRate, credit });
    credits.push({ name: "Age amount", amount: credit });
    extra += credit;
  }
  const pensionBase = resolvePensionIncomeAmountBase(
    creditsConfig?.pensionIncomeAmount,
    eligiblePensionIncome
  );
  if (pensionBase > 0) {
    const credit = pensionBase * creditRate;
    creditBases.push({
      name: "Pension income amount",
      base: pensionBase,
      rate: creditRate,
      credit
    });
    credits.push({ name: "Pension income amount", amount: credit });
    extra += credit;
  }
  return extra;
}
