/**
 * Cost of Waiting to Invest — deterministic financial math.
 *
 * Ordinary annuity, end-of-month contributions, effective annual return
 * converted to an equivalent monthly rate. No UI, no rounding of internals.
 */

const DEFAULTS = Object.freeze({
  earlyStartAge: 25,
  earlyStopAge: 35,
  laterStartAge: 35,
  laterStopAge: 65,
  retirementAge: 65,
  earlyMonthlyContribution: 400,
  laterMonthlyContribution: 400,
  monthlyContribution: 400,
  annualReturn: 0.08
});

const RATE_FLOOR = -0.9999;
const RATE_CEILING = 10;
const BREAK_EVEN_MIN = -0.5;
const BREAK_EVEN_MAX = 3;
const ZERO_RATE_EPS = 1e-12;
const ROOT_X_TOL = 1e-14;
const ROOT_Y_TOL = 1e-7;
const EQUAL_FV_TOL = 0.5;
const MIN_AGE = 1;
const MAX_AGE = 120;
const MAX_CONTRIBUTION = 1e9;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function monthsBetweenAges(startAge, endAge) {
  return (endAge - startAge) * 12;
}

/**
 * Effective annual return → equivalent effective monthly return.
 * r_m = (1 + r_a)^(1/12) − 1
 */
function monthlyRateFromEffectiveAnnual(annualReturn) {
  if (!isFiniteNumber(annualReturn) || annualReturn <= -1) {
    return NaN;
  }
  return Math.pow(1 + annualReturn, 1 / 12) - 1;
}

/**
 * Ordinary-annuity factor: ((1 + r_m)^n − 1) / r_m
 * Zero-rate case: n. Uses expm1/log1p near zero for stability.
 */
function ordinaryAnnuityFactor(monthlyRate, periods) {
  const n = periods;
  if (!isFiniteNumber(monthlyRate) || !isFiniteNumber(n) || n < 0) return NaN;
  if (n === 0) return 0;
  if (Math.abs(monthlyRate) < ZERO_RATE_EPS) return n;
  return Math.expm1(n * Math.log1p(monthlyRate)) / monthlyRate;
}

function futureValueOrdinaryAnnuity(payment, monthlyRate, periods) {
  return payment * ordinaryAnnuityFactor(monthlyRate, periods);
}

function growBalance(balance, monthlyRate, periods) {
  if (!isFiniteNumber(balance) || !isFiniteNumber(monthlyRate) || !isFiniteNumber(periods)) {
    return NaN;
  }
  if (periods === 0) return balance;
  if (Math.abs(monthlyRate) < ZERO_RATE_EPS) return balance;
  return balance * Math.exp(periods * Math.log1p(monthlyRate));
}

/**
 * Bisect a monotonic f on [low, high] after a sign change (or a near-zero endpoint).
 */
function findMonotonicRoot(f, low, high, options) {
  const opts = options || {};
  const maxIter = opts.maxIter != null ? opts.maxIter : 90;
  const xTol = opts.xTol != null ? opts.xTol : ROOT_X_TOL;
  const yTol = opts.yTol != null ? opts.yTol : ROOT_Y_TOL;

  if (!isFiniteNumber(low) || !isFiniteNumber(high) || high <= low) {
    return { found: false, reason: "invalid_bracket" };
  }

  let a = low;
  let b = high;
  let fa = f(a);
  let fb = f(b);

  if (!isFiniteNumber(fa) || !isFiniteNumber(fb)) {
    return { found: false, reason: "nonfinite" };
  }
  if (Math.abs(fa) <= yTol) return { found: true, root: a, fValue: fa };
  if (Math.abs(fb) <= yTol) return { found: true, root: b, fValue: fb };
  if (fa * fb > 0) {
    return { found: false, reason: "no_sign_change", fLow: fa, fHigh: fb };
  }

  for (let i = 0; i < maxIter; i += 1) {
    const mid = a + (b - a) / 2;
    const fm = f(mid);
    if (!isFiniteNumber(fm)) {
      return { found: false, reason: "nonfinite" };
    }
    if (Math.abs(fm) <= yTol || (b - a) / 2 <= xTol) {
      return { found: true, root: mid, fValue: fm };
    }
    if (fa * fm <= 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }

  const root = a + (b - a) / 2;
  return { found: true, root, fValue: f(root) };
}

function parseIntegerAge(value, field) {
  if (typeof value === "string" && value.trim() === "") {
    return { error: { code: "invalid_age", field } };
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: { code: "age_not_integer", field } };
  }
  if (n < MIN_AGE || n > MAX_AGE) {
    return { error: { code: "age_out_of_range", field } };
  }
  return { value: n };
}

function parseContribution(value) {
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) {
    return { error: { code: "invalid_contribution" } };
  }
  if (n <= 0) {
    return { error: { code: "contribution_not_positive" } };
  }
  if (n > MAX_CONTRIBUTION) {
    return { error: { code: "contribution_too_large" } };
  }
  return { value: n };
}

function parseAnnualReturn(value) {
  const n = typeof value === "number" ? value : Number(String(value).replace(/%/g, "").trim());
  if (!Number.isFinite(n)) {
    return { error: { code: "invalid_return" } };
  }
  if (n <= -1) {
    return { error: { code: "return_at_or_below_minus_100" } };
  }
  return { value: n };
}

function laterStopAgeRaw(raw) {
  if (!Object.prototype.hasOwnProperty.call(raw || {}, "laterStopAge")) {
    return raw && raw.retirementAge;
  }
  return raw.laterStopAge;
}

function hasOwn(raw, key) {
  return Object.prototype.hasOwnProperty.call(raw || {}, key) && raw[key] != null;
}

function resolvedEarlyMonthlyContribution(raw) {
  if (hasOwn(raw, "earlyMonthlyContribution")) return raw.earlyMonthlyContribution;
  return raw && raw.monthlyContribution;
}

function resolvedLaterMonthlyContribution(raw) {
  if (hasOwn(raw, "laterMonthlyContribution")) return raw.laterMonthlyContribution;
  return resolvedEarlyMonthlyContribution(raw);
}

function validateInputs(raw) {
  const errors = [];
  const earlyStart = parseIntegerAge(raw.earlyStartAge, "earlyStartAge");
  const earlyStop = parseIntegerAge(raw.earlyStopAge, "earlyStopAge");
  const laterStart = parseIntegerAge(raw.laterStartAge, "laterStartAge");
  const laterStop = parseIntegerAge(laterStopAgeRaw(raw), "laterStopAge");
  const retirement = parseIntegerAge(raw.retirementAge, "retirementAge");
  const earlyContribution = parseContribution(resolvedEarlyMonthlyContribution(raw));
  const laterContribution = parseContribution(resolvedLaterMonthlyContribution(raw));
  const annualReturn = parseAnnualReturn(raw.annualReturn);

  for (const parsed of [earlyStart, earlyStop, laterStart, laterStop, retirement]) {
    if (parsed.error) errors.push(parsed.error);
  }
  if (earlyContribution.error) errors.push(earlyContribution.error);
  if (laterContribution.error) errors.push(laterContribution.error);
  if (annualReturn.error) errors.push(annualReturn.error);

  if (errors.length) {
    return { ok: false, errors };
  }

  const earlyStartAge = earlyStart.value;
  const earlyStopAge = earlyStop.value;
  const laterStartAge = laterStart.value;
  const laterStopAge = laterStop.value;
  const retirementAge = retirement.value;
  const earlyMonthlyContribution = earlyContribution.value;
  const laterMonthlyContribution = laterContribution.value;

  if (!(earlyStartAge < earlyStopAge)) {
    errors.push({ code: "early_start_not_before_stop" });
  }
  if (earlyStopAge > retirementAge) {
    errors.push({ code: "early_stop_after_retirement" });
  }
  if (!(laterStartAge < laterStopAge)) {
    errors.push({ code: "later_start_not_before_stop" });
  }
  if (laterStopAge > retirementAge) {
    errors.push({ code: "later_stop_after_retirement" });
  }
  if (!(laterStartAge < retirementAge)) {
    errors.push({ code: "later_start_not_before_retirement" });
  }
  if (!(retirementAge > earlyStartAge)) {
    errors.push({ code: "retirement_not_after_early_start" });
  }
  if (!(retirementAge > laterStartAge)) {
    errors.push({ code: "retirement_not_after_later_start" });
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    inputs: {
      earlyStartAge,
      earlyStopAge,
      laterStartAge,
      laterStopAge,
      retirementAge,
      earlyMonthlyContribution,
      laterMonthlyContribution,
      monthlyContribution: earlyMonthlyContribution,
      annualReturn: annualReturn.value
    }
  };
}

function resolvedLaterStopAge(inputs) {
  return inputs.laterStopAge != null ? inputs.laterStopAge : inputs.retirementAge;
}

function periodCounts(inputs) {
  const laterStopAge = resolvedLaterStopAge(inputs);
  return {
    earlyContributeMonths: monthsBetweenAges(inputs.earlyStartAge, inputs.earlyStopAge),
    earlyCoastMonths: monthsBetweenAges(inputs.earlyStopAge, inputs.retirementAge),
    laterContributeMonths: monthsBetweenAges(inputs.laterStartAge, laterStopAge),
    laterCoastMonths: monthsBetweenAges(laterStopAge, inputs.retirementAge),
    earlyContinueMonths: monthsBetweenAges(inputs.earlyStartAge, inputs.retirementAge)
  };
}

function contributeThenCoast(startAge, stopAge, retirementAge, payment, annualReturn) {
  const rm = monthlyRateFromEffectiveAnnual(annualReturn);
  const contributeMonths = monthsBetweenAges(startAge, stopAge);
  const coastMonths = monthsBetweenAges(stopAge, retirementAge);
  const valueAtStop = futureValueOrdinaryAnnuity(payment, rm, contributeMonths);
  const valueAtRetirement = growBalance(valueAtStop, rm, coastMonths);
  const totalContributed = payment * contributeMonths;
  return {
    monthlyRate: rm,
    contributeMonths,
    coastMonths,
    valueAtStop,
    valueAtRetirement,
    totalContributed,
    investmentGrowth: valueAtRetirement - totalContributed
  };
}

function earlyInvestorAtRate(inputs, annualReturn) {
  return contributeThenCoast(
    inputs.earlyStartAge,
    inputs.earlyStopAge,
    inputs.retirementAge,
    resolvedEarlyMonthlyContribution(inputs),
    annualReturn
  );
}

function laterInvestorAtRate(inputs, annualReturn, monthlyContribution) {
  const payment =
    monthlyContribution != null ? monthlyContribution : resolvedLaterMonthlyContribution(inputs);
  return contributeThenCoast(
    inputs.laterStartAge,
    resolvedLaterStopAge(inputs),
    inputs.retirementAge,
    payment,
    annualReturn
  );
}

function continuedEarlyInvestor(inputs, annualReturn) {
  const payment = resolvedEarlyMonthlyContribution(inputs);
  const rm = monthlyRateFromEffectiveAnnual(annualReturn);
  const periods = periodCounts(inputs);
  const valueAtRetirement = futureValueOrdinaryAnnuity(
    payment,
    rm,
    periods.earlyContinueMonths
  );
  const totalContributed = payment * periods.earlyContinueMonths;
  return {
    monthlyRate: rm,
    contributeMonths: periods.earlyContinueMonths,
    valueAtRetirement,
    totalContributed,
    investmentGrowth: valueAtRetirement - totalContributed
  };
}

function requiredLaterAnnualReturn(inputs, targetValue) {
  const payment = resolvedLaterMonthlyContribution(inputs);
  const target = targetValue;

  const f = (rate) => laterInvestorAtRate(inputs, rate, payment).valueAtRetirement - target;

  const atFloor = f(RATE_FLOOR);
  const atCeiling = f(RATE_CEILING);

  if (!isFiniteNumber(atFloor) || !isFiniteNumber(atCeiling)) {
    return { found: false, reason: "nonfinite" };
  }
  if (Math.abs(atFloor) <= ROOT_Y_TOL) {
    return { found: true, annualReturn: RATE_FLOOR, unreachableAtFloor: false, unreachableAtCap: false };
  }
  if (atFloor > 0) {
    return { found: false, reason: "below_floor", unreachableAtFloor: true, annualReturn: RATE_FLOOR };
  }
  if (atCeiling < -ROOT_Y_TOL) {
    return { found: false, reason: "above_ceiling", unreachableAtCap: true, annualReturn: RATE_CEILING };
  }

  const solved = findMonotonicRoot(f, RATE_FLOOR, RATE_CEILING);
  if (!solved.found) {
    return { found: false, reason: solved.reason };
  }
  return {
    found: true,
    annualReturn: solved.root,
    unreachableAtFloor: false,
    unreachableAtCap: false
  };
}

function requiredLaterMonthlyContribution(inputs, targetValue, annualReturn) {
  const laterMonths = periodCounts(inputs).laterContributeMonths;
  if (laterMonths <= 0) {
    return { found: false, reason: "no_later_months" };
  }
  const unit = laterInvestorAtRate(inputs, annualReturn, 1);
  if (!isFiniteNumber(unit.valueAtRetirement) || unit.valueAtRetirement === 0) {
    return { found: false, reason: "zero_factor" };
  }
  return {
    found: true,
    monthlyContribution: targetValue / unit.valueAtRetirement
  };
}

function fvDifference(inputs, annualReturn) {
  const early = earlyInvestorAtRate(inputs, annualReturn);
  const later = laterInvestorAtRate(inputs, annualReturn);
  return early.valueAtRetirement - later.valueAtRetirement;
}

function balancesCollapsed(inputs, annualReturn) {
  const early = earlyInvestorAtRate(inputs, annualReturn);
  const later = laterInvestorAtRate(inputs, annualReturn);
  return (
    Math.abs(early.valueAtRetirement) <= EQUAL_FV_TOL &&
    Math.abs(later.valueAtRetirement) <= EQUAL_FV_TOL
  );
}

function scanBreakEvenBracket(inputs) {
  const samples = [];
  const count = 240;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const rate = BREAK_EVEN_MIN + t * (BREAK_EVEN_MAX - BREAK_EVEN_MIN);
    const diff = fvDifference(inputs, rate);
    samples.push({
      rate,
      diff,
      collapsed: balancesCollapsed(inputs, rate)
    });
  }

  const material = samples.filter((sample) => !sample.collapsed && isFiniteNumber(sample.diff));
  if (material.length && material.every((sample) => Math.abs(sample.diff) <= EQUAL_FV_TOL)) {
    return { kind: "always_equal", samples };
  }

  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i];
    const prev = samples[i - 1];
    if (sample.collapsed || prev.collapsed) continue;
    if (!isFiniteNumber(prev.diff) || !isFiniteNumber(sample.diff)) continue;
    if (prev.diff * sample.diff < 0) {
      return { kind: "bracket", low: prev.rate, high: sample.rate, samples };
    }
  }

  const last = samples[samples.length - 1];
  const first = samples[0];
  const direction =
    isFiniteNumber(last.diff) && last.diff > 0
      ? "early_always_ahead"
      : isFiniteNumber(first.diff) && first.diff > 0
        ? "early_always_ahead"
        : "later_always_ahead";
  return { kind: "none", direction, samples };
}

function breakEvenAnnualReturn(inputs) {
  const scan = scanBreakEvenBracket(inputs);
  if (scan.kind === "always_equal") {
    return { found: false, reason: "always_equal" };
  }
  if (scan.kind === "none") {
    return { found: false, reason: "no_root", direction: scan.direction };
  }

  const f = (rate) => fvDifference(inputs, rate);
  if (scan.low === scan.high) {
    return {
      found: true,
      annualReturn: scan.low,
      earlyAheadAbove: f(Math.min(RATE_CEILING, scan.low + 0.01)) > 0
    };
  }

  const solved = findMonotonicRoot(f, scan.low, scan.high);
  if (!solved.found) {
    return { found: false, reason: solved.reason, direction: scan.direction };
  }

  const probe = Math.min(RATE_CEILING, solved.root + 0.01);
  return {
    found: true,
    annualReturn: solved.root,
    earlyAheadAbove: f(probe) > 0
  };
}

function classifyComparison(earlyFv, laterFv, earlyContributed, laterContributed) {
  const fvGap = earlyFv - laterFv;
  const contribGap = laterContributed - earlyContributed;

  if (Math.abs(fvGap) <= EQUAL_FV_TOL) {
    return {
      kind: "approximately_equal",
      earlyAhead: false,
      laterAhead: false,
      retirementDifference: fvGap,
      contributionDifference: contribGap
    };
  }

  if (fvGap > 0) {
    let kind = "early_ahead_same_contributions";
    if (contribGap > EQUAL_FV_TOL) kind = "early_ahead_contributed_less";
    else if (contribGap < -EQUAL_FV_TOL) kind = "early_ahead_contributed_more";
    return {
      kind,
      earlyAhead: true,
      laterAhead: false,
      retirementDifference: fvGap,
      contributionDifference: contribGap
    };
  }

  let kind = "later_ahead_same_contributions";
  if (contribGap > EQUAL_FV_TOL) kind = "later_ahead_contributed_more";
  else if (contribGap < -EQUAL_FV_TOL) kind = "later_ahead_contributed_less";
  return {
    kind,
    earlyAhead: false,
    laterAhead: true,
    retirementDifference: fvGap,
    contributionDifference: contribGap
  };
}

function balanceAtAge(kind, inputs, annualReturn, age, monthlyContribution) {
  const defaultPayment =
    kind === "early"
      ? resolvedEarlyMonthlyContribution(inputs)
      : resolvedLaterMonthlyContribution(inputs);
  const payment = monthlyContribution != null ? monthlyContribution : defaultPayment;
  const rm = monthlyRateFromEffectiveAnnual(annualReturn);

  if (kind === "early") {
    if (age < inputs.earlyStartAge) return 0;
    if (age <= inputs.earlyStopAge) {
      return futureValueOrdinaryAnnuity(
        payment,
        rm,
        monthsBetweenAges(inputs.earlyStartAge, age)
      );
    }
    const atStop = futureValueOrdinaryAnnuity(
      payment,
      rm,
      monthsBetweenAges(inputs.earlyStartAge, inputs.earlyStopAge)
    );
    return growBalance(atStop, rm, monthsBetweenAges(inputs.earlyStopAge, age));
  }

  const laterStopAge = resolvedLaterStopAge(inputs);
  if (age < inputs.laterStartAge) return 0;
  if (age <= laterStopAge) {
    return futureValueOrdinaryAnnuity(
      payment,
      rm,
      monthsBetweenAges(inputs.laterStartAge, age)
    );
  }
  const atStop = futureValueOrdinaryAnnuity(
    payment,
    rm,
    monthsBetweenAges(inputs.laterStartAge, laterStopAge)
  );
  return growBalance(atStop, rm, monthsBetweenAges(laterStopAge, age));
}

function projectPortfoliosByAge(inputs, annualReturn) {
  const startAge = Math.min(inputs.earlyStartAge, inputs.laterStartAge);
  const points = [];
  for (let age = startAge; age <= inputs.retirementAge; age += 1) {
    points.push({
      age,
      early: balanceAtAge("early", inputs, annualReturn, age),
      later: balanceAtAge("later", inputs, annualReturn, age)
    });
  }
  return points;
}

function computeCostOfWaiting(raw) {
  const validated = validateInputs(raw);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }

  const inputs = validated.inputs;
  const early = earlyInvestorAtRate(inputs, inputs.annualReturn);
  const later = laterInvestorAtRate(inputs, inputs.annualReturn);
  const continued = continuedEarlyInvestor(inputs, inputs.annualReturn);
  const comparison = classifyComparison(
    early.valueAtRetirement,
    later.valueAtRetirement,
    early.totalContributed,
    later.totalContributed
  );

  const catchUpReturn = requiredLaterAnnualReturn(inputs, early.valueAtRetirement);
  const catchUpContribution = requiredLaterMonthlyContribution(
    inputs,
    early.valueAtRetirement,
    inputs.annualReturn
  );
  const breakEven = breakEvenAnnualReturn(inputs);
  const projection = projectPortfoliosByAge(inputs, inputs.annualReturn);

  let catchUpContributionIncrease = null;
  let catchUpContributionIncreasePct = null;
  let catchUpLifetimeContributions = null;
  if (catchUpContribution.found) {
    const laterPayment = resolvedLaterMonthlyContribution(inputs);
    catchUpContributionIncrease =
      catchUpContribution.monthlyContribution - laterPayment;
    catchUpContributionIncreasePct =
      laterPayment === 0 ? null : catchUpContributionIncrease / laterPayment;
    catchUpLifetimeContributions =
      catchUpContribution.monthlyContribution * later.contributeMonths;
  }

  let catchUpReturnDelta = null;
  if (catchUpReturn.found) {
    catchUpReturnDelta = catchUpReturn.annualReturn - inputs.annualReturn;
  }

  return {
    ok: true,
    errors: [],
    inputs,
    monthlyRate: early.monthlyRate,
    early: {
      valueAtStop: early.valueAtStop,
      valueAtRetirement: early.valueAtRetirement,
      totalContributed: early.totalContributed,
      investmentGrowth: early.investmentGrowth,
      contributeMonths: early.contributeMonths,
      coastMonths: early.coastMonths
    },
    later: {
      valueAtStop: later.valueAtStop,
      valueAtRetirement: later.valueAtRetirement,
      totalContributed: later.totalContributed,
      investmentGrowth: later.investmentGrowth,
      contributeMonths: later.contributeMonths,
      coastMonths: later.coastMonths
    },
    comparison,
    catchUpReturn: {
      ...catchUpReturn,
      assumedReturn: inputs.annualReturn,
      delta: catchUpReturnDelta
    },
    catchUpContribution: {
      ...catchUpContribution,
      assumedContribution: inputs.laterMonthlyContribution,
      increase: catchUpContributionIncrease,
      increasePct: catchUpContributionIncreasePct,
      lifetimeContributions: catchUpLifetimeContributions
    },
    breakEven,
    continued: {
      valueAtRetirement: continued.valueAtRetirement,
      totalContributed: continued.totalContributed,
      investmentGrowth: continued.investmentGrowth,
      contributeMonths: continued.contributeMonths,
      versusEarlyStop: continued.valueAtRetirement - early.valueAtRetirement,
      versusLater: continued.valueAtRetirement - later.valueAtRetirement
    },
    projection
  };
}

export {
  DEFAULTS,
  RATE_FLOOR,
  RATE_CEILING,
  ZERO_RATE_EPS,
  monthlyRateFromEffectiveAnnual,
  ordinaryAnnuityFactor,
  futureValueOrdinaryAnnuity,
  growBalance,
  findMonotonicRoot,
  validateInputs,
  periodCounts,
  earlyInvestorAtRate,
  laterInvestorAtRate,
  continuedEarlyInvestor,
  requiredLaterAnnualReturn,
  requiredLaterMonthlyContribution,
  breakEvenAnnualReturn,
  projectPortfoliosByAge,
  computeCostOfWaiting
};
