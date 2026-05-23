// TFSA vs RRSP vs FHSA Calculator – UI glue (no math logic)

import {
  runAccountStrategySimulation,
  computeRrspNewAnnualRoom,
  RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP,
  describeStrategyAccountOrder
} from "./engine.js";
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

function futureValueCaption(horizonYears, useRealDollars) {
  const y = Math.round(horizonYears);
  const yrWord = y === 1 ? "year" : "years";
  const realBit = useRealDollars ? "; real (inflation-adjusted) dollars" : "";
  return `After-tax future value (${y}-${yrWord} horizon${realBit})`;
}

function fmtDeltaVsBest(diff) {
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.005) return "—";
  const sign = diff < 0 ? "−" : "+";
  return sign + fmtMoney(Math.abs(diff));
}

/** After-tax economic values at horizon (matches engine withdrawal assumptions). */
function horizonAfterTaxByAccount(breakdown, inputs) {
  if (!breakdown) return null;
  const tr = clamp(inputs.t_ret, 0, 100) / 100;
  const tfsa = breakdown.tfsa ?? 0;
  const rrspAfter = (breakdown.rrspPretax ?? 0) * (1 - tr);
  const fhsaPre = breakdown.fhsa ?? 0;
  let fhsaAfter = 0;
  if (inputs.fhsaEligible) {
    fhsaAfter = inputs.fhsaHomeQualified ? fhsaPre : fhsaPre * (1 - tr);
  }
  const nonReg = breakdown.nonRegistered ?? 0;
  return { tfsa, rrspAfter, fhsaAfter, nonReg };
}

function resetHorizonBalancesUi() {
  const ids = ["horizonTfsa", "horizonRrsp", "horizonFhsa", "horizonNonReg"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.textContent = "$—";
  }
  const wrap = document.getElementById("horizonFhsaWrap");
  if (wrap) wrap.classList.add("hidden");
  const note = document.getElementById("horizonBalancesNote");
  if (note) note.textContent = "";
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
  const fhsaHomeQualified = fhsaEligible;
  let fhsaAnnualRoom = numFromInput("fhsaAnnualRoom");
  if (!Number.isFinite(fhsaAnnualRoom) || fhsaAnnualRoom < 0) fhsaAnnualRoom = 8000;

  let tfsaNewAnnualRoom = numFromInput("tfsaNewAnnualRoom");
  if (!Number.isFinite(tfsaNewAnnualRoom) || tfsaNewAnnualRoom < 0) tfsaNewAnnualRoom = 7000;

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
    fhsaAnnualRoom,
    fhsaLifetimeCap: 40000,
    tfsaNewAnnualRoom
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

  const rrspJanuaryBump = computeRrspNewAnnualRoom(
    inputs.currentTaxableIncome,
    RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP
  );
  $("roomAccrualHint").textContent =
    `Starting in simulation year 2, each January adds ${fmtMoney(inputs.tfsaNewAnnualRoom)} to TFSA room and ${fmtMoney(rrspJanuaryBump)} to RRSP room (18% of current taxable income, capped at ${fmtMoney(RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP)}), in addition to any carry-forward you have not used.`;

  try {
    window.localStorage.setItem("tlm_tfsa_rrsp_fhsa_lastInputs", JSON.stringify(inputs));
  } catch (e) {
    // ignore storage errors
  }

  if (!taxDataReady) {
    $("derivedRateSummary").textContent = "Loading marginal rates for this scenario…";
    resetHorizonBalancesUi();
    return;
  }

  let result;
  try {
    result = runAccountStrategySimulation(inputs);
  } catch (err) {
    console.error("Simulation error", err);
    resetHorizonBalancesUi();
    return;
  }

  const { strategies, priorityRanking, allocationSummary, optimalStrategyKey } = result;

  // Compute refund for the optimal strategy's year 1 outside the allocationSummary block
  // so it is accessible when rendering the refund hint below.
  const _optY1 = strategies.OPTIMAL?.meta?.year1Allocation || {};
  const estimatedRefundOptimal =
    (((_optY1.rrsp || 0) + (_optY1.fhsa || 0)) * (inputs.t_now / 100));

  // Top strategy card is based on the scenario-constrained optimal allocation.
  if (strategies.OPTIMAL) {
    $("winnerName").textContent = describeStrategyAccountOrder(
      optimalStrategyKey || "ALL_TFSA",
      inputs.fhsaEligible
    );
    $("winnerValueLabel").textContent = futureValueCaption(inputs.horizonYears, inputs.useRealDollars);
    $("winnerValue").textContent = fmtMoney(strategies.OPTIMAL.finalAfterTax);

    const hz = horizonAfterTaxByAccount(strategies.OPTIMAL.breakdown, inputs);
    if (hz) {
      $("horizonTfsa").textContent = fmtMoney(hz.tfsa);
      $("horizonRrsp").textContent = fmtMoney(hz.rrspAfter);
      $("horizonNonReg").textContent = fmtMoney(hz.nonReg);
      if (inputs.fhsaEligible) {
        $("horizonFhsaWrap").classList.remove("hidden");
        $("horizonFhsa").textContent = fmtMoney(hz.fhsaAfter);
        const hint = $("horizonFhsaTaxHint");
        hint.textContent = inputs.fhsaHomeQualified ? "(tax-free)" : "(after t_ret)";
      } else {
        $("horizonFhsaWrap").classList.add("hidden");
      }
      $("horizonBalancesNote").textContent =
        "Shown amounts are spendable after-tax at withdrawal under this model (same components as the headline total).";
    } else {
      resetHorizonBalancesUi();
    }
  } else {
    $("winnerName").textContent = "—";
    $("winnerValueLabel").textContent = "After-tax future value";
    $("winnerValue").textContent = "$—";
    resetHorizonBalancesUi();
  }

  const tbody = $("priorityRankingBody");
  tbody.innerHTML = "";
  const bestVal =
    priorityRanking && priorityRanking.length > 0 ? priorityRanking[0].finalAfterTax : NaN;
  (priorityRanking || []).forEach((row) => {
    const tr = document.createElement("tr");
    if (row.key === optimalStrategyKey) {
      tr.classList.add("is-optimal-row");
    }
    const vs =
      Number.isFinite(bestVal) && Number.isFinite(row.finalAfterTax)
        ? row.finalAfterTax - bestVal
        : NaN;
    const vsText = fmtDeltaVsBest(vs);
    tr.innerHTML = `
      <td class="num">${row.rank}</td>
      <td class="order">${describeStrategyAccountOrder(row.key, inputs.fhsaEligible)}</td>
      <td class="num">${fmtMoney(row.finalAfterTax)}</td>
      <td class="num vs">${vsText}</td>
    `;
    tbody.appendChild(tr);
  });

  // Optimal split sentence
  if (allocationSummary) {
    const dest = allocationSummary.remainderDestination || "TFSA";
    if (inputs.fhsaEligible) {
      $("optimalSplit").textContent =
        `This year: ${fmtMoney(allocationSummary.fhsaUsedAnnual)} to FHSA (within annual room and the $40,000 lifetime contribution cap), ` +
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
    $("priorityTfsa").textContent = fmtMoney(y1.tfsa || 0);
    $("priorityRrsp").textContent = fmtMoney(y1.rrsp || 0);
    $("priorityFhsa").textContent = fmtMoney(y1.fhsa || 0);
    $("priorityNonReg").textContent = fmtMoney(y1.nonRegistered || 0);

    const initial = allocationSummary.annualContribution || 0;
    const estimatedRefund = ((y1.rrsp || 0) + (y1.fhsa || 0)) * (inputs.t_now / 100);
    const reinvested = inputs.refundMode === "reinvest";
    $("year1Initial").textContent = fmtMoney(initial);
    $("year1Refund").textContent = fmtMoney(estimatedRefund);
    $("year1RefundMode").textContent = reinvested
      ? (estimatedRefund > 0.01 ? "Yes" : "N/A")
      : "No";
    $("year1TotalInvested").textContent = fmtMoney(initial + (reinvested ? estimatedRefund : 0));
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
    if (estimatedRefundOptimal > 0.01) {
      $("refundHint").textContent =
        "Refunds are assumed reinvested to TFSA first (up to room), then non-registered. To model a more conservative case, toggle refunds to 'spent'.";
    } else {
      // The optimal strategy has no RRSP/FHSA contributions in year 1 (TFSA is filled directly),
      // so there is no refund to reinvest. Clarify this to avoid a contradictory recommendation.
      const optLabel = describeStrategyAccountOrder(
        optimalStrategyKey || "ALL_TFSA",
        inputs.fhsaEligible
      );
      $("refundHint").textContent =
        `The optimal strategy (${optLabel}) fills TFSA with direct contributions in year 1 — ` +
        `no RRSP or FHSA contributions are made, so no tax refund is generated to reinvest. ` +
        `The "reinvest refund" setting was used to fairly compare RRSP and FHSA alternatives; ` +
        `TFSA first remains optimal because your current marginal rate (${fmtPct(inputs.t_now)}) ` +
        `is at or below your modelled retirement rate (${fmtPct(inputs.t_ret)}). ` +
        `If you expect a lower retirement rate, RRSP or FHSA may become the better choice.`;
    }
  }
  if (inputs.manualRateOverride) {
    $("derivedRateSummary").textContent =
      `Marginal rates for this scenario: manual override — ${fmtPct(inputs.t_now)} (current); ${fmtPct(inputs.t_ret)} (retirement).`;
  } else {
    $("derivedRateSummary").textContent =
      `Marginal rates for this scenario: (${inputs.taxProvince}) ${fmtPct(inputs.t_now)} from ${fmtMoney(inputs.currentTaxableIncome)} income; ${fmtPct(inputs.t_ret)} from ${fmtMoney(inputs.retirementTaxableIncome)} income.`;
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
  const wrap = $("manualRateFields");
  wrap.classList.toggle("hidden", !manual);
  // Force visibility state in case theme/css rules override `.hidden`.
  wrap.style.display = manual ? "" : "none";
}

function wireNumericSteppers() {
  document.querySelectorAll(".input-with-unit.numeric-combo").forEach((wrap) => {
    const input = wrap.querySelector('input[type="number"]');
    if (!input || input.dataset.tlmStepperWired === "1") return;
    input.dataset.tlmStepperWired = "1";
    const fire = () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    wrap.querySelector(".step-up")?.addEventListener("click", (e) => {
      e.preventDefault();
      input.stepUp();
      fire();
    });
    wrap.querySelector(".step-down")?.addEventListener("click", (e) => {
      e.preventDefault();
      input.stepDown();
      fire();
    });
  });
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
    "fhsaAnnualRoom",
    "tfsaNewAnnualRoom"
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

}

function wireTfsaShare() {
  if (!window.TLM?.shareCard?.wireCalculatorShare || !document.getElementById("share_result_btn")) return;
  window.TLM.shareCard.wireCalculatorShare("tfsa-rrsp-fhsa", () => {
    let inputs;
    try {
      inputs = readInputs();
    } catch (_e) {
      return null;
    }
    let result;
    try {
      result = runAccountStrategySimulation(inputs);
    } catch (_e) {
      return null;
    }
    const opt = result.strategies?.OPTIMAL;
    if (!opt) return null;
    const winnerKey = result.optimalStrategyKey || "ALL_TFSA";
    const winnerLabel = describeStrategyAccountOrder(winnerKey, inputs.fhsaEligible);
    const y = Math.round(inputs.horizonYears);
    const scenario = {
      contribution_mode: inputs.contributionMode,
      contribution_amount: String(inputs.contributionAmount),
      horizon_years: String(y),
      annual_return: String(inputs.annualReturn),
      annual_fees: String(inputs.annualFees),
      inflation: String(inputs.inflation),
      use_real: inputs.useRealDollars ? "1" : "0",
      tax_province: inputs.taxProvince,
      current_taxable_income: String(Math.round(inputs.currentTaxableIncome)),
      retirement_taxable_income: String(Math.round(inputs.retirementTaxableIncome)),
      manual_rate_override: inputs.manualRateOverride ? "1" : "0",
      t_now: String(inputs.t_now),
      t_ret: String(inputs.t_ret),
      refund_mode: inputs.refundMode,
      tfsa_remaining_room: String(Math.round(inputs.tfsaRemainingRoom)),
      rrsp_remaining_room: String(Math.round(inputs.rrspRemainingRoom)),
      fhsa_eligible: inputs.fhsaEligible ? "1" : "0",
      fhsa_annual_room: String(Math.round(inputs.fhsaAnnualRoom)),
      fhsa_lifetime_cap: String(inputs.fhsaLifetimeCap ?? 40000),
      tfsa_new_annual_room: String(Math.round(inputs.tfsaNewAnnualRoom))
    };
    const modeLabel =
      inputs.contributionMode === "monthly"
        ? "Monthly contributions"
        : inputs.contributionMode === "annual"
          ? "Annual contributions"
          : "Lump sum";
    return {
      scenario,
      card: {
        title: "TFSA vs RRSP vs FHSA calculator result",
        headline: "After-tax future value (Canada)",
        mainValue: fmtMoney(opt.finalAfterTax),
        subline: winnerLabel,
        contextLines: [`${modeLabel} · ${y}-year horizon`],
        shareText: `Estimate: ${fmtMoney(opt.finalAfterTax)} (${winnerLabel}). Run your own numbers:`
      }
    };
  });
}

export function initTfsaRrspFhsaUI() {
  $("manualRateOverride").checked = false;
  syncRateModeVisibility();
  syncRealToggle();
  syncFhsaVisibility();
  syncRefundLabels();
  wireNumericSteppers();
  wireEvents();
  render();
  wireTfsaShare();
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

