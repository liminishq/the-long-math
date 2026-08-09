/**
 * Mechanical future tax-data projection.
 *
 * When an official tax-year folder exists, callers must use that folder instead.
 * This module only projects from a known official base year by:
 *   - compounding indexed dollar parameters by the supplied inflation factors;
 *   - leaving rates and non-indexed amounts unchanged;
 *   - recomputing contribution maxima from rates × indexed bases where needed.
 *
 * It does not invent future tax policy.
 */

import {
  DIVIDENDS_INDEXATION_RULES,
  FEDERAL_INDEXATION_RULES,
  OFFICIAL_TAX_YEARS,
  PAYROLL_INDEXATION_RULES,
  isOfficialTaxYear,
  latestOfficialTaxYear,
  provinceIndexationRules
} from "./tax.indexation.js";

function assertFinite(n, label) {
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number`);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function roundMoney(amount) {
  return Math.round(Number(amount));
}

function roundCents(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

function compoundFactor(annualRate, years) {
  assertFinite(annualRate, "annualRate");
  assertFinite(years, "years");
  if (years <= 0) return 1;
  return Math.pow(1 + annualRate, years);
}

function scaleIndexedNumber(value, factor) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  // CRA-style dollar rounding for thresholds and personal amounts.
  return roundMoney(value * factor);
}

/**
 * Apply path rules to a root object.
 * Supported path forms: "a.b", "arr[].field", nested combinations.
 */
function applyRules(root, rules, factor) {
  for (const rule of rules) {
    if (rule.recompute) continue;
    if (rule.indexed !== true) continue;
    applyPath(root, rule.path.split("."), factor);
  }
}

function applyPath(node, parts, factor) {
  if (node == null || parts.length === 0) return;
  const [head, ...rest] = parts;

  if (head.endsWith("[]")) {
    const key = head.slice(0, -2);
    const arr = node[key];
    if (!Array.isArray(arr)) return;
    for (const item of arr) applyPath(item, rest, factor);
    return;
  }

  if (rest.length === 0) {
    if (typeof node[head] === "number") {
      node[head] = scaleIndexedNumber(node[head], factor);
    }
    return;
  }

  applyPath(node[head], rest, factor);
}

function recomputePayrollMaxima(payroll) {
  const cpp = payroll.cpp;
  if (cpp && Number.isFinite(cpp.baseRate) && Number.isFinite(cpp.firstAdditionalRate)) {
    const pensionable = Math.max(0, (cpp.maxPensionableEarnings || 0) - (cpp.basicExemption || 0));
    cpp.maxBaseContribution = roundCents(cpp.baseRate * pensionable);
    cpp.maxFirstAdditionalContribution = roundCents(cpp.firstAdditionalRate * pensionable);
    cpp.maxContribution = roundCents(cpp.maxBaseContribution + cpp.maxFirstAdditionalContribution);
  } else if (cpp && Number.isFinite(cpp.rate)) {
    const pensionable = Math.max(0, (cpp.maxPensionableEarnings || 0) - (cpp.basicExemption || 0));
    cpp.maxContribution = roundCents(cpp.rate * pensionable);
  }

  if (payroll.cpp2 && Number.isFinite(payroll.cpp2.rate)) {
    payroll.cpp2.maxAdditionalContribution = roundCents(
      payroll.cpp2.rate * (payroll.cpp2.maxAdditionalEarnings || 0)
    );
  }

  if (payroll.ei && Number.isFinite(payroll.ei.rate)) {
    payroll.ei.maxPremium = roundCents(payroll.ei.rate * (payroll.ei.maxInsurableEarnings || 0));
  }
}

/**
 * Project a full tax-data bundle from an official base year toward targetYear.
 *
 * @param {object} baseData - { federal, provinces, payroll, dividends }
 * @param {object} opts
 * @param {number} opts.baseYear
 * @param {number} opts.targetYear
 * @param {number} opts.federalInflationRate - annual decimal (e.g. 0.02)
 * @param {Record<string, number>} [opts.provincialInflationRates] - optional per-province annual rates
 * @param {number} [opts.defaultProvincialInflationRate] - fallback provincial rate (defaults to federal)
 * @returns {object} projected bundle plus metadata
 */
export function projectTaxData(baseData, opts = {}) {
  const baseYear = Number(opts.baseYear);
  const targetYear = Number(opts.targetYear);
  assertFinite(baseYear, "baseYear");
  assertFinite(targetYear, "targetYear");

  const yearsAhead = targetYear - baseYear;
  if (yearsAhead < 0) {
    throw new Error(`targetYear ${targetYear} is before baseYear ${baseYear}`);
  }

  const federalInflationRate = Number(opts.federalInflationRate);
  assertFinite(federalInflationRate, "federalInflationRate");
  if (federalInflationRate <= -1) {
    throw new Error("federalInflationRate must be greater than -100%");
  }

  const defaultProvincial =
    opts.defaultProvincialInflationRate != null
      ? Number(opts.defaultProvincialInflationRate)
      : federalInflationRate;
  assertFinite(defaultProvincial, "defaultProvincialInflationRate");

  if (yearsAhead === 0) {
    return {
      federal: baseData.federal,
      provinces: baseData.provinces,
      payroll: baseData.payroll,
      dividends: baseData.dividends,
      meta: {
        projected: false,
        baseYear,
        targetYear,
        yearsAhead: 0,
        federalInflationRate,
        defaultProvincialInflationRate: defaultProvincial,
        provincialInflationRates: { ...(opts.provincialInflationRates || {}) }
      }
    };
  }

  const fedFactor = compoundFactor(federalInflationRate, yearsAhead);
  const federal = deepClone(baseData.federal);
  applyRules(federal, FEDERAL_INDEXATION_RULES, fedFactor);
  // Keep legacy `amount` alias aligned with enhanced BPA maximum.
  if (federal.credits?.basicPersonalAmount?.maximum != null) {
    federal.credits.basicPersonalAmount.amount = federal.credits.basicPersonalAmount.maximum;
  }
  federal.year = targetYear;
  federal._projection = {
    projected: true,
    baseYear,
    targetYear,
    inflationRate: federalInflationRate,
    factor: fedFactor
  };

  const payroll = deepClone(baseData.payroll);
  applyRules(payroll, PAYROLL_INDEXATION_RULES, fedFactor);
  recomputePayrollMaxima(payroll);
  payroll.year = targetYear;
  payroll._projection = federal._projection;

  const dividends = deepClone(baseData.dividends);
  // Dividend parameters are non-indexed; rules retained for documentation/tests.
  void DIVIDENDS_INDEXATION_RULES;

  const provinces = {};
  const provincialRatesUsed = {};
  for (const [code, prov] of Object.entries(baseData.provinces || {})) {
    if (String(code).startsWith("_")) continue;
    const provRate =
      opts.provincialInflationRates?.[code] != null
        ? Number(opts.provincialInflationRates[code])
        : defaultProvincial;
    assertFinite(provRate, `provincialInflationRates.${code}`);
    if (provRate <= -1) {
      throw new Error(`provincialInflationRates.${code} must be greater than -100%`);
    }
    provincialRatesUsed[code] = provRate;
    const factor = compoundFactor(provRate, yearsAhead);
    const next = deepClone(prov);
    applyRules(next, provinceIndexationRules(code), factor);
    if (next.credits?.basicPersonalAmount?.maximum != null) {
      next.credits.basicPersonalAmount.amount = next.credits.basicPersonalAmount.maximum;
    }
    next._projection = {
      projected: true,
      baseYear,
      targetYear,
      inflationRate: provRate,
      factor
    };
    provinces[code] = next;
  }

  return {
    federal,
    provinces,
    payroll,
    dividends,
    meta: {
      projected: true,
      baseYear,
      targetYear,
      yearsAhead,
      federalInflationRate,
      defaultProvincialInflationRate: defaultProvincial,
      provincialInflationRates: provincialRatesUsed,
      federalFactor: fedFactor
    }
  };
}

/**
 * Resolve tax data for a requested year: official folder if present, else project.
 *
 * @param {number} year
 * @param {object} opts
 * @param {(year:number)=>Promise<object>|object} opts.loadOfficialYear - loader for official JSON
 * @param {number} [opts.federalInflationRate=0.02]
 * @param {number} [opts.defaultProvincialInflationRate]
 * @param {Record<string, number>} [opts.provincialInflationRates]
 * @param {number} [opts.projectionBaseYear] - override latest official base
 */
export async function resolveTaxDataForYear(year, opts = {}) {
  const targetYear = Number(year);
  assertFinite(targetYear, "year");
  if (typeof opts.loadOfficialYear !== "function") {
    throw new Error("resolveTaxDataForYear requires opts.loadOfficialYear");
  }

  if (isOfficialTaxYear(targetYear)) {
    const data = await opts.loadOfficialYear(targetYear);
    return {
      ...data,
      meta: {
        projected: false,
        source: "official",
        targetYear,
        baseYear: targetYear,
        yearsAhead: 0,
        federalInflationRate: Number(opts.federalInflationRate) || 0,
        officialYears: OFFICIAL_TAX_YEARS.slice()
      }
    };
  }

  const baseYear =
    opts.projectionBaseYear != null
      ? Number(opts.projectionBaseYear)
      : latestOfficialTaxYear(targetYear);
  if (!isOfficialTaxYear(baseYear)) {
    throw new Error(`No official tax year available to project from (wanted ${targetYear})`);
  }

  const baseData = await opts.loadOfficialYear(baseYear);
  const projected = projectTaxData(baseData, {
    baseYear,
    targetYear,
    federalInflationRate: opts.federalInflationRate ?? 0.02,
    defaultProvincialInflationRate: opts.defaultProvincialInflationRate,
    provincialInflationRates: opts.provincialInflationRates
  });

  return {
    ...projected,
    meta: {
      ...projected.meta,
      source: "projected",
      officialYears: OFFICIAL_TAX_YEARS.slice()
    }
  };
}

export {
  OFFICIAL_TAX_YEARS,
  isOfficialTaxYear,
  latestOfficialTaxYear,
  compoundFactor
};
