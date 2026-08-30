/**
 * Pure corporate tax calculation engine
 * No DOM dependencies - deterministic, unit-testable
 */

import { getFederalCorporateData, getProvincialCorporateData } from './corporate.data.js';

function effectiveRate(config, fallbackRate, taxationYearStartDate) {
  const entries = Array.isArray(config?.effectiveRates) ? config.effectiveRates : [];
  const startDate = typeof taxationYearStartDate === 'string' ? taxationYearStartDate.slice(0, 10) : '';

  if (!entries.length || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return fallbackRate;
  }

  let selectedRate = fallbackRate;
  for (const entry of entries) {
    if (entry?.start && entry.start <= startDate && typeof entry.rate === 'number') {
      selectedRate = entry.rate;
    }
  }
  return selectedRate;
}

/**
 * Calculate corporate tax using SBD and general rate brackets
 * @param {number} taxableIncome - Corporate taxable income
 * @param {string} province - Province code
 * @param {{ taxationYearStartDate?: string }} opts
 * @returns {Object} Corporate tax breakdown
 */
export function calculateCorporateTax(taxableIncome, province, opts = {}) {
  const income = Number(taxableIncome);
  // Public boundary: non-finite or negative taxable income is treated as $0.
  taxableIncome = Number.isFinite(income) && income >= 0 ? income : 0;

  const federal = getFederalCorporateData();
  const prov = getProvincialCorporateData(province);

  const federalSbdLimit = federal.sbd.limit;
  const provincialSbdLimit = prov.sbd.limit || federalSbdLimit;
  const federalSbdRate = effectiveRate(federal.sbd, federal.sbd.rate, opts.taxationYearStartDate);
  const provincialSbdRate = effectiveRate(prov.sbd, prov.sbd.rate, opts.taxationYearStartDate);
  
  // Calculate federal corporate tax
  let federalTax = 0;
  const federalBrackets = [];
  
  if (taxableIncome <= federalSbdLimit) {
    // All income at SBD rate
    federalTax = taxableIncome * federalSbdRate;
    federalBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: federalSbdRate,
      incomeInBracket: taxableIncome,
      tax: federalTax
    });
  } else {
    // Income up to SBD limit at SBD rate
    const sbdIncome = federalSbdLimit;
    const sbdTax = sbdIncome * federalSbdRate;
    federalBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: federalSbdRate,
      incomeInBracket: sbdIncome,
      tax: sbdTax
    });
    
    // Income above SBD limit at general rate
    const generalIncome = taxableIncome - federalSbdLimit;
    const generalTax = generalIncome * federal.general.rate;
    federalBrackets.push({
      type: 'General',
      threshold: federalSbdLimit,
      rate: federal.general.rate,
      incomeInBracket: generalIncome,
      tax: generalTax
    });
    
    federalTax = sbdTax + generalTax;
  }

  // Calculate provincial corporate tax
  let provincialTax = 0;
  const provincialBrackets = [];
  
  if (taxableIncome <= provincialSbdLimit) {
    // All income at provincial SBD rate
    provincialTax = taxableIncome * provincialSbdRate;
    provincialBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: provincialSbdRate,
      incomeInBracket: taxableIncome,
      tax: provincialTax
    });
  } else {
    // Income up to SBD limit at provincial SBD rate
    const sbdIncome = provincialSbdLimit;
    const sbdTax = sbdIncome * provincialSbdRate;
    provincialBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: provincialSbdRate,
      incomeInBracket: sbdIncome,
      tax: sbdTax
    });
    
    // Income above SBD limit at provincial general rate
    const generalIncome = taxableIncome - provincialSbdLimit;
    const generalTax = generalIncome * prov.general.rate;
    provincialBrackets.push({
      type: 'General',
      threshold: provincialSbdLimit,
      rate: prov.general.rate,
      incomeInBracket: generalIncome,
      tax: generalTax
    });
    
    provincialTax = sbdTax + generalTax;
  }

  const totalCorporateTax = federalTax + provincialTax;
  const afterTaxCash = taxableIncome - totalCorporateTax;

  return {
    taxableIncome,
    federalTax,
    provincialTax,
    totalCorporateTax,
    afterTaxCash,
    retainedEarnings: afterTaxCash,
    breakdown: {
      federal: {
        brackets: federalBrackets,
        totalTax: federalTax,
        sbdLimit: federalSbdLimit
      },
      provincial: {
        brackets: provincialBrackets,
        totalTax: provincialTax,
        sbdLimit: provincialSbdLimit
      }
    }
  };
}
