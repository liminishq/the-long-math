/**
 * Homepage fee slider demo (paired EN/FR; strings from inline __HOME_FEE_I18N__).
 */
(function () {
  "use strict";

  var cfg = window.__HOME_FEE_I18N__ || {};
  var locale = cfg.locale || "en-CA";
  var slider = document.getElementById("feeSlider");
  var feeLabel = document.getElementById("feeSelectedLabel");
  var leftWithLabelEl = document.getElementById("feeLeftWithLabel");
  var leftBaseEl = document.getElementById("feeLeftBaseValue");
  var leftWithEl = document.getElementById("feeLeftWithValue");
  var leftCostEl = document.getElementById("feeLeftCostValue");
  var leftLabelEls = document.querySelectorAll(".home-proof-left .home-proof-row .home-proof-label");
  var leftValues = document.querySelectorAll(".home-proof-left .home-proof-demo .home-proof-value");
  if (!leftWithLabelEl && leftLabelEls.length >= 2) leftWithLabelEl = leftLabelEls[1];
  if (!leftBaseEl && leftValues.length >= 1) leftBaseEl = leftValues[0];
  if (!leftWithEl && leftValues.length >= 2) leftWithEl = leftValues[1];
  if (!leftCostEl && leftValues.length >= 3) leftCostEl = leftValues[2];
  var baseEl = document.getElementById("feeBaseValue");
  var withEl = document.getElementById("feeWithValue");
  var costEl = document.getElementById("feeCostValue");
  var summaryLive = document.getElementById("feeSummaryLive");
  var chartBasePath = document.getElementById("feeChartBaseLine");
  var chartFeePath = document.getElementById("feeChartFeeLine");

  if (!slider || !feeLabel || !baseEl || !withEl || !costEl || !summaryLive || !chartBasePath || !chartFeePath) return;

  var P = 500000;
  var r = 0.07;
  var years = 30;

  function formatMoney(x) {
    return "$" + Math.round(x).toLocaleString(locale);
  }

  function formatPercent(x) {
    return x.toFixed(1) + "%";
  }

  function compoundFV(rate) {
    return P * Math.pow(1 + rate, years);
  }

  var baseFV = compoundFV(r);
  baseEl.textContent = formatMoney(baseFV);

  function buildPath(values, max) {
    var width = 320;
    var height = 180;
    var left = 32;
    var right = 300;
    var top = 20;
    var bottom = 160;

    var pts = [];
    for (var t = 0; t <= years; t++) {
      var x = left + (right - left) * (t / years);
      var v = values[t];
      var y = bottom - (v / max) * (bottom - top);
      pts.push((t === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2));
    }
    return pts.join(" ");
  }

  function computeSeries(rate) {
    var arr = [];
    for (var t = 0; t <= years; t++) {
      arr.push(P * Math.pow(1 + rate, t));
    }
    return arr;
  }

  function syncLeftValuesFromRight() {
    if (leftBaseEl) leftBaseEl.textContent = baseEl.textContent;
    if (leftWithEl) leftWithEl.textContent = withEl.textContent;
    if (leftCostEl) leftCostEl.textContent = costEl.textContent;
  }

  function update() {
    var feePct = parseFloat(slider.value || "1.0");
    var fee = feePct / 100;

    var selectedTpl = cfg.selectedFeeLabel || "Selected fee: {pct}";
    feeLabel.textContent = selectedTpl.replace("{pct}", formatPercent(feePct));
    var leftWithTpl = cfg.leftWithFeeLabel || "Advisory fee: {pct}";
    if (leftWithLabelEl) leftWithLabelEl.textContent = leftWithTpl.replace("{pct}", formatPercent(feePct));

    baseEl.textContent = formatMoney(baseFV);
    var fvFee = compoundFV(r - fee);
    withEl.textContent = formatMoney(fvFee);

    var cost = baseFV - fvFee;
    costEl.textContent = formatMoney(cost);
    syncLeftValuesFromRight();

    var sumTpl =
      cfg.summaryLive ||
      "With a {pct} annual fee, the ending value is {fv}, a difference of {cost} compared with the no-fee case.";
    summaryLive.textContent = sumTpl
      .replace("{pct}", formatPercent(feePct))
      .replace("{fv}", formatMoney(fvFee))
      .replace("{cost}", formatMoney(cost));

    var baseSeries = computeSeries(r);
    var feeSeries = computeSeries(r - fee);
    var maxSeries = Math.max.apply(null, baseSeries.concat(feeSeries));
    chartBasePath.setAttribute("d", buildPath(baseSeries, maxSeries));
    chartFeePath.setAttribute("d", buildPath(feeSeries, maxSeries));
  }

  slider.addEventListener("input", update);
  update();
})();
