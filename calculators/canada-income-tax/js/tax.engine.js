/**
 * Pure tax calculation engine
 * No DOM dependencies - deterministic, unit-testable
 * Supports opts.dataOverride for testing (federal, provinces, payroll, dividends).
 */

import { getFederalData, getProvincesData, getProvincialData, getPayrollData, getDividendsData, normalizeProvince } from './tax.data.js';

const DEFAULT_PROVINCIAL_STEPS = ['brackets', 'credits', 'surtax', 'minTax', 'dividendCredit', 'reduction', 'premiums'];

/**
 * Build data context from opts.dataOverride or from loaded tax data.
 * If any required official value is missing, throws with a clear message.
 */
function buildDataContext(opts = {}) {
  const override = opts?.dataOverride;
  if (override?.federal && override?.provinces && override?.payroll && override?.dividends) {
    return {
      federal: override.federal,
      provinces: override.provinces,
      payroll: override.payroll,
      dividends: override.dividends,
      getProvince: (province) => {
        const code = normalizeProvince(province);
        if (!code || !override.provinces[code]) throw new Error(`Province "${province}" not found in data.`);
        return override.provinces[code];
      },
    };
  }
  return {
    federal: getFederalData(),
    provinces: getProvincesData(),
    payroll: getPayrollData(),
    dividends: getDividendsData(),
    getProvince: (province) => getProvincialData(province),
  };
}

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
 * Ontario Health Premium – official 2025 schedule (ON428 / Ontario worksheet).
 * Bands from official 2025 OHP table; premium added after tax, credits, surtax, DTC, reductions.
 *
 * @param {number} taxableIncome - Provincial taxable income
 * @returns {number} Ontario Health Premium
 */
function calculateOntarioHealthPremium2025(taxableIncome) {
  const income = Math.max(0, taxableIncome);
  if (income <= 20000) return 0;

  if (income <= 25000) {
    return Math.min(0.06 * (income - 20000), 300);
  }
  if (income <= 36000) return 300;
  if (income <= 38500) {
    return Math.min(300 + 0.06 * (income - 36000), 450);
  }
  if (income <= 48000) return 450;
  if (income <= 48600) {
    return Math.min(450 + 0.25 * (income - 48000), 600);
  }
  if (income <= 72000) return 600;
  if (income <= 72600) {
    return Math.min(600 + 0.25 * (income - 72000), 750);
  }
  if (income < 200000) return 750;
  // For taxable income >= 200,000, premium is capped at $900.
  return 900;
}

/**
 * Calculate federal tax. Mirrors Federal Schedule 1 ordering.
 * @param {number} taxableIncome - Taxable income
 * @param {number} cpp - CPP contribution
 * @param {number} ei - EI premium
 * @param {number} employmentIncome - Employment income (for Canada Employment Amount eligibility)
 * @param {Object} dividends - Pre-computed dividend amounts (eligibleDTCFed, nonEligibleDTCFed)
 * @param {Object} federal - Federal tax data (brackets, credits)
 * @returns {Object} Federal tax breakdown
 */
function calculateFederalTax(taxableIncome, cpp, ei, employmentIncome, dividends, federal) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, federal.brackets);

  // Step B — Federal non-refundable credits.
  // Mirrors Federal Schedule 1 ordering: bracket tax → non-refundable credits → dividend tax credit.
  const credits = [];
  let totalCredits = 0;

  // Basic Personal Amount (credit = BPA × lowest tax rate)
  if (federal.credits.basicPersonalAmount) {
    // BPA credit is calculated as BPA amount × lowest federal tax rate (15%)
    // Use Math.min to be order-safe (don't assume brackets[0] is lowest)
    const lowestRate = Math.min(...federal.brackets.map(b => b.rate));
    const credit = federal.credits.basicPersonalAmount.amount * lowestRate;
    credits.push({
      name: 'Basic Personal Amount',
      amount: credit
    });
    totalCredits += credit;
  }

  // Canada Employment Amount (credit = amount × lowest tax rate)
  // Must only apply when there is employment income (employmentIncome > 0).
  if (federal.credits.canadaEmploymentAmount && employmentIncome > 0) {
    // Employment amount credit is calculated as amount × lowest federal tax rate (15%)
    // Use Math.min to be order-safe (don't assume brackets[0] is lowest)
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

  const taxAfterCredits = Math.max(0, baseTax - totalCredits);

  // Step C — Federal dividend tax credit, applied after non-refundable credits.
  // Mirrors Federal Schedule 1 ordering.
  let federalDividendCredits = 0;
  if (dividends) {
    federalDividendCredits =
      (dividends.eligibleDTCFed || 0) +
      (dividends.nonEligibleDTCFed || 0);
  }
  const taxAfterDividendCredits = Math.max(0, taxAfterCredits - federalDividendCredits);

  // Step D — Federal minimum tax adjustments (placeholder for future implementation).
  const minimumTaxAdjustments = 0;

  const netTax = Math.max(0, taxAfterDividendCredits + minimumTaxAdjustments);

  return {
    bracketLines,
    baseTax,
    credits,
    taxAfterCredits,
    federalDividendCredits,
    taxAfterDividendCredits,
    minimumTaxAdjustments,
    netTax
  };
}

/**
 * Generic provincial tax calculation for non-Ontario provinces.
 * Flow: brackets → credits → surtax → minTax → dividendCredit → reduction → premiums.
 */
function calculateProvincialTaxGeneric(taxableIncome, prov, dividends) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, prov.brackets);

  // Non-refundable credits (BPA, etc.)
  const credits = [];
  let totalCredits = 0;

  if (prov.credits && prov.credits.basicPersonalAmount) {
    const configuredRate = prov.credits.basicPersonalAmount.rate;
    const creditRate = typeof configuredRate === 'number'
      ? configuredRate
      : Math.min(...prov.brackets.map(b => b.rate));
    const credit = prov.credits.basicPersonalAmount.amount * creditRate;
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    totalCredits += credit;
  }

  const taxAfterCredits = Math.max(0, baseTax - totalCredits);

  // Surtax (if any)
  const surtaxes = [];
  let surtaxTotal = 0;
  const surtaxBase = taxAfterCredits;
  for (const surtax of prov.surtaxes || []) {
    if (surtax.threshold && surtaxBase > surtax.threshold) {
      let surtaxAmount = 0;
      if (surtax.threshold2 && surtaxBase > surtax.threshold2) {
        const tier1Amount = (surtax.threshold2 - surtax.threshold) * surtax.rate;
        const tier2Amount = (surtaxBase - surtax.threshold2) * surtax.rate2;
        surtaxAmount = tier1Amount + tier2Amount;
      } else {
        surtaxAmount = (surtaxBase - surtax.threshold) * surtax.rate;
      }
      if (surtaxAmount > 0) {
        surtaxes.push({ name: surtax.name, amount: surtaxAmount });
        surtaxTotal += surtaxAmount;
      }
    }
  }
  const taxAfterSurtax = taxAfterCredits + surtaxTotal;

  const minimumTaxAdjustments = 0;
  const taxAfterMinimumTax = Math.max(0, taxAfterSurtax + minimumTaxAdjustments);

  let provincialDividendCredits = 0;
  if (dividends) {
    provincialDividendCredits =
      (dividends.eligibleDTCProv || 0) +
      (dividends.nonEligibleDTCProv || 0);
  }
  const taxAfterDividendCredits = Math.max(0, taxAfterMinimumTax - provincialDividendCredits);

  const provincialTaxReduction = 0;
  const taxAfterReductions = Math.max(0, taxAfterDividendCredits - provincialTaxReduction);

  const premiums = [];
  let premiumsTotal = 0;
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
        premiums.push({ name: premium.name, amount: premiumAmount });
        premiumsTotal += premiumAmount;
      }
    }
  }

  const netTax = taxAfterReductions + premiumsTotal;

  return {
    bracketLines,
    baseTax,
    credits,
    surtaxes,
    premiums,
    taxAfterCredits,
    surtaxTotal,
    taxAfterSurtax,
    minimumTaxAdjustments,
    provincialDividendCredits,
    taxAfterDividendCredits,
    provincialTaxReduction,
    taxAfterReductions,
    netTax,
  };
}

/**
 * Ontario-specific provincial tax calculation, mirroring ON428 ordering exactly:
 * 1. brackets → basic tax
 * 2. subtract non-refundable credits (BPA etc.), clamp at 0
 * 3. compute surtax on post-credit tax
 * 4. add surtax
 * 5. subtract dividend tax credit (after surtax), clamp at 0
 * 6. add Ontario Health Premium (piecewise, capped at $900)
 */
function calculateOntarioTax(taxableIncome, prov, dividends) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, prov.brackets);

  // Step 2: Ontario non-refundable credits (currently BPA only), credit = amount × rate.
  const credits = [];
  let creditTotal = 0;
  if (prov.credits && prov.credits.basicPersonalAmount) {
    const rate = prov.credits.basicPersonalAmount.rate;
    const credit = prov.credits.basicPersonalAmount.amount * rate;
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    creditTotal += credit;
  }
  const taxAfterCredits = Math.max(0, baseTax - creditTotal);

  // Step 3: Ontario surtax on taxAfterCredits (not reduced by dividend credits).
  let surtax = 0;
  const surtaxes = [];
  const s = (prov.surtaxes && prov.surtaxes[0]) || null;
  if (s && s.threshold) {
    if (taxAfterCredits > s.threshold) {
      const amount = 0.20 * (taxAfterCredits - s.threshold);
      surtax += amount;
      surtaxes.push({ name: `${s.name} 20%`, amount });
    }
    if (s.threshold2 && taxAfterCredits > s.threshold2) {
      const amount = 0.36 * (taxAfterCredits - s.threshold2);
      surtax += amount;
      surtaxes.push({ name: `${s.name} 36%`, amount });
    }
  }

  // Step 4: Add surtax.
  const taxWithSurtax = taxAfterCredits + surtax;

  // Step 5: Ontario dividend tax credit AFTER surtax.
  // For eligible dividends: credit = grossed_up_eligible × 0.10 (encoded in dividends.eligibleDTCProv).
  let provincialDividendCredits = 0;
  if (dividends) {
    provincialDividendCredits =
      (dividends.eligibleDTCProv || 0) +
      (dividends.nonEligibleDTCProv || 0);
  }
  const taxAfterDividendCredits = Math.max(0, taxWithSurtax - provincialDividendCredits);

  // Step 6: Ontario Health Premium on taxableIncome, added after credits, surtax, and DTC.
  const premiums = [];
  const healthPremium = calculateOntarioHealthPremium2025(taxableIncome);
  if (healthPremium > 0) {
    premiums.push({ name: 'Ontario Health Premium', amount: healthPremium });
  }

  const provincialTaxReduction = 0;
  const minimumTaxAdjustments = 0;
  const taxAfterReductions = taxAfterDividendCredits; // no reductions implemented yet
  const netTax = taxAfterReductions + healthPremium;

  return {
    bracketLines,
    baseTax,
    credits,
    surtaxes,
    premiums,
    taxAfterCredits,
    surtaxTotal: surtax,
    taxAfterSurtax: taxWithSurtax,
    minimumTaxAdjustments,
    provincialDividendCredits,
    taxAfterDividendCredits,
    provincialTaxReduction,
    taxAfterReductions,
    netTax,
  };
}

/**
 * Compute DTC amount from explicit schema: base ("cash" | "grossed_up") and rate.
 * No assumptions; missing province or invalid schema throws.
 */
function dtcAmount(cashAmount, grossUpRate, creditConfig, provinceCode) {
  if (!creditConfig || (creditConfig.base !== 'cash' && creditConfig.base !== 'grossed_up')) {
    throw new Error('Dividend credit must specify base "cash" or "grossed_up" and rate.');
  }
  const baseAmount = creditConfig.base === 'grossed_up' ? cashAmount * grossUpRate : cashAmount;
  const rate = typeof creditConfig.rate === 'number' ? creditConfig.rate : (creditConfig.provinces && creditConfig.provinces[provinceCode]);
  if (rate == null || typeof rate !== 'number') {
    throw new Error(`Missing dividend tax credit rate for province "${provinceCode}". Check dividends.json.`);
  }
  return baseAmount * rate;
}

/**
 * Calculate dividend gross-up and tax credits from explicit schema (base + rate per credit).
 * @param {number} eligibleDividends - Eligible dividend (cash) amount
 * @param {number} nonEligibleDividends - Non-eligible dividend (cash) amount
 * @param {string} provinceCode - Two-letter province code
 * @param {Object} dividendsData - dividends.json shape (eligible/nonEligible with credits.federal, credits.provincial)
 * @returns {Object} Gross-up amounts and federal/provincial DTC amounts
 */
function calculateDividends(eligibleDividends, nonEligibleDividends, provinceCode, dividendsData) {
  const el = dividendsData.eligible;
  const ne = dividendsData.nonEligible;

  const eligibleGrossUp = eligibleDividends * (el.grossUpRate - 1);
  const nonEligibleGrossUp = nonEligibleDividends * (ne.grossUpRate - 1);

  const eligibleDTCFed = dtcAmount(eligibleDividends, el.grossUpRate, el.credits.federal, null);
  const eligibleDTCProv = dtcAmount(eligibleDividends, el.grossUpRate, el.credits.provincial, provinceCode);
  const nonEligibleDTCFed = dtcAmount(nonEligibleDividends, ne.grossUpRate, ne.credits.federal, null);
  const nonEligibleDTCProv = dtcAmount(nonEligibleDividends, ne.grossUpRate, ne.credits.provincial, provinceCode);

  return {
    eligibleGrossUp,
    nonEligibleGrossUp,
    eligibleDTCFed,
    eligibleDTCProv,
    nonEligibleDTCFed,
    nonEligibleDTCProv,
  };
}

/**
 * Calculate CPP contribution (CPP1 + CPP2)
 * @param {number} employmentIncome - Employment income
 * @param {Object} payroll - Payroll data (cpp, cpp2)
 * @returns {Object} CPP calculation
 */
function calculateCPP(employmentIncome, payroll) {
  
  // CPP1: Base CPP on earnings up to YMPE
  const pensionableEarnings = Math.max(0, Math.min(employmentIncome, payroll.cpp.maxPensionableEarnings) - payroll.cpp.basicExemption);
  const cpp1 = Math.min(pensionableEarnings * payroll.cpp.rate, payroll.cpp.maxContribution);
  
  // CPP2: Additional CPP on earnings above YMPE up to YAMPE (2025)
  let cpp2 = 0;
  if (payroll.cpp2 && employmentIncome > payroll.cpp.maxPensionableEarnings) {
    const yampe = payroll.cpp.maxPensionableEarnings + payroll.cpp2.maxAdditionalEarnings; // 71,300 + 73,000 = 144,300
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
 * @param {Object} payroll - Payroll data (ei)
 * @returns {Object} EI calculation
 */
function calculateEI(employmentIncome, payroll) {
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

const MARGINAL_DELTA = 1;

/**
 * Compute marginal tax rates by perturbing the actual input type (not taxableIncome).
 * Returns federal+provincial additional tax per $1 of each income type.
 */
function computeMarginalRatesByType(input, dataCtx) {
  const base = runFullCalculation(input, dataCtx);
  const baseTax = base.totalIncomeTax;

  const marginal = (deltaInput) => {
    const perturbed = runFullCalculation({ ...input, ...deltaInput }, dataCtx);
    return (perturbed.totalIncomeTax - baseTax) / MARGINAL_DELTA;
  };

  const employment = marginal({ employmentIncome: (input.employmentIncome || 0) + MARGINAL_DELTA });
  const eligibleDividends = marginal({ eligibleDividends: (input.eligibleDividends || 0) + MARGINAL_DELTA });
  const nonEligibleDividends = marginal({ nonEligibleDividends: (input.nonEligibleDividends || 0) + MARGINAL_DELTA });
  const capitalGains = marginal({ capitalGains: (input.capitalGains || 0) + MARGINAL_DELTA });

  const combined = input.employmentIncome > 0 ? employment
    : input.eligibleDividends > 0 ? eligibleDividends
    : input.nonEligibleDividends > 0 ? nonEligibleDividends
    : input.capitalGains > 0 ? capitalGains
    : employment;

  return { employment, eligibleDividends, nonEligibleDividends, capitalGains, combined };
}

/**
 * Run full tax calculation (internal). Used by computePersonalTax and marginal rate.
 */
function runFullCalculation(input, dataCtx) {
  const {
    employmentIncome = 0,
    selfEmploymentIncome = 0,
    otherIncome = 0,
    eligibleDividends = 0,
    nonEligibleDividends = 0,
    capitalGains = 0,
    rrspDeduction = 0,
    fhsaDeduction = 0,
    estimatedDeductions = 0,
  } = input;
  const provinceCode = normalizeProvince(input.province);
  if (!provinceCode) throw new Error(`Unrecognized province "${input.province}".`);
  const prov = dataCtx.getProvince(input.province);

  const dividendsData = dataCtx.dividends;
  const dividends = calculateDividends(eligibleDividends, nonEligibleDividends, provinceCode, dividendsData);
  const grossedUpEligible = eligibleDividends * dividendsData.eligible.grossUpRate;
  const grossedUpNonEligible = nonEligibleDividends * dividendsData.nonEligible.grossUpRate;
  const capitalGainsInclusionRate = 0.50;
  const taxableCapitalGains = capitalGains * capitalGainsInclusionRate;
  const taxableIncome = Math.max(0,
    employmentIncome + selfEmploymentIncome + otherIncome +
    grossedUpEligible + grossedUpNonEligible + taxableCapitalGains -
    rrspDeduction - fhsaDeduction - estimatedDeductions
  );

  const cppCalc = calculateCPP(employmentIncome, dataCtx.payroll);
  const eiCalc = calculateEI(employmentIncome, dataCtx.payroll);
  const cpp = cppCalc.cpp;
  const ei = eiCalc.ei;

  const federal = calculateFederalTax(taxableIncome, cpp, ei, employmentIncome, dividends, dataCtx.federal);
  const provincial = (provinceCode === 'ON'
    ? calculateOntarioTax(taxableIncome, prov, dividends)
    : calculateProvincialTaxGeneric(taxableIncome, prov, dividends));
  const totalIncomeTax = federal.netTax + provincial.netTax;
  return {
    totalIncomeTax,
    totalIncome: employmentIncome + selfEmploymentIncome + otherIncome + eligibleDividends + nonEligibleDividends + capitalGains,
    taxableIncome,
    federal,
    provincial,
    cpp,
    ei,
    cppCalc,
    eiCalc,
    dividends,
    dividendGrossUp: dividends.eligibleGrossUp + dividends.nonEligibleGrossUp,
    grossedUpEligible,
    grossedUpNonEligible,
    capitalGainsInclusionRate,
    taxableCapitalGains,
  };
}

/**
 * Main tax computation function
 * @param {Object} input - Input object with:
 *   - year: tax year
 *   - province: province code
 *   - employmentIncome: employment income
 *   - selfEmploymentIncome: self-employment income
 *   - otherIncome: other income
 *   - eligibleDividends: eligible dividends
 *   - nonEligibleDividends: non-eligible dividends
 *   - capitalGains: capital gains
 *   - rrspDeduction: RRSP deduction
 *   - fhsaDeduction: FHSA deduction
 *   - taxPaid: tax already paid
 * @param {Object} data - Pre-loaded tax data (optional, will load if not provided)
 * @returns {Object} Complete tax calculation result
 */
export function computePersonalTax(input, opts = {}) {
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

  const dataCtx = buildDataContext(opts);
  const result = runFullCalculation(input, dataCtx);
  const {
    totalIncome,
    taxableIncome,
    federal,
    provincial,
    cpp,
    ei,
    cppCalc,
    eiCalc,
    dividends,
    dividendGrossUp,
    capitalGainsInclusionRate,
    taxableCapitalGains,
  } = result;

  const federalTax = federal.netTax;
  const provTax = provincial.netTax;
  const totalIncomeTax = federalTax + provTax;
  const totalBurden = totalIncomeTax + cpp + ei;
  const afterTaxIncome = totalIncome - totalIncomeTax;
  const takeHomeAfterPayroll = totalIncome - totalBurden;
  const avgRate = totalIncome > 0 ? totalIncomeTax / totalIncome : 0;

  const marginalRates = computeMarginalRatesByType(input, dataCtx);
  const marginalRate = marginalRates.combined;

  const refundOrOwing = taxPaid - totalIncomeTax;

  if (opts?.validationMode) {
    const isOnDividendTestCase =
      year === 2025 && province === 'ON' &&
      employmentIncome === 0 && selfEmploymentIncome === 0 && otherIncome === 0 &&
      nonEligibleDividends === 0 && capitalGains === 0 &&
      rrspDeduction === 0 && fhsaDeduction === 0 && estimatedDeductions === 0 &&
      taxPaid === 0 && eligibleDividends === 160000;
    if (isOnDividendTestCase) {
      console.assert(Math.abs(federalTax - 13570) < 1, 'Federal tax validation failed for ON eligible dividend test case.');
      console.assert(Math.abs(provTax - 6898) < 1, 'Ontario tax validation failed for ON eligible dividend test case.');
      console.assert(Math.abs(totalIncomeTax - 20470) < 1, 'Total tax validation failed for ON eligible dividend test case.');
    }
  }

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
      refundOrOwing,
    },
    breakdown: {
      federal: { ...federal, dtcApplied: federal.federalDividendCredits || 0 },
      provincial: { ...provincial, dtcApplied: provincial.provincialDividendCredits || 0 },
      dividends: { ...dividends, totalGrossUp: dividendGrossUp },
      capitalGains: { inclusionRate: capitalGainsInclusionRate, taxableCapitalGains },
      payroll: { cpp: cppCalc, ei: eiCalc },
      marginalRates,
    },
  };
}
