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

  function reportingRow(kind, index, startTime, endTime) {
    var row = {
      openingBalance: null,
      startingBalance: null,
      contributions: 0,
      contributionsNominal: 0,
      positiveContributions: 0,
      positiveContributionsNominal: 0,
      withdrawals: 0,
      withdrawalsNominal: 0,
      netCashFlow: 0,
      netCashFlowNominal: 0,
      growth: 0,
      endingBalance: null,
      balance: null,
      startTimeYears: startTime,
      endTimeYears: endTime,
      _startTime: startTime,
      _endTime: endTime,
    };
    if (kind === "year") row.year = index;
    else {
      row.period = index;
      row.year = Math.floor((index - 1) / 12) + 1;
      row.timeYears = endTime;
    }
    return row;
  }

  function addCashFlowToRow(row, amountReal, amountNominal) {
    if (!row) return;
    // Preserve the legacy signed `contributions` fields for existing
    // consumers. Positive-only contributions and withdrawals are exposed
    // separately, while netCashFlow is the explicit reconciliation field.
    row.contributions += amountReal;
    row.contributionsNominal += amountNominal;
    if (amountReal < 0) {
      row.withdrawals += -amountReal;
      row.withdrawalsNominal += -amountNominal;
    } else {
      row.positiveContributions += amountReal;
      row.positiveContributionsNominal += amountNominal;
    }
    row.netCashFlow += amountReal;
    row.netCashFlowNominal += amountNominal;
  }

  function finalizeReportingRow(row, endingBalance) {
    if (!row) return;
    var opening = row.openingBalance != null ? row.openingBalance : endingBalance;
    row.openingBalance = opening;
    row.startingBalance = opening;
    row.endingBalance = endingBalance;
    row.balance = endingBalance;
    row.growth = endingBalance - opening - row.netCashFlow;
  }

  /**
   * Build interval-based reporting schedules without changing headline math.
   * Contributions at a boundary belong to the period they are timed for:
   * beginning cash flows go into the new period; end cash flows close the old one.
   */
  function buildSchedules(
    P0,
    years,
    periodsPerYear,
    contributionAtBeginning,
    times,
    contribPerPeriodReal,
    inflation,
    indexContributionsToInflation,
    rRealAnnual,
    finalBalanceReal
  ) {
    var annualRows = [];
    var annualCount = Math.max(1, Math.ceil(years - TIME_EPS));
    var y;
    for (y = 1; y <= annualCount; y += 1) {
      annualRows.push(reportingRow("year", y, y - 1, Math.min(y, years)));
    }

    var monthlyRows = [];
    if (periodsPerYear === 12) {
      var monthlyCount = Math.max(1, Math.ceil(years * 12 - TIME_EPS));
      var p;
      for (p = 1; p <= monthlyCount; p += 1) {
        monthlyRows.push(
          reportingRow("month", p, (p - 1) / 12, Math.min(p / 12, years))
        );
      }
    }

    annualRows[0].openingBalance = P0;
    annualRows[0].startingBalance = P0;
    if (monthlyRows.length > 0) {
      monthlyRows[0].openingBalance = P0;
      monthlyRows[0].startingBalance = P0;
    }

    var timeline = [0, years];
    times.forEach(function (t) {
      timeline.push(t);
    });
    annualRows.forEach(function (row) {
      timeline.push(row._endTime);
    });
    monthlyRows.forEach(function (row) {
      timeline.push(row._endTime);
    });
    timeline.sort(function (a, b) {
      return a - b;
    });

    var points = [];
    timeline.forEach(function (t) {
      if (points.length === 0 || Math.abs(t - points[points.length - 1]) > TIME_EPS) {
        points.push(t);
      }
    });

    var balance = P0;
    var prevT = 0;
    var contributionIndex = 0;
    var activeAnnual = 0;
    var activeMonthly = monthlyRows.length > 0 ? 0 : -1;

    function closeAndAdvance(rows, activeIndex, t) {
      if (
        activeIndex >= 0 &&
        activeIndex < rows.length &&
        Math.abs(rows[activeIndex]._endTime - t) <= TIME_EPS
      ) {
        finalizeReportingRow(rows[activeIndex], balance);
        activeIndex += 1;
        if (
          activeIndex < rows.length &&
          Math.abs(rows[activeIndex]._startTime - t) <= TIME_EPS
        ) {
          rows[activeIndex].openingBalance = balance;
          rows[activeIndex].startingBalance = balance;
        }
      }
      return activeIndex;
    }

    function closeRows(t) {
      activeAnnual = closeAndAdvance(annualRows, activeAnnual, t);
      activeMonthly = closeAndAdvance(monthlyRows, activeMonthly, t);
    }

    function applyCashFlow(t) {
      while (
        contributionIndex < times.length &&
        Math.abs(times[contributionIndex] - t) <= TIME_EPS
      ) {
        var contribReal = contributionRealAtTime(
          contribPerPeriodReal,
          t,
          inflation,
          indexContributionsToInflation
        );
        var contribNominal = contribReal * Math.pow(1 + inflation, t);
        addCashFlowToRow(annualRows[activeAnnual], contribReal, contribNominal);
        addCashFlowToRow(monthlyRows[activeMonthly], contribReal, contribNominal);
        balance += contribReal;
        contributionIndex += 1;
      }
    }

    points.forEach(function (t) {
      var dt = t - prevT;
      if (dt > TIME_EPS) {
        balance *= growthFactor(rRealAnnual, dt);
      }

      if (contributionAtBeginning) {
        if (t > TIME_EPS) closeRows(t);
        applyCashFlow(t);
      } else {
        applyCashFlow(t);
        if (t > TIME_EPS) closeRows(t);
      }
      prevT = t;
    });

    // Preserve the headline result exactly on the terminal reporting rows.
    finalizeReportingRow(annualRows[annualRows.length - 1], finalBalanceReal);
    if (monthlyRows.length > 0) {
      finalizeReportingRow(monthlyRows[monthlyRows.length - 1], finalBalanceReal);
    }

    function publicRow(row) {
      delete row._startTime;
      delete row._endTime;
      return row;
    }

    var yearZero = {
      year: 0,
      openingBalance: P0,
      startingBalance: P0,
      contributions: 0,
      contributionsNominal: 0,
      positiveContributions: 0,
      positiveContributionsNominal: 0,
      withdrawals: 0,
      withdrawalsNominal: 0,
      netCashFlow: 0,
      netCashFlowNominal: 0,
      growth: 0,
      endingBalance: P0,
      balance: P0,
      startTimeYears: 0,
      endTimeYears: 0,
    };

    return {
      schedule: [yearZero].concat(annualRows.map(publicRow)),
      monthlySchedule: monthlyRows.map(publicRow),
    };
  }

  function emptyResult(P0, rNomAnnual, inflation, yearsEffective, indexContributionsToInflation, contributionPeriodsPerYear) {
    var yearZero = {
      year: 0,
      openingBalance: P0,
      startingBalance: P0,
      contributions: 0,
      contributionsNominal: 0,
      positiveContributions: 0,
      positiveContributionsNominal: 0,
      withdrawals: 0,
      withdrawalsNominal: 0,
      netCashFlow: 0,
      netCashFlowNominal: 0,
      growth: 0,
      endingBalance: P0,
      balance: P0,
      startTimeYears: 0,
      endTimeYears: 0,
    };
    return {
      finalBalanceReal: P0,
      finalBalanceNominal: P0 * Math.pow(1 + inflation, yearsEffective),
      startingAmount: P0,
      totalContributions: 0,
      totalContributionsNominal: 0,
      totalPositiveContributions: 0,
      totalPositiveContributionsNominal: 0,
      totalWithdrawals: 0,
      totalWithdrawalsNominal: 0,
      growth: 0,
      schedule: [yearZero],
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
    var inflationRaw = Number(inflationAnnual);
    var inflation = Number.isFinite(inflationRaw) ? inflationRaw : 0;
    var contribPerPeriodReal = Number(contributionPerPeriod);

    if (!Number.isFinite(rNomAnnual) || rNomAnnual <= -1) {
      return { error: "Annual return must be greater than -100%." };
    }
    if (inflation <= -1) {
      return { error: "Inflation must be greater than -100%." };
    }

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
    var totalPositiveContributionsReal = 0;
    var totalPositiveContributionsNominal = 0;
    var totalWithdrawalsReal = 0;
    var totalWithdrawalsNominal = 0;
    var prevT = 0;

    function applyGrowth(toTime) {
      var dt = toTime - prevT;
      if (dt <= TIME_EPS) return 0;
      var before = balanceReal;
      balanceReal *= growthFactor(rRealAnnual, dt);
      var growth = balanceReal - before;
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
      if (contribReal < 0) {
        totalWithdrawalsReal += -contribReal;
        totalWithdrawalsNominal += -contribNominal;
      } else {
        totalPositiveContributionsReal += contribReal;
        totalPositiveContributionsNominal += contribNominal;
      }
    }

    // Grow from last contribution (or t=0) to the exact terminal horizon Y.
    applyGrowth(yearsInput);
    var schedules = inputs._skipScheduleGeneration
      ? { schedule: [], monthlySchedule: [] }
      : buildSchedules(
          P0,
          yearsInput,
          contributionPeriodsPerYear,
          contributionAtBeginning,
          times,
          contribPerPeriodReal,
          inflation,
          indexContributionsToInflation,
          rRealAnnual,
          balanceReal
        );

    var inflationFactor = Math.pow(1 + inflation, yearsInput);
    var finalBalanceNominal = balanceReal * inflationFactor;
    var growthReal = balanceReal - P0 - totalContributionsReal;

    return {
      finalBalanceReal: balanceReal,
      finalBalanceNominal: finalBalanceNominal,
      startingAmount: P0,
      totalContributions: totalContributionsReal,
      totalContributionsNominal: totalContributionsNominal,
      totalPositiveContributions: totalPositiveContributionsReal,
      totalPositiveContributionsNominal: totalPositiveContributionsNominal,
      totalWithdrawals: totalWithdrawalsReal,
      totalWithdrawalsNominal: totalWithdrawalsNominal,
      growth: growthReal,
      schedule: schedules.schedule,
      monthlySchedule: schedules.monthlySchedule,
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
    var sim = simulateInvestment(Object.assign({}, simInputs, {
      nominalAnnualReturn: nominalReturn,
      _skipScheduleGeneration: true,
    }));
    if (sim.error || !Number.isFinite(sim.finalBalanceReal)) return NaN;
    return sim.finalBalanceReal;
  }

  function packSolveResult(nominalReturn, simInputs, target, opts) {
    opts = opts || {};
    var sim = simulateInvestment(Object.assign({}, simInputs, {
      nominalAnnualReturn: nominalReturn,
      _skipScheduleGeneration: false,
    }));
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

    var atZero = simulateInvestment(Object.assign({}, simInputs, {
      nominalAnnualReturn: 0,
      _skipScheduleGeneration: true,
    }));
    if (atZero.error) return { error: atZero.error };
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
