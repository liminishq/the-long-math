/**
 * Shared investment growth simulation and required-return solver.
 * Real-dollar simulation with optional inflation-indexed contributions (default: on).
 */
(function (global) {
  "use strict";

  /** S&P 500 annualized total return (with dividends), calendar years 1975–2024. */
  var SP500_NOMINAL_ANNUAL_RETURN_50Y = 0.1211;
  var SP500_REFERENCE_PERIOD = "1975–2024";
  var HIGH_RETURN_WARNING_THRESHOLD = 0.07;
  var DEFAULT_SOLVE_MAX_RETURN = 10;
  var MAX_HORIZON_YEARS = 60;

  function clampNonNeg(x) {
    return Math.max(0, x);
  }

  function calculateRealReturn(rNom, inflation) {
    if (inflation <= -1) return rNom;
    return (1 + rNom) / (1 + inflation) - 1;
  }

  function getPeriodRealReturn(rRealAnnual, periodsPerYear) {
    return periodsPerYear === 12
      ? Math.pow(1 + rRealAnnual, 1 / 12) - 1
      : rRealAnnual;
  }

  /**
   * Real contribution for a period. When indexed to inflation, real amount stays constant
   * (nominal contribution rises with inflation). When not indexed, nominal stays flat and
   * real contribution shrinks over time.
   */
  function contributionRealForPeriod(contribInitialReal, periodIndex, periodsPerYear, inflationAnnual, indexContributionsToInflation) {
    if (indexContributionsToInflation) {
      return contribInitialReal;
    }
    var yearsElapsed = periodIndex / periodsPerYear;
    return contribInitialReal / Math.pow(1 + inflationAnnual, yearsElapsed);
  }

  function nominalFromReal(realAmount, yearsElapsed, inflationAnnual) {
    return realAmount * Math.pow(1 + inflationAnnual, yearsElapsed);
  }

  function simulateInvestment(inputs) {
    var startingAmount = inputs.startingAmount != null ? inputs.startingAmount : 0;
    var contributionPerPeriod = inputs.contributionPerPeriod != null ? inputs.contributionPerPeriod : 0;
    var years = inputs.years != null ? inputs.years : 1;
    var nominalAnnualReturn = inputs.nominalAnnualReturn != null ? inputs.nominalAnnualReturn : 0;
    var inflationAnnual = inputs.inflationAnnual != null ? inputs.inflationAnnual : 0;
    var contributionPeriodsPerYear = inputs.contributionPeriodsPerYear === 1 ? 1 : 12;
    var contributionAtBeginning = !!inputs.contributionAtBeginning;
    var indexContributionsToInflation = inputs.indexContributionsToInflation !== false;

    var P0 = clampNonNeg(Number(startingAmount));
    var yearsClamped = Math.max(1, Math.min(MAX_HORIZON_YEARS, Math.round(Number(years))));
    var rNomAnnual = Number(nominalAnnualReturn);
    var inflation = clampNonNeg(Number(inflationAnnual));
    var contribPerPeriodReal = Number(contributionPerPeriod);
    var totalPeriods = Math.round(contributionPeriodsPerYear * yearsClamped);

    var rRealAnnual = calculateRealReturn(rNomAnnual, inflation);
    var rRealPeriod = getPeriodRealReturn(rRealAnnual, contributionPeriodsPerYear);

    var balanceReal = P0;
    var totalContributionsReal = 0;
    var totalContributionsNominal = 0;

    var schedule = [];
    var monthlySchedule = [];
    var yearData = [];
    var y;
    for (y = 0; y <= yearsClamped; y += 1) {
      yearData.push({
        year: y,
        contributions: 0,
        contributionsNominal: 0,
        growth: 0,
        startingBalance: y === 0 ? balanceReal : 0,
        endingBalance: 0,
      });
    }

    var period;
    for (period = 0; period < totalPeriods; period += 1) {
      var periodStartBalance = balanceReal;
      var periodContributionReal = 0;
      var periodContributionNominal = 0;
      var periodGrowth = 0;
      var yearsElapsed = period / contributionPeriodsPerYear;

      var contribReal = contributionRealForPeriod(
        contribPerPeriodReal,
        period,
        contributionPeriodsPerYear,
        inflation,
        indexContributionsToInflation
      );
      var contribNominal = nominalFromReal(contribReal, yearsElapsed, inflation);

      if (contributionAtBeginning) {
        balanceReal += contribReal;
        periodContributionReal += contribReal;
        periodContributionNominal += contribNominal;
        totalContributionsReal += contribReal;
        totalContributionsNominal += contribNominal;
      }

      periodGrowth = balanceReal * rRealPeriod;
      balanceReal += periodGrowth;

      if (!contributionAtBeginning) {
        balanceReal += contribReal;
        periodContributionReal += contribReal;
        periodContributionNominal += contribNominal;
        totalContributionsReal += contribReal;
        totalContributionsNominal += contribNominal;
      }

      var yearNum = Math.floor(period / contributionPeriodsPerYear) + 1;
      if (yearNum <= yearsClamped && yearData[yearNum]) {
        yearData[yearNum].contributions += periodContributionReal;
        yearData[yearNum].contributionsNominal += periodContributionNominal;
        yearData[yearNum].growth += periodGrowth;
        yearData[yearNum].endingBalance = balanceReal;
        if (yearNum > 0 && yearData[yearNum].startingBalance === 0) {
          yearData[yearNum].startingBalance = periodStartBalance;
        }
      }

      if (contributionPeriodsPerYear === 12) {
        monthlySchedule.push({
          period: period + 1,
          year: Math.floor(period / contributionPeriodsPerYear) + 1,
          contributions: periodContributionReal,
          contributionsNominal: periodContributionNominal,
          growth: periodGrowth,
          balance: balanceReal,
        });
      }
    }

    for (y = 0; y <= yearsClamped; y += 1) {
      if (y === 0) {
        schedule.push({
          year: 0,
          contributions: 0,
          contributionsNominal: 0,
          growth: 0,
          balance: P0,
        });
      } else if (yearData[y]) {
        schedule.push({
          year: y,
          contributions: yearData[y].contributions,
          contributionsNominal: yearData[y].contributionsNominal,
          growth: yearData[y].growth,
          balance: yearData[y].endingBalance,
        });
      }
    }

    var inflationFactor = Math.pow(1 + inflation, yearsClamped);
    var finalBalanceNominal = balanceReal * inflationFactor;
    var growthReal = balanceReal - P0 - totalContributionsReal;

    return {
      finalBalanceReal: balanceReal,
      finalBalanceNominal: finalBalanceNominal,
      startingAmount: P0,
      totalContributions: totalContributionsReal,
      totalContributionsNominal: totalContributionsNominal,
      growth: growthReal,
      schedule: schedule,
      monthlySchedule: monthlySchedule,
      nominalAnnualReturn: rNomAnnual,
      realAnnualReturn: rRealAnnual,
      inflationAnnual: inflation,
      years: yearsClamped,
      indexContributionsToInflation: indexContributionsToInflation,
    };
  }

  function endingRealAtReturn(simInputs, nominalReturn) {
    return simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: nominalReturn })).finalBalanceReal;
  }

  function solveRequiredNominalReturn(inputs) {
    var targetBalanceReal = inputs.targetBalanceReal;
    var maxReturn = inputs.maxReturn != null ? inputs.maxReturn : DEFAULT_SOLVE_MAX_RETURN;
    var tolerance = inputs.tolerance != null ? inputs.tolerance : 0.01;
    var simInputs = Object.assign({}, inputs);
    delete simInputs.targetBalanceReal;
    delete simInputs.maxReturn;
    delete simInputs.tolerance;

    var target = Number(targetBalanceReal);
    if (!Number.isFinite(target) || target < 0) {
      return { error: "Invalid target balance" };
    }

    var atZero = simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: 0 }));
    if (atZero.finalBalanceReal >= target - tolerance) {
      return {
        nominalAnnualReturn: 0,
        realAnnualReturn: calculateRealReturn(0, simInputs.inflationAnnual || 0),
        unreachableAtCap: false,
        projectedFinalReal: atZero.finalBalanceReal,
        shortfallReal: Math.max(0, target - atZero.finalBalanceReal),
        exceedsHistoricalWarning: false,
        simulation: atZero,
      };
    }

    var high = 0.07;
    var endingAtHigh = endingRealAtReturn(simInputs, high);
    while (endingAtHigh < target && high < maxReturn) {
      high = Math.min(high * 2, maxReturn);
      endingAtHigh = endingRealAtReturn(simInputs, high);
    }

    var unreachableAtCap = endingAtHigh < target - tolerance;
    if (unreachableAtCap) {
      var simAtCap = simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: high }));
      return {
        nominalAnnualReturn: high,
        realAnnualReturn: calculateRealReturn(high, simInputs.inflationAnnual || 0),
        unreachableAtCap: true,
        projectedFinalReal: simAtCap.finalBalanceReal,
        shortfallReal: target - simAtCap.finalBalanceReal,
        exceedsHistoricalWarning: high > HIGH_RETURN_WARNING_THRESHOLD,
        simulation: simAtCap,
      };
    }

    var low = 0;
    var i;
    for (i = 0; i < 60; i += 1) {
      var mid = (low + high) / 2;
      var endingMid = endingRealAtReturn(simInputs, mid);
      if (endingMid >= target - tolerance) {
        high = mid;
      } else {
        low = mid;
      }
    }

    var finalSim = simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: high }));
    return {
      nominalAnnualReturn: high,
      realAnnualReturn: calculateRealReturn(high, simInputs.inflationAnnual || 0),
      unreachableAtCap: false,
      projectedFinalReal: finalSim.finalBalanceReal,
      shortfallReal: Math.max(0, target - finalSim.finalBalanceReal),
      exceedsHistoricalWarning: high > HIGH_RETURN_WARNING_THRESHOLD,
      simulation: finalSim,
    };
  }

  global.InvestmentGrowthEngine = {
    simulateInvestment: simulateInvestment,
    solveRequiredNominalReturn: solveRequiredNominalReturn,
    calculateRealReturn: calculateRealReturn,
    SP500_NOMINAL_ANNUAL_RETURN_50Y: SP500_NOMINAL_ANNUAL_RETURN_50Y,
    SP500_REFERENCE_PERIOD: SP500_REFERENCE_PERIOD,
    HIGH_RETURN_WARNING_THRESHOLD: HIGH_RETURN_WARNING_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
