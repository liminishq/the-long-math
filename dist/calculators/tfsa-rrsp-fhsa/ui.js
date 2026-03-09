// TFSA vs RRSP vs FHSA Calculator – UI glue (no math logic)

import { runAccountStrategySimulation } from "./engine.js";

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

  const t_now = clamp(numFromInput("tNow"), 0, 100);
  const t_ret = clamp(numFromInput("tRet"), 0, 100);

  const refundMode = $("refundReinvest").checked ? "reinvest" : "spend";

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
    t_now,
    t_ret,
    refundMode,
    refundDest: "tfsa",
    fhsaEligible,
    fhsaHomeQualified,
    fhsaAnnualRoom
  };
}

function render() {
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
  if (allocationSummary && inputs.fhsaEligible) {
    const dest = allocationSummary.remainderDestination || "TFSA";
    $("optimalSplit").textContent =
      `This year: ${fmtMoney(allocationSummary.fhsaUsedAnnual)} to FHSA (up to the modeled annual room), ` +
      `and approximately ${fmtMoney(allocationSummary.remainderAnnual)} to ${dest}.`;
    $("allocationNote").textContent = allocationSummary.noteText || "";
  } else if (!inputs.fhsaEligible) {
    $("optimalSplit").textContent =
      "FHSA not available. Optimal comparison is between TFSA and RRSP only.";
    $("allocationNote").textContent = "";
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

function setTile(id, value) {
  const el = $(id);
  el.textContent = fmtMoney(value);
}

function prettyStrategyName(key) {
  switch (key) {
    case "ALL_TFSA":
      return "All contributions to TFSA";
    case "ALL_RRSP":
      return "All contributions to RRSP";
    case "ALL_FHSA":
      return "FHSA first (overflow TFSA)";
    case "OPTIMAL":
      return "Optimal (FHSA first, then TFSA/RRSP)";
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
  $("refundModeLabel").textContent = reinvest ? "Reinvest refund (TFSA-like)" : "Spend refund immediately";
}

function wireEvents() {
  [
    "contributionAmount",
    "horizonYears",
    "annualReturn",
    "annualFees",
    "inflationRate",
    "tNow",
    "tRet",
    "fhsaAnnualRoom"
  ].forEach((id) => {
    $(id).addEventListener("input", () => {
      render();
    });
  });

  $("contributionMode").addEventListener("change", () => {
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

  $("fhsaEligible").addEventListener("change", () => {
    syncFhsaVisibility();
    render();
  });

  $("fhsaHomeQualified").addEventListener("change", () => {
    render();
  });
}

export function initTfsaRrspFhsaUI() {
  syncRealToggle();
  syncFhsaVisibility();
  syncRefundLabels();
  wireEvents();
  render();
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

