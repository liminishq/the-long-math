// UI controller for RRSP Contribution Room & Tax Refund Calculator

import { computeScenario, parseNumber } from "./engine.js";

(function () {

  const PROVINCES = [
    { code: "AB", name: "Alberta" },
    { code: "BC", name: "British Columbia" },
    { code: "MB", name: "Manitoba" },
    { code: "NB", name: "New Brunswick" },
    { code: "NL", name: "Newfoundland and Labrador" },
    { code: "NS", name: "Nova Scotia" },
    { code: "NT", name: "Northwest Territories" },
    { code: "NU", name: "Nunavut" },
    { code: "ON", name: "Ontario" },
    { code: "PE", name: "Prince Edward Island" },
    { code: "QC", name: "Quebec" },
    { code: "SK", name: "Saskatchewan" },
    { code: "YT", name: "Yukon" }
  ];

  function formatCurrency(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "$–";
    return n.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0
    });
  }

  function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "–%";
    return (n * 100).toFixed(1).replace(/\.0$/, "") + "%";
  }

  function readInputs() {
    const taxYear = document.getElementById("tax_year").value || "2025";
    const province = document.getElementById("province").value || "";

    const priorEarnedIncome = document.getElementById("prior_earned_income").value;
    const unusedRoom = document.getElementById("unused_room").value;
    const plannedContribution = document.getElementById("planned_contribution").value;
    const taxableBefore = document.getElementById("taxable_before").value;
    const pa = document.getElementById("pa").value;
    const par = document.getElementById("par").value;
    const pspa = document.getElementById("pspa").value;
    const craOverrideToggle = document.getElementById("cra_override_toggle").checked;
    const craLimit = document.getElementById("cra_limit").value;

    const refundButtons = document.querySelectorAll(".refund-btn");
    let refundMethod = "progressive";
    refundButtons.forEach(btn => {
      if (btn.classList.contains("active")) {
        refundMethod = btn.getAttribute("data-method") || "progressive";
      }
    });

    return {
      taxYear,
      province,
      priorEarnedIncome,
      unusedRoom,
      plannedContribution,
      taxableBefore,
      pa,
      par,
      pspa,
      craOverrideEnabled: craOverrideToggle,
      craLimit,
      refundMethod
    };
  }

  let debounceTimer = null;

  function scheduleRecalculate() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      recalculate().catch(err => {
        console.error("RRSP calculator error:", err);
      });
    }, 200);
  }

  async function recalculate() {
    const provinceError = document.getElementById("province_error");
    const provinceSelect = document.getElementById("province");

    const inputs = readInputs();

    if (!inputs.province) {
      if (provinceError) {
        provinceError.textContent = "Select a province/territory to estimate tax.";
      }
      provinceSelect.classList.add("is-invalid");
      renderEmptyResults();
      return;
    } else {
      if (provinceError) {
        provinceError.textContent = "";
      }
      provinceSelect.classList.remove("is-invalid");
    }

    const scenario = await computeScenario(inputs);

    const estimatedRoomDisplay = inputs.craOverrideEnabled
      ? scenario.room.estimatedAvailableRoom
      : scenario.room.availableRoomForDeduction;

    document.getElementById("out_estimated_room").textContent =
      formatCurrency(estimatedRoomDisplay);

    document.getElementById("out_planned_contribution").textContent =
      formatCurrency(scenario.inputs.plannedContribution);

    document.getElementById("out_deductible").textContent =
      formatCurrency(scenario.deduction.deductibleContribution);

    document.getElementById("out_refund").textContent =
      formatCurrency(scenario.outputs.chosenRefund);

    document.getElementById("out_after_tax_cost").textContent =
      formatCurrency(scenario.outputs.afterTaxCost);

    document.getElementById("out_remaining_room").textContent =
      formatCurrency(scenario.outputs.remainingRoom);

    const overrideNote = document.getElementById("out_cra_override_note");
    if (inputs.craOverrideEnabled) {
      overrideNote.textContent =
        "CRA deduction limit override is applied. The internal estimate is still calculated for comparison.";
    } else {
      overrideNote.textContent =
        "Based on 18% of prior-year earned income (capped) plus carryforward and pension adjustments.";
    }

    const overRow = document.getElementById("over_contribution_row");
    const overText = document.getElementById("out_over_contribution");
    if (scenario.outputs.excessContribution > 0) {
      overRow.classList.add("warning");
      overText.textContent =
        "Your planned contribution exceeds available RRSP room in this model. CRA over-contribution rules and penalties are not calculated here.";
    } else {
      overRow.classList.remove("warning");
      overText.textContent = "None based on this estimate.";
    }

    document.getElementById("out_excess_contribution").textContent =
      formatCurrency(scenario.outputs.excessContribution);

    document.getElementById("out_marginal_rate").textContent =
      formatPercent(scenario.tax.marginalRate);

    document.getElementById("out_effective_refund").textContent =
      formatPercent(scenario.outputs.effectiveRefundRate);

    const refundNote = document.getElementById("out_refund_method_note");
    if (inputs.refundMethod === "marginal") {
      refundNote.textContent =
        "Refund is estimated as deductible contribution × combined marginal tax rate at your starting taxable income.";
    } else {
      refundNote.textContent =
        "Refund is estimated by recalculating tax before and after the RRSP deduction using federal and provincial brackets.";
    }
  }

  function renderEmptyResults() {
    document.getElementById("out_estimated_room").textContent = "$–";
    document.getElementById("out_planned_contribution").textContent = "$–";
    document.getElementById("out_deductible").textContent = "$–";
    document.getElementById("out_refund").textContent = "$–";
    document.getElementById("out_after_tax_cost").textContent = "$–";
    document.getElementById("out_remaining_room").textContent = "$–";
    document.getElementById("out_over_contribution").textContent = "–";
    document.getElementById("out_excess_contribution").textContent = "$–";
    document.getElementById("out_marginal_rate").textContent = "–%";
    document.getElementById("out_effective_refund").textContent = "–%";
  }

  function initProvinceSelect() {
    const select = document.getElementById("province");
    if (!select) return;

    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select...";
    select.appendChild(placeholder);

    PROVINCES.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.code;
      opt.textContent = p.name;
      select.appendChild(opt);
    });

    select.value = "ON";
  }

  function initModeToggle() {
    const simpleBtn = document.getElementById("mode_btn_simple");
    const advancedBtn = document.getElementById("mode_btn_advanced");
    const simpleHelper = document.getElementById("mode_helper_simple");
    const advancedHelper = document.getElementById("mode_helper_advanced");
    const advancedSections = document.querySelectorAll(".advanced-only");

    function setMode(mode) {
      if (mode === "advanced") {
        advancedBtn.classList.add("active");
        advancedBtn.setAttribute("aria-selected", "true");
        simpleBtn.classList.remove("active");
        simpleBtn.setAttribute("aria-selected", "false");
        advancedHelper.classList.remove("hidden");
        simpleHelper.classList.add("hidden");
        advancedSections.forEach(el => el.classList.remove("hidden"));
      } else {
        simpleBtn.classList.add("active");
        simpleBtn.setAttribute("aria-selected", "true");
        advancedBtn.classList.remove("active");
        advancedBtn.setAttribute("aria-selected", "false");
        simpleHelper.classList.remove("hidden");
        advancedHelper.classList.add("hidden");
        advancedSections.forEach(el => el.classList.add("hidden"));
      }
      scheduleRecalculate();
    }

    simpleBtn.addEventListener("click", () => setMode("simple"));
    advancedBtn.addEventListener("click", () => setMode("advanced"));
  }

  function initRefundToggle() {
    const buttons = document.querySelectorAll(".refund-btn");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        scheduleRecalculate();
      });
    });
  }

  function initCRAOverride() {
    const toggle = document.getElementById("cra_override_toggle");
    const field = document.getElementById("cra_override_field");
    if (!toggle || !field) return;

    function update() {
      if (toggle.checked) {
        field.classList.remove("hidden");
      } else {
        field.classList.add("hidden");
      }
      scheduleRecalculate();
    }

    toggle.addEventListener("change", update);
    update();
  }

  function attachInputHandlers() {
    const inputs = document.querySelectorAll(
      "#prior_earned_income, #unused_room, #planned_contribution, #taxable_before, #pa, #par, #pspa, #cra_limit"
    );
    inputs.forEach(input => {
      input.addEventListener("input", scheduleRecalculate);
      input.addEventListener("blur", () => {
        const n = parseNumber(input.value);
        if (!Number.isNaN(n) && input.value.trim() !== "") {
          input.value = n.toString();
        }
      });
    });

    const selects = document.querySelectorAll("#tax_year, #province");
    selects.forEach(sel => sel.addEventListener("change", scheduleRecalculate));
  }

  function init() {
    initProvinceSelect();
    initModeToggle();
    initRefundToggle();
    initCRAOverride();
    attachInputHandlers();
    renderEmptyResults();
    scheduleRecalculate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

