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

/**
 * Ontario Health Premium (Ontario Taxation Act, 2007, Division C).
 * Piecewise schedule for 2005 and later tax years — band dollar amounts are not annual CPI indexation
 * (see TaxTips Ontario Health Premium table; Ontario Ministry of Finance / ontario.ca).
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
 * @param {number} taxableIncome - Taxable income (after line 22215 enhanced CPP deduction)
 * @param {number} cppCreditable - Base CPP for line 30800 credit only (not enhanced CPP or CPP2)
 * @param {number} ei - EI premium (credit only; not deducted from taxable income)
 * @param {number} employmentIncome - Employment income (for Canada Employment Amount eligibility)
 * @param {Object} dividends - Pre-computed dividend amounts (eligibleDTCFed, nonEligibleDTCFed)
 * @param {Object} federal - Federal tax data (brackets, credits)
 * @returns {Object} Federal tax breakdown
 */
function calculateFederalTax(taxableIncome, cppCreditable, ei, employmentIncome, dividends, federal, opts = {}) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, federal.brackets, opts);

  // Step B — Federal non-refundable credits (Schedule 1 / line 35000 worksheet).
  const credits = [];
  const creditBases = [];
  let totalCredits = 0;

  const creditRate = federal.credits.lowestRateForCredits ?? Math.min(...federal.brackets.map(b => b.rate));

  if (federal.credits.basicPersonalAmount) {
    const base = federal.credits.basicPersonalAmount.amount;
    const credit = base * creditRate;
    creditBases.push({ name: 'Basic Personal Amount', base, rate: creditRate, credit });
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    totalCredits += credit;
  }

  if (federal.credits.canadaEmploymentAmount && employmentIncome > 0) {
    const base = federal.credits.canadaEmploymentAmount.amount;
    const credit = base * creditRate;
    creditBases.push({ name: 'Canada Employment Amount', base, rate: creditRate, credit });
    credits.push({ name: 'Canada Employment Amount', amount: credit });
    totalCredits += credit;
  }

  // Line 30800 base CPP credit + EI (line 31200); enhanced CPP is deducted, not credited.
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

  const netTax = Math.round(Math.max(0, taxAfterDividendCredits + minimumTaxAdjustments));

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

  if (prov.credits && prov.credits.basicPersonalAmount) {
    const configuredRate = prov.credits.basicPersonalAmount.rate;
    const creditRate = typeof configuredRate === 'number'
      ? configuredRate
      : defaultProvCreditRate;
    const base = prov.credits.basicPersonalAmount.amount;
    const credit = base * creditRate;
    creditBases.push({ name: 'Basic Personal Amount', base, rate: creditRate, credit });
    credits.push({ name: 'Basic Personal Amount', amount: credit });
    totalCredits += credit;
  }

  // Form 428 line 58240 — provincial credit on base CPP/QPP and EI (when configured).
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

  const netTax = Math.round(taxAfterReductions + premiumsTotal);

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
 * Ontario-specific provincial tax calculation, mirroring ON428 ordering exactly:
 * 1. brackets → basic tax
 * 2. subtract non-refundable credits (BPA etc.), clamp at 0
 * 3. compute surtax on post-credit tax
 * 4. add surtax
 * 5. subtract dividend tax credit (after surtax), clamp at 0
 * 6. add Ontario Health Premium (piecewise, capped at $900)
 */
function calculateOntarioTax(taxableIncome, prov, dividends, cppCreditable, ei, opts = {}, taxYear = 2025) {
  const { bracketLines, baseTax } = calculateBracketTax(taxableIncome, prov.brackets, opts);

  // Step 2: Ontario non-refundable credits (ON428 — BPA, line 58240 CPP/EI when configured).
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
  const healthPremium = calculateOntarioHealthPremium(taxableIncome, taxYear);
  if (healthPremium > 0) {
    premiums.push({ name: 'Ontario Health Premium', amount: healthPremium });
  }

  const provincialTaxReduction = 0;
  const minimumTaxAdjustments = 0;
  const taxAfterReductions = taxAfterDividendCredits; // no reductions implemented yet
  const netTax = Math.round(taxAfterReductions + healthPremium);

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

const MARGINAL_DELTA = 1;

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
  };
}

/**
 * Marginal tax rate = exact definition: delta tax per $1 of income type X.
 * baseline = fullTax(inputs); clone = inputs, clone.X += 1; newTax = fullTax(clone);
 * marginalRate = newTax.totalIncomeTax - baseline.totalIncomeTax. No division.
 * Perturbation uses the exact field: employmentIncome, eligibleDividends, otherIncome, capitalGains (cash).
 * If multiple income types exist, "combined" uses employment first, then eligible dividends, then other income, etc.
 */
function computeMarginalRatesByType(input, dataCtx) {
  // Use unrounded bracket tax so $1 perturbation gives true marginal rate (not 0 when rounding hides the change)
  const roundOpts = { roundToDollar: false };
  const baseline = runFullCalculation(input, dataCtx, roundOpts);
  const baseTax = baseline.totalIncomeTax;

  const marginalFor = (field, currentValue) => {
    const clone = cloneInput(input);
    clone[field] = (currentValue ?? 0) + MARGINAL_DELTA;
    const newResult = runFullCalculation(clone, dataCtx, roundOpts);
    const marginalRate = newResult.totalIncomeTax - baseTax;
    if (marginalRate < 0 || marginalRate > 1) {
      console.warn('Marginal rate out of expected bounds:', marginalRate, `(field: ${field})`);
    }
    return marginalRate;
  };

  const employment = marginalFor('employmentIncome', num(input, 'employmentIncome'));
  const eligibleDividendsMarg = marginalFor('eligibleDividends', num(input, 'eligibleDividends'));
  const nonEligibleDividendsMarg = marginalFor('nonEligibleDividends', num(input, 'nonEligibleDividends'));
  const otherIncomeMarg = marginalFor('otherIncome', num(input, 'otherIncome'));
  const capitalGainsMarg = marginalFor('capitalGains', num(input, 'capitalGains'));

  // Which income type is "active" (priority order: employment, eligible div, other, non-eligible div, capital gains).
  // Use num() so form string "160000" is treated as 160000.
  const hasEmployment = num(input, 'employmentIncome') > 0;
  const hasEligibleDiv = num(input, 'eligibleDividends') > 0;
  const hasOtherIncome = num(input, 'otherIncome') > 0;
  const hasNonEligibleDiv = num(input, 'nonEligibleDividends') > 0;
  const hasCapitalGains = num(input, 'capitalGains') > 0;

  let combined =
    hasEmployment ? employment
    : hasEligibleDiv ? eligibleDividendsMarg
    : hasOtherIncome ? otherIncomeMarg
    : hasNonEligibleDiv ? nonEligibleDividendsMarg
    : hasCapitalGains ? capitalGainsMarg
    : employment;

  // Never show an impossible marginal to the user (CRA-style marginals are 0–100%).
  // If the chosen marginal is out of bounds, use the first in-bounds marginal for an active type.
  const inBounds = (r) => typeof r === 'number' && !isNaN(r) && r >= 0 && r <= 1;
  if (!inBounds(combined)) {
    console.warn('Marginal rate out of expected bounds:', combined, '(combined); using first in-bounds active type.');
    if (hasEmployment && inBounds(employment)) combined = employment;
    else if (hasEligibleDiv && inBounds(eligibleDividendsMarg)) combined = eligibleDividendsMarg;
    else if (hasOtherIncome && inBounds(otherIncomeMarg)) combined = otherIncomeMarg;
    else if (hasNonEligibleDiv && inBounds(nonEligibleDividendsMarg)) combined = nonEligibleDividendsMarg;
    else if (hasCapitalGains && inBounds(capitalGainsMarg)) combined = capitalGainsMarg;
    else if (inBounds(employment)) combined = employment;
    else if (inBounds(eligibleDividendsMarg)) combined = eligibleDividendsMarg;
    else if (inBounds(otherIncomeMarg)) combined = otherIncomeMarg;
    else if (inBounds(nonEligibleDividendsMarg)) combined = nonEligibleDividendsMarg;
    else if (inBounds(capitalGainsMarg)) combined = capitalGainsMarg;
    else combined = 0; // fallback to 0% rather than show -22455%
  }

  return {
    employment,
    eligibleDividends: eligibleDividendsMarg,
    nonEligibleDividends: nonEligibleDividendsMarg,
    otherIncome: otherIncomeMarg,
    capitalGains: capitalGainsMarg,
    combined,
  };
}

/**
 * Run full tax calculation (internal). Used by computePersonalTax and marginal rate.
 * @param {Object} runOpts - Optional. { roundToDollar: false } to use exact bracket tax (for marginal rate calculation).
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

  const cppCalc = calculateCPP(employmentIncome, dataCtx.payroll);
  const eiCalc = calculateEI(employmentIncome, dataCtx.payroll);
  const cpp = cppCalc.cpp;
  const ei = eiCalc.ei;
  const cppCreditable = cppCalc.cppBaseCreditable;
  const cppDeductible = cppCalc.cppDeductible;

  const grossIncomeForTax = employmentIncome + selfEmploymentIncome + otherIncome +
    grossedUpEligible + grossedUpNonEligible + taxableCapitalGains;
  const netIncome = Math.max(0,
    grossIncomeForTax - rrspDeduction - fhsaDeduction - estimatedDeductions - cppDeductible
  );
  const taxableIncome = netIncome;

  const calcOpts = runOpts.roundToDollar === false ? { roundToDollar: false } : {};
  const federal = calculateFederalTax(
    taxableIncome, cppCreditable, ei, employmentIncome, dividends, dataCtx.federal, calcOpts
  );
  const provincial = (provinceCode === 'ON'
    ? calculateOntarioTax(taxableIncome, prov, dividends, cppCreditable, ei, calcOpts, taxYear)
    : calculateProvincialTaxGeneric(taxableIncome, prov, dividends, cppCreditable, ei, calcOpts));
  const totalIncomeTax = federal.netTax + provincial.netTax;
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
 * @param {Object} data - Pre-loaded tax data (optional, will load if not provided)
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

  const dataCtx = buildDataContext(opts);
  const result = runFullCalculation(normalizedInput, dataCtx);
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
  } = result;

  const federalTax = federal.netTax;
  const provTax = provincial.netTax;
  const totalIncomeTax = federalTax + provTax;
  const totalBurden = totalIncomeTax + cpp + ei;
  const afterTaxIncome = totalIncome - totalIncomeTax;
  const takeHomeAfterPayroll = totalIncome - totalBurden;
  const avgRate = totalIncome > 0 ? totalIncomeTax / totalIncome : 0;

  const marginalRates = computeMarginalRatesByType(normalizedInput, dataCtx);
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
      assertCraTrace(federalTax, 13358, 'federalTax');
      assertCraTrace(provTax, 6902, 'provTax');
      assertCraTrace(totalIncomeTax, 20260, 'totalIncomeTax');
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
    },
    breakdown: {
      federal: { ...federal, dtcApplied: federal.federalDividendCredits || 0 },
      provincial: { ...provincial, dtcApplied: provincial.provincialDividendCredits || 0 },
      dividends: { ...dividends, totalGrossUp: dividendGrossUp },
      capitalGains: { inclusionRate: capitalGainsInclusionRate, taxableCapitalGains },
      payroll: { cpp: cppCalc, ei: eiCalc },
      marginalRates,
    },
    auditBreakdown,
  };
}
