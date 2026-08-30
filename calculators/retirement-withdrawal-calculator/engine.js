/**
 * Retirement Withdrawal Calculator — deterministic drawdown math.
 *
 * Returns and withdrawals are applied once per selected withdrawal period.
 * Growth is applied before the withdrawal. Inflation-adjusted withdrawals
 * step up at the start of each retirement year, so year 1 uses the initial
 * amount and year 2 uses initial amount × (1 + inflation).
 */

const WITHDRAWAL_ADJUSTMENTS = Object.freeze({
  INFLATION: "inflation",
  FIXED: "fixed"
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function annualToPeriodic(annualReturn, periodsPerYear) {
  const base = 1 + annualReturn;
  if (!isFiniteNumber(base) || base <= 0) return NaN;
  return Math.pow(base, 1 / periodsPerYear) - 1;
}

function withdrawalForPeriod(initialPeriodicWithdrawal, inflationRate, adjustment, periodIndex, periodsPerYear) {
  if (adjustment !== WITHDRAWAL_ADJUSTMENTS.INFLATION) {
    return initialPeriodicWithdrawal;
  }
  const retirementYearIndex = Math.floor(periodIndex / periodsPerYear);
  return initialPeriodicWithdrawal * Math.pow(1 + inflationRate, retirementYearIndex);
}

function simulateRetirementWithdrawal(raw) {
  const startingPortfolio = raw.startingPortfolio;
  const annualReturn = raw.annualReturn;
  const requestedYears = raw.retirementYears;
  const periodsPerYear = raw.periodsPerYear;
  const withdrawalType = raw.withdrawalType;
  const withdrawalAdjustment = raw.withdrawalAdjustment;

  if (!isFiniteNumber(startingPortfolio) || startingPortfolio < 0) {
    return { ok: false, error: "Enter a current portfolio value of $0 or more." };
  }
  if (!isFiniteNumber(annualReturn) || annualReturn <= -0.999999) {
    return { ok: false, error: "Expected return is too low for this model. Enter a return above -99.9%." };
  }
  if (!isFiniteNumber(requestedYears) || requestedYears < 1) {
    return { ok: false, error: "Enter a retirement withdrawal period of at least 1 year." };
  }
  if (!Number.isInteger(periodsPerYear) || periodsPerYear < 1) {
    return { ok: false, error: "Choose a valid withdrawal frequency." };
  }
  if (withdrawalType !== "dollar" && withdrawalType !== "rate") {
    return { ok: false, error: "Choose a valid withdrawal type." };
  }
  if (
    withdrawalAdjustment !== WITHDRAWAL_ADJUSTMENTS.INFLATION &&
    withdrawalAdjustment !== WITHDRAWAL_ADJUSTMENTS.FIXED
  ) {
    return { ok: false, error: "Choose how withdrawals should change over time." };
  }

  const inflationUsed =
    withdrawalAdjustment === WITHDRAWAL_ADJUSTMENTS.INFLATION ||
    raw.showInflationAdjustedValues === true;
  let inflationRate = raw.inflationRate;
  if (inflationUsed) {
    if (!isFiniteNumber(inflationRate) || inflationRate <= -0.999999) {
      return { ok: false, error: "Inflation rate is too low. Enter a rate above -99.9%." };
    }
  } else if (!isFiniteNumber(inflationRate) || inflationRate <= -0.999999) {
    inflationRate = 0;
  }

  const totalPeriods = Math.max(1, Math.round(requestedYears * periodsPerYear));
  const retirementYears = totalPeriods / periodsPerYear;
  const periodicReturn = annualToPeriodic(annualReturn, periodsPerYear);
  if (!isFiniteNumber(periodicReturn)) {
    return { ok: false, error: "Could not compute a periodic return from the annual return. Check your inputs." };
  }

  let initialPeriodicWithdrawal;
  let initialAnnualWithdrawal;
  let initialWithdrawalRate;

  if (withdrawalType === "dollar") {
    initialPeriodicWithdrawal = raw.periodicWithdrawal;
    if (!isFiniteNumber(initialPeriodicWithdrawal) || initialPeriodicWithdrawal < 0) {
      return { ok: false, error: "Withdrawal amount must be $0 or more." };
    }
    initialAnnualWithdrawal = initialPeriodicWithdrawal * periodsPerYear;
    initialWithdrawalRate =
      startingPortfolio > 0 ? initialAnnualWithdrawal / startingPortfolio : null;
  } else {
    initialWithdrawalRate = raw.initialWithdrawalRate;
    if (!isFiniteNumber(initialWithdrawalRate) || initialWithdrawalRate < 0) {
      return { ok: false, error: "Withdrawal rate must be 0% or more." };
    }
    if (initialWithdrawalRate > 0.5) {
      return {
        ok: false,
        error: "Withdrawal rate looks unrealistically high for this model (cap: 50%)."
      };
    }
    initialAnnualWithdrawal = startingPortfolio * initialWithdrawalRate;
    initialPeriodicWithdrawal = initialAnnualWithdrawal / periodsPerYear;
  }

  const yearly = [{
    year: 0,
    starting: startingPortfolio,
    withdrawals: 0,
    growth: 0,
    ending: startingPortfolio,
    endingReal: startingPortfolio
  }];

  let balance = startingPortfolio;
  let depleted = false;
  let depletionRetirementYears = null;
  let yearStartingBalance = startingPortfolio;
  let yearWithdrawals = 0;
  let yearGrowth = 0;

  function closeYear(yearNumber) {
    yearly.push({
      year: yearNumber,
      starting: yearStartingBalance,
      withdrawals: yearWithdrawals,
      growth: yearGrowth,
      ending: balance,
      endingReal: balance / Math.pow(1 + inflationRate, yearNumber)
    });
    yearStartingBalance = balance;
    yearWithdrawals = 0;
    yearGrowth = 0;
  }

  for (let periodIndex = 0; periodIndex < totalPeriods; periodIndex += 1) {
    if (depleted) {
      if ((periodIndex + 1) % periodsPerYear === 0) {
        closeYear((periodIndex + 1) / periodsPerYear);
      }
      continue;
    }

    if (balance <= 0) {
      depleted = true;
      depletionRetirementYears = periodIndex / periodsPerYear;
      if ((periodIndex + 1) % periodsPerYear === 0) {
        closeYear((periodIndex + 1) / periodsPerYear);
      }
      continue;
    }

    const periodicWithdrawal = withdrawalForPeriod(
      initialPeriodicWithdrawal,
      inflationRate,
      withdrawalAdjustment,
      periodIndex,
      periodsPerYear
    );
    const startingPeriodBalance = balance;
    const growth = startingPeriodBalance * periodicReturn;
    const afterGrowth = startingPeriodBalance * (1 + periodicReturn);

    if (afterGrowth > periodicWithdrawal) {
      yearGrowth += growth;
      yearWithdrawals += periodicWithdrawal;
      balance = afterGrowth - periodicWithdrawal;
    } else {
      // Depletion period: record actual growth applied and withdraw the
      // remaining balance so starting + growth − withdrawal = ending = 0.
      if (afterGrowth > 0) {
        yearGrowth += growth;
        yearWithdrawals += afterGrowth;
      } else {
        yearGrowth += -startingPeriodBalance;
      }
      balance = 0;
      depleted = true;
      depletionRetirementYears =
        (periodIndex +
          (periodicWithdrawal > 0
            ? clamp(afterGrowth / periodicWithdrawal, 0, 1)
            : 1)) /
        periodsPerYear;
    }

    if ((periodIndex + 1) % periodsPerYear === 0) {
      closeYear((periodIndex + 1) / periodsPerYear);
    }
  }

  if (totalPeriods % periodsPerYear !== 0) {
    closeYear(retirementYears);
  }

  const HORIZON_EPS = 1e-9;
  const hitZero = depleted;
  const lastedFullHorizon =
    !hitZero ||
    (isFiniteNumber(depletionRetirementYears) &&
      depletionRetirementYears >= retirementYears - HORIZON_EPS);
  const prematureDepletion = hitZero && !lastedFullHorizon;

  let yearlyForOutput = yearly;
  if (prematureDepletion && isFiniteNumber(depletionRetirementYears)) {
    const finalYear = Math.min(retirementYears, Math.ceil(depletionRetirementYears - 1e-9));
    yearlyForOutput = yearly.filter(function (row) {
      return row.year === 0 || row.year <= finalYear;
    });
  }

  const finalRow = yearlyForOutput[yearlyForOutput.length - 1];
  const totalWithdrawals = yearlyForOutput.reduce(function (total, row) {
    return total + row.withdrawals;
  }, 0);

  return {
    ok: true,
    errors: [],
    inputs: {
      portfolio: startingPortfolio,
      rA: annualReturn,
      requestedRetirementYears: requestedYears,
      retirementYears,
      ppy: periodsPerYear,
      withdrawalType,
      withdrawalAdjustment,
      periodicWithdrawal: initialPeriodicWithdrawal,
      annualWithdrawal: initialAnnualWithdrawal,
      startingWR: initialWithdrawalRate,
      infl: inflationRate
    },
    portfolioAtStart: startingPortfolio,
    yearly: yearlyForOutput,
    finalNominal: finalRow.ending,
    finalReal: finalRow.endingReal,
    totalWithdrawals,
    depleted: prematureDepletion,
    depletionRetirementYears: hitZero ? depletionRetirementYears : null,
    fullHorizon: lastedFullHorizon,
    endsAtZero: finalRow.ending <= 1e-6,
    chart: {
      years: yearlyForOutput.map((row) => row.year),
      nominal: yearlyForOutput.map((row) => row.ending),
      real: yearlyForOutput.map((row) => row.endingReal)
    }
  };
}

export {
  WITHDRAWAL_ADJUSTMENTS,
  annualToPeriodic,
  withdrawalForPeriod,
  simulateRetirementWithdrawal
};
