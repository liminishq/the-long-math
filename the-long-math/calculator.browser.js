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
    // Marginal tiers (like tax brackets). Returns the blended % for THIS aum level.
    // Display table matches:
    // 0–250k: 2.00%
    // 250–500k: 1.75%
    // 500k–1M: 1.50%
    // 1M–2M: 1.25%
    // >2M: 1.00%
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
      const bandSize = (cap === Infinity) ? remaining : Math.max(0, Math.min(remaining, cap - lastCap));
      if (bandSize <= 0) {
        lastCap = cap;
        continue;
      }
      feeDollarsPerYear += bandSize * (t.pct / 100);
      remaining -= bandSize;
      lastCap = cap;
      if (remaining <= 0) break;
    }

    const blendedPct = (feeDollarsPerYear / A) * 100;
    return blendedPct;
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
      include_advisor_costs, // boolean: apply advisor/mer or not
    } = params;

    const months = Math.round(horizon_years * 12);
    const r_m = Math.pow(1 + annual_return_dec, 1 / 12) - 1;

    let bal = starting_balance;

    let feesPaidAdvisor = 0;
    let feesPaidMer = 0;

    for (let m = 0; m < months; m++) {
      // Contribute at start of month (simple, consistent)
      bal += monthly_contribution;

      // Grow for the month
      bal *= (1 + r_m);

      if (include_advisor_costs) {
        // Determine annual fee % for this month based on current AUM (after growth)
        let advisorPct = 0;
        if (use_default_fee) {
          advisorPct = effectiveTieredAdvisorFeePct(bal);
        } else {
          advisorPct = clamp(custom_advisor_fee_pct, 0, 10); // safety clamp
        }

        const merPctUse = include_mer ? clamp(mer_pct, 0, 10) : 0;

        const advisorFeeThisMonth = bal * (advisorPct / 100) / 12;
        const merFeeThisMonth = bal * (merPctUse / 100) / 12;

        bal -= (advisorFeeThisMonth + merFeeThisMonth);

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

  // Solve for annual return needed WITH advisor costs to match target ending value.
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

    // Search bounds: -50% to +50% annual return.
    let lo = -0.50;
    let hi = 0.50;

    // If even 50% isn't enough, we’ll return 50%+ as a cap indicator.
    const maxTry = simulatePath({
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

    if (maxTry < target_ending_value_without_advisor) {
      return { annual_return_dec: hi, capped: true };
    }

    // If -50% is already above target (unlikely), clamp low.
    const minTry = simulatePath({
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

    if (minTry > target_ending_value_without_advisor) {
      return { annual_return_dec: lo, capped: true };
    }

    // Binary search
    for (let i = 0; i < 60; i++) {
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

      if (endMid >= target_ending_value_without_advisor) {
        hi = mid;
      } else {
        lo = mid;
      }
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

    // WITHOUT advisor (no advisor fee and no MER)
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

    // WITH advisor (advisor + optional MER)
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
    const lost_compounding = total_gap - fees_paid;

    // Break-even advisor performance: annual return needed (with costs) to match ending_without_advisor
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
      total_cost: fees_paid + lost_compounding, // equals ending_without - ending_with
      break_even_annual_return_dec: be.annual_return_dec,
      break_even_capped: be.capped,
    };
  }

  window.calculateLongMath = calculateLongMath;
})();
