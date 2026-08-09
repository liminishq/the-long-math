/**
 * Shared investment growth simulation and required-return solver.
 * Real-dollar simulation with optional inflation-indexed contributions (default: on).
 */
(function (global) {
  "use strict";

  /** S&P 500 annualized total returns (with dividends), calendar years 1975–2024. */
  var SP500_NOMINAL_ANNUAL_RETURN_50Y = 0.1211;
  var SP500_REAL_ANNUAL_RETURN_50Y = 0.082;
  var SP500_REFERENCE_PERIOD = "1975–2024";
  /** Warn when required *real* (after-inflation) annual return exceeds this. */
  var HIGH_RETURN_WARNING_THRESHOLD = 0.07;
  var DEFAULT_SOLVE_MAX_RETURN = 10;
  var DEFAULT_SOLVE_MIN_RETURN = -0.9999;
  var MAX_HORIZON_YEARS = 60;

  function clampNonNeg(x) {
    return Math.max(0, x);
  }

  function calculateRealReturn(rNom, inflation) {
    if (inflation <= -1) return rNom;
    return (1 + rNom) / (1 + inflation) - 1;
  }

  function normalizePeriodsPerYear(value) {
    var ppy = Math.round(Number(value));
    if (!Number.isFinite(ppy) || ppy < 1) return 12;
    return ppy;
  }

  function getPeriodRealReturn(rRealAnnual, periodsPerYear) {
    var ppy = normalizePeriodsPerYear(periodsPerYear);
    if (ppy === 1) return rRealAnnual;
    return Math.pow(1 + rRealAnnual, 1 / ppy) - 1;
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

  function emptyResult(P0, rNomAnnual, inflation, yearsEffective, indexContributionsToInflation) {
    return {
      finalBalanceReal: P0,
      finalBalanceNominal: P0 * Math.pow(1 + inflation, yearsEffective),
      startingAmount: P0,
      totalContributions: 0,
      totalContributionsNominal: 0,
      growth: 0,
      schedule: [{ year: 0, contributions: 0, contributionsNominal: 0, growth: 0, balance: P0 }],
      monthlySchedule: [],
      nominalAnnualReturn: rNomAnnual,
      realAnnualReturn: calculateRealReturn(rNomAnnual, inflation),
      inflationAnnual: inflation,
      years: yearsEffective,
      periods: 0,
      contributionPeriodsPerYear: 1,
      indexContributionsToInflation: !!indexContributionsToInflation,
    };
  }

  function simulateInvestment(inputs) {
    var startingAmount = inputs.startingAmount != null ? inputs.startingAmount : 0;
    var contributionPerPeriod = inputs.contributionPerPeriod != null ? inputs.contributionPerPeriod : 0;
    var years = inputs.years != null ? inputs.years : 1;
    var nominalAnnualReturn = inputs.nominalAnnualReturn != null ? inputs.nominalAnnualReturn : 0;
    var inflationAnnual = inputs.inflationAnnual != null ? inputs.inflationAnnual : 0;
    var contributionPeriodsPerYear = normalizePeriodsPerYear(inputs.contributionPeriodsPerYear);
    var contributionAtBeginning = !!inputs.contributionAtBeginning;
    var indexContributionsToInflation = inputs.indexContributionsToInflation !== false;

    var P0 = clampNonNeg(Number(startingAmount));
    var rNomAnnual = Number(nominalAnnualReturn);
    var inflation = clampNonNeg(Number(inflationAnnual));
    var contribPerPeriodReal = Number(contributionPerPeriod);

    // Preserve fractional horizons (e.g. 9.5y → 114 months). Do not round years first.
    var yearsInput = Number(years);
    if (!Number.isFinite(yearsInput) || yearsInput < 0) yearsInput = 0;
    yearsInput = Math.min(MAX_HORIZON_YEARS, yearsInput);
    if (yearsInput === 0) {
      return emptyResult(P0, rNomAnnual, inflation, 0, indexContributionsToInflation);
    }

    var maxPeriods = Math.round(contributionPeriodsPerYear * MAX_HORIZON_YEARS);
    var totalPeriods = Math.max(1, Math.min(maxPeriods, Math.round(contributionPeriodsPerYear * yearsInput)));
    var yearsEffective = totalPeriods / contributionPeriodsPerYear;
    var scheduleYearCount = Math.ceil(totalPeriods / contributionPeriodsPerYear);

    var rRealAnnual = calculateRealReturn(rNomAnnual, inflation);
    var rRealPeriod = getPeriodRealReturn(rRealAnnual, contributionPeriodsPerYear);

    var balanceReal = P0;
    var totalContributionsReal = 0;
    var totalContributionsNominal = 0;

    var schedule = [];
    var monthlySchedule = [];
    var yearData = [];
    var y;
    for (y = 0; y <= scheduleYearCount; y += 1) {
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
      if (yearNum <= scheduleYearCount && yearData[yearNum]) {
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

    for (y = 0; y <= scheduleYearCount; y += 1) {
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

    var inflationFactor = Math.pow(1 + inflation, yearsEffective);
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
      years: yearsEffective,
      periods: totalPeriods,
      contributionPeriodsPerYear: contributionPeriodsPerYear,
      indexContributionsToInflation: indexContributionsToInflation,
    };
  }

  function endingRealAtReturn(simInputs, nominalReturn) {
    return simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: nominalReturn })).finalBalanceReal;
  }

  function packSolveResult(nominalReturn, simInputs, target, opts) {
    opts = opts || {};
    var sim = simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: nominalReturn }));
    var realReturn = calculateRealReturn(nominalReturn, simInputs.inflationAnnual || 0);
    return {
      nominalAnnualReturn: nominalReturn,
      realAnnualReturn: realReturn,
      unreachableAtCap: !!opts.unreachableAtCap,
      unreachableAtFloor: !!opts.unreachableAtFloor,
      projectedFinalReal: sim.finalBalanceReal,
      shortfallReal: Math.max(0, target - sim.finalBalanceReal),
      exceedsHistoricalWarning: realReturn > HIGH_RETURN_WARNING_THRESHOLD,
      simulation: sim,
    };
  }

  function bisectNominalReturn(simInputs, target, low, high, tolerance) {
    var i;
    for (i = 0; i < 80; i += 1) {
      var mid = (low + high) / 2;
      var endingMid = endingRealAtReturn(simInputs, mid);
      if (endingMid >= target - tolerance) {
        high = mid;
      } else {
        low = mid;
      }
    }
    return high;
  }

  function solveRequiredNominalReturn(inputs) {
    var targetBalanceReal = inputs.targetBalanceReal;
    var maxReturn = inputs.maxReturn != null ? inputs.maxReturn : DEFAULT_SOLVE_MAX_RETURN;
    var minReturn = inputs.minReturn != null ? inputs.minReturn : DEFAULT_SOLVE_MIN_RETURN;
    var tolerance = inputs.tolerance != null ? inputs.tolerance : 0.01;
    var simInputs = Object.assign({}, inputs);
    delete simInputs.targetBalanceReal;
    delete simInputs.maxReturn;
    delete simInputs.minReturn;
    delete simInputs.tolerance;

    var target = Number(targetBalanceReal);
    if (!Number.isFinite(target) || target < 0) {
      return { error: "Invalid target balance" };
    }

    var atZero = simulateInvestment(Object.assign({}, simInputs, { nominalAnnualReturn: 0 }));
    var endingAtZero = atZero.finalBalanceReal;

    // Already at/above target with 0% nominal: solve for a (possibly negative) return.
    if (endingAtZero >= target - tolerance) {
      if (Math.abs(endingAtZero - target) <= tolerance) {
        return packSolveResult(0, simInputs, target);
      }
      var endingAtFloor = endingRealAtReturn(simInputs, minReturn);
      if (endingAtFloor > target + tolerance) {
        // Even near −100%, real ending still exceeds the target (e.g. large contributions).
        return packSolveResult(minReturn, simInputs, target, { unreachableAtFloor: true });
      }
      var negRoot = bisectNominalReturn(simInputs, target, minReturn, 0, tolerance);
      return packSolveResult(negRoot, simInputs, target);
    }

    // Below target at 0%: search positive (and above) nominal returns.
    var high = 0.07;
    var endingAtHigh = endingRealAtReturn(simInputs, high);
    while (endingAtHigh < target && high < maxReturn) {
      high = Math.min(high * 2, maxReturn);
      endingAtHigh = endingRealAtReturn(simInputs, high);
    }

    if (endingAtHigh < target - tolerance) {
      return packSolveResult(high, simInputs, target, { unreachableAtCap: true });
    }

    var posRoot = bisectNominalReturn(simInputs, target, 0, high, tolerance);
    return packSolveResult(posRoot, simInputs, target);
  }

  global.InvestmentGrowthEngine = {
    simulateInvestment: simulateInvestment,
    solveRequiredNominalReturn: solveRequiredNominalReturn,
    calculateRealReturn: calculateRealReturn,
    SP500_NOMINAL_ANNUAL_RETURN_50Y: SP500_NOMINAL_ANNUAL_RETURN_50Y,
    SP500_REAL_ANNUAL_RETURN_50Y: SP500_REAL_ANNUAL_RETURN_50Y,
    SP500_REFERENCE_PERIOD: SP500_REFERENCE_PERIOD,
    HIGH_RETURN_WARNING_THRESHOLD: HIGH_RETURN_WARNING_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
