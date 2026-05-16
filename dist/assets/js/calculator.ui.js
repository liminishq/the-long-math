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
    if (window.TLM && window.TLM.format) return window.TLM.format.currency(n, window.TLM.i18n && window.TLM.i18n.getLang && window.TLM.i18n.getLang());
    if (!Number.isFinite(n)) return "$–";
    return Math.round(n).toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
  }

  function fmtPct(dec) {
    if (window.TLM && window.TLM.format) return window.TLM.format.percent(dec, { decimals: 2 }, window.TLM.i18n && window.TLM.i18n.getLang && window.TLM.i18n.getLang());
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
  var latestSharePayload = null;
  var hasUserInteracted = false;
  var sharedScenarioLoaded = false;

  function setShareStatus(message, isError) {
    var statusEl = document.getElementById("result_share_status");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.style.color = isError ? "#e7b4b4" : "";
  }

  function markShareReady() {
    if (hasUserInteracted) return;
    hasUserInteracted = true;
    var shareBlock = document.querySelector(".result-share-block");
    if (shareBlock) shareBlock.classList.add("is-ready-to-share");
  }

  function setSharedScenarioBanner(visible) {
    var banner = document.getElementById("shared_scenario_banner");
    if (!banner) return;
    banner.hidden = !visible;
  }

  function parseBoolParam(raw) {
    if (raw == null) return null;
    var v = String(raw).trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") return true;
    if (v === "0" || v === "false" || v === "no") return false;
    return null;
  }

  function applySharedScenarioFromQuery() {
    var params = new URLSearchParams(window.location.search || "");
    if (!params.toString()) return false;

    var hasSupportedParam = false;

    var initial = num(params.get("initial"));
    if (Number.isFinite(initial)) {
      $("starting_balance").value = String(clamp(initial, 0, 10000000));
      hasSupportedParam = true;
    }

    var monthly = num(params.get("monthly"));
    var annual = num(params.get("annual"));
    if (Number.isFinite(monthly)) {
      $("monthly_contribution").value = String(clamp(monthly, 0, 50000));
      hasSupportedParam = true;
    } else if (Number.isFinite(annual)) {
      $("monthly_contribution").value = String(clamp(annual / 12, 0, 50000));
      hasSupportedParam = true;
    }

    var years = num(params.get("years"));
    if (Number.isFinite(years)) {
      $("horizon_years").value = String(clamp(years, 1, 50));
      hasSupportedParam = true;
    }

    var returnPct = num(params.get("return"));
    if (Number.isFinite(returnPct)) {
      $("annual_return").value = String(clamp(returnPct, AR.min, AR.max));
      hasSupportedParam = true;
    }

    var useDefaultParam = parseBoolParam(params.get("useDefaultFee"));
    var feePct = num(params.get("fee"));
    if (useDefaultParam !== null) {
      $("use_default_fee").checked = useDefaultParam;
      hasSupportedParam = true;
    }
    if (Number.isFinite(feePct)) {
      $("custom_advisor_fee").value = String(clamp(feePct, 0, 15));
      if (useDefaultParam === null) $("use_default_fee").checked = false;
      hasSupportedParam = true;
    }

    var includeMerParam = parseBoolParam(params.get("includeMer"));
    var merPct = num(params.get("mer"));
    if (includeMerParam !== null) {
      $("include_mer").checked = includeMerParam;
      hasSupportedParam = true;
    }
    if (Number.isFinite(merPct)) {
      $("mer_pct").value = String(clamp(merPct, 0, 15));
      if (includeMerParam === null) $("include_mer").checked = true;
      hasSupportedParam = true;
    }

    if (!hasSupportedParam) return false;

    sharedScenarioLoaded = true;
    setSharedScenarioBanner(true);
    markShareReady();
    if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
      window.TLM.shareCard.track("calculator_shared_scenario_loaded", { calculator_name: "advisor-fee" });
    }
    return true;
  }

  function buildSharePayload(result, inputs) {
    if (!result || !window.TLM || !window.TLM.shareCard) return null;

    var horizonYears = Math.round(clamp(num($("horizon_years").value), 1, 50));
    var totalCost = Number(result.total_calculated_cost);
    if (!window.TLM.shareCard.isFiniteNumber(totalCost)) return null;

    var scenario = {
      initial: Math.round(inputs.starting_balance),
      monthly: Math.round(inputs.monthly_contribution),
      annual: Math.round(inputs.monthly_contribution * 12),
      years: Math.round(inputs.horizon_years),
      return: Number((inputs.annual_return * 100).toFixed(2)),
      useDefaultFee: inputs.use_default_fee ? 1 : 0,
      fee: Number(inputs.custom_advisor_fee_pct.toFixed(2)),
      includeMer: inputs.include_mer ? 1 : 0,
      mer: Number(inputs.mer_pct.toFixed(2)),
    };

    var shareUrl = window.TLM.shareCard.buildResultUrl(window.location.href, scenario);

    return {
      calculatorName: "advisor-fee",
      title: "The Long Math calculator result",
      headline: "Projected cost of fees and lost compounding",
      mainValue: fmtCAD(totalCost),
      subline: "Over a " + horizonYears + "-year investing horizon",
      contextLine: "Based on user inputs",
      footer: "Run your own numbers at TheLongMath.com",
      shareText: "Estimated fee drag over " + horizonYears + " years: " + fmtCAD(totalCost) + ". Run your own numbers:",
      url: shareUrl,
    };
  }

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
      const errEl = document.getElementById("advisor_calc_engine_error");
      const msg =
        window.TLM && window.TLM.i18n && window.TLM.i18n.t
          ? window.TLM.i18n.t("calculators.advisorFee.errorNoEngine")
          : "Error: calculateLongMath(...) not found.";
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      }
      return;
    }

    const errBanner = document.getElementById("advisor_calc_engine_error");
    if (errBanner) errBanner.hidden = true;

    const result = window.calculateLongMath(inp);

    $("out_with").textContent = fmtCAD(result.ending_with_advisor);
    $("out_without").textContent = fmtCAD(result.ending_without_advisor);

    $("out_fees").textContent = fmtCAD(result.fees_paid);
    $("out_lost").textContent = fmtCAD(result.lost_compounding);
    $("out_total_cost").textContent = fmtCAD(result.total_calculated_cost);

    $("out_breakeven").textContent = fmtPct(result.break_even_return);

    latestSharePayload = buildSharePayload(result, inp);
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
    $("annual_return_label").textContent = (window.TLM && window.TLM.format) ? window.TLM.format.percent(clamped / 100, { decimals: 2 }, window.TLM.i18n && window.TLM.i18n.getLang && window.TLM.i18n.getLang()) : clamped.toFixed(2) + "%";
  }

  function syncAnnualReturnFromSlider() {
    const n = num($("annual_return_slider").value);
    if (!Number.isFinite(n)) return;
    const clamped = clamp(n, AR.min, AR.max);
    $("annual_return").value = String(clamped);
    $("annual_return_label").textContent = (window.TLM && window.TLM.format) ? window.TLM.format.percent(clamped / 100, { decimals: 2 }, window.TLM.i18n && window.TLM.i18n.getLang && window.TLM.i18n.getLang()) : clamped.toFixed(2) + "%";
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
    $("annual_return_label").textContent = (window.TLM && window.TLM.format) ? window.TLM.format.percent(Number(p.annual_return_pct) / 100, { decimals: 2 }, window.TLM.i18n && window.TLM.i18n.getLang && window.TLM.i18n.getLang()) : Number(p.annual_return_pct).toFixed(2) + "%";

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
    $("preset-starting").addEventListener("click", () => {
      markShareReady();
      applyPreset("starting");
    });
    $("preset-mid").addEventListener("click", () => {
      markShareReady();
      applyPreset("mid");
    });
    $("preset-retire").addEventListener("click", () => {
      markShareReady();
      applyPreset("retire");
    });

    // Inputs recalc
    ["starting_balance", "monthly_contribution", "horizon_years", "annual_return", "custom_advisor_fee", "mer_pct"].forEach((id) => {
      $(id).addEventListener("input", () => {
        markShareReady();
        if (id === "annual_return") syncSliderFromAnnualReturn();
        render();
      });
    });

    // Slider -> text
    $("annual_return_slider").addEventListener("input", () => {
      markShareReady();
      syncAnnualReturnFromSlider();
      render();
    });

    // Toggles
    $("use_default_fee").addEventListener("change", () => {
      markShareReady();
      setAdvisorOverrideEnabledUI();
      render();
    });

    $("include_mer").addEventListener("change", () => {
      markShareReady();
      setMEREnabledUI();
      render();
    });

    var shareBtn = document.getElementById("share_result_btn");
    var downloadBtn = document.getElementById("download_result_btn");
    var copyBtn = document.getElementById("copy_result_link_btn");

    if (shareBtn && downloadBtn && copyBtn && window.TLM && window.TLM.shareCard) {
      shareBtn.addEventListener("click", async function () {
        if (!latestSharePayload) return;
        setShareStatus("Preparing image...");
        window.TLM.shareCard.track("calculator_result_share_clicked", { calculator_name: latestSharePayload.calculatorName });
        try {
          var result = await window.TLM.shareCard.shareResultCard(latestSharePayload);
          if (result && result.mode === "download-and-copy-fallback") {
            if (result.copied) {
              setShareStatus("Shared via fallback: calculation image opened/saved and scenario link copied.");
            } else {
              setShareStatus("Calculation image opened/saved. Copy shareable link manually if needed.");
            }
          } else if (result && result.mode === "native-share-link") {
            setShareStatus("Share dialog opened with result summary and scenario link.");
          } else {
            setShareStatus("Share dialog opened with image, summary, and scenario link.");
          }
        } catch (_err) {
          setShareStatus("Share cancelled or unavailable. Try Save this calculation instead.", true);
        }
      });

      downloadBtn.addEventListener("click", async function () {
        if (!latestSharePayload) return;
        setShareStatus("Preparing image...");
        try {
          await window.TLM.shareCard.downloadResultCard(latestSharePayload);
          setShareStatus("Calculation image saved.");
        } catch (_err) {
          setShareStatus("Could not prepare image. Please try again.", true);
        }
      });

      copyBtn.addEventListener("click", async function () {
        if (!latestSharePayload) return;
        try {
          await window.TLM.shareCard.copyResultLink(latestSharePayload);
          setShareStatus("Shareable link copied.");
        } catch (_err) {
          setShareStatus("Could not copy link on this browser.", true);
        }
      });
    }
  }

  // -----------------------------
  // Boot
  // -----------------------------
  wire();

  var loadedFromSharedUrl = applySharedScenarioFromQuery();

  if (!loadedFromSharedUrl) {
    applyPreset("mid");
  } else {
    if (!Number.isFinite(num($("annual_return").value))) $("annual_return").value = String(DEFAULTS.annual_return_pct);
    if (!Number.isFinite(num($("custom_advisor_fee").value))) $("custom_advisor_fee").value = String(DEFAULTS.advisor_fee_pct);
    if (!Number.isFinite(num($("mer_pct").value))) $("mer_pct").value = String(DEFAULTS.mer_pct);
    syncSliderFromAnnualReturn();
    setAdvisorOverrideEnabledUI();
    setMEREnabledUI();
    render();
  }
})();
