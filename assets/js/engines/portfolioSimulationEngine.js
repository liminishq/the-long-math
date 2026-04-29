/**
 * The Long Math — standardized-period portfolio simulation engine
 *
 * One rigorous, schedule-aware model for fee-impact calculators:
 * standardized frequencies (no calendar dates), explicit event ordering,
 * full precision internally, AUM fees as balance deductions (not "return − fee" shortcuts).
 *
 * Default event order each simulation step:
 *   1. Start-of-period contributions and start-of-period withdrawals
 *   2. Growth: multiply balance by (1 + annualGrossReturn)^(1/stepsPerYear)
 *   3. End-of-period withdrawals and end-of-period fees
 *
 * Exposure: window.TLM_PortfolioSimulation
 */
(function (global) {
  "use strict";

  const PERIODS_PER_YEAR = {
    daily: 365,
    weekly: 52,
    biweekly: 26,
    semiMonthly: 24,
    monthly: 12,
    quarterly: 4,
    annually: 1,
  };

  function gcd(a, b) {
    let x = Math.abs(Math.floor(a));
    let y = Math.abs(Math.floor(b));
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  function lcm(a, b) {
    return (a * b) / gcd(a, b);
  }

  function lcmMany(values) {
    const xs = values.filter((v) => Number.isFinite(v) && v > 0);
    if (xs.length === 0) return 1;
    return xs.reduce((acc, v) => lcm(acc, v), xs[0]);
  }

  function periodsForFrequency(freq) {
    const n = PERIODS_PER_YEAR[freq];
    if (!Number.isFinite(n)) {
      throw new Error(`Unknown frequency key: ${freq}`);
    }
    return n;
  }

  function stride(stepsPerYear, freq) {
    const p = periodsForFrequency(freq);
    if (stepsPerYear % p !== 0) {
      throw new Error(
        `stepsPerYear (${stepsPerYear}) must be divisible by periodsPerYear (${p}) for frequency ${freq}`
      );
    }
    return stepsPerYear / p;
  }

  /**
   * Fire at beginning of each sub-period (e.g. first step of each month).
   */
  function firesStartOfSubPeriod(stepInYear, stepsPerYear, freq) {
    const s = stride(stepsPerYear, freq);
    return stepInYear % s === 0;
  }

  /**
   * Fire at end of each sub-period (e.g. last step of each month).
   */
  function firesEndOfSubPeriod(stepInYear, stepsPerYear, freq) {
    const s = stride(stepsPerYear, freq);
    return (stepInYear + 1) % s === 0;
  }

  function contributionAmountAtPhase(scenario, stepInYear, stepsPerYear, phase) {
    const c = scenario.contribution;
    if (!c || !(c.amount > 0) || !c.frequency) return 0;
    const timing = c.timing === "end" ? "end" : "start";
    if (timing !== phase) return 0;
    if (phase === "start" && !firesStartOfSubPeriod(stepInYear, stepsPerYear, c.frequency)) return 0;
    if (phase === "end" && !firesEndOfSubPeriod(stepInYear, stepsPerYear, c.frequency)) return 0;
    return c.amount;
  }

  function withdrawalAmountAtPhase(scenario, stepInYear, stepsPerYear, phase) {
    const w = scenario.withdrawal;
    if (!w || !(w.amount > 0) || !w.frequency) return 0;
    const timing = w.timing === "start" ? "start" : "end";
    if (timing !== phase) return 0;
    if (phase === "start" && !firesStartOfSubPeriod(stepInYear, stepsPerYear, w.frequency)) return 0;
    if (phase === "end" && !firesEndOfSubPeriod(stepInYear, stepsPerYear, w.frequency)) return 0;
    return w.amount;
  }

  function shouldApplyFee(fee, stepInYear, stepsPerYear) {
    if (!fee) return false;
    if (fee.type === "aumFlat" && (!(fee.annualRate > 0) || fee.disabled)) return false;
    if (fee.type === "aumTiered" && fee.disabled) return false;
    if (fee.type === "aumDynamic" && fee.disabled) return false;
    const timing = fee.timing === "start" ? "start" : "end";
    return timing === "start"
      ? firesStartOfSubPeriod(stepInYear, stepsPerYear, fee.frequency)
      : firesEndOfSubPeriod(stepInYear, stepsPerYear, fee.frequency);
  }

  function lookupTieredRate(balance, schedule) {
    if (!Number.isFinite(balance) || balance <= 0) return 0;
    for (const tier of schedule) {
      if (balance >= tier.min && balance < tier.max) {
        return tier.rate;
      }
    }
    return 0;
  }

  function resolveAumFeeDecimal(fee, balance) {
    if (fee.type === "aumFlat") {
      return Number(fee.annualRate) || 0;
    }
    if (fee.type === "aumTiered") {
      return lookupTieredRate(balance, fee.schedule);
    }
    if (fee.type === "aumDynamic") {
      const fn = fee.annualRateFn;
      if (typeof fn !== "function") return 0;
      const r = fn(balance);
      return Number.isFinite(r) ? r : 0;
    }
    throw new Error(`Unknown fee type: ${fee.type}`);
  }

  function resolveStepsPerYear(scenario) {
    if (Number.isFinite(scenario.simulationStepsPerYear) && scenario.simulationStepsPerYear > 0) {
      return Math.floor(scenario.simulationStepsPerYear);
    }

    const floor = Number.isFinite(scenario.minimumStepsPerYear)
      ? Math.floor(scenario.minimumStepsPerYear)
      : 12;

    const list = [floor];
    const c = scenario.contribution;
    if (c && Number.isFinite(c.amount) && c.amount > 0 && c.frequency) {
      list.push(periodsForFrequency(c.frequency));
    }
    const w = scenario.withdrawal;
    if (w && Number.isFinite(w.amount) && w.amount > 0 && w.frequency) {
      list.push(periodsForFrequency(w.frequency));
    }
    for (const fee of scenario.fees || []) {
      if (!fee) continue;
      if (fee.type === "aumTiered" && !fee.disabled) {
        list.push(periodsForFrequency(fee.frequency));
      } else if (fee.type === "aumFlat" && fee.annualRate > 0 && !fee.disabled) {
        list.push(periodsForFrequency(fee.frequency));
      } else if (fee.type === "aumDynamic" && !fee.disabled) {
        list.push(periodsForFrequency(fee.frequency));
      }
    }
    return lcmMany(list);
  }

  /**
   * @param {object} scenario
   * @param {number} scenario.initialBalance
   * @param {number} scenario.years  (rounded to integer steps via years * stepsPerYear)
   * @param {number} scenario.annualGrossReturn  decimal annual gross return (before fees)
   * @param {object} [scenario.contribution]  { amount, frequency, timing }
   * @param {object} [scenario.withdrawal]  { amount, frequency, timing }
   * @param {Array} [scenario.fees]
   * @param {string} [scenario.outputFrequency]  if set, include ledger snapshots at end of each output sub-period
   * @returns {object}
   */
  function simulatePortfolioScenario(scenario) {
    const initialBalance = Number(scenario.initialBalance);
    const years = Number(scenario.years);
    const annualGrossReturn = Number(scenario.annualGrossReturn);

    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new Error("Invalid initialBalance");
    }
    if (!Number.isFinite(years) || years < 0) {
      throw new Error("Invalid years");
    }
    if (!Number.isFinite(annualGrossReturn)) {
      throw new Error("Invalid annualGrossReturn");
    }

    const stepsPerYear = resolveStepsPerYear(scenario);
    const totalSteps = Math.max(0, Math.round(years * stepsPerYear));

    const growthFactor =
      annualGrossReturn === 0 ? 1 : Math.pow(1 + annualGrossReturn, 1 / stepsPerYear);

    let balance = initialBalance;
    let totalContributions = 0;
    let totalWithdrawals = 0;
    let totalFeesPaid = 0;

    const ledger = [];
    const outputFreq = scenario.outputFrequency;
    const wantLedger = Boolean(outputFreq);

    for (let i = 0; i < totalSteps; i++) {
      const stepInYear = i % stepsPerYear;

      // 1) Start-of-period contributions & withdrawals
      const cStart = contributionAmountAtPhase(scenario, stepInYear, stepsPerYear, "start");
      if (cStart > 0) {
        balance += cStart;
        totalContributions += cStart;
      }
      const wStart = withdrawalAmountAtPhase(scenario, stepInYear, stepsPerYear, "start");
      if (wStart > 0) {
        balance -= wStart;
        totalWithdrawals += wStart;
      }

      // 2) Growth
      balance *= growthFactor;

      // 3) End-of-period contributions & withdrawals
      const cEnd = contributionAmountAtPhase(scenario, stepInYear, stepsPerYear, "end");
      if (cEnd > 0) {
        balance += cEnd;
        totalContributions += cEnd;
      }
      const wEnd = withdrawalAmountAtPhase(scenario, stepInYear, stepsPerYear, "end");
      if (wEnd > 0) {
        balance -= wEnd;
        totalWithdrawals += wEnd;
      }

      // 4) Fees (end of fee period by default, after growth)
      for (const fee of scenario.fees || []) {
        if (!shouldApplyFee(fee, stepInYear, stepsPerYear)) continue;

        const annualRate = resolveAumFeeDecimal(fee, balance);
        const feePeriods = periodsForFrequency(fee.frequency);
        const feeAmt = balance * (annualRate / feePeriods);
        if (feeAmt > 0) {
          balance -= feeAmt;
          totalFeesPaid += feeAmt;
        }
      }

      if (wantLedger && firesEndOfSubPeriod(stepInYear, stepsPerYear, outputFreq)) {
        ledger.push({
          stepIndex: i,
          yearIndex: Math.floor(i / stepsPerYear),
          balance,
        });
      }
    }

    return {
      endingBalance: balance,
      totalContributions,
      totalWithdrawals,
      totalFeesPaid,
      stepsSimulated: totalSteps,
      stepsPerYear,
      ledger,
    };
  }

  /**
   * Binary-search annual gross return so that simulated ending balance meets targetEnding.
   * scenarioFn(rAnnual) must return a full scenario object for simulatePortfolioScenario.
   */
  function solveAnnualReturnForEndingValue({
    scenarioFn,
    targetEnding,
    lowAnnualReturn = 0,
    highAnnualReturn = 0.5,
    iterations = 60,
  }) {
    if (!Number.isFinite(targetEnding)) throw new Error("Invalid targetEnding");

    const highTest = simulatePortfolioScenario(scenarioFn(highAnnualReturn)).endingBalance;
    if (highTest < targetEnding) {
      return { annualReturn: highAnnualReturn, capped: true };
    }

    let low = lowAnnualReturn;
    let high = highAnnualReturn;

    for (let i = 0; i < iterations; i++) {
      const mid = (low + high) / 2;
      const end = simulatePortfolioScenario(scenarioFn(mid)).endingBalance;
      if (end >= targetEnding) {
        high = mid;
      } else {
        low = mid;
      }
    }

    return { annualReturn: high, capped: false };
  }

  /**
   * Binary-search extra per-period contribution amount (same frequency as base contribution)
   * so that ending with fee matches targetEnding.
   */
  function solveExtraContributionPerPeriodForEnding({
    baseScenario,
    feeScenarioBuilder,
    targetEnding,
    maxExtraPerPeriod = 1e9,
    iterations = 80,
  }) {
    const buildWithExtra = (extra) =>
      feeScenarioBuilder(baseScenario, extra);

    let lo = 0;
    let hi = Math.max(1, baseScenario.contribution?.amount || 0);

    let endHi = simulatePortfolioScenario(buildWithExtra(hi)).endingBalance;
    while (endHi < targetEnding && hi < maxExtraPerPeriod) {
      hi *= 2;
      endHi = simulatePortfolioScenario(buildWithExtra(hi)).endingBalance;
    }

    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2;
      const val = simulatePortfolioScenario(buildWithExtra(mid)).endingBalance;
      if (val >= targetEnding) hi = mid;
      else lo = mid;
    }

    return hi;
  }

  const api = {
    PERIODS_PER_YEAR,
    simulatePortfolioScenario,
    resolveStepsPerYear,
    solveAnnualReturnForEndingValue,
    solveExtraContributionPerPeriodForEnding,
    lookupTieredRate,
  };

  global.TLM_PortfolioSimulation = api;
})(typeof window !== "undefined" ? window : globalThis);
