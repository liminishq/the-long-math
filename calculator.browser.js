// calculator.browser.js
// Pure math layer. Exposes window.calculateLongMath(opts).
// Opts fields:
// - starting_balance (number)
// - monthly_contribution (number)
// - horizon_years (number)
// - annual_return (decimal, e.g. 0.07 for 7%)
// - use_default_fee (boolean)
// - custom_advisor_fee_pct (percent number, e.g. 1.0 for 1%)
// - include_mer (boolean)
// - mer_pct (percent number, e.g. 2.0 for 2%)

(function () {
  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function effectiveTieredAdvisorFeePct(aum) {
    // Marginal tiers (like tax brackets). Returns blended % for this AUM level.
    const tiers = [
      { upTo: 250000, pct: 2.00 },
      { upTo: 500000, pct: 1.75 },
      { upTo: 1000000, pct: 1.50 },
      { upTo: 2000000, pct: 1.25 },
      { upTo: Infinity, pct: 1.00 },
    ];

    const A = Math.max(0, aum);
    if (A === 0) return 0;

    let remaining = A;
    let lastCap = 0;
    let feeDollarsPerYear = 0;

    for (const t of tiers) {
      const cap = t.upTo;
      const bandSize = (cap === Infinity)
        ? remaining
        : Math.max(0, Math.min(remaining, cap - lastCap));

      if (bandSize <= 0) {
        lastCap = cap;
        continue;
      }

      feeDollarsPerYear += bandSize * (t.pct / 100);
      remaining -= bandSize;
      lastCap = cap;
      if (remaining <= 0) break;
    }

    return (feeDollarsPerYear / A) * 100;
  }

  function simulatePath(params) {
    const {
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return_dec,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
      include_advisor_costs,
    } = params;

    const months = Math.round(horizon_years * 12);
    // Allow any non-negative return. If negative, still permit down to -95% for math stability.
    const ar = clamp(annual_return_dec, -0.95, 5.0);
    const r_m = Math.pow(1 + ar, 1 / 12) - 1;

    let bal = Math.max(0, starting_balance);

    let feesPaidAdvisor = 0;
    let feesPaidMer = 0;

    for (let m = 0; m < months; m++) {
      bal += Math.max(0, monthly_contribution);
      bal *= (1 + r_m);

      if (include_advisor_costs) {
        let advisorPct = 0;
        if (use_default_fee) {
          advisorPct = effectiveTieredAdvisorFeePct(bal);
        } else {
          advisorPct = clamp(custom_advisor_fee_pct, 0, 15);
        }

        const merPctUse = include_mer ? clamp(mer_pct, 0, 15) : 0;

        const advisorFeeThisMonth = bal * (advisorPct / 100) / 12;
        const merFeeThisMonth = bal * (merPctUse / 100) / 12;

        const totalFee = advisorFeeThisMonth + merFeeThisMonth;
        bal = Math.max(0, bal - totalFee);

        feesPaidAdvisor += advisorFeeThisMonth;
        feesPaidMer += merFeeThisMonth;
      }
    }

    return {
      ending_value: bal,
      fees_paid_advisor: feesPaidAdvisor,
      fees_paid_mer: feesPaidMer,
      fees_paid_total: feesPaidAdvisor + feesPaidMer,
    };
  }

  function solveBreakEvenAnnualReturn(opts) {
    const {
      target_ending_value_without_advisor,
      starting_balance,
      monthly_contribution,
      horizon_years,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
    } = opts;

    // Search bounds. Start wide enough that we do not artificially cap at 50%.
    let lo = -0.50;
    let hi = 1.00; // 100% annual return cap for the solver; if still not enough, report capped.

    const tryHi = simulatePath({
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return_dec: hi,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
      include_advisor_costs: true,
    }).ending_value;

    if (tryHi < target_ending_value_without_advisor) {
      return { annual_return_dec: hi, capped: true };
    }

    const tryLo = simulatePath({
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return_dec: lo,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
      include_advisor_costs: true,
    }).ending_value;

    if (tryLo > target_ending_value_without_advisor) {
      return { annual_return_dec: lo, capped: true };
    }

    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      const endMid = simulatePath({
        starting_balance,
        monthly_contribution,
        horizon_years,
        annual_return_dec: mid,
        use_default_fee,
        custom_advisor_fee_pct,
        include_mer,
        mer_pct,
        include_advisor_costs: true,
      }).ending_value;

      if (endMid >= target_ending_value_without_advisor) hi = mid;
      else lo = mid;
    }

    return { annual_return_dec: hi, capped: false };
  }

  function calculateLongMath(opts) {
    const starting_balance = Number(opts.starting_balance);
    const monthly_contribution = Number(opts.monthly_contribution);
    const horizon_years = Number(opts.horizon_years);
    const annual_return_dec = Number(opts.annual_return);

    const use_default_fee = Boolean(opts.use_default_fee);
    const custom_advisor_fee_pct = Number(opts.custom_advisor_fee_pct);
    const include_mer = Boolean(opts.include_mer);
    const mer_pct = Number(opts.mer_pct);

    if (!Number.isFinite(starting_balance) || starting_balance < 0) throw new Error("Invalid starting balance.");
    if (!Number.isFinite(monthly_contribution) || monthly_contribution < 0) throw new Error("Invalid monthly contribution.");
    if (!Number.isFinite(horizon_years) || horizon_years < 1) throw new Error("Invalid horizon years.");
    if (!Number.isFinite(annual_return_dec)) throw new Error("Invalid annual return.");

    // WITHOUT advisor: no advisor fee and no MER (matches your framing)
    const without = simulatePath({
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return_dec,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer: false,
      mer_pct: 0,
      include_advisor_costs: false,
    });

    // WITH advisor: advisor + optional MER
    const withAdv = simulatePath({
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return_dec,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
      include_advisor_costs: true,
    });

    const ending_with_advisor = withAdv.ending_value;
    const ending_without_advisor = without.ending_value;

    const fees_paid = withAdv.fees_paid_total;
    const total_gap = ending_without_advisor - ending_with_advisor;
    const total_cost = Math.max(0, total_gap);
    const lost_compounding = Math.max(0, total_cost - fees_paid);

    const be = solveBreakEvenAnnualReturn({
      target_ending_value_without_advisor: ending_without_advisor,
      starting_balance,
      monthly_contribution,
      horizon_years,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
    });

    return {
      ending_with_advisor,
      ending_without_advisor,
      total_fees_paid: fees_paid,
      lost_compounding,
      total_cost,
      break_even_annual_return_dec: be.annual_return_dec,
      break_even_capped: be.capped,
    };
  }

  window.calculateLongMath = calculateLongMath;
})();
