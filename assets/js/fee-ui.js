// fee-ui.js
// UI glue for fee calculators. Uses TLM_PortfolioSimulation (shared engine).

(function () {
  "use strict";

  function $(id) {
    const el = document.getElementById(id);
    if (!el) {
      console.error("Missing element #" + id);
      return null;
    }
    return el;
  }

  function numFromInput(id) {
    const el = $(id);
    if (!el) return NaN;
    const raw = el.value.trim().replace(/,/g, "");
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  function pctToDec(pct) {
    return pct / 100;
  }

  function fmtMoney(n) {
    if (!Number.isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function fmtPctDec(nDec, digits) {
    if (!Number.isFinite(nDec)) return "—";
    return (nDec * 100).toFixed(digits) + "%";
  }

  function signedMoney(n) {
    if (!Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + fmtMoney(Math.abs(n));
  }

  function setText(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

  /**
   * Standardized-period scenario: annual contribution field is split into
   * 12 equal monthly amounts, start of month; AUM fee monthly, end of month.
   */
  function makeFeeScenario({ principal, years, grossDec, feeAnnualDec, annualContrib }) {
    const monthly = annualContrib / 12;
    const fees = [];
    if (feeAnnualDec > 0) {
      fees.push({
        type: "aumFlat",
        annualRate: feeAnnualDec,
        frequency: "monthly",
        timing: "end",
      });
    }
    return {
      initialBalance: principal,
      years,
      annualGrossReturn: grossDec,
      contribution:
        monthly > 0
          ? { amount: monthly, frequency: "monthly", timing: "start" }
          : undefined,
      fees,
    };
  }

  // -----------------------------
  // Fee Cost pages (0.5%, 1%, etc.)
  // -----------------------------
  function initFeeCostPage() {
    const PS = window.TLM_PortfolioSimulation;
    if (!PS) {
      console.error("TLM_PortfolioSimulation not available");
      return;
    }

    function render() {
      const P = numFromInput("P");
      const years = Math.round(numFromInput("years"));
      const rGross = pctToDec(numFromInput("rGrossPct"));
      const fee = pctToDec(numFromInput("feePct"));
      const contrib = numFromInput("contrib");

      const noFee = PS.simulatePortfolioScenario(
        makeFeeScenario({ principal: P, years, grossDec: rGross, feeAnnualDec: 0, annualContrib: contrib })
      ).endingBalance;

      const withFee = PS.simulatePortfolioScenario(
        makeFeeScenario({ principal: P, years, grossDec: rGross, feeAnnualDec: fee, annualContrib: contrib })
      ).endingBalance;

      if (!Number.isFinite(noFee) || !Number.isFinite(withFee)) {
        setText("outNoFee", "—");
        setText("outWithFee", "—");
        setText("outDiff", "—");
        setText("outPct", "—");
        return;
      }

      const diff = noFee - withFee;
      const pct = noFee === 0 ? NaN : diff / noFee;

      setText("outNoFee", fmtMoney(noFee));
      setText("outWithFee", fmtMoney(withFee));
      setText("outDiff", fmtMoney(diff));
      setText("outPct", fmtPctDec(pct, 1));
    }

    ["P", "years", "rGrossPct", "feePct", "contrib"].forEach((id) => {
      $(id).addEventListener("input", render);
    });

    render();
  }

  // -----------------------------
  // Legacy required-alpha tool (if used on a page)
  // -----------------------------
  function initRequiredReturnPage() {
    const PS = window.TLM_PortfolioSimulation;
    if (!PS) {
      console.error("TLM_PortfolioSimulation not available");
      return;
    }

    function render() {
      const P = numFromInput("P");
      const years = Math.round(numFromInput("years"));
      const rGross = pctToDec(numFromInput("rGrossPct"));
      const fee = pctToDec(numFromInput("feePct"));
      const contrib = numFromInput("contrib");

      const noFeeSc = makeFeeScenario({
        principal: P,
        years,
        grossDec: rGross,
        feeAnnualDec: 0,
        annualContrib: contrib,
      });
      const withFeeSc = makeFeeScenario({
        principal: P,
        years,
        grossDec: rGross,
        feeAnnualDec: fee,
        annualContrib: contrib,
      });

      const endNoFee = PS.simulatePortfolioScenario(noFeeSc).endingBalance;
      const endWithFee = PS.simulatePortfolioScenario(withFeeSc).endingBalance;
      const endDiff = endNoFee - endWithFee;

      let alphaRequired = NaN;
      let grossRequired = NaN;
      if (fee > 0) {
        const solved = PS.solveAnnualReturnForEndingValue({
          scenarioFn: (rAnnual) =>
            makeFeeScenario({
              principal: P,
              years,
              grossDec: rAnnual,
              feeAnnualDec: fee,
              annualContrib: contrib,
            }),
          targetEnding: endNoFee,
          lowAnnualReturn: 0,
          highAnnualReturn: 1.0,
        });
        grossRequired = solved.annualReturn;
        alphaRequired = grossRequired - rGross;
      } else {
        alphaRequired = 0;
        grossRequired = rGross;
      }

      const extraContrib =
        fee > 0
          ? PS.solveExtraContributionPerPeriodForEnding({
              baseScenario: withFeeSc,
              feeScenarioBuilder: (base, extra) => {
                if (!base.contribution) {
                  return {
                    ...base,
                    contribution: { amount: extra, frequency: "monthly", timing: "start" },
                  };
                }
                return {
                  ...base,
                  contribution: { ...base.contribution, amount: base.contribution.amount + extra },
                };
              },
              targetEnding: endNoFee,
            }) * 12
          : 0;

      if (
        ![endNoFee, endWithFee, endDiff, alphaRequired, grossRequired, extraContrib].every(Number.isFinite)
      ) {
        setText("outAlphaPct", "—");
        setText("outGrossReqPct", "—");
        setText("outEndNoFee", "—");
        setText("outEndWithFee", "—");
        setText("outEndDiff", "—");
        setText("outExtraContrib", "—");
        setText("seoSentence", "");
        return;
      }

      setText("outAlphaPct", fmtPctDec(alphaRequired, 2));
      setText("outGrossReqPct", fmtPctDec(grossRequired, 2));
      setText("outEndNoFee", fmtMoney(endNoFee));
      setText("outEndWithFee", fmtMoney(endWithFee));
      setText("outEndDiff", fmtMoney(endDiff));
      setText("outExtraContrib", fmtMoney(extraContrib));

      const sentenceEl = document.getElementById("seoSentence");
      if (sentenceEl) {
        const feePct = (fee * 100).toFixed(2).replace(/\.00$/, "");
        const yearsTxt = String(Math.round(years));
        const alphaPct = (alphaRequired * 100).toFixed(2).replace(/\.00$/, "");
        sentenceEl.textContent =
          `With a ${feePct}% annual fee, the ending value is ${fmtMoney(endDiff)} lower over ${yearsTxt} years under the current assumptions. ` +
          `Offsetting this would require either an extra ${alphaPct}% annual return or an additional ${fmtMoney(extraContrib)} per year in contributions.`;
      }
    }

    ["P", "years", "rGrossPct", "feePct", "contrib"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", render);
    });

    render();
  }

  // -----------------------------
  // Active vs Passive
  // -----------------------------
  function initActiveVsPassivePage() {
    const PS = window.TLM_PortfolioSimulation;
    if (!PS) {
      console.error("TLM_PortfolioSimulation not available");
      return;
    }

    function render() {
      const P = numFromInput("P");
      const years = Math.round(numFromInput("years"));
      const rPassivePortfolio = pctToDec(numFromInput("rPassivePortfolioPct"));
      const rActivePortfolio = pctToDec(numFromInput("rActivePortfolioPct"));
      const feePassive = pctToDec(numFromInput("feePassivePct"));
      const feeActive = pctToDec(numFromInput("feeActivePct"));
      const contrib = numFromInput("contrib");

      const passiveSc = makeFeeScenario({
        principal: P,
        years,
        grossDec: rPassivePortfolio,
        feeAnnualDec: feePassive,
        annualContrib: contrib,
      });
      const endPassive = PS.simulatePortfolioScenario(passiveSc).endingBalance;

      const activeSc = makeFeeScenario({
        principal: P,
        years,
        grossDec: rActivePortfolio,
        feeAnnualDec: feeActive,
        annualContrib: contrib,
      });
      const endActive = PS.simulatePortfolioScenario(activeSc).endingBalance;

      const solved = PS.solveAnnualReturnForEndingValue({
        scenarioFn: (rAnnual) =>
          makeFeeScenario({
            principal: P,
            years,
            grossDec: rAnnual,
            feeAnnualDec: feeActive,
            annualContrib: contrib,
          }),
        targetEnding: endPassive,
        lowAnnualReturn: 0,
        highAnnualReturn: 1.0,
      });

      const rActiveBreakEven = solved.annualReturn;
      const alphaBreakEven = rActiveBreakEven - rPassivePortfolio;

      const endActiveBreakEven = PS.simulatePortfolioScenario(
        makeFeeScenario({
          principal: P,
          years,
          grossDec: rActiveBreakEven,
          feeAnnualDec: feeActive,
          annualContrib: contrib,
        })
      ).endingBalance;

      const diff = endActive - endPassive;
      const passiveRelative = endPassive - endActive;
      const outPrimaryLabel = document.getElementById("outPrimaryLabel");
      const outPassiveNetReturn = document.getElementById("outPassiveNetReturn");
      const outActiveNetReturn = document.getElementById("outActiveNetReturn");
      const outPassiveRequiredAfterFee = document.getElementById("outPassiveRequiredAfterFee");
      const outActiveRequiredAfterFee = document.getElementById("outActiveRequiredAfterFee");

      let passiveRequiredAfterFee = NaN;
      const passiveReqSolved = PS.solveAnnualReturnForEndingValue({
        scenarioFn: (rAnnual) =>
          makeFeeScenario({
            principal: P,
            years,
            grossDec: rAnnual,
            feeAnnualDec: feePassive,
            annualContrib: contrib,
          }),
        targetEnding: endActive,
        lowAnnualReturn: 0,
        highAnnualReturn: 1.0,
      });
      passiveRequiredAfterFee = passiveReqSolved.annualReturn - feePassive;

      const passiveNetApprox =
        Math.pow(Math.pow(1 + rPassivePortfolio, 1 / 12) * (1 - feePassive / 12), 12) - 1;
      const activeNetApprox =
        Math.pow(Math.pow(1 + rActivePortfolio, 1 / 12) * (1 - feeActive / 12), 12) - 1;
      const activeRequiredAfterFee = rActiveBreakEven - feeActive;

      if (
        ![
          endPassive,
          endActive,
          endActiveBreakEven,
          diff,
          alphaBreakEven,
          rActiveBreakEven,
          rActivePortfolio,
          passiveRequiredAfterFee,
          activeRequiredAfterFee,
        ].every(Number.isFinite)
      ) {
        if (outPrimaryLabel) outPrimaryLabel.textContent = "Passive portfolio";
        if (outPassiveNetReturn) outPassiveNetReturn.textContent = "—";
        if (outActiveNetReturn) outActiveNetReturn.textContent = "—";
        if (outPassiveRequiredAfterFee) outPassiveRequiredAfterFee.textContent = "—";
        if (outActiveRequiredAfterFee) outActiveRequiredAfterFee.textContent = "—";
        setText("outAlphaBreakEven", "—");
        setText("outActiveGrossBreakEven", "—");
        setText("outActivePortfolioAssumed", "—");
        setText("outEndPassive", "—");
        setText("outEndActive", "—");
        setText("outDiff", "—");
        setText("outEndActiveBreakEven", "—");
        return;
      }

      setText("outAlphaBreakEven", fmtPctDec(alphaBreakEven, 2));
      setText("outActiveGrossBreakEven", fmtPctDec(rActiveBreakEven, 2));
      setText("outActivePortfolioAssumed", fmtPctDec(rActivePortfolio, 2));
      setText("outEndPassive", fmtMoney(endPassive));
      setText("outEndActive", fmtMoney(endActive));
      setText("outDiff", signedMoney(passiveRelative));
      setText("outEndActiveBreakEven", fmtMoney(endActiveBreakEven));
      if (outPrimaryLabel) {
        outPrimaryLabel.textContent = "Passive portfolio";
      }
      if (outPassiveNetReturn) outPassiveNetReturn.textContent = fmtPctDec(passiveNetApprox, 2);
      if (outActiveNetReturn) outActiveNetReturn.textContent = fmtPctDec(activeNetApprox, 2);
      if (outPassiveRequiredAfterFee)
        outPassiveRequiredAfterFee.textContent = fmtPctDec(passiveRequiredAfterFee, 2);
      if (outActiveRequiredAfterFee)
        outActiveRequiredAfterFee.textContent = fmtPctDec(activeRequiredAfterFee, 2);
    }

    ["P", "years", "rPassivePortfolioPct", "rActivePortfolioPct", "feePassivePct", "feeActivePct", "contrib"].forEach(
      (id) => {
        const el = $(id);
        if (el) el.addEventListener("input", render);
      }
    );

    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      const tool = document.body.getAttribute("data-tool");
      if (!tool) return;

      if (tool === "fee-cost") initFeeCostPage();
      if (tool === "required-alpha") initRequiredReturnPage();
      if (tool === "active-vs-passive") initActiveVsPassivePage();
    } catch (err) {
      console.error("Error initializing fee calculator:", err);
    }
  });
})();
