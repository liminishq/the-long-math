/**
 * Required return to offset fees — UI glue using TLM_PortfolioSimulation.
 * Monthly simulation; annual contribution input is split into 12 equal monthly amounts.
 */
(function () {
  "use strict";

  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function cleanNum(v) {
    const s = String(v ?? "").trim().replace(/,/g, "");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmtCAD(n) {
    if (!Number.isFinite(n)) return "$–";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function fmtPct(n) {
    if (!Number.isFinite(n)) return "–%";
    return n.toLocaleString("en-CA", { maximumFractionDigits: 2 }) + "%";
  }

  function baseScenario({ start, years, gross, feeDec, monthlyContrib }) {
    const fees = [];
    if (feeDec > 0) {
      fees.push({
        type: "aumFlat",
        annualRate: feeDec,
        frequency: "monthly",
        timing: "end",
      });
    }
    return {
      initialBalance: start,
      years,
      annualGrossReturn: gross,
      contribution:
        monthlyContrib > 0
          ? { amount: monthlyContrib, frequency: "monthly", timing: "start" }
          : undefined,
      fees,
    };
  }

  function calculate() {
    const PS = window.TLM_PortfolioSimulation;
    if (!PS) return;

    const els = {
      starting: $("starting_balance"),
      contrib: $("annual_contribution"),
      years: $("horizon_years"),
      gross: $("annual_return"),
      fee: $("fee_pct"),
      outReq: $("out_required_excess"),
      outReqGross: $("out_required_gross"),
      outEnd0: $("out_end_no_fee"),
      outEndF: $("out_end_with_fee"),
      outLost: $("out_lost_to_fees"),
      outExtra: $("out_extra_contrib"),
      outMeta: $("out_meta"),
      calloutFee: $("calloutFee"),
      calloutHorizon: $("calloutHorizon"),
      calloutAlpha: $("calloutAlpha"),
      calloutContribution: $("calloutContribution"),
    };

    const start = cleanNum(els.starting.value);
    const annualContrib = cleanNum(els.contrib.value);
    const yearsRaw = cleanNum(els.years.value);
    const years = Number.isFinite(yearsRaw) ? Math.max(0, Math.floor(yearsRaw)) : NaN;
    const grossPct = cleanNum(els.gross.value);
    const feePct = cleanNum(els.fee.value);

    if (![start, annualContrib, years, grossPct, feePct].every(Number.isFinite)) {
      els.outReq.textContent = "–%";
      els.outReqGross.textContent = "–%";
      els.outEnd0.textContent = "$–";
      els.outEndF.textContent = "$–";
      els.outLost.textContent = "$–";
      els.outExtra.textContent = "$–";
      els.outMeta.textContent = "Calculated using the assumptions shown above.";
      updateCallout(els, NaN, NaN, NaN, NaN);
      return;
    }

    const gross = grossPct / 100;
    const fee = feePct / 100;
    const monthlyContrib = annualContrib / 12;

    if (fee <= 0) {
      const noFee = baseScenario({
        start,
        years,
        gross,
        feeDec: 0,
        monthlyContrib,
      });
      const end0 = PS.simulatePortfolioScenario(noFee).endingBalance;
      els.outReq.textContent = fmtPct(0);
      els.outReqGross.textContent = fmtPct(grossPct);
      els.outEnd0.textContent = fmtCAD(end0);
      els.outEndF.textContent = fmtCAD(end0);
      els.outLost.textContent = fmtCAD(0);
      els.outExtra.textContent = fmtCAD(0);
      els.outMeta.textContent =
        "Calculated using the shared standardized-period fee simulation (monthly steps; annual contribution split into 12 equal monthly amounts).";
      updateCallout(els, feePct, years, 0, 0);
      return;
    }

    const noFee = baseScenario({
      start,
      years,
      gross,
      feeDec: 0,
      monthlyContrib,
    });
    const withFee = baseScenario({
      start,
      years,
      gross,
      feeDec: fee,
      monthlyContrib,
    });

    const end0 = PS.simulatePortfolioScenario(noFee).endingBalance;
    const endF = PS.simulatePortfolioScenario(withFee).endingBalance;
    const lost = end0 - endF;

    const targetEnding = end0;
    const solved = PS.solveAnnualReturnForEndingValue({
      scenarioFn: (rAnnual) =>
        baseScenario({
          start,
          years,
          gross: rAnnual,
          feeDec: fee,
          monthlyContrib,
        }),
      targetEnding,
      lowAnnualReturn: 0,
      highAnnualReturn: 1.0,
    });

    const requiredGross = solved.annualReturn;
    const requiredExcessPct = (requiredGross - gross) * 100;

    const extraPerMonth = PS.solveExtraContributionPerPeriodForEnding({
      baseScenario: withFee,
      feeScenarioBuilder: (base, extra) => {
        if (!base.contribution) {
          return {
            ...base,
            contribution: {
              amount: extra,
              frequency: "monthly",
              timing: "start",
            },
          };
        }
        return {
          ...base,
          contribution: {
            ...base.contribution,
            amount: base.contribution.amount + extra,
          },
        };
      },
      targetEnding,
    });

    const extraAnnual = extraPerMonth * 12;

    els.outReq.textContent = fmtPct(requiredExcessPct);
    els.outReqGross.textContent = fmtPct(requiredGross * 100);
    els.outEnd0.textContent = fmtCAD(end0);
    els.outEndF.textContent = fmtCAD(endF);
    els.outLost.textContent = fmtCAD(lost);
    els.outExtra.textContent = fmtCAD(extraAnnual);
    els.outMeta.textContent =
      "Calculated using the shared standardized-period fee simulation (monthly steps; annual contribution split into 12 equal monthly amounts).";

    updateCallout(els, feePct, years, requiredExcessPct, extraAnnual);
  }

  function updateCallout(els, feePct, years, alphaPct, extraContrib) {
    if (Number.isFinite(feePct)) {
      els.calloutFee.textContent = feePct.toLocaleString("en-CA", { maximumFractionDigits: 2 }) + "%";
    } else {
      els.calloutFee.textContent = "–%";
    }

    if (Number.isFinite(years) && years > 0) {
      els.calloutHorizon.textContent = Math.floor(years).toString();
    } else {
      els.calloutHorizon.textContent = "–";
    }

    if (Number.isFinite(alphaPct)) {
      const sign = alphaPct >= 0 ? "+" : "";
      els.calloutAlpha.textContent =
        sign + alphaPct.toLocaleString("en-CA", { maximumFractionDigits: 2 }) + "%";
    } else {
      els.calloutAlpha.textContent = "+–%";
    }

    els.calloutContribution.textContent = els.outExtra.textContent;
  }

  function initDefaults() {
    $("starting_balance").value = "0";
    $("horizon_years").value = "30";
    $("annual_return").value = "6";
    $("fee_pct").value = "1.0";
    $("annual_contribution").value = "50000";
    calculate();
  }

  ["starting_balance", "annual_contribution", "horizon_years", "annual_return", "fee_pct"].forEach((id) => {
    $(id).addEventListener("input", calculate);
  });

  initDefaults();
})();
