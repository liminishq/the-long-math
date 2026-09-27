/**
 * Canadian mortgage loan insurance (CMHC-style) premium schedules and eligibility.
 *
 * Premium rates / portability notes:
 *   https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/premium-information-for-homeowner-and-small-rental-loans
 *
 * Purchase eligibility (price below $1.5M, min equity, standard max amort 25y):
 *   https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/purchase
 *
 * 30-year insured amortization (first-time homebuyer OR newly built home):
 *   https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/home-start
 *
 * Provincial sales tax on premiums (cannot be financed) — CMHC currently lists
 * Ontario, Quebec, and Saskatchewan on the premium-information page above.
 * Rates and effective dates are maintained in PROVINCIAL_PREMIUM_TAX_SCHEDULE.
 *
 * Exposes globalThis.CanadaMortgageLoanInsurance for browser and Node tests.
 */
(function (g) {
  "use strict";

  var SOURCE_URL =
    "https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/premium-information-for-homeowner-and-small-rental-loans";
  var PURCHASE_ELIGIBILITY_URL =
    "https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/purchase";
  var HOME_START_URL =
    "https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/home-start";

  /** Homeowner premium on total loan amount by LTV ceiling (inclusive upper bound). */
  var HOMEOWNER_PREMIUM_BANDS = [
    { maxLtvInclusive: 0.65, rate: 0.006 },
    { maxLtvInclusive: 0.75, rate: 0.017 },
    { maxLtvInclusive: 0.8, rate: 0.024 },
    { maxLtvInclusive: 0.85, rate: 0.028 },
    { maxLtvInclusive: 0.9, rate: 0.031 },
    { maxLtvInclusive: 0.95, rate: 0.04 },
  ];

  var NON_TRADITIONAL_DOWN_PAYMENT_RATE_95 = 0.045;
  var AMORTIZATION_SURCHARGE_BEYOND_25Y = 0.002;
  /** CMHC: purchase price / lending value must be *below* this amount for insured homeowner loans. */
  var MAX_INSURABLE_PURCHASE_PRICE = 1_500_000;
  var MAX_LTV = 0.95;
  var STANDARD_MAX_AMORTIZATION_YEARS = 25;
  var HOME_START_MAX_AMORTIZATION_YEARS = 30;

  /**
   * Provincial tax on mortgage loan insurance premiums (cash only; never financed).
   *
   * CMHC premium-information page currently identifies ON, QC, and SK.
   * Do not add other provinces without an authoritative current source that the
   * relevant sales tax applies to CMHC/Sagen/Canada Guaranty premiums there.
   *
   * Rates are dated schedules so upcoming changes (esp. Quebec) are explicit.
   * Lookup uses the rate whose effectiveFrom is the latest on-or-before asOfDate.
   */
  var PROVINCIAL_PREMIUM_TAX_SCHEDULE = {
    none: {
      label: "None / other",
      rates: [{ effectiveFrom: "1900-01-01", rate: 0, sourceUrl: null, notes: "No provincial premium tax applied." }],
    },
    ON: {
      label: "Ontario",
      /**
       * Ontario Retail Sales Tax (RST) on taxable insurance premiums is 8%.
       * https://www.ontario.ca/document/retail-sales-tax/insurance
       * CMHC: tax cannot be added to the insured loan amount.
       */
      rates: [
        {
          effectiveFrom: "1900-01-01",
          rate: 0.08,
          sourceUrl: "https://www.ontario.ca/document/retail-sales-tax/insurance",
          notes: "Ontario RST on taxable insurance premiums.",
        },
      ],
    },
    QC: {
      label: "Quebec",
      /**
       * Tax on insurance premiums (Revenu Québec):
       *   Current: 9%
       *     https://www.revenuquebec.ca/en/businesses/consumption-taxes/tax-on-insurance-premiums/
       *   Scheduled: 9.975% for premiums paid after 2026-12-31
       *     https://www.revenuquebec.ca/en/press-room/tax-news/details/2026-04-09/harmonization-of-the-insurance-premiums-tax-rate-with-the-qst-rate/
       *
       * MAINTENANCE: when "today" passes 2026-12-31, provincialPremiumTaxRate("QC")
       * automatically returns 9.975%. Keep both rows; do not delete the historical 9% row.
       */
      rates: [
        {
          effectiveFrom: "1900-01-01",
          rate: 0.09,
          sourceUrl:
            "https://www.revenuquebec.ca/en/businesses/consumption-taxes/tax-on-insurance-premiums/",
          notes: "Quebec tax on insurance premiums before the 2027 harmonization.",
        },
        {
          effectiveFrom: "2027-01-01",
          rate: 0.09975,
          sourceUrl:
            "https://www.revenuquebec.ca/en/press-room/tax-news/details/2026-04-09/harmonization-of-the-insurance-premiums-tax-rate-with-the-qst-rate/",
          notes:
            "Applies to insurance premiums paid after 2026-12-31 (Revenu Québec). Harmonized with QST rate.",
        },
      ],
    },
    SK: {
      label: "Saskatchewan",
      /**
       * Saskatchewan PST on taxable insurance is 6%.
       * https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax/pst-bulletins
       * CMHC: tax cannot be added to the insured loan amount.
       */
      rates: [
        {
          effectiveFrom: "1900-01-01",
          rate: 0.06,
          sourceUrl:
            "https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax",
          notes: "Saskatchewan PST on taxable insurance premiums.",
        },
      ],
    },
  };

  /** Convenience mirror of *current* rates (resolved at module load for display helpers). */
  var PROVINCIAL_PREMIUM_TAX = {
    none: 0,
    ON: 0.08,
    QC: 0.09,
    SK: 0.06,
  };

  function clampNonNeg(n) {
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  function parseIsoDate(iso) {
    if (!iso || typeof iso !== "string") return null;
    var parts = iso.split("-");
    if (parts.length !== 3) return null;
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    return new Date(Date.UTC(y, m - 1, d));
  }

  function toUtcDateOnly(date) {
    var dt = date instanceof Date ? date : new Date(date);
    if (isNaN(dt.getTime())) return null;
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }

  /**
   * Resolve provincial premium-tax rate for a province as of a given date.
   * @param {string} provinceCode none | ON | QC | SK
   * @param {Date|string} [asOfDate] defaults to today (local → UTC date)
   * @returns {{ rate: number, effectiveFrom: string|null, sourceUrl: string|null, notes: string|null, scheduleEntry: object|null }}
   */
  function resolveProvincialPremiumTax(provinceCode, asOfDate) {
    var key = provinceCode == null || provinceCode === "" ? "none" : String(provinceCode);
    var schedule = PROVINCIAL_PREMIUM_TAX_SCHEDULE[key];
    if (!schedule) {
      return { rate: 0, effectiveFrom: null, sourceUrl: null, notes: null, scheduleEntry: null };
    }
    var asOf = asOfDate != null ? toUtcDateOnly(asOfDate) : toUtcDateOnly(new Date());
    if (!asOf) asOf = toUtcDateOnly(new Date());

    var best = null;
    for (var i = 0; i < schedule.rates.length; i += 1) {
      var entry = schedule.rates[i];
      var from = parseIsoDate(entry.effectiveFrom);
      if (!from) continue;
      if (from.getTime() <= asOf.getTime()) {
        if (!best || from.getTime() > parseIsoDate(best.effectiveFrom).getTime()) {
          best = entry;
        }
      }
    }
    if (!best) {
      return { rate: 0, effectiveFrom: null, sourceUrl: null, notes: null, scheduleEntry: null };
    }
    return {
      rate: best.rate,
      effectiveFrom: best.effectiveFrom,
      sourceUrl: best.sourceUrl || null,
      notes: best.notes || null,
      scheduleEntry: best,
    };
  }

  function provincialPremiumTaxRate(provinceCode, asOfDate) {
    return resolveProvincialPremiumTax(provinceCode, asOfDate).rate;
  }

  /**
   * Minimum Canadian down payment for an insured purchase (owner-occupied 1–2 units).
   * 5% of first $500k + 10% of portion above $500k while price is below $1.5M.
   * At/above $1.5M, high-ratio insurance is unavailable; conventional minimum is treated as 20%.
   */
  function minimumDownPayment(purchasePrice) {
    var price = clampNonNeg(purchasePrice);
    if (price >= MAX_INSURABLE_PURCHASE_PRICE) {
      return price * 0.2;
    }
    if (price <= 500_000) {
      return price * 0.05;
    }
    return 500_000 * 0.05 + (price - 500_000) * 0.1;
  }

  function premiumRateForLtv(ltv, options) {
    var opts = options || {};
    var nonTraditional = !!opts.nonTraditionalDownPayment;
    if (!(ltv > 0) || ltv > MAX_LTV + 1e-12) {
      return null;
    }
    if (ltv > 0.9 && ltv <= 0.95 + 1e-12 && nonTraditional) {
      return NON_TRADITIONAL_DOWN_PAYMENT_RATE_95;
    }
    for (var i = 0; i < HOMEOWNER_PREMIUM_BANDS.length; i += 1) {
      if (ltv <= HOMEOWNER_PREMIUM_BANDS[i].maxLtvInclusive + 1e-12) {
        return HOMEOWNER_PREMIUM_BANDS[i].rate;
      }
    }
    return null;
  }

  function isEligibleFor30YearInsuredAmortization(eligibility) {
    var code = eligibility == null || eligibility === "" ? "neither" : String(eligibility);
    return code === "first_time_homebuyer" || code === "newly_built_home";
  }

  /**
   * Compute Canadian mortgage loan insurance for a purchase.
   *
   * @param {object} inputs
   * @param {number} inputs.purchasePrice
   * @param {number} inputs.downPayment
   * @param {number} [inputs.amortizationYears=25]
   * @param {string} [inputs.province="none"] - none | ON | QC | SK
   * @param {boolean} [inputs.nonTraditionalDownPayment=false]
   * @param {boolean} [inputs.financePremium=true] - add premium to mortgage; PST never financed
   * @param {string} [inputs.thirtyYearEligibility="neither"]
   *   neither | first_time_homebuyer | newly_built_home
   * @param {Date|string} [inputs.asOfDate] - for provincial tax schedule lookup (defaults to today)
   * @returns {object}
   */
  function calculatePurchasePremium(inputs) {
    var purchasePrice = Number(inputs && inputs.purchasePrice);
    var downPayment = Number(inputs && inputs.downPayment);
    var amortizationYears = Number(inputs && inputs.amortizationYears);
    if (!Number.isFinite(amortizationYears) || amortizationYears <= 0) {
      amortizationYears = 25;
    }
    var province = (inputs && inputs.province) || "none";
    var nonTraditional = !!(inputs && inputs.nonTraditionalDownPayment);
    var financePremium = inputs && inputs.financePremium === false ? false : true;
    var thirtyYearEligibility =
      (inputs && inputs.thirtyYearEligibility) || "neither";
    var asOfDate = inputs && inputs.asOfDate;

    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
      return { error: "Purchase price must be positive.", errorCode: "invalid_purchase_price" };
    }
    if (!Number.isFinite(downPayment) || downPayment < 0) {
      return { error: "Down payment must be zero or greater.", errorCode: "invalid_down_payment" };
    }
    if (downPayment > purchasePrice + 1e-9) {
      return { error: "Down payment cannot exceed purchase price.", errorCode: "down_exceeds_price" };
    }

    var loanBeforePremium = purchasePrice - downPayment;
    if (loanBeforePremium <= 1e-9) {
      return {
        required: false,
        eligible: true,
        purchasePrice: purchasePrice,
        downPayment: downPayment,
        loanBeforePremium: 0,
        ltv: 0,
        premiumRate: 0,
        premiumAmount: 0,
        amortizationSurchargeRate: 0,
        provincialTaxRate: 0,
        provincialTaxAmount: 0,
        financedPremium: 0,
        upfrontPremiumCash: 0,
        upfrontTaxCash: 0,
        totalUpfrontInsuranceCash: 0,
        mortgagePrincipal: 0,
        sourceUrl: SOURCE_URL,
        purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      };
    }

    var ltv = loanBeforePremium / purchasePrice;
    var minDown = minimumDownPayment(purchasePrice);
    var highRatio = ltv > 0.8 + 1e-12;

    // CMHC: insured homeowner purchase price / lending value must be *below* $1,500,000.
    if (purchasePrice >= MAX_INSURABLE_PURCHASE_PRICE && highRatio) {
      return {
        error:
          "Purchase prices of $1.5 million or more are not eligible for high-ratio mortgage loan insurance under current CMHC purchase rules (lending value must be below $1,500,000). Use at least 20% down for an uninsured mortgage, or select None / Custom.",
        errorCode: "not_insurable_price",
        purchasePrice: purchasePrice,
        downPayment: downPayment,
        loanBeforePremium: loanBeforePremium,
        ltv: ltv,
        minimumDownPayment: minDown,
        sourceUrl: SOURCE_URL,
        purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      };
    }

    if (downPayment + 1e-6 < minDown) {
      return {
        error:
          "Down payment is below the Canadian minimum for this purchase price under current CMHC down-payment rules (generally 5% of the first $500,000 and 10% of the portion above $500,000 while the price is below $1.5 million).",
        errorCode: "below_minimum_down",
        purchasePrice: purchasePrice,
        downPayment: downPayment,
        loanBeforePremium: loanBeforePremium,
        ltv: ltv,
        minimumDownPayment: minDown,
        sourceUrl: SOURCE_URL,
        purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      };
    }

    // Uninsured conventional: LTV at or below 80%.
    if (!highRatio) {
      var taxMetaUninsured = resolveProvincialPremiumTax(province, asOfDate);
      return {
        required: false,
        eligible: true,
        purchasePrice: purchasePrice,
        downPayment: downPayment,
        loanBeforePremium: loanBeforePremium,
        ltv: ltv,
        premiumRate: 0,
        premiumAmount: 0,
        amortizationSurchargeRate: 0,
        provincialTaxRate: taxMetaUninsured.rate,
        provincialTaxAmount: 0,
        financedPremium: 0,
        upfrontPremiumCash: 0,
        upfrontTaxCash: 0,
        totalUpfrontInsuranceCash: 0,
        mortgagePrincipal: loanBeforePremium,
        minimumDownPayment: minDown,
        sourceUrl: SOURCE_URL,
        purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      };
    }

    if (ltv > MAX_LTV + 1e-12) {
      return {
        error: "Loan-to-value exceeds the typical maximum of 95% for insured homeowner loans.",
        errorCode: "ltv_too_high",
        purchasePrice: purchasePrice,
        downPayment: downPayment,
        loanBeforePremium: loanBeforePremium,
        ltv: ltv,
        minimumDownPayment: minDown,
        sourceUrl: SOURCE_URL,
        purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      };
    }

    var eligible30 = isEligibleFor30YearInsuredAmortization(thirtyYearEligibility);
    if (amortizationYears > HOME_START_MAX_AMORTIZATION_YEARS + 1e-9) {
      return {
        error:
          "Insured amortization cannot exceed 30 years under current CMHC Home Start rules.",
        errorCode: "amortization_exceeds_30",
        amortizationYears: amortizationYears,
        sourceUrl: SOURCE_URL,
        homeStartUrl: HOME_START_URL,
      };
    }
    if (
      amortizationYears > STANDARD_MAX_AMORTIZATION_YEARS + 1e-9 &&
      !eligible30
    ) {
      return {
        error:
          "A 30-year insured amortization requires eligibility under CMHC Home Start: at least one borrower is a first-time homebuyer, or the home is newly built and not previously occupied. Standard CMHC Purchase maximum amortization is 25 years. Select an eligibility option, shorten amortization to 25 years or less, or choose None / Custom.",
        errorCode: "amortization_requires_home_start",
        amortizationYears: amortizationYears,
        thirtyYearEligibility: thirtyYearEligibility,
        sourceUrl: SOURCE_URL,
        homeStartUrl: HOME_START_URL,
        purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      };
    }

    var baseRate = premiumRateForLtv(ltv, { nonTraditionalDownPayment: nonTraditional });
    if (baseRate == null) {
      return {
        error: "Could not determine a premium rate for this loan-to-value.",
        errorCode: "unknown_ltv_band",
        ltv: ltv,
        sourceUrl: SOURCE_URL,
      };
    }

    var surcharge =
      amortizationYears > STANDARD_MAX_AMORTIZATION_YEARS + 1e-9 && eligible30
        ? AMORTIZATION_SURCHARGE_BEYOND_25Y
        : 0;
    var premiumRate = baseRate + surcharge;
    var premiumAmount = loanBeforePremium * premiumRate;
    var taxMeta = resolveProvincialPremiumTax(province, asOfDate);
    var taxRate = taxMeta.rate;
    var taxAmount = premiumAmount * taxRate;

    var financedPremium = financePremium ? premiumAmount : 0;
    var upfrontPremiumCash = financePremium ? 0 : premiumAmount;
    var upfrontTaxCash = taxAmount;
    var mortgagePrincipal = loanBeforePremium + financedPremium;

    return {
      required: true,
      eligible: true,
      purchasePrice: purchasePrice,
      downPayment: downPayment,
      loanBeforePremium: loanBeforePremium,
      ltv: ltv,
      premiumRate: premiumRate,
      basePremiumRate: baseRate,
      amortizationSurchargeRate: surcharge,
      premiumAmount: premiumAmount,
      provincialTaxRate: taxRate,
      provincialTaxAmount: taxAmount,
      provincialTaxEffectiveFrom: taxMeta.effectiveFrom,
      provincialTaxSourceUrl: taxMeta.sourceUrl,
      financedPremium: financedPremium,
      upfrontPremiumCash: upfrontPremiumCash,
      upfrontTaxCash: upfrontTaxCash,
      totalUpfrontInsuranceCash: upfrontPremiumCash + upfrontTaxCash,
      mortgagePrincipal: mortgagePrincipal,
      minimumDownPayment: minDown,
      financePremium: financePremium,
      province: province,
      nonTraditionalDownPayment: nonTraditional,
      thirtyYearEligibility: thirtyYearEligibility,
      sourceUrl: SOURCE_URL,
      purchaseEligibilityUrl: PURCHASE_ELIGIBILITY_URL,
      homeStartUrl: HOME_START_URL,
    };
  }

  // Keep PROVINCIAL_PREMIUM_TAX in sync with schedule-as-of-today for any legacy readers.
  PROVINCIAL_PREMIUM_TAX.none = provincialPremiumTaxRate("none");
  PROVINCIAL_PREMIUM_TAX.ON = provincialPremiumTaxRate("ON");
  PROVINCIAL_PREMIUM_TAX.QC = provincialPremiumTaxRate("QC");
  PROVINCIAL_PREMIUM_TAX.SK = provincialPremiumTaxRate("SK");

  g.CanadaMortgageLoanInsurance = {
    SOURCE_URL: SOURCE_URL,
    PURCHASE_ELIGIBILITY_URL: PURCHASE_ELIGIBILITY_URL,
    HOME_START_URL: HOME_START_URL,
    HOMEOWNER_PREMIUM_BANDS: HOMEOWNER_PREMIUM_BANDS,
    PROVINCIAL_PREMIUM_TAX: PROVINCIAL_PREMIUM_TAX,
    PROVINCIAL_PREMIUM_TAX_SCHEDULE: PROVINCIAL_PREMIUM_TAX_SCHEDULE,
    MAX_INSURABLE_PURCHASE_PRICE: MAX_INSURABLE_PURCHASE_PRICE,
    MAX_LTV: MAX_LTV,
    STANDARD_MAX_AMORTIZATION_YEARS: STANDARD_MAX_AMORTIZATION_YEARS,
    HOME_START_MAX_AMORTIZATION_YEARS: HOME_START_MAX_AMORTIZATION_YEARS,
    AMORTIZATION_SURCHARGE_BEYOND_25Y: AMORTIZATION_SURCHARGE_BEYOND_25Y,
    minimumDownPayment: minimumDownPayment,
    premiumRateForLtv: premiumRateForLtv,
    provincialPremiumTaxRate: provincialPremiumTaxRate,
    resolveProvincialPremiumTax: resolveProvincialPremiumTax,
    isEligibleFor30YearInsuredAmortization: isEligibleFor30YearInsuredAmortization,
    calculatePurchasePremium: calculatePurchasePremium,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
