/**
 * Pure tax calculation engine
 * No DOM dependencies - deterministic, unit-testable
 */

import { getFederalData, getProvincialData, getPayrollData, getDividendsData } from './tax.data.js';

/**
 * Calculate tax for a single bracket
 * @param {number} taxableIncome - Taxable income
 * @param {Array} brackets - Array of {threshold, rate} objects
 * @returns {Array} Array of bracket calculations
 */
function calculateBracketTax(taxableIncome, brackets) {
  const bracketLines = [];
  let remainingIncome = taxableIncome;
  let totalTax = 0;

  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    const nextBracket = brackets[i + 1];
    const bracketTop = nextBracket ? nextBracket.threshold : Infinity;

    if (remainingIncome <= 0) {
      bracketLines.push({
        threshold: bracket.threshold,
        rate: bracket.rate,
        taxableInBracket: 0,
        tax: 0
      });
      continue;
    }

    const incomeInBracket = Math.min(remainingIncome, bracketTop - bracket.threshold);
    const taxInBracket = incomeInBracket * bracket.rate;

    bracketLines.push({
      threshold: bracket.threshold,
      rate: bracket.rate,
      taxableInBracket: incomeInBracket,
      tax: taxInBracket
    });

    totalTax += taxInBracket;
    remainingIncome -= incomeInBracket;
  }

  return { bracketLines, baseTax: totalTax };
}

/**
 * Calculate federal tax
 * @param {number} taxableIncome - Taxable income
 * @param {number} cpp - CPP contribution
 * @param {number} ei - EI premium
 * @param {Object} data - Tax data object
 * @returns {Object} Federal tax breakdown
 */
function calculateFederalTax(taxableIncome, cpp, ei, data) {
  const federal = getFederalData();
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, federal.brackets);

  // Calculate credits
  const credits = [];
  let totalCredits = 0;

  // Basic Personal Amount (credit = BPA × lowest tax rate)
  if (federal.credits.basicPersonalAmount) {
    const lowestRate = Math.min(...federal.brackets.map(b => b.rate));
    const credit = federal.credits.basicPersonalAmount.amount * lowestRate;
    credits.push({
      name: 'Basic Personal Amount',
      amount: credit
    });
    totalCredits += credit;
  }

  // Canada Employment Amount (credit = amount × lowest tax rate)
  if (federal.credits.canadaEmploymentAmount) {
    const lowestRate = Math.min(...federal.brackets.map(b => b.rate));
    const credit = federal.credits.canadaEmploymentAmount.amount * lowestRate;
    credits.push({
      name: 'Canada Employment Amount',
      amount: credit
    });
    totalCredits += credit;
  }

  // CPP/EI Credit
  if (federal.credits.cppEiCredit) {
    const credit = (cpp + ei) * federal.credits.cppEiCredit.rate;
    credits.push({
      name: 'CPP/EI Credit',
      amount: credit
    });
    totalCredits += credit;
  }

  const netTax = Math.max(0, baseTax - totalCredits);

  return {
    bracketLines,
    baseTax,
    credits,
    netTax
  };
}

/**
 * Calculate provincial tax
 * @param {number} taxableIncome - Taxable income
 * @param {string} province - Province code
 * @param {Object} data - Tax data object
 * @returns {Object} Provincial tax breakdown
 */
function calculateProvincialTax(taxableIncome, province, data) {
  const prov = getProvincialData(province);
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, prov.brackets);

  // Calculate credits
  const credits = [];
  let totalCredits = 0;

  // Basic Personal Amount (credit = BPA × lowest provincial tax rate)
  if (prov.credits.basicPersonalAmount) {
    const lowestRate = Math.min(...prov.brackets.map(b => b.rate));
    const credit = prov.credits.basicPersonalAmount.amount * lowestRate;
    credits.push({
      name: 'Basic Personal Amount',
      amount: credit
    });
    totalCredits += credit;
  }

  let netTax = Math.max(0, baseTax - totalCredits);

  // Calculate surtaxes
  const surtaxes = [];
  for (const surtax of prov.surtaxes || []) {
    if (surtax.threshold && netTax > surtax.threshold) {
      let surtaxAmount = 0;
      if (surtax.threshold2 && netTax > surtax.threshold2) {
        const tier1Amount = (surtax.threshold2 - surtax.threshold) * surtax.rate;
        const tier2Amount = (netTax - surtax.threshold2) * surtax.rate2;
        surtaxAmount = tier1Amount + tier2Amount;
      } else {
        surtaxAmount = (netTax - surtax.threshold) * surtax.rate;
      }
      if (surtaxAmount > 0) {
        surtaxes.push({
          name: surtax.name,
          amount: surtaxAmount
        });
        netTax += surtaxAmount;
      }
    }
  }

  // Calculate premiums (health premiums, etc.)
  const premiums = [];
  for (const premium of prov.premiums || []) {
    if (premium.brackets) {
      let premiumAmount = 0;
      for (let i = premium.brackets.length - 1; i >= 0; i--) {
        const bracket = premium.brackets[i];
        if (taxableIncome >= bracket.threshold) {
          premiumAmount = bracket.amount;
          break;
        }
      }
      if (premiumAmount > 0) {
        premiums.push({
          name: premium.name,
          amount: premiumAmount
        });
        netTax += premiumAmount;
      }
    }
  }

  return {
    bracketLines,
    baseTax,
    credits,
    surtaxes,
    premiums,
    netTax
  };
}

/**
 * Calculate dividend gross-up and tax credits
 * @param {number} eligibleDividends - Eligible dividend amount
 * @param {number} nonEligibleDividends - Non-eligible dividend amount
 * @param {string} province - Province code
 * @returns {Object} Dividend calculations
 */
function calculateDividends(eligibleDividends, nonEligibleDividends, province) {
  const dividends = getDividendsData();

  // Eligible dividends
  const eligibleGrossUp = eligibleDividends * (dividends.eligible.grossUpRate - 1);
  const eligibleDTCFed = eligibleDividends * dividends.eligible.grossUpRate * dividends.eligible.dtcFederal;
  const eligibleDTCProv = eligibleDividends * dividends.eligible.grossUpRate * (dividends.eligible.provinces[province] || 0);

  // Non-eligible dividends
  const nonEligibleGrossUp = nonEligibleDividends * (dividends.nonEligible.grossUpRate - 1);
  const nonEligibleDTCFed = nonEligibleDividends * dividends.nonEligible.grossUpRate * dividends.nonEligible.dtcFederal;
  const nonEligibleDTCProv = nonEligibleDividends * dividends.nonEligible.grossUpRate * (dividends.nonEligible.provinces[province] || 0);

  return {
    eligibleGrossUp,
    nonEligibleGrossUp,
    eligibleDTCFed,
    eligibleDTCProv,
    nonEligibleDTCFed,
    nonEligibleDTCProv
  };
}

/**
 * Calculate CPP contribution (CPP1 + CPP2)
 * @param {number} employmentIncome - Employment income
 * @returns {Object} CPP calculation
 */
function calculateCPP(employmentIncome) {
  const payroll = getPayrollData();
  
  // CPP1: Base CPP on earnings up to YMPE
  const pensionableEarnings = Math.max(0, Math.min(employmentIncome, payroll.cpp.maxPensionableEarnings) - payroll.cpp.basicExemption);
  const cpp1 = Math.min(pensionableEarnings * payroll.cpp.rate, payroll.cpp.maxContribution);
  
  // CPP2: Additional CPP on earnings above YMPE up to YAMPE (2025)
  let cpp2 = 0;
  if (payroll.cpp2 && employmentIncome > payroll.cpp.maxPensionableEarnings) {
    const yampe = payroll.cpp.maxPensionableEarnings + payroll.cpp2.maxAdditionalEarnings;
    const additionalEarnings = Math.min(employmentIncome, yampe) - payroll.cpp.maxPensionableEarnings;
    cpp2 = Math.min(additionalEarnings * payroll.cpp2.rate, payroll.cpp2.maxAdditionalContribution);
  }
  
  const totalCpp = cpp1 + cpp2;

  return {
    cpp: totalCpp,
    cpp1,
    cpp2: cpp2 || 0,
    pensionableEarnings,
    inputs: {
      employmentIncome,
      maxPensionableEarnings: payroll.cpp.maxPensionableEarnings,
      basicExemption: payroll.cpp.basicExemption,
      rate: payroll.cpp.rate,
      maxContribution: payroll.cpp.maxContribution,
      cpp2Rate: payroll.cpp2 ? payroll.cpp2.rate : 0,
      cpp2MaxContribution: payroll.cpp2 ? payroll.cpp2.maxAdditionalContribution : 0
    }
  };
}

/**
 * Calculate EI premium
 * @param {number} employmentIncome - Employment income
 * @returns {Object} EI calculation
 */
function calculateEI(employmentIncome) {
  const payroll = getPayrollData();
  const insurableEarnings = Math.min(employmentIncome, payroll.ei.maxInsurableEarnings);
  const ei = Math.min(insurableEarnings * payroll.ei.rate, payroll.ei.maxPremium);

  return {
    ei,
    insurableEarnings,
    inputs: {
      employmentIncome,
      maxInsurableEarnings: payroll.ei.maxInsurableEarnings,
      rate: payroll.ei.rate,
      maxPremium: payroll.ei.maxPremium
    }
  };
}

/**
 * Calculate marginal tax rate using finite difference
 * @param {number} taxableIncome - Current taxable income
 * @param {string} province - Province code
 * @param {number} cpp - CPP contribution (for credit calculation)
 * @param {number} ei - EI premium (for credit calculation)
 * @returns {number} Combined marginal tax rate
 */
function calculateMarginalRate(taxableIncome, province, cpp, ei) {
  const delta = 1;
  
  const fedBaseResult = calculateFederalTax(taxableIncome, cpp, ei, {});
  const fedBaseNetTax = fedBaseResult.netTax;
  const fedDeltaResult = calculateFederalTax(taxableIncome + delta, cpp, ei, {});
  const fedDeltaNetTax = fedDeltaResult.netTax;
  const fedMarginal = (fedDeltaNetTax - fedBaseNetTax) / delta;

  const provBaseResult = calculateProvincialTax(taxableIncome, province, {});
  const provBaseNetTax = provBaseResult.netTax;
  const provDeltaResult = calculateProvincialTax(taxableIncome + delta, province, {});
  const provDeltaNetTax = provDeltaResult.netTax;
  const provMarginal = (provDeltaNetTax - provBaseNetTax) / delta;

  return fedMarginal + provMarginal;
}

/**
 * Main tax computation function
 * @param {Object} input - Input object
 * @param {Object} data - Pre-loaded tax data (optional)
 * @returns {Object} Complete tax calculation result
 */
export function computePersonalTax(input, data = {}) {
  const {
    year = 2025,
    province,
    employmentIncome = 0,
    selfEmploymentIncome = 0,
    otherIncome = 0,
    eligibleDividends = 0,
    nonEligibleDividends = 0,
    capitalGains = 0,
    rrspDeduction = 0,
    fhsaDeduction = 0,
    estimatedDeductions = 0,
    taxPaid = 0
  } = input;

  const totalIncome = employmentIncome + selfEmploymentIncome + otherIncome + 
                     eligibleDividends + nonEligibleDividends + capitalGains;

  const dividends = calculateDividends(eligibleDividends, nonEligibleDividends, province);
  const dividendsData = getDividendsData();
  const grossedUpEligible = eligibleDividends * dividendsData.eligible.grossUpRate;
  const grossedUpNonEligible = nonEligibleDividends * dividendsData.nonEligible.grossUpRate;

  const capitalGainsInclusionRate = 0.50;
  const taxableCapitalGains = capitalGains * capitalGainsInclusionRate;

  const taxableIncome = Math.max(0, 
    employmentIncome + 
    selfEmploymentIncome + 
    otherIncome + 
    grossedUpEligible + 
    grossedUpNonEligible + 
    taxableCapitalGains - 
    rrspDeduction - 
    fhsaDeduction - 
    estimatedDeductions
  );

  const cppCalc = calculateCPP(employmentIncome);
  const eiCalc = calculateEI(employmentIncome);
  const cpp = cppCalc.cpp;
  const ei = eiCalc.ei;

  const federal = calculateFederalTax(taxableIncome, cpp, ei, data);
  const provincial = calculateProvincialTax(taxableIncome, province, data);

  const totalDTCFed = dividends.eligibleDTCFed + dividends.nonEligibleDTCFed;
  const totalDTCProv = dividends.eligibleDTCProv + dividends.nonEligibleDTCProv;
  
  const federalTax = Math.max(0, federal.netTax - totalDTCFed);
  const provTax = Math.max(0, provincial.netTax - totalDTCProv);

  const totalIncomeTax = federalTax + provTax;
  const totalBurden = totalIncomeTax + cpp + ei;
  const afterTaxIncome = totalIncome - totalIncomeTax;
  const takeHomeAfterPayroll = totalIncome - totalBurden;
  const avgRate = totalIncome > 0 ? totalIncomeTax / totalIncome : 0;
  const marginalRate = calculateMarginalRate(taxableIncome, province, cpp, ei);
  const refundOrOwing = taxPaid - totalIncomeTax;

  return {
    totals: {
      totalIncome,
      taxableIncome,
      federalTax,
      provTax,
      cpp,
      ei,
      totalIncomeTax,
      totalBurden,
      afterTaxIncome,
      takeHomeAfterPayroll,
      avgRate,
      marginalRate,
      refundOrOwing
    },
    breakdown: {
      federal: {
        ...federal,
        dtcApplied: totalDTCFed
      },
      provincial: {
        ...provincial,
        dtcApplied: totalDTCProv
      },
      dividends: {
        ...dividends,
        totalGrossUp: dividends.eligibleGrossUp + dividends.nonEligibleGrossUp
      },
      capitalGains: {
        inclusionRate: capitalGainsInclusionRate,
        taxableCapitalGains
      },
      payroll: {
        cpp: cppCalc,
        ei: eiCalc
      }
    }
  };
}
