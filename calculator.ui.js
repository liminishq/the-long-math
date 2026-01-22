// calculator.ui.js
// UI only: reads inputs, calls engine, writes outputs. No math logic.

(function () {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function num(x) {
    if (x == null) return NaN;
    const s = String(x).trim().replace(/,/g, "");
    if (s === "") return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function fmtCAD(n) {
    if (!Number.isFinite(n)) return "$–";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function fmtPct(dec) {
    if (!Number.isFinite(dec)) return "–";
    return (dec * 100).toFixed(2) + "%";
  }

  // -----------------------------
  // Defaults (UI-level)
  // -----------------------------
  const DEFAULTS = {
    starting_balance: 0,
    monthly_contribution: 5000,
    horizon_years: 25,
    annual_return_pct: 7,

    use_default_fee: true,
    advisor_fee_pct: 1, // only used if default schedule unchecked

    include_mer: true,
    mer_pct: 2,
  };

  const PRESETS = {
    starting: { starting_balance: 0, horizon_years: 25, monthly_contribution: 5000, annual_return_pct: 7 },
    mid: { starting_balance: 1000000, horizon_years: 15, monthly_contribution: 5000, annual_return_pct: 7 },
    retire: { starting_balance: 2000000, horizon_years: 5, monthly_contribution: 5000, annual_return_pct: 7 },
  };

  // Slider config (percent units)
  const AR = { min: 0, max: 15, step: 0.25 };

  // -----------------------------
  // Pull inputs -> payload for engine
  // -----------------------------
  function readInputs() {
    const include_mer = $("include_mer").checked;

    // MER: if checked but blank/invalid, fallback to DEFAULTS.mer_pct (2)
    let merPct = num($("mer_pct").value);
    if (!Number.isFinite(merPct)) merPct = DEFAULTS.mer_pct;

    // Advisor fee override: only relevant when default schedule unchecked.
    let advisorFeePct = num($("custom_advisor_fee").value);
    if (!Number.isFinite(advisorFeePct)) advisorFeePct = DEFAULTS.advisor_fee_pct;

    return {
      starting_balance: clamp(num($("starting_balance").value), 0, 10000000),
      monthly_contribution: clamp(num($("monthly_contribution").value), 0, 50000),
      horizon_years: clamp(num($("horizon_years").value), 1, 50),
      annual_return: clamp(num($("annual_return").value), AR.min, AR.max) / 100,

      use_default_fee: $("use_default_fee").checked,
      custom_advisor_fee_pct: clamp(advisorFeePct, 0, 15),

      include_mer: include_mer,
      mer_pct: include_mer ? clamp(merPct, 0, 15) : 0,
    };
  }

  // -----------------------------
  // Render outputs
  // -----------------------------
  function render() {
    const inp = readInputs();

    // Calculate via engine (must exist globally)
    if (typeof window.calculateLongMath !== "function") {
      $("out_meta").textContent = "Error: calculateLongMath(...) not found.";
      return;
    }

    const result = window.calculateLongMath(inp);

    $("out_with").textContent = fmtCAD(result.ending_with_advisor);
    $("out_without").textContent = fmtCAD(result.ending_without_advisor);

    $("out_fees").textContent = fmtCAD(result.fees_paid);
    $("out_lost").textContent = fmtCAD(result.lost_compounding);
    $("out_total_cost").textContent = fmtCAD(result.total_calculated_cost);

    $("out_breakeven").textContent = fmtPct(result.break_even_return);

    $("out_meta").textContent = "Calculated using the assumptions shown above.";
  }

  // -----------------------------
  // UI sync bits
  // -----------------------------
  function syncSliderFromAnnualReturn() {
    const n = num($("annual_return").value);
    if (!Number.isFinite(n)) return;
    const snapped = Math.round(n / AR.step) * AR.step;
    const clamped = clamp(snapped, AR.min, AR.max);
    $("annual_return_slider").value = String(clamped);
    $("annual_return_label").textContent = clamped.toFixed(2) + "%";
  }

  function syncAnnualReturnFromSlider() {
    const n = num($("annual_return_slider").value);
    if (!Number.isFinite(n)) return;
    const clamped = clamp(n, AR.min, AR.max);
    $("annual_return").value = String(clamped);
    $("annual_return_label").textContent = clamped.toFixed(2) + "%";
  }

  function setMEREnabledUI() {
    const on = $("include_mer").checked;
    $("mer_pct").disabled = !on;

    // If turning ON and the box is blank, seed it to 2.0
    if (on) {
      const cur = num($("mer_pct").value);
      if (!Number.isFinite(cur)) $("mer_pct").value = String(DEFAULTS.mer_pct);
    }
  }

  function setAdvisorOverrideEnabledUI() {
    const useDefault = $("use_default_fee").checked;
    $("custom_advisor_fee").disabled = useDefault;

    // If switching to override and blank, seed it to 1.0
    if (!useDefault) {
      const cur = num($("custom_advisor_fee").value);
      if (!Number.isFinite(cur)) $("custom_advisor_fee").value = String(DEFAULTS.advisor_fee_pct);
    }
  }

  // -----------------------------
  // Presets
  // -----------------------------
  function applyPreset(which) {
    const p = PRESETS[which];
    if (!p) return;

    $("starting_balance").value = String(p.starting_balance);
    $("monthly_contribution").value = String(p.monthly_contribution);
    $("horizon_years").value = String(p.horizon_years);
    $("annual_return").value = String(p.annual_return_pct);

    // Keep preferred defaults
    $("use_default_fee").checked = true;
    $("custom_advisor_fee").value = String(DEFAULTS.advisor_fee_pct);

    $("include_mer").checked = true;
    $("mer_pct").value = String(DEFAULTS.mer_pct); // <-- critical fix: seed to 2%

    // Slider + label
    $("annual_return_slider").min = String(AR.min);
    $("annual_return_slider").max = String(AR.max);
    $("annual_return_slider").step = String(AR.step);
    $("annual_return_slider").value = String(p.annual_return_pct);
    $("annual_return_label").textContent = Number(p.annual_return_pct).toFixed(2) + "%";

    setAdvisorOverrideEnabledUI();
    setMEREnabledUI();
    render();
  }

  // -----------------------------
  // Wire events
  // -----------------------------
  function wire() {
    // Slider config
    $("annual_return_slider").min = String(AR.min);
    $("annual_return_slider").max = String(AR.max);
    $("annual_return_slider").step = String(AR.step);

    // Presets
    $("preset-starting").addEventListener("click", () => applyPreset("starting"));
    $("preset-mid").addEventListener("click", () => applyPreset("mid"));
    $("preset-retire").addEventListener("click", () => applyPreset("retire"));

    // Inputs recalc
    ["starting_balance", "monthly_contribution", "horizon_years", "annual_return", "custom_advisor_fee", "mer_pct"].forEach((id) => {
      $(id).addEventListener("input", () => {
        if (id === "annual_return") syncSliderFromAnnualReturn();
        render();
      });
    });

    // Slider -> text
    $("annual_return_slider").addEventListener("input", () => {
      syncAnnualReturnFromSlider();
      render();
    });

    // Toggles
    $("use_default_fee").addEventListener("change", () => {
      setAdvisorOverrideEnabledUI();
      render();
    });

    $("include_mer").addEventListener("change", () => {
      setMEREnabledUI();
      render();
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  wire();

  // Seed initial defaults cleanly (important when page loads)
  if (!Number.isFinite(num($("annual_return").value))) $("annual_return").value = String(DEFAULTS.annual_return_pct);
  if (!Number.isFinite(num($("custom_advisor_fee").value))) $("custom_advisor_fee").value = String(DEFAULTS.advisor_fee_pct);

  $("include_mer").checked = true;
  if (!Number.isFinite(num($("mer_pct").value))) $("mer_pct").value = String(DEFAULTS.mer_pct);

  $("use_default_fee").checked = true;

  syncSliderFromAnnualReturn();
  setAdvisorOverrideEnabledUI();
  setMEREnabledUI();
  render();
})();
