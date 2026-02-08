// ui.js
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
    if (dec == null) return "–";
    if (!Number.isFinite(dec)) return "–";
    return (dec * 100).toFixed(2) + "%";
  }

  // -----------------------------
  // Defaults
  // -----------------------------
  const DEFAULTS = {
    starting_balance: 250000,
    monthly_contribution: 1000,
    horizon_years: 30,
    annual_return_pct: 7,
    flat_fee: 2500,
    hourly_rate: 250,
    hours_per_year: 6,
    aum_fee_pct: 1.0,
    fee_increase_pct: 2.0
  };

  // Slider config (percent units)
  const AR = { min: 0, max: 15, step: 0.25 };

  // -----------------------------
  // Parse percentage helper
  // -----------------------------
  function parsePercent(str) {
    if (str == null || str === "") return NaN;
    const s = String(str).trim().replace(/,/g, "");
    if (s === "") return NaN;
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return n / 100;
  }

  // -----------------------------
  // Pull inputs -> payload for engine
  // -----------------------------
  function readInputs() {
    const feeModel = document.querySelector('input[name="fee_model"]:checked')?.value || "flat";

    let flatFee = num($("flat_fee").value);
    if (!Number.isFinite(flatFee)) flatFee = DEFAULTS.flat_fee;

    let hourlyRate = num($("hourly_rate").value);
    if (!Number.isFinite(hourlyRate)) hourlyRate = DEFAULTS.hourly_rate;

    let hoursPerYear = num($("hours_per_year").value);
    if (!Number.isFinite(hoursPerYear)) hoursPerYear = DEFAULTS.hours_per_year;

    let aumFeePct = parsePercent($("aum_fee_pct").value);
    // If AUM model is selected, ensure we have a valid fee percentage
    if (!Number.isFinite(aumFeePct) || aumFeePct <= 0) {
      aumFeePct = DEFAULTS.aum_fee_pct / 100;
    }

    const feeInflationOn = $("fee_inflation_on").checked || $("fee_inflation_on_hourly").checked;
    let feeIncreasePct = num($("fee_increase_pct").value) || num($("fee_increase_pct_hourly").value);
    if (!Number.isFinite(feeIncreasePct)) feeIncreasePct = DEFAULTS.fee_increase_pct;

    return {
      startingBalance: clamp(num($("starting_balance").value), 0, 10000000),
      monthlyContribution: clamp(num($("monthly_contribution").value), 0, 50000),
      horizonYears: clamp(num($("horizon_years").value), 1, 50),
      annualReturn: clamp(num($("annual_return").value), AR.min, AR.max) / 100,
      feeModel,
      flatFee: clamp(flatFee, 0, 100000),
      hourlyRate: clamp(hourlyRate, 0, 10000),
      hoursPerYear: clamp(hoursPerYear, 0, 1000),
      aumFeePct: clamp(aumFeePct, 0, 0.15),
      feeInflationOn,
      feeIncreasePct: clamp(feeIncreasePct, 0, 20)
    };
  }

  // -----------------------------
  // Render outputs
  // -----------------------------
  function render() {
    const inp = readInputs();

    // Calculate via engine (must exist globally)
    if (typeof window.calculateFlatFeeOrHourlyCost !== "function") {
      $("out_meta").textContent = "Error: calculateFlatFeeOrHourlyCost(...) not found.";
      return;
    }

    const result = window.calculateFlatFeeOrHourlyCost(inp);

    if (result.error) {
      $("out_meta").textContent = "Error: " + result.error;
      return;
    }

    $("out_with").textContent = fmtCAD(result.endingWith);
    $("out_without").textContent = fmtCAD(result.endingWithout);
    $("out_fees").textContent = fmtCAD(result.feesPaid);
    $("out_lost").textContent = fmtCAD(result.lostCompounding);
    $("out_total_cost").textContent = fmtCAD(result.totalCost);

    // AUM equivalent
    if (inp.feeModel === "aum") {
      $("out_aum_equiv").textContent = "—";
    } else {
      if (result.aumEquivalent === null) {
        $("out_aum_equiv").textContent = "≥ 5.00%";
      } else if (result.aumEquivalent === 0) {
        $("out_aum_equiv").textContent = "0.00%";
      } else {
        $("out_aum_equiv").textContent = fmtPct(result.aumEquivalent);
      }
    }

    $("out_meta").textContent = "Calculated using monthly compounding and the assumptions shown above.";
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

  function setFeeModelUI() {
    const feeModel = document.querySelector('input[name="fee_model"]:checked')?.value || "flat";

    // Hide all fields
    $("fields_flat").style.display = "none";
    $("fields_hourly").style.display = "none";
    $("fields_aum").style.display = "none";

    // Show relevant fields
    if (feeModel === "flat") {
      $("fields_flat").style.display = "block";
    } else if (feeModel === "hourly") {
      $("fields_hourly").style.display = "block";
    } else if (feeModel === "aum") {
      $("fields_aum").style.display = "block";
    }
  }

  function setFeeInflationUI() {
    const feeModel = document.querySelector('input[name="fee_model"]:checked')?.value || "flat";
    const isOn = feeModel === "flat" 
      ? $("fee_inflation_on").checked 
      : $("fee_inflation_on_hourly").checked;

    if (feeModel === "flat") {
      $("fields_fee_increase").style.display = isOn ? "block" : "none";
    } else if (feeModel === "hourly") {
      $("fields_fee_increase_hourly").style.display = isOn ? "block" : "none";
    }
  }

  // -----------------------------
  // Initialize defaults
  // -----------------------------
  function initDefaults() {
    $("starting_balance").value = String(DEFAULTS.starting_balance);
    $("monthly_contribution").value = String(DEFAULTS.monthly_contribution);
    $("horizon_years").value = String(DEFAULTS.horizon_years);
    $("annual_return").value = String(DEFAULTS.annual_return_pct);
    $("flat_fee").value = String(DEFAULTS.flat_fee);
    $("hourly_rate").value = String(DEFAULTS.hourly_rate);
    $("hours_per_year").value = String(DEFAULTS.hours_per_year);
    $("aum_fee_pct").value = String(DEFAULTS.aum_fee_pct);
    $("fee_increase_pct").value = String(DEFAULTS.fee_increase_pct);
    $("fee_increase_pct_hourly").value = String(DEFAULTS.fee_increase_pct);

    // Set default fee model
    $("model_flat").checked = true;

    // Slider config
    $("annual_return_slider").min = String(AR.min);
    $("annual_return_slider").max = String(AR.max);
    $("annual_return_slider").step = String(AR.step);
    $("annual_return_slider").value = String(DEFAULTS.annual_return_pct);
    $("annual_return_label").textContent = DEFAULTS.annual_return_pct.toFixed(2) + "%";

    // Set UI state
    setFeeModelUI();
    setFeeInflationUI();
  }

  // -----------------------------
  // Wire events
  // -----------------------------
  function wire() {
    // Slider config
    initDefaults();

    // Annual return sync
    $("annual_return").addEventListener("input", () => {
      syncSliderFromAnnualReturn();
      render();
    });

    $("annual_return_slider").addEventListener("input", () => {
      syncAnnualReturnFromSlider();
      render();
    });

    // All number inputs
    const numberInputs = [
      "starting_balance",
      "monthly_contribution",
      "horizon_years",
      "flat_fee",
      "hourly_rate",
      "hours_per_year",
      "fee_increase_pct",
      "fee_increase_pct_hourly"
    ];

    numberInputs.forEach(id => {
      $(id).addEventListener("input", render);
    });

    // Text inputs (percentages)
    const textInputs = [
      "annual_return",
      "aum_fee_pct"
    ];

    textInputs.forEach(id => {
      $(id).addEventListener("input", () => {
        if (id === "annual_return") {
          syncSliderFromAnnualReturn();
        }
        render();
      });
    });

    // Fee model radio buttons
    document.querySelectorAll('input[name="fee_model"]').forEach(radio => {
      radio.addEventListener("change", () => {
        setFeeModelUI();
        render();
      });
    });

    // Fee inflation toggles
    $("fee_inflation_on").addEventListener("change", () => {
      setFeeInflationUI();
      render();
    });

    $("fee_inflation_on_hourly").addEventListener("change", () => {
      setFeeInflationUI();
      render();
    });

    // Initial render
    render();
  }

  // -----------------------------
  // Initialize on DOM ready
  // -----------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
