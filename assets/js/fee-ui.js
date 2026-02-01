// fee-ui.js
// UI glue for fee calculators. Reads inputs, calls fee-math, writes outputs.

(function () {
  "use strict";

  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function numFromInput(id) {
    const raw = $(id).value.trim().replace(/,/g, "");
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

  function setText(id, txt) {
    $(id).textContent = txt;
  }

  // -----------------------------
  // Tool: Fee Cost pages
  // -----------------------------
  function initFeeCostPage() {
    function render() {
      const P = numFromInput("P");
      const years = Math.round(numFromInput("years"));
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
  }

  // -----------------------------
  // Tool: Required return to offset fee
  // -----------------------------
  function initRequiredReturnPage() {
    function render() {
      const P = numFromInput("P");
      const years = Math.round(numFromInput("years"));
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
        const yearsTxt = String(Math.round(years));
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

  document.addEventListener("DOMContentLoaded", function () {
    const tool = document.body.getAttribute("data-tool");
    if (!tool) return;

    if (tool === "fee-cost") initFeeCostPage();
    if (tool === "required-alpha") initRequiredReturnPage();
  });
})();
