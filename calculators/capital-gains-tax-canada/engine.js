/**
 * Canada Capital Gains Tax Calculator — engine.
 *
 * Default mode: progressive incremental personal tax via the shared tax engine.
 * Optional mode: manual taxable-gain × combined marginal rate sensitivity.
 */

import { computePersonalTax } from "../canada-income-tax/js/tax.engine.js";

export const CAPITAL_GAINS_INCLUSION_RATE = 0.5;
export const CALC_MODES = Object.freeze({
  PROGRESSIVE: "progressive",
  MANUAL: "manual"
});

function num(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function clampNonNeg(value) {
  return Math.max(0, num(value, 0));
}

/**
 * Source-neutral personal-tax input for progressive capital-gains mode.
 * Pre-gain taxable income is passed as otherIncome so CPP, EI, and the
 * Canada Employment Amount are not applied from that amount alone.
 */
function personalInput(base) {
  return {
    year: base.year,
    province: base.province,
    employmentIncome: 0,
    selfEmploymentIncome: 0,
    otherIncome: clampNonNeg(base.incomeBeforeGain),
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    capitalGains: clampNonNeg(base.capitalGains),
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0
  };
}

/**
 * Progressive incremental tax attributable to a capital gain.
 *
 * @param {object} inputs
 * @param {number} inputs.year
 * @param {string} inputs.province
 * @param {number} inputs.incomeBeforeGain - taxable income before the capital gain (source-neutral)
 * @param {number} inputs.capitalGain - gross capital gain (cash)
 * @param {boolean} [inputs.primaryResidenceExemption]
 * @param {object} [opts]
 * @param {object} [opts.taxData] - immutable tax bundle from getTaxDataBundle
 */
export function calculateProgressiveCapitalGainsTax(inputs, opts = {}) {
  const year = Number.parseInt(inputs.year, 10);
  const province = String(inputs.province || "").trim().toUpperCase();
  const incomeBeforeGain = clampNonNeg(inputs.incomeBeforeGain);
  const capitalGain = num(inputs.capitalGain, 0);
  const primaryResidenceExemption = !!inputs.primaryResidenceExemption;
  const taxOpts = opts.taxData ? { taxData: opts.taxData } : {};

  if (!province) {
    throw new Error("Province/territory is required.");
  }
  if (!Number.isFinite(year)) {
    throw new Error("Tax year is required.");
  }

  const isLoss = capitalGain <= 0;
  const grossCapitalGain = isLoss ? capitalGain : capitalGain;
  const taxableIncluded =
    isLoss || primaryResidenceExemption ? 0 : grossCapitalGain * CAPITAL_GAINS_INCLUSION_RATE;

  const before = computePersonalTax(
    personalInput({
      year,
      province,
      incomeBeforeGain,
      capitalGains: 0
    }),
    { ...taxOpts, skipMarginalRateCalculation: true }
  );

  const after = computePersonalTax(
    personalInput({
      year,
      province,
      incomeBeforeGain,
      capitalGains: isLoss || primaryResidenceExemption ? 0 : Math.max(0, grossCapitalGain)
    }),
    taxOpts
  );

  const taxBefore = before.totals.totalIncomeTax;
  const taxAfter = after.totals.totalIncomeTax;
  const additionalTax = taxAfter - taxBefore;
  const effectiveRateOnGross =
    !isLoss && grossCapitalGain > 0 ? additionalTax / grossCapitalGain : 0;
  const marginalRateAfter = after.totals.marginalRate ?? null;

  return {
    mode: CALC_MODES.PROGRESSIVE,
    year,
    province,
    incomeBeforeGain,
    capitalGain: grossCapitalGain,
    isLoss,
    primaryResidenceExemption,
    inclusionRate: CAPITAL_GAINS_INCLUSION_RATE,
    taxableIncluded,
    taxableIncomeBefore: before.totals.taxableIncome,
    taxBefore,
    taxableIncomeAfter: after.totals.taxableIncome,
    taxAfter,
    additionalTax,
    effectiveRateOnGross,
    marginalRateAfter,
    // Compatibility aliases used by older share/CSV wording
    taxableGain: taxableIncluded,
    taxOwing: additionalTax,
    afterTaxProceeds: null,
    before,
    after
  };
}

/**
 * Optional sensitivity mode: taxableGain × one combined marginal rate.
 */
export function calculateManualMarginalRateEstimate(inputs) {
  const capitalGain = num(inputs.capitalGain, 0);
  const inclusionRatePct = num(inputs.inclusionRate, 50);
  const marginalTaxRatePct = num(inputs.marginalTaxRate, 0);
  const primaryResidenceExemption = !!inputs.primaryResidenceExemption;
  const isLoss = capitalGain <= 0;

  if (!Number.isFinite(inclusionRatePct) || inclusionRatePct < 0 || inclusionRatePct > 100) {
    throw new Error("Inclusion rate must be between 0% and 100%.");
  }
  if (!Number.isFinite(marginalTaxRatePct) || marginalTaxRatePct < 0 || marginalTaxRatePct > 100) {
    throw new Error("Combined marginal tax rate must be between 0% and 100%.");
  }

  let taxableGain = 0;
  let taxOwing = 0;
  if (!isLoss && !primaryResidenceExemption) {
    taxableGain = capitalGain * (inclusionRatePct / 100);
    taxOwing = taxableGain * (marginalTaxRatePct / 100);
  }

  return {
    mode: CALC_MODES.MANUAL,
    capitalGain,
    isLoss,
    primaryResidenceExemption,
    inclusionRate: inclusionRatePct / 100,
    inclusionRatePct,
    marginalTaxRatePct,
    taxableIncluded: taxableGain,
    taxableGain,
    taxOwing,
    additionalTax: taxOwing,
    effectiveRateOnGross: !isLoss && capitalGain > 0 ? taxOwing / capitalGain : 0,
    afterTaxProceeds: null
  };
}

/**
 * Resolve gross capital gain from either a direct field or proceeds − ACB.
 */
export function resolveCapitalGain(inputs) {
  if (inputs.capitalGain != null && String(inputs.capitalGain).trim() !== "") {
    return num(inputs.capitalGain, 0);
  }
  const proceeds = num(inputs.proceeds, 0);
  const acb = num(inputs.acb, 0);
  return proceeds - acb;
}

export const SHARE_VERSION = "2";

function paramGet(params, key) {
  if (!params) return null;
  if (typeof params.get === "function") {
    return typeof params.has === "function" && !params.has(key) ? null : params.get(key);
  }
  if (Object.prototype.hasOwnProperty.call(params, key) && params[key] != null && params[key] !== "") {
    return String(params[key]);
  }
  return null;
}

/**
 * Versioned share/query scenario from calculator inputs.
 */
export function buildShareScenario(inputs) {
  const s = {
    v: SHARE_VERSION,
    mode: inputs.mode === CALC_MODES.MANUAL ? CALC_MODES.MANUAL : CALC_MODES.PROGRESSIVE,
    year: inputs.year,
    prov: inputs.province || "",
    income: inputs.incomeBeforeGain,
    gain: inputs.capitalGain,
    pre: inputs.primaryResidenceExemption ? "1" : "0"
  };
  if (inputs.proceeds != null && inputs.proceeds !== "") s.proceeds = inputs.proceeds;
  if (inputs.acb != null && inputs.acb !== "") s.acb = inputs.acb;
  if (s.mode === CALC_MODES.MANUAL) {
    s.incl = inputs.inclusionRate;
    s.mtr = inputs.marginalTaxRate;
  }
  return s;
}

/**
 * Parse share/query params (URLSearchParams or plain object). Returns null if none present.
 */
export function parseShareQuery(params) {
  const keys = ["v", "mode", "year", "prov", "income", "gain", "pre", "incl", "mtr", "proceeds", "acb"];
  if (!keys.some((k) => paramGet(params, k) != null)) return null;

  const modeRaw = (paramGet(params, "mode") || CALC_MODES.PROGRESSIVE).toLowerCase();
  const yearRaw = Number.parseInt(paramGet(params, "year") || "", 10);
  const incomeRaw = num(paramGet(params, "income"), NaN);
  const gainRaw = num(paramGet(params, "gain"), NaN);
  const preRaw = paramGet(params, "pre");
  const proceedsRaw = paramGet(params, "proceeds");
  const acbRaw = paramGet(params, "acb");
  const inclRaw = num(paramGet(params, "incl"), NaN);
  const mtrRaw = num(paramGet(params, "mtr"), NaN);

  return {
    mode: modeRaw === CALC_MODES.MANUAL ? CALC_MODES.MANUAL : CALC_MODES.PROGRESSIVE,
    year: Number.isFinite(yearRaw) ? yearRaw : null,
    province: paramGet(params, "prov") ? String(paramGet(params, "prov")).trim().toUpperCase() : null,
    incomeBeforeGain: Number.isFinite(incomeRaw) ? incomeRaw : null,
    capitalGain: Number.isFinite(gainRaw) ? gainRaw : null,
    primaryResidenceExemption: preRaw === "1" || preRaw === "true",
    proceeds: proceedsRaw != null && proceedsRaw !== "" ? num(proceedsRaw, null) : null,
    acb: acbRaw != null && acbRaw !== "" ? num(acbRaw, null) : null,
    inclusionRate: Number.isFinite(inclRaw) ? inclRaw : null,
    marginalTaxRate: Number.isFinite(mtrRaw) ? mtrRaw : null
  };
}

/**
 * CSV rows matching the UI export (inputs + outputs). Used by tests to reconcile exports.
 */
export function buildCsvRows(inputs, result) {
  const rows = [
    "Canada Capital Gains Tax Calculator (export)",
    "Mode," + result.mode,
    "",
    "Input,Value",
    "Tax year," + inputs.year,
    "Province," + (inputs.province || ""),
    "Taxable income before capital gain," + inputs.incomeBeforeGain,
    "Capital gain (gross)," + inputs.capitalGain
  ];
  if (inputs.proceeds != null && inputs.proceeds !== "") rows.push("Proceeds," + inputs.proceeds);
  if (inputs.acb != null && inputs.acb !== "") rows.push("Adjusted Cost Base (ACB)," + inputs.acb);
  rows.push("Primary residence exemption," + (inputs.primaryResidenceExemption ? "Yes" : "No"));
  if (result.mode === CALC_MODES.MANUAL) {
    rows.push("Inclusion rate," + inputs.inclusionRate + "%");
    rows.push("Marginal tax rate," + inputs.marginalTaxRate + "%");
  } else {
    rows.push("Inclusion rate (engine)," + Math.round(CAPITAL_GAINS_INCLUSION_RATE * 100) + "%");
  }
  rows.push("", "Output,Value");
  if (result.mode === CALC_MODES.PROGRESSIVE) {
    rows.push("Taxable income before," + result.taxableIncomeBefore);
    rows.push("Tax before," + result.taxBefore);
    rows.push("Gross capital gain," + result.capitalGain);
    rows.push("Taxable (included) portion," + result.taxableIncluded);
    rows.push("Taxable income after," + result.taxableIncomeAfter);
    rows.push("Tax after," + result.taxAfter);
    rows.push("Additional tax," + result.additionalTax);
    rows.push("Effective tax rate on gross gain," + (result.effectiveRateOnGross * 100).toFixed(4) + "%");
    if (result.marginalRateAfter != null && Number.isFinite(result.marginalRateAfter)) {
      rows.push("Marginal rate after gain," + (result.marginalRateAfter * 100).toFixed(4) + "%");
    }
  } else {
    rows.push("Capital gain/loss," + result.capitalGain);
    rows.push("Taxable capital gain," + result.taxableGain);
    rows.push("Estimated tax at entered marginal rate," + result.taxOwing);
    rows.push("Effective tax rate on gross gain," + (result.effectiveRateOnGross * 100).toFixed(4) + "%");
  }
  return rows;
}

// Browser global for any residual non-module consumers / smoke tests.
if (typeof globalThis !== "undefined") {
  globalThis.CapitalGainsTaxCanada = {
    calculateProgressiveCapitalGainsTax,
    calculateManualMarginalRateEstimate,
    resolveCapitalGain,
    buildShareScenario,
    parseShareQuery,
    buildCsvRows,
    CAPITAL_GAINS_INCLUSION_RATE,
    CALC_MODES,
    SHARE_VERSION
  };
}
