/**
 * Bridge module: Integrates corporate tax + personal tax calculations
 * Reuses personal tax engine for personal side
 */

import { calculateCorporateTax } from './corporate.engine.js';
import { computePersonalTax, employerCppForT4Employment } from './tax.engine.js';

/**
 * Sum deductible owner compensation: salary plus employer CPP (matched to employee CPP on T4 salary).
 * Employee CPP stays on the personal side only.
 * @param {number[]} salaries
 * @returns {{ salaryExpense: number, employerCppExpense: number }}
 */
function sumCompensationCorporateDeductions(salaries, personalTaxOpts = {}) {
  let salaryExpense = 0;
  let employerCppExpense = 0;
  for (const raw of salaries) {
    const s = Math.max(0, Number(raw) || 0);
    salaryExpense += s;
    employerCppExpense += employerCppForT4Employment(s, personalTaxOpts);
  }
  return { salaryExpense, employerCppExpense };
}

/**
 * Map user-entered RRSP contribution to the personal engine's RRSP deduction.
 * Assumption: the full contribution is claimed as a deduction in the current tax year
 * (unused contribution carry-forward and contribution room are not modeled).
 * Accepts legacy `rrspDeduction` when `rrspContribution` is absent.
 * @param {{ rrspContribution?: number, rrspDeduction?: number }} source
 * @returns {number}
 */
function rrspContributionAsCurrentYearDeduction(source) {
  if (!source || typeof source !== 'object') return 0;
  if (Object.prototype.hasOwnProperty.call(source, 'rrspContribution')) {
    return Math.max(0, Number(source.rrspContribution) || 0);
  }
  return Math.max(0, Number(source.rrspDeduction) || 0);
}

const FUNDING_EPS = 0.005;

/**
 * Salary/dividends may exceed this year's modeled corporate cash.
 * That is allowed as a hypothetical; callers should disclose the implicit prior-resource assumption.
 */
function compensationFundingNotes({
  salaryExpense,
  employerCppExpense,
  corporateIncomeBeforeCompensation,
  dividendDistributions,
  afterTaxCorporateCash
}) {
  const notes = [];
  const compensationCost = (Number(salaryExpense) || 0) + (Number(employerCppExpense) || 0);
  const incomeBefore = Number(corporateIncomeBeforeCompensation) || 0;
  const dividends = Number(dividendDistributions) || 0;
  const cash = Number(afterTaxCorporateCash) || 0;

  if (compensationCost > incomeBefore + FUNDING_EPS) {
    notes.push({
      code: 'salary_exceeds_current_year_income',
      salaryExpense: Number(salaryExpense) || 0,
      employerCppExpense: Number(employerCppExpense) || 0,
      compensationCost,
      corporateIncomeBeforeCompensation: incomeBefore
    });
  }
  if (dividends > cash + FUNDING_EPS) {
    notes.push({
      code: 'dividends_exceed_current_year_cash',
      dividendDistributions: dividends,
      afterTaxCorporateCash: cash
    });
  }
  return notes;
}

/**
 * Calculate complete CCPC tax scenario (single or income-splitting)
 * @param {Object} input - Input object with:
 *   - year, province, grossRevenue, expenses
 *   - incomeSplitting: boolean
 *   - If single: salary, eligibleDividends, nonEligibleDividends, personalOtherIncome, capitalGains, rrspContribution, fhsaDeduction, personalDeductions
 *   - If splitting: shareholder1/2: { salary, eligibleDividends, nonEligibleDividends, otherIncome, capitalGains, rrspContribution, fhsaDeduction, deductions }
 * @returns {Object} Complete CCPC tax calculation result
 */
export function computeCCPCTax(input, personalTaxOpts = {}) {
  const {
    year = 2025,
    province,
    grossRevenue = 0,
    expenses = 0,
    corporateTaxYearStart = `${year}-01-01`,
    incomeSplitting = false
  } = input;

  const personalProv = input.personalProvince || province;
  const corporateOpts = { taxationYearStartDate: corporateTaxYearStart };

  if (incomeSplitting && input.shareholder1 != null && input.shareholder2 != null) {
    const sh1 = input.shareholder1;
    const sh2 = input.shareholder2;
    const salary1 = sh1.salary || 0;
    const salary2 = sh2.salary || 0;
    const elig1 = sh1.eligibleDividends || 0;
    const elig2 = sh2.eligibleDividends || 0;
    const nonElig1 = sh1.nonEligibleDividends || 0;
    const nonElig2 = sh2.nonEligibleDividends || 0;

    const { salaryExpense, employerCppExpense } = sumCompensationCorporateDeductions(
      [salary1, salary2],
      personalTaxOpts
    );
    const corporateIncomeBeforeCompensation = Math.max(0, grossRevenue - expenses);
    const corporateTaxableIncome = Math.max(
      0,
      corporateIncomeBeforeCompensation - salaryExpense - employerCppExpense
    );

    const corporate = calculateCorporateTax(corporateTaxableIncome, province, corporateOpts);
    const afterTaxCorporateCash = corporate.afterTaxCash;

    const dividendDistributions = elig1 + nonElig1 + elig2 + nonElig2;
    const retainedEarnings = Math.max(0, afterTaxCorporateCash - dividendDistributions);

    const personal1 = computePersonalTax({
      year,
      province: personalProv,
      employmentIncome: salary1,
      eligibleDividends: elig1,
      nonEligibleDividends: nonElig1,
      otherIncome: sh1.otherIncome || 0,
      capitalGains: sh1.capitalGains || 0,
      rrspDeduction: rrspContributionAsCurrentYearDeduction(sh1),
      fhsaDeduction: sh1.fhsaDeduction || 0,
      estimatedDeductions: sh1.deductions || 0,
      taxPaid: 0
    }, personalTaxOpts);

    const personal2 = computePersonalTax({
      year,
      province: personalProv,
      employmentIncome: salary2,
      eligibleDividends: elig2,
      nonEligibleDividends: nonElig2,
      otherIncome: sh2.otherIncome || 0,
      capitalGains: sh2.capitalGains || 0,
      rrspDeduction: rrspContributionAsCurrentYearDeduction(sh2),
      fhsaDeduction: sh2.fhsaDeduction || 0,
      estimatedDeductions: sh2.deductions || 0,
      taxPaid: 0
    }, personalTaxOpts);

    const totalPersonalTax = personal1.totals.totalIncomeTax + personal2.totals.totalIncomeTax;
    const totalTaxBurden = corporate.totalCorporateTax + totalPersonalTax;
    const effectiveTaxRate = grossRevenue > 0 ? totalTaxBurden / grossRevenue : 0;
    const netPersonalTakeHome = personal1.totals.takeHomeAfterPayroll + personal2.totals.takeHomeAfterPayroll;
    const employeeCppEi =
      (personal1.totals.cpp || 0) +
      (personal1.totals.ei || 0) +
      (personal2.totals.cpp || 0) +
      (personal2.totals.ei || 0);
    const fundingNotes = compensationFundingNotes({
      salaryExpense,
      employerCppExpense,
      corporateIncomeBeforeCompensation,
      dividendDistributions,
      afterTaxCorporateCash
    });

    return {
      incomeSplitting: true,
      corporate: {
        ...corporate,
        grossRevenue,
        expenses,
        corporateIncomeBeforeCompensation,
        salaryExpense,
        employerCppExpense,
        dividendDistributions,
        distributions: dividendDistributions
      },
      personal: null,
      personal1: {
        ...personal1.totals,
        breakdown: personal1.breakdown
      },
      personal2: {
        ...personal2.totals,
        breakdown: personal2.breakdown
      },
      combined: {
        totalTaxBurden,
        employeeCppEi,
        employerCppExpense,
        effectiveTaxRate,
        netPersonalTakeHome,
        retainedEarnings,
        afterTaxCorporateCash,
        fundingNotes
      }
    };
  }

  const salary = input.salary || 0;
  const eligibleDividends = input.eligibleDividends || 0;
  const nonEligibleDividends = input.nonEligibleDividends || 0;
  const personalOtherIncome = input.personalOtherIncome || 0;
  const capitalGains = input.capitalGains || 0;
  const rrspDeduction = rrspContributionAsCurrentYearDeduction(input);
  const fhsaDeduction = input.fhsaDeduction || 0;
  const personalDeductions = input.personalDeductions || 0;

  const { salaryExpense, employerCppExpense } = sumCompensationCorporateDeductions(
    [salary],
    personalTaxOpts
  );
  const corporateIncomeBeforeCompensation = Math.max(0, grossRevenue - expenses);
  const corporateTaxableIncome = Math.max(
    0,
    corporateIncomeBeforeCompensation - salaryExpense - employerCppExpense
  );

  const corporate = calculateCorporateTax(corporateTaxableIncome, province, corporateOpts);
  const afterTaxCorporateCash = corporate.afterTaxCash;

  const personal = computePersonalTax({
    year,
    province: personalProv,
    employmentIncome: salary,
    eligibleDividends,
    nonEligibleDividends,
    otherIncome: personalOtherIncome,
    capitalGains,
    rrspDeduction,
    fhsaDeduction,
    estimatedDeductions: personalDeductions,
    taxPaid: 0
  }, personalTaxOpts);

  const totalTaxBurden = corporate.totalCorporateTax + personal.totals.totalIncomeTax;
  const effectiveTaxRate = grossRevenue > 0 ? totalTaxBurden / grossRevenue : 0;
  const netPersonalTakeHome = personal.totals.takeHomeAfterPayroll;
  const dividendDistributions = eligibleDividends + nonEligibleDividends;
  const retainedEarnings = Math.max(0, afterTaxCorporateCash - dividendDistributions);
  const employeeCppEi = (personal.totals.cpp || 0) + (personal.totals.ei || 0);
  const fundingNotes = compensationFundingNotes({
    salaryExpense,
    employerCppExpense,
    corporateIncomeBeforeCompensation,
    dividendDistributions,
    afterTaxCorporateCash
  });

  return {
    incomeSplitting: false,
    corporate: {
      ...corporate,
      grossRevenue,
      expenses,
      corporateIncomeBeforeCompensation,
      salaryExpense,
      employerCppExpense,
      dividendDistributions,
      distributions: dividendDistributions
    },
    personal: {
      ...personal.totals,
      breakdown: personal.breakdown
    },
    personal1: null,
    personal2: null,
    combined: {
      totalTaxBurden,
      employeeCppEi,
      employerCppExpense,
      effectiveTaxRate,
      netPersonalTakeHome,
      retainedEarnings,
      afterTaxCorporateCash,
      fundingNotes
    }
  };
}
