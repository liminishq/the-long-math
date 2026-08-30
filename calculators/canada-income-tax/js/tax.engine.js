/**
 * Pure tax calculation engine
 * No DOM dependencies - deterministic, unit-testable
 * Supports opts.taxData (preferred) and opts.dataOverride (compatibility alias).
 */

import { getFederalData, getProvincesData, getProvincialData, getPayrollData, getDividendsData, normalizeProvince } from './tax.data.js';
import {
  MARGINAL_DELTA,
  combinedBracketMarginalRate,
  isMarginalRateInBounds
} from './marginal-tax.js';
import {
  calculateOntarioTaxReduction,
  calculateProvincialTaxReduction,
  resolveEnhancedBasicPersonalAmount
} from './tax.bpa.js';
import {
  addAgeAndPensionCredits,
  computeOasRecovery
} from './tax.credits.js';

export { MARGINAL_DELTA } from './marginal-tax.js';

const DEFAULT_PROVINCIAL_STEPS = ['brackets', 'credits', 'surtax', 'minTax', 'dividendCredit', 'reduction', 'premiums'];

/**
 * Build data context from an explicit bundle or from legacy loaded tax data.
 * If any required official value is missing, throws with a clear message.
 */
function buildDataContext(opts = {}, expectedYear = null) {
  const hasTaxData = Object.prototype.hasOwnProperty.call(opts || {}, 'taxData');
  const hasDataOverride = Object.prototype.hasOwnProperty.call(opts || {}, 'dataOverride');
  if (hasTaxData || hasDataOverride) {
    const explicit = hasTaxData ? opts.taxData : opts.dataOverride;
    const required = ['federal', 'provinces', 'payroll', 'dividends'];
    const missing = required.filter((key) => !explicit?.[key]);
    if (missing.length > 0) {
      throw new Error(
        `Explicit tax data bundle is incomplete; missing: ${missing.join(', ')}.`
      );
    }

    const explicitYear = Number(
      explicit.year ?? explicit.meta?.targetYear ?? explicit.federal?.year
    );
    const hasExpectedYear = expectedYear != null && expectedYear !== '';
    const requestedYear = Number(expectedYear);
    if (
      Number.isFinite(explicitYear) &&
      hasExpectedYear &&
      Number.isFinite(requestedYear) &&
      explicitYear !== requestedYear
    ) {
      throw new Error(
        `Tax data year ${explicitYear} does not match calculation year ${requestedYear}.`
      );
    }

    return {
      federal: explicit.federal,
      provinces: explicit.provinces,
      payroll: explicit.payroll,
      dividends: explicit.dividends,
      getProvince: (province) => {
        const code = normalizeProvince(province);
        if (!code || !explicit.provinces[code]) throw new Error(`Province "${province}" not found in data.`);
        return explicit.provinces[code];
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
 * @param {{ roundToDollar?: boolean }} opts - If roundToDollar is true (default), round each bracket tax per CRA Schedule 1
 * @returns {Array} Array of bracket calculations
 */
function calculateBracketTax(taxableIncome, brackets, opts = {}) {
  const roundToDollar = opts.roundToDollar !== false;
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
    const tax = roundToDollar ? Math.round(taxInBracket) : taxInBracket;

    bracketLines.push({
      threshold: bracket.threshold,
      rate: bracket.rate,
      taxableInBracket: incomeInBracket,
      tax
    });

    totalTax += tax;
    remainingIncome -= incomeInBracket;
  }

  return { bracketLines, baseTax: totalTax };
}

function roundNetTax(amount, opts = {}) {
  const tax = Math.max(0, amount);
  return opts.roundToDollar === false ? tax : Math.round(tax);
}

/**
 * Ontario Health Premium (Ontario Taxation Act, 2007, Division C).
 * Piecewise schedule for 2005 and later tax years — band dollar amounts are not annual CPI indexation
 * (verify against Ontario Ministry of Finance / ontario.ca).
 * Premium is added after Ontario tax, credits, surtax, and dividend credits in this engine.
 *
 * @param {number} taxableIncome - Provincial taxable income
 * @returns {number} Ontario Health Premium
 */
function calculateOntarioHealthPremiumStatutory(taxableIncome) {
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
  if (income <= 200000) return 750;
  if (income <= 200600) {
    return 750 + 0.25 * (income - 200000);
  }
  return 900;
}

function calculateOntarioHealthPremium(taxableIncome, _taxYear) {
  void _taxYear;
  return calculateOntarioHealthPremiumStatutory(taxableIncome);
}

/**
 * Calculate federal tax. Mirrors Federal Schedule 1 ordering.
 * @param {number} taxableIncome - Taxable income after applicable line 22200/22215 CPP deductions
 * @param {number} cppCreditable - Base CPP for line 30800/31000 credits (not enhanced CPP or CPP2)
 * @param {number} ei - EI premium (credit only; not deducted from taxable income)
 * @param {number} employmentIncome - Employment income (for Canada Employment Amount eligibility)
 * @param {Object} dividends - Pre-computed dividend amounts (eligibleDTCFed, nonEligibleDTCFed)
 * @param {Object} federal - Federal tax data (brackets, credits)
 * @param {Object} [opts]
 * @param {number} [opts.netIncome] - Net income for enhanced BPA phase-out (defaults to taxableIncome)
 * @returns {Object} Federal tax breakdown
 */
function calculateFederalTax(taxableIncome, cppCreditable, ei, employmentIncome, dividends, federal, opts = {}) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, federal.brackets, opts);

  // Step B — Federal non-refundable credits (Schedule 1 / line 35000 worksheet).
  const credits = [];
  const creditBases = [];
  let totalCredits = 0;

  const creditRate = federal.credits.lowestRateForCredits ?? Math.min(...federal.brackets.map(b => b.rate));
  const netIncomeForBpa = opts.netIncome != null ? opts.netIncome : taxableIncome;

  if (federal.credits.basicPersonalAmount) {
    const bpa = resolveEnhancedBasicPersonalAmount(
      federal.credits.basicPersonalAmount,
      netIncomeForBpa,
      federal.brackets
    );
    const base = bpa.amount;
    const credit = base * creditRate;
    creditBases.push({
      name: 'Basic Personal Amount',
      base,
      rate: creditRate,
      credit,
      maximum: bpa.maximum,
      minimum: bpa.minimum,
      phaseOutStart: bpa.phaseOutStart,
      phaseOutEnd: bpa.phaseOutEnd,
      phased: bpa.phased
    });
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    totalCredits += credit;
  }

  if (federal.credits.canadaEmploymentAmount && employmentIncome > 0) {
    const base = Math.min(employmentIncome, federal.credits.canadaEmploymentAmount.amount);
    const credit = base * creditRate;
    creditBases.push({ name: 'Canada Employment Amount', base, rate: creditRate, credit });
    credits.push({ name: 'Canada Employment Amount', amount: credit });
    totalCredits += credit;
  }

  // Lines 30800/31000 base CPP credit + EI (line 31200); enhanced CPP is deducted, not credited.
  if (federal.credits.cppEiCredit && cppCreditable > 0) {
    const rate = federal.credits.cppEiCredit.rate;
    const credit = cppCreditable * rate;
    creditBases.push({ name: 'CPP (base)', base: cppCreditable, rate, credit });
    credits.push({ name: 'CPP (base)', amount: credit });
    totalCredits += credit;
  }
  if (federal.credits.cppEiCredit && ei > 0) {
    const rate = federal.credits.cppEiCredit.rate;
    const credit = ei * rate;
    creditBases.push({ name: 'EI', base: ei, rate, credit });
    credits.push({ name: 'EI', amount: credit });
    totalCredits += credit;
  }

  totalCredits += addAgeAndPensionCredits({
    creditsConfig: federal.credits,
    creditRate,
    age: opts.age,
    netIncome: netIncomeForBpa,
    eligiblePensionIncome: opts.eligiblePensionIncome,
    creditBases,
    credits
  });

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

  const netTax = roundNetTax(taxAfterDividendCredits + minimumTaxAdjustments, opts);

  return {
    bracketLines,
    baseTax,
    credits,
    creditBases,
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
function calculateProvincialTaxGeneric(taxableIncome, prov, dividends, cppCreditable, ei, opts = {}) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, prov.brackets, opts);

  const credits = [];
  const creditBases = [];
  let totalCredits = 0;

  const defaultProvCreditRate = Math.min(...prov.brackets.map(b => b.rate));
  const netIncomeForBpa = opts.netIncome != null ? opts.netIncome : taxableIncome;

  if (prov.credits && prov.credits.basicPersonalAmount) {
    const configuredRate = prov.credits.basicPersonalAmount.rate;
    const creditRate = typeof configuredRate === 'number'
      ? configuredRate
      : defaultProvCreditRate;
    const bpa = resolveEnhancedBasicPersonalAmount(
      prov.credits.basicPersonalAmount,
      netIncomeForBpa,
      null
    );
    const base = bpa.amount;
    const credit = base * creditRate;
    creditBases.push({
      name: 'Basic Personal Amount',
      base,
      rate: creditRate,
      credit,
      maximum: bpa.maximum,
      minimum: bpa.minimum,
      phaseOutStart: bpa.phaseOutStart,
      phaseOutEnd: bpa.phaseOutEnd,
      phased: bpa.phased
    });
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    totalCredits += credit;
  }

  // Form 428 lines 58240/58280 — provincial credit on base CPP/QPP and EI (when configured).
  if (prov.credits?.cppEiCredit) {
    const creditRate = prov.credits.cppEiCredit.rate ?? defaultProvCreditRate;
    if (cppCreditable > 0) {
      const credit = cppCreditable * creditRate;
      creditBases.push({ name: 'CPP (base)', base: cppCreditable, rate: creditRate, credit });
      credits.push({ name: 'CPP (base)', amount: credit });
      totalCredits += credit;
    }
    if (ei > 0) {
      const credit = ei * creditRate;
      creditBases.push({ name: 'EI', base: ei, rate: creditRate, credit });
      credits.push({ name: 'EI', amount: credit });
      totalCredits += credit;
    }
  }

  const defaultProvCreditRateAfterCpp = Math.min(...prov.brackets.map(b => b.rate));
  const personCreditRate = prov.credits?.basicPersonalAmount?.rate
    ?? prov.credits?.ageAmount?.rate
    ?? defaultProvCreditRateAfterCpp;
  totalCredits += addAgeAndPensionCredits({
    creditsConfig: prov.credits,
    creditRate: personCreditRate,
    age: opts.age,
    netIncome: netIncomeForBpa,
    eligiblePensionIncome: opts.eligiblePensionIncome,
    creditBases,
    credits
  });

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

  const netIncomeForReduction = opts.netIncome != null ? opts.netIncome : taxableIncome;
  const reductionResult = calculateProvincialTaxReduction(
    taxAfterDividendCredits,
    netIncomeForReduction,
    prov.taxReduction || {}
  );
  const provincialTaxReduction = reductionResult.reduction || 0;
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

  const netTax = roundNetTax(taxAfterReductions + premiumsTotal, opts);

  return {
    bracketLines,
    baseTax,
    credits,
    creditBases,
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
 * Ontario-specific provincial tax calculation, mirroring ON428 ordering:
 * 1. brackets → basic tax
 * 2. subtract non-refundable credits (BPA etc.), clamp at 0
 * 3. compute surtax on post-credit tax
 * 4. add surtax
 * 5. subtract dividend tax credit (after surtax), clamp at 0
 * 6. Ontario Tax Reduction (CRA T4032-ON / ON428)
 * 7. add Ontario Health Premium (piecewise, capped at $900)
 */
function calculateOntarioTax(taxableIncome, prov, dividends, cppCreditable, ei, opts = {}, taxYear = 2025) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, prov.brackets, opts);

  // Step 2: Ontario non-refundable credits (ON428 — BPA, lines 58240/58280 CPP/EI when configured).
  const credits = [];
  const creditBases = [];
  let creditTotal = 0;
  const defaultRate = prov.credits?.basicPersonalAmount?.rate ?? Math.min(...prov.brackets.map(b => b.rate));

  if (prov.credits?.basicPersonalAmount) {
    const rate = prov.credits.basicPersonalAmount.rate;
    const base = prov.credits.basicPersonalAmount.amount;
    const credit = base * rate;
    creditBases.push({ name: 'Basic Personal Amount', base, rate, credit });
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    creditTotal += credit;
  }
  if (prov.credits?.cppEiCredit) {
    const rate = prov.credits.cppEiCredit.rate ?? defaultRate;
    if (cppCreditable > 0) {
      const credit = cppCreditable * rate;
      creditBases.push({ name: 'CPP (base)', base: cppCreditable, rate, credit });
      credits.push({ name: 'CPP (base)', amount: credit });
      creditTotal += credit;
    }
    if (ei > 0) {
      const credit = ei * rate;
      creditBases.push({ name: 'EI', base: ei, rate, credit });
      credits.push({ name: 'EI', amount: credit });
      creditTotal += credit;
    }
  }
  creditTotal += addAgeAndPensionCredits({
    creditsConfig: prov.credits,
    creditRate: defaultRate,
    age: opts.age,
    netIncome: opts.netIncome != null ? opts.netIncome : taxableIncome,
    eligiblePensionIncome: opts.eligiblePensionIncome,
    creditBases,
    credits
  });
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
  let provincialDividendCredits = 0;
  if (dividends) {
    provincialDividendCredits =
      (dividends.eligibleDTCProv || 0) +
      (dividends.nonEligibleDTCProv || 0);
  }
  const taxAfterDividendCredits = Math.max(0, taxWithSurtax - provincialDividendCredits);

  // Step 6: Ontario Tax Reduction (before OHP).
  const otr = calculateOntarioTaxReduction(taxAfterDividendCredits, prov.taxReduction || {});
  const provincialTaxReduction = otr.reduction;
  const minimumTaxAdjustments = 0;
  const taxAfterReductions = Math.max(0, taxAfterDividendCredits - provincialTaxReduction);

  // Step 7: Ontario Health Premium on taxableIncome.
  const premiums = [];
  const healthPremium = calculateOntarioHealthPremium(taxableIncome, taxYear);
  if (healthPremium > 0) {
    premiums.push({ name: 'Ontario Health Premium', amount: healthPremium });
  }

  const netTax = roundNetTax(taxAfterReductions + healthPremium, opts);

  return {
    bracketLines,
    baseTax,
    credits,
    creditBases,
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
 * CPP employee contributions split for T1 return (Schedule 8 / lines 30800, 22215).
 * - Base CPP (CPP1 base rate): non-refundable credit only (line 30800).
 * - First additional CPP (CPP1 enhancement): deductible (line 22215).
 * - CPP2 (second additional): deductible (line 22215).
 */
function calculateCPP(employmentIncome, payroll) {
  const ympe = payroll.cpp.maxPensionableEarnings;
  const pensionableEarnings = Math.max(
    0,
    Math.min(employmentIncome, ympe) - payroll.cpp.basicExemption
  );

  const baseRate = payroll.cpp.baseRate ?? payroll.cpp.rate;
  const firstAdditionalRate = payroll.cpp.firstAdditionalRate ?? 0;
  const combinedCpp1Rate = payroll.cpp.rate;

  const cppBase = Math.min(
    pensionableEarnings * baseRate,
    payroll.cpp.maxBaseContribution ?? pensionableEarnings * baseRate
  );
  const cppFirstAdditional = Math.min(
    pensionableEarnings * firstAdditionalRate,
    payroll.cpp.maxFirstAdditionalContribution ?? pensionableEarnings * firstAdditionalRate
  );
  const cpp1 = Math.min(
    cppBase + cppFirstAdditional,
    payroll.cpp.maxContribution
  );

  let cpp2 = 0;
  if (payroll.cpp2 && employmentIncome > ympe) {
    const yampe = ympe + payroll.cpp2.maxAdditionalEarnings;
    const additionalEarnings = Math.min(employmentIncome, yampe) - ympe;
    cpp2 = Math.min(
      additionalEarnings * payroll.cpp2.rate,
      payroll.cpp2.maxAdditionalContribution
    );
  }

  const cppDeductible = cppFirstAdditional + cpp2;
  const totalCpp = cpp1 + cpp2;

  return {
    cpp: totalCpp,
    cpp1,
    cpp2: cpp2 || 0,
    cppBaseCreditable: cppBase,
    cppFirstAdditionalDeductible: cppFirstAdditional,
    cpp2Deductible: cpp2,
    cppDeductible,
    pensionableEarnings,
    inputs: {
      employmentIncome,
      maxPensionableEarnings: ympe,
      basicExemption: payroll.cpp.basicExemption,
      baseRate,
      firstAdditionalRate,
      combinedCpp1Rate,
      maxBaseContribution: payroll.cpp.maxBaseContribution,
      maxFirstAdditionalContribution: payroll.cpp.maxFirstAdditionalContribution,
      maxContribution: payroll.cpp.maxContribution,
      cpp2Rate: payroll.cpp2 ? payroll.cpp2.rate : 0,
      cpp2MaxContribution: payroll.cpp2 ? payroll.cpp2.maxAdditionalContribution : 0,
    },
  };
}

/**
 * Schedule 8-style CPP when income can include self-employment.
 *
 * The self-employed portion is the remaining employee-equivalent contribution
 * after T4 employment has used the shared exemption and annual maxima. That
 * portion is doubled for cash contributions. One half of its base CPP is
 * creditable (line 31000); the other half of base CPP and both halves of first
 * additional CPP and CPP2 are deductible through the Schedule 8 line 22200 result.
 */
function calculateCPPForIncomeSources(employmentIncome, selfEmploymentIncome, payroll) {
  const employment = Math.max(0, Number(employmentIncome) || 0);
  const selfEmployment = Math.max(0, Number(selfEmploymentIncome) || 0);
  const employeeCalc = calculateCPP(employment, payroll);
  if (!(selfEmployment > 0)) return employeeCalc;

  const combinedEquivalent = calculateCPP(employment + selfEmployment, payroll);
  const rawSelfBase = Math.max(
    0,
    combinedEquivalent.cppBaseCreditable - employeeCalc.cppBaseCreditable
  );
  const rawSelfFirstAdditional = Math.max(
    0,
    combinedEquivalent.cppFirstAdditionalDeductible -
      employeeCalc.cppFirstAdditionalDeductible
  );
  const rawSelfCpp2 = Math.max(
    0,
    combinedEquivalent.cpp2Deductible - employeeCalc.cpp2Deductible
  );
  const roundCents = (amount) =>
    Math.round(
      (amount + Number.EPSILON * Math.max(1, Math.abs(amount))) * 100
    ) / 100;
  const selfCashContribution = roundCents(
    2 * (rawSelfBase + rawSelfFirstAdditional + rawSelfCpp2)
  );
  const selfBase = roundCents(rawSelfBase);
  const selfFirstAdditionalDeductible = roundCents(2 * rawSelfFirstAdditional);
  const selfCpp2Deductible = roundCents(2 * rawSelfCpp2);
  const selfEmploymentBaseDeductible = roundCents(
    selfCashContribution -
      selfBase -
      selfFirstAdditionalDeductible -
      selfCpp2Deductible
  );
  const selfEmployeeEquivalent = roundCents(selfCashContribution / 2);
  const cppFirstAdditionalDeductible =
    employeeCalc.cppFirstAdditionalDeductible + selfFirstAdditionalDeductible;
  const cpp2Deductible = employeeCalc.cpp2Deductible + selfCpp2Deductible;
  const cppDeductible =
    cppFirstAdditionalDeductible +
    cpp2Deductible +
    selfEmploymentBaseDeductible;

  return {
    cpp: employeeCalc.cpp + selfCashContribution,
    cpp1:
      employeeCalc.cpp1 +
      selfCashContribution -
      selfCpp2Deductible,
    cpp2: employeeCalc.cpp2 + selfCpp2Deductible,
    cppBaseCreditable: employeeCalc.cppBaseCreditable + selfBase,
    cppFirstAdditionalDeductible,
    cpp2Deductible,
    cppDeductible,
    selfEmploymentBaseDeductible,
    selfEmploymentCashContribution: selfCashContribution,
    selfEmploymentEmployeeEquivalent: selfEmployeeEquivalent,
    pensionableEarnings: combinedEquivalent.pensionableEarnings,
    employment,
    selfEmployment: {
      baseCreditable: selfBase,
      baseDeductible: selfEmploymentBaseDeductible,
      firstAdditionalDeductible: selfFirstAdditionalDeductible,
      cpp2Deductible: selfCpp2Deductible,
      cashContribution: selfCashContribution,
    },
    inputs: {
      ...combinedEquivalent.inputs,
      employmentIncome: employment,
      selfEmploymentIncome: selfEmployment,
    },
  };
}

/**
 * Employer CPP for standard T4 employment: matched to employee CPP (same rates/caps).
 * Reused by calculators that need to model owner salary as a corporate deduction.
 */
export function employerCppForT4Employment(employmentIncome, opts = {}) {
  const dataCtx = buildDataContext(opts);
  const income = Math.max(0, Number(employmentIncome) || 0);
  return calculateCPP(income, dataCtx.payroll).cpp;
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

/** Normalize numeric input from form (may be string). */
function num(input, field) {
  const v = input[field];
  if (v == null || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Deep copy input for perturbation (only top-level number fields matter).
 * Ensures numeric fields are numbers so marginal logic and runFullCalculation see consistent types.
 */
function cloneInput(input) {
  return {
    year: input.year,
    province: input.province,
    employmentIncome: num(input, 'employmentIncome'),
    selfEmploymentIncome: num(input, 'selfEmploymentIncome'),
    otherIncome: num(input, 'otherIncome'),
    eligibleDividends: num(input, 'eligibleDividends'),
    nonEligibleDividends: num(input, 'nonEligibleDividends'),
    capitalGains: num(input, 'capitalGains'),
    rrspDeduction: num(input, 'rrspDeduction'),
    fhsaDeduction: num(input, 'fhsaDeduction'),
    estimatedDeductions: num(input, 'estimatedDeductions'),
    taxPaid: num(input, 'taxPaid'),
    age: input.age == null || input.age === '' ? null : num(input, 'age'),
    eligiblePensionIncome: num(input, 'eligiblePensionIncome'),
    oasBenefits: num(input, 'oasBenefits'),
  };
}

/** Income types where bracket lookup is a valid fallback when finite-difference fails. */
const BRACKET_FALLBACK_FIELDS = new Set(['employmentIncome', 'selfEmploymentIncome', 'otherIncome']);

/**
 * Marginal tax rate = delta tax per dollar of income type X.
 * Uses exact, unrounded tax values so fractional-dollar alignment cannot move the displayed rate.
 * Inactive income types (zero dollars) are not perturbed — returns null for those fields.
 */
function computeMarginalRatesByType(input, dataCtx) {
  const roundOpts = { roundToDollar: false };
  const baseline = runFullCalculation(input, dataCtx, roundOpts);
  const baseTax = baseline.totalIncomeTax;
  const provinceCode = normalizeProvince(input.province);

  function bracketFallback() {
    if (!provinceCode) return null;
    const prov = dataCtx.getProvince(input.province);
    const rate = combinedBracketMarginalRate(
      baseline.taxableIncome,
      dataCtx.federal?.brackets,
      prov?.brackets
    );
    return isMarginalRateInBounds(rate) ? rate : null;
  }

  function marginalFor(field, currentValue) {
    const base = Math.max(0, Number(currentValue) || 0);
    if (base <= 0) return null;

    const clone = cloneInput(input);
    clone[field] = base + MARGINAL_DELTA;
    const newResult = runFullCalculation(clone, dataCtx, roundOpts);
    let rate = (newResult.totalIncomeTax - baseTax) / MARGINAL_DELTA;

    if (!isMarginalRateInBounds(rate) && BRACKET_FALLBACK_FIELDS.has(field)) {
      rate = bracketFallback();
    }

    return isMarginalRateInBounds(rate) ? rate : null;
  }

  const employment = marginalFor('employmentIncome', num(input, 'employmentIncome'));
  const eligibleDividendsMarg = marginalFor('eligibleDividends', num(input, 'eligibleDividends'));
  const nonEligibleDividendsMarg = marginalFor('nonEligibleDividends', num(input, 'nonEligibleDividends'));
  const otherIncomeMarg = marginalFor('otherIncome', num(input, 'otherIncome'));
  const capitalGainsMarg = marginalFor('capitalGains', num(input, 'capitalGains'));

  const hasEmployment = num(input, 'employmentIncome') > 0;
  const hasEligibleDiv = num(input, 'eligibleDividends') > 0;
  const hasOtherIncome = num(input, 'otherIncome') > 0;
  const hasNonEligibleDiv = num(input, 'nonEligibleDividends') > 0;
  const hasCapitalGains = num(input, 'capitalGains') > 0;

  const pick = (...candidates) => candidates.find(isMarginalRateInBounds) ?? null;

  let combined = pick(
    hasEmployment ? employment : null,
    hasEligibleDiv ? eligibleDividendsMarg : null,
    hasOtherIncome ? otherIncomeMarg : null,
    hasNonEligibleDiv ? nonEligibleDividendsMarg : null,
    hasCapitalGains ? capitalGainsMarg : null,
    employment,
    eligibleDividendsMarg,
    otherIncomeMarg,
    nonEligibleDividendsMarg,
    capitalGainsMarg
  );

  if (!isMarginalRateInBounds(combined)) {
    combined = bracketFallback();
  }
  if (!isMarginalRateInBounds(combined)) {
    combined = 0;
  }

  return {
    employment,
    eligibleDividends: eligibleDividendsMarg,
    nonEligibleDividends: nonEligibleDividendsMarg,
    otherIncome: otherIncomeMarg,
    capitalGains: capitalGainsMarg,
    combined
  };
}

/**
 * Run full tax calculation (internal). Used by computePersonalTax and marginal rate.
 * @param {Object} runOpts - Optional. { roundToDollar: false } to use exact tax values (for marginal rate calculation).
 */
function runFullCalculation(input, dataCtx, runOpts = {}) {
  const taxYear = input.year ?? 2025;
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
    age = null,
    eligiblePensionIncome = 0,
    oasBenefits = 0,
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

  // QPP/QPIP remain outside this engine's verified scope. Preserve the
  // pre-existing Quebec employment path, but do not approximate QPP by
  // charging doubled federal CPP on self-employment income.
  const cppCalc = provinceCode === 'QC'
    ? calculateCPP(employmentIncome, dataCtx.payroll)
    : calculateCPPForIncomeSources(
        employmentIncome,
        selfEmploymentIncome,
        dataCtx.payroll
      );
  const eiCalc = calculateEI(employmentIncome, dataCtx.payroll);
  const cpp = cppCalc.cpp;
  const ei = eiCalc.ei;
  const cppCreditable = cppCalc.cppBaseCreditable;
  const cppDeductible = cppCalc.cppDeductible;

  const grossIncomeForTax = employmentIncome + selfEmploymentIncome + otherIncome +
    grossedUpEligible + grossedUpNonEligible + taxableCapitalGains;
  const line23400 = Math.max(0,
    grossIncomeForTax - rrspDeduction - fhsaDeduction - estimatedDeductions - cppDeductible
  );
  // OAS repayment is computed from line 23400, deducted to reach line 23600, and
  // added to tax payable (line 42200). See tax.credits.js.
  const oasRecoveryTax = computeOasRecovery(line23400, oasBenefits, dataCtx.federal?.oasRecovery);
  const netIncome = Math.max(0, line23400 - oasRecoveryTax);
  const taxableIncome = netIncome;

  const calcOpts = {
    ...(runOpts.roundToDollar === false ? { roundToDollar: false } : {}),
    netIncome,
    age,
    eligiblePensionIncome
  };
  const federal = calculateFederalTax(
    taxableIncome, cppCreditable, ei, employmentIncome, dividends, dataCtx.federal, calcOpts
  );
  const provincial = (provinceCode === 'ON'
    ? calculateOntarioTax(taxableIncome, prov, dividends, cppCreditable, ei, calcOpts, taxYear)
    : calculateProvincialTaxGeneric(taxableIncome, prov, dividends, cppCreditable, ei, calcOpts));
  const totalIncomeTax = federal.netTax + provincial.netTax + oasRecoveryTax;
  return {
    totalIncomeTax,
    totalIncome: employmentIncome + selfEmploymentIncome + otherIncome + eligibleDividends + nonEligibleDividends + capitalGains,
    grossIncomeForTax,
    netIncome,
    taxableIncome,
    federal,
    provincial,
    cpp,
    ei,
    cppCreditable,
    cppDeductible,
    cppCalc,
    eiCalc,
    dividends,
    dividendGrossUp: dividends.eligibleGrossUp + dividends.nonEligibleGrossUp,
    grossedUpEligible,
    grossedUpNonEligible,
    capitalGainsInclusionRate,
    taxableCapitalGains,
    oasRecoveryTax,
    line23400,
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
 *   - taxPaid: federal + provincial/territorial income tax already paid for the year (from slips or instalments). Do not include CPP or EI; those count only in total tax burden.
 *   - age: optional. If >= 65, the age amount credit is applied when present in tax data.
 *   - eligiblePensionIncome: optional. Qualifying pension/RRIF income for the pension income amount.
 *   - oasBenefits: optional. OAS included in income; used only to compute OAS recovery tax.
 * @param {Object} [opts]
 * @param {Object} [opts.taxData] - Preferred explicit immutable tax-data bundle
 * @param {Object} [opts.dataOverride] - Compatibility alias for opts.taxData
 * @param {boolean} [opts.skipMarginalRateCalculation] - Internal probe optimization; preserves result shape with null marginal rates
 * @returns {Object} Complete tax calculation result
 */
export function computePersonalTax(input, opts = {}) {
  // Normalize so form strings like "160000" become numbers; ensures correct arithmetic and marginal choice.
  const normalizedInput = cloneInput(input);
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
  } = normalizedInput;

  const dataCtx = buildDataContext(opts, year);
  // Allow unrounded net tax for threshold / next-dollar marginal analysis.
  // Display paths leave roundToDollar unset (default: round federal and provincial net tax to dollars).
  const result = runFullCalculation(
    normalizedInput,
    dataCtx,
    opts.roundToDollar === false ? { roundToDollar: false } : {}
  );
  const {
    totalIncome,
    grossIncomeForTax,
    netIncome,
    taxableIncome,
    federal,
    provincial,
    cpp,
    ei,
    cppCreditable,
    cppDeductible,
    cppCalc,
    eiCalc,
    dividends,
    dividendGrossUp,
    capitalGainsInclusionRate,
    taxableCapitalGains,
    oasRecoveryTax = 0,
    line23400,
  } = result;

  const federalTax = federal.netTax;
  const provTax = provincial.netTax;
  const totalIncomeTax = federalTax + provTax + oasRecoveryTax;
  const totalBurden = totalIncomeTax + cpp + ei;
  const afterTaxIncome = totalIncome - totalIncomeTax;
  const takeHomeAfterPayroll = totalIncome - totalBurden;
  const avgRate = totalIncome > 0 ? totalIncomeTax / totalIncome : 0;

  const marginalRates = opts.skipMarginalRateCalculation
    ? {
        employment: null,
        eligibleDividends: null,
        nonEligibleDividends: null,
        otherIncome: null,
        capitalGains: null,
        combined: null
      }
    : computeMarginalRatesByType(normalizedInput, dataCtx);
  const marginalRate = marginalRates.combined;

  // Income tax balance only (excludes CPP/EI). See totalBurden for full statutory cash cost.
  const refundOrOwing = taxPaid - totalIncomeTax;

  if (opts?.validationMode) {
    const CRA_TRACE_TOL = 2;
    const assertCraTrace = (actual, expected, label) => {
      console.assert(
        Math.abs(actual - expected) <= CRA_TRACE_TOL,
        `${label}: expected ${expected} (CRA form trace), got ${actual}`
      );
    };
    const noOtherIncome =
      selfEmploymentIncome === 0 && otherIncome === 0 &&
      eligibleDividends === 0 && nonEligibleDividends === 0 && capitalGains === 0 &&
      rrspDeduction === 0 && fhsaDeduction === 0 && estimatedDeductions === 0 && taxPaid === 0;
    const noEmployment =
      employmentIncome === 0 && selfEmploymentIncome === 0 &&
      rrspDeduction === 0 && fhsaDeduction === 0 && estimatedDeductions === 0 && taxPaid === 0;

    // docs/form-traces/ON-employment-160000-2025-vs-2026.md (Schedule 1 + ON428)
    if (year === 2025 && province === 'ON' && employmentIncome === 160000 && noOtherIncome) {
      assertCraTrace(taxableIncome, 158926, 'taxableIncome');
      assertCraTrace(federalTax, 28262, 'federalTax');
      assertCraTrace(provTax, 16732, 'provTax');
      assertCraTrace(totalIncomeTax, 44994, 'totalIncomeTax');
    }

    // docs/form-traces/ON-eligible-dividends-160000-2025.md (Schedule 1 + ON428)
    if (year === 2025 && province === 'ON' && eligibleDividends === 160000 && noEmployment && otherIncome === 0 &&
        nonEligibleDividends === 0 && capitalGains === 0) {
      assertCraTrace(taxableIncome, 220800, 'taxableIncome');
      assertCraTrace(federalTax, 13494, 'federalTax');
      assertCraTrace(provTax, 6902, 'provTax');
      assertCraTrace(totalIncomeTax, 20396, 'totalIncomeTax');
    }
  }

  const auditBreakdown = opts?.debug || opts?.validationMode ? {
    grossIncomeForTax,
    netIncome,
    taxableIncome,
    cppSplit: {
      total: cpp,
      creditableBase: cppCreditable,
      deductibleEnhanced: cppDeductible,
      selfEmploymentBaseDeductible: cppCalc.selfEmploymentBaseDeductible || 0,
      firstAdditional: cppCalc.cppFirstAdditionalDeductible,
      cpp2: cppCalc.cpp2Deductible,
    },
    ei,
    federal: {
      baseTax: federal.baseTax,
      creditBases: federal.creditBases,
      credits: federal.credits,
      netTax: federal.netTax,
    },
    provincial: {
      baseTax: provincial.baseTax,
      creditBases: provincial.creditBases,
      credits: provincial.credits,
      netTax: provincial.netTax,
    },
  } : undefined;

  return {
    totals: {
      totalIncome,
      grossIncomeForTax,
      netIncome,
      taxableIncome,
      federalTax,
      provTax,
      cpp,
      ei,
      cppCreditable,
      cppDeductible,
      totalIncomeTax,
      totalBurden,
      afterTaxIncome,
      takeHomeAfterPayroll,
      avgRate,
      marginalRate,
      refundOrOwing,
      oasRecoveryTax,
      line23400,
    },
    breakdown: {
      federal: { ...federal, dtcApplied: federal.federalDividendCredits || 0 },
      provincial: { ...provincial, dtcApplied: provincial.provincialDividendCredits || 0 },
      dividends: { ...dividends, totalGrossUp: dividendGrossUp },
      capitalGains: { inclusionRate: capitalGainsInclusionRate, taxableCapitalGains },
      payroll: { cpp: cppCalc, ei: eiCalc },
      oasRecovery: { amount: oasRecoveryTax },
      marginalRates,
    },
    auditBreakdown,
  };
}
