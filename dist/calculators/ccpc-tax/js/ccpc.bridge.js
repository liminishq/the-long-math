/**
 * Bridge module: Integrates corporate tax + personal tax calculations
 * Reuses personal tax engine for personal side
 */

import { calculateCorporateTax } from './corporate.engine.js';
import { computePersonalTax } from './tax.engine.js';

/**
 * Calculate complete CCPC tax scenario (single or income-splitting)
 * @param {Object} input - Input object with:
 *   - year, province, grossRevenue, expenses
 *   - incomeSplitting: boolean
 *   - If single: salary, eligibleDividends, nonEligibleDividends, personalOtherIncome, personalDeductions
 *   - If splitting: shareholder1: { salary, eligibleDividends, nonEligibleDividends, otherIncome, deductions }, shareholder2: same
 * @returns {Object} Complete CCPC tax calculation result
 */
export function computeCCPCTax(input) {
  const {
    year = 2025,
    province,
    grossRevenue = 0,
    expenses = 0,
    incomeSplitting = false
  } = input;

  const personalProv = input.personalProvince || province;
  const corporateTaxableIncome = Math.max(0, grossRevenue - expenses);
  const corporate = calculateCorporateTax(corporateTaxableIncome, province);
  const afterTaxCorporateCash = corporate.afterTaxCash;

  if (incomeSplitting && input.shareholder1 != null && input.shareholder2 != null) {
    const sh1 = input.shareholder1;
    const sh2 = input.shareholder2;
    const salary1 = sh1.salary || 0;
    const salary2 = sh2.salary || 0;
    const elig1 = sh1.eligibleDividends || 0;
    const elig2 = sh2.eligibleDividends || 0;
    const nonElig1 = sh1.nonEligibleDividends || 0;
    const nonElig2 = sh2.nonEligibleDividends || 0;

    const totalDistributions = salary1 + elig1 + nonElig1 + salary2 + elig2 + nonElig2;
    const retainedEarnings = Math.max(0, afterTaxCorporateCash - totalDistributions);

    const personal1 = computePersonalTax({
      year,
      province: personalProv,
      employmentIncome: salary1,
      eligibleDividends: elig1,
      nonEligibleDividends: nonElig1,
      otherIncome: sh1.otherIncome || 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: sh1.deductions || 0,
      taxPaid: 0
    });

    const personal2 = computePersonalTax({
      year,
      province: personalProv,
      employmentIncome: salary2,
      eligibleDividends: elig2,
      nonEligibleDividends: nonElig2,
      otherIncome: sh2.otherIncome || 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: sh2.deductions || 0,
      taxPaid: 0
    });

    const totalPersonalTax = personal1.totals.totalIncomeTax + personal2.totals.totalIncomeTax;
    const totalTaxBurden = corporate.totalCorporateTax + totalPersonalTax;
    const effectiveTaxRate = grossRevenue > 0 ? totalTaxBurden / grossRevenue : 0;
    const netPersonalTakeHome = personal1.totals.takeHomeAfterPayroll + personal2.totals.takeHomeAfterPayroll;

    return {
      incomeSplitting: true,
      corporate: {
        ...corporate,
        grossRevenue,
        expenses,
        distributions: totalDistributions
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
        effectiveTaxRate,
        netPersonalTakeHome,
        retainedEarnings,
        afterTaxCorporateCash
      }
    };
  }

  const salary = input.salary || 0;
  const eligibleDividends = input.eligibleDividends || 0;
  const nonEligibleDividends = input.nonEligibleDividends || 0;
  const personalOtherIncome = input.personalOtherIncome || 0;
  const personalDeductions = input.personalDeductions || 0;

  const personal = computePersonalTax({
    year,
    province: personalProv,
    employmentIncome: salary,
    eligibleDividends,
    nonEligibleDividends,
    otherIncome: personalOtherIncome,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: personalDeductions,
    taxPaid: 0
  });

  const totalTaxBurden = corporate.totalCorporateTax + personal.totals.totalIncomeTax;
  const effectiveTaxRate = grossRevenue > 0 ? totalTaxBurden / grossRevenue : 0;
  const netPersonalTakeHome = personal.totals.takeHomeAfterPayroll;
  const distributions = salary + eligibleDividends + nonEligibleDividends;
  const retainedEarnings = Math.max(0, afterTaxCorporateCash - distributions);

  return {
    incomeSplitting: false,
    corporate: {
      ...corporate,
      grossRevenue,
      expenses,
      distributions
    },
    personal: {
      ...personal.totals,
      breakdown: personal.breakdown
    },
    personal1: null,
    personal2: null,
    combined: {
      totalTaxBurden,
      effectiveTaxRate,
      netPersonalTakeHome,
      retainedEarnings,
      afterTaxCorporateCash
    }
  };
}
