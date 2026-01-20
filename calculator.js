(function () {
  const $ = (id) => document.getElementById(id);

  function toNumberLoose(s) {
    // Accept "1,000,000" and "$1 000 000" etc
    const cleaned = String(s).replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function fmtMoney(x) {
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function fmtPctPoints(x) {
    if (!Number.isFinite(x)) return "—";
    return (x * 100).toFixed(2) + " pp";
  }

  function monthlyRateFromAnnual(rAnnual) {
    // rAnnual as decimal (e.g. 0.07)
    // allow negative but not less than -100%
    const r = clamp(rAnnual, -0.99, 100); // very permissive upper bound
    return Math.pow(1 + r, 1 / 12) - 1;
  }

  function simulate(opts) {
    const months = Math.max(1, Math.round(opts.years * 12));
    const rm = monthlyRateFromAnnual(opts.annualReturn);
    const feeM = Math.max(0, opts.advisorFee) / 12;
    const merM = Math.max(0, opts.mer) / 12;

    let b = Math.max(0, opts.startingBalance);
    const c = Math.max(0, opts.monthlyContribution);

    let feesPaid = 0;

    for (let i = 0; i < months; i++) {
      // growth
      b = b * (1 + rm);

      // fees on assets
      const fee = b * feeM;
      const merFee = b * merM;
      const totalFee = fee + merFee;

      b = b - totalFee;
      feesPaid += totalFee;

      // contribution at end of month
      b = b + c;
    }

    return { end: b, feesPaid };
  }

  function endingNoAdvisor(opts) {
    // same MER can apply even without advisor (user can set to 0 if they want)
    return simulate({
      startingBalance: opts.startingBalance,
      monthlyContribution: opts.monthlyContribution,
      years: opts.years,
      annualReturn: opts.annualReturn,
      advisorFee: 0,
      mer: opts.mer
    });
  }

  function endingWithAdvisor(opts, extraAlphaAnnual) {
    return simulate({
      startingBalance: opts.startingBalance,
      monthlyContribution: opts.monthlyContribution,
      years: opts.years,
      annualReturn: opts.annualReturn + extraAlphaAnnual,
      advisorFee: opts.advisorFee,
      mer: opts.mer
    });
  }

  function breakevenAlpha(opts) {
    const target = endingNoAdvisor(opts).end;

    // If with advisor already beats target at alpha=0, breakeven is <= 0
    const base = endingWithAdvisor(opts, 0).end;
    if (base >= target) return 0;

    // Find hi such that f(hi) >= target (expand if needed)
    let lo = 0;
    let hi = 0.25; // 25% extra return to start
    let tries = 0;

    while (tries < 30) {
      const v = endingWithAdvisor(opts, hi).end;
      if (v >= target) break;
      hi *= 2; // expand
      tries++;
      if (hi > 10) break; // 1000% extra return is absurd but keeps us finite
    }

    const vHi = endingWithAdvisor(opts, hi).end;
    if (vHi < target) {
      // Could not reach target even with huge alpha; return NaN to show "not solvable"
      return NaN;
    }

    // Bisection
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      const v = endingWithAdvisor(opts, mid).end;
      if (v >= target) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  function readInputs() {
    const startingBalance = toNumberLoose($("startingBalance").value);
    const monthlyContribution = toNumberLoose($("monthlyContribution").value);
    const years = toNumberLoose($("years").value);

    const annualReturnPct = toNumberLoose($("annualReturnPct").value);
    const advisorFeePct = toNumberLoose($("advisorFeePct").value);
    const merPct = toNumberLoose($("merPct").value);

    return {
      startingBalance,
      monthlyContribution,
      years,
      annualReturn: (annualReturnPct / 100),
      advisorFee: (advisorFeePct / 100),
      mer: (merPct / 100),
      annualReturnPct,
      advisorFeePct,
      merPct
    };
  }

  function validate(opts) {
    const issues = [];

    if (!Number.isFinite(opts.startingBalance)) issues.push("Starting balance is not a valid number.");
    if (!Number.isFinite(opts.monthlyContribution)) issues.push("Monthly contribution is not a valid number.");
    if (!Number.isFinite(opts.years) || opts.years <= 0) issues.push("Horizon years must be > 0.");
    if (!Number.isFinite(opts.annualReturnPct)) issues.push("Expected annual return is not a valid number.");
    if (!Number.isFinite(opts.advisorFeePct) || opts.advisorFeePct < 0) issues.push("Advisor fee must be >= 0.");
    if (!Number.isFinite(opts.merPct) || opts.merPct < 0) issues.push("MER must be >= 0.");

    return issues;
  }

  function render() {
    const opts = readInputs();
    const issues = validate(opts);

    if (issues.length) {
      $("endNoAdvisor").textContent = "—";
      $("endWithAdvisor").textContent = "—";
      $("feesPaid").textContent = "—";
      $("totalCost").textContent = "—";
      $("breakevenPp").textContent = "—";
      $("sanity").textContent = issues.join(" ");
      return;
    }

    const noA = endingNoAdvisor(opts);
    const withA0 = endingWithAdvisor(opts, 0);

    const totalCost = Math.max(0, noA.end - withA0.end);
    const alpha = breakevenAlpha(opts);

    $("endNoAdvisor").textContent = fmtMoney(noA.end);
    $("endWithAdvisor").textContent = fmtMoney(withA0.end);
    $("feesPaid").textContent = fmtMoney(withA0.feesPaid);
    $("totalCost").textContent = fmtMoney(totalCost);

    if (Number.isFinite(alpha)) $("breakevenPp").textContent = fmtPctPoints(alpha);
    else $("breakevenPp").textContent = "> 1000.00 pp (not bracketed)";

    $("sanity").textContent =
      `Inputs parsed as: start=${opts.startingBalance.toFixed(2)}, contrib/mo=${opts.monthlyContribution.toFixed(2)}, years=${opts.years}, ` +
      `return=${opts.annualReturnPct}% , fee=${opts.advisorFeePct}% , MER=${opts.merPct}%.`;
  }

  function resetDefaults() {
    $("startingBalance").value = "100000";
    $("monthlyContribution").value = "5000";
    $("years").value = "25";
    $("annualReturnPct").value = "7";
    $("advisorFeePct").value = "1";
    $("merPct").value = "0";
    render();
  }

  $("recalc").addEventListener("click", render);
  $("reset").addEventListener("click", resetDefaults);

  // Live recalculation on input change
  ["startingBalance","monthlyContribution","years","annualReturnPct","advisorFeePct","merPct"]
    .forEach(id => $(id).addEventListener("input", () => render()));

  // Initial
  render();
})();
