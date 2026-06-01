/**
 * TFSA vs RRSP vs FHSA (Canada) – core simulation engine.
 *
 * Pure math module: no DOM access.
 * Designed for both browser (via ES module import) and Node (for tests).
 */

/**
 * Clamp numeric value into [min, max]. If not finite, returns fallback.
 */
function clamp(n, min, max, fallback = min) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Build monthly return rate from annual return, fees, and optional inflation.
 *
 * r, f, i are PERCENT values (e.g. 7 for 7%).
 */
import {
  RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP,
  computeRrspNewAnnualRoom
} from "../canada-income-tax/js/rrsp-room.js";

export { RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP, computeRrspNewAnnualRoom };

/**
 * When FHSA is eligible, these are the six distinct permutations of
 * TFSA / RRSP / FHSA fill order (non-registered is always last for overflow).
 * Keys are stable for URLs and tests.
 */
export const FHSA_PRIORITY_STRATEGY_KEYS = [
  "ALL_TFSA",
  "TFSA_FHSA_RRSP",
  "ALL_RRSP",
  "RRSP_FHSA_TFSA",
  "ALL_FHSA",
  "FHSA_FIRST_THEN_RRSP"
];

/** @type {Record<string, ("TFSA"|"RRSP"|"FHSA")[]>} */
const FHSA_ELIGIBLE_PRIORITY_ORDERS = {
  ALL_TFSA: ["TFSA", "RRSP", "FHSA"],
  TFSA_FHSA_RRSP: ["TFSA", "FHSA", "RRSP"],
  ALL_RRSP: ["RRSP", "TFSA", "FHSA"],
  RRSP_FHSA_TFSA: ["RRSP", "FHSA", "TFSA"],
  ALL_FHSA: ["FHSA", "TFSA", "RRSP"],
  FHSA_FIRST_THEN_RRSP: ["FHSA", "RRSP", "TFSA"]
};

function remainderDestinationForOptimalKey(key) {
  switch (key) {
    case "ALL_RRSP":
    case "RRSP_FHSA_TFSA":
    case "FHSA_FIRST_THEN_RRSP":
    case "TFSA_FHSA_RRSP":
      return "RRSP";
    default:
      return "TFSA";
  }
}

/**
 * Human-readable contribution priority for display (non-registered is always modeled last).
 */
export function describeStrategyAccountOrder(strategyKey, fhsaEligible) {
  if (!fhsaEligible) {
    return strategyKey === "ALL_RRSP"
      ? "RRSP → TFSA → non-registered"
      : "TFSA → RRSP → non-registered";
  }
  const ord = FHSA_ELIGIBLE_PRIORITY_ORDERS[strategyKey];
  if (!ord) return String(strategyKey);
  return `${ord.join(" → ")} → non-registered`;
}

export function computeMonthlyRate({ annualReturnPct, annualFeePct, inflationPct = 0, useRealDollars = false }) {
  const r = Number(annualReturnPct) || 0;
  const f = Number(annualFeePct) || 0;
  const i = Number(inflationPct) || 0;

  const rNet = (r - f) / 100; // net nominal return

  if (!useRealDollars) {
    if (Math.abs(rNet) < 1e-12) return 0;
    return Math.pow(1 + rNet, 1 / 12) - 1;
  }

  const realAnnual = (1 + rNet) / (1 + i / 100) - 1;
  if (Math.abs(realAnnual) < 1e-12) return 0;
  return Math.pow(1 + realAnnual, 1 / 12) - 1;
}

/**
 * Internal: run a single strategy simulation.
 *
 * contributionMode: "monthly" | "annual" | "lump"
 * strategyKey: one of:
 *   - "ALL_TFSA" | "ALL_RRSP" (no FHSA); or when fhsaEligible, any key in FHSA_PRIORITY_STRATEGY_KEYS
 */
function runStrategy(baseInputs, strategyKey) {
  const {
    contributionMode,
    contributionAmount,
    horizonYears,
    rm, // monthly growth rate (already net of fees, and optionally real)
    t_now_pct,
    t_ret_pct,
    refundMode,
    tfsaRemainingRoom,
    rrspRemainingRoom,
    fhsaEligible,
    fhsaHomeQualified,
    fhsaAnnualRoom,
    fhsaAnnualRoomStart,
    fhsaLifetimeCap,
    tfsaNewAnnualRoom,
    currentTaxableIncomeForRrsp,
    rrspAnnualNewRoomCap
  } = baseInputs;

  const months = Math.max(1, Math.round(horizonYears * 12));
  const tNow = clamp(t_now_pct / 100, 0, 1, 0);
  const tRet = clamp(t_ret_pct / 100, 0, 1, 0);

  // Pre-compute gross contribution per month (before any tax or allocation)
  let grossPerMonth = 0;
  if (contributionMode === "monthly") {
    grossPerMonth = Math.max(0, Number(contributionAmount) || 0);
  } else if (contributionMode === "annual") {
    const annual = Math.max(0, Number(contributionAmount) || 0);
    grossPerMonth = annual / 12;
  } else if (contributionMode === "lump") {
    // Single deposit at month 0
    grossPerMonth = 0;
  }
  const lumpAmount = contributionMode === "lump" ? Math.max(0, Number(contributionAmount) || 0) : 0;

  // Balances
  let B_tfsa = 0;
  let B_rrsp = 0;
  let B_fhsa = 0;
  let B_refund = 0; // refund bucket for this strategy
  let B_nonreg = 0; // refund overflow bucket when TFSA room is full
  let tfsaRoomRemaining = Math.max(0, Number(tfsaRemainingRoom) || 0);
  let rrspRoomRemaining = Math.max(0, Number(rrspRemainingRoom) || 0);
  /** Cumulative FHSA contributions (principal only; CRA lifetime limit applies to contributions, not growth). */
  let fhsaLifetimeContributed = 0;
  const lifeCap = Math.max(0, Number(fhsaLifetimeCap) || 0);
  const tfsaJanuaryBump = Math.max(0, Number(tfsaNewAnnualRoom) || 0);
  const rrspJanuaryBump = computeRrspNewAnnualRoom(currentTaxableIncomeForRrsp, rrspAnnualNewRoomCap);
  const year1Allocation = {
    tfsaDirect: 0,
    rrspDirect: 0,
    fhsaDirect: 0,
    nonRegDirect: 0,
    tfsaFromRefund: 0,
    nonRegFromRefund: 0
  };

  // FHSA room per year (index 0..T-1). Values are in contribution dollars.
  const years = Math.ceil(horizonYears);
  const fhsaRoomByYear = [];
  const annualRoom = Math.max(0, Number(fhsaAnnualRoom) || 0);
  const startRoom = Number.isFinite(fhsaAnnualRoomStart) ? Math.max(0, fhsaAnnualRoomStart) : annualRoom;
  for (let y = 0; y < years; y++) {
    fhsaRoomByYear[y] = y === 0 ? startRoom : annualRoom;
  }

  // Helper: deposit into TFSA, RRSP, FHSA for a given gross contribution G.
  // Semantics: contributionAmount is post-tax savings. We allocate G directly
  // to account buckets; TFSA contributions are not reduced by t_now here.
  function recordYear1(field, amount, monthIndex) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (monthIndex >= 0 && monthIndex < 12) {
      year1Allocation[field] += amount;
    }
  }

  function depositTfsa(amount, monthIndex = -1, source = "direct") {
    if (amount <= 0) return 0;
    const used = Math.min(amount, tfsaRoomRemaining);
    tfsaRoomRemaining -= used;
    B_tfsa += used;
    if (source === "refund") {
      recordYear1("tfsaFromRefund", used, monthIndex);
    } else {
      recordYear1("tfsaDirect", used, monthIndex);
    }
    return used;
  }

  function depositRrsp(amount, monthIndex = -1) {
    if (amount <= 0) return 0;
    const used = Math.min(amount, rrspRoomRemaining);
    rrspRoomRemaining -= used;
    B_rrsp += used;
    recordYear1("rrspDirect", used, monthIndex);
    const refund = used * tNow;
    if (refundMode === "reinvest") {
      B_refund += refund;
    }
    return used;
  }

  function depositFhsa(amount, monthIndex = -1) {
    if (amount <= 0) return 0;
    B_fhsa += amount;
    if (lifeCap > 0) {
      fhsaLifetimeContributed += amount;
    }
    recordYear1("fhsaDirect", amount, monthIndex);
    const refund = amount * tNow;
    if (refundMode === "reinvest") {
      B_refund += refund;
    }
    return amount;
  }

  function depositNonReg(amount, monthIndex = -1, source = "direct") {
    if (amount <= 0) return 0;
    B_nonreg += amount;
    if (source === "refund") {
      recordYear1("nonRegFromRefund", amount, monthIndex);
    } else {
      recordYear1("nonRegDirect", amount, monthIndex);
    }
    return amount;
  }

  function applyRefundBucket(monthIndex) {
    if (B_refund <= 0) return;
    const toTfsa = Math.min(B_refund, tfsaRoomRemaining);
    if (toTfsa > 0) {
      depositTfsa(toTfsa, monthIndex, "refund");
      B_refund -= toTfsa;
    }
    if (B_refund > 0) {
      depositNonReg(B_refund, monthIndex, "refund");
      B_refund = 0;
    }
  }

  function fhsaDepositUpTo(remaining, monthIndex) {
    if (remaining <= 0) return 0;
    const yearIndex = Math.min(fhsaRoomByYear.length - 1, Math.floor(monthIndex / 12));
    let room = fhsaRoomByYear[yearIndex] ?? 0;
    const lifetimeLeft =
      lifeCap > 0 ? Math.max(0, lifeCap - fhsaLifetimeContributed) : Number.POSITIVE_INFINITY;
    const effectiveRoom = Math.min(room, lifetimeLeft);
    const use = Math.min(remaining, effectiveRoom);
    if (use > 0) {
      fhsaRoomByYear[yearIndex] = room - use;
      depositFhsa(use, monthIndex);
    }
    return use;
  }

  function allocateContribution(monthIndex, grossContribution) {
    if (grossContribution <= 0) return;

    const g = grossContribution;

    if (!fhsaEligible) {
      let remaining = g;
      if (strategyKey === "ALL_RRSP") {
        remaining -= depositRrsp(remaining, monthIndex);
        remaining -= depositTfsa(remaining, monthIndex, "direct");
      } else {
        remaining -= depositTfsa(remaining, monthIndex, "direct");
        remaining -= depositRrsp(remaining, monthIndex);
      }
      if (remaining > 0) depositNonReg(remaining, monthIndex, "direct");
      return;
    }

    const order = FHSA_ELIGIBLE_PRIORITY_ORDERS[strategyKey];
    if (!order) {
      throw new Error(`Unknown FHSA strategy key: ${strategyKey}`);
    }

    let remaining = g;
    for (let i = 0; i < order.length && remaining > 0; i++) {
      const acct = order[i];
      if (acct === "TFSA") {
        remaining -= depositTfsa(remaining, monthIndex, "direct");
      } else if (acct === "RRSP") {
        remaining -= depositRrsp(remaining, monthIndex);
      } else if (acct === "FHSA") {
        remaining -= fhsaDepositUpTo(remaining, monthIndex);
      }
    }
    if (remaining > 0) depositNonReg(remaining, monthIndex, "direct");
  }

  for (let m = 0; m < months; m++) {
    // January (simulation years 2+): add legislated new room on top of any unused carry-forward.
    if (m > 0 && m % 12 === 0) {
      tfsaRoomRemaining += tfsaJanuaryBump;
      rrspRoomRemaining += rrspJanuaryBump;
    }

    // Contributions at start of month
    if (contributionMode === "lump") {
      if (m === 0 && lumpAmount > 0) {
        allocateContribution(m, lumpAmount);
      }
    } else {
      if (grossPerMonth > 0) {
        allocateContribution(m, grossPerMonth);
      }
    }

    // Growth step (same rm for all balances)
    if (rm !== 0) {
      const growthFactor = 1 + rm;
      B_tfsa *= growthFactor;
      B_rrsp *= growthFactor;
      B_fhsa *= growthFactor;
      B_nonreg *= growthFactor;
      B_refund *= growthFactor;
    }

    // Route any accumulated refund into TFSA room first, then non-registered.
    applyRefundBucket(m);
  }

  // Final after-tax values by account
  const afterTaxTfsa = B_tfsa;
  const afterTaxRrsp = B_rrsp * (1 - tRet);
  let afterTaxFhsa = 0;
  if (fhsaEligible) {
    if (fhsaHomeQualified) {
      afterTaxFhsa = B_fhsa; // tax-free withdrawal
    } else {
      afterTaxFhsa = B_fhsa * (1 - tRet); // behaves like RRSP
    }
  }

  // Non-registered overflow is tracked as a separate bucket. Tax drag is not modeled in v1.
  const finalAfterTax = afterTaxTfsa + afterTaxRrsp + afterTaxFhsa + B_nonreg;

  // For allocationSummary, we care about how much FHSA room actually used per year 1.
  const fhsaUsedYear1 = fhsaEligible
    ? (fhsaAnnualRoomStart || annualRoom) - (fhsaRoomByYear[0] ?? 0)
    : 0;

  return {
    finalAfterTax,
    breakdown: {
      tfsa: B_tfsa,
      rrspPretax: B_rrsp,
      fhsa: B_fhsa,
      refund: 0,
      nonRegistered: B_nonreg
    },
    meta: {
      fhsaUsedYear1,
      year1Allocation,
      fhsaLifetimeContributed,
      fhsaLifetimeCap: lifeCap > 0 ? lifeCap : null,
      remainingTfsaRoom: tfsaRoomRemaining,
      remainingRrspRoom: rrspRoomRemaining,
      tfsaJanuaryBump,
      rrspJanuaryBump
    }
  };
}

/**
 * Main public simulation function.
 *
 * inputs:
 *  - contributionMode: "monthly" | "annual" | "lump"
 *  - contributionAmount: number
 *  - horizonYears: number
 *  - annualReturn: number (percent)
 *  - annualFees: number (percent)
 *  - inflation: number (percent, optional)
 *  - useRealDollars: boolean
 *  - t_now: number (percent)
 *  - t_ret: number (percent)
 *  - refundMode: "spend" | "reinvest"
 *  - refundDest: currently only "tfsa" supported when reinvest
 *  - tfsaRemainingRoom: number (default 0)
 *  - rrspRemainingRoom: number (default 0)
 *  - fhsaEligible: boolean
 *  - fhsaHomeQualified: boolean
 *  - fhsaAnnualRoom: number (default 8000)
 *  - fhsaAnnualRoomStart: number (optional; default fhsaAnnualRoom)
 *  - fhsaLifetimeCap: number (default 40000; cumulative contribution limit; 0 disables)
 *  - tfsaNewAnnualRoom: number (default 7000; added each Jan from simulation year 2 onward)
 *  - currentTaxableIncome: number (for RRSP 18% annual room top-up; same field as tax section)
 *  - rrspAnnualNewRoomCap: number (optional; default RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP)
 */
export function runAccountStrategySimulation(rawInputs) {
  if (!rawInputs || typeof rawInputs !== "object") {
    throw new Error("Inputs object is required");
  }

  const {
    contributionMode = "monthly",
    contributionAmount = 500,
    horizonYears = 25,
    annualReturn = 7,
    annualFees = 0.5,
    inflation = 0,
    useRealDollars = false,
    t_now = 30,
    t_ret = 30,
    refundMode = "spend",
    refundDest = "tfsa",
    tfsaRemainingRoom = 0,
    rrspRemainingRoom = 0,
    fhsaEligible = false,
    fhsaHomeQualified = false,
    fhsaAnnualRoom = 8000,
    fhsaAnnualRoomStart,
    fhsaLifetimeCap = 40000,
    tfsaNewAnnualRoom = 7000,
    currentTaxableIncome = 0,
    rrspAnnualNewRoomCap
  } = rawInputs;

  // Basic validation / clamping
  const safeHorizon = clamp(Number(horizonYears) || 0, 0.25, 80, 25); // at least 3 months
  const safeReturn = clamp(Number(annualReturn) || 0, -50, 50, 7);
  const safeFees = clamp(Number(annualFees) || 0, 0, 5, 0);
  const safeInflation = clamp(Number(inflation) || 0, 0, 20, 0);

  const rm = computeMonthlyRate({
    annualReturnPct: safeReturn,
    annualFeePct: safeFees,
    inflationPct: safeInflation,
    useRealDollars: !!useRealDollars
  });

  const baseInputs = {
    contributionMode,
    contributionAmount: Number(contributionAmount) || 0,
    horizonYears: safeHorizon,
    rm,
    t_now_pct: Number(t_now) || 0,
    t_ret_pct: Number(t_ret) || 0,
    refundMode: refundMode === "reinvest" ? "reinvest" : "spend",
    refundDest,
    tfsaRemainingRoom: Math.max(0, Number(tfsaRemainingRoom) || 0),
    rrspRemainingRoom: Math.max(0, Number(rrspRemainingRoom) || 0),
    fhsaEligible: !!fhsaEligible,
    fhsaHomeQualified: !!fhsaHomeQualified,
    fhsaAnnualRoom: Number(fhsaAnnualRoom) || 0,
    fhsaAnnualRoomStart,
    fhsaLifetimeCap: Number.isFinite(Number(fhsaLifetimeCap))
      ? Math.max(0, Number(fhsaLifetimeCap))
      : 40000,
    tfsaNewAnnualRoom: Math.max(0, Number(tfsaNewAnnualRoom) || 0),
    currentTaxableIncomeForRrsp: Math.max(0, Number(currentTaxableIncome) || 0),
    rrspAnnualNewRoomCap: Number.isFinite(Number(rrspAnnualNewRoomCap))
      ? Math.max(0, Number(rrspAnnualNewRoomCap))
      : RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP
  };

  // Strategies to simulate
  const strategies = {};

  let candidateKeys;
  if (baseInputs.fhsaEligible) {
    candidateKeys = [...FHSA_PRIORITY_STRATEGY_KEYS];
    for (const k of candidateKeys) {
      strategies[k] = runStrategy(baseInputs, k);
    }
  } else {
    strategies.ALL_TFSA = runStrategy(baseInputs, "ALL_TFSA");
    strategies.ALL_RRSP = runStrategy(baseInputs, "ALL_RRSP");
    candidateKeys = ["ALL_TFSA", "ALL_RRSP"];
  }

  let optimalKey = candidateKeys.reduce((bestKey, k) => {
    if (!strategies[bestKey]) return k;
    if (!strategies[k]) return bestKey;
    return strategies[k].finalAfterTax > strategies[bestKey].finalAfterTax ? k : bestKey;
  }, candidateKeys[0]);

  const remainderDest = remainderDestinationForOptimalKey(optimalKey);

  strategies.OPTIMAL = {
    ...strategies[optimalKey],
    allocationSummary: buildAllocationSummary(baseInputs, strategies[optimalKey], remainderDest)
  };

  /** Sorted highest after-tax value first; excludes OPTIMAL pseudo-strategy. */
  const priorityRanking = candidateKeys
    .map((key) => ({
      key,
      finalAfterTax: strategies[key].finalAfterTax
    }))
    .sort((a, b) => b.finalAfterTax - a.finalAfterTax)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const bestValue = priorityRanking.length > 0 ? priorityRanking[0].finalAfterTax : 0;

  const deltas = {};
  priorityRanking.forEach((r) => {
    deltas[r.key] = {
      vsBest: r.finalAfterTax - bestValue
    };
  });

  // Legacy shape: keep `ranking` as priority list without OPTIMAL for any older callers.
  const ranking = priorityRanking.map(({ key, finalAfterTax }) => ({ key, finalAfterTax }));

  const topLevelAllocationSummary =
    strategies.OPTIMAL.allocationSummary ||
    buildAllocationSummary(baseInputs, strategies[optimalKey], remainderDest);

  return {
    inputsEcho: {
      ...rawInputs,
      normalized: {
        horizonYears: safeHorizon,
        annualReturn: safeReturn,
        annualFees: safeFees,
        inflation: safeInflation,
        monthlyRate: rm
      }
    },
    strategies,
    ranking,
    priorityRanking,
    deltas,
    optimalStrategyKey: optimalKey,
    allocationSummary: topLevelAllocationSummary
  };
}

function buildAllocationSummary(baseInputs, strategyResult, remainderDestination) {
  const {
    contributionMode,
    contributionAmount,
    fhsaEligible,
    fhsaAnnualRoom,
    fhsaAnnualRoomStart,
    fhsaLifetimeCap,
    tfsaRemainingRoom,
    rrspRemainingRoom
  } = baseInputs;
  const annualContribution =
    contributionMode === "monthly"
      ? (Number(contributionAmount) || 0) * 12
      : contributionMode === "annual"
        ? (Number(contributionAmount) || 0)
        : (Number(contributionAmount) || 0); // lump treated as one-time "annual" for summary text

  let fhsaUsedAnnual = 0;
  if (fhsaEligible && strategyResult && strategyResult.meta && Number.isFinite(strategyResult.meta.fhsaUsedYear1)) {
    fhsaUsedAnnual = strategyResult.meta.fhsaUsedYear1;
  }

  const room = Number.isFinite(fhsaAnnualRoomStart) ? fhsaAnnualRoomStart : fhsaAnnualRoom;
  const fhsaCap = Math.max(0, Number(room) || 0);

  const cappedFhsaUsed = Math.min(fhsaCap, fhsaUsedAnnual);
  const remainderAnnual = Math.max(0, annualContribution - cappedFhsaUsed);
  const alloc = strategyResult?.meta?.year1Allocation || {};
  const year1Tfsa = (alloc.tfsaDirect || 0) + (alloc.tfsaFromRefund || 0);
  const year1Rrsp = alloc.rrspDirect || 0;
  const year1Fhsa = alloc.fhsaDirect || 0;
  const year1NonReg = (alloc.nonRegDirect || 0) + (alloc.nonRegFromRefund || 0);
  const tfsaCap = Math.max(0, Number(tfsaRemainingRoom) || 0);
  const rrspCap = Math.max(0, Number(rrspRemainingRoom) || 0);
  const tol = 0.01;
  const rrspCapReached = rrspCap > 0 && (rrspCap - year1Rrsp) <= tol;
  const tfsaCapReached = tfsaCap > 0 && (tfsaCap - year1Tfsa) <= tol;

  const lifeCap = Math.max(0, Number(fhsaLifetimeCap) || 0);
  const lifeTotal =
    strategyResult?.meta && Number.isFinite(strategyResult.meta.fhsaLifetimeContributed)
      ? strategyResult.meta.fhsaLifetimeContributed
      : 0;
  const lifeCapHit = lifeCap > 0 && lifeTotal >= lifeCap - tol;
  const lifeCapLabel = lifeCap > 0 ? `$${Math.round(lifeCap).toLocaleString("en-CA")}` : "";

  let noteText = "";
  if (!fhsaEligible) {
    noteText = "FHSA not available based on your inputs. Allocation priorities are optimized across TFSA, RRSP, and non-registered.";
  } else if (annualContribution <= 0) {
    noteText = "No contributions entered. Results are driven by growth assumptions only.";
  } else if (lifeCapHit) {
    noteText = `The modeled ${lifeCapLabel} lifetime FHSA contribution limit is reached in this projection; further contributions go to other accounts per the strategy. Investment growth inside the FHSA does not count toward that limit.`;
  } else if (cappedFhsaUsed >= fhsaCap) {
    noteText =
      "FHSA annual room is fully used in this strategy. Remaining contributions are allocated to the indicated account. Cumulative FHSA contributions are still subject to the lifetime cap in the model.";
  } else {
    noteText =
      "FHSA additions in year 1 are below the modeled annual room. The simulation also enforces the lifetime FHSA contribution cap; growth inside the account does not count toward it.";
  }

  return {
    annualContribution,
    fhsaUsedAnnual: cappedFhsaUsed,
    remainderAnnual,
    year1Allocation: {
      tfsa: year1Tfsa,
      rrsp: year1Rrsp,
      fhsa: year1Fhsa,
      nonRegistered: year1NonReg
    },
    capStatus: {
      rrspCap,
      tfsaCap,
      rrspCapReached,
      tfsaCapReached
    },
    remainderDestination,
    noteText
  };
}

