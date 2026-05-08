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

let taxDataReady = false;

function deriveMarginalRateFromIncome(province, employmentIncome) {
  const result = computePersonalTax({
    year: 2025,
    province,
    employmentIncome,
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
  return (result?.totals?.marginalRate ?? 0) * 100;
}

function readInputs() {
  const modeEl = $("contributionMode");
  const contributionMode = modeEl.value;

  let contributionAmount = numFromInput("contributionAmount");
  if (!Number.isFinite(contributionAmount) || contributionAmount < 0) contributionAmount = 0;

  const horizonYears = clamp(numFromInput("horizonYears"), 1, 80);
  const annualReturn = clamp(numFromInput("annualReturn"), -50, 50);
  const annualFees = clamp(numFromInput("annualFees"), 0, 5);

  const useRealDollars = $("realToggle").checked;
  let inflation = numFromInput("inflationRate");
  if (!Number.isFinite(inflation) || inflation < 0) inflation = 0;

  const manualRateOverride = $("manualRateOverride").checked;
  const taxProvince = $("taxProvince").value || "ON";
  let currentTaxableIncome = numFromInput("currentTaxableIncome");
  if (!Number.isFinite(currentTaxableIncome) || currentTaxableIncome < 0) currentTaxableIncome = 0;
  let retirementTaxableIncome = numFromInput("retirementTaxableIncome");
  if (!Number.isFinite(retirementTaxableIncome) || retirementTaxableIncome < 0) retirementTaxableIncome = 0;

  let t_now;
  let t_ret;
  if (manualRateOverride) {
    t_now = clamp(numFromInput("tNow"), 0, 100);
    t_ret = clamp(numFromInput("tRet"), 0, 100);
  } else {
    t_now = clamp(deriveMarginalRateFromIncome(taxProvince, currentTaxableIncome), 0, 100);
    t_ret = clamp(deriveMarginalRateFromIncome(taxProvince, retirementTaxableIncome), 0, 100);
  }

  const refundMode = $("refundReinvest").checked ? "reinvest" : "spend";

  let tfsaRemainingRoom = numFromInput("tfsaRemainingRoom");
  if (!Number.isFinite(tfsaRemainingRoom) || tfsaRemainingRoom < 0) tfsaRemainingRoom = 0;

  let rrspRemainingRoom = numFromInput("rrspRemainingRoom");
  if (!Number.isFinite(rrspRemainingRoom) || rrspRemainingRoom < 0) rrspRemainingRoom = 0;

  const fhsaEligible = $("fhsaEligible").checked;
  const fhsaHomeQualified = $("fhsaHomeQualified").checked;
  let fhsaAnnualRoom = numFromInput("fhsaAnnualRoom");
  if (!Number.isFinite(fhsaAnnualRoom) || fhsaAnnualRoom < 0) fhsaAnnualRoom = 8000;

  return {
    contributionMode,
    contributionAmount,
    horizonYears,
    annualReturn,
    annualFees,
    inflation,
    useRealDollars,
    manualRateOverride,
    taxProvince,
    currentTaxableIncome,
    retirementTaxableIncome,
    t_now,
    t_ret,
    refundMode,
    refundDest: "tfsa",
    tfsaRemainingRoom,
    rrspRemainingRoom,
    fhsaEligible,
    fhsaHomeQualified,
    fhsaAnnualRoom
  };
}

function render() {
  if (!taxDataReady) {
    $("derivedRateSummary").textContent = "Loading tax tables...";
    return;
  }

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

  let result;
  try {
    result = runAccountStrategySimulation(inputs);
  } catch (err) {
    console.error("Simulation error", err);
    return;
  }

  const { strategies, ranking, allocationSummary } = result;

  const best = ranking[0] || null;

  // Winner label
  if (best) {
    $("winnerName").textContent = prettyStrategyName(best.key);
    $("winnerValue").textContent = fmtMoney(best.finalAfterTax);
  } else {
    $("winnerName").textContent = "—";
    $("winnerValue").textContent = "$—";
  }

  // Individual tiles
  setTile("tfsaValue", strategies.ALL_TFSA?.finalAfterTax);
  setTile("rrspValue", strategies.ALL_RRSP?.finalAfterTax);
  if (strategies.ALL_FHSA && inputs.fhsaEligible) {
    $("fhsaTile").classList.remove("hidden");
    setTile("fhsaValue", strategies.ALL_FHSA.finalAfterTax);
  } else {
    $("fhsaTile").classList.add("hidden");
  }

  if (strategies.OPTIMAL && inputs.fhsaEligible) {
    $("optimalTile").classList.remove("hidden");
    setTile("optimalValue", strategies.OPTIMAL.finalAfterTax);
  } else {
    $("optimalTile").classList.add("hidden");
  }

  // Ranking list
  const rankingList = $("rankingList");
  rankingList.innerHTML = "";
  ranking.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = `${prettyStrategyName(r.key)} – ${fmtMoney(r.finalAfterTax)}`;
    rankingList.appendChild(li);
  });

  // Optimal split sentence
  if (allocationSummary) {
    const dest = allocationSummary.remainderDestination || "TFSA";
    if (inputs.fhsaEligible) {
      $("optimalSplit").textContent =
        `This year: ${fmtMoney(allocationSummary.fhsaUsedAnnual)} to FHSA (up to the modeled annual room), ` +
        `and approximately ${fmtMoney(allocationSummary.remainderAnnual)} to ${dest}.`;
    } else {
      $("optimalSplit").textContent =
        "FHSA not available. Optimal comparison is between TFSA and RRSP only.";
    }
    $("allocationNote").textContent = allocationSummary.noteText || "";
    const capStatus = allocationSummary.capStatus || {};
    const capNotes = [];
    if (capStatus.rrspCapReached) {
      capNotes.push(`RRSP cap reached at ${fmtMoney(capStatus.rrspCap)}`);
    }
    if (capStatus.tfsaCapReached) {
      capNotes.push(`TFSA cap reached at ${fmtMoney(capStatus.tfsaCap)}`);
    }
    if (capNotes.length > 0) {
      $("allocationNote").textContent += ` ${capNotes.join("; ")}. Overflow is redirected by strategy rules.`;
    }

    const y1 = allocationSummary.year1Allocation || {};
    const priorities = [
      { key: "FHSA", value: y1.fhsa || 0 },
      { key: "TFSA", value: y1.tfsa || 0 },
      { key: "RRSP", value: y1.rrsp || 0 },
      { key: "Non-registered", value: y1.nonRegistered || 0 }
    ].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);

    if (priorities.length > 0) {
      $("allocationPriority").textContent =
        "Priority allocation (year 1): " +
        priorities.map((p) => `${p.key} ${fmtMoney(p.value)}`).join(" → ");
    } else {
      $("allocationPriority").textContent = "";
    }
  }

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
          `If RRSP refunds were reinvested to TFSA first (up to room), then non-registered, the RRSP strategy here would end about ${fmtMoney(diff)} higher.`;
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
      "Refunds are assumed reinvested to TFSA first (up to room), then non-registered. To model a more conservative case, toggle refunds to 'spent'.";
  }
  if (inputs.manualRateOverride) {
    $("derivedRateSummary").textContent = `Manual override active: t_now ${fmtPct(inputs.t_now)}, t_ret ${fmtPct(inputs.t_ret)}.`;
  } else {
    $("derivedRateSummary").textContent = `Derived rates (${inputs.taxProvince}): t_now ${fmtPct(inputs.t_now)} from ${fmtMoney(inputs.currentTaxableIncome)} income; t_ret ${fmtPct(inputs.t_ret)} from ${fmtMoney(inputs.retirementTaxableIncome)} income.`;
  }
}

function setTile(id, value) {
  const el = $(id);
  el.textContent = fmtMoney(value);
}

function prettyStrategyName(key) {
  switch (key) {
    case "ALL_TFSA":
      return "TFSA-first (overflow RRSP, then non-registered)";
    case "ALL_RRSP":
      return "RRSP-first (overflow TFSA, then non-registered)";
    case "ALL_FHSA":
      return "FHSA-first (overflow TFSA, then RRSP, then non-registered)";
    case "OPTIMAL":
      return "Optimal constrained allocation";
    default:
      return key;
  }
}

function syncRealToggle() {
  const on = $("realToggle").checked;
  $("inflationWrap").classList.toggle("hidden", !on);
}

function syncFhsaVisibility() {
  const eligible = $("fhsaEligible").checked;
  $("fhsaFields").classList.toggle("hidden", !eligible);
}

function syncRefundLabels() {
  const reinvest = $("refundReinvest").checked;
  $("refundModeLabel").textContent = reinvest
    ? "Reinvest refunds to TFSA up to remaining room; any excess goes to non-registered."
    : "Spend refund immediately";
}

function syncRateModeVisibility() {
  const manual = $("manualRateOverride").checked;
  $("manualRateFields").classList.toggle("hidden", !manual);
}

function wireEvents() {
  [
    "contributionAmount",
    "horizonYears",
    "annualReturn",
    "annualFees",
    "inflationRate",
    "currentTaxableIncome",
    "retirementTaxableIncome",
    "tNow",
    "tRet",
    "tfsaRemainingRoom",
    "rrspRemainingRoom",
    "fhsaAnnualRoom"
  ].forEach((id) => {
    $(id).addEventListener("input", () => {
      render();
    });
  });

  $("contributionMode").addEventListener("change", () => {
    render();
  });

  $("taxProvince").addEventListener("change", () => {
    render();
  });

  $("realToggle").addEventListener("change", () => {
    syncRealToggle();
    render();
  });

  $("refundReinvest").addEventListener("change", () => {
    syncRefundLabels();
    render();
  });

  $("manualRateOverride").addEventListener("change", () => {
    syncRateModeVisibility();
    render();
  });

  $("fhsaEligible").addEventListener("change", () => {
    syncFhsaVisibility();
    render();
  });

  $("fhsaHomeQualified").addEventListener("change", () => {
    render();
  });
}

export function initTfsaRrspFhsaUI() {
  syncRateModeVisibility();
  syncRealToggle();
  syncFhsaVisibility();
  syncRefundLabels();
  wireEvents();
  render();
}

// Auto-init when loaded as module from the page
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    loadTaxData(2025, { basePath: "/calculators/canada-income-tax/data" })
      .then(() => {
        taxDataReady = true;
        initTfsaRrspFhsaUI();
      })
      .catch((err) => {
        console.error("Failed to load tax data for TFSA/RRSP/FHSA calculator", err);
      });
  });
} else {
  loadTaxData(2025, { basePath: "/calculators/canada-income-tax/data" })
    .then(() => {
      taxDataReady = true;
      initTfsaRrspFhsaUI();
    })
    .catch((err) => {
      console.error("Failed to load tax data for TFSA/RRSP/FHSA calculator", err);
    });
}

