// TFSA vs RRSP vs FHSA Calculator – UI glue (no math logic)

import { runAccountStrategySimulation } from "./engine.js";
import { loadTaxData } from "../canada-income-tax/js/tax.data.js";
import { computePersonalTax } from "../canada-income-tax/js/tax.engine.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing element #" + id);
  return el;
}

function numFromInput(id) {
  const el = $(id);
  const raw = el.value.trim().replace(/,/g, "");
  if (raw === "") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function optionalNumFromInput(id) {
  const el = $(id);
  const raw = el.value.trim().replace(/,/g, "");
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "$—";
  return Math.round(n).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  });
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1) + "%";
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

let cachedEstimatedCurrentRate = null;
let loadedTaxYear = null;
let taxDataLoaded = false;

function readInputs() {
  const modeEl = $("contributionMode");
  const contributionMode = modeEl.value;

  let contributionAmount = numFromInput("contributionAmount");
  if (!Number.isFinite(contributionAmount) || contributionAmount < 0) contributionAmount = 0;

  const tfsaRoomAvailable = optionalNumFromInput("tfsaRoomAvailable");
  const rrspRoomAvailable = optionalNumFromInput("rrspRoomAvailable");

  const horizonYears = clamp(numFromInput("horizonYears"), 1, 80);
  const annualReturn = clamp(numFromInput("annualReturn"), -50, 50);
  const annualFees = clamp(numFromInput("annualFees"), 0, 5);

  const useRealDollars = $("realToggle").checked;
  let inflation = numFromInput("inflationRate");
  if (!Number.isFinite(inflation) || inflation < 0) inflation = 0;

  const manual_t_now = clamp(numFromInput("tNow"), 0, 100);
  const useTaxEngineRate = $("useTaxEngineRate").checked;
  const t_now = useTaxEngineRate && Number.isFinite(cachedEstimatedCurrentRate)
    ? cachedEstimatedCurrentRate
    : manual_t_now;
  const t_ret = clamp(numFromInput("tRet"), 0, 100);

  const taxYearNow = Number($("taxYearNow").value || 2025);
  const provinceNow = $("provinceNow").value || "ON";
  const taxableIncomeNow = Math.max(0, Number(optionalNumFromInput("taxableIncomeNow") || 0));

  const refundMode = $("refundReinvest").checked ? "reinvest" : "spend";

  const fhsaEligible = $("fhsaEligible").checked;
  const fhsaHomeQualified = $("fhsaHomeQualified").checked;
  let fhsaAnnualRoom = numFromInput("fhsaAnnualRoom");
  if (!Number.isFinite(fhsaAnnualRoom) || fhsaAnnualRoom < 0) fhsaAnnualRoom = 8000;
  const fhsaRoomAvailable = optionalNumFromInput("fhsaRoomAvailable");

  return {
    contributionMode,
    contributionAmount,
    horizonYears,
    annualReturn,
    annualFees,
    inflation,
    useRealDollars,
    t_now,
    t_ret,
    useTaxEngineRate,
    taxYearNow,
    provinceNow,
    taxableIncomeNow,
    refundMode,
    refundDest: "tfsa",
    tfsaRoomAvailable: Number.isFinite(tfsaRoomAvailable) ? tfsaRoomAvailable : undefined,
    rrspRoomAvailable: Number.isFinite(rrspRoomAvailable) ? rrspRoomAvailable : undefined,
    fhsaEligible,
    fhsaHomeQualified,
    fhsaAnnualRoom,
    fhsaRoomAvailable: Number.isFinite(fhsaRoomAvailable) ? fhsaRoomAvailable : undefined
  };
}

async function refreshEstimatedMarginalRate() {
  const useTaxEngineRate = $("useTaxEngineRate").checked;
  const rateHint = $("taxEngineRateHint");
  const tNowInput = $("tNow");

  if (!useTaxEngineRate) {
    cachedEstimatedCurrentRate = null;
    tNowInput.disabled = false;
    rateHint.textContent =
      "This estimate uses the Canada Personal Income Tax calculator engine (employment income only profile).";
    return;
  }

  const taxYear = Number($("taxYearNow").value || 2025);
  const province = $("provinceNow").value || "ON";
  const taxableIncome = Math.max(0, Number(optionalNumFromInput("taxableIncomeNow") || 0));

  try {
    if (!taxDataLoaded || loadedTaxYear !== taxYear) {
      await loadTaxData(taxYear, { basePath: "/calculators/canada-income-tax/data" });
      taxDataLoaded = true;
      loadedTaxYear = taxYear;
    }

    const taxResult = computePersonalTax({
      year: taxYear,
      province,
      employmentIncome: taxableIncome,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0
    });

    const estimatedPct = clamp((taxResult.totals.marginalRate || 0) * 100, 0, 100);
    cachedEstimatedCurrentRate = estimatedPct;
    tNowInput.value = estimatedPct.toFixed(1);
    tNowInput.disabled = true;
    rateHint.textContent =
      "Estimated current marginal rate from employment-income tax math: " +
      fmtPct(estimatedPct) +
      " for " +
      province +
      " in " +
      String(taxYear) +
      ".";
  } catch (err) {
    cachedEstimatedCurrentRate = null;
    tNowInput.disabled = false;
    rateHint.textContent =
      "Could not estimate current marginal rate from tax engine data. You can still enter t_now manually.";
    console.error("Failed tax-engine marginal estimate:", err);
  }
}

async function render() {
  let inputs;
  try {
    inputs = readInputs();
  } catch (err) {
    console.error("Error reading inputs", err);
    return;
  }

  // Persist last inputs for Inspectable Arithmetic page
  try {
    window.localStorage.setItem("tlm_tfsa_rrsp_fhsa_lastInputs", JSON.stringify(inputs));
  } catch (e) {
    // ignore storage errors
  }

  await refreshEstimatedMarginalRate();

  // Re-read inputs in case tax-engine estimated current rate updated t_now
  try {
    inputs = readInputs();
  } catch (err) {
    console.error("Error re-reading inputs", err);
    return;
  }

  let result;
  try {
    result = runAccountStrategySimulation(inputs);
  } catch (err) {
    console.error("Simulation error", err);
    return;
  }

  const { strategies, ranking, allocationSummary } = result;

  // Ranking list
  const rankingList = $("rankingList");
  rankingList.innerHTML = "";
  ranking.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = `${prettyStrategyName(r.key)} – ${fmtMoney(r.finalAfterTax)}`;
    rankingList.appendChild(li);
  });

  // Optimal split sentence
  if (allocationSummary && inputs.fhsaEligible) {
    const dest = allocationSummary.remainderDestination || "TFSA";
    $("optimalSplit").textContent =
      `This year: ${fmtMoney(allocationSummary.fhsaUsedAnnual)} to FHSA (up to the modeled annual room), ` +
      `and approximately ${fmtMoney(allocationSummary.remainderAnnual)} to ${dest}.`;
    $("allocationNote").textContent = allocationSummary.noteText || "";
  } else if (!inputs.fhsaEligible) {
    $("optimalSplit").textContent =
      "FHSA not available. The model uses room-constrained ordering between RRSP and TFSA.";
    $("allocationNote").textContent = "";
  }

  const unallocatedInOptimal = strategies.OPTIMAL?.breakdown?.unallocated || 0;
  if (unallocatedInOptimal > 0) {
    const baseNote = $("allocationNote").textContent ? $("allocationNote").textContent + " " : "";
    $("allocationNote").textContent =
      baseNote +
      "Modeled registered room is fully used before the horizon ends; approximately " +
      fmtMoney(unallocatedInOptimal) +
      " remains unallocated to registered accounts.";
  }

  renderAllocationBreakdown(allocationSummary, strategies.OPTIMAL?.optimalSourceKey, inputs.fhsaEligible);
  renderEndingAccountTotals(inputs, strategies.OPTIMAL);

  // Refund hint
  if (inputs.refundMode === "spend") {
    if (!inputs.fhsaEligible) {
      // Simple RRSP-only uplift comparison (FHSA not in play)
      const rrspReinvest = {
        ...inputs,
        refundMode: "reinvest"
      };
      let hypothetical;
      try {
        const hypoResult = runAccountStrategySimulation(rrspReinvest);
        hypothetical = hypoResult.strategies.ALL_RRSP?.finalAfterTax;
      } catch {
        hypothetical = null;
      }
      if (Number.isFinite(hypothetical) && Number.isFinite(strategies.ALL_RRSP?.finalAfterTax)) {
        const diff = hypothetical - strategies.ALL_RRSP.finalAfterTax;
        $("refundHint").textContent =
          `If RRSP refunds were reinvested instead of spent, the RRSP strategy here would end about ${fmtMoney(diff)} higher.`;
      } else {
        $("refundHint").textContent =
          "If RRSP refunds were reinvested instead of spent, RRSP outcomes would be higher than shown.";
      }
    } else {
      // FHSA enabled: keep the hint qualitative to avoid misleading single-strategy comparisons
      $("refundHint").textContent =
        "Refund handling (spent vs reinvested) affects both RRSP and FHSA-style strategies. Use the toggle to compare these cases explicitly.";
    }
  } else {
    $("refundHint").textContent =
      "Refunds are assumed reinvested (TFSA-like). To model a more conservative case, toggle refunds to 'spent'.";
  }
}

function prettyStrategyName(key) {
  switch (key) {
    case "ALL_TFSA":
      return "All contributions to TFSA";
    case "ALL_RRSP":
      return "All contributions to RRSP";
    case "TFSA_THEN_RRSP":
      return "TFSA first, then RRSP (room-constrained)";
    case "RRSP_THEN_TFSA":
      return "RRSP first, then TFSA (room-constrained)";
    case "ALL_FHSA":
      return "FHSA first (overflow TFSA)";
    case "OPTIMAL":
      return "Optimal room-constrained allocation";
    default:
      return key;
  }
}

function renderAllocationBreakdown(allocationSummary, optimalSourceKey, fhsaEligible) {
  const list = $("allocationBreakdownList");
  const leftover = $("allocationLeftoverNote");
  list.innerHTML = "";
  leftover.textContent = "";

  const firstYear = allocationSummary?.firstYearAllocation;
  if (!firstYear) return;

  const isRrspFirst = optimalSourceKey === "RRSP_THEN_TFSA" || optimalSourceKey === "FHSA_FIRST_THEN_RRSP";
  let accountOrder = [];
  if (fhsaEligible) {
    accountOrder = isRrspFirst ? ["fhsa", "rrsp", "tfsa"] : ["fhsa", "tfsa", "rrsp"];
  } else {
    accountOrder = isRrspFirst ? ["rrsp", "tfsa", "fhsa"] : ["tfsa", "rrsp", "fhsa"];
  }

  const accountLabel = {
    tfsa: "TFSA",
    rrsp: "RRSP",
    fhsa: "FHSA"
  };

  const accountReason = {
    tfsa: "Tax-free growth and withdrawal under current assumptions.",
    rrsp: "Deduction now plus tax-deferred growth under current assumptions.",
    fhsa: "Tax deduction on contribution plus tax-free qualified withdrawal."
  };

  const stepConfigs = [
    {
      labelId: "step1Label",
      valueId: "step1Value",
      noteId: "step1Note",
      account: accountOrder[0]
    },
    {
      labelId: "step2Label",
      valueId: "step2Value",
      noteId: "step2Note",
      account: accountOrder[1]
    },
    {
      labelId: "step3Label",
      valueId: "step3Value",
      noteId: "step3Note",
      account: accountOrder[2]
    }
  ];

  stepConfigs.forEach((cfg, idx) => {
    const account = cfg.account;
    const amount = account ? Number(firstYear[account]) || 0 : 0;
    $(cfg.labelId).textContent = "Step " + String(idx + 1) + ". Put money into " + (accountLabel[account] || "registered accounts");
    $(cfg.valueId).textContent = fmtMoney(amount);
    $(cfg.noteId).textContent =
      amount > 0
        ? "Most efficient next use of registered room under current assumptions. " + (accountReason[account] || "")
        : "No allocation here under current contribution-room constraints.";

    const li = document.createElement("li");
    li.textContent =
      "Step " + String(idx + 1) + ": " + (accountLabel[account] || "Registered account") + " -> " + fmtMoney(amount);
    list.appendChild(li);
  });

  const unallocated = Number(firstYear.unallocated) || 0;
  $("step4Label").textContent = "Step 4. Residual funds after maxing registered room";
  $("step4Value").textContent = fmtMoney(unallocated);
  $("step4Note").textContent =
    unallocated > 0
      ? "This amount needs to go into non-registered accounts under current contribution-room limits."
      : "No residual funds remain after maxing registered account room.";

  if (unallocated > 0) {
    const li = document.createElement("li");
    li.textContent = "Step 4: Residual (non-registered) -> " + fmtMoney(unallocated);
    list.appendChild(li);

    leftover.textContent =
      "The unallocated amount is treated as non-registered cash in this model. You can use it to top up registered accounts in a future year when new room becomes available.";
  }
}

function renderEndingAccountTotals(inputs, optimal) {
  if (!optimal || !optimal.breakdown) {
    $("endingTfsa").textContent = "$—";
    $("endingRrsp").textContent = "$—";
    $("endingFhsa").textContent = "$—";
    $("endingNonRegistered").textContent = "$—";
    $("endingTotalAllAccounts").textContent = "$—";
    return;
  }

  const breakdown = optimal.breakdown;
  const tRet = clamp(Number(inputs.t_ret) / 100, 0, 1);
  const tfsaEnding = (Number(breakdown.tfsa) || 0) + (Number(breakdown.refund) || 0);
  const rrspEnding = (Number(breakdown.rrspPretax) || 0) * (1 - tRet);
  const fhsaRaw = Number(breakdown.fhsa) || 0;
  const fhsaEnding = inputs.fhsaHomeQualified ? fhsaRaw : fhsaRaw * (1 - tRet);
  const nonRegisteredEnding = Number(breakdown.unallocated) || 0;
  const totalEndingAllAccounts = tfsaEnding + rrspEnding + fhsaEnding + nonRegisteredEnding;

  $("endingTfsa").textContent = fmtMoney(tfsaEnding);
  $("endingRrsp").textContent = fmtMoney(rrspEnding);
  $("endingFhsa").textContent = fmtMoney(fhsaEnding);
  $("endingNonRegistered").textContent = fmtMoney(nonRegisteredEnding);
  $("endingTotalAllAccounts").textContent = fmtMoney(totalEndingAllAccounts);
}

function syncRealToggle() {
  const on = $("realToggle").checked;
  $("inflationWrap").classList.toggle("hidden", !on);
}

function syncFhsaVisibility() {
  const eligible = $("fhsaEligible").checked;
  $("fhsaFields").classList.toggle("hidden", !eligible);
}

function syncTaxEngineVisibility() {
  const on = $("useTaxEngineRate").checked;
  $("taxEngineInputs").classList.toggle("hidden", !on);
  if (!on) {
    $("tNow").disabled = false;
  }
}

function wireEvents() {
  [
    "contributionAmount",
    "tfsaRoomAvailable",
    "rrspRoomAvailable",
    "horizonYears",
    "annualReturn",
    "annualFees",
    "inflationRate",
    "tNow",
    "tRet",
    "fhsaAnnualRoom",
    "fhsaRoomAvailable",
    "taxableIncomeNow"
  ].forEach((id) => {
    $(id).addEventListener("input", () => {
      render().catch((err) => console.error("Render failed", err));
    });
  });

  $("contributionMode").addEventListener("change", () => {
    render().catch((err) => console.error("Render failed", err));
  });

  $("realToggle").addEventListener("change", () => {
    syncRealToggle();
    render().catch((err) => console.error("Render failed", err));
  });

  $("refundReinvest").addEventListener("change", () => {
    render().catch((err) => console.error("Render failed", err));
  });

  $("fhsaEligible").addEventListener("change", () => {
    syncFhsaVisibility();
    render().catch((err) => console.error("Render failed", err));
  });

  $("fhsaHomeQualified").addEventListener("change", () => {
    render().catch((err) => console.error("Render failed", err));
  });

  $("useTaxEngineRate").addEventListener("change", () => {
    syncTaxEngineVisibility();
    render().catch((err) => console.error("Render failed", err));
  });

  $("taxYearNow").addEventListener("change", () => {
    render().catch((err) => console.error("Render failed", err));
  });

  $("provinceNow").addEventListener("change", () => {
    render().catch((err) => console.error("Render failed", err));
  });
}

export function initTfsaRrspFhsaUI() {
  syncRealToggle();
  syncFhsaVisibility();
  syncTaxEngineVisibility();
  wireEvents();
  render().catch((err) => console.error("Render failed", err));
}

// Auto-init when loaded as module from the page
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    try {
      initTfsaRrspFhsaUI();
    } catch (err) {
      console.error("Failed to init TFSA/RRSP/FHSA UI", err);
    }
  });
} else {
  try {
    initTfsaRrspFhsaUI();
  } catch (err) {
    console.error("Failed to init TFSA/RRSP/FHSA UI", err);
  }
}

