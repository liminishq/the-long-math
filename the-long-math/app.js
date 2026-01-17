// app.js — UI + simulation for The Long Math (no framework)
(function () {
  "use strict";

  console.log("APP.JS LOADED ✅");

  // --------------------------
  // Helpers
  // --------------------------
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

  // --------------------------
  // DOM refs
  // --------------------------
  const el = {
    // presets
    preset_starting: req("preset-starting"),
    preset_mid: req("preset-mid"),
    preset_retire: req("preset-retire"),

    // core inputs
    starting_balance: req("starting_balance"),
    monthly_contribution: req("monthly_contribution"),
    horizon_years: req("horizon_years"),
    annual_return: req("annual_return"),

    // annual return slider
    annual_return_slider: req("annual_return_slider"),
    annual_return_label: req("annual_return_label"),

    // fee/MER toggles
    use_default_fee: req("use_default_fee"),
    custom_advisor_fee: req("custom_advisor_fee"),
    include_mer: req("include_mer"),
    mer_pct: req("mer_pct"),

    // outputs
    out_total_cost: req("out_total_cost"),
    out_breakeven: req("out_breakeven"),
    out_with: req("out_with"),
    out_without: req("out_without"),
    out_fees: req("out_fees"),
    out_lost: req("out_lost"),
    out_meta: req("out_meta"),
  };

  // --------------------------
  // Inject warning line (if not present)
  // --------------------------
  const warnId = "annual_return_warning";
  let annualWarn = document.getElementById(warnId);

  if (!annualWarn) {
    annualWarn = document.createElement("div");
    annualWarn.id = warnId;
    annualWarn.style.margin = "-2px 0 10px";
    annualWarn.style.fontSize = "12px";
    annualWarn.style.color = "var(--accent)";
    annualWarn.style.display = "none";
    annualWarn.textContent =
      "*High return assumption (>10%). Consider reliability over long time horizons.";

    // Place it right under the annual return text box row
    // (annual_return input sits inside the row; we'll insert after that row)
    const row = el.annual_return.closest(".row");
    if (row && row.parentNode) row.parentNode.insertBefore(annualWarn, row.nextSibling);
  }

  function showAnnualReturnWarning(show) {
    annualWarn.style.display = show ? "block" : "none";
  }

  // --------------------------
  // Defaults / Presets
  // --------------------------
  const PRESETS = {
    starting: { starting_balance: 0, horizon_years: 25, monthly_contribution: 5000, annual_return_pct: 7.0 },
    mid: { starting_balance: 1000000, horizon_years: 15, monthly_contribution: 5000, annual_return_pct: 7.0 },
    retire: { starting_balance: 2000000, horizon_years: 5, monthly_contribution: 5000, annual_return_pct: 7.0 },
  };

  // Annual return limits (percent units)
  const AR = { min: 0, max: 15, step: 0.25 };

  // Default fee schedule (AUM tier -> rate)
  // Uses the table shown on-page: not blended, applies the tier rate based on current AUM.
  const DEFAULT_FEE_SCHEDULE = [
    { upto: 250000, rate: 0.02 },
    { upto: 500000, rate: 0.0175 },
    { upto: 1000000, rate: 0.015 },
    { upto: 2000000, rate: 0.0125 },
    { upto: Infinity, rate: 0.01 },
  ];

  function defaultAdvisorFeeRateForAUM(aum) {
    for (const tier of DEFAULT_FEE_SCHEDULE) {
      if (aum <= tier.upto) return tier.rate;
    }
    return 0.01;
  }

  // --------------------------
  // State
  // --------------------------
  const state = {
    starting_balance: 0,
    monthly_contribution: 5000,
    horizon_years: 25,
    annual_return: 0.07, // decimal

    use_default_fee: true,
    custom_advisor_fee: 0.01, // decimal
    include_mer: true,
    mer_pct: 0.02, // decimal

    // Draft strings for text boxes (so user can type freely)
    draft_annual_return_text: null,
    draft_custom_fee_text: null,
    draft_mer_text: null,
  };

  // --------------------------
  // UI sync
  // --------------------------
  function syncUIFromState() {
    // numbers
    if (document.activeElement !== el.starting_balance) el.starting_balance.value = String(Math.round(state.starting_balance));
    if (document.activeElement !== el.monthly_contribution) el.monthly_contribution.value = String(Math.round(state.monthly_contribution));
    if (document.activeElement !== el.horizon_years) el.horizon_years.value = String(Math.round(state.horizon_years));

    // annual return textbox (percent)
    if (document.activeElement !== el.annual_return) {
      el.annual_return.value = state.draft_annual_return_text != null
        ? state.draft_annual_return_text
        : String(roundTo(state.annual_return * 100, 2));
      state.draft_annual_return_text = null;
    }

    // slider config
    el.annual_return_slider.min = String(AR.min);
    el.annual_return_slider.max = String(AR.max);
    el.annual_return_slider.step = String(AR.step);

    // slider value in percent units
    if (document.activeElement !== el.annual_return_slider) {
      el.annual_return_slider.value = String(roundTo(state.annual_return * 100, 2));
    }

    // slider label
    el.annual_return_label.textContent = formatPct(state.annual_return * 100, 2);

    // warning if > 10%
    showAnnualReturnWarning(state.annual_return * 100 > 10.0);

    // checkboxes
    el.use_default_fee.checked = !!state.use_default_fee;
    el.include_mer.checked = !!state.include_mer;

    // custom fee textbox (percent)
    el.custom_advisor_fee.disabled = !!state.use_default_fee;
    if (document.activeElement !== el.custom_advisor_fee) {
      el.custom_advisor_fee.value =
        state.draft_custom_fee_text != null ? state.draft_custom_fee_text : String(roundTo(state.custom_advisor_fee * 100, 2));
      state.draft_custom_fee_text = null;
    }

    // mer textbox (percent)
    el.mer_pct.disabled = !state.include_mer;
    if (document.activeElement !== el.mer_pct) {
      el.mer_pct.value =
        state.draft_mer_text != null ? state.draft_mer_text : String(roundTo(state.mer_pct * 100, 2));
      state.draft_mer_text = null;
    }
  }

  // --------------------------
  // Core math
  // --------------------------
  function simulateEndingValue(opts) {
    // opts:
    // - starting_balance, monthly_contribution, horizon_years, annual_return (decimal)
    // - feeMode: "none" | "default" | "custom"
    // - customFee (decimal) if feeMode custom
    // - includeMER (bool)
    // - merPct (decimal)
    const starting = Math.max(0, opts.starting_balance);
    const contrib = Math.max(0, opts.monthly_contribution);
    const years = clamp(Math.round(opts.horizon_years), 1, 50);
    const months = years * 12;

    // Annual return range: 0–15% (per your decision)
    const ar = clamp(opts.annual_return, 0, 0.15);

    const monthlyGrowth = Math.pow(1 + ar, 1 / 12); // 0% => 1.0

    let balance = starting;
    let feesPaid = 0;

    for (let m = 1; m <= months; m++) {
      // Contribute at start of month
      balance += contrib;

      // Grow for the month
      balance *= monthlyGrowth;

      // Fees at end of month (applied to AUM)
      let feeRateAnnual = 0;

      if (opts.feeMode === "default") {
        feeRateAnnual += defaultAdvisorFeeRateForAUM(balance);
      } else if (opts.feeMode === "custom") {
        feeRateAnnual += clamp(opts.customFee, 0, 0.15);
      }

      if (opts.includeMER) {
        feeRateAnnual += clamp(opts.merPct, 0, 0.15);
      }

      const feeMonthly = balance * (feeRateAnnual / 12);
      if (feeMonthly > 0) {
        balance -= feeMonthly;
        feesPaid += feeMonthly;
      }
    }

    return { ending: balance, feesPaid };
  }

  function computeAll() {
    // Without advisor: no advisor fees, no MER (matches your framing/examples)
    const base = simulateEndingValue({
      starting_balance: state.starting_balance,
      monthly_contribution: state.monthly_contribution,
      horizon_years: state.horizon_years,
      annual_return: state.annual_return,
      feeMode: "none",
      includeMER: false,
      merPct: 0,
      customFee: 0,
    });

    // With advisor: advisor fee schedule/custom + optional MER
    const withA = simulateEndingValue({
      starting_balance: state.starting_balance,
      monthly_contribution: state.monthly_contribution,
      horizon_years: state.horizon_years,
      annual_return: state.annual_return,
      feeMode: state.use_default_fee ? "default" : "custom",
      customFee: state.custom_advisor_fee,
      includeMER: state.include_mer,
      merPct: state.mer_pct,
    });

    const gap = base.ending - withA.ending; // total calculated cost (can’t go negative with fees, but guard anyway)
    const totalCost = Math.max(0, gap);

    // Lost compounding = total gap minus fees actually paid
    // (can be 0 when return is 0)
    const lost = Math.max(0, totalCost - withA.feesPaid);

    // Break-even advisor performance:
    // find annual return needed (with the chosen fee model) to match base.ending
    const target = base.ending;

    const breakeven = solveBreakevenReturn({
      targetEnding: target,
      starting_balance: state.starting_balance,
      monthly_contribution: state.monthly_contribution,
      horizon_years: state.horizon_years,
      feeMode: state.use_default_fee ? "default" : "custom",
      customFee: state.custom_advisor_fee,
      includeMER: state.include_mer,
      merPct: state.mer_pct,
    });

    return {
      endingWithout: base.ending,
      endingWith: withA.ending,
      feesPaid: withA.feesPaid,
      lostCompounding: lost,
      totalCost,
      breakevenReturn: breakeven, // decimal (e.g. 0.1085)
    };
  }

  function solveBreakevenReturn(params) {
    // We’ll allow searching above 15% so the result is still meaningful,
    // even though the UI input range is capped at 15%.
    const loMin = 0.0;
    const hiMax = 0.50; // 50% cap (more than enough for this use)
    let lo = loMin;
    let hi = hiMax;

    // If even 50% can't hit, return hi (still informative)
    const hiSim = simulateEndingValue({
      starting_balance: params.starting_balance,
      monthly_contribution: params.monthly_contribution,
      horizon_years: params.horizon_years,
      annual_return: hi,
      feeMode: params.feeMode,
      customFee: params.customFee,
      includeMER: params.includeMER,
      merPct: params.merPct,
    }).ending;

    if (hiSim < params.targetEnding) return hi;

    // Binary search
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const midSim = simulateEndingValue({
        starting_balance: params.starting_balance,
        monthly_contribution: params.monthly_contribution,
        horizon_years: params.horizon_years,
        annual_return: mid,
        feeMode: params.feeMode,
        customFee: params.customFee,
        includeMER: params.includeMER,
        merPct: params.merPct,
      }).ending;

      if (midSim >= params.targetEnding) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  // --------------------------
  // Render outputs
  // --------------------------
  function render() {
    let out;
    try {
      out = computeAll();
    } catch (e) {
      console.error(e);
      el.out_meta.textContent = "Error: " + (e && e.message ? e.message : String(e));
      return;
    }

    el.out_with.textContent = formatCAD(out.endingWith);
    el.out_without.textContent = formatCAD(out.endingWithout);
    el.out_fees.textContent = formatCAD(out.feesPaid);
    el.out_lost.textContent = formatCAD(out.lostCompounding);
    el.out_total_cost.textContent = formatCAD(out.totalCost);

    el.out_breakeven.textContent = formatPct(out.breakevenReturn * 100, 2);

    el.out_meta.textContent = "Calculated using the assumptions shown above.";
  }

  function recalcAndRender() {
    syncUIFromState();
    render();
  }

  // --------------------------
  // Event wiring
  // --------------------------
  function wireEvents() {
    // Presets
    el.preset_starting.addEventListener("click", () => applyPreset("starting"));
    el.preset_mid.addEventListener("click", () => applyPreset("mid"));
    el.preset_retire.addEventListener("click", () => applyPreset("retire"));

    // Whole-number inputs
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

    // Annual return textbox (percent)
    el.annual_return.addEventListener("input", () => {
      // Let them type freely; only update state when it parses
      state.draft_annual_return_text = el.annual_return.value;

      const nPct = parseNumLoose(el.annual_return.value);
      if (Number.isFinite(nPct)) {
        const clampedPct = clamp(nPct, AR.min, AR.max);
        state.annual_return = clampedPct / 100;
        // Keep slider synced even during typing (only if parseable)
        el.annual_return_slider.value = String(roundTo(clampedPct, 2));
      }
      syncUIFromState();
      render();
    });

    el.annual_return.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.annual_return.value);
      const clampedPct = clamp(nPct, AR.min, AR.max);
      state.annual_return = (Number.isFinite(nPct) ? clampedPct : 7.0) / 100; // fallback to 7 if blank/invalid
      state.draft_annual_return_text = null;
      recalcAndRender();
    });

    // Annual return slider (percent) — Choice 1: keep slider only here
    el.annual_return_slider.addEventListener("input", () => {
      const nPct = parseNumLoose(el.annual_return_slider.value);
      if (!Number.isFinite(nPct)) return;
      // step 0.25 already, but keep it clean
      const snapped = roundTo(clamp(nPct, AR.min, AR.max), 2);
      state.annual_return = snapped / 100;

      // Textbox should reflect slider (unless user is actively typing in textbox)
      if (document.activeElement !== el.annual_return) {
        el.annual_return.value = String(roundTo(snapped, 2));
        state.draft_annual_return_text = null;
      }

      syncUIFromState();
      render();
    });

    // Advisor fee schedule toggle
    el.use_default_fee.addEventListener("change", () => {
      state.use_default_fee = el.use_default_fee.checked;
      recalcAndRender();
    });

    // Custom advisor fee textbox (percent)
    el.custom_advisor_fee.addEventListener("input", () => {
      state.draft_custom_fee_text = el.custom_advisor_fee.value;
      const nPct = parseNumLoose(el.custom_advisor_fee.value);
      if (Number.isFinite(nPct)) state.custom_advisor_fee = clamp(nPct, 0, 15) / 100;
      syncUIFromState();
      render();
    });
    el.custom_advisor_fee.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.custom_advisor_fee.value);
      if (!Number.isFinite(nPct)) state.custom_advisor_fee = 0.01;
      else state.custom_advisor_fee = clamp(nPct, 0, 15) / 100;
      state.draft_custom_fee_text = null;
      recalcAndRender();
    });

    // Include MER toggle
    el.include_mer.addEventListener("change", () => {
      state.include_mer = el.include_mer.checked;
      recalcAndRender();
    });

    // MER textbox (percent)
    el.mer_pct.addEventListener("input", () => {
      state.draft_mer_text = el.mer_pct.value;
      const nPct = parseNumLoose(el.mer_pct.value);
      if (Number.isFinite(nPct)) state.mer_pct = clamp(nPct, 0, 15) / 100;
      syncUIFromState();
      render();
    });
    el.mer_pct.addEventListener("blur", () => {
      const nPct = parseNumLoose(el.mer_pct.value);
      if (!Number.isFinite(nPct)) state.mer_pct = 0.02;
      else state.mer_pct = clamp(nPct, 0, 15) / 100;
      state.draft_mer_text = null;
      recalcAndRender();
    });
  }

  function applyPreset(which) {
    const p = PRESETS[which];
    if (!p) return;

    state.starting_balance = p.starting_balance;
    state.horizon_years = p.horizon_years;
    state.monthly_contribution = p.monthly_contribution;
    state.annual_return = clamp(p.annual_return_pct, AR.min, AR.max) / 100;

    // Keep your prior defaults
    state.use_default_fee = true;
    state.include_mer = true;

    // Default text defaults (shown when not using default schedule / for MER box)
    state.custom_advisor_fee = 0.01; // 1.0%
    state.mer_pct = 0.02; // 2.0%

    state.draft_annual_return_text = null;
    state.draft_custom_fee_text = null;
    state.draft_mer_text = null;

    recalcAndRender();
  }

  // --------------------------
  // Boot
  // --------------------------
  // Starting assumptions (match your preference)
  applyPreset("starting");

  // Ensure slider step and bounds exactly as requested
  el.annual_return_slider.min = String(AR.min);
  el.annual_return_slider.max = String(AR.max);
  el.annual_return_slider.step = String(AR.step);

  wireEvents();
  recalcAndRender();
})();
