(function () {
  "use strict";

  const Engine = globalThis.InvestmentGrowthEngine;
  if (!Engine || typeof Engine.simulateInvestment !== "function") {
    throw new Error("InvestmentGrowthEngine failed to load");
  }

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

  function toNumber(v) {
    if (globalThis.TLM && TLM.calcInputs && typeof TLM.calcInputs.parseNumber === "function") {
      return TLM.calcInputs.parseNumber(v, 2);
    }
    const x = Number(String(v).trim().replace(/,/g, ""));
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function clampNonNeg(x) {
    return Math.max(0, x);
  }

  function fmtMoney(x) {
    if (globalThis.TLM && TLM.calcInputs && typeof TLM.calcInputs.formatMoney === "function") {
      return TLM.calcInputs.formatMoney(x, 2);
    }
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(x);
  }

  function fmtPct(x) {
    return (x * 100).toFixed(2) + "%";
  }

  // Money-weighted IRR from cash flows (per period), then annualize.
  // Cash flows: t=0 outflow = -P0; each period outflow=-PMT; final inflow=+FV
  function computeIRR(P0, PMT, N, FV, periodsPerYear) {
    if (FV <= 0) return null;
    if (P0 === 0 && PMT === 0) return null;
    if (N === 0) return 0;

    function npv(r) {
      if (r <= -0.999999999) return Number.POSITIVE_INFINITY;
      let val = -P0;
      for (let t = 1; t <= N; t++) {
        val += -PMT / Math.pow(1 + r, t);
      }
      val += FV / Math.pow(1 + r, N);
      return val;
    }

    function dnpv(r) {
      if (r <= -0.999999999) return Number.POSITIVE_INFINITY;
      let val = 0;
      for (let t = 1; t <= N; t++) {
        val += (t * PMT) / Math.pow(1 + r, t + 1);
      }
      val += (-N * FV) / Math.pow(1 + r, N + 1);
      return val;
    }

    let guess = 0.01;
    const totalInvested = P0 + PMT * N;
    if (totalInvested > 0) {
      const ratio = FV / totalInvested;
      if (ratio < 1.05) guess = 0.001;
      else if (ratio > 3) guess = 0.02;
    }

    let r = guess;
    for (let k = 0; k < 50; k++) {
      const f = npv(r);
      const fp = dnpv(r);
      if (!Number.isFinite(f) || !Number.isFinite(fp) || Math.abs(fp) < 1e-14) break;

      const step = f / fp;
      r = r - step;

      if (Math.abs(step) < 1e-10) break;
      if (r < -0.95) r = -0.95;
      if (r > 5) r = 5;
    }

    let fR = npv(r);
    if (!Number.isFinite(fR) || Math.abs(fR) > 1e-6) {
      let lo = -0.9,
        hi = 1.0;
      let fLo = npv(lo),
        fHi = npv(hi);
      let tries = 0;
      while (fLo * fHi > 0 && tries < 10) {
        hi *= 2;
        fHi = npv(hi);
        tries++;
      }
      if (fLo * fHi <= 0) {
        for (let i = 0; i < 80; i++) {
          const mid = (lo + hi) / 2;
          const fMid = npv(mid);
          if (Math.abs(fMid) < 1e-10) {
            r = mid;
            break;
          }
          if (fLo * fMid <= 0) {
            hi = mid;
            fHi = fMid;
          } else {
            lo = mid;
            fLo = fMid;
          }
          r = (lo + hi) / 2;
        }
      } else {
        return null;
      }
    }

    return Math.pow(1 + r, periodsPerYear) - 1;
  }

  function milestonesFromSchedule(schedule, P0, maxYear) {
    const milestoneYears = [0, 5, 10, 15, 20, 25, 30].filter((y) => y <= maxYear);
    const byYear = new Map(schedule.map((row) => [row.year, row]));
    const milestones = [];
    let contributed = P0;

    for (const year of milestoneYears) {
      if (year === 0) {
        milestones.push({ year: 0, balance: P0, contributed: P0 });
        continue;
      }
      const row = byYear.get(year);
      if (!row) continue;
      // Sum contributions through this year from the yearly schedule.
      contributed = P0;
      for (let y = 1; y <= year; y++) {
        const yr = byYear.get(y);
        if (yr) {
          contributed += yr.netCashFlow != null ? yr.netCashFlow : yr.contributions;
        }
      }
      milestones.push({ year, balance: row.balance, contributed });
    }
    return milestones;
  }

  function recalc() {
    const P0 = clampNonNeg(toNumber(startingAmount.value));
    const ppy = Math.max(1, Math.round(toNumber(contribFreq.value)));
    const PMT = toNumber(contribAmount.value);
    const Y = clampNonNeg(toNumber(years.value));
    const rNom = toNumber(annualReturn.value) / 100;
    const useReal = !!realToggle.checked;
    const infl = useReal ? toNumber(inflationRate.value) / 100 : 0;

    inflationWrap.classList.toggle("hidden", !useReal);
    realExplainer.classList.toggle("hidden", !useReal);

    const sim = Engine.simulateInvestment({
      startingAmount: P0,
      contributionPerPeriod: PMT,
      years: Y,
      nominalAnnualReturn: rNom,
      inflationAnnual: infl,
      contributionPeriodsPerYear: ppy,
      contributionAtBeginning: false,
      indexContributionsToInflation: false,
    });

    if (sim.error) {
      finalBalanceEl.textContent = sim.error;
      totalInvestedEl.textContent = "—";
      interestEarnedEl.textContent = "—";
      irrEl.textContent = "—";
      milestonesBody.innerHTML = "";
      return;
    }

    const fv = useReal ? sim.finalBalanceReal : sim.finalBalanceNominal;
    const N = sim.periods;
    const invested = useReal
      ? P0 + sim.totalContributions
      : P0 + (sim.totalContributionsNominal != null ? sim.totalContributionsNominal : PMT * N);
    const interest = fv - invested;
    const irr = computeIRR(P0, PMT, N, sim.finalBalanceNominal, ppy);

    const finalLabel = el("finalBalanceLabel");
    const investedLabel = el("totalInvestedLabel");
    const growthLabel = el("interestEarnedLabel");
    const contributedHead = el("milestonesContributedHead");
    const balanceHead = el("milestonesBalanceHead");
    if (finalLabel) {
      finalLabel.textContent = useReal ? "Final balance (today's dollars)" : "Final balance";
    }
    if (investedLabel) {
      investedLabel.textContent = useReal
        ? "Total capital invested (today's dollars)"
        : "Total capital invested";
    }
    if (growthLabel) {
      growthLabel.textContent = useReal ? "Growth from returns (today's dollars)" : "Growth from returns";
    }
    if (contributedHead) {
      contributedHead.textContent = useReal ? "Total contributed (today's $)" : "Total contributed";
    }
    if (balanceHead) {
      balanceHead.textContent = useReal ? "Balance (today's $)" : "Balance";
    }

    finalBalanceEl.textContent = fmtMoney(fv);
    totalInvestedEl.textContent = fmtMoney(invested);
    interestEarnedEl.textContent = fmtMoney(interest);
    irrEl.textContent = irr === null ? "—" : fmtPct(irr);

    const milestones = milestonesFromSchedule(sim.schedule, P0, Math.floor(sim.years));
    milestonesBody.innerHTML = "";
    for (const m of milestones) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${m.year}</td>
        <td>${fmtMoney(m.contributed)}</td>
        <td>${fmtMoney(m.balance)}</td>
      `;
      milestonesBody.appendChild(row);
    }
  }

  [startingAmount, contribFreq, contribAmount, years, annualReturn, realToggle, inflationRate].forEach((node) =>
    node.addEventListener("input", recalc)
  );

  recalc();
})();
