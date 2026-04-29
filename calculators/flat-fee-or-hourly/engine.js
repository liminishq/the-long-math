/* ============================================================
   The Long Math — Flat-Fee or Hourly Advisor Cost Engine
   ============================================================

   Canonical implementation backed by:
   /assets/js/engines/portfolioSimulationEngine.js

   This file keeps the calculator-specific API and fee-model adapters.
*/

function buildNoFeeScenario({ startingBalance, monthlyContribution, horizonYears, annualReturn }) {
  return {
    initialBalance: startingBalance,
    years: horizonYears,
    annualGrossReturn: annualReturn,
    contribution:
      monthlyContribution > 0
        ? { amount: monthlyContribution, frequency: "monthly", timing: "start" }
        : undefined,
    fees: [],
  };
}

function buildAumScenario({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn,
  aumFeeAnnualPct,
}) {
  return {
    initialBalance: startingBalance,
    years: horizonYears,
    annualGrossReturn: annualReturn,
    contribution:
      monthlyContribution > 0
        ? { amount: monthlyContribution, frequency: "monthly", timing: "start" }
        : undefined,
    fees:
      aumFeeAnnualPct > 0
        ? [{ type: "aumFlat", annualRate: aumFeeAnnualPct, frequency: "monthly", timing: "end" }]
        : [],
  };
}

function annualDollarFeeForYear({
  feeModel,
  flatFee,
  hourlyRate,
  hoursPerYear,
  feeInflationOn,
  feeIncreasePct,
  yearNumber,
}) {
  const baseAnnual = feeModel === "hourly" ? hourlyRate * hoursPerYear : flatFee;
  if (!(baseAnnual > 0)) return 0;
  if (!feeInflationOn || !(feeIncreasePct > 0)) return baseAnnual;
  return baseAnnual * Math.pow(1 + feeIncreasePct / 100, yearNumber - 1);
}

function simulateFlatOrHourlyViaSharedEngine({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn,
  feeModel,
  flatFee,
  hourlyRate,
  hoursPerYear,
  feeInflationOn,
  feeIncreasePct,
}) {
  const PS = window.TLM_PortfolioSimulation;
  const months = Math.round(horizonYears * 12);
  let balance = startingBalance;
  let feesPaid = 0;

  for (let m = 0; m < months; m++) {
    const yearNumber = Math.floor(m / 12) + 1;
    const annualFee = annualDollarFeeForYear({
      feeModel,
      flatFee,
      hourlyRate,
      hoursPerYear,
      feeInflationOn,
      feeIncreasePct,
      yearNumber,
    });
    const monthlyFee = annualFee / 12;

    const monthScenario = {
      initialBalance: balance,
      years: 1 / 12,
      annualGrossReturn: annualReturn,
      contribution:
        monthlyContribution > 0
          ? { amount: monthlyContribution, frequency: "monthly", timing: "start" }
          : undefined,
      withdrawal:
        monthlyFee > 0
          ? { amount: monthlyFee, frequency: "monthly", timing: "end" }
          : undefined,
      fees: [],
    };

    const monthResult = PS.simulatePortfolioScenario(monthScenario);
    balance = monthResult.endingBalance;
    feesPaid += monthlyFee;
  }

  return { endingValue: balance, feesPaid };
}

function calculateAUMEquivalent({
  startingBalance,
  monthlyContribution,
  horizonYears,
  annualReturn,
  targetEndingValue,
  endingWithoutFees,
}) {
  const tolerance = 1e-2;
  const PS = window.TLM_PortfolioSimulation;

  if (targetEndingValue >= endingWithoutFees - tolerance) return 0;

  const endingAt5Pct = PS.simulatePortfolioScenario(
    buildAumScenario({
      startingBalance,
      monthlyContribution,
      horizonYears,
      annualReturn,
      aumFeeAnnualPct: 0.05,
    })
  ).endingBalance;

  if (targetEndingValue < endingAt5Pct - tolerance) return null;

  let low = 0;
  let high = 0.05;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const endingAtMid = PS.simulatePortfolioScenario(
      buildAumScenario({
        startingBalance,
        monthlyContribution,
        horizonYears,
        annualReturn,
        aumFeeAnnualPct: mid,
      })
    ).endingBalance;

    if (Math.abs(endingAtMid - targetEndingValue) < tolerance) return mid;
    if (endingAtMid > targetEndingValue) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function calculateFlatFeeOrHourlyCost(inputs) {
  const PS = window.TLM_PortfolioSimulation;
  if (!PS) return { error: "Shared portfolio simulation engine not loaded." };

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
  const endingWithout = PS.simulatePortfolioScenario(
    buildNoFeeScenario({ startingBalance, monthlyContribution, horizonYears, annualReturn })
  ).endingBalance;

  let withFees;
  if (feeModel === "aum") {
    const end = PS.simulatePortfolioScenario(
      buildAumScenario({
        startingBalance,
        monthlyContribution,
        horizonYears,
        annualReturn,
        aumFeeAnnualPct: aumFeePct,
      })
    );
    withFees = { endingValue: end.endingBalance, feesPaid: end.totalFeesPaid };
  } else {
    withFees = simulateFlatOrHourlyViaSharedEngine({
      startingBalance,
      monthlyContribution,
      horizonYears,
      annualReturn,
      feeModel,
      flatFee: feeModel === "flat" ? flatFee : 0,
      hourlyRate: feeModel === "hourly" ? hourlyRate : 0,
      hoursPerYear: feeModel === "hourly" ? hoursPerYear : 0,
      feeInflationOn: !!feeInflationOn,
      feeIncreasePct: Number.isFinite(feeIncreasePct) ? feeIncreasePct : 0,
    });
  }

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
