// TFSA vs RRSP vs FHSA Calculator – UI glue (no math logic)

import {
  runAccountStrategySimulation,
  computeRrspNewAnnualRoom,
  RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP,
  describeStrategyAccountOrder,
  buildTfsaShareScenario,
  parseTfsaShareQuery
} from "./engine.js";
import {
  computeRrspContributionRoom,
  getRrspDollarCap
} from "../canada-income-tax/js/rrsp-room.js";
import { getTaxDataBundle } from "../canada-income-tax/js/tax.data.js";
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

function fmtYears(n) {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function futureValueCaption(horizonYears, useRealDollars) {
  const y = fmtYears(horizonYears);
  const yrWord = y === "1" ? "year" : "years";
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
let taxDataBundle = null;
/** When true, RRSP total room is not overwritten by income/carry-forward changes. */
let rrspRoomManualOverride = false;

const AVAILABLE_TAX_YEARS = [2025, 2026];
const DEFAULT_TAX_YEAR = 2026;

function selectedTaxYear() {
  const el = document.getElementById("taxYear");
  const y = el ? Number.parseInt(el.value, 10) : DEFAULT_TAX_YEAR;
  return AVAILABLE_TAX_YEARS.includes(y) ? y : DEFAULT_TAX_YEAR;
}

async function loadTaxBundleForYear(year) {
  const y = AVAILABLE_TAX_YEARS.includes(year) ? year : DEFAULT_TAX_YEAR;
  taxDataReady = false;
  taxDataBundle = await getTaxDataBundle(y, {
    basePath: "/calculators/canada-income-tax/data"
  });
  taxDataReady = true;
  return taxDataBundle;
}

function getFederalRrspParams() {
  const fed = taxDataBundle?.federal;
  return {
    taxYear: fed?.year,
    rrspDollarMax: fed?.rrspDollarMax,
    roomRate: fed?.rrspRoomRate ?? 0.18
  };
}

function estimateRrspOpeningRoom(income, carryforward) {
  const params = getFederalRrspParams();
  const room = computeRrspContributionRoom({
    taxYear: params.taxYear,
    priorEarnedIncome: income,
    unusedRoom: Math.max(0, carryforward),
    rrspDollarMax: params.rrspDollarMax,
    roomRate: params.roomRate
  });
  return {
    total: Math.max(0, room.estimatedAvailableRoom),
    newRoom: room.newRoom,
    carryforward: Math.max(0, carryforward),
    dollarCap: room.dollarCap ?? getRrspDollarCap({ rrspDollarMax: params.rrspDollarMax, taxYear: params.taxYear })
  };
}

function syncRrspRemainingRoom() {
  if (rrspRoomManualOverride) return;
  const income = numFromInput("currentTaxableIncome");
  const carry = numFromInput("rrspUnusedCarryforward");
  const safeIncome = Number.isFinite(income) && income >= 0 ? income : 0;
  const safeCarry = Number.isFinite(carry) && carry >= 0 ? carry : 0;
  const est = estimateRrspOpeningRoom(safeIncome, safeCarry);
  $("rrspRemainingRoom").value = Math.round(est.total);
}

function updateRrspRoomHint() {
  const hint = document.getElementById("rrspRoomHint");
  if (!hint) return;
  if (!taxDataReady) {
    hint.textContent = "";
    return;
  }
  const income = numFromInput("currentTaxableIncome");
  const carry = numFromInput("rrspUnusedCarryforward");
  const safeIncome = Number.isFinite(income) && income >= 0 ? income : 0;
  const safeCarry = Number.isFinite(carry) && carry >= 0 ? carry : 0;
  const est = estimateRrspOpeningRoom(safeIncome, safeCarry);
  const pct = Math.round(getFederalRrspParams().roomRate * 100);
  const base =
    `Estimated: ${fmtMoney(est.newRoom)} new room (${pct}% of ${fmtMoney(safeIncome)}, capped at ${fmtMoney(est.dollarCap)})` +
    (safeCarry > 0 ? ` + ${fmtMoney(safeCarry)} carry-forward` : "") +
    ` = ${fmtMoney(est.total)} total.`;
  hint.textContent = rrspRoomManualOverride
    ? `${base} You edited the total directly; change income or carry-forward to revert to the estimate.`
    : `${base} Uses the same formula as the RRSP Contribution Room calculator.`;
}

function deriveMarginalRateFromIncome(province, employmentIncome) {
  const result = computePersonalTax(
    {
      year: selectedTaxYear(),
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
    },
    { taxData: taxDataBundle }
  );
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

  let rrspUnusedCarryforward = numFromInput("rrspUnusedCarryforward");
  if (!Number.isFinite(rrspUnusedCarryforward) || rrspUnusedCarryforward < 0) {
    rrspUnusedCarryforward = 0;
  }

  const rrspParams = getFederalRrspParams();
  const rrspAnnualNewRoomCap = getRrspDollarCap({
    taxYear: rrspParams.taxYear,
    rrspDollarMax: rrspParams.rrspDollarMax
  });

  const fhsaEligible = $("fhsaEligible").checked;
  const fhsaHomeQualified = fhsaEligible ? $("fhsaHomeQualified").checked : false;
  let fhsaAnnualRoom = numFromInput("fhsaAnnualRoom");
  if (!Number.isFinite(fhsaAnnualRoom) || fhsaAnnualRoom < 0) fhsaAnnualRoom = 8000;

  let tfsaNewAnnualRoom = numFromInput("tfsaNewAnnualRoom");
  if (!Number.isFinite(tfsaNewAnnualRoom) || tfsaNewAnnualRoom < 0) tfsaNewAnnualRoom = 7000;

  const taxYear = selectedTaxYear();

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
    taxYear,
    taxData: taxDataBundle,
    currentTaxableIncome,
    contributionYearIncome: currentTaxableIncome,
    retirementTaxableIncome,
    t_now,
    t_ret,
    refundMode,
    refundDest: "tfsa",
    tfsaRemainingRoom,
    rrspRemainingRoom,
    rrspUnusedCarryforward,
    rrspAnnualNewRoomCap,
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

  const rrspJanuaryBump = computeRrspNewAnnualRoom(inputs.currentTaxableIncome, {
    dollarCap: inputs.rrspAnnualNewRoomCap ?? RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP,
    roomRate: getFederalRrspParams().roomRate,
    taxYear: getFederalRrspParams().taxYear
  });
  $("roomAccrualHint").textContent =
    `Starting in simulation year 2, each January adds ${fmtMoney(inputs.tfsaNewAnnualRoom)} to TFSA room and ${fmtMoney(rrspJanuaryBump)} to RRSP room (18% of current taxable income, capped at ${fmtMoney(inputs.rrspAnnualNewRoomCap ?? RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP)}), in addition to any carry-forward you have not used.`;
  updateRrspRoomHint();

  try {
    window.localStorage.setItem("tlm_tfsa_rrsp_fhsa_lastInputs", JSON.stringify(inputs));
  } catch (e) {
    // ignore storage errors
  }

  if (!taxDataReady) {
    $("derivedRateSummary").textContent = "Loading tax tables for progressive contribution-year refunds…";
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

  // Year-1 progressive refund from optimal strategy meta (not contribution × t_now).
  const _optMeta = strategies.OPTIMAL?.meta || {};
  const _optY1 = _optMeta.year1Allocation || {};
  const year1Deductible =
    (_optY1.rrspDirect || 0) + (_optY1.fhsaDirect || 0);
  const estimatedRefundOptimal = Number.isFinite(_optMeta.year1ProgressiveRefund)
    ? _optMeta.year1ProgressiveRefund
    : year1Deductible * (inputs.t_now / 100);

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
    const optMeta = strategies.OPTIMAL?.meta || {};
    const estimatedRefund = Number.isFinite(optMeta.year1ProgressiveRefund)
      ? optMeta.year1ProgressiveRefund
      : ((y1.rrsp || 0) + (y1.fhsa || 0)) * (inputs.t_now / 100);
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
        `TFSA first remains optimal under this contribution-year income and retirement rate assumption ` +
        `(next-dollar t_now ${fmtPct(inputs.t_now)}; t_ret ${fmtPct(inputs.t_ret)}). ` +
        `If you expect a lower retirement rate, RRSP or FHSA may become the better choice.`;
    }
  }
  if (inputs.manualRateOverride) {
    $("derivedRateSummary").textContent =
      `Contribution-year refunds use progressive tax on employment income ${fmtMoney(inputs.currentTaxableIncome)} ` +
      `(${inputs.taxProvince}, tax year ${inputs.taxYear}; CPP/EI path). ` +
      `Manual override: t_now ${fmtPct(inputs.t_now)} is display-only (does not set the refund); ` +
      `t_ret ${fmtPct(inputs.t_ret)} still taxes RRSP (and non-qualified FHSA) withdrawals.`;
  } else {
    $("derivedRateSummary").textContent =
      `Contribution-year refunds use progressive tax on employment income ${fmtMoney(inputs.currentTaxableIncome)} ` +
      `(${inputs.taxProvince}, tax year ${inputs.taxYear}; CPP/EI path) — not contribution × one marginal rate. ` +
      `Displayed next-dollar rates: t_now ${fmtPct(inputs.t_now)} from that income; ` +
      `t_ret ${fmtPct(inputs.t_ret)} from ${fmtMoney(inputs.retirementTaxableIncome)} (withdrawal assumption).`;
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

const STEPPER_STEPS = {
  contributionAmount: 50,
  horizonYears: 1,
  annualReturn: 0.1,
  annualFees: 0.05,
  inflationRate: 0.1,
  currentTaxableIncome: 1000,
  retirementTaxableIncome: 1000,
  tNow: 0.5,
  tRet: 0.5,
  rrspUnusedCarryforward: 500,
  tfsaRemainingRoom: 500,
  rrspRemainingRoom: 500,
  tfsaNewAnnualRoom: 500,
  fhsaAnnualRoom: 1000
};

function wireNumericSteppers() {
  document.querySelectorAll(".input-with-unit.numeric-combo").forEach((wrap) => {
    const input = wrap.querySelector('input[type="number"]');
    if (!input || input.dataset.tlmStepperWired === "1") return;
    input.dataset.tlmStepperWired = "1";
    const fire = () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const adjust = (direction) => {
      const step = STEPPER_STEPS[input.id] || 1;
      const current = Number.isFinite(Number(input.value)) ? Number(input.value) : 0;
      const min = Number.isFinite(Number(input.min)) ? Number(input.min) : -Infinity;
      const max = Number.isFinite(Number(input.max)) ? Number(input.max) : Infinity;
      const next = Math.min(max, Math.max(min, current + direction * step));
      input.value = String(Math.round(next * 1000000) / 1000000);
      fire();
    };
    wrap.querySelector(".step-up")?.addEventListener("click", (e) => {
      e.preventDefault();
      adjust(1);
    });
    wrap.querySelector(".step-down")?.addEventListener("click", (e) => {
      e.preventDefault();
      adjust(-1);
    });
  });
}

function wireEvents() {
  const onIncomeOrCarryforwardChange = () => {
    rrspRoomManualOverride = false;
    syncRrspRemainingRoom();
    render();
  };

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
    "rrspUnusedCarryforward",
    "fhsaAnnualRoom",
    "tfsaNewAnnualRoom"
  ].forEach((id) => {
    $(id).addEventListener("input", () => {
      if (id === "currentTaxableIncome" || id === "rrspUnusedCarryforward") {
        onIncomeOrCarryforwardChange();
        return;
      }
      render();
    });
  });

  $("rrspRemainingRoom").addEventListener("input", () => {
    rrspRoomManualOverride = true;
    render();
  });

  $("contributionMode").addEventListener("change", () => {
    render();
  });

  $("taxProvince").addEventListener("change", () => {
    render();
  });

  $("taxYear").addEventListener("change", () => {
    loadTaxBundleForYear(selectedTaxYear())
      .then(() => {
        if (!rrspRoomManualOverride) syncRrspRemainingRoom();
        render();
      })
      .catch((err) => {
        console.error("Failed to load tax data for selected year", err);
      });
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
    const y = fmtYears(inputs.horizonYears);
    const scenario = buildTfsaShareScenario(inputs);
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

function applyScenarioFromUrl() {
  try {
    const parsed = parseTfsaShareQuery(new URLSearchParams(window.location.search || ""));
    if (!parsed) return;

    const setVal = (id, value) => {
      if (value == null || value === "") return;
      const el = document.getElementById(id);
      if (el) el.value = String(value);
    };
    const setCheck = (id, value) => {
      if (value == null) return;
      const el = document.getElementById(id);
      if (el) el.checked = !!value;
    };

    setVal("contributionMode", parsed.contributionMode);
    setVal("contributionAmount", parsed.contributionAmount);
    setVal("horizonYears", parsed.horizonYears);
    setVal("annualReturn", parsed.annualReturn);
    setVal("annualFees", parsed.annualFees);
    setVal("inflationRate", parsed.inflation);
    setCheck("realToggle", parsed.useRealDollars);
    setVal("taxProvince", parsed.taxProvince);
    setVal("taxYear", parsed.taxYear);
    setVal("currentTaxableIncome", parsed.currentTaxableIncome);
    setVal("retirementTaxableIncome", parsed.retirementTaxableIncome);
    setCheck("manualRateOverride", parsed.manualRateOverride);
    setVal("tNow", parsed.t_now);
    setVal("tRet", parsed.t_ret);
    if (parsed.refundMode) {
      setCheck("refundReinvest", parsed.refundMode === "reinvest");
    }
    setVal("tfsaRemainingRoom", parsed.tfsaRemainingRoom);
    setVal("rrspUnusedCarryforward", parsed.rrspUnusedCarryforward);
    setCheck("fhsaEligible", parsed.fhsaEligible);
    setCheck("fhsaHomeQualified", parsed.fhsaHomeQualified);
    setVal("fhsaAnnualRoom", parsed.fhsaAnnualRoom);
    setVal("tfsaNewAnnualRoom", parsed.tfsaNewAnnualRoom);

    if (parsed.rrspRemainingRoomSpecified) {
      setVal("rrspRemainingRoom", parsed.rrspRemainingRoom);
      rrspRoomManualOverride = true;
    }

    if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
      window.TLM.shareCard.track("calculator_shared_scenario_loaded", {
        calculator_name: "tfsa-rrsp-fhsa"
      });
    }
  } catch (_err) {
    /* ignore malformed query */
  }
}

export function initTfsaRrspFhsaUI() {
  $("manualRateOverride").checked = false;
  rrspRoomManualOverride = false;
  wireNumericSteppers();
  wireEvents();
  applyScenarioFromUrl();
  syncRateModeVisibility();
  syncRealToggle();
  syncFhsaVisibility();
  syncRefundLabels();
  if (!rrspRoomManualOverride) syncRrspRemainingRoom();
  render();
  wireTfsaShare();
}

// Auto-init when loaded as module from the page
async function bootTfsaRrspFhsa() {
  try {
    // Apply URL tax year before first bundle load when present
    const parsed = parseTfsaShareQuery(new URLSearchParams(window.location.search || ""));
    if (parsed?.taxYear != null && document.getElementById("taxYear")) {
      document.getElementById("taxYear").value = String(parsed.taxYear);
    }
    await loadTaxBundleForYear(selectedTaxYear());
    initTfsaRrspFhsaUI();
  } catch (err) {
    console.error("Failed to load tax data for TFSA/RRSP/FHSA calculator", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootTfsaRrspFhsa();
  });
} else {
  bootTfsaRrspFhsa();
}

