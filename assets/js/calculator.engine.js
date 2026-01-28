/* ============================================================
   The Long Math — Calculator Engine (Deterministic Core)
   ============================================================

   PURPOSE
   -------
   Quantify the long-horizon arithmetic cost of %AUM advisor fees,
   including both:
     • Direct fees paid
     • Lost compounding from those fees

   This engine:
     • Is fully deterministic
     • Uses monthly compounding
     • Applies contributions at START of month
     • Applies fees monthly, based on current AUM
     • Contains NO UI logic
     • Contains NO styling logic

   This file is the single source of mathematical truth.
*/

/* ============================================================
   DEFAULT ADVISOR FEE SCHEDULE (NON-BLENDED)
   Single tier applies to entire balance at that AUM level
   ============================================================ */

const DEFAULT_ADVISOR_FEE_SCHEDULE = [
  { min: 0,        max: 250000,   rate: 0.0200 },
  { min: 250000,   max: 500000,   rate: 0.0175 },
  { min: 500000,   max: 1000000,  rate: 0.0150 },
  { min: 1000000,  max: 2000000,  rate: 0.0125 },
  { min: 2000000,  max: Infinity, rate: 0.0100 }
];

/* ============================================================
   Helper: lookup advisor fee rate for a given balance
   ============================================================ */

function lookupAdvisorFeeRate(balance, schedule = DEFAULT_ADVISOR_FEE_SCHEDULE) {
  if (!Number.isFinite(balance) || balance <= 0) return 0;

  for (const tier of schedule) {
    if (balance >= tier.min && balance < tier.max) {
      return tier.rate;
    }
  }
  return 0;
}

/* ============================================================
   Core simulation (single path)
   ============================================================ */

function simulatePortfolio({
  starting_balance,
  monthly_contribution,
  horizon_years,
  annual_return,
  advisor_fee_rate_fn,   // function(balance) → annual %
  mer_rate               // decimal (e.g. 0.02) or 0
}) {
  const months = Math.round(horizon_years * 12);
  const growth_factor =
    annual_return === 0
      ? 1
      : Math.pow(1 + annual_return, 1 / 12);

  let balance = starting_balance;
  let total_fees_paid = 0;

  for (let m = 1; m <= months; m++) {
    // 1) Contribution at START of month
    balance += monthly_contribution;

    // 2) Growth
    balance *= growth_factor;

    // 3) Fees (applied to current AUM)
    const advisor_rate = advisor_fee_rate_fn(balance);
    const monthly_fee =
      balance * ((advisor_rate + mer_rate) / 12);

    if (monthly_fee > 0) {
      balance -= monthly_fee;
      total_fees_paid += monthly_fee;
    }
  }

  return {
    ending_value: balance,
    total_fees_paid
  };
}

/* ============================================================
   Break-even return solver
   ============================================================ */

function solveBreakEvenReturn({
  target_ending_value,
  starting_balance,
  monthly_contribution,
  horizon_years,
  advisor_fee_rate_fn,
  mer_rate
}) {
  let low = 0.0;
  let high = 0.50; // 50% cap is informational, not normative

  // If even 50% cannot catch up, return cap
  const high_test = simulatePortfolio({
    starting_balance,
    monthly_contribution,
    horizon_years,
    annual_return: high,
    advisor_fee_rate_fn,
    mer_rate
  }).ending_value;

  if (high_test < target_ending_value) {
    return { return_required: high, capped: true };
  }

  // Binary search
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;

    const result = simulatePortfolio({
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return: mid,
      advisor_fee_rate_fn,
      mer_rate
    }).ending_value;

    if (result >= target_ending_value) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return { return_required: high, capped: false };
}

/* ============================================================
   PUBLIC API
   ============================================================ */

function calculateLongMath(inputs) {
  const {
    starting_balance,
    monthly_contribution,
    horizon_years,
    annual_return,

    use_default_fee,
    custom_advisor_fee_pct,

    include_mer,
    mer_pct
  } = inputs;

  // ---------- Validation ----------
  if (!Number.isFinite(starting_balance) || starting_balance < 0)
    throw new Error("Invalid starting balance");

  if (!Number.isFinite(monthly_contribution) || monthly_contribution < 0)
    throw new Error("Invalid monthly contribution");

  if (!Number.isFinite(horizon_years) || horizon_years < 1)
    throw new Error("Invalid horizon");

  if (!Number.isFinite(annual_return))
    throw new Error("Invalid annual return");

  // ---------- Fee model ----------
  const advisor_fee_fn = use_default_fee
    ? (bal) => lookupAdvisorFeeRate(bal)
    : () => (Number(custom_advisor_fee_pct) || 0) / 100;

  const mer_rate = include_mer
    ? (Number(mer_pct) || 0) / 100
    : 0;

  // ---------- Without advisor ----------
  const no_advisor = simulatePortfolio({
    starting_balance,
    monthly_contribution,
    horizon_years,
    annual_return,
    advisor_fee_rate_fn: () => 0,
    mer_rate: 0
  });

  // ---------- With advisor ----------
  const with_advisor = simulatePortfolio({
    starting_balance,
    monthly_contribution,
    horizon_years,
    annual_return,
    advisor_fee_rate_fn: advisor_fee_fn,
    mer_rate
  });

  const total_gap =
    no_advisor.ending_value - with_advisor.ending_value;

  const lost_compounding =
    total_gap - with_advisor.total_fees_paid;

  // ---------- Break-even ----------
  const breakeven = solveBreakEvenReturn({
    target_ending_value: no_advisor.ending_value,
    starting_balance,
    monthly_contribution,
    horizon_years,
    advisor_fee_rate_fn: advisor_fee_fn,
    mer_rate
  });

  return {
    ending_with_advisor: with_advisor.ending_value,
    ending_without_advisor: no_advisor.ending_value,

    fees_paid: with_advisor.total_fees_paid,
    lost_compounding: lost_compounding,
    total_calculated_cost: total_gap,

    break_even_return: breakeven.return_required,
    break_even_capped: breakeven.capped
  };
}

/* ============================================================
   Export (browser global)
   ============================================================ */

window.calculateLongMath = calculateLongMath;
