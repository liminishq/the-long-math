/**
 * Pure corporate tax calculation engine
 * No DOM dependencies - deterministic, unit-testable
 */

import { getFederalCorporateData, getProvincialCorporateData } from './corporate.data.js';

/**
 * Calculate corporate tax using SBD and general rate brackets
 * @param {number} taxableIncome - Corporate taxable income
 * @param {string} province - Province code
 * @returns {Object} Corporate tax breakdown
 */
export function calculateCorporateTax(taxableIncome, province) {
  const federal = getFederalCorporateData();
  const prov = getProvincialCorporateData(province);

  // Determine SBD limit (use provincial if different, otherwise federal)
  const sbdLimit = prov.sbd.limit || federal.sbd.limit;
  
  // Calculate federal corporate tax
  let federalTax = 0;
  const federalBrackets = [];
  
  if (taxableIncome <= sbdLimit) {
    // All income at SBD rate
    federalTax = taxableIncome * federal.sbd.rate;
    federalBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: federal.sbd.rate,
      incomeInBracket: taxableIncome,
      tax: federalTax
    });
  } else {
    // Income up to SBD limit at SBD rate
    const sbdIncome = sbdLimit;
    const sbdTax = sbdIncome * federal.sbd.rate;
    federalBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: federal.sbd.rate,
      incomeInBracket: sbdIncome,
      tax: sbdTax
    });
    
    // Income above SBD limit at general rate
    const generalIncome = taxableIncome - sbdLimit;
    const generalTax = generalIncome * federal.general.rate;
    federalBrackets.push({
      type: 'General',
      threshold: sbdLimit,
      rate: federal.general.rate,
      incomeInBracket: generalIncome,
      tax: generalTax
    });
    
    federalTax = sbdTax + generalTax;
  }

  // Calculate provincial corporate tax
  let provincialTax = 0;
  const provincialBrackets = [];
  
  if (taxableIncome <= sbdLimit) {
    // All income at provincial SBD rate
    provincialTax = taxableIncome * prov.sbd.rate;
    provincialBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: prov.sbd.rate,
      incomeInBracket: taxableIncome,
      tax: provincialTax
    });
  } else {
    // Income up to SBD limit at provincial SBD rate
    const sbdIncome = sbdLimit;
    const sbdTax = sbdIncome * prov.sbd.rate;
    provincialBrackets.push({
      type: 'SBD',
      threshold: 0,
      rate: prov.sbd.rate,
      incomeInBracket: sbdIncome,
      tax: sbdTax
    });
    
    // Income above SBD limit at provincial general rate
    const generalIncome = taxableIncome - sbdLimit;
    const generalTax = generalIncome * prov.general.rate;
    provincialBrackets.push({
      type: 'General',
      threshold: sbdLimit,
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
        sbdLimit: sbdLimit
      },
      provincial: {
        brackets: provincialBrackets,
        totalTax: provincialTax,
        sbdLimit: sbdLimit
      }
    }
  };
}
