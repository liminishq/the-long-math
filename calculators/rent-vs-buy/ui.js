// ui.js — Rent vs. Buy: progressive-disclosure UI over RentVsBuyEngine (math unchanged).

(function () {
  "use strict";

  var MAX_OTHER_EXPENSES = 6;
  var DEFAULTS = {
    propertyTax: 4000,
    propertyTaxUseInf: true,
    maintenance: 5000,
    homeInsurance: 1500,
    condoFees: 0,
    ownerUtilities: 250,
    ownerUtilUseInf: true,
    closingCosts: 5000,
    sellingCostPct: 5,
    sellingCostFixed: 0,
    insuranceMode: "automatic_canadian",
    insuranceProvince: "none",
    financePremium: true,
    thirtyYearEligibility: "neither",
    tenantInsurance: 300,
    renterUtilities: 100,
    renterUtilUseInf: true,
    investCfDiff: true,
    apprMode: "nominal",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function num(x) {
    if (x == null) return NaN;
    var s = String(x).trim().replace(/,/g, "");
    if (s === "") return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function pctToDec(pct) {
    var n = num(pct);
    return Number.isFinite(n) ? n / 100 : NaN;
  }

  function fmtMoney(n) {
    if (!Number.isFinite(n)) return "$—";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function fmtPct(dec, digits) {
    if (!Number.isFinite(dec)) return "—";
    var d = digits == null ? 1 : digits;
    return (dec * 100).toFixed(d) + "%";
  }

  function fmtYears(y) {
    if (!Number.isFinite(y)) return "—";
    return (Math.round(y * 10) / 10).toFixed(1);
  }

  function whoLabel(who) {
    if (who === "buyer") return "Buying";
    if (who === "renter") return "Renting";
    return "Tied";
  }

  function whoChipClass(who) {
    if (who === "buyer") return "lead-chip lead-chip--buy";
    if (who === "renter") return "lead-chip lead-chip--rent";
    return "lead-chip";
  }

  function investmentGrowth(start, contribCum, account) {
    return account - start - contribCum;
  }

  /**
   * Detect first lasting switch of monthly cash-flow advantage.
   * cashFlowDiff = ownerCash − renterCash; positive → renting has lower cash requirement.
   */
  function detectCashFlowAdvantageSwitch(series) {
    if (!series || !series.length) return null;
    function signOf(d) {
      if (d > 1e-6) return 1; // renter advantage
      if (d < -1e-6) return -1; // buyer advantage
      return 0;
    }
    var startSign = 0;
    var i;
    for (i = 1; i < series.length; i += 1) {
      startSign = signOf(series[i].cashFlowDiff);
      if (startSign !== 0) break;
    }
    if (startSign === 0) return null;
    for (; i < series.length; i += 1) {
      var s = signOf(series[i].cashFlowDiff);
      if (s !== 0 && s !== startSign) {
        return {
          from: startSign > 0 ? "renter" : "buyer",
          to: s > 0 ? "renter" : "buyer",
          month: series[i].month,
          years: series[i].month / 12,
        };
      }
    }
    return null;
  }

  /** Pure helpers exported for tests */
  function insuranceVisibility(state) {
    var mode = state.mode || "automatic_canadian";
    var downPct = Number(state.downPaymentPercent);
    var amort = Number(state.amortizationYears);
    var premiumExists = !!state.premiumExists;
    var ltvAbove80 = Number.isFinite(downPct) ? downPct < 20 : false;

    var showCanadianBlock = mode === "automatic_canadian" && ltvAbove80;
    var showNotRequired =
      mode === "automatic_canadian" && Number.isFinite(downPct) && downPct >= 20;
    var showCustom = mode === "custom";
    var showProvince = showCanadianBlock;
    var showThirtyYear = showCanadianBlock && Number.isFinite(amort) && amort > 25;
    // Finance checkbox is for Automatic Canadian only; custom financing is its own field.
    var showFinance = false;
    if (mode === "automatic_canadian" && ltvAbove80) {
      if (premiumExists === false) showFinance = false;
      else showFinance = true; // true or unknown (pre-calc heuristic)
    }

    return {
      showCanadianBlock: showCanadianBlock,
      showNotRequired: showNotRequired,
      showCustom: showCustom,
      showProvince: showProvince,
      showThirtyYear: showThirtyYear,
      showFinance: showFinance,
      ltvAbove80: ltvAbove80,
    };
  }

  function defaultChartHorizonYears(comparisonYear) {
    var y = Number(comparisonYear);
    if (!Number.isFinite(y) || y <= 0) return 60;
    if (y <= 10) return 10;
    if (y <= 25) return 25;
    return 60;
  }

  function breakEvenHomeTitle(mode) {
    return mode === "real_linked"
      ? "Break-even real home appreciation above inflation"
      : "Break-even nominal home appreciation";
  }

  function sortSnapshotsChronologically(snaps) {
    return (snaps || []).slice().sort(function (a, b) {
      return a.month - b.month;
    });
  }

  function readOtherExpenses(containerId) {
    var root = $(containerId);
    if (!root) return [];
    var rows = root.querySelectorAll(".other-expense-row");
    var out = [];
    rows.forEach(function (row) {
      var desc = row.querySelector('[data-field="desc"]');
      var amount = row.querySelector('[data-field="amount"]');
      var freq = row.querySelector('[data-field="freq"]');
      out.push({
        description: desc ? desc.value : "",
        amount: num(amount && amount.value),
        frequency: freq ? freq.value : "monthly",
      });
    });
    return out;
  }

  function addOtherExpenseRow(containerId, prefix, initial) {
    var root = $(containerId);
    if (!root) return null;
    if (root.querySelectorAll(".other-expense-row").length >= MAX_OTHER_EXPENSES) return null;
    var wrap = document.createElement("div");
    wrap.className = "other-expense-row";
    var descVal = (initial && initial.description) || "";
    var amtVal =
      initial && Number.isFinite(initial.amount) ? String(initial.amount) : "";
    var freqVal = (initial && initial.frequency) || "monthly";
    wrap.innerHTML =
      '<input data-field="desc" type="text" placeholder="Description" aria-label="Other ' +
      prefix +
      ' expense description" value="' +
      descVal.replace(/"/g, "&quot;") +
      '" />' +
      '<input data-field="amount" type="number" inputmode="decimal" min="0" step="any" value="' +
      amtVal +
      '" aria-label="Other ' +
      prefix +
      ' expense amount" placeholder="Amount" />' +
      '<select data-field="freq" aria-label="Other ' +
      prefix +
      ' expense frequency">' +
      '<option value="monthly"' +
      (freqVal === "monthly" ? " selected" : "") +
      ">Monthly</option>" +
      '<option value="annual"' +
      (freqVal === "annual" ? " selected" : "") +
      ">Annual</option>" +
      "</select>" +
      '<button type="button" class="remove-expense" aria-label="Remove expense">×</button>';
    root.appendChild(wrap);
    return wrap;
  }

  function downPaymentDollars() {
    var price = num($("purchase_price").value);
    if ($("down_use_pct").checked) {
      var pct = num($("down_pct").value);
      if (!Number.isFinite(price) || !Number.isFinite(pct)) return NaN;
      return price * (pct / 100);
    }
    return num($("down_payment").value);
  }

  function downPaymentPercent() {
    var price = num($("purchase_price").value);
    var down = downPaymentDollars();
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(down)) return NaN;
    return (down / price) * 100;
  }

  function syncDownPaymentFields() {
    var usePct = $("down_use_pct").checked;
    $("down_amount_wrap").classList.toggle("hidden", usePct);
    $("down_pct_wrap").classList.toggle("hidden", !usePct);
    var price = num($("purchase_price").value);
    if (!Number.isFinite(price) || price <= 0) return;
    if (usePct) {
      var amt = num($("down_payment").value);
      if (Number.isFinite(amt)) {
        $("down_pct").value = String(Math.round((amt / price) * 10000) / 100);
      }
    } else {
      var pct = num($("down_pct").value);
      if (Number.isFinite(pct)) {
        $("down_payment").value = String(Math.round(price * (pct / 100) * 100) / 100);
      }
    }
  }

  function gatherInputs() {
    var apprMode = document.querySelector('input[name="appr_mode"]:checked');
    return {
      purchasePrice: num($("purchase_price").value),
      downPayment: downPaymentDollars(),
      startingCapital: num($("starting_capital").value),
      closingCosts: num($("closing_costs").value),
      mortgageRatePct: num($("mortgage_rate").value),
      amortizationYears: num($("amortization_years").value),
      mortgageInsuranceMode: $("insurance_mode").value,
      insuranceProvince: $("insurance_province").value,
      financeInsurancePremium: $("finance_premium").checked,
      thirtyYearEligibility: $("thirty_year_eligibility").value,
      customInsuranceUpfront: num($("custom_ins_upfront").value),
      customInsuranceFinanced: num($("custom_ins_financed").value),
      customInsuranceMonthly: num($("custom_ins_monthly").value),
      customInsuranceMonthlyDurationMonths: (function () {
        var el = $("custom_ins_monthly_duration");
        if (!el) return null;
        var raw = String(el.value || "").trim();
        if (raw === "") return null;
        return num(raw);
      })(),
      sellingCostPercent: pctToDec($("selling_cost_pct").value),
      sellingCostFixed: num($("selling_cost_fixed").value),
      propertyTaxAnnual: num($("property_tax").value),
      propertyTaxUseInflation: $("property_tax_use_inf").checked,
      propertyTaxGrowthAnnual: pctToDec($("property_tax_growth").value),
      maintenanceAnnual: num($("maintenance").value),
      homeInsuranceAnnual: num($("home_insurance").value),
      condoFeesMonthly: num($("condo_fees").value),
      ownerUtilitiesMonthly: num($("owner_utilities").value),
      ownerUtilitiesUseInflation: $("owner_util_use_inf").checked,
      ownerUtilitiesGrowthAnnual: pctToDec($("owner_util_growth").value),
      ownerOtherExpenses: readOtherExpenses("owner_other_rows"),
      monthlyRent: num($("monthly_rent").value),
      rentGrowthAnnual: pctToDec($("rent_growth").value),
      tenantInsuranceAnnual: num($("tenant_insurance").value),
      renterUtilitiesMonthly: num($("renter_utilities").value),
      renterUtilitiesUseInflation: $("renter_util_use_inf").checked,
      renterUtilitiesGrowthAnnual: pctToDec($("renter_util_growth").value),
      renterOtherExpenses: readOtherExpenses("renter_other_rows"),
      renterUpfrontCosts: (function () {
        var el = $("renter_upfront");
        if (!el) return 0;
        var v = num(el.value);
        return Number.isFinite(v) ? Math.max(0, v) : 0;
      })(),
      investmentReturnAnnual: pctToDec($("investment_return").value),
      investCashFlowDifference: $("invest_cf_diff").checked,
      inflationAnnual: pctToDec($("inflation").value),
      homeAppreciationMode: apprMode ? apprMode.value : "nominal",
      homeAppreciationAnnual: pctToDec($("home_appreciation").value),
      realHomeAppreciationAnnual: pctToDec($("real_home_appreciation").value),
      comparisonYear: num($("comparison_year").value),
    };
  }

  function displayIsReal() {
    var el = document.querySelector('input[name="display_basis"]:checked');
    return el && el.value === "real";
  }

  function valueForDisplay(point, key, result) {
    if (!displayIsReal()) return point[key];
    var real = result.toRealPoint(point);
    return real[key];
  }

  /**
   * Selected-year balance sheet in the active display basis.
   * Equity + investments = NW (full precision). Display rounding is applied by callers.
   * Nominal cash-accounting history is returned separately and must not be mixed into
   * the real-dollar balance sheet.
   */
  function selectedYearBalanceSheet(result, isReal) {
    var cmp = result.comparisonPoint;
    var point = isReal ? result.toRealPoint(cmp) : cmp;
    var buyGrowthNom = investmentGrowth(
      result.buyerStartInvested,
      cmp.buyerContribCumulative,
      cmp.buyerInvestments
    );
    var rentGrowthNom = investmentGrowth(
      result.renterStartInvested,
      cmp.renterContribCumulative,
      cmp.renterInvestments
    );
    return {
      isReal: !!isReal,
      buyer: {
        homeValue: point.homeValue,
        mortgageBalance: point.mortgageBalance,
        sellingCosts: point.sellingCosts,
        netRealizableEquity: point.netRealizableEquity,
        investmentAccount: point.buyerInvestments,
        totalNetWorth: point.buyerNetWorth,
      },
      renter: {
        investmentAccount: point.renterInvestments,
        totalNetWorth: point.renterNetWorth,
      },
      difference: point.difference,
      ownerCash: point.ownerCash,
      renterCash: point.renterCash,
      nominalHistory: {
        buyer: {
          startingInvested: result.buyerStartInvested,
          contribCumulative: cmp.buyerContribCumulative,
          earnings: buyGrowthNom,
          investmentAccount: cmp.buyerInvestments,
        },
        renter: {
          startingInvested: result.renterStartInvested,
          contribCumulative: cmp.renterContribCumulative,
          earnings: rentGrowthNom,
          investmentAccount: cmp.renterInvestments,
        },
      },
    };
  }

  /** Display-rounded reconciliation check for Today's-dollars mode. */
  function realBalanceSheetReconciles(sheet, roundFn) {
    var round = roundFn || function (n) {
      return Math.round(n);
    };
    var buyEquity = round(sheet.buyer.netRealizableEquity);
    var buyInv = round(sheet.buyer.investmentAccount);
    var buyNw = round(sheet.buyer.totalNetWorth);
    var rentInv = round(sheet.renter.investmentAccount);
    var rentNw = round(sheet.renter.totalNetWorth);
    return {
      // Display rounding may leave a $1 residual between rounded parts and rounded total.
      buyerOk: Math.abs(buyEquity + buyInv - buyNw) <= 1,
      renterOk: Math.abs(rentInv - rentNw) <= 1,
      buyerEquity: buyEquity,
      buyerInvestments: buyInv,
      buyerNetWorth: buyNw,
      renterInvestments: rentInv,
      renterNetWorth: rentNw,
    };
  }

  function updateMaintenanceEstimate() {
    var el = $("maintenance_estimate");
    var btn = $("maintenance_helper_btn");
    if (!el || !window.RentVsBuyEngine) return;
    var price = num($("purchase_price").value);
    if (!Number.isFinite(price) || price <= 0) {
      el.textContent = "";
      if (btn) btn.classList.add("hidden");
      return;
    }
    var est = window.RentVsBuyEngine.maintenanceHelperOnePercent(price);
    el.innerHTML =
      "1% of this home’s starting value = <strong>" +
      fmtMoney(est) +
      "/year</strong>";
    if (btn) {
      btn.classList.remove("hidden");
      btn.textContent = "Use " + fmtMoney(est);
      btn.dataset.estimate = String(est);
    }
  }

  function updateInsuranceUi(result) {
    var mode = $("insurance_mode").value;
    var premiumExists = null;
    if (result && result.insurance) {
      var ins = result.insurance;
      if (ins.mode === "automatic_canadian" && ins.detail) {
        premiumExists = !!(ins.detail.required && ins.detail.premiumAmount > 0);
      } else if (ins.mode === "custom") {
        premiumExists = (ins.financedPremium || 0) > 0 || num($("custom_ins_financed").value) > 0;
      } else {
        premiumExists = false;
      }
    }

    var vis = insuranceVisibility({
      mode: mode,
      downPaymentPercent: downPaymentPercent(),
      amortizationYears: num($("amortization_years").value),
      premiumExists: premiumExists,
      customFinanced: num($("custom_ins_financed").value),
    });

    var notReq = $("insurance_not_required");
    if (notReq) {
      notReq.classList.toggle("hidden", !vis.showNotRequired);
      if (vis.showNotRequired) {
        notReq.innerHTML =
          "<strong>Mortgage insurance: Not required</strong> under the selected Canadian assumptions.";
      }
    }

    $("insurance_canadian_wrap").classList.toggle("hidden", !vis.showCanadianBlock);
    $("insurance_custom_wrap").classList.toggle("hidden", !vis.showCustom);

    var prov = $("insurance_province_wrap");
    if (prov) prov.classList.toggle("hidden", !vis.showProvince);
    var ty = $("thirty_year_eligibility_wrap");
    if (ty) ty.classList.toggle("hidden", !vis.showThirtyYear);
    var fin = $("finance_premium_wrap");
    if (fin) fin.classList.toggle("hidden", !vis.showFinance);

    // Mode none: hide everything insurance-related except mode selector
    if (mode === "none") {
      if (notReq) notReq.classList.add("hidden");
      $("insurance_canadian_wrap").classList.add("hidden");
      $("insurance_custom_wrap").classList.add("hidden");
    }
  }

  function updateGrowthToggles() {
    $("property_tax_growth_wrap").classList.toggle("hidden", $("property_tax_use_inf").checked);
    $("owner_util_growth_wrap").classList.toggle("hidden", $("owner_util_use_inf").checked);
    $("renter_util_growth_wrap").classList.toggle("hidden", $("renter_util_use_inf").checked);
    var realLinked =
      document.querySelector('input[name="appr_mode"]:checked') &&
      document.querySelector('input[name="appr_mode"]:checked').value === "real_linked";
    $("home_appr_nominal_wrap").classList.toggle("hidden", realLinked);
    $("home_appr_real_wrap").classList.toggle("hidden", !realLinked);
  }

  function nearly(a, b, eps) {
    return Math.abs(Number(a) - Number(b)) < (eps == null ? 1e-9 : eps);
  }

  function countOwnershipCustomizations() {
    var n = 0;
    if (!nearly(num($("property_tax").value), DEFAULTS.propertyTax)) n += 1;
    if ($("property_tax_use_inf").checked !== DEFAULTS.propertyTaxUseInf) n += 1;
    if (
      !$("property_tax_use_inf").checked &&
      !nearly(num($("property_tax_growth").value), 2)
    ) {
      n += 1;
    }
    if (!nearly(num($("maintenance").value), DEFAULTS.maintenance)) n += 1;
    if (!nearly(num($("home_insurance").value), DEFAULTS.homeInsurance)) n += 1;
    if (!nearly(num($("condo_fees").value), DEFAULTS.condoFees)) n += 1;
    if (!nearly(num($("owner_utilities").value), DEFAULTS.ownerUtilities)) n += 1;
    if ($("owner_util_use_inf").checked !== DEFAULTS.ownerUtilUseInf) n += 1;
    if (
      !$("owner_util_use_inf").checked &&
      !nearly(num($("owner_util_growth").value), 2)
    ) {
      n += 1;
    }
    if (!nearly(num($("closing_costs").value), DEFAULTS.closingCosts)) n += 1;
    if (!nearly(num($("selling_cost_pct").value), DEFAULTS.sellingCostPct)) n += 1;
    if (!nearly(num($("selling_cost_fixed").value), DEFAULTS.sellingCostFixed)) n += 1;
    if ($("insurance_mode").value !== DEFAULTS.insuranceMode) n += 1;
    if (
      $("insurance_mode").value === "automatic_canadian" &&
      $("insurance_province").value !== DEFAULTS.insuranceProvince
    ) {
      n += 1;
    }
    if (
      $("insurance_mode").value === "automatic_canadian" &&
      $("finance_premium").checked !== DEFAULTS.financePremium
    ) {
      n += 1;
    }
    if (
      $("insurance_mode").value === "automatic_canadian" &&
      $("thirty_year_eligibility").value !== DEFAULTS.thirtyYearEligibility
    ) {
      n += 1;
    }
    if ($("insurance_mode").value === "custom") {
      if (!nearly(num($("custom_ins_upfront").value), 0)) n += 1;
      if (!nearly(num($("custom_ins_financed").value), 0)) n += 1;
      if (!nearly(num($("custom_ins_monthly").value), 0)) n += 1;
      if (String($("custom_ins_monthly_duration").value || "").trim() !== "") n += 1;
    }
    n += $("owner_other_rows").querySelectorAll(".other-expense-row").length;
    return n;
  }

  function countRentalCustomizations() {
    var n = 0;
    if (!nearly(num($("tenant_insurance").value), DEFAULTS.tenantInsurance)) n += 1;
    if (!nearly(num($("renter_utilities").value), DEFAULTS.renterUtilities)) n += 1;
    if ($("renter_util_use_inf").checked !== DEFAULTS.renterUtilUseInf) n += 1;
    if (
      !$("renter_util_use_inf").checked &&
      !nearly(num($("renter_util_growth").value), 2)
    ) {
      n += 1;
    }
    if ($("renter_upfront") && !nearly(num($("renter_upfront").value), 0)) n += 1;
    n += $("renter_other_rows").querySelectorAll(".other-expense-row").length;
    return n;
  }

  function countAdvancedCustomizations() {
    var n = 0;
    var appr = document.querySelector('input[name="appr_mode"]:checked');
    if (appr && appr.value !== DEFAULTS.apprMode) n += 1;
    if ($("invest_cf_diff").checked !== DEFAULTS.investCfDiff) n += 1;
    return n;
  }

  function fmtCompactMoney(n) {
    if (!Number.isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function ownershipActiveSummary() {
    var tax = num($("property_tax") && $("property_tax").value);
    var upkeep = num($("maintenance") && $("maintenance").value);
    var ins = num($("home_insurance") && $("home_insurance").value);
    var util = num($("owner_utilities") && $("owner_utilities").value);
    var sale = num($("selling_cost_pct") && $("selling_cost_pct").value);
    var parts = [];
    if (Number.isFinite(tax)) parts.push("Tax " + fmtCompactMoney(tax) + "/yr");
    if (Number.isFinite(upkeep)) parts.push("Upkeep " + fmtCompactMoney(upkeep) + "/yr");
    if (Number.isFinite(ins)) parts.push("Insurance " + fmtCompactMoney(ins) + "/yr");
    if (Number.isFinite(util)) parts.push("Utilities " + fmtCompactMoney(util) + "/mo");
    if (Number.isFinite(sale)) parts.push("Sale " + sale + "%");
    return parts.join(" · ");
  }

  function rentalActiveSummary() {
    var ins = num($("tenant_insurance") && $("tenant_insurance").value);
    var util = num($("renter_utilities") && $("renter_utilities").value);
    var upfront = $("renter_upfront") ? num($("renter_upfront").value) : 0;
    if (!Number.isFinite(upfront)) upfront = 0;
    var parts = [];
    if (Number.isFinite(ins)) parts.push("Insurance " + fmtCompactMoney(ins) + "/yr");
    if (Number.isFinite(util)) parts.push("Utilities " + fmtCompactMoney(util) + "/mo");
    parts.push("Upfront " + fmtCompactMoney(upfront));
    return parts.join(" · ");
  }

  function updateRefineSummaries() {
    var own = $("ownership_summary");
    var rent = $("rental_summary");
    if (own) own.textContent = ownershipActiveSummary();
    if (rent) rent.textContent = rentalActiveSummary();
  }

  function updateRefineBadges() {
    function setBadge(id, count) {
      var el = $(id);
      if (!el) return;
      if (count > 0) {
        el.classList.remove("hidden");
        el.textContent =
          count + " customized assumption" + (count === 1 ? "" : "s");
      } else {
        el.classList.add("hidden");
        el.textContent = "";
      }
    }
    setBadge("ownership_badge", countOwnershipCustomizations());
    setBadge("rental_badge", countRentalCustomizations());
    setBadge("advanced_badge", countAdvancedCustomizations());
    updateRefineSummaries();
  }

  /**
   * Restore scenario from shareable URL query params (field id → value).
   * Matches the generic site.js collector. Other-expense rows have no ids and are
   * intentionally excluded from V1 share state.
   */
  function applySharedScenarioFromQuery(search) {
    var qs = search == null ? (typeof location !== "undefined" ? location.search : "") : search;
    if (!qs || qs === "?") return { applied: false, keys: [] };
    var params;
    try {
      params = new URLSearchParams(qs.charAt(0) === "?" ? qs : "?" + qs);
    } catch (e) {
      return { applied: false, keys: [] };
    }
    var appliedKeys = [];
    var FINANCIAL_IDS = {
      starting_capital: 1,
      purchase_price: 1,
      down_payment: 1,
      down_pct: 1,
      down_use_pct: 1,
      mortgage_rate: 1,
      amortization_years: 1,
      monthly_rent: 1,
      home_appreciation: 1,
      real_home_appreciation: 1,
      rent_growth: 1,
      investment_return: 1,
      inflation: 1,
      comparison_year: 1,
      property_tax: 1,
      property_tax_use_inf: 1,
      property_tax_growth: 1,
      maintenance: 1,
      home_insurance: 1,
      condo_fees: 1,
      owner_utilities: 1,
      owner_util_use_inf: 1,
      owner_util_growth: 1,
      closing_costs: 1,
      selling_cost_pct: 1,
      selling_cost_fixed: 1,
      insurance_mode: 1,
      insurance_province: 1,
      finance_premium: 1,
      thirty_year_eligibility: 1,
      custom_ins_upfront: 1,
      custom_ins_financed: 1,
      custom_ins_monthly: 1,
      custom_ins_monthly_duration: 1,
      renter_upfront: 1,
      tenant_insurance: 1,
      renter_utilities: 1,
      renter_util_use_inf: 1,
      renter_util_growth: 1,
      invest_cf_diff: 1,
      appr_nominal: 1,
      appr_real: 1,
      display_real: 1,
      display_nominal: 1,
    };

    params.forEach(function (val, key) {
      if (!FINANCIAL_IDS[key]) return;
      var el = $(key);
      if (!el) return;
      var type = (el.type || "").toLowerCase();
      var tag = (el.tagName || "").toLowerCase();
      if (type === "checkbox") {
        el.checked = val === "1" || val === "true";
      } else if (type === "radio") {
        if (val === "1" || val === "true") {
          el.checked = true;
        }
      } else if (tag === "select" || type === "number" || type === "text" || type === "" || !type) {
        el.value = val;
      } else {
        el.value = val;
      }
      appliedKeys.push(key);
    });

    if (appliedKeys.length) {
      syncDownPaymentFields();
      updateGrowthToggles();
    }
    return { applied: appliedKeys.length > 0, keys: appliedKeys };
  }

  function updateCapitalReadout(inputs, insuranceDetail) {
    var el = $("capital_readout");
    if (!el) return;
    var down = inputs.downPayment;
    var close = inputs.closingCosts || 0;
    var upfrontIns = 0;
    if (insuranceDetail && Number.isFinite(insuranceDetail.totalUpfrontInsuranceCash)) {
      upfrontIns = insuranceDetail.totalUpfrontInsuranceCash;
    } else if (inputs.mortgageInsuranceMode === "custom") {
      upfrontIns = Math.max(0, inputs.customInsuranceUpfront || 0);
    }
    var deployed = down + close + upfrontIns;
    var remaining = (inputs.startingCapital || 0) - deployed;
    el.textContent =
      "Buyer upfront: " +
      fmtMoney(deployed) +
      " (down " +
      fmtMoney(down) +
      " + closing " +
      fmtMoney(close) +
      (upfrontIns > 0 ? " + insurance cash " + fmtMoney(upfrontIns) : "") +
      "). Remaining investable: " +
      fmtMoney(remaining) +
      ".";
    var renterUp = Math.max(0, inputs.renterUpfrontCosts || 0);
    if (renterUp > 0) {
      el.textContent +=
        " Renter upfront costs " +
        fmtMoney(renterUp) +
        "; renter starting investable " +
        fmtMoney(Math.max(0, (inputs.startingCapital || 0) - renterUp)) +
        ".";
    }
  }

  function updateInsuranceReadout(result) {
    var el = $("insurance_readout");
    if (!el) return;
    var ins = result && result.insurance;
    if (!ins || ins.mode === "none") {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    if (ins.mode === "automatic_canadian" && ins.detail && !ins.detail.required) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    if (ins.mode === "automatic_canadian" && ins.detail) {
      var d = ins.detail;
      el.textContent =
        "Premium rate " +
        fmtPct(d.premiumRate, 2) +
        " on loan " +
        fmtMoney(d.loanBeforePremium) +
        " → premium " +
        fmtMoney(d.premiumAmount) +
        (d.provincialTaxAmount > 0
          ? "; provincial tax on premium " + fmtMoney(d.provincialTaxAmount) + " (cash, not financed)"
          : "") +
        "; mortgage principal " +
        fmtMoney(d.mortgagePrincipal) +
        ".";
      return;
    }
    if (ins.mode === "custom") {
      el.textContent =
        "Custom insurance — upfront " +
        fmtMoney(ins.upfrontInsuranceCash) +
        ", financed " +
        fmtMoney(ins.financedPremium) +
        ", monthly " +
        fmtMoney(ins.recurringMonthlyInsurance) +
        ".";
    }
  }

  function fillMoneyDl(dl, rows) {
    if (!dl) return;
    dl.innerHTML = "";
    rows.forEach(function (row) {
      var div = document.createElement("div");
      if (row.divider) {
        div.className = "is-divider";
        div.setAttribute("aria-hidden", "true");
        dl.appendChild(div);
        return;
      }
      var classes = [];
      if (row.emphasis) classes.push("is-emphasis");
      if (row.indent) classes.push("is-indent");
      if (row.equals) classes.push("is-equals");
      if (row.groupStart) classes.push("is-group-start");
      if (classes.length) div.className = classes.join(" ");
      div.innerHTML = "<dt>" + row[0] + "</dt><dd>" + row[1] + "</dd>";
      dl.appendChild(div);
    });
  }

  function renderLeadTimeline(result) {
    var timeline = $("lead_timeline");
    var sentence = $("lead_sentence");
    if (!timeline || !sentence) return;
    timeline.innerHTML = "";
    sentence.textContent = "";

    var c = result.crossover;
    if (!c) return;
    var flips = (c.flips || []).filter(function (f) {
      return f.to === "buyer" || f.to === "renter";
    });

    function chipHtml(who) {
      return (
        '<span class="' +
        whoChipClass(who) +
        '">' +
        whoLabel(who) +
        " ahead</span>"
      );
    }

    function appendSingleFlip(fromWho, years, toWho) {
      var row = document.createElement("div");
      row.className = "lead-timeline-row";
      row.innerHTML =
        chipHtml(fromWho) +
        '<div class="lead-track" aria-hidden="true">' +
        '<span class="lead-track-line"></span>' +
        '<span class="lead-track-dot"></span>' +
        '<span class="lead-track-line"></span>' +
        "</div>" +
        '<div class="lead-year">' +
        fmtYears(years) +
        " years</div>" +
        chipHtml(toWho);
      timeline.appendChild(row);
    }

    if (c.kind === "always_tied") {
      timeline.innerHTML = '<span class="lead-chip">Approximately tied throughout</span>';
      sentence.textContent = "";
      return;
    }

    if (flips.length === 0) {
      var who =
        c.startLead === "tie"
          ? c.endLead === "tie"
            ? "buyer"
            : c.endLead
          : c.startLead;
      timeline.innerHTML = chipHtml(who);
      // Chip already states who is ahead; omit redundant “remains ahead throughout” prose.
      sentence.textContent = "";
      return;
    }

    if (flips.length === 1) {
      var startWho = c.startLead === "tie" ? flips[0].from : c.startLead;
      appendSingleFlip(startWho, flips[0].years, flips[0].to);
      sentence.textContent = "";
      return;
    }

    var multi = document.createElement("div");
    multi.className = "lead-multi";
    var startMulti = c.startLead === "tie" ? flips[0].from : c.startLead;
    multi.innerHTML = chipHtml(startMulti);
    flips.forEach(function (f) {
      var arrow = document.createElement("span");
      arrow.className = "lead-arrow";
      arrow.textContent = "→";
      multi.appendChild(arrow);
      var yr = document.createElement("span");
      yr.className = "lead-year";
      yr.textContent = fmtYears(f.years) + "y";
      multi.appendChild(yr);
      var arrow2 = document.createElement("span");
      arrow2.className = "lead-arrow";
      arrow2.textContent = "→";
      multi.appendChild(arrow2);
      var chip = document.createElement("span");
      chip.className = whoChipClass(f.to);
      chip.textContent = whoLabel(f.to) + " ahead";
      multi.appendChild(chip);
    });
    timeline.appendChild(multi);
    sentence.textContent = "";
  }

  function renderCrossoverLabels(result) {
    var list = $("crossover_labels");
    if (!list) return;
    list.innerHTML = "";
    var flips = (result.crossover && result.crossover.flips) || [];
    flips.forEach(function (f) {
      if (f.to !== "buyer" && f.to !== "renter") return;
      var li = document.createElement("li");
      var from = f.from === "buyer" ? "Buying" : "Renting";
      var to = f.to === "buyer" ? "Buying" : "Renting";
      li.textContent = from + " → " + to + " · " + fmtYears(f.years) + " years";
      list.appendChild(li);
    });
  }

  class NetWorthChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.data = null;
      this.horizonYears = 30;
      this.resize();
      window.addEventListener("resize", this.resize.bind(this));
    }

    setHorizonYears(y) {
      this.horizonYears = y;
      if (this.data) this.draw();
    }

    resize() {
      if (!this.canvas) return;
      var rect = this.canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, rect.width * dpr);
      this.canvas.height = Math.max(1, rect.height * dpr);
      this.ctx = this.canvas.getContext("2d");
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.data) this.draw();
    }

    setData(series, crossovers, isReal, inflation) {
      this.data = {
        series: series,
        crossovers: crossovers || [],
        isReal: isReal,
        inflation: inflation,
      };
      this.draw();
    }

    niceMax(v) {
      if (!(v > 0)) return 100000;
      var exp = Math.pow(10, Math.floor(Math.log10(v)));
      var n = v / exp;
      var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
      return nice * exp;
    }

    niceFloor(v) {
      if (!(v > 0)) return 0;
      var exp = Math.pow(10, Math.floor(Math.log10(v)));
      var n = v / exp;
      var nice = n >= 5 ? 5 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
      if (nice === 0) return 0;
      return Math.floor(n / nice) * nice * exp;
    }

    niceCeil(v) {
      if (!(v > 0)) return this.niceMax(1);
      var exp = Math.pow(10, Math.floor(Math.log10(v)));
      var n = v / exp;
      var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
      return Math.ceil(n / step) * step * exp;
    }

    /** Axis bounds for the visible series only, with ~10% headroom. */
    axisBounds(minY, maxY) {
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
        return { yMin: 0, yMax: 100000 };
      }
      if (maxY < minY) {
        var swap = maxY;
        maxY = minY;
        minY = swap;
      }
      var span = maxY - minY;
      var pad = Math.max(span * 0.1, Math.abs(maxY) * 0.05, Math.abs(minY) * 0.05, 1);
      var lo = minY - pad;
      var hi = maxY + pad;
      var yMin;
      var yMax;
      if (lo >= 0) {
        yMin = this.niceFloor(lo);
        // Keep a little space under the series when the floor would pin too tightly.
        if (yMin > minY - pad * 0.25) {
          yMin = Math.max(0, this.niceFloor(minY * 0.9));
        }
        yMax = this.niceCeil(hi);
      } else if (hi <= 0) {
        yMax = -this.niceFloor(Math.abs(hi));
        yMin = -this.niceCeil(Math.abs(lo));
      } else {
        yMin = -this.niceCeil(Math.abs(lo));
        yMax = this.niceCeil(hi);
      }
      if (yMax <= yMin) yMax = yMin + this.niceMax(1);
      return { yMin: yMin, yMax: yMax };
    }

    draw() {
      if (!this.data || !this.canvas) return;
      var ctx = this.ctx;
      var w = this.canvas.getBoundingClientRect().width;
      var h = this.canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, w, h);

      var pad = { l: 58, r: 18, t: 20, b: 40 };
      var series = this.data.series;
      if (!series.length) return;

      var IGE = window.InvestmentGrowthEngine;
      var isReal = this.data.isReal;
      var inflation = this.data.inflation || 0;
      var horizonMonths = Math.min(
        series.length - 1,
        Math.round(this.horizonYears * 12)
      );

      function yVal(p, key) {
        if (!isReal) return p[key];
        return IGE.nominalToReal(p[key], inflation, p.month);
      }

      var minY = Infinity;
      var maxY = -Infinity;
      for (var i = 0; i <= horizonMonths; i += 1) {
        var b = yVal(series[i], "buyerNetWorth");
        var r = yVal(series[i], "renterNetWorth");
        minY = Math.min(minY, b, r);
        maxY = Math.max(maxY, b, r);
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
        minY = 0;
        maxY = 1;
      }
      var bounds = this.axisBounds(minY, maxY);
      var yMin = bounds.yMin;
      var yMax = bounds.yMax;
      var xMax = horizonMonths;

      function xPix(m) {
        return pad.l + (m / Math.max(1, xMax)) * (w - pad.l - pad.r);
      }
      function yPix(v) {
        return pad.t + ((yMax - v) / (yMax - yMin)) * (h - pad.t - pad.b);
      }

      ctx.strokeStyle = "rgba(128,128,128,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t);
      ctx.lineTo(pad.l, h - pad.b);
      ctx.lineTo(w - pad.r, h - pad.b);
      ctx.stroke();

      ctx.fillStyle = "rgba(140,140,140,0.95)";
      ctx.font = "11px system-ui,sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(fmtMoney(yMax), pad.l - 6, pad.t + 4);
      ctx.fillText(fmtMoney(yMin), pad.l - 6, h - pad.b);
      ctx.textAlign = "center";
      var yrStep = this.horizonYears <= 15 ? 2 : this.horizonYears <= 30 ? 5 : 10;
      for (var yr = 0; yr <= this.horizonYears; yr += yrStep) {
        ctx.fillText(String(yr) + "y", xPix(yr * 12), h - pad.b + 16);
      }

      function strokeSeries(key, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.25;
        ctx.beginPath();
        var step = Math.max(1, Math.floor((horizonMonths + 1) / 500));
        for (var j = 0; j <= horizonMonths; j += step) {
          var p = series[j];
          var x = xPix(p.month);
          var y = yPix(yVal(p, key));
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        var last = series[horizonMonths];
        ctx.lineTo(xPix(last.month), yPix(yVal(last, key)));
        ctx.stroke();
      }

      strokeSeries("buyerNetWorth", "#2ECC71");
      strokeSeries("renterNetWorth", "#3498DB");

      var flips = (this.data.crossovers || []).filter(function (c) {
        return (c.to === "buyer" || c.to === "renter") && c.month <= horizonMonths;
      });
      var narrow = w < 520;
      flips.forEach(function (c) {
        var p = series[Math.min(series.length - 1, c.month)];
        if (!p) return;
        var avg = (yVal(p, "buyerNetWorth") + yVal(p, "renterNetWorth")) / 2;
        var x = xPix(p.month);
        var y = yPix(avg);
        ctx.fillStyle = "#E67E22";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        if (!narrow) {
          var from = c.from === "buyer" ? "Buying" : "Renting";
          var to = c.to === "buyer" ? "Buying" : "Renting";
          var label = from + " → " + to;
          var sub = fmtYears(c.years) + " years";
          ctx.fillStyle = "rgba(230,126,34,0.95)";
          ctx.font = "11px system-ui,sans-serif";
          ctx.textAlign = x > w * 0.7 ? "right" : "left";
          var lx = x > w * 0.7 ? x - 8 : x + 8;
          ctx.fillText(label, lx, y - 14);
          ctx.fillText(sub, lx, y - 2);
        }
      });
    }
  }

  var chart = null;
  var lastResult = null;
  var recalcTimer = null;
  var invBreakEvenTimer = null;
  var invBreakEvenToken = 0;
  /** "auto" follows comparison year; "fixed" preserves explicit 10/25/60; "comparison" tracks comparison year. */
  var chartRangeMode = "auto";

  function showError(msg) {
    var el = $("calculation_error");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = msg;
  }

  function syncChartRangeButtons(activeYears) {
    var active = String(activeYears);
    document.querySelectorAll(".range-btn").forEach(function (btn) {
      var range = btn.getAttribute("data-range");
      var isActive =
        range === "comparison"
          ? active === "comparison"
          : Number(range) === Number(activeYears);
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function resolveChartHorizonFromButton(rangeAttr) {
    if (rangeAttr === "comparison") {
      var cy = num($("comparison_year") && $("comparison_year").value);
      if (!Number.isFinite(cy) || cy <= 0) return 10;
      return Math.min(60, Math.max(1, cy));
    }
    return Number(rangeAttr);
  }

  function ensureComparisonSnapshot(result) {
    var snaps = sortSnapshotsChronologically(result.snapshots || []);
    var cy = result.comparisonYear;
    var cmpMonth = Math.round(cy * 12);
    var hasExactYear = snaps.some(function (s) {
      return !s.isPayoff && nearly(s.year, cy, 1e-9);
    });
    if (!hasExactYear && Number.isFinite(cy)) {
      var p = result.series[cmpMonth];
      if (p) {
        snaps.push({
          label: "Year " + cy + " (selected)",
          year: cy,
          month: cmpMonth,
          buyerNetWorth: p.buyerNetWorth,
          renterNetWorth: p.renterNetWorth,
          difference: p.difference,
          isComparison: true,
        });
      }
    }

    // Combine selected-year / standard-year / mortgage-payoff rows that share a month.
    var byMonth = {};
    sortSnapshotsChronologically(snaps).forEach(function (s) {
      var key = String(s.month);
      var existing = byMonth[key];
      if (!existing) {
        byMonth[key] = Object.assign({}, s);
        return;
      }
      var merged = Object.assign({}, existing);
      if (s.isPayoff || existing.isPayoff) {
        merged.isPayoff = true;
        var payoffLabel = s.isPayoff ? s.label : existing.label;
        var yearLabel = null;
        if (s.isComparison || existing.isComparison || nearly(s.year, cy, 1e-9) || nearly(existing.year, cy, 1e-9)) {
          yearLabel = "Year " + cy + " (selected)";
          merged.isComparison = true;
        } else if (!s.isPayoff) {
          yearLabel = s.label;
        } else if (!existing.isPayoff) {
          yearLabel = existing.label;
        }
        merged.label = yearLabel
          ? payoffLabel + " · " + yearLabel
          : payoffLabel;
        merged.year = s.isPayoff ? s.year : existing.year;
      } else {
        if (s.isComparison) merged.isComparison = true;
        if (existing.isComparison) merged.isComparison = true;
        if (merged.isComparison && !/selected/.test(merged.label)) {
          merged.label = "Year " + cy + " (selected)";
        }
      }
      byMonth[key] = merged;
    });

    return sortSnapshotsChronologically(
      Object.keys(byMonth).map(function (k) {
        return byMonth[k];
      })
    );
  }

  function renderInvestmentBreakEven(beInv, year) {
    var valueEl = $("be_invest_value");
    var lineEl = $("be_invest_line");
    if (!valueEl || !lineEl) return;
    valueEl.classList.remove("is-pending");
    if (!beInv) {
      valueEl.textContent = "—";
      lineEl.textContent =
        "No break-even investment return occurs between −50% and +40% at year " +
        year +
        " under these assumptions.";
      return;
    }
    if (beInv.pending) {
      valueEl.textContent = "Recalculating…";
      valueEl.classList.add("is-pending");
      lineEl.textContent =
        "Updating break-even investment return for the current assumptions.";
      return;
    }
    if (beInv.roots && beInv.roots.length > 1) {
      var title = $("be_invest_title");
      if (title) title.textContent = "Break-even investment returns";
      valueEl.innerHTML = beInv.roots
        .map(function (root) {
          return fmtPct(root.rate, 1) + " / year";
        })
        .join("<br>");
      lineEl.textContent =
        "More than one break-even return exists because the two strategies invest different amounts at different times. Changing the investment return does not always affect their relative projected net worth in a single direction.";
      return;
    }
    var titleEl = $("be_invest_title");
    if (titleEl) titleEl.textContent = "Break-even investment return";
    if (beInv.unreachable || (beInv.roots && beInv.roots.length === 0 && !Number.isFinite(beInv.rate))) {
      valueEl.textContent = "—";
      lineEl.textContent =
        beInv.message ||
        "No break-even investment return occurs between −50% and +40% at year " +
          year +
          " under these assumptions.";
      return;
    }
    if (Number.isFinite(beInv.rate)) {
      valueEl.textContent = fmtPct(beInv.rate, 1) + " / year";
      lineEl.textContent =
        "At year " +
        year +
        ", buying and renting produce approximately equal projected net worth at this assumed investment return under these assumptions. Which strategy benefits more from a higher return depends on how much and when each strategy has money invested.";
      return;
    }
    valueEl.textContent = "—";
    lineEl.textContent =
      "No break-even investment return occurs between −50% and +40% at year " +
      year +
      " under these assumptions.";
  }

  function scheduleInvestmentBreakEven(inputs, token) {
    if (invBreakEvenTimer) clearTimeout(invBreakEvenTimer);
    invBreakEvenTimer = setTimeout(function () {
      if (token !== invBreakEvenToken) return;
      if (!window.RentVsBuyEngine) return;
      var beInv = window.RentVsBuyEngine.solveBreakEvenInvestmentReturn(inputs);
      if (token !== invBreakEvenToken) return;
      if (lastResult) lastResult.breakEvenInvestmentReturn = beInv;
      renderInvestmentBreakEven(beInv, inputs.comparisonYear);
    }, 280);
  }

  function render(result) {
    lastResult = result;
    if (!result || result.error) {
      showError((result && result.error) || "Calculation error.");
      return;
    }
    showError("");

    $("headline_text").textContent = result.headline || "—";
    $("cmp_year_label").textContent = String(result.comparisonYear);
    if ($("money_year_label")) $("money_year_label").textContent = String(result.comparisonYear);

    var basisLabel = displayIsReal() ? "Today’s dollars" : "Nominal dollars";
    if ($("nw_basis_label")) $("nw_basis_label").textContent = basisLabel;
    if ($("chart_basis_hint")) $("chart_basis_hint").textContent = "Showing " + basisLabel.toLowerCase();

    var cmp = result.comparisonPoint;
    var buyNW = valueForDisplay(cmp, "buyerNetWorth", result);
    var rentNW = valueForDisplay(cmp, "renterNetWorth", result);
    var cmpDiff = valueForDisplay(cmp, "difference", result);

    $("nw_buy").textContent = fmtMoney(buyNW);
    $("nw_rent").textContent = fmtMoney(rentNW);

    var verdict = $("nw_verdict");
    var absDiff = Math.abs(cmpDiff);
    if (absDiff < 1) {
      verdict.textContent =
        "Projected net worth is approximately equal at year " + result.comparisonYear + ".";
    } else if (cmpDiff > 0) {
      verdict.textContent = "Buying is ahead by " + fmtMoney(cmpDiff);
    } else {
      verdict.textContent = "Renting is ahead by " + fmtMoney(-cmpDiff);
    }

    var cash = result.month0Cash;
    $("cash_buy").textContent = fmtMoney(cash.owner);
    $("cash_rent").textContent = fmtMoney(cash.renter);
    var d = cash.difference;
    $("cash_diff_line").textContent =
      "Difference: " +
      fmtMoney(Math.abs(d)) +
      " / month" +
      (d > 0 ? " — renting requires less cash" : d < 0 ? " — buying requires less cash" : " — equal");
    if (cash.firstMonthPrincipal > 0) {
      $("principal_line").textContent =
        fmtMoney(cash.firstMonthPrincipal) +
        " of the buyer’s first mortgage payment is principal that increases home equity.";
    } else {
      $("principal_line").textContent = "";
    }

    renderLeadTimeline(result);
    renderCrossoverLabels(result);

    // Where the money is — balance sheet in the selected output basis only.
    var sheet = selectedYearBalanceSheet(result, displayIsReal());
    if ($("money_basis_hint")) {
      $("money_basis_hint").textContent = "Showing " + basisLabel.toLowerCase();
    }

    fillMoneyDl($("buyer_breakdown_dl"), [
      ["Home value", fmtMoney(sheet.buyer.homeValue)],
      ["Mortgage remaining", fmtMoney(sheet.buyer.mortgageBalance)],
      ["Selling costs", "−" + fmtMoney(sheet.buyer.sellingCosts)],
      {
        0: "Net realizable home equity",
        1: fmtMoney(sheet.buyer.netRealizableEquity),
        emphasis: true,
      },
      { divider: true },
      {
        0: "Investment account",
        1: fmtMoney(sheet.buyer.investmentAccount),
        emphasis: true,
      },
    ]);
    $("buyer_total_nw").textContent = fmtMoney(sheet.buyer.totalNetWorth);

    fillMoneyDl($("renter_breakdown_dl"), [
      {
        0: "Investment account",
        1: fmtMoney(sheet.renter.investmentAccount),
        emphasis: true,
      },
    ]);
    $("renter_total_nw").textContent = fmtMoney(sheet.renter.totalNetWorth);

    var moneyDiff = $("money_diff_line");
    if (moneyDiff) {
      if (absDiff < 1) {
        moneyDiff.textContent = "Difference: approximately equal under these assumptions.";
      } else if (cmpDiff > 0) {
        moneyDiff.textContent =
          "Difference: Buying ahead by " + fmtMoney(cmpDiff);
      } else {
        moneyDiff.textContent =
          "Difference: Renting ahead by " + fmtMoney(-cmpDiff);
      }
    }

    // Nominal cash-accounting history (always nominal; expandable).
    var hist = sheet.nominalHistory;
    fillMoneyDl($("buyer_invest_history_dl"), [
      {
        0: "Starting investable capital",
        1: fmtMoney(hist.buyer.startingInvested),
        groupStart: true,
      },
      {
        0: "Cumulative cash-flow contributions",
        1: fmtMoney(hist.buyer.contribCumulative),
        indent: true,
      },
      {
        0: "Investment earnings",
        1: fmtMoney(hist.buyer.earnings),
        indent: true,
      },
      {
        0: "Nominal investment account",
        1: fmtMoney(hist.buyer.investmentAccount),
        equals: true,
        emphasis: true,
      },
    ]);
    fillMoneyDl($("renter_invest_history_dl"), [
      {
        0: "Starting capital invested",
        1: fmtMoney(hist.renter.startingInvested),
        groupStart: true,
      },
      {
        0: "Cumulative cash-flow contributions",
        1: fmtMoney(hist.renter.contribCumulative),
        indent: true,
      },
      {
        0: "Investment earnings",
        1: fmtMoney(hist.renter.earnings),
        indent: true,
      },
      {
        0: "Nominal investment account",
        1: fmtMoney(hist.renter.investmentAccount),
        equals: true,
        emphasis: true,
      },
    ]);

    // Selected-year monthly cash — same output basis as the global toggle.
    if ($("cash_year_label")) $("cash_year_label").textContent = String(result.comparisonYear);
    if ($("sel_cash_basis_hint")) {
      $("sel_cash_basis_hint").textContent = "(" + basisLabel.toLowerCase() + ")";
    }
    var ownerCashY = sheet.ownerCash;
    var renterCashY = sheet.renterCash;
    if ($("sel_cash_buy")) $("sel_cash_buy").textContent = fmtMoney(ownerCashY);
    if ($("sel_cash_rent")) $("sel_cash_rent").textContent = fmtMoney(renterCashY);
    var cfY = ownerCashY - renterCashY;
    if ($("sel_cash_diff_line")) {
      $("sel_cash_diff_line").textContent =
        "Difference: " +
        fmtMoney(Math.abs(cfY)) +
        " / month" +
        (cfY > 1 ? " — renting requires less cash" : cfY < -1 ? " — buying requires less cash" : " — approximately equal");
    }
    if ($("sel_cash_advantage")) {
      if (Math.abs(cfY) <= 1) {
        $("sel_cash_advantage").textContent =
          "Neither side has a material monthly cash-flow advantage at this point.";
      } else if (cfY > 0) {
        $("sel_cash_advantage").textContent =
          "Renting has the monthly cash-flow advantage at this point (invest-the-difference credits the renter when that toggle is on).";
      } else {
        $("sel_cash_advantage").textContent =
          "Buying has the monthly cash-flow advantage at this point (invest-the-difference credits the buyer when that toggle is on).";
      }
    }
    var cfSwitch = detectCashFlowAdvantageSwitch(result.series);
    if ($("cf_switch_line")) {
      if (cfSwitch) {
        $("cf_switch_line").textContent =
          "Monthly cash-flow advantage switches from " +
          whoLabel(cfSwitch.from).toLowerCase() +
          " to " +
          whoLabel(cfSwitch.to).toLowerCase() +
          " after approximately " +
          fmtYears(cfSwitch.years) +
          " years.";
      } else {
        $("cf_switch_line").textContent = "";
      }
    }

    // Snapshots (chronological; same-month rows combined)
    var snapBody = $("snapshots_table") && $("snapshots_table").querySelector("tbody");
    if (snapBody) {
      snapBody.innerHTML = "";
      var snaps = ensureComparisonSnapshot(result);
      var cmpMonth = Math.round(result.comparisonYear * 12);
      snaps.forEach(function (s) {
        var p = result.series[s.month];
        if (!p) return;
        var tr = document.createElement("tr");
        if (s.month === cmpMonth || s.isComparison) tr.className = "is-comparison-year";
        var label = s.label;
        if (s.isPayoff && label.indexOf("(") < 0) {
          label = label + " (" + fmtYears(s.year) + "y)";
        }
        tr.innerHTML =
          "<td>" +
          label +
          '</td><td class="num">' +
          fmtMoney(valueForDisplay(p, "buyerNetWorth", result)) +
          '</td><td class="num">' +
          fmtMoney(valueForDisplay(p, "renterNetWorth", result)) +
          '</td><td class="num">' +
          fmtMoney(valueForDisplay(p, "difference", result)) +
          "</td>";
        snapBody.appendChild(tr);
      });
    }

    // Break-even cards
    var beHome = result.breakEvenHomeAppreciation;
    var beInv = result.breakEvenInvestmentReturn;
    var year = result.comparisonYear;
    var apprMode =
      (beHome && beHome.mode) ||
      (document.querySelector('input[name="appr_mode"]:checked') &&
        document.querySelector('input[name="appr_mode"]:checked').value) ||
      "nominal";
    if ($("be_home_title")) {
      $("be_home_title").textContent = breakEvenHomeTitle(apprMode);
    }
    if (beHome && beHome.unreachable) {
      $("be_home_value").textContent = "—";
      $("be_home_line").textContent = beHome.message;
    } else if (beHome && Number.isFinite(beHome.rate)) {
      $("be_home_value").textContent = fmtPct(beHome.rate, 1) + " / year";
      var label =
        beHome.mode === "real_linked"
          ? "real home appreciation above inflation"
          : "nominal home-appreciation rate";
      $("be_home_line").textContent =
        "At year " +
        year +
        ", buying and renting produce approximately equal projected net worth at this " +
        label +
        " under these assumptions.";
    } else {
      $("be_home_value").textContent = "—";
      $("be_home_line").textContent =
        "Break-even home appreciation could not be determined under these assumptions.";
    }

    renderInvestmentBreakEven(beInv, year);

    if (chart) {
      if (chartRangeMode === "comparison") {
        var cyH = Number(result.comparisonYear);
        if (!Number.isFinite(cyH) || cyH <= 0) cyH = 10;
        cyH = Math.min(60, Math.max(1, cyH));
        chart.setHorizonYears(cyH);
        syncChartRangeButtons("comparison");
      } else if (chartRangeMode === "auto") {
        var autoH = defaultChartHorizonYears(result.comparisonYear);
        chart.setHorizonYears(autoH);
        syncChartRangeButtons(autoH);
      }
      // "fixed": leave the user's explicit 10/25/60 horizon alone
    }

    if (chart) {
      chart.setData(
        result.series,
        result.crossover && result.crossover.flips,
        displayIsReal(),
        result.inflationAnnual
      );
    }

    updateInsuranceReadout(result);
    updateRefineBadges();
  }

  function recalculate() {
    if (!window.RentVsBuyEngine) return;
    var inputs = gatherInputs();
    updateCapitalReadout(inputs, null);
    updateMaintenanceEstimate();
    updateGrowthToggles();

    invBreakEvenToken += 1;
    var token = invBreakEvenToken;

    // Fast path: main projection + home-appreciation break-even. Investment-return
    // root scan is deferred so typing stays responsive.
    var result;
    try {
      result = window.RentVsBuyEngine.calculate(inputs, { skipInvestmentBreakEven: true });
    } catch (e) {
      showError((e && e.message) || "Calculation error.");
      return;
    }
    updateInsuranceUi(result);
    if (!result.error) {
      updateCapitalReadout(inputs, result.insurance && result.insurance.detail);
      scheduleInvestmentBreakEven(inputs, token);
    } else if (result.capital) {
      updateCapitalReadout(inputs, result.insurance);
    }
    render(result);

    if (window.gtag) {
      try {
        gtag("event", "calculation_completed", { calculator_name: "rent-vs-buy" });
      } catch (e) {
        /* ignore */
      }
    }
  }

  function scheduleRecalc() {
    if (recalcTimer) clearTimeout(recalcTimer);
    recalcTimer = setTimeout(recalculate, 80);
  }

  function bind() {
    var canvas = $("nw_chart");
    if (canvas) {
      chart = new NetWorthChart(canvas);
      var initH = defaultChartHorizonYears(num($("comparison_year").value));
      chart.setHorizonYears(initH);
      syncChartRangeButtons(initH);
    }

    document.querySelectorAll(".range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rangeAttr = btn.getAttribute("data-range");
        var y = resolveChartHorizonFromButton(rangeAttr);
        if (rangeAttr === "comparison") {
          chartRangeMode = "comparison";
        } else {
          chartRangeMode = "fixed";
        }
        if (chart) chart.setHorizonYears(y);
        syncChartRangeButtons(rangeAttr === "comparison" ? "comparison" : y);
        if (lastResult) {
          chart.setData(
            lastResult.series,
            lastResult.crossover && lastResult.crossover.flips,
            displayIsReal(),
            lastResult.inflationAnnual
          );
        }
      });
    });

    $("down_use_pct").addEventListener("change", function () {
      syncDownPaymentFields();
      scheduleRecalc();
    });
    $("maintenance_helper_btn").addEventListener("click", function () {
      var est = num(this.dataset.estimate);
      if (!Number.isFinite(est)) {
        var price = num($("purchase_price").value);
        if (Number.isFinite(price)) {
          est = window.RentVsBuyEngine.maintenanceHelperOnePercent(price);
        }
      }
      if (Number.isFinite(est)) {
        $("maintenance").value = String(est);
        scheduleRecalc();
      }
    });

    $("add_owner_expense").addEventListener("click", function () {
      addOtherExpenseRow("owner_other_rows", "ownership");
      scheduleRecalc();
    });
    $("add_renter_expense").addEventListener("click", function () {
      addOtherExpenseRow("renter_other_rows", "renter");
      scheduleRecalc();
    });
    ["owner_other_rows", "renter_other_rows"].forEach(function (cid) {
      var root = $(cid);
      if (!root) return;
      root.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains("remove-expense")) {
          var row = t.closest(".other-expense-row");
          if (row) row.remove();
          scheduleRecalc();
        }
      });
      root.addEventListener("input", scheduleRecalc);
      root.addEventListener("change", scheduleRecalc);
    });

    var ids = [
      "starting_capital",
      "purchase_price",
      "down_payment",
      "down_pct",
      "mortgage_rate",
      "amortization_years",
      "insurance_mode",
      "insurance_province",
      "finance_premium",
      "thirty_year_eligibility",
      "custom_ins_upfront",
      "custom_ins_financed",
      "custom_ins_monthly",
      "custom_ins_monthly_duration",
      "closing_costs",
      "selling_cost_pct",
      "selling_cost_fixed",
      "property_tax",
      "property_tax_use_inf",
      "property_tax_growth",
      "maintenance",
      "home_insurance",
      "condo_fees",
      "owner_utilities",
      "owner_util_use_inf",
      "owner_util_growth",
      "monthly_rent",
      "rent_growth",
      "renter_upfront",
      "tenant_insurance",
      "renter_utilities",
      "renter_util_use_inf",
      "renter_util_growth",
      "investment_return",
      "invest_cf_diff",
      "inflation",
      "home_appreciation",
      "real_home_appreciation",
      "comparison_year",
    ];
    ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("input", scheduleRecalc);
      el.addEventListener("change", scheduleRecalc);
    });

    document.querySelectorAll('input[name="appr_mode"], input[name="display_basis"]').forEach(function (el) {
      el.addEventListener("change", scheduleRecalc);
    });

    $("comparison_year").addEventListener("change", function () {
      // Fixed 10/25/60 choices are preserved; auto/comparison modes keep following year.
    });
    $("comparison_year").addEventListener("input", function () {
      // no-op: chartRangeMode decides whether horizon follows comparison year
    });

    // Accessible accordion state for refinement sections
    document.querySelectorAll(".rvb-details").forEach(function (details) {
      var summary = details.querySelector("summary");
      if (!summary) return;
      summary.setAttribute("aria-expanded", details.open ? "true" : "false");
      details.addEventListener("toggle", function () {
        summary.setAttribute("aria-expanded", details.open ? "true" : "false");
      });
    });

    applySharedScenarioFromQuery();
    recalculate();
  }

  window.RentVsBuyUi = {
    insuranceVisibility: insuranceVisibility,
    defaultChartHorizonYears: defaultChartHorizonYears,
    breakEvenHomeTitle: breakEvenHomeTitle,
    sortSnapshotsChronologically: sortSnapshotsChronologically,
    ensureComparisonSnapshot: ensureComparisonSnapshot,
    detectCashFlowAdvantageSwitch: detectCashFlowAdvantageSwitch,
    investmentGrowth: investmentGrowth,
    selectedYearBalanceSheet: selectedYearBalanceSheet,
    realBalanceSheetReconciles: realBalanceSheetReconciles,
    ownershipActiveSummary: ownershipActiveSummary,
    rentalActiveSummary: rentalActiveSummary,
    applySharedScenarioFromQuery: applySharedScenarioFromQuery,
    renderInvestmentBreakEven: renderInvestmentBreakEven,
    MAX_OTHER_EXPENSES: MAX_OTHER_EXPENSES,
    DEFAULTS: DEFAULTS,
    getChartRangeMode: function () {
      return chartRangeMode;
    },
    setChartRangeModeForTests: function (mode) {
      chartRangeMode = mode;
    },
  };

  function boot() {
    if (!$("starting_capital") || !$("nw_chart")) return;
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
