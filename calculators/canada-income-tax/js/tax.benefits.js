/**
 * Federal income-tested benefits / refundable credits layer.
 * Pure functions — no DOM. Does not alter income-tax payable.
 *
 * Programs (when data marks them available):
 * - Canada Groceries and Essentials Benefit (formerly GST/HST credit)
 * - Canada workers benefit (basic amount only; QC/AB/NU excluded)
 * - Canada child benefit (no child disability benefit; no shared-custody split)
 */

import { normalizeProvince } from './tax.data.js';

export const BENEFIT_PROGRAM_KEYS = [
  'gstHstCredit',
  'canadaWorkersBenefit',
  'canadaChildBenefit',
];

export const CURRENT_RULES_PROJECTION_METHOD =
  'current published rules applied to future income';

export const FUTURE_BENEFIT_PROJECTION_DISCLOSURE =
  'Future benefit estimate: Current CCB, CGEB and CWB rules and parameters are applied where future program parameters have not yet been published. Actual future benefits may differ.';

function money(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function clampNonNeg(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return x;
}

function childCountKey(n) {
  const c = Math.max(0, Math.floor(Number(n) || 0));
  if (c <= 0) return null;
  if (c >= 4) return '4';
  return String(c);
}

/**
 * Normalize household inputs used by benefit programs.
 * @param {object} household
 */
export function normalizeHousehold(household = {}) {
  const maritalStatusRaw = String(household.maritalStatus || 'single').toLowerCase();
  const married =
    maritalStatusRaw === 'married' ||
    maritalStatusRaw === 'common-law' ||
    maritalStatusRaw === 'common_law' ||
    maritalStatusRaw === 'couple';
  const maritalStatus = married ? 'married_or_common_law' : 'single';

  const childrenInput = Array.isArray(household.children) ? household.children : [];
  const children = childrenInput
    .map((c) => {
      if (c == null) return null;
      if (typeof c === 'number') return { age: clampNonNeg(c) };
      const age = clampNonNeg(c.age);
      return { age };
    })
    .filter(Boolean);

  // Convenience: numberOfChildren + optional ages array
  const numberOfChildren = household.numberOfChildren != null
    ? Math.max(0, Math.floor(Number(household.numberOfChildren) || 0))
    : children.length;

  let resolvedChildren = children.slice(0, numberOfChildren);
  if (resolvedChildren.length < numberOfChildren) {
    const ages = Array.isArray(household.childAges) ? household.childAges : [];
    for (let i = resolvedChildren.length; i < numberOfChildren; i++) {
      const age = ages[i] != null ? clampNonNeg(ages[i]) : 0;
      resolvedChildren.push({ age });
    }
  }

  return {
    maritalStatus,
    isCouple: maritalStatus === 'married_or_common_law',
    spouseNetIncome: clampNonNeg(household.spouseNetIncome),
    children: resolvedChildren,
    numberOfChildren: resolvedChildren.length,
    // Optional UCCB/RDSP adjustments (default 0 — AFNI ≈ family net income)
    uccbRdspIncome: clampNonNeg(household.uccbRdspIncome),
    uccbRdspRepayment: clampNonNeg(household.uccbRdspRepayment),
  };
}

/**
 * Working income for CWB Schedule 6 Part A (simplified to calculator income types).
 * Employment + self-employment profits (losses treated as 0) + other employment-like fields not modeled.
 */
export function computeWorkingIncome(incomeComponents = {}) {
  const employment = clampNonNeg(incomeComponents.employmentIncome);
  const selfEmployment = Math.max(0, Number(incomeComponents.selfEmploymentIncome) || 0);
  const spouseEmployment = clampNonNeg(incomeComponents.spouseEmploymentIncome);
  const spouseSelfEmployment = Math.max(0, Number(incomeComponents.spouseSelfEmploymentIncome) || 0);
  return {
    individualWorkingIncome: money(employment + selfEmployment),
    spouseWorkingIncome: money(spouseEmployment + spouseSelfEmployment),
    familyWorkingIncome: money(employment + selfEmployment + spouseEmployment + spouseSelfEmployment),
  };
}

/**
 * Explicit income measures used by benefit formulas.
 */
export function computeIncomeMeasures({
  individualNetIncome = 0,
  household,
  incomeComponents = {},
  cwbParams = null,
} = {}) {
  const hh = normalizeHousehold(household);
  const individualNI = clampNonNeg(individualNetIncome);
  const spouseNI = hh.isCouple ? hh.spouseNetIncome : 0;
  const familyNetIncome = money(individualNI + spouseNI);

  // CCB / CGEB adjusted family net income ≈ FNI − UCCB/RDSP income + repayments
  const adjustedFamilyNetIncome = money(
    Math.max(0, familyNetIncome - hh.uccbRdspIncome + hh.uccbRdspRepayment)
  );

  const working = computeWorkingIncome(incomeComponents);

  let cwbAdjustedFamilyNetIncome = adjustedFamilyNetIncome;
  let secondaryEarnerExemption = 0;
  if (hh.isCouple && cwbParams) {
    const maxExempt = clampNonNeg(cwbParams.secondaryEarnerExemptionMax);
    const youWI = working.individualWorkingIncome;
    const spouseWI = working.spouseWorkingIncome;
    // Schedule 6 line 14: exemption for the secondary earner
    if (youWI < spouseWI) {
      secondaryEarnerExemption = Math.min(youWI, individualNI, maxExempt);
    } else {
      secondaryEarnerExemption = Math.min(spouseWI, spouseNI, maxExempt);
    }
    secondaryEarnerExemption = money(secondaryEarnerExemption);
    cwbAdjustedFamilyNetIncome = money(Math.max(0, adjustedFamilyNetIncome - secondaryEarnerExemption));
  }

  return {
    individualNetIncome: money(individualNI),
    spouseNetIncome: money(spouseNI),
    familyNetIncome,
    adjustedFamilyNetIncome,
    cwbAdjustedFamilyNetIncome,
    secondaryEarnerExemption,
    ...working,
  };
}

function emptyProgramResult(id, extras = {}) {
  return {
    programId: id,
    eligible: false,
    available: extras.available !== false,
    annualAmount: 0,
    estimatedBenefitEntitlement: 0,
    baseAmount: 0,
    reduction: 0,
    incomeMeasureUsed: null,
    threshold: null,
    calculationSteps: [],
    projected: extras.projected === true,
    ...extras,
  };
}

/**
 * Resolve per-program parameters for a target tax year.
 *
 * PUBLISHED MODE: use the target year's officially published params when available.
 * PROJECTED CURRENT-RULES MODE: when the target year has no published params for a
 * program, reuse the latest earlier published params unchanged (no indexation).
 *
 * @returns {{
 *   resolvedBenefits: object,
 *   programResolution: Record<string, object>,
 *   anyProjected: boolean
 * }}
 */
export function resolveBenefitsDataForCalculation({
  targetTaxYear,
  benefitsData,
  benefitsByYear = null,
} = {}) {
  const year = Number(targetTaxYear);
  if (!Number.isFinite(year)) {
    throw new Error('resolveBenefitsDataForCalculation requires a numeric targetTaxYear.');
  }
  if (!benefitsData) {
    throw new Error('resolveBenefitsDataForCalculation requires benefitsData.');
  }

  const catalog = {};
  if (benefitsByYear && typeof benefitsByYear === 'object') {
    for (const [key, value] of Object.entries(benefitsByYear)) {
      const y = Number(key);
      if (Number.isFinite(y) && value) catalog[y] = value;
    }
  }
  catalog[year] = benefitsData;
  if (benefitsData.year != null) {
    const dataYear = Number(benefitsData.year);
    if (Number.isFinite(dataYear)) catalog[dataYear] = benefitsData;
  }

  const yearsDesc = Object.keys(catalog)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => b - a);

  const programResolution = {};
  const resolvedPrograms = {};

  for (const key of BENEFIT_PROGRAM_KEYS) {
    const targetProg = benefitsData[key];
    if (targetProg && targetProg.available !== false) {
      const resolution = {
        projected: false,
        targetTaxYear: year,
        basisTaxYear: year,
        basisBenefitYear: targetProg.baseYear != null ? Number(targetProg.baseYear) : year,
        projectionMethod: null,
      };
      programResolution[key] = resolution;
      resolvedPrograms[key] = {
        ...targetProg,
        available: true,
        projected: false,
        targetTaxYear: year,
        basisTaxYear: year,
        basisBenefitYear: resolution.basisBenefitYear,
        projectionMethod: null,
      };
      continue;
    }

    const allowProjection =
      targetProg?.allowsCurrentRulesProjection !== false &&
      targetProg?.available === false;

    let fallback = null;
    let basisTaxYear = null;
    if (allowProjection) {
      for (const y of yearsDesc) {
        if (y >= year) continue;
        const cand = catalog[y]?.[key];
        if (cand && cand.available !== false) {
          fallback = cand;
          basisTaxYear = y;
          break;
        }
      }
    }

    if (!fallback) {
      programResolution[key] = {
        projected: false,
        targetTaxYear: year,
        available: false,
        unavailableReason:
          targetProg?.unavailableReason ||
          'Parameters not available for this tax year.',
      };
      resolvedPrograms[key] = {
        ...(targetProg || {}),
        available: false,
        projected: false,
        targetTaxYear: year,
      };
      continue;
    }

    const basisBenefitYear =
      fallback.baseYear != null ? Number(fallback.baseYear) : basisTaxYear;
    const resolution = {
      projected: true,
      targetTaxYear: year,
      basisTaxYear,
      basisBenefitYear,
      projectionMethod: CURRENT_RULES_PROJECTION_METHOD,
    };
    programResolution[key] = resolution;

    const publishedPeriod = fallback.paymentPeriodLabel;
    resolvedPrograms[key] = {
      ...fallback,
      available: true,
      projected: true,
      targetTaxYear: year,
      basisTaxYear,
      basisBenefitYear,
      projectionMethod: CURRENT_RULES_PROJECTION_METHOD,
      officialUnavailableReason: targetProg?.unavailableReason || null,
      paymentPeriodLabel: publishedPeriod
        ? `Projected estimate using latest published parameters (${publishedPeriod})`
        : 'Projected estimate using latest published parameters',
      timingNote:
        `${FUTURE_BENEFIT_PROJECTION_DISCLOSURE} ` +
        (fallback.timingNote || ''),
      sources: fallback.sources,
    };
  }

  const anyProjected = BENEFIT_PROGRAM_KEYS.some(
    (key) => programResolution[key]?.projected === true
  );

  return {
    resolvedBenefits: {
      ...benefitsData,
      year,
      gstHstCredit: resolvedPrograms.gstHstCredit,
      canadaWorkersBenefit: resolvedPrograms.canadaWorkersBenefit,
      canadaChildBenefit: resolvedPrograms.canadaChildBenefit,
    },
    programResolution,
    anyProjected,
  };
}

function attachProjectionMeta(result, resolution) {
  if (!resolution) return result;
  return {
    ...result,
    projected: resolution.projected === true,
    targetTaxYear: resolution.targetTaxYear,
    basisTaxYear: resolution.basisTaxYear ?? null,
    basisBenefitYear: resolution.basisBenefitYear ?? null,
    projectionMethod: resolution.projectionMethod ?? null,
  };
}

/**
 * GST/HST credit / Canada Groceries and Essentials Benefit.
 * Formula from CRA payment-amounts table + RC4210 structure.
 */
export function calculateGstHstCredit({ params, household, incomeMeasures }) {
  if (!params || params.available === false) {
    return emptyProgramResult('gstHstCredit', {
      available: false,
      statutoryName: params?.statutoryName || 'Canada Groceries and Essentials Benefit',
      unavailableReason: params?.unavailableReason || 'Parameters not available for this tax year.',
      calculationSteps: [
        { label: 'Status', detail: params?.unavailableReason || 'Not available for this tax year.' },
      ],
    });
  }

  const hh = normalizeHousehold(household);
  const afni = incomeMeasures.adjustedFamilyNetIncome;
  const individualANI = incomeMeasures.individualNetIncome; // no UCCB split modeled for single supplement phase-in
  const childrenUnder19 = hh.children.filter((c) => c.age < 19);
  const nChildren = childrenUnder19.length;

  const steps = [];
  let base = params.adultAmount;
  steps.push({
    label: 'Eligible individual amount',
    amount: params.adultAmount,
    detail: `Adult maximum $${params.adultAmount}`,
  });

  if (hh.isCouple) {
    base += params.spouseAmount;
    steps.push({
      label: 'Spouse or common-law partner amount',
      amount: params.spouseAmount,
      detail: `+ $${params.spouseAmount}`,
    });
    for (let i = 0; i < nChildren; i++) {
      base += params.childAmount;
      steps.push({
        label: `Child ${i + 1} under 19`,
        amount: params.childAmount,
        detail: `+ $${params.childAmount}`,
      });
    }
  } else if (nChildren > 0) {
    // Single parent: first child at adult rate, remaining at child rate
    base += params.singleParentFirstChildAmount;
    steps.push({
      label: 'First child of single parent (adult amount)',
      amount: params.singleParentFirstChildAmount,
      detail: `+ $${params.singleParentFirstChildAmount}`,
    });
    for (let i = 1; i < nChildren; i++) {
      base += params.childAmount;
      steps.push({
        label: `Child ${i + 1} under 19`,
        amount: params.childAmount,
        detail: `+ $${params.childAmount}`,
      });
    }
  }

  let singleSupplement = 0;
  if (!hh.isCouple) {
    if (nChildren > 0) {
      singleSupplement = params.singleSupplementMax;
      steps.push({
        label: 'Single supplement (single parent)',
        amount: singleSupplement,
        detail: `Full single supplement $${params.singleSupplementMax}`,
      });
    } else {
      const excess = Math.max(0, individualANI - params.singleSupplementPhaseInThreshold);
      singleSupplement = Math.min(
        params.singleSupplementMax,
        money(params.singleSupplementPhaseInRate * excess)
      );
      steps.push({
        label: 'Single supplement phase-in',
        amount: singleSupplement,
        detail:
          `${(params.singleSupplementPhaseInRate * 100).toFixed(0)}% × max(0, $${individualANI} − $${params.singleSupplementPhaseInThreshold})` +
          ` = $${money(params.singleSupplementPhaseInRate * excess)}, capped at $${params.singleSupplementMax}`,
      });
    }
  }

  const preliminary = money(base + singleSupplement);
  steps.push({ label: 'Preliminary entitlement', amount: preliminary });

  const phaseExcess = Math.max(0, afni - params.phaseOutThreshold);
  const reduction = money(params.phaseOutRate * phaseExcess);
  const annual = money(Math.max(0, preliminary - reduction));
  steps.push({
    label: 'Adjusted family net income',
    amount: afni,
  });
  steps.push({
    label: 'Phase-out threshold',
    amount: params.phaseOutThreshold,
  });
  steps.push({
    label: 'Reduction',
    amount: reduction,
    detail: `${(params.phaseOutRate * 100).toFixed(0)}% × $${money(phaseExcess)} = $${reduction}`,
  });
  steps.push({
    label: 'Estimated annual entitlement',
    amount: annual,
    detail: params.timingNote,
  });

  return {
    programId: 'gstHstCredit',
    statutoryName: params.statutoryName,
    formerName: params.formerName,
    classification: params.classification,
    available: true,
    eligible: annual > 0 || preliminary > 0,
    annualAmount: annual,
    estimatedBenefitEntitlement: annual,
    baseAmount: preliminary,
    reduction,
    incomeMeasureUsed: 'adjustedFamilyNetIncome',
    incomeMeasureValue: afni,
    threshold: params.phaseOutThreshold,
    paymentPeriodLabel: params.paymentPeriodLabel,
    timingNote: params.timingNote,
    calculationSteps: steps,
  };
}

/**
 * Canada workers benefit — basic amount only (Schedule 6 Step 2).
 */
export function calculateCanadaWorkersBenefit({
  params,
  province,
  household,
  incomeMeasures,
}) {
  if (!params || params.available === false) {
    return emptyProgramResult('canadaWorkersBenefit', {
      available: false,
      statutoryName: params?.statutoryName || 'Canada workers benefit',
      unavailableReason: params?.unavailableReason || 'Parameters not available for this tax year.',
      calculationSteps: [
        { label: 'Status', detail: params?.unavailableReason || 'Not available for this tax year.' },
      ],
    });
  }

  const code = normalizeProvince(province);
  const excluded = (params.excludedProvinces || []).includes(code);
  if (excluded) {
    return emptyProgramResult('canadaWorkersBenefit', {
      available: false,
      statutoryName: params.statutoryName,
      classification: params.classification,
      unavailableReason: params.excludedProvincesNote,
      province: code,
      calculationSteps: [
        {
          label: 'Jurisdiction',
          detail: `${code} uses province/territory-specific CWB parameters and is not modeled.`,
        },
      ],
    });
  }

  const hh = normalizeHousehold(household);
  const isFamily = hh.isCouple || hh.numberOfChildren > 0;
  const familyWI = incomeMeasures.familyWorkingIncome;
  const cwbAfni = incomeMeasures.cwbAdjustedFamilyNetIncome;
  const steps = [];

  steps.push({
    label: 'Family working income',
    amount: familyWI,
    detail: 'Employment + self-employment (profits only) for the household as modeled',
  });

  if (familyWI <= params.workingIncomeMinimumBasic) {
    steps.push({
      label: 'Eligibility',
      detail: `Family working income must exceed $${params.workingIncomeMinimumBasic} for the basic CWB.`,
    });
    return {
      programId: 'canadaWorkersBenefit',
      statutoryName: params.statutoryName,
      classification: params.classification,
      available: true,
      eligible: false,
      annualAmount: 0,
      estimatedBenefitEntitlement: 0,
      baseAmount: 0,
      reduction: 0,
      incomeMeasureUsed: 'cwbAdjustedFamilyNetIncome',
      incomeMeasureValue: cwbAfni,
      threshold: isFamily ? params.phaseOutStartFamily : params.phaseOutStartSingle,
      isFamily,
      timingNote: params.timingNote,
      disabilitySupplementExcluded: true,
      calculationSteps: steps,
    };
  }

  const phaseInBase = params.phaseInBase;
  const phaseInIncome = Math.max(0, familyWI - phaseInBase);
  const phasedIn = money(params.phaseInRate * phaseInIncome);
  const maxBasic = isFamily ? params.maxBasicFamily : params.maxBasicSingle;
  const beforeReduction = money(Math.min(phasedIn, maxBasic));

  steps.push({
    label: 'Phase-in',
    amount: phasedIn,
    detail: `${(params.phaseInRate * 100).toFixed(0)}% × max(0, $${familyWI} − $${phaseInBase}) = $${phasedIn}`,
  });
  steps.push({
    label: 'Maximum basic benefit',
    amount: maxBasic,
    detail: isFamily ? 'Family maximum (spouse/common-law or eligible dependant)' : 'Single individual maximum',
  });
  steps.push({
    label: 'Benefit before phase-out',
    amount: beforeReduction,
    detail: `min(phased-in, maximum) = $${beforeReduction}`,
  });

  if (incomeMeasures.secondaryEarnerExemption > 0) {
    steps.push({
      label: 'Secondary earner exemption',
      amount: incomeMeasures.secondaryEarnerExemption,
      detail: `Subtracted when computing CWB adjusted family net income (max $${params.secondaryEarnerExemptionMax})`,
    });
  }

  const phaseOutStart = isFamily ? params.phaseOutStartFamily : params.phaseOutStartSingle;
  const phaseExcess = Math.max(0, cwbAfni - phaseOutStart);
  const reduction = money(params.phaseOutRate * phaseExcess);
  const annual = money(Math.max(0, beforeReduction - reduction));

  steps.push({
    label: 'CWB adjusted family net income',
    amount: cwbAfni,
  });
  steps.push({
    label: 'Phase-out threshold',
    amount: phaseOutStart,
  });
  steps.push({
    label: 'Reduction',
    amount: reduction,
    detail: `${(params.phaseOutRate * 100).toFixed(0)}% × $${money(phaseExcess)} = $${reduction}`,
  });
  steps.push({
    label: 'Basic CWB (line 45300 entitlement before disability supplement)',
    amount: annual,
    detail: params.timingNote,
  });
  steps.push({
    label: 'Disability supplement',
    detail: params.disabilitySupplementNote || 'Not modeled.',
    amount: 0,
  });

  return {
    programId: 'canadaWorkersBenefit',
    statutoryName: params.statutoryName,
    classification: params.classification,
    available: true,
    eligible: annual > 0,
    annualAmount: annual,
    estimatedBenefitEntitlement: annual,
    baseAmount: beforeReduction,
    reduction,
    incomeMeasureUsed: 'cwbAdjustedFamilyNetIncome',
    incomeMeasureValue: cwbAfni,
    threshold: phaseOutStart,
    isFamily,
    claimLine: params.claimLine,
    timingNote: params.timingNote,
    disabilitySupplementExcluded: true,
    calculationSteps: steps,
  };
}

/**
 * Canada child benefit (annual entitlement for the benefit year tied to this tax year).
 */
export function calculateCanadaChildBenefit({ params, household, incomeMeasures }) {
  if (!params || params.available === false) {
    return emptyProgramResult('canadaChildBenefit', {
      available: false,
      statutoryName: params?.statutoryName || 'Canada child benefit',
      unavailableReason: params?.unavailableReason || 'Parameters not available for this tax year.',
      calculationSteps: [
        { label: 'Status', detail: params?.unavailableReason || 'Not available for this tax year.' },
      ],
    });
  }

  const hh = normalizeHousehold(household);
  // CCB: children under 18
  const eligibleChildren = hh.children.filter((c) => c.age < 18);
  const n = eligibleChildren.length;
  const steps = [];

  if (n === 0) {
    steps.push({ label: 'Eligible children under 18', amount: 0, detail: 'No CCB without eligible children.' });
    return {
      programId: 'canadaChildBenefit',
      statutoryName: params.statutoryName,
      classification: params.classification,
      available: true,
      eligible: false,
      annualAmount: 0,
      estimatedBenefitEntitlement: 0,
      baseAmount: 0,
      reduction: 0,
      incomeMeasureUsed: 'adjustedFamilyNetIncome',
      incomeMeasureValue: incomeMeasures.adjustedFamilyNetIncome,
      threshold: params.phaseOutStart,
      paymentPeriodLabel: params.paymentPeriodLabel,
      timingNote: params.timingNote,
      calculationSteps: steps,
    };
  }

  let maxBenefit = 0;
  let under6 = 0;
  let age6to17 = 0;
  for (const child of eligibleChildren) {
    if (child.age < 6) {
      under6 += 1;
      maxBenefit += params.maxUnder6;
    } else {
      age6to17 += 1;
      maxBenefit += params.maxAge6to17;
    }
  }
  maxBenefit = money(maxBenefit);

  steps.push({
    label: 'Eligible children',
    detail: `${under6} under age 6 × $${params.maxUnder6}; ${age6to17} aged 6–17 × $${params.maxAge6to17}`,
  });
  steps.push({ label: 'Maximum annual benefit', amount: maxBenefit });

  const key = childCountKey(n);
  const afni = incomeMeasures.adjustedFamilyNetIncome;
  const t1 = params.phaseOutStart;
  const t2 = params.phaseOutSecondThreshold;
  const r1 = params.phase1RatesByChildren[key];
  const r2 = params.phase2RatesByChildren[key];
  const base2 = params.phase2BaseReductionByChildren[key];

  let reduction = 0;
  if (afni <= t1) {
    reduction = 0;
    steps.push({
      label: 'Income test',
      detail: `AFNI $${afni} ≤ $${t1} — no reduction`,
    });
  } else if (afni <= t2) {
    const excess = afni - t1;
    reduction = money(r1 * excess);
    steps.push({
      label: 'Tier 1 reduction',
      amount: reduction,
      detail: `${(r1 * 100).toFixed(r1 * 100 % 1 ? 1 : 0)}% × ($${afni} − $${t1}) = $${reduction}`,
    });
  } else {
    const excess2 = afni - t2;
    reduction = money(base2 + r2 * excess2);
    steps.push({
      label: 'Tier 2 reduction',
      amount: reduction,
      detail: `$${base2} + ${(r2 * 100).toFixed(r2 * 100 % 1 ? 1 : 0)}% × ($${afni} − $${t2}) = $${reduction}`,
    });
  }

  const annual = money(Math.max(0, maxBenefit - reduction));
  steps.push({ label: 'Adjusted family net income', amount: afni });
  steps.push({
    label: 'Estimated annual entitlement',
    amount: annual,
    detail: params.timingNote,
  });
  if (params.childDisabilityBenefitNote) {
    steps.push({ label: 'Child disability benefit', detail: params.childDisabilityBenefitNote, amount: 0 });
  }

  return {
    programId: 'canadaChildBenefit',
    statutoryName: params.statutoryName,
    classification: params.classification,
    available: true,
    eligible: annual > 0 || maxBenefit > 0,
    annualAmount: annual,
    estimatedBenefitEntitlement: annual,
    baseAmount: maxBenefit,
    reduction,
    incomeMeasureUsed: 'adjustedFamilyNetIncome',
    incomeMeasureValue: afni,
    threshold: t1,
    paymentPeriodLabel: params.paymentPeriodLabel,
    timingNote: params.timingNote,
    childrenUnder6: under6,
    childrenAge6to17: age6to17,
    calculationSteps: steps,
  };
}

/**
 * Calculate all supported income-tested benefits for a household situation.
 *
 * @param {object} args
 * @param {object} [args.benefitsByYear] - map of taxYear → benefits.json for published-parameter fallback
 */
export function calculateIncomeTestedBenefits({
  taxYear,
  province,
  individualNetIncome,
  household = {},
  incomeComponents = {},
  benefitsData,
  benefitsByYear = null,
} = {}) {
  if (!benefitsData) {
    throw new Error('benefitsData is required for calculateIncomeTestedBenefits.');
  }

  const targetTaxYear = Number(taxYear) || Number(benefitsData.year);
  const { resolvedBenefits, programResolution, anyProjected } = resolveBenefitsDataForCalculation({
    targetTaxYear,
    benefitsData,
    benefitsByYear,
  });

  const hh = normalizeHousehold(household);
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome,
    household: hh,
    incomeComponents,
    cwbParams: resolvedBenefits.canadaWorkersBenefit,
  });

  let gstHstCredit = calculateGstHstCredit({
    params: resolvedBenefits.gstHstCredit,
    household: hh,
    incomeMeasures,
  });
  let canadaWorkersBenefit = calculateCanadaWorkersBenefit({
    params: resolvedBenefits.canadaWorkersBenefit,
    province,
    household: hh,
    incomeMeasures,
  });
  let canadaChildBenefit = calculateCanadaChildBenefit({
    params: resolvedBenefits.canadaChildBenefit,
    household: hh,
    incomeMeasures,
  });

  gstHstCredit = attachProjectionMeta(gstHstCredit, programResolution.gstHstCredit);
  canadaWorkersBenefit = attachProjectionMeta(
    canadaWorkersBenefit,
    programResolution.canadaWorkersBenefit
  );
  canadaChildBenefit = attachProjectionMeta(
    canadaChildBenefit,
    programResolution.canadaChildBenefit
  );

  const stampProjectionStep = (program, resolution) => {
    if (!resolution?.projected || !program?.calculationSteps) return program;
    return {
      ...program,
      calculationSteps: [
        {
          label: 'Parameter basis',
          detail:
            `Projected current-rules mode: applied tax-year ${resolution.basisTaxYear}` +
            (resolution.basisBenefitYear != null
              ? ` / benefit base year ${resolution.basisBenefitYear}`
              : '') +
            ` parameters to target tax year ${resolution.targetTaxYear} income. ` +
            `Not an official future entitlement. (${resolution.projectionMethod})`,
        },
        ...program.calculationSteps,
      ],
    };
  };

  gstHstCredit = stampProjectionStep(gstHstCredit, programResolution.gstHstCredit);
  canadaWorkersBenefit = stampProjectionStep(
    canadaWorkersBenefit,
    programResolution.canadaWorkersBenefit
  );
  canadaChildBenefit = stampProjectionStep(
    canadaChildBenefit,
    programResolution.canadaChildBenefit
  );

  const programs = { gstHstCredit, canadaWorkersBenefit, canadaChildBenefit };

  const refundableTaxCredits = money(
    (canadaWorkersBenefit.available ? canadaWorkersBenefit.annualAmount : 0)
  );
  const incomeTestedBenefits = money(
    (gstHstCredit.available ? gstHstCredit.annualAmount : 0) +
    (canadaChildBenefit.available ? canadaChildBenefit.annualAmount : 0)
  );
  const totalAnnualBenefits = money(refundableTaxCredits + incomeTestedBenefits);

  const programList = Object.values(programs);
  const included = programList.filter((p) => p.available).map((p) => p.programId);
  const excluded = [];
  if (!gstHstCredit.available) excluded.push({ id: 'gstHstCredit', reason: gstHstCredit.unavailableReason });
  if (!canadaWorkersBenefit.available) {
    excluded.push({ id: 'canadaWorkersBenefit', reason: canadaWorkersBenefit.unavailableReason });
  }
  if (!canadaChildBenefit.available) {
    excluded.push({ id: 'canadaChildBenefit', reason: canadaChildBenefit.unavailableReason });
  }
  excluded.push({
    id: 'cwbDisabilitySupplement',
    reason: resolvedBenefits.canadaWorkersBenefit?.disabilitySupplementNote ||
      benefitsData.canadaWorkersBenefit?.disabilitySupplementNote ||
      'Not modeled.',
  });
  excluded.push({
    id: 'childDisabilityBenefit',
    reason: resolvedBenefits.canadaChildBenefit?.childDisabilityBenefitNote ||
      benefitsData.canadaChildBenefit?.childDisabilityBenefitNote ||
      'Not modeled.',
  });
  if (benefitsData.provincialPrograms && !benefitsData.provincialPrograms.available) {
    excluded.push({ id: 'provincialPrograms', reason: benefitsData.provincialPrograms.note });
  }

  return {
    taxYear: targetTaxYear,
    province: normalizeProvince(province),
    household: hh,
    incomeMeasures,
    programs,
    resolvedBenefits,
    totals: {
      refundableTaxCredits,
      incomeTestedBenefits,
      totalAnnualBenefits,
      estimatedBenefitEntitlement: totalAnnualBenefits,
    },
    metadata: {
      includedPrograms: included,
      excludedPrograms: excluded,
      sources: benefitsData.meta?.sources || [],
      anyProjected,
      projectionDisclosure: anyProjected ? FUTURE_BENEFIT_PROJECTION_DISCLOSURE : null,
      programResolution,
    },
  };
}

/**
 * Finite-difference economic value of reducing relevant net income (e.g. RRSP/FHSA deduction).
 * Runs full tax + benefits at baseline and at baseline with an added deduction.
 *
 * @param {object} args
 * @param {object} args.baselineInput - computePersonalTax input
 * @param {number} args.deductionAmount - reduction in net income via additional deduction
 * @param {'rrspDeduction'|'fhsaDeduction'|'estimatedDeductions'} [args.deductionField]
 * @param {object} args.taxData - full tax data bundle including benefits
 * @param {function} args.computePersonalTax - injected to avoid circular imports at module load in tests
 */
export function compareIncomeReduction({
  baselineInput,
  deductionAmount,
  deductionField = 'rrspDeduction',
  taxData,
  computePersonalTax,
  household,
} = {}) {
  if (typeof computePersonalTax !== 'function') {
    throw new Error('compareIncomeReduction requires computePersonalTax.');
  }
  const delta = clampNonNeg(deductionAmount);
  const baseInput = {
    ...baselineInput,
    household: household || baselineInput.household || {},
  };
  const reducedInput = {
    ...baseInput,
    [deductionField]: clampNonNeg(baseInput[deductionField]) + delta,
  };

  const opts = { taxData, skipMarginalRateCalculation: true };
  const base = computePersonalTax(baseInput, opts);
  const reduced = computePersonalTax(reducedInput, opts);

  const taxSavings = money(base.totals.totalIncomeTax - reduced.totals.totalIncomeTax);
  const baseBenefits = base.totals.incomeTestedBenefitsTotal ?? base.benefits?.totals?.totalAnnualBenefits ?? 0;
  const reducedBenefits = reduced.totals.incomeTestedBenefitsTotal ?? reduced.benefits?.totals?.totalAnnualBenefits ?? 0;
  const additionalBenefits = money(reducedBenefits - baseBenefits);
  const totalEconomicValue = money(taxSavings + additionalBenefits);
  const effectiveValueRate = delta > 0 ? totalEconomicValue / delta : 0;

  const programDeltas = {};
  const basePrograms = base.benefits?.programs || {};
  const reducedPrograms = reduced.benefits?.programs || {};
  for (const id of new Set([...Object.keys(basePrograms), ...Object.keys(reducedPrograms)])) {
    const b = basePrograms[id]?.annualAmount || 0;
    const r = reducedPrograms[id]?.annualAmount || 0;
    programDeltas[id] = money(r - b);
  }

  return {
    deductionAmount: delta,
    deductionField,
    taxSavings,
    additionalBenefits,
    benefitIncrease: additionalBenefits,
    totalEconomicValue,
    combinedEconomicValue: totalEconomicValue,
    effectiveValueRate,
    programDeltas,
    baseline: {
      totalIncomeTax: base.totals.totalIncomeTax,
      netIncome: base.totals.netIncome,
      benefitsTotal: baseBenefits,
    },
    withDeduction: {
      totalIncomeTax: reduced.totals.totalIncomeTax,
      netIncome: reduced.totals.netIncome,
      benefitsTotal: reducedBenefits,
    },
  };
}

/** Alias matching the conceptual API name in the product brief. */
export function calculateMarginalIncomeReductionValue(args) {
  return compareIncomeReduction(args);
}
