// fee-ui.js
// UI glue for fee calculators. Reads inputs, calls fee-math, writes outputs.

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
      maximumFractionDigits: 0
    });
  }

  function fmtPctDec(nDec, digits = 2) {
    if (!Number.isFinite(nDec)) return "—";
    return (nDec * 100).toFixed(digits) + "%";
  }

  function fmtYears(n) {
    if (!Number.isFinite(n)) return "—";
    const rounded = Math.round(n * 100) / 100;
    return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function setText(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

  function calculatorSlugFromPath() {
    const segs = (window.location.pathname || "").replace(/\/$/, "").split("/").filter(Boolean);
    return segs[segs.length - 1] || "calculator";
  }

  function showSharedScenarioBannerIfPresent() {
    const b = document.getElementById("shared_scenario_banner");
    if (b) b.hidden = false;
  }

  // -----------------------------
  // Tool: Fee Cost pages
  // -----------------------------
  function initFeeCostPage() {
    if (!window.TLM_FeeMath) {
      console.error("TLM_FeeMath not available");
      return;
    }

    function applyFeeCostFromQuery() {
      const ps = new URLSearchParams(window.location.search || "");
      if (!ps.toString()) return false;
      let applied = false;
      function setInp(id, raw, lo, hi) {
        const n = Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n)) return;
        const el = document.getElementById(id);
        if (!el) return;
        el.value = String(Math.min(hi, Math.max(lo, n)));
        applied = true;
      }
      if (ps.has("P")) setInp("P", ps.get("P"), 0, 1e12);
      if (ps.has("years")) setInp("years", ps.get("years"), 1, 100);
      if (ps.has("rGrossPct")) setInp("rGrossPct", ps.get("rGrossPct"), 0, 50);
      if (ps.has("feePct")) setInp("feePct", ps.get("feePct"), 0, 30);
      if (ps.has("contrib")) setInp("contrib", ps.get("contrib"), 0, 1e9);
      if (applied) {
        showSharedScenarioBannerIfPresent();
        if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
          window.TLM.shareCard.track("calculator_shared_scenario_loaded", { calculator_name: calculatorSlugFromPath() });
        }
      }
      return applied;
    }

    applyFeeCostFromQuery();

    function render() {
      const P = numFromInput("P");
      const years = numFromInput("years");
      const rGross = pctToDec(numFromInput("rGrossPct"));
      const fee = pctToDec(numFromInput("feePct"));
      const contrib = numFromInput("contrib");

      const noFee = window.TLM_FeeMath.endingValueWithFee({ P, gross: rGross, fee: 0, years, contrib });
      const withFee = window.TLM_FeeMath.endingValueWithFee({ P, gross: rGross, fee, years, contrib });

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

    if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.wireCalculatorShare && document.getElementById("share_result_btn")) {
      window.TLM.shareCard.wireCalculatorShare(calculatorSlugFromPath(), function () {
        const P = numFromInput("P");
        const years = numFromInput("years");
        const rGross = pctToDec(numFromInput("rGrossPct"));
        const fee = pctToDec(numFromInput("feePct"));
        const contrib = numFromInput("contrib");
        const noFee = window.TLM_FeeMath.endingValueWithFee({ P, gross: rGross, fee: 0, years, contrib });
        const withFee = window.TLM_FeeMath.endingValueWithFee({ P, gross: rGross, fee, years, contrib });
        if (!Number.isFinite(noFee) || !Number.isFinite(withFee)) return null;
        const diff = noFee - withFee;
        const rGV = numFromInput("rGrossPct");
        const fV = numFromInput("feePct");
        return {
          scenario: {
            P: Math.round(P),
            years: years,
            rGrossPct: Number((Number.isFinite(rGV) ? rGV : 0).toFixed(4)),
            feePct: Number((Number.isFinite(fV) ? fV : 0).toFixed(4)),
            contrib: Math.round(Number.isFinite(contrib) ? contrib : 0),
          },
          card: {
            headline: "Estimated ending value gap from fees",
            mainValue: fmtMoney(diff),
            subline: "Over a " + fmtYears(years) + "-year investing horizon",
            contextLines: [
              "Starting amount: " + fmtMoney(P),
              "Contribution: " + fmtMoney(contrib) + " per year",
              "Gross return: " + fmtPctDec(rGross, 2),
              "Fee: " + fmtPctDec(fee, 2),
            ],
            shareText:
              "Estimated fee impact over " +
              fmtYears(years) +
              " years: " +
              fmtMoney(diff) +
              ". Run your own numbers:",
          },
        };
      });
    }
  }

  // -----------------------------
  // Tool: Required return to offset fee
  // -----------------------------
  function initRequiredReturnPage() {
    if (!window.TLM_FeeMath) {
      console.error("TLM_FeeMath not available");
      return;
    }

    function render() {
      const P = numFromInput("P");
      const years = numFromInput("years");
      const rGross = pctToDec(numFromInput("rGrossPct"));
      const fee = pctToDec(numFromInput("feePct"));
      const contrib = numFromInput("contrib");

      // Under this model, alphaRequired == fee (exactly).
      const alphaRequired = window.TLM_FeeMath.requiredAlphaToOffsetFeeSimple({ fee });
      const grossRequired = rGross + alphaRequired;

      const endNoFee = window.TLM_FeeMath.endingValueWithFee({ P, gross: rGross, fee: 0, years, contrib });
      const endWithFee = window.TLM_FeeMath.endingValueWithFee({ P, gross: rGross, fee, years, contrib });
      const endDiff = endNoFee - endWithFee;

      // Extra annual contribution needed to offset the fee (keeping same gross return)
      const extraContrib = window.TLM_FeeMath.extraAnnualContributionToOffsetFee({
        P,
        years,
        rGross,
        fee,
        contrib
      });

      if (![endNoFee, endWithFee, endDiff, alphaRequired, grossRequired, extraContrib].every(Number.isFinite)) {
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

      // Optional: explicit AEO/SEO sentence (if element exists on page)
      const sentenceEl = document.getElementById("seoSentence");
      if (sentenceEl) {
        const feePct = (fee * 100).toFixed(2).replace(/\.00$/, "");
        const yearsTxt = fmtYears(years);
        const alphaPct = (alphaRequired * 100).toFixed(2).replace(/\.00$/, "");
        sentenceEl.textContent =
          `With a ${feePct}% annual fee, the ending value is ${fmtMoney(endDiff)} lower over ${yearsTxt} years under the current assumptions. ` +
          `Offsetting this would require either an extra ${alphaPct}% annual return or an additional ${fmtMoney(extraContrib)} per year in contributions.`;
      }
    }

    ["P", "years", "rGrossPct", "feePct", "contrib"].forEach((id) => {
      $(id).addEventListener("input", render);
    });

    render();
  }

  // -----------------------------
  // Tool: Active vs Passive
  // -----------------------------
  function initActiveVsPassivePage() {
    if (!window.TLM_FeeMath) {
      console.error("TLM_FeeMath not available");
      return;
    }

    function applyActiveVsPassiveFromQuery() {
      const ps = new URLSearchParams(window.location.search || "");
      if (!ps.toString()) return false;
      let applied = false;
      function setInp(id, raw, lo, hi) {
        const n = Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n)) return;
        const el = document.getElementById(id);
        if (!el) return;
        el.value = String(Math.min(hi, Math.max(lo, n)));
        applied = true;
      }
      if (ps.has("P")) setInp("P", ps.get("P"), 0, 1e12);
      if (ps.has("years")) setInp("years", ps.get("years"), 1, 100);
      if (ps.has("rPassivePortfolioPct")) setInp("rPassivePortfolioPct", ps.get("rPassivePortfolioPct"), 0, 50);
      if (ps.has("rActivePortfolioPct")) setInp("rActivePortfolioPct", ps.get("rActivePortfolioPct"), 0, 50);
      if (ps.has("feePassivePct")) setInp("feePassivePct", ps.get("feePassivePct"), 0, 30);
      if (ps.has("feeActivePct")) setInp("feeActivePct", ps.get("feeActivePct"), 0, 30);
      if (ps.has("contribFreq")) {
        const el = document.getElementById("contribFreq");
        const v = ps.get("contribFreq");
        if (el && ["weekly", "monthly", "annual"].includes(v)) {
          el.value = v;
          applied = true;
        }
      }
      if (ps.has("contrib")) setInp("contrib", ps.get("contrib"), 0, 1e9);
      if (!ps.has("contribFreq") && ps.has("contrib")) {
        const el = document.getElementById("contribFreq");
        if (el) {
          el.value = "annual";
          applied = true;
        }
      }
      if (applied) {
        showSharedScenarioBannerIfPresent();
        if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
          window.TLM.shareCard.track("calculator_shared_scenario_loaded", { calculator_name: calculatorSlugFromPath() });
        }
      }
      return applied;
    }

    applyActiveVsPassiveFromQuery();

    const CONTRIB_LABEL_TEXT = {
      weekly: "Contribution (CAD / week)",
      monthly: "Contribution (CAD / month)",
      annual: "Contribution (CAD / year)"
    };

    function syncContribFieldLabel() {
      const sel = document.getElementById("contribFreq");
      const lb = document.getElementById("contrib_label");
      if (!sel || !lb) return;
      lb.textContent = CONTRIB_LABEL_TEXT[sel.value] || CONTRIB_LABEL_TEXT.monthly;
    }

    syncContribFieldLabel();

    function activeVsPassiveContribOptions() {
      const sel = document.getElementById("contribFreq");
      const freq = sel && sel.value ? sel.value : "monthly";
      const contrib = numFromInput("contrib");
      if (freq === "annual") {
        return { contrib };
      }
      return { contrib, contribFreq: freq };
    }

    function setActiveVsPassiveDiffDetail(d) {
      const amtEl = document.getElementById("outDiffAmount");
      const wordsEl = document.getElementById("outDiffWords");
      if (!amtEl || !wordsEl) return;
      if (!Number.isFinite(d)) {
        amtEl.textContent = "—";
        wordsEl.textContent = "";
        return;
      }
      const tieEps = 0.01;
      if (Math.abs(d) < tieEps) {
        amtEl.textContent = fmtMoney(0);
        wordsEl.textContent = "Same as passive";
        return;
      }
      const more = d > 0;
      amtEl.textContent = fmtMoney(Math.abs(d));
      wordsEl.textContent = more ? "More than passive" : "Less than passive";
    }

    function render() {
      const P = numFromInput("P");
      const years = numFromInput("years");
      const rPassivePortfolio = pctToDec(numFromInput("rPassivePortfolioPct"));
      const rActivePortfolio = pctToDec(numFromInput("rActivePortfolioPct"));
      const feePassive = pctToDec(numFromInput("feePassivePct"));
      const feeActive = pctToDec(numFromInput("feeActivePct"));
      const contribOpts = activeVsPassiveContribOptions();

      // Break-even alpha (fee difference)
      const alphaBreakEven = feeActive - feePassive;
      const rActiveBreakEven = rPassivePortfolio + alphaBreakEven;

      // Ending values
      const endPassive = window.TLM_FeeMath.endingValueWithFee({
        P,
        gross: rPassivePortfolio,
        fee: feePassive,
        years,
        ...contribOpts
      });

      const endActive = window.TLM_FeeMath.endingValueWithFee({
        P,
        gross: rActivePortfolio,
        fee: feeActive,
        years,
        ...contribOpts
      });

      const endActiveBreakEven = window.TLM_FeeMath.endingValueWithFee({
        P,
        gross: rActiveBreakEven,
        fee: feeActive,
        years,
        ...contribOpts
      });

      const diff = endActive - endPassive;

      if (![endPassive, endActive, endActiveBreakEven, diff, alphaBreakEven, rActiveBreakEven, rActivePortfolio].every(Number.isFinite)) {
        setText("outAlphaBreakEven", "—");
        setText("outActiveGrossBreakEven", "—");
        setText("outActivePortfolioAssumed", "—");
        setText("outEndPassive", "—");
        setText("outEndActive", "—");
        setActiveVsPassiveDiffDetail(NaN);
        setText("outEndActiveBreakEven", "—");
        return;
      }

      setText("outAlphaBreakEven", fmtPctDec(alphaBreakEven, 2));
      setText("outActiveGrossBreakEven", fmtPctDec(rActiveBreakEven, 2));
      setText("outActivePortfolioAssumed", fmtPctDec(rActivePortfolio, 2));
      setText("outEndPassive", fmtMoney(endPassive));
      setText("outEndActive", fmtMoney(endActive));
      setActiveVsPassiveDiffDetail(diff);
      setText("outEndActiveBreakEven", fmtMoney(endActiveBreakEven));
    }

    ["P", "years", "rPassivePortfolioPct", "rActivePortfolioPct", "feePassivePct", "feeActivePct", "contrib"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", render);
    });
    const contribFreqEl = document.getElementById("contribFreq");
    if (contribFreqEl) {
      contribFreqEl.addEventListener("change", function () {
        syncContribFieldLabel();
        render();
      });
    }

    render();

    if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.wireCalculatorShare && document.getElementById("share_result_btn")) {
      window.TLM.shareCard.wireCalculatorShare(calculatorSlugFromPath(), function () {
        const P = numFromInput("P");
        const years = numFromInput("years");
        const rPassivePortfolio = pctToDec(numFromInput("rPassivePortfolioPct"));
        const rActivePortfolio = pctToDec(numFromInput("rActivePortfolioPct"));
        const feePassive = pctToDec(numFromInput("feePassivePct"));
        const feeActive = pctToDec(numFromInput("feeActivePct"));
        const contribOpts = activeVsPassiveContribOptions();
        const contrib = numFromInput("contrib");
        const freqEl = document.getElementById("contribFreq");
        const contribFreq = freqEl && freqEl.value ? freqEl.value : "monthly";
        const endPassive = window.TLM_FeeMath.endingValueWithFee({
          P,
          gross: rPassivePortfolio,
          fee: feePassive,
          years,
          ...contribOpts,
        });
        const endActive = window.TLM_FeeMath.endingValueWithFee({
          P,
          gross: rActivePortfolio,
          fee: feeActive,
          years,
          ...contribOpts,
        });
        if (!Number.isFinite(endPassive) || !Number.isFinite(endActive)) return null;
        const diff = endActive - endPassive;
        const tieEps = 0.01;
        const shareMain =
          Math.abs(diff) < tieEps
            ? fmtMoney(0)
            : fmtMoney(Math.abs(diff)) + (diff > 0 ? " ahead" : " behind");
        const shareSentence =
          Math.abs(diff) < tieEps
            ? "Ending balances match after " + fmtYears(years) + " years (this model, after fees)."
            : fmtMoney(Math.abs(diff)) + (diff > 0 ? " ahead of" : " behind") + " passive after " + fmtYears(years) + " years.";
        const rp = numFromInput("rPassivePortfolioPct");
        const ra = numFromInput("rActivePortfolioPct");
        const fp = numFromInput("feePassivePct");
        const fa = numFromInput("feeActivePct");
        return {
          scenario: {
            P: Math.round(P),
            years: years,
            rPassivePortfolioPct: Number((Number.isFinite(rp) ? rp : 0).toFixed(4)),
            rActivePortfolioPct: Number((Number.isFinite(ra) ? ra : 0).toFixed(4)),
            feePassivePct: Number((Number.isFinite(fp) ? fp : 0).toFixed(4)),
            feeActivePct: Number((Number.isFinite(fa) ? fa : 0).toFixed(4)),
            contrib: Math.round(Number.isFinite(contrib) ? contrib : 0),
            contribFreq: contribFreq,
          },
          card: {
            headline: "Active vs passive ending balance",
            mainValue: shareMain,
            subline: "Over " + fmtYears(years) + " years, after fees in this model",
            contextLines: [
              "Starting amount: " + fmtMoney(P),
              "Contribution: " + fmtMoney(contrib) + " per " + contribFreq,
              "Passive: " + fmtPctDec(rPassivePortfolio, 2) + " return, " + fmtPctDec(feePassive, 2) + " fee",
              "Active: " + fmtPctDec(rActivePortfolio, 2) + " return, " + fmtPctDec(feeActive, 2) + " fee",
            ],
            shareText: shareSentence + " Run your own numbers:",
          },
        };
      });
    }
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
