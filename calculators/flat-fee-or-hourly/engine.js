/* ============================================================
   The Long Math — Flat-Fee or Hourly Advisor Cost Engine
   ============================================================

   PURPOSE
   -------
   Calculate the true cost of flat-fee or hourly advisor fees,
   including both direct fees paid and lost compounding.

   This engine:
     • Uses monthly compounding
     • Applies contributions at END of month (after growth and fees)
     • Applies fees monthly
     • Tracks lost compounding as future value of fees
     • Calculates AUM-fee equivalent via binary search
*/

/* ============================================================
   Helper: Parse percentage string to decimal
   ============================================================ */
function parsePercent(str) {
  if (str == null || str === "") return NaN;
  const s = String(str).trim().replace(/,/g, "");
  if (s === "") return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return n / 100;
}

/* ============================================================
   Helper: Clamp number between min and max
   ============================================================ */
function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/* ============================================================
   Helper: Calculate monthly rate from annual rate
   ============================================================ */
function monthlyRateFromAnnual(rAnnual) {
  if (rAnnual === 0) return 0;
  return Math.pow(1 + rAnnual, 1 / 12) - 1;
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
  aumFeePct,
  feeInflationOn,
  feeIncreasePct
}) {
  const months = Math.round(horizonYears * 12);
  const rm = monthlyRateFromAnnual(annualReturn);
  let balance = startingBalance;
  let feesPaid = 0;
  let lostCompounding = 0;

  for (let m = 0; m < months; m++) {
    const monthIndex = m;
    const currentYear = Math.floor(monthIndex / 12) + 1;

    // Growth
    balance = balance * (1 + rm);

    // Calculate monthly fee based on model
    let feeMonth = 0;

    if (feeModel === "flat") {
      // Calculate annual fee for current year
      let annualFee = flatFee;
      if (feeInflationOn && feeIncreasePct > 0) {
        annualFee = flatFee * Math.pow(1 + feeIncreasePct / 100, currentYear - 1);
      }
      feeMonth = annualFee / 12;
    } else if (feeModel === "hourly") {
      // Calculate annual fee for current year
      let annualFee = hourlyRate * hoursPerYear;
      if (feeInflationOn && feeIncreasePct > 0) {
        annualFee = (hourlyRate * hoursPerYear) * Math.pow(1 + feeIncreasePct / 100, currentYear - 1);
      }
      feeMonth = annualFee / 12;
    } else if (feeModel === "aum") {
      // AUM fee applied as percentage of assets
      feeMonth = balance * (aumFeePct / 100 / 12);
    }

    // Deduct fee (dollar fees)
    if (feeModel === "flat" || feeModel === "hourly") {
      balance = Math.max(0, balance - feeMonth);
      feesPaid += feeMonth;
      // Lost compounding: future value of this fee to end of horizon
      const monthsRemaining = months - monthIndex - 1;
      if (monthsRemaining > 0) {
        lostCompounding += feeMonth * Math.pow(1 + rm, monthsRemaining);
      }
    } else if (feeModel === "aum") {
      // AUM fee deducted
      balance = Math.max(0, balance - feeMonth);
      feesPaid += feeMonth;
      // Lost compounding for AUM: future value of fee
      const monthsRemaining = months - monthIndex - 1;
      if (monthsRemaining > 0) {
        lostCompounding += feeMonth * Math.pow(1 + rm, monthsRemaining);
      }
    }

    // Contribution at end of month
    balance = balance + monthlyContribution;
  }

  return {
    endingValue: balance,
    feesPaid,
    lostCompounding
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
  aumFeeAnnualPct // annual percentage as decimal
}) {
  const months = Math.round(horizonYears * 12);
  const rm = monthlyRateFromAnnual(annualReturn);
  let balance = startingBalance;

  for (let m = 0; m < months; m++) {
    // Growth
    balance = balance * (1 + rm);
    // AUM fee (monthly)
    const feeMonth = balance * (aumFeeAnnualPct / 12);
    balance = Math.max(0, balance - feeMonth);
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
  // If target is >= ending without fees (within tolerance), equivalent is 0%
  const tolerance = 1e-2;
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

  if (targetEndingValue < endingAt5Pct - tolerance) {
    return null; // Will display as "≥ 5.00%"
  }

  // Binary search on [0, 0.05]
  let low = 0;
  let high = 0.05;
  const maxIterations = 40;
  let iterations = 0;

  while (iterations < maxIterations) {
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

    iterations++;
  }

  // Return midpoint as best estimate
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
    aumFeePct: feeModel === "aum" ? aumFeePct : 0,
    feeInflationOn: feeInflationOn || false,
    feeIncreasePct: feeIncreasePct || 0
  });

  const endingWith = withFees.endingValue;
  const feesPaid = withFees.feesPaid;
  const lostCompounding = withFees.lostCompounding;
  const totalCost = feesPaid + lostCompounding;

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
