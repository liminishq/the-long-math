/**
 * Calculator numeric input helpers (opt-in).
 *
 * Auto-enhancement runs only inside elements marked with
 *   data-tlm-decimal-inputs
 * or on individual inputs marked with
 *   data-tlm-decimal-input
 *
 * Helpers (parseNumber / formatMoney / …) are always available on TLM.calcInputs
 * for calculator scripts that call them explicitly.
 */
(function (global) {
  "use strict";

  var INTEGER_INPUT_IDS = {
    birth_year: true,
  };

  function roundToDecimals(value, decimals) {
    var places = decimals == null ? 2 : decimals;
    var x = Number(value);
    if (!Number.isFinite(x)) return 0;
    var f = Math.pow(10, places);
    return Math.round(x * f) / f;
  }

  function parseNumber(raw, decimals) {
    if (raw == null) return 0;
    var s = String(raw).trim().replace(/,/g, "");
    if (s === "" || s === "-" || s === "." || s === "-.") return 0;
    var x = Number(s);
    if (!Number.isFinite(x)) return 0;
    return roundToDecimals(x, decimals == null ? 2 : decimals);
  }

  function formatMoney(value, decimals) {
    var places = decimals == null ? 2 : decimals;
    return (
      "$" +
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
      }).format(Number(value) || 0)
    );
  }

  function formatPercentFromDecimal(decimalRate, decimals) {
    var places = decimals == null ? 2 : decimals;
    return (Number(decimalRate) * 100).toFixed(places) + "%";
  }

  function shouldSkipInput(el) {
    if (!el || el.disabled) return true;
    if (el.type === "range" || el.type === "hidden" || el.type === "checkbox" || el.type === "radio") {
      return true;
    }
    if (el.getAttribute("data-integer") === "true") return true;
    if (INTEGER_INPUT_IDS[el.id]) return true;
    return false;
  }

  function collectOptInInputs(root) {
    var scope = root || document;
    var found = [];
    var seen = new Set();
    function add(el) {
      if (!el || seen.has(el) || shouldSkipInput(el)) return;
      seen.add(el);
      found.push(el);
    }
    scope.querySelectorAll("[data-tlm-decimal-input]").forEach(add);
    scope.querySelectorAll("[data-tlm-decimal-inputs]").forEach(function (host) {
      host.querySelectorAll('input[type="number"], input[inputmode="decimal"]').forEach(add);
    });
    return found;
  }

  function enhanceNumberInputs(root) {
    collectOptInInputs(root).forEach(function (el) {
      el.setAttribute("inputmode", "decimal");
      if (el.type === "number") {
        var step = el.getAttribute("step");
        if (
          step == null ||
          step === "" ||
          step === "1" ||
          step === "0.5" ||
          step === "0.1" ||
          Number(step) >= 1
        ) {
          el.setAttribute("step", "any");
        }
      }
    });
  }

  function bindBlurRounding(root) {
    collectOptInInputs(root).forEach(function (el) {
      if (el.dataset.tlmRoundBound === "1") return;
      el.dataset.tlmRoundBound = "1";
      el.addEventListener("blur", function () {
        var raw = String(el.value || "").trim();
        if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
        var n = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(n)) return;
        var rounded = roundToDecimals(n, 2);
        if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
          el.value = String(Math.round(rounded));
        } else {
          el.value = String(rounded);
        }
      });
    });
  }

  function initCalculatorInputs() {
    var path = (global.location && global.location.pathname) || "";
    if (path.indexOf("/calculators/") === -1) return;
    enhanceNumberInputs(document);
    bindBlurRounding(document);
  }

  var api = {
    roundToDecimals: roundToDecimals,
    parseNumber: parseNumber,
    formatMoney: formatMoney,
    formatPercentFromDecimal: formatPercentFromDecimal,
    enhanceNumberInputs: enhanceNumberInputs,
    bindBlurRounding: bindBlurRounding,
    initCalculatorInputs: initCalculatorInputs,
  };

  global.TLM = global.TLM || {};
  global.TLM.calcInputs = api;

  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", initCalculatorInputs);
    } else {
      initCalculatorInputs();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
