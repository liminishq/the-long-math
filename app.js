// app.js — UI wiring for The Long Math (uses calculator.browser.js math)
(function () {
  "use strict";

  function req(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function roundTo(n, dp) {
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
  }

  function parseNumLoose(s) {
    if (s == null) return NaN;
    const cleaned = String(s).trim().replace(/,/g, "");
    if (cleaned === "") return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatCAD(n) {
    if (!Number.isFinite(n)) return "$–";
    const rounded = Math.round(n);
    return rounded.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function formatPct(n, dp = 2) {
    if (!Number.isFinite(n)) return "–";
    return roundTo(n, dp).toFixed(dp) + "%";
  }

  const el = {
    preset_starting: req("preset-starting"),
    preset_mid: req("preset-mid"),
    preset_retire: req("preset-retire"),

    starting_balance: req("starting_balance"),
    monthly_contribution: req("monthly_contribution"),
    horizon_years: req("horizon_years"),
    annual_return: req("annual_return"),

    annual_return_slider: req("annual_return_slider"),
    annual_return_label: req("annual_return_label"),

    use_default_fee: req("use_default_fee"),
    custom_advisor_fee: req("custom_advisor_fee"),
    include_mer: req("include_mer"),
    mer_pct: req("mer_pct"),

    out_total_cost: req("out_total_cost"),
    out_breakeven: req("out_breakeven"),
    out_with: req("out_with"),
    out_without: req("out_without"),
    out_fees: req("out_fees"),
    out_lost: req("out_lost"),
    out_meta: req("out_meta"),
  };

  const PRESETS = {
    starting: { starting_balance: 0, horizon_years: 25, monthly_contribution: 5000, annual_return_pct: 7.0 },
    mid:      { starting_balance: 1000000, horizon_years: 15, monthly_contribution: 5000, annual_return_pct: 7.0 },
    retire:   { starting_balance: 2000000, horizon_years: 5, monthly_contribution: 5000, annual_return_pct: 7.0 },
  };

  // Annual return slider limits (percent units)
  const AR = { min: 0, max: 15, step: 0.25 };

  const state = {
    starting_balance: 0,
    monthly_contribution: 5000,
    horizon_years: 25,
    annual_return_pct: 7.0,

    use_default_fee: true,
    custom_advisor_fee_pct: 1.0, // percent
    include_mer: true,
    mer_pct: 2.0, // percent

    draft_annual_return_text: null,
    draft_custom_fee_text: null,
    draft_mer_text: null,
  };

  function syncUIFromState() {
    if (document.activeElement !== el.starting_balance) el.starting_balance.value = String(Math.round(state.starting_balance));
    if (document.activeElement !== el.monthly_contribution) el.monthly_contribution.value = String(Math.round(state.monthly_contribution));
    if (document.activeElement !== el.horizon_years) el.horizon_years.value = String(Math.round(state.horizon_years));

    // Annual return textbox
    if (document.activeElement !== el.annual_return) {
      el.annual_return.value = state.draft_annual_return_text != null
        ? state.draft_annual_return_text
        : String(roundTo(state.annual_return_pct, 2));
      state.draft_annual_return_text = null;
    }

    // Slider config
    el.annual_return_slider.min = String(AR.min);
    el.annual_return_slider.max = String(AR.max);
    el.annual_return_slider.step = String(AR.step);

    if (document.activeElement !== el.annual_return_slider) {
      el.annual_return_slider.value = String(roundTo(state.annual_return_pct, 2));
    }

    el.annual_return_label.textContent = formatPct(state.annual_return_pct, 2);

    el.use_default_fee.checked = !!state.use_default_fee;
    el.include_mer.checked = !!state.include_mer;

    el.custom_advisor_fee.disabled = !!state.use_default_fee;
    if (document.activeElement !== el.custom_advisor_fee) {
      el.custom_advisor_fee.value =
        state.draft_custom_fee_text != null ? state.draft_custom_fee_text : String(roundTo(state.custom_advisor_fee_pct, 2));
      state.draft_custom_fee_text = null;
    }

    el.mer_pct.disabled = !state.include_mer;
    if (document.activeElement !== el.mer_pct) {
      el.mer_pct.value =
        state.draft_mer_text != null ? state.draft_mer_text : String(roundTo(state.mer_pct, 2));
      state.draft_mer_text = null;
    }
  }

  function compute() {
    if (typeof window.calculateLongMath !== "function") {
      throw new Error("calculator.browser.js did not load (calculateLongMath missing).");
    }

    return window.calculateLongMath({
      starting_balance: state.starting_balance,
      monthly_contribution: state.monthly_contribution,
      horizon_years: state.horizon_years,
      annual_return: state.annual_return_pct / 100,

      use_default_fee: state.use_default_fee,
      custom_advisor_fee_pct: state.custom_advisor_fee_pct,

      include_mer: state.include_mer,
      mer_pct: state.mer_pct,
    });
  }

  function render() {
    let out;
    try {
      out = compute();
    } catch (e) {
      el.out_meta.textContent = "Error: " + (e && e.message ? e.message : String(e));
      return;
    }

    el.out_with.textContent = formatCAD(out.ending_with_advisor);
    el.out_without.textContent = formatCAD(out.ending_without_advisor);
    el.out_fees.textContent = formatCAD(out.total_fees_paid);
    el.out_lost.textContent = formatCAD(out.lost_compounding);
    el.out_total_cost.textContent = formatCAD(out.total_cost);

    el.out_breakeven.textContent = out.break_even_capped
      ? (formatPct(out.break_even_annual_return_dec * 100, 2) + "+")
      : formatPct(out.break_even_annual_return_dec * 100, 2);

    el.out_meta.textContent = "Calculated using the assumptions shown above.";
  }

  function recalcAndRender() {
    syncUIFromState();
    render();
  }

  function applyPreset(which) {
    const p = PRESETS[which];
    if (!p) return;

    state.starting_balance = p.starting_balance;
    state.horizon_years = p.horizon_years;
    state.monthly_contribution = p.monthly_contribution;
    state.annual_return_pct = clamp(p.annual_return_pct, AR.min, AR.max);

    state.use_default_fee = true;
    state.include_mer = true;

    state.custom_advisor_fee_pct = 1.0;
    state.mer_pct = 2.0;

    state.draft_annual_return_text = null;
    state.draft_custom_fee_text = null;
    state.draft_mer_text = null;

    recalcAndRender();
  }

  function wireEvents() {
    el.preset_starting.addEventListener("click", () => applyPreset("starting"));
    el.preset_mid.addEventListener("click", () => applyPreset("mid"));
    el.preset_retire.addEventListener("click", () => applyPreset("retire"));

    el.starting_balance.addEventListener("input", () => {
      const n = parseNumLoose(el.starting_balance.value);
      if (Number.isFinite(n)) state.starting_balance = clamp(n, 0, 10000000);
      recalcAndRender();
    });

    el.monthly_contribution.addEventListener("input", () => {
      const n = parseNumLoose(el.monthly_contribution.value);
      if (Number.isFinite(n)) state.monthly_contribution = clamp(n, 0, 50000);
      recalcAndRender();
    });

    el.horizon_years.addEventListener("input", () => {
      const n = parseNumLoose(el.horizon_years.value);
      if (Number.isFinite(n)) state.horizon_years = clamp(n, 1, 50);
      recalcAndRender();
    });

    el.annual_return.addEventListener("input", () => {
      state.draft_annual_return_text = el.annual_return.value;
      const nPct = parseNumLoose(el.annual_return.value);
      if (Number.isFinite(nPct)) {
        state.annual_return_pct = clamp(nPct, AR.min, AR.max);
        el.annual_return_slider.value = String(roundTo(state.annual_return_pct, 2));
      }
      syncUIFromState();
      render();
    });

    el.annual_return.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.annual_return.value);
      state.annual_return_pct = Number.isFinite(nPct) ? clamp(nPct, AR.min, AR.max) : 7.0;
      state.draft_annual_return_text = null;
      recalcAndRender();
    });

    el.annual_return_slider.addEventListener("input", () => {
      const nPct = parseNumLoose(el.annual_return_slider.value);
      if (!Number.isFinite(nPct)) return;
      state.annual_return_pct = roundTo(clamp(nPct, AR.min, AR.max), 2);

      if (document.activeElement !== el.annual_return) {
        el.annual_return.value = String(roundTo(state.annual_return_pct, 2));
        state.draft_annual_return_text = null;
      }
      syncUIFromState();
      render();
    });

    el.use_default_fee.addEventListener("change", () => {
      state.use_default_fee = el.use_default_fee.checked;
      recalcAndRender();
    });

    el.custom_advisor_fee.addEventListener("input", () => {
      state.draft_custom_fee_text = el.custom_advisor_fee.value;
      const nPct = parseNumLoose(el.custom_advisor_fee.value);
      if (Number.isFinite(nPct)) state.custom_advisor_fee_pct = clamp(nPct, 0, 10);
      syncUIFromState();
      render();
    });

    el.custom_advisor_fee.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.custom_advisor_fee.value);
      state.custom_advisor_fee_pct = Number.isFinite(nPct) ? clamp(nPct, 0, 10) : 1.0;
      state.draft_custom_fee_text = null;
      recalcAndRender();
    });

    el.include_mer.addEventListener("change", () => {
      state.include_mer = el.include_mer.checked;
      recalcAndRender();
    });

    el.mer_pct.addEventListener("input", () => {
      state.draft_mer_text = el.mer_pct.value;
      const nPct = parseNumLoose(el.mer_pct.value);
      if (Number.isFinite(nPct)) state.mer_pct = clamp(nPct, 0, 10);
      syncUIFromState();
      render();
    });

    el.mer_pct.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.mer_pct.value);
      state.mer_pct = Number.isFinite(nPct) ? clamp(nPct, 0, 10) : 2.0;
      state.draft_mer_text = null;
      recalcAndRender();
    });
  }

  // Boot
  applyPreset("starting");
  wireEvents();
  recalcAndRender();
})();
