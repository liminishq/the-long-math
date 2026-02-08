/* ============================================================
   The Long Math — Flat-Fee or Hourly Advisor Cost Engine
   ============================================================

   PURPOSE
   -------
   Calculate the true cost of flat-fee, hourly, or AUM advisor fees,
   including both direct fees paid and lost compounding.

   This engine:
     • Uses monthly compounding
     • Applies contributions at END of month (after growth and fees)
     • Applies fees monthly
     • Defines:
         totalCost = endingWithoutFees - endingWithFees
         feesPaid  = sum of fees deducted
         lostCompounding = totalCost - feesPaid
     • Calculates AUM-fee equivalent via binary search

   IMPORTANT UNIT NOTE
   -------------------
   ui.js passes:
     aumFeePct as an ANNUAL DECIMAL (e.g., user enters "2.5" => 0.025)
   Therefore this engine treats aumFeePct as a decimal and does NOT /100 it.
*/

/* ============================================================
   Helper: Clamp number between min and max
   ============================================================ */
function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/* ============================================================
   Helper: Calculate monthly rate from annual rate (effective)
   ============================================================ */
function monthlyRateFromAnnual(rAnnualDec) {
  if (!Number.isFinite(rAnnualDec) || rAnnualDec === 0) return 0;
  return Math.pow(1 + rAnnualDec, 1 / 12) - 1;
}

/* ============================================================
   Simulate portfolio WITHOUT advisor fees
   ============================================================ */
function simulateWithoutFees({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn
}) {
  const months = Math.round(horizonYears * 12);
  const rm = monthlyRateFromAnnual(annualReturn);

  let balance = startingBalance;

  for (let m = 0; m < months; m++) {
    // Growth
    balance = balance * (1 + rm);
    // Contribution at end of month
    balance = balance + monthlyContribution;
  }

  return balance;
}

/* ============================================================
   Simulate portfolio WITH advisor fees
   ============================================================ */
function simulateWithFees({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn,
  feeModel, // "flat", "hourly", or "aum"
  flatFee,
  hourlyRate,
  hoursPerYear,
  aumFeePct, // ANNUAL DECIMAL (e.g., 0.025 for 2.5%)
  feeInflationOn,
  feeIncreasePct
}) {
  const months = Math.round(horizonYears * 12);
  const rm = monthlyRateFromAnnual(annualReturn);

  let balance = startingBalance;
  let feesPaid = 0;

  for (let m = 0; m < months; m++) {
    const currentYear = Math.floor(m / 12) + 1;

    // Growth
    balance = balance * (1 + rm);

    // Monthly fee based on model
    let feeMonth = 0;

    if (feeModel === "flat") {
      let annualFee = flatFee;

      if (feeInflationOn && feeIncreasePct > 0) {
        annualFee = flatFee * Math.pow(1 + feeIncreasePct / 100, currentYear - 1);
      }

      feeMonth = annualFee / 12;
    } else if (feeModel === "hourly") {
      const baseAnnual = hourlyRate * hoursPerYear;
      let annualFee = baseAnnual;

      if (feeInflationOn && feeIncreasePct > 0) {
        annualFee = baseAnnual * Math.pow(1 + feeIncreasePct / 100, currentYear - 1);
      }

      feeMonth = annualFee / 12;
    } else if (feeModel === "aum") {
      // ui.js passes aumFeePct as annual DECIMAL (e.g., 0.025)
      const aumAnnualDec = aumFeePct;
      feeMonth = balance * (aumAnnualDec / 12);
    }

    // Deduct fee + track fees paid
    if (feeMonth > 0) {
      // Prevent going negative
      const actualFee = Math.min(balance, feeMonth);
      balance = balance - actualFee;
      feesPaid += actualFee;
    }

    // Contribution at end of month
    balance = balance + monthlyContribution;
  }

  return {
    endingValue: balance,
    feesPaid
  };
}

/* ============================================================
   Simulate with AUM fee (for binary search)
   ============================================================ */
function simulateWithAUMFee({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn,
  aumFeeAnnualPct // annual DECIMAL (e.g., 0.01 = 1%)
}) {
  const months = Math.round(horizonYears * 12);
  const rm = monthlyRateFromAnnual(annualReturn);

  let balance = startingBalance;

  for (let m = 0; m < months; m++) {
    // Growth
    balance = balance * (1 + rm);

    // AUM fee (monthly), decimal annual -> monthly
    const feeMonth = balance * (aumFeeAnnualPct / 12);

    if (feeMonth > 0) {
      const actualFee = Math.min(balance, feeMonth);
      balance = balance - actualFee;
    }

    // Contribution at end of month
    balance = balance + monthlyContribution;
  }

  return balance;
}

/* ============================================================
   Calculate AUM-fee equivalent via binary search
   ============================================================ */
function calculateAUMEquivalent({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn,
  targetEndingValue,
  endingWithoutFees
}) {
  const tolerance = 1e-2;

  // If target is >= ending without fees (within tolerance), equivalent is 0%
  if (targetEndingValue >= endingWithoutFees - tolerance) {
    return 0.0;
  }

  // Check if even 5% AUM doesn't reduce enough
  const endingAt5Pct = simulateWithAUMFee({
    startingBalance,
    monthlyContribution,
    horizonYears,
    annualReturn,
    aumFeeAnnualPct: 0.05
  });

  // If target is lower than what 5% produces, equivalent is >= 5%
  if (targetEndingValue < endingAt5Pct - tolerance) {
    return null; // UI displays "≥ 5.00%"
  }

  // Binary search on [0, 0.05]
  let low = 0;
  let high = 0.05;
  const maxIterations = 40;

  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;

    const endingAtMid = simulateWithAUMFee({
      startingBalance,
      monthlyContribution,
      horizonYears,
      annualReturn,
      aumFeeAnnualPct: mid
    });

    const diff = endingAtMid - targetEndingValue;

    if (Math.abs(diff) < tolerance) {
      return mid;
    }

    if (endingAtMid > targetEndingValue) {
      // Need higher fee
      low = mid;
    } else {
      // Need lower fee
      high = mid;
    }
  }

  return (low + high) / 2;
}

/* ============================================================
   Main calculation function
   ============================================================ */
function calculateFlatFeeOrHourlyCost(inputs) {
  const {
    startingBalance,
    monthlyContribution,
    horizonYears,
    annualReturn,
    feeModel,
    flatFee,
    hourlyRate,
    hoursPerYear,
    aumFeePct,
    feeInflationOn,
    feeIncreasePct
  } = inputs;

  // Validate inputs
  if (!Number.isFinite(startingBalance) || startingBalance < 0) {
    return { error: "Invalid starting balance" };
  }
  if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0) {
    return { error: "Invalid monthly contribution" };
  }
  if (!Number.isFinite(horizonYears) || horizonYears <= 0) {
    return { error: "Invalid time horizon" };
  }
  if (!Number.isFinite(annualReturn) || annualReturn < 0) {
    return { error: "Invalid annual return" };
  }
  // Validate AUM fee when AUM model is selected
  if (feeModel === "aum") {
    if (!Number.isFinite(aumFeePct) || aumFeePct <= 0 || aumFeePct > 0.15) {
      return { error: "Invalid AUM fee percentage (must be between 0 and 15%)" };
    }
  }

  // Simulate without fees
  const endingWithout = simulateWithoutFees({
    startingBalance,
    monthlyContribution,
    horizonYears,
    annualReturn
  });

  // Simulate with fees
  const withFees = simulateWithFees({
    startingBalance,
    monthlyContribution,
    horizonYears,
    annualReturn,
    feeModel,
    flatFee: feeModel === "flat" ? flatFee : 0,
    hourlyRate: feeModel === "hourly" ? hourlyRate : 0,
    hoursPerYear: feeModel === "hourly" ? hoursPerYear : 0,
    aumFeePct: feeModel === "aum" ? aumFeePct : 0, // annual decimal if model==="aum"
    feeInflationOn: !!feeInflationOn,
    feeIncreasePct: Number.isFinite(feeIncreasePct) ? feeIncreasePct : 0
  });

  const endingWith = withFees.endingValue;
  let feesPaid = withFees.feesPaid;

  // Total "true cost" is the ending value gap
  let totalImpact = endingWithout - endingWith;
  if (!Number.isFinite(totalImpact)) totalImpact = 0;
  if (totalImpact < 0) totalImpact = 0;

  // Clamp rounding weirdness: feesPaid cannot exceed totalImpact in a consistent model
  if (feesPaid > totalImpact + 0.01) {
    feesPaid = totalImpact;
  }

  // Lost compounding is the residual
  let lostCompounding = totalImpact - feesPaid;
  if (lostCompounding < 0 && lostCompounding > -0.01) lostCompounding = 0;
  if (lostCompounding < 0) lostCompounding = 0;

  const totalCost = totalImpact;

  // Calculate AUM-fee equivalent (only for flat or hourly)
  let aumEquivalent = null;
  if (feeModel === "flat" || feeModel === "hourly") {
    aumEquivalent = calculateAUMEquivalent({
      startingBalance,
      monthlyContribution,
      horizonYears,
      annualReturn,
      targetEndingValue: endingWith,
      endingWithoutFees: endingWithout
    });
  }

  return {
    endingWithout,
    endingWith,
    feesPaid,
    lostCompounding,
    totalCost,
    aumEquivalent
  };
}

// Export to window for UI
window.calculateFlatFeeOrHourlyCost = calculateFlatFeeOrHourlyCost;
