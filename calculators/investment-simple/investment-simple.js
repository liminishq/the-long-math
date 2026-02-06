(function(){
  const el = (id) => document.getElementById(id);

  const startingAmount = el("startingAmount");
  const contribFreq = el("contribFreq");
  const contribAmount = el("contribAmount");
  const years = el("years");
  const annualReturn = el("annualReturn");
  const realToggle = el("realToggle");
  const inflationWrap = el("inflationWrap");
  const inflationRate = el("inflationRate");

  const finalBalanceEl = el("finalBalance");
  const totalInvestedEl = el("totalInvested");
  const interestEarnedEl = el("interestEarned");
  const irrEl = el("irr");
  const milestonesBody = el("milestonesBody");
  const realExplainer = el("realExplainer");

  function toNumber(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }

  function clampNonNeg(x){ return Math.max(0, x); }

  function fmtMoney(x){
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "CAD", // Using CAD to match site defaults
      maximumFractionDigits: 0
    }).format(x);
  }

  function fmtPct(x){
    return (x * 100).toFixed(2) + "%";
  }

  // Convert nominal annual return to "real" annual return if toggle is on
  function effectiveAnnualReturn(){
    const rNom = toNumber(annualReturn.value) / 100;
    if(!realToggle.checked) return rNom;

    const infl = clampNonNeg(toNumber(inflationRate.value) / 100);
    return (1 + rNom) / (1 + infl) - 1;
  }

  // Future value with contributions at end of each period:
  // FV = P0*(1+i)^N + PMT * [((1+i)^N - 1)/i]
  function computeFutureValue(P0, PMT, periodsPerYear, years, rAnnual){
    const N = Math.round(periodsPerYear * years);
    if(N <= 0){
      return { fv: P0, N: 0, i: 0 };
    }
    const i = Math.pow(1 + rAnnual, 1 / periodsPerYear) - 1; // effective rate per period

    // Handle r=0
    if(Math.abs(i) < 1e-12){
      return { fv: P0 + PMT * N, N, i };
    }
    const growth = Math.pow(1 + i, N);
    const fv = P0 * growth + PMT * ((growth - 1) / i);
    return { fv, N, i };
  }

  // Compute milestone values at year-end snapshots
  function computeMilestones(P0, PMT, periodsPerYear, years, rAnnual){
    const milestones = [];
    const maxYear = Math.floor(years);
    const milestoneYears = [0, 5, 10, 15, 20, 25, 30].filter(y => y <= maxYear);
    
    if(milestoneYears.length === 0) return milestones;

    const i = Math.pow(1 + rAnnual, 1 / periodsPerYear) - 1; // effective rate per period
    const isZeroRate = Math.abs(i) < 1e-12;

    for(const year of milestoneYears){
      const periodsElapsed = Math.round(periodsPerYear * year);
      let balance, contributed;

      if(year === 0){
        balance = P0;
        contributed = P0;
      } else if(isZeroRate){
        balance = P0 + PMT * periodsElapsed;
        contributed = P0 + PMT * periodsElapsed;
      } else {
        const growth = Math.pow(1 + i, periodsElapsed);
        balance = P0 * growth + PMT * ((growth - 1) / i);
        contributed = P0 + PMT * periodsElapsed;
      }

      milestones.push({ year, balance, contributed });
    }

    return milestones;
  }

  // Money-weighted IRR from cash flows (per period), then annualize.
  // Cash flows: t=0 outflow = -P0; each period outflow=-PMT; final inflow=+FV
  function computeIRR(P0, PMT, N, FV, periodsPerYear){
    // Edge cases
    if(FV <= 0) return null;
    if(P0 === 0 && PMT === 0) return null;
    if(N === 0){
      // Single cashflow: IRR undefined; treat as 0
      return 0;
    }

    // NPV(r) for per-period rate r
    function npv(r){
      // Avoid division by zero / invalid
      if(r <= -0.999999999) return Number.POSITIVE_INFINITY;
      let val = -P0; // t=0
      // contributions at end of each period => discounted by (1+r)^t
      for(let t = 1; t <= N; t++){
        val += (-PMT) / Math.pow(1 + r, t);
      }
      val += FV / Math.pow(1 + r, N);
      return val;
    }

    // Derivative for Newton method
    function dnpv(r){
      if(r <= -0.999999999) return Number.POSITIVE_INFINITY;
      let val = 0;
      for(let t = 1; t <= N; t++){
        val += (t * PMT) / Math.pow(1 + r, t + 1);
      }
      val += (-N * FV) / Math.pow(1 + r, N + 1);
      return val;
    }

    // Initial guess: use a conservative guess near expected per-period return
    let guess = 0.01; // 1% per period baseline
    // If FV is only slightly above total invested, guess smaller
    const totalInvested = P0 + PMT * N;
    if(totalInvested > 0){
      const ratio = FV / totalInvested;
      if(ratio < 1.05) guess = 0.001;
      else if(ratio > 3) guess = 0.02;
    }

    // Newton iterations
    let r = guess;
    for(let k = 0; k < 50; k++){
      const f = npv(r);
      const fp = dnpv(r);
      if(!Number.isFinite(f) || !Number.isFinite(fp) || Math.abs(fp) < 1e-14) break;

      const step = f / fp;
      r = r - step;

      if(Math.abs(step) < 1e-10) break;
      // Keep r in a sane range
      if(r < -0.95) r = -0.95;
      if(r > 5) r = 5;
    }

    // If Newton fails badly, fall back to bisection on a bracket
    let fR = npv(r);
    if(!Number.isFinite(fR) || Math.abs(fR) > 1e-6){
      let lo = -0.90, hi = 1.00; // -90% to +100% per period
      let fLo = npv(lo), fHi = npv(hi);
      // Expand hi if needed
      let tries = 0;
      while(fLo * fHi > 0 && tries < 10){
        hi *= 2;
        fHi = npv(hi);
        tries++;
      }
      if(fLo * fHi <= 0){
        for(let i = 0; i < 80; i++){
          const mid = (lo + hi) / 2;
          const fMid = npv(mid);
          if(Math.abs(fMid) < 1e-10) { r = mid; break; }
          if(fLo * fMid <= 0){
            hi = mid; fHi = fMid;
          } else {
            lo = mid; fLo = fMid;
          }
          r = (lo + hi) / 2;
        }
      } else {
        return null; // couldn't bracket
      }
    }

    // Annualize per-period IRR
    const irrAnnual = Math.pow(1 + r, periodsPerYear) - 1;
    return irrAnnual;
  }

  function recalc(){
    const P0 = clampNonNeg(toNumber(startingAmount.value));
    const ppy = Math.max(1, Math.round(toNumber(contribFreq.value)));
    const PMT = clampNonNeg(toNumber(contribAmount.value));
    const Y = clampNonNeg(toNumber(years.value));
    const rAnnual = effectiveAnnualReturn();

    inflationWrap.classList.toggle("hidden", !realToggle.checked);
    realExplainer.classList.toggle("hidden", !realToggle.checked);

    const { fv, N } = computeFutureValue(P0, PMT, ppy, Y, rAnnual);

    const invested = P0 + PMT * N;
    const interest = fv - invested;

    // IRR based on cashflows (periodic), annualized
    const irr = computeIRR(P0, PMT, N, fv, ppy);

    finalBalanceEl.textContent = fmtMoney(fv);
    totalInvestedEl.textContent = fmtMoney(invested);
    interestEarnedEl.textContent = fmtMoney(interest);

    irrEl.textContent = (irr === null) ? "—" : fmtPct(irr);

    // Update milestones table
    const milestones = computeMilestones(P0, PMT, ppy, Y, rAnnual);
    milestonesBody.innerHTML = "";
    for(const m of milestones){
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${m.year}</td>
        <td>${fmtMoney(m.contributed)}</td>
        <td>${fmtMoney(m.balance)}</td>
      `;
      milestonesBody.appendChild(row);
    }
  }

  // Events
  [
    startingAmount, contribFreq, contribAmount, years, annualReturn, realToggle, inflationRate
  ].forEach((node) => node.addEventListener("input", recalc));

  recalc();
})();
