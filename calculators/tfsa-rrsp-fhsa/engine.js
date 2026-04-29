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
 *   - "ALL_TFSA"
 *   - "ALL_RRSP"
 *   - "TFSA_THEN_RRSP"
 *   - "RRSP_THEN_TFSA"
 *   - "ALL_FHSA"
 *   - "FHSA_FIRST_THEN_TFSA"
 *   - "FHSA_FIRST_THEN_RRSP"
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
    fhsaEligible,
    fhsaHomeQualified,
    fhsaAnnualRoom,
    fhsaAnnualRoomStart,
    tfsaRoomAvailable,
    rrspRoomAvailable,
    fhsaRoomAvailable
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
  let B_unallocated = 0; // contribution cash that could not fit into modeled registered room
  const firstYearAllocation = { tfsa: 0, rrsp: 0, fhsa: 0, unallocated: 0 };

  let tfsaRoomRemaining = Number.isFinite(tfsaRoomAvailable)
    ? Math.max(0, Number(tfsaRoomAvailable))
    : Number.POSITIVE_INFINITY;
  let rrspRoomRemaining = Number.isFinite(rrspRoomAvailable)
    ? Math.max(0, Number(rrspRoomAvailable))
    : Number.POSITIVE_INFINITY;
  let fhsaRoomRemaining = Number.isFinite(fhsaRoomAvailable)
    ? Math.max(0, Number(fhsaRoomAvailable))
    : Number.POSITIVE_INFINITY;

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
  function allocateContribution(monthIndex, grossContribution) {
    if (grossContribution <= 0) return;

    const yearIndex = Math.min(fhsaRoomByYear.length - 1, Math.floor(monthIndex / 12));

    const g = grossContribution;
    let remaining = g;

    function consumeTfsa(amount) {
      if (amount <= 0) return 0;
      const used = Math.min(amount, tfsaRoomRemaining);
      tfsaRoomRemaining -= used;
      B_tfsa += used;
      if (monthIndex < 12) firstYearAllocation.tfsa += used;
      return used;
    }

    function consumeRrsp(amount) {
      if (amount <= 0) return 0;
      const used = Math.min(amount, rrspRoomRemaining);
      rrspRoomRemaining -= used;
      B_rrsp += used;
      if (monthIndex < 12) firstYearAllocation.rrsp += used;
      const refund = used * tNow;
      if (refundMode === "reinvest") {
        B_refund += refund;
      }
      return used;
    }

    function consumeFhsa(amount) {
      if (amount <= 0 || !fhsaEligible) return 0;
      const annualRoomLeft = Math.max(0, fhsaRoomByYear[yearIndex] ?? 0);
      const effectiveRoom = Math.min(annualRoomLeft, fhsaRoomRemaining);
      const used = Math.min(amount, effectiveRoom);
      if (used <= 0) return 0;
      fhsaRoomByYear[yearIndex] = annualRoomLeft - used;
      fhsaRoomRemaining -= used;
      B_fhsa += used;
      if (monthIndex < 12) firstYearAllocation.fhsa += used;
      const refund = used * tNow;
      if (refundMode === "reinvest") {
        B_refund += refund;
      }
      return used;
    }

    if (!fhsaEligible) {
      // No FHSA paths; apply chosen account first, then overflow to the other registered account.
      if (strategyKey === "ALL_RRSP" || strategyKey === "RRSP_THEN_TFSA") {
        remaining -= consumeRrsp(remaining);
        remaining -= consumeTfsa(remaining);
      } else {
        // ALL_TFSA / TFSA_THEN_RRSP
        remaining -= consumeTfsa(remaining);
        remaining -= consumeRrsp(remaining);
      }
    } else {
      // FHSA strategies
      if (strategyKey === "ALL_TFSA") {
        remaining -= consumeTfsa(remaining);
        remaining -= consumeRrsp(remaining);
      } else if (strategyKey === "ALL_RRSP") {
        remaining -= consumeRrsp(remaining);
        remaining -= consumeTfsa(remaining);
      } else {
        // Strategies that use FHSA first when eligible
        remaining -= consumeFhsa(remaining);
        if (remaining > 0) {
          if (strategyKey === "FHSA_FIRST_THEN_RRSP") {
            remaining -= consumeRrsp(remaining);
            remaining -= consumeTfsa(remaining);
          } else {
            // ALL_FHSA and FHSA_FIRST_THEN_TFSA spill to TFSA first, then RRSP.
            remaining -= consumeTfsa(remaining);
            remaining -= consumeRrsp(remaining);
          }
        }
      }
    }

    if (remaining > 0) {
      B_unallocated += remaining;
      if (monthIndex < 12) firstYearAllocation.unallocated += remaining;
    }
  }

  for (let m = 0; m < months; m++) {
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
      B_refund *= growthFactor;
      B_unallocated *= growthFactor;
    }
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

  const finalAfterTax = afterTaxTfsa + afterTaxRrsp + afterTaxFhsa + B_refund + B_unallocated;

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
      refund: B_refund,
      unallocated: B_unallocated
    },
    meta: {
      fhsaUsedYear1,
      firstYearAllocation
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
 *  - fhsaEligible: boolean
 *  - fhsaHomeQualified: boolean
 *  - fhsaAnnualRoom: number (default 8000)
 *  - fhsaAnnualRoomStart: number (optional; default fhsaAnnualRoom)
 *  - tfsaRoomAvailable: number (optional; if omitted, treated as unbounded)
 *  - rrspRoomAvailable: number (optional; if omitted, treated as unbounded)
 *  - fhsaRoomAvailable: number (optional; if omitted, constrained only by annual FHSA room)
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
    fhsaEligible = false,
    fhsaHomeQualified = false,
    fhsaAnnualRoom = 8000,
    fhsaAnnualRoomStart,
    tfsaRoomAvailable,
    rrspRoomAvailable,
    fhsaRoomAvailable
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
    fhsaEligible: !!fhsaEligible,
    fhsaHomeQualified: !!fhsaHomeQualified,
    fhsaAnnualRoom: Number(fhsaAnnualRoom) || 0,
    fhsaAnnualRoomStart,
    tfsaRoomAvailable: Number.isFinite(tfsaRoomAvailable) ? Number(tfsaRoomAvailable) : undefined,
    rrspRoomAvailable: Number.isFinite(rrspRoomAvailable) ? Number(rrspRoomAvailable) : undefined,
    fhsaRoomAvailable: Number.isFinite(fhsaRoomAvailable) ? Number(fhsaRoomAvailable) : undefined
  };

  // Strategies to simulate
  const strategies = {};

  strategies.ALL_TFSA = runStrategy(baseInputs, "ALL_TFSA");
  strategies.ALL_RRSP = runStrategy(baseInputs, "ALL_RRSP");
  strategies.TFSA_THEN_RRSP = runStrategy(baseInputs, "TFSA_THEN_RRSP");
  strategies.RRSP_THEN_TFSA = runStrategy(baseInputs, "RRSP_THEN_TFSA");

  let optimalKey = "ALL_TFSA";

  if (baseInputs.fhsaEligible) {
    strategies.ALL_FHSA = runStrategy(baseInputs, "ALL_FHSA");

    const fhsaThenTfsa = runStrategy(baseInputs, "FHSA_FIRST_THEN_TFSA");
    const fhsaThenRrsp = runStrategy(baseInputs, "FHSA_FIRST_THEN_RRSP");

    const keyTfsa = "FHSA_FIRST_THEN_TFSA";
    const keyRrsp = "FHSA_FIRST_THEN_RRSP";
    strategies[keyTfsa] = fhsaThenTfsa;
    strategies[keyRrsp] = fhsaThenRrsp;

    const better = fhsaThenTfsa.finalAfterTax >= fhsaThenRrsp.finalAfterTax ? keyTfsa : keyRrsp;
    optimalKey = better;

    strategies.OPTIMAL = {
      ...strategies[better],
      optimalSourceKey: better,
      allocationSummary: buildAllocationSummary(baseInputs, strategies[better], better === keyRrsp ? "RRSP" : "TFSA")
    };
  } else {
    // No FHSA available: choose the better room-aware ordering.
    const best =
      strategies.RRSP_THEN_TFSA.finalAfterTax >= strategies.TFSA_THEN_RRSP.finalAfterTax
        ? "RRSP_THEN_TFSA"
        : "TFSA_THEN_RRSP";
    optimalKey = best;
    strategies.OPTIMAL = {
      ...strategies[best],
      optimalSourceKey: best,
      allocationSummary: buildAllocationSummary(baseInputs, strategies[best], best === "RRSP_THEN_TFSA" ? "RRSP" : "TFSA")
    };
  }

  // Ranking (visible strategies only)
  const ranking = Object.entries(strategies)
    .filter(([key]) => key === "ALL_TFSA" || key === "ALL_RRSP" || key === "ALL_FHSA" || key === "OPTIMAL")
    .map(([key, value]) => ({
      key,
      finalAfterTax: value.finalAfterTax
    }))
    .sort((a, b) => b.finalAfterTax - a.finalAfterTax);

  const bestValue = ranking.length > 0 ? ranking[0].finalAfterTax : 0;

  const deltas = {};
  ranking.forEach((r) => {
    deltas[r.key] = {
      vsBest: r.finalAfterTax - bestValue
    };
  });

  const topLevelAllocationSummary = strategies.OPTIMAL.allocationSummary || buildAllocationSummary(
    baseInputs,
    strategies[optimalKey],
    optimalKey === "ALL_RRSP" || optimalKey === "FHSA_FIRST_THEN_RRSP" ? "RRSP" : "TFSA"
  );

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
    deltas,
    allocationSummary: topLevelAllocationSummary
  };
}

function buildAllocationSummary(baseInputs, strategyResult, remainderDestination) {
  const { contributionMode, contributionAmount, fhsaEligible, fhsaAnnualRoom, fhsaAnnualRoomStart } = baseInputs;
  const annualContribution =
    contributionMode === "monthly"
      ? (Number(contributionAmount) || 0) * 12
      : contributionMode === "annual"
        ? (Number(contributionAmount) || 0)
        : (Number(contributionAmount) || 0); // lump treated as one-time "annual" for summary text

  let fhsaUsedAnnual = 0;
  const firstYearAlloc = strategyResult?.meta?.firstYearAllocation || {};
  if (fhsaEligible && strategyResult && strategyResult.meta && Number.isFinite(strategyResult.meta.fhsaUsedYear1)) {
    fhsaUsedAnnual = strategyResult.meta.fhsaUsedYear1;
  }

  const room = Number.isFinite(fhsaAnnualRoomStart) ? fhsaAnnualRoomStart : fhsaAnnualRoom;
  const fhsaCap = Math.max(0, Number(room) || 0);

  const cappedFhsaUsed = Math.min(fhsaCap, fhsaUsedAnnual);
  const remainderAnnual = Math.max(0, annualContribution - cappedFhsaUsed);

  let noteText = "";
  if (!fhsaEligible) {
    noteText = "FHSA not available based on your inputs. This comparison is between TFSA and RRSP only.";
  } else if (annualContribution <= 0) {
    noteText = "No contributions entered. Results are driven by growth assumptions only.";
  } else if (cappedFhsaUsed >= fhsaCap) {
    noteText = "FHSA annual room is fully used in this strategy. Remaining contributions are allocated to the indicated account.";
  } else {
    noteText = "FHSA room is not fully used under these assumptions. Contributions are below the modeled annual FHSA limit.";
  }

  return {
    annualContribution,
    fhsaUsedAnnual: cappedFhsaUsed,
    remainderAnnual,
    remainderDestination,
    noteText,
    firstYearAllocation: {
      tfsa: Number(firstYearAlloc.tfsa) || 0,
      rrsp: Number(firstYearAlloc.rrsp) || 0,
      fhsa: Number(firstYearAlloc.fhsa) || 0,
      unallocated: Number(firstYearAlloc.unallocated) || 0
    }
  };
}

