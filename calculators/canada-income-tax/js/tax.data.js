/**
 * tax.data.js
 * Robust data loading + normalization + validation
 *
 * Goals:
 * - Normalize province keys ("Ontario" vs "ON") so lookups are deterministic.
 * - Normalize dividend province DTC maps to uppercase 2-letter codes.
 * - Validate data shape and bounds so the engine can't silently compute garbage.
 * - Deep-freeze loaded data to prevent mutation bugs.
 */

let federalData = null;
let provincesData = null;     // canonical: keyed by 2-letter codes (ON, BC, ...)
let payrollData = null;
let dividendsData = null;

const DEFAULT_BASE_PATH = "data";

// ---------- Province normalization ----------

const PROVINCE_ALIASES = new Map([
  // Provinces
  ["ON", "ON"], ["ONTARIO", "ON"],

  ["BC", "BC"], ["BRITISHCOLUMBIA", "BC"], ["BRITISH COLUMBIA", "BC"],

  ["AB", "AB"], ["ALBERTA", "AB"],
  ["SK", "SK"], ["SASKATCHEWAN", "SK"],
  ["MB", "MB"], ["MANITOBA", "MB"],
  ["QC", "QC"], ["QUEBEC", "QC"], ["QUÉBEC", "QC"],
  ["NB", "NB"], ["NEWBRUNSWICK", "NB"], ["NEW BRUNSWICK", "NB"],
  ["NS", "NS"], ["NOVASCOTIA", "NS"], ["NOVA SCOTIA", "NS"],
  ["PE", "PE"], ["PEI", "PE"], ["PRINCEEDWARDISLAND", "PE"], ["PRINCE EDWARD ISLAND", "PE"],
  ["NL", "NL"], ["NEWFOUNDLANDANDLABRADOR", "NL"], ["NEWFOUNDLAND AND LABRADOR", "NL"],
  ["YT", "YT"], ["YUKON", "YT"],
  ["NT", "NT"], ["NORTHWESTTERRITORIES", "NT"], ["NORTHWEST TERRITORIES", "NT"],
  ["NU", "NU"], ["NUNAVUT", "NU"],
]);

function normalizeProvinceKey(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Uppercase + remove punctuation (but keep spaces for a second pass)
  const upper = raw.toUpperCase();
  if (PROVINCE_ALIASES.has(upper)) return PROVINCE_ALIASES.get(upper);

  // Remove spaces
  const compact = upper.replace(/\s+/g, "");
  if (PROVINCE_ALIASES.has(compact)) return PROVINCE_ALIASES.get(compact);

  // If already looks like 2-letter code, return it
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  return null;
}

// ---------- Deep freeze ----------

function deepFreeze(obj) {
  if (!obj || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object" && !Object.isFrozen(val)) deepFreeze(val);
  }
  return obj;
}

// ---------- Validation helpers ----------

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isFiniteNumber(x) {
  return Number.isFinite(x);
}

function validateBrackets(brackets, label) {
  assert(Array.isArray(brackets) && brackets.length > 0, `${label}: brackets must be a non-empty array`);
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    assert(b && typeof b === "object", `${label}: bracket[${i}] must be an object`);
    assert(isFiniteNumber(b.threshold) && b.threshold >= 0, `${label}: bracket[${i}].threshold must be >= 0`);
    assert(isFiniteNumber(b.rate) && b.rate >= 0 && b.rate <= 1, `${label}: bracket[${i}].rate must be between 0 and 1 (decimal)`);
    if (i > 0) {
      assert(brackets[i].threshold >= brackets[i - 1].threshold, `${label}: thresholds must be non-decreasing (bad at index ${i})`);
    }
  }
}

function validateFederal(data) {
  assert(data && typeof data === "object", "federal.json: must be an object");
  validateBrackets(data.brackets, "federal.json");

  if (data.credits) {
    // Basic shape checks only; engine decides applicability.
    if (data.credits.basicPersonalAmount) {
      assert(isFiniteNumber(data.credits.basicPersonalAmount.amount) && data.credits.basicPersonalAmount.amount >= 0,
        "federal.json: credits.basicPersonalAmount.amount must be >= 0");
    }
    if (data.credits.canadaEmploymentAmount) {
      assert(isFiniteNumber(data.credits.canadaEmploymentAmount.amount) && data.credits.canadaEmploymentAmount.amount >= 0,
        "federal.json: credits.canadaEmploymentAmount.amount must be >= 0");
    }
    if (data.credits.cppEiCredit) {
      assert(isFiniteNumber(data.credits.cppEiCredit.rate) && data.credits.cppEiCredit.rate >= 0 && data.credits.cppEiCredit.rate <= 1,
        "federal.json: credits.cppEiCredit.rate must be 0..1");
    }
  }
}

function validateProvinceObject(prov, label) {
  assert(prov && typeof prov === "object", `${label}: must be an object`);
  validateBrackets(prov.brackets, `${label}.brackets`);

  if (prov.credits && prov.credits.basicPersonalAmount) {
    assert(isFiniteNumber(prov.credits.basicPersonalAmount.amount) && prov.credits.basicPersonalAmount.amount >= 0,
      `${label}: credits.basicPersonalAmount.amount must be >= 0`);
  }

  if (prov.surtaxes) {
    assert(Array.isArray(prov.surtaxes), `${label}: surtaxes must be an array`);
    for (let i = 0; i < prov.surtaxes.length; i++) {
      const s = prov.surtaxes[i];
      assert(s && typeof s === "object", `${label}: surtaxes[${i}] must be an object`);
      assert(isFiniteNumber(s.threshold) && s.threshold >= 0, `${label}: surtaxes[${i}].threshold must be >= 0`);
      assert(isFiniteNumber(s.rate) && s.rate >= 0 && s.rate <= 1, `${label}: surtaxes[${i}].rate must be 0..1`);
      if (s.threshold2 != null) {
        assert(isFiniteNumber(s.threshold2) && s.threshold2 >= s.threshold, `${label}: surtaxes[${i}].threshold2 must be >= threshold`);
        assert(isFiniteNumber(s.rate2) && s.rate2 >= 0 && s.rate2 <= 1, `${label}: surtaxes[${i}].rate2 must be 0..1`);
      }
    }
  }

  if (prov.premiums) {
    assert(Array.isArray(prov.premiums), `${label}: premiums must be an array`);
    for (let i = 0; i < prov.premiums.length; i++) {
      const p = prov.premiums[i];
      assert(p && typeof p === "object", `${label}: premiums[${i}] must be an object`);
      if (p.formula) {
        assert(typeof p.formula === "string" && p.formula.length > 0, `${label}: premiums[${i}].formula must be a non-empty string`);
      }
      if (p.brackets) {
        assert(Array.isArray(p.brackets), `${label}: premiums[${i}].brackets must be an array`);
        for (let j = 0; j < p.brackets.length; j++) {
          const b = p.brackets[j];
          assert(isFiniteNumber(b.threshold) && b.threshold >= 0, `${label}: premium bracket threshold invalid`);
          assert(isFiniteNumber(b.amount) && b.amount >= 0, `${label}: premium bracket amount invalid`);
        }
      }
    }
  }
}

function normalizeAndValidateProvinces(raw) {
  assert(raw && typeof raw === "object", "provinces.json: must be an object keyed by province");

  const out = {};

  for (const [key, provObj] of Object.entries(raw)) {
    const code = normalizeProvinceKey(key);
    assert(code, `provinces.json: unrecognized province key "${key}" (expected ON/BC/... or full name)`);
    // If duplicates collide (e.g., "ON" and "Ontario"), prefer the explicit 2-letter key.
    const isTwoLetter = /^[A-Z]{2}$/.test(String(key).trim().toUpperCase());
    if (out[code] && !isTwoLetter) continue;

    validateProvinceObject(provObj, `provinces.json[${key}]`);
    out[code] = provObj;
  }

  // Ensure we loaded at least the common provinces; fail early if the file is empty/broken.
  assert(Object.keys(out).length >= 5, "provinces.json: suspiciously few provinces loaded");

  return out;
}

function validatePayroll(data) {
  assert(data && typeof data === "object", "payroll.json: must be an object");
  assert(data.cpp && typeof data.cpp === "object", "payroll.json: missing cpp");
  assert(isFiniteNumber(data.cpp.rate) && data.cpp.rate >= 0 && data.cpp.rate <= 1, "payroll.json: cpp.rate must be 0..1");
  assert(isFiniteNumber(data.cpp.basicExemption) && data.cpp.basicExemption >= 0, "payroll.json: cpp.basicExemption must be >= 0");
  assert(isFiniteNumber(data.cpp.maxPensionableEarnings) && data.cpp.maxPensionableEarnings >= 0, "payroll.json: cpp.maxPensionableEarnings must be >= 0");
  assert(isFiniteNumber(data.cpp.maxContribution) && data.cpp.maxContribution >= 0, "payroll.json: cpp.maxContribution must be >= 0");

  assert(data.ei && typeof data.ei === "object", "payroll.json: missing ei");
  assert(isFiniteNumber(data.ei.rate) && data.ei.rate >= 0 && data.ei.rate <= 1, "payroll.json: ei.rate must be 0..1");
  assert(isFiniteNumber(data.ei.maxInsurableEarnings) && data.ei.maxInsurableEarnings >= 0, "payroll.json: ei.maxInsurableEarnings must be >= 0");
  assert(isFiniteNumber(data.ei.maxPremium) && data.ei.maxPremium >= 0, "payroll.json: ei.maxPremium must be >= 0");

  // cpp2 optional
  if (data.cpp2) {
    assert(isFiniteNumber(data.cpp2.rate) && data.cpp2.rate >= 0 && data.cpp2.rate <= 1, "payroll.json: cpp2.rate must be 0..1");
    assert(isFiniteNumber(data.cpp2.maxAdditionalEarnings) && data.cpp2.maxAdditionalEarnings >= 0, "payroll.json: cpp2.maxAdditionalEarnings must be >= 0");
    assert(isFiniteNumber(data.cpp2.maxAdditionalContribution) && data.cpp2.maxAdditionalContribution >= 0, "payroll.json: cpp2.maxAdditionalContribution must be >= 0");
  }
}

/**
 * Validates and normalizes the explicit dividend credit schema.
 * Each credit must specify base: "cash" | "grossed_up" and rate (0..1). No assumptions.
 */
function normalizeAndValidateDividends(data) {
  assert(data && typeof data === "object", "dividends.json: must be an object");
  assert(data.eligible && typeof data.eligible === "object", "dividends.json: missing eligible");
  assert(data.nonEligible && typeof data.nonEligible === "object", "dividends.json: missing nonEligible");

  for (const type of ["eligible", "nonEligible"]) {
    const d = data[type];
    assert(isFiniteNumber(d.grossUpRate) && d.grossUpRate > 0, `dividends.json: ${type}.grossUpRate must be > 0`);
    assert(d.credits && typeof d.credits === "object", `dividends.json: ${type}.credits must be an object (explicit schema required)`);
    // Federal credit: base + rate
    assert(d.credits.federal && typeof d.credits.federal === "object", `dividends.json: ${type}.credits.federal required`);
    assert(d.credits.federal.base === "cash" || d.credits.federal.base === "grossed_up", `dividends.json: ${type}.credits.federal.base must be "cash" or "grossed_up"`);
    assert(isFiniteNumber(d.credits.federal.rate) && d.credits.federal.rate >= 0 && d.credits.federal.rate <= 1, `dividends.json: ${type}.credits.federal.rate must be 0..1`);
    // Provincial: base + provinces map
    assert(d.credits.provincial && typeof d.credits.provincial === "object", `dividends.json: ${type}.credits.provincial required`);
    assert(d.credits.provincial.base === "cash" || d.credits.provincial.base === "grossed_up", `dividends.json: ${type}.credits.provincial.base must be "cash" or "grossed_up"`);
    assert(d.credits.provincial.provinces && typeof d.credits.provincial.provinces === "object", `dividends.json: ${type}.credits.provincial.provinces must be an object`);
  }

  const normalizeProvMap = (m, label) => {
    const out = {};
    for (const [key, val] of Object.entries(m)) {
      const code = normalizeProvinceKey(key);
      assert(code, `${label}: unrecognized province key "${key}"`);
      assert(isFiniteNumber(val) && val >= 0 && val <= 1, `${label}[${key}]: rate must be 0..1`);
      out[code] = val;
    }
    return out;
  };

  const normalized = {
    ...data,
    eligible: {
      ...data.eligible,
      credits: {
        federal: data.eligible.credits.federal,
        provincial: { ...data.eligible.credits.provincial, provinces: normalizeProvMap(data.eligible.credits.provincial.provinces, "eligible.provincial.provinces") },
      },
    },
    nonEligible: {
      ...data.nonEligible,
      credits: {
        federal: data.nonEligible.credits.federal,
        provincial: { ...data.nonEligible.credits.provincial, provinces: normalizeProvMap(data.nonEligible.credits.provincial.provinces, "nonEligible.provincial.provinces") },
      },
    },
  };

  assert(normalized.eligible.credits.provincial.provinces.ON != null, "dividends.json: eligible.credits.provincial.provinces missing ON");
  assert(normalized.nonEligible.credits.provincial.provinces.ON != null, "dividends.json: nonEligible.credits.provincial.provinces missing ON");

  return normalized;
}

// ---------- Public API ----------

/**
 * Load all tax data files for a given year, with validation and normalization.
 * @param {number} year
 * @param {Object} [opts]
 * @param {string} [opts.basePath] - path prefix, default "data"
 * @returns {Promise<Object>}
 */
export async function loadTaxData(year, opts = {}) {
  const basePath = opts.basePath || DEFAULT_BASE_PATH;

  try {
    const [federal, provincesRaw, payroll, dividendsRaw] = await Promise.all([
      fetch(`${basePath}/${year}/federal.json`).then(r => r.json()),
      fetch(`${basePath}/${year}/provinces.json`).then(r => r.json()),
      fetch(`${basePath}/${year}/payroll.json`).then(r => r.json()),
      fetch(`${basePath}/${year}/dividends.json`).then(r => r.json()),
    ]);

    validateFederal(federal);
    const provincesNormalized = normalizeAndValidateProvinces(provincesRaw);
    validatePayroll(payroll);
    const dividendsNormalized = normalizeAndValidateDividends(dividendsRaw);

    federalData = deepFreeze(federal);
    provincesData = deepFreeze(provincesNormalized);
    payrollData = deepFreeze(payroll);
    dividendsData = deepFreeze(dividendsNormalized);

    return {
      federal: federalData,
      provinces: provincesData,
      payroll: payrollData,
      dividends: dividendsData,
    };
  } catch (error) {
    console.error("Error loading tax data:", error);
    throw new Error(`Failed to load+validate tax data for year ${year}: ${error.message}`);
  }
}

export function getFederalData() {
  if (!federalData) throw new Error("Tax data not loaded. Call loadTaxData() first.");
  return federalData;
}

export function getProvincesData() {
  if (!provincesData) throw new Error("Tax data not loaded. Call loadTaxData() first.");
  return provincesData;
}

export function getProvincialData(province) {
  if (!provincesData) throw new Error("Tax data not loaded. Call loadTaxData() first.");
  const code = normalizeProvinceKey(province);
  if (!code) throw new Error(`Unrecognized province "${province}"`);
  if (!provincesData[code]) throw new Error(`Province ${code} not found in tax data`);
  return provincesData[code];
}

export function getPayrollData() {
  if (!payrollData) throw new Error("Tax data not loaded. Call loadTaxData() first.");
  return payrollData;
}

export function getDividendsData() {
  if (!dividendsData) throw new Error("Tax data not loaded. Call loadTaxData() first.");
  return dividendsData;
}

// Optional export if you want to normalize in UI code too
export function normalizeProvince(province) {
  return normalizeProvinceKey(province);
}