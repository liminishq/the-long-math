(function () {

  function simulate({
    starting_balance,
    monthly_contribution,
    years,
    annual_return,
    advisor_fee_pct,
    mer_pct
  }) {
    const months = years * 12;
    const r = Math.pow(1 + annual_return, 1 / 12) - 1;

    let balance = starting_balance;
    let feesPaid = 0;

    for (let i = 0; i < months; i++) {
      balance += monthly_contribution;
      balance *= (1 + r);

      const monthlyFee = balance * (advisor_fee_pct + mer_pct) / 12;
      balance -= monthlyFee;
      feesPaid += monthlyFee;
    }

    return { balance, feesPaid };
  }

  function solveBreakEven(opts) {
    let lo = 0;
    let hi = 0.5;

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const r = simulate({ ...opts, annual_return: mid }).balance;
      if (r >= opts.target) hi = mid;
      else lo = mid;
    }

    return hi;
  }

  window.calculateLongMath = function (opts) {
    const base = simulate({ ...opts, advisor_fee_pct: 0, mer_pct: 0 });

    const withAdv = simulate(opts);

    const breakeven = solveBreakEven({
      ...opts,
      target: base.balance
    });

    return {
      ending_without: base.balance,
      ending_with: withAdv.balance,
      fees_paid: withAdv.feesPaid,
      lost_compounding: (base.balance - withAdv.balance) - withAdv.feesPaid,
      total_cost: base.balance - withAdv.balance,
      breakeven
    };
  };

})();
