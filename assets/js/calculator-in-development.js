/**
 * Temporary gate for calculators still being refined.
 * Disables all controls inside .calc-in-development-body.
 * Remove this script (and the overlay markup) when the calculator goes live.
 */
(function () {
  "use strict";

  function lockRoot(root) {
    var body = root.querySelector(".calc-in-development-body");
    if (!body) return;

    body.setAttribute("inert", "");
    body.setAttribute("aria-hidden", "true");

    body.querySelectorAll("input, select, textarea, button").forEach(function (el) {
      el.disabled = true;
      el.setAttribute("tabindex", "-1");
    });
  }

  function lockAll() {
    document.querySelectorAll(".calc-in-development").forEach(lockRoot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", lockAll);
  } else {
    lockAll();
  }

  window.TLM = window.TLM || {};
  window.TLM.calculatorInDevelopment = true;
})();
