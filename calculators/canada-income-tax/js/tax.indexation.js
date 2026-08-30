/**
 * Indexation metadata for Canadian personal tax data.
 *
 * Classification legend (per parameter):
 *   indexed          — CPI / provincial indexation factor applies
 *   fixed            — statute / policy freeze; do not inflate in projection
 *   formula-derived  — recompute from rates × indexed bases
 *   special          — jurisdiction-specific rule (see notes / overrides)
 *
 * Ontario Health Premium bands live in tax.engine.js and are statutory
 * (not annual CPI indexation).
 */

export const FEDERAL_INDEXATION_RULES = [
  { path: "brackets[].threshold", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.amount", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.maximum", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.minimum", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.phaseOutStart", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.phaseOutEnd", indexed: true, class: "indexed" },
  { path: "credits.canadaEmploymentAmount.amount", indexed: true, class: "indexed" },
  { path: "rrspDollarMax", indexed: true, class: "indexed" },
  { path: "brackets[].rate", indexed: false, class: "fixed" },
  { path: "credits.lowestRateForCredits", indexed: false, class: "fixed" },
  { path: "credits.cppEiCredit.rate", indexed: false, class: "fixed" },
  { path: "rrspRoomRate", indexed: false, class: "fixed" }
];

export const PAYROLL_INDEXATION_RULES = [
  { path: "cpp.basicExemption", indexed: false, class: "fixed" },
  { path: "cpp.maxPensionableEarnings", indexed: true, class: "indexed" },
  { path: "cpp2.maxAdditionalEarnings", indexed: true, class: "indexed" },
  { path: "ei.maxInsurableEarnings", indexed: true, class: "indexed" },
  { path: "cpp.rate", indexed: false, class: "fixed" },
  { path: "cpp.baseRate", indexed: false, class: "fixed" },
  { path: "cpp.firstAdditionalRate", indexed: false, class: "fixed" },
  { path: "cpp2.rate", indexed: false, class: "fixed" },
  { path: "ei.rate", indexed: false, class: "fixed" },
  { path: "cpp.maxBaseContribution", recompute: "cppMaxes", class: "formula-derived" },
  { path: "cpp.maxFirstAdditionalContribution", recompute: "cppMaxes", class: "formula-derived" },
  { path: "cpp.maxContribution", recompute: "cppMaxes", class: "formula-derived" },
  { path: "cpp2.maxAdditionalContribution", recompute: "cpp2Max", class: "formula-derived" },
  { path: "ei.maxPremium", recompute: "eiMax", class: "formula-derived" }
];

/** Default provincial/territorial rules. */
export const PROVINCE_DEFAULT_INDEXATION_RULES = [
  { path: "brackets[].threshold", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.amount", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.maximum", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.minimum", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.phaseOutStart", indexed: true, class: "indexed" },
  { path: "credits.basicPersonalAmount.phaseOutEnd", indexed: true, class: "indexed" },
  { path: "surtaxes[].threshold", indexed: true, class: "indexed" },
  { path: "surtaxes[].threshold2", indexed: true, class: "indexed" },
  { path: "taxReduction.basicPersonalAmount", indexed: true, class: "indexed" },
  { path: "taxReduction.dependantUnder18", indexed: true, class: "indexed" },
  { path: "taxReduction.dependantDisability", indexed: true, class: "indexed" },
  { path: "taxReduction.baseAmount", indexed: true, class: "indexed" },
  { path: "taxReduction.netIncomeThreshold", indexed: true, class: "indexed" },
  { path: "taxReduction.maximumNetIncome", indexed: true, class: "indexed" },
  { path: "taxReduction.basicReduction", indexed: true, class: "indexed" },
  { path: "taxReduction.phaseOutBase", indexed: true, class: "indexed" },
  { path: "taxReduction.reductionFactor", indexed: false, class: "fixed" },
  { path: "taxReduction.phaseOutRate", indexed: false, class: "fixed" },
  { path: "brackets[].rate", indexed: false, class: "fixed" },
  { path: "credits.basicPersonalAmount.rate", indexed: false, class: "fixed" },
  { path: "credits.cppEiCredit.rate", indexed: false, class: "fixed" },
  { path: "surtaxes[].rate", indexed: false, class: "fixed" },
  { path: "surtaxes[].rate2", indexed: false, class: "fixed" },
  { path: "premiums[].brackets[].threshold", indexed: false, class: "fixed" },
  { path: "premiums[].brackets[].amount", indexed: false, class: "fixed" }
];

/**
 * Province-specific overrides. Later matching rules for the same path win.
 *
 * Sources informing freezes:
 * - Manitoba: CRA T4032-MB 2026 "What's new" — brackets/BPA not indexed.
 * - BC Budget 2026 / gov.bc.ca: bracket indexation and basic personal tax credits
 *   (including B.C. tax reduction credit parameters) paused for 2027–2030.
 * - PEI: legislated BPA floor $15,000.
 */
export const PROVINCE_INDEXATION_OVERRIDES = {
  MB: [
    {
      path: "brackets[].threshold",
      indexed: false,
      class: "fixed",
      note: "CRA T4032-MB 2026: Manitoba did not index tax brackets for 2026."
    },
    {
      path: "credits.basicPersonalAmount.amount",
      indexed: false,
      class: "fixed",
      note: "CRA T4032-MB 2026: Manitoba BPA not indexed for 2026."
    }
  ],
  BC: [
    {
      path: "brackets[].threshold",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "BC Budget 2026 / gov.bc.ca: personal tax bracket indexation paused for 2027–2030; the projection assumption resumes indexation in 2031."
    },
    {
      path: "credits.basicPersonalAmount.amount",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "gov.bc.ca basic personal tax credits: Budget 2026 paused indexation for 2027–2030; the projection assumption resumes indexation in 2031."
    },
    {
      path: "credits.ageAmount.amount",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "gov.bc.ca basic personal tax credits: Budget 2026 paused indexation for 2027–2030; the projection assumption resumes indexation in 2031."
    },
    {
      path: "credits.ageAmount.phaseOutStart",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "gov.bc.ca basic personal tax credits: Budget 2026 paused indexation for 2027–2030; the projection assumption resumes indexation in 2031."
    },
    {
      path: "taxReduction.baseAmount",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "gov.bc.ca: B.C. tax reduction credit base held for 2026–2030; the projection assumption resumes indexation in 2031."
    },
    {
      path: "taxReduction.netIncomeThreshold",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "gov.bc.ca: B.C. tax reduction net-income threshold indexation paused for 2027–2030; the projection assumption resumes indexation in 2031."
    },
    {
      path: "taxReduction.maximumNetIncome",
      indexed: true,
      class: "special",
      pauseIndexationFromYear: 2027,
      pauseIndexationThroughYear: 2030,
      note: "gov.bc.ca: B.C. tax reduction maximum net income indexation paused for 2027–2030; the projection assumption resumes indexation in 2031."
    }
  ],
  PE: [
    {
      path: "credits.basicPersonalAmount.amount",
      indexed: false,
      class: "fixed",
      note: "PEI legislated BPA of $15,000 (policy floor)."
    }
  ],
  ON: [
    {
      path: "taxReduction.basicPersonalAmount",
      indexed: true,
      class: "indexed",
      note: "Ontario indexes tax-reduction personal amounts (CRA T4032-ON)."
    }
  ]
};

export const DIVIDENDS_INDEXATION_RULES = [
  { path: "eligible.grossUpRate", indexed: false, class: "fixed" },
  { path: "nonEligible.grossUpRate", indexed: false, class: "fixed" },
  { path: "eligible.credits.federal.rate", indexed: false, class: "fixed" },
  { path: "nonEligible.credits.federal.rate", indexed: false, class: "fixed" },
  { path: "eligible.credits.provincial.provinces", indexed: false, class: "fixed" },
  { path: "nonEligible.credits.provincial.provinces", indexed: false, class: "fixed" }
];

export const OFFICIAL_TAX_YEARS = [2025, 2026];

export function latestOfficialTaxYear(asOfYear = Infinity) {
  const available = OFFICIAL_TAX_YEARS.filter((y) => y <= asOfYear);
  if (!available.length) return Math.max(...OFFICIAL_TAX_YEARS);
  return Math.max(...available);
}

export function isOfficialTaxYear(year) {
  return OFFICIAL_TAX_YEARS.includes(Number(year));
}

export function provinceIndexationRules(provinceCode) {
  const code = String(provinceCode || "").toUpperCase();
  const overrides = PROVINCE_INDEXATION_OVERRIDES[code] || [];
  const byPath = new Map();
  for (const rule of PROVINCE_DEFAULT_INDEXATION_RULES) byPath.set(rule.path, rule);
  for (const rule of overrides) byPath.set(rule.path, rule);
  return [...byPath.values()];
}
