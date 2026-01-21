// app.js — Calculator UI wiring (no framework)
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
    annual_return_warning: req("annual_return_warning"),

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
    mid: { starting_balance: 1000000, horizon_years: 15, monthly_contribution: 5000, annual_return_pct: 7.0 },
    retire: { starting_balance: 2000000, horizon_years: 5, monthly_contribution: 5000, annual_return_pct: 7.0 },
  };

  // Slider bounds in percent units
  const AR = { min: 0, max: 15, step: 0.25 };

  const state = {
    starting_balance: 0,
    monthly_contribution: 5000,
    horizon_years: 25,
    annual_return_dec: 0.07,

    use_default_fee: true,
    custom_advisor_fee_pct: 1.0,
    include_mer: true,
    mer_pct: 2.0,

    draft_annual_return_text: null,
    draft_custom_fee_text: null,
    draft_mer_text: null,
  };

  function syncUIFromState() {
    if (document.activeElement !== el.starting_balance) el.starting_balance.value = String(Math.round(state.starting_balance));
    if (document.activeElement !== el.monthly_contribution) el.monthly_contribution.value = String(Math.round(state.monthly_contribution));
    if (document.activeElement !== el.horizon_years) el.horizon_years.value = String(Math.round(state.horizon_years));

    // Annual return textbox (percent)
    if (document.activeElement !== el.annual_return) {
      el.annual_return.value = state.draft_annual_return_text != null
        ? state.draft_annual_return_text
        : String(roundTo(state.annual_return_dec * 100, 2));
      state.draft_annual_return_text = null;
    }

    el.annual_return_slider.min = String(AR.min);
    el.annual_return_slider.max = String(AR.max);
    el.annual_return_slider.step = String(AR.step);

    if (document.activeElement !== el.annual_return_slider) {
      el.annual_return_slider.value = String(roundTo(clamp(state.annual_return_dec * 100, AR.min, AR.max), 2));
    }

    el.annual_return_label.textContent = formatPct(state.annual_return_dec * 100, 2);

    // Warning > 10%
    el.annual_return_warning.style.display = (state.annual_return_dec * 100 > 10) ? "block" : "none";

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

  function computeAndRender() {
    syncUIFromState();

    let out;
    try {
      out = window.calculateLongMath({
        starting_balance: state.starting_balance,
        monthly_contribution: state.monthly_contribution,
        horizon_years: state.horizon_years,
        annual_return: state.annual_return_dec,
        use_default_fee: state.use_default_fee,
        custom_advisor_fee_pct: state.custom_advisor_fee_pct,
        include_mer: state.include_mer,
        mer_pct: state.mer_pct,
      });
    } catch (e) {
      el.out_meta.textContent = "Error: " + (e && e.message ? e.message : String(e));
      return;
    }

    el.out_with.textContent = formatCAD(out.ending_with_advisor);
    el.out_without.textContent = formatCAD(out.ending_without_advisor);
    el.out_fees.textContent = formatCAD(out.total_fees_paid);
    el.out_lost.textContent = formatCAD(out.lost_compounding);
    el.out_total_cost.textContent = formatCAD(out.total_cost);

    if (out.break_even_capped) {
      el.out_breakeven.textContent = "≥ " + formatPct(out.break_even_annual_return_dec * 100, 2);
    } else {
      el.out_breakeven.textContent = formatPct(out.break_even_annual_return_dec * 100, 2);
    }

    el.out_meta.textContent = "Calculated using the assumptions shown above.";
  }

  function applyPreset(which) {
    const p = PRESETS[which];
    if (!p) return;

    state.starting_balance = p.starting_balance;
    state.horizon_years = p.horizon_years;
    state.monthly_contribution = p.monthly_contribution;
    state.annual_return_dec = p.annual_return_pct / 100;

    state.use_default_fee = true;
    state.include_mer = true;
    state.custom_advisor_fee_pct = 1.0;
    state.mer_pct = 2.0;

    state.draft_annual_return_text = null;
    state.draft_custom_fee_text = null;
    state.draft_mer_text = null;

    computeAndRender();
  }

  function wireEvents() {
    el.preset_starting.addEventListener("click", () => applyPreset("starting"));
    el.preset_mid.addEventListener("click", () => applyPreset("mid"));
    el.preset_retire.addEventListener("click", () => applyPreset("retire"));

    el.starting_balance.addEventListener("input", () => {
      const n = parseNumLoose(el.starting_balance.value);
      if (Number.isFinite(n)) state.starting_balance = clamp(n, 0, 10000000);
      computeAndRender();
    });

    el.monthly_contribution.addEventListener("input", () => {
      const n = parseNumLoose(el.monthly_contribution.value);
      if (Number.isFinite(n)) state.monthly_contribution = clamp(n, 0, 50000);
      computeAndRender();
    });

    el.horizon_years.addEventListener("input", () => {
      const n = parseNumLoose(el.horizon_years.value);
      if (Number.isFinite(n)) state.horizon_years = clamp(Math.round(n), 1, 50);
      computeAndRender();
    });

    // Annual return textbox: allow any number; slider stays 0–15 for convenience
    el.annual_return.addEventListener("input", () => {
      state.draft_annual_return_text = el.annual_return.value;
      const nPct = parseNumLoose(el.annual_return.value);
      if (Number.isFinite(nPct)) {
        state.annual_return_dec = nPct / 100;
        // keep slider synced within its bounds
        el.annual_return_slider.value = String(roundTo(clamp(nPct, AR.min, AR.max), 2));
      }
      computeAndRender();
    });

    el.annual_return.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.annual_return.value);
      if (!Number.isFinite(nPct)) state.annual_return_dec = 0.07;
      else state.annual_return_dec = nPct / 100;
      state.draft_annual_return_text = null;
      computeAndRender();
    });

    el.annual_return_slider.addEventListener("input", () => {
      const nPct = parseNumLoose(el.annual_return_slider.value);
      if (!Number.isFinite(nPct)) return;
      const snapped = roundTo(clamp(nPct, AR.min, AR.max), 2);
      state.annual_return_dec = snapped / 100;

      if (document.activeElement !== el.annual_return) {
        el.annual_return.value = String(roundTo(snapped, 2));
        state.draft_annual_return_text = null;
      }
      computeAndRender();
    });

    el.use_default_fee.addEventListener("change", () => {
      state.use_default_fee = el.use_default_fee.checked;
      computeAndRender();
    });

    el.custom_advisor_fee.addEventListener("input", () => {
      state.draft_custom_fee_text = el.custom_advisor_fee.value;
      const nPct = parseNumLoose(el.custom_advisor_fee.value);
      if (Number.isFinite(nPct)) state.custom_advisor_fee_pct = clamp(nPct, 0, 15);
      computeAndRender();
    });

    el.custom_advisor_fee.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.custom_advisor_fee.value);
      state.custom_advisor_fee_pct = Number.isFinite(nPct) ? clamp(nPct, 0, 15) : 1.0;
      state.draft_custom_fee_text = null;
      computeAndRender();
    });

    el.include_mer.addEventListener("change", () => {
      state.include_mer = el.include_mer.checked;
      computeAndRender();
    });

    el.mer_pct.addEventListener("input", () => {
      state.draft_mer_text = el.mer_pct.value;
      const nPct = parseNumLoose(el.mer_pct.value);
      if (Number.isFinite(nPct)) state.mer_pct = clamp(nPct, 0, 15);
      computeAndRender();
    });

    el.mer_pct.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.mer_pct.value);
      state.mer_pct = Number.isFinite(nPct) ? clamp(nPct, 0, 15) : 2.0;
      state.draft_mer_text = null;
      computeAndRender();
    });
  }

  // Boot
  el.annual_return_slider.min = String(AR.min);
  el.annual_return_slider.max = String(AR.max);
  el.annual_return_slider.step = String(AR.step);

  wireEvents();
  applyPreset("starting");
})();
