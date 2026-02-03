/**
 * Bridge module: Integrates corporate tax + personal tax calculations
 * Reuses personal tax engine for personal side
 */

import { calculateCorporateTax } from './corporate.engine.js';
import { computePersonalTax } from './tax.engine.js';

/**
 * Calculate complete CCPC tax scenario
 * @param {Object} input - Input object with:
 *   - year: tax year
 *   - province: province code (corporate)
 *   - grossRevenue: gross corporate revenue
 *   - expenses: total business expenses
 *   - salary: salary/bonus paid to shareholder
 *   - eligibleDividends: eligible dividends paid
 *   - nonEligibleDividends: non-eligible dividends paid
 *   - personalProvince: province for personal tax (may differ from corporate)
 *   - personalOtherIncome: other personal income
 *   - personalDeductions: personal deductions
 * @returns {Object} Complete CCPC tax calculation result
 */
export function computeCCPCTax(input) {
  const {
    year = 2025,
    province,
    grossRevenue = 0,
    expenses = 0,
    salary = 0,
    eligibleDividends = 0,
    nonEligibleDividends = 0,
    personalProvince,
    personalOtherIncome = 0,
    personalDeductions = 0
  } = input;

  // Use corporate province for personal if not specified
  const personalProv = personalProvince || province;

  // Calculate corporate taxable income
  const corporateTaxableIncome = Math.max(0, grossRevenue - expenses);

  // Calculate corporate tax
  const corporate = calculateCorporateTax(corporateTaxableIncome, province);

  // Calculate personal tax using existing personal tax engine
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

  // Calculate total tax burden
  const totalTaxBurden = corporate.totalCorporateTax + personal.totals.totalIncomeTax;
  
  // Calculate effective overall tax rate
  const effectiveTaxRate = grossRevenue > 0 ? totalTaxBurden / grossRevenue : 0;

  // Net personal take-home
  const netPersonalTakeHome = personal.totals.takeHomeAfterPayroll;

  // After-tax corporate cash (before distributions)
  const afterTaxCorporateCash = corporate.afterTaxCash;

  // Retained earnings (after-tax cash minus distributions)
  const distributions = salary + eligibleDividends + nonEligibleDividends;
  const retainedEarnings = Math.max(0, afterTaxCorporateCash - distributions);

  return {
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
    combined: {
      totalTaxBurden,
      effectiveTaxRate,
      netPersonalTakeHome,
      retainedEarnings,
      afterTaxCorporateCash
    }
  };
}
