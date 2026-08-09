/**
 * Shared investment growth simulation and required-return solver.
 * Real-dollar simulation with optional inflation-indexed contributions (default: on).
 *
 * Terminal horizon is the exact user-entered years Y (including fractional years).
 * Contribution frequency only chooses contribution dates inside [0, Y]; it does not
 * redefine the investment horizon via round(m × Y).
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
  var TIME_EPS = 1e-12;

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

  function growthFactor(rRealAnnual, yearsDelta) {
    if (!(yearsDelta > 0)) return 1;
    return Math.pow(1 + rRealAnnual, yearsDelta);
  }

  /**
   * Contribution dates inside the exact horizon Y.
   * End-of-period: Δ, 2Δ, … while t ≤ Y.
   * Beginning-of-period: 0, Δ, 2Δ, … while t < Y
   *   (includes the start of a partial final contribution period; excludes t = Y).
   */
  function contributionTimes(years, periodsPerYear, contributionAtBeginning) {
    var m = periodsPerYear;
    var Y = years;
    var times = [];
    var k;
    var t;
    var maxK = m * MAX_HORIZON_YEARS + 5;
    if (contributionAtBeginning) {
      k = 0;
      while (k <= maxK) {
        t = k / m;
        if (t >= Y - TIME_EPS) break;
        times.push(t);
        k += 1;
      }
    } else {
      k = 1;
      while (k <= maxK) {
        t = k / m;
        if (t > Y + TIME_EPS) break;
        times.push(t);
        k += 1;
      }
    }
    return times;
  }

  function contributionRealAtTime(contribInitialReal, timeYears, inflationAnnual, indexContributionsToInflation) {
    if (indexContributionsToInflation) return contribInitialReal;
    return contribInitialReal / Math.pow(1 + inflationAnnual, timeYears);
  }

  function emptyResult(P0, rNomAnnual, inflation, yearsEffective, indexContributionsToInflation, contributionPeriodsPerYear) {
    return {
      finalBalanceReal: P0,
      finalBalanceNominal: P0 * Math.pow(1 + inflation, yearsEffective),
      startingAmount: P0,
      totalContributions: 0,
      totalContributionsNominal: 0,
      growth: 0,
      schedule: [{ year: 0, contributions: 0, contributionsNominal: 0, growth: 0, balance: P0 }],
      monthlySchedule: [],
      contributionTimes: [],
      nominalAnnualReturn: rNomAnnual,
      realAnnualReturn: calculateRealReturn(rNomAnnual, inflation),
      inflationAnnual: inflation,
      years: yearsEffective,
      periods: 0,
      contributionPeriodsPerYear: contributionPeriodsPerYear || 1,
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

    var yearsInput = Number(years);
    if (!Number.isFinite(yearsInput) || yearsInput < 0) yearsInput = 0;
    yearsInput = Math.min(MAX_HORIZON_YEARS, yearsInput);
    if (yearsInput === 0) {
      return emptyResult(P0, rNomAnnual, inflation, 0, indexContributionsToInflation, contributionPeriodsPerYear);
    }

    var rRealAnnual = calculateRealReturn(rNomAnnual, inflation);
    var times = contributionTimes(yearsInput, contributionPeriodsPerYear, contributionAtBeginning);

    var balanceReal = P0;
    var totalContributionsReal = 0;
    var totalContributionsNominal = 0;
    var prevT = 0;
    var monthlySchedule = [];
    var yearMap = {};
    var scheduleYearCount = Math.max(1, Math.ceil(yearsInput - TIME_EPS));

    function ensureYear(yearNum) {
      if (!yearMap[yearNum]) {
        yearMap[yearNum] = {
          year: yearNum,
          contributions: 0,
          contributionsNominal: 0,
          growth: 0,
          endingBalance: 0,
        };
      }
      return yearMap[yearNum];
    }

    function applyGrowth(toTime) {
      var dt = toTime - prevT;
      if (dt <= TIME_EPS) return 0;
      var before = balanceReal;
      balanceReal *= growthFactor(rRealAnnual, dt);
      var growth = balanceReal - before;
      var yearNum = Math.min(scheduleYearCount, Math.max(1, Math.ceil(toTime - TIME_EPS)));
      ensureYear(yearNum).growth += growth;
      prevT = toTime;
      return growth;
    }

    var i;
    for (i = 0; i < times.length; i += 1) {
      var t = times[i];
      applyGrowth(t);

      var contribReal = contributionRealAtTime(
        contribPerPeriodReal,
        t,
        inflation,
        indexContributionsToInflation
      );
      var contribNominal = contribReal * Math.pow(1 + inflation, t);
      balanceReal += contribReal;
      totalContributionsReal += contribReal;
      totalContributionsNominal += contribNominal;

      var yearNum = Math.min(scheduleYearCount, Math.max(1, Math.ceil(t - TIME_EPS) || 1));
      if (t <= TIME_EPS) yearNum = 1;
      var yd = ensureYear(yearNum);
      yd.contributions += contribReal;
      yd.contributionsNominal += contribNominal;
      yd.endingBalance = balanceReal;

      if (contributionPeriodsPerYear === 12) {
        monthlySchedule.push({
          period: i + 1,
          year: yearNum,
          timeYears: t,
          contributions: contribReal,
          contributionsNominal: contribNominal,
          growth: 0,
          balance: balanceReal,
        });
      }
    }

    // Grow from last contribution (or t=0) to the exact terminal horizon Y.
    applyGrowth(yearsInput);
    var finalYear = ensureYear(scheduleYearCount);
    finalYear.endingBalance = balanceReal;

    var schedule = [{ year: 0, contributions: 0, contributionsNominal: 0, growth: 0, balance: P0 }];
    var y;
    for (y = 1; y <= scheduleYearCount; y += 1) {
      var row = yearMap[y] || {
        year: y,
        contributions: 0,
        contributionsNominal: 0,
        growth: 0,
        endingBalance: balanceReal,
      };
      schedule.push({
        year: y,
        contributions: row.contributions,
        contributionsNominal: row.contributionsNominal,
        growth: row.growth,
        balance: row.endingBalance || balanceReal,
      });
    }

    var inflationFactor = Math.pow(1 + inflation, yearsInput);
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
      contributionTimes: times.slice(),
      nominalAnnualReturn: rNomAnnual,
      realAnnualReturn: rRealAnnual,
      inflationAnnual: inflation,
      years: yearsInput,
      periods: times.length,
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
        return packSolveResult(minReturn, simInputs, target, { unreachableAtFloor: true });
      }
      var negRoot = bisectNominalReturn(simInputs, target, minReturn, 0, tolerance);
      return packSolveResult(negRoot, simInputs, target);
    }

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
    contributionTimes: contributionTimes,
    SP500_NOMINAL_ANNUAL_RETURN_50Y: SP500_NOMINAL_ANNUAL_RETURN_50Y,
    SP500_REAL_ANNUAL_RETURN_50Y: SP500_REAL_ANNUAL_RETURN_50Y,
    SP500_REFERENCE_PERIOD: SP500_REFERENCE_PERIOD,
    HIGH_RETURN_WARNING_THRESHOLD: HIGH_RETURN_WARNING_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
