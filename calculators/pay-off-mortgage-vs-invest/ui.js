// ui.js
// UI only: reads inputs, calls engine, writes outputs, renders chart. No math logic.

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
    if (!Number.isFinite(n)) return "$—";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  function fmtPct(dec) {
    if (dec == null) return "—";
    if (!Number.isFinite(dec)) return "—";
    return (dec * 100).toFixed(1) + "%";
  }

  // Canadian CPI long-term average (default when custom not set)
  const DEFAULT_INFLATION_PCT = 3.73;

  // -----------------------------
  // Chart rendering
  // -----------------------------
  class NetWorthChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.data = null;
      this.yMax = null;
      this.lockedYMax = null; // Locked Y-max that doesn't change with slider
      this.resize();
      window.addEventListener("resize", () => this.resize());
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx = this.canvas.getContext("2d");
      this.ctx.scale(dpr, dpr);
      this.canvas.style.width = rect.width + "px";
      this.canvas.style.height = rect.height + "px";
      if (this.data) this.draw();
    }

    setData(series, horizonYears, isReal, shouldRecalculateScale = false) {
      this.data = { series, horizonYears, isReal };
      if (shouldRecalculateScale || this.lockedYMax === null) {
        this.computeYMax();
        this.lockedYMax = this.yMax; // Lock the scale
      } else {
        // Use locked scale when slider changes
        this.yMax = this.lockedYMax;
      }
      this.draw();
    }

    computeYMax() {
      if (!this.data) return;
      const { series } = this.data;
      let max = 0;
      for (const point of series) {
        max = Math.max(max, point.balance || 0, point.investValue || 0, point.netWorth || 0);
      }
      const padded = max * 1.1;
      this.yMax = this.niceAxisMax(padded);
    }

    niceAxisMax(value) {
      if (value <= 0) return 100000;
      const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
      const normalized = value / magnitude;
      let nice;
      if (normalized <= 1) nice = 1;
      else if (normalized <= 2) nice = 2;
      else if (normalized <= 5) nice = 5;
      else nice = 10;
      return nice * magnitude;
    }

    draw() {
      if (!this.data || !this.yMax) return;
      const { series, horizonYears } = this.data;
      const ctx = this.ctx;
      const rect = this.canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const padding = { top: 20, right: 20, bottom: 40, left: 60 };

      ctx.clearRect(0, 0, width, height);

      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const xMax = horizonYears;
      const yMax = this.yMax;

      const mapX = (x) => padding.left + (x / xMax) * chartWidth;
      const mapY = (y) => padding.top + chartHeight - (y / yMax) * chartHeight;

      // Draw grid
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      for (let y = 0; y <= 5; y++) {
        const value = (y / 5) * yMax;
        const py = mapY(value);
        ctx.beginPath();
        ctx.moveTo(padding.left, py);
        ctx.lineTo(width - padding.right, py);
        ctx.stroke();
      }
      for (let x = 0; x <= 5; x++) {
        const value = (x / 5) * xMax;
        const px = mapX(value);
        ctx.beginPath();
        ctx.moveTo(px, padding.top);
        ctx.lineTo(px, height - padding.bottom);
        ctx.stroke();
      }

      // Draw axes
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding.left, padding.top);
      ctx.lineTo(padding.left, height - padding.bottom);
      ctx.lineTo(width - padding.right, height - padding.bottom);
      ctx.stroke();

      // Draw series helper
      const drawSeries = (series, color, getValue) => {
        if (series.length === 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < series.length; i++) {
          const point = series[i];
          const x = (point.month / 12);
          const px = mapX(x);
          const py = mapY(getValue(point));
          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      };

      // Draw 3 lines with better contrasting colors
      drawSeries(series, "#E74C3C", p => p.balance || 0); // Mortgage balance (red)
      drawSeries(series, "#3498DB", p => p.investValue || 0); // Investment portfolio (blue)
      drawSeries(series, "#2ECC71", p => p.netWorth || 0); // Net worth (green)

      // Labels
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      for (let x = 0; x <= 5; x++) {
        const value = (x / 5) * xMax;
        const px = mapX(value);
        ctx.fillText(Math.round(value).toString(), px, height - padding.bottom + 20);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let y = 0; y <= 5; y++) {
        const value = (y / 5) * yMax;
        const py = mapY(value);
        ctx.fillText(fmtCAD(value), padding.left - 10, py);
      }

      // Axis labels
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Years", width / 2, height - 5);
      ctx.save();
      ctx.translate(15, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("Dollars ($)", 0, 0);
      ctx.restore();
    }
  }

  // -----------------------------
  // Read inputs
  // -----------------------------
  function readInputs() {
    const useCalculator = $("use_calculator_toggle").checked;
    
    let mortgagePayment = 0;
    let calcHomePrice = 0;
    let calcDownAmount = 0;
    let calcDownPct = 0;
    let calcDownMode = false;
    let calcInterestRate = 0;
    let calcAmortization = 0;
    
    if (useCalculator) {
      calcHomePrice = clamp(num($("calc_home_price").value), 0, 10000000);
      calcDownMode = $("calc_down_mode_toggle").checked;
      calcDownAmount = clamp(num($("calc_down_amount").value), 0, calcHomePrice);
      calcDownPct = clamp(num($("calc_down_pct").value), 0, 100);
      calcInterestRate = clamp(num($("calc_interest_rate").value), 0, 20);
      calcAmortization = clamp(num($("calc_amortization").value), 1, 40);
      // Calculate mortgage payment from calculator
      mortgagePayment = calculateMortgagePaymentFromInputs();
    } else {
      mortgagePayment = clamp(num($("mortgage_payment").value), 0, 100000);
    }
    
    const monthlyBudget = clamp(num($("monthly_budget").value), 0, 100000);
    const extraCash = clamp(num($("extra_cash").value), 0, 100000);
    const allocationPercent = clamp(parseInt($("allocation_slider").value, 10), 0, 100);
    const expectedReturn = clamp(num($("expected_return").value), -50, 50);
    const fees = clamp(num($("fees").value), 0, 10);
    const timeHorizon = clamp(num($("time_horizon").value), 1, 75);
    // Note: investment_horizon removed - using time_horizon instead
    const homeGrowthInput = $("home_growth").value;
    const homeGrowthRate = homeGrowthInput === "" || !Number.isFinite(num(homeGrowthInput)) 
      ? 0 
      : clamp(num(homeGrowthInput), -10, 20);
    const isReal = $("display_mode").checked;
    const customInflationEl = document.getElementById("custom_inflation_rate");
    const rawInflation = customInflationEl ? num(customInflationEl.value) : DEFAULT_INFLATION_PCT;
    const customInflationPct = Number.isFinite(rawInflation) && rawInflation >= 0
      ? Math.round(clamp(rawInflation, 0, 100) * 100) / 100
      : DEFAULT_INFLATION_PCT;
    const currentBalance = clamp(num($("current_balance").value), 0, 10000000);
    const currentRate = clamp(num($("current_rate").value), 0, 20);
    const currentHomePrice = clamp(num($("current_home_price").value), 0, 10000000);
    
    return {
      mortgagePayment,
      monthlyBudget,
      extraCash,
      allocationPercent,
      expectedReturn,
      fees,
      timeHorizon,
      homeGrowthRate,
      isReal,
      customInflationPct,
      useCalculator,
      calcHomePrice,
      calcDownAmount,
      calcDownPct,
      calcDownMode,
      calcInterestRate,
      calcAmortization,
      currentBalance,
      currentRate,
      currentHomePrice
    };
  }

  // -----------------------------
  // Calculate mortgage payment from calculator
  // -----------------------------
  function calculateMortgagePaymentFromInputs() {
    const homePrice = clamp(num($("calc_home_price").value), 0, 10000000);
    const downMode = $("calc_down_mode_toggle").checked;
    let downPayment;
    if (downMode) {
      const pct = clamp(num($("calc_down_pct").value), 0, 100);
      downPayment = homePrice * (pct / 100);
    } else {
      downPayment = clamp(num($("calc_down_amount").value), 0, homePrice);
    }
    const principal = homePrice - downPayment;
    const rate = clamp(num($("calc_interest_rate").value), 0, 20);
    const years = clamp(num($("calc_amortization").value), 1, 40);
    
    // Always monthly (12 periods per year)
    const ppy = 12;
    
    if (rate === 0) {
      return principal / (years * ppy);
    }
    const periodRate = rate / 100 / ppy;
    const numPayments = years * ppy;
    const payment = principal * periodRate / (1 - Math.pow(1 + periodRate, -numPayments));
    return payment;
  }

  // -----------------------------
  // Render outputs
  // -----------------------------
  function render(changeSource) {
    const inp = readInputs();

    if (typeof window.calculateMortgageVsInvest !== "function") {
      console.error("calculateMortgageVsInvest not found");
      return;
    }

    const result = window.calculateMortgageVsInvest(inp);

    if (result.error) {
      console.error("Calculation error:", result.error);
      return;
    }

    // Apply inflation adjustment if real mode
    const inflationRate = inp.customInflationPct / 100;
    const adjustForInflation = (value, isReal) => {
      if (!isReal) return value;
      return value / Math.pow(1 + inflationRate, inp.timeHorizon);
    };

    // Update primary output
    const netWorth = adjustForInflation(result.netWorth, inp.isReal);
    $("net_worth").textContent = fmtCAD(netWorth);

    // Update secondary outputs
    const investValue = adjustForInflation(result.investValue, inp.isReal);
    const homeValue = adjustForInflation(result.homeValue, inp.isReal);
    const mortgageBalance = adjustForInflation(result.mortgageBalance, inp.isReal);
    
    $("invest_value").textContent = fmtCAD(investValue);
    $("home_value").textContent = fmtCAD(homeValue);
    $("mortgage_balance").textContent = fmtCAD(mortgageBalance);

    // Update key facts
    const fact100Mortgage = adjustForInflation(result.fact100Mortgage, inp.isReal);
    const fact100Invest = adjustForInflation(result.fact100Invest, inp.isReal);
    const totalInterestPaid = adjustForInflation(result.totalInterestPaid, inp.isReal);
    const totalInterestEarned = adjustForInflation(result.totalInterestEarned, inp.isReal);
    
    $("fact_100_mortgage").textContent = fmtCAD(fact100Mortgage);
    $("fact_100_invest").textContent = fmtCAD(fact100Invest);
    $("fact_horizon_1").textContent = inp.timeHorizon.toFixed(1);
    $("fact_horizon_2").textContent = inp.timeHorizon.toFixed(1);
    $("total_interest_paid").textContent = fmtCAD(totalInterestPaid);
    $("total_interest_earned").textContent = fmtCAD(totalInterestEarned);

    // Update chart
    const adjustedSeries = result.series.map(p => ({
      month: p.month,
      balance: adjustForInflation(p.balance || 0, inp.isReal),
      investValue: adjustForInflation(p.investValue || 0, inp.isReal),
      netWorth: adjustForInflation(p.netWorth || 0, inp.isReal)
    }));
    // Only recalculate scale when non-slider inputs change
    const isSliderChange = changeSource === 'slider';
    chart.setData(adjustedSeries, inp.timeHorizon, inp.isReal, !isSliderChange);

    // Summary sentence: payoff time + net worth at horizon
    const horizonYears = inp.timeHorizon;
    const horizonLabel = horizonYears % 1 === 0 ? horizonYears + " year" + (horizonYears !== 1 ? "s" : "") : horizonYears.toFixed(1) + " years";
    const netWorthDisplay = fmtCAD(netWorth);
    let payoffText;
    if (result.payoffMonth != null) {
      const years = Math.floor(result.payoffMonth / 12);
      const months = result.payoffMonth % 12;
      payoffText = "mortgage will be paid off in " + years + " year" + (years !== 1 ? "s" : "") + (months > 0 ? " and " + months + " month" + (months !== 1 ? "s" : "") : "") + ",";
    } else {
      payoffText = "mortgage will not be paid off within your " + horizonLabel + " time horizon,";
    }
    $("summary_sentence_text").textContent = "With these inputs, " + payoffText + " and net worth will be " + netWorthDisplay + " at the end of your " + horizonLabel + " time horizon.";
  }

  // -----------------------------
  // UI sync functions
  // -----------------------------
  function syncCalculatorToggle() {
    const useCalculator = $("use_calculator_toggle").checked;
    $("direct_payment_field").classList.toggle("hidden", useCalculator);
    $("mortgage_calculator_field").classList.toggle("hidden", !useCalculator);
    if (useCalculator) {
      updateCalculatedPayment();
    }
  }

  function syncDownModeToggle() {
    const usePct = $("calc_down_mode_toggle").checked;
    $("calc_down_amount_field").classList.toggle("hidden", usePct);
    $("calc_down_pct_field").classList.toggle("hidden", !usePct);
    updateCalculatedPayment();
  }

  function updateCalculatedPayment() {
    if (!$("use_calculator_toggle").checked) return;
    const payment = calculateMortgagePaymentFromInputs();
    $("calculated_payment_display").textContent = fmtCAD(payment);
  }

  function syncDisplayMode() {
    const isReal = $("display_mode").checked;
    $("display_mode_label").classList.toggle("hidden", isReal);
    $("display_mode_label_alt").classList.toggle("hidden", !isReal);
    $("real_explainer").classList.toggle("hidden", !isReal);
  }

  function syncSlider() {
    const value = parseInt($("allocation_slider").value, 10);
    $("slider_value_display").textContent = value + "%";
  }

  // Sync monthly budget and extra cash
  // If user updates monthly budget, update extra cash
  // If user updates extra cash, update monthly budget
  function syncMonthlyBudgetAndExtraCash(source) {
    const useCalculator = $("use_calculator_toggle").checked;
    let mortgagePayment = 0;
    
    if (useCalculator) {
      mortgagePayment = calculateMortgagePaymentFromInputs();
    } else {
      mortgagePayment = clamp(num($("mortgage_payment").value), 0, 100000);
    }
    
    if (source === "monthly_budget") {
      const monthlyBudget = clamp(num($("monthly_budget").value), 0, 100000);
      const extraCash = Math.max(0, monthlyBudget - mortgagePayment);
      $("extra_cash").value = Math.round(extraCash * 100) / 100;
    } else if (source === "extra_cash") {
      const extraCash = clamp(num($("extra_cash").value), 0, 100000);
      const monthlyBudget = mortgagePayment + extraCash;
      $("monthly_budget").value = Math.round(monthlyBudget * 100) / 100;
    } else if (source === "mortgage_payment" || source === "calculator") {
      // When mortgage payment changes, update monthly budget if extra cash is set
      const extraCash = clamp(num($("extra_cash").value), 0, 100000);
      const monthlyBudget = mortgagePayment + extraCash;
      $("monthly_budget").value = Math.round(monthlyBudget * 100) / 100;
    }
  }

  // -----------------------------
  // Debounce helper
  // -----------------------------
  let debounceTimer = null;
  function debouncedRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 100);
  }

  // -----------------------------
  // Initialize
  // -----------------------------
  const chart = new NetWorthChart($("chartCanvas"));

  // Wire events
  [
    "mortgage_payment",
    "monthly_budget",
    "extra_cash",
    "expected_return",
    "fees",
    "time_horizon",
    "home_growth",
    "custom_inflation_rate",
    "current_balance",
    "current_rate",
    "current_home_price",
    "calc_home_price",
    "calc_down_amount",
    "calc_down_pct",
    "calc_interest_rate",
    "calc_amortization"
  ].forEach(id => {
    $(id).addEventListener("input", () => {
      if (id === "monthly_budget") {
        syncMonthlyBudgetAndExtraCash("monthly_budget");
      } else if (id === "extra_cash") {
        syncMonthlyBudgetAndExtraCash("extra_cash");
      } else if (id === "mortgage_payment") {
        syncMonthlyBudgetAndExtraCash("mortgage_payment");
      } else if (id.startsWith("calc_")) {
        updateCalculatedPayment();
        syncMonthlyBudgetAndExtraCash("calculator");
      }
      debouncedRender();
    });
  });

  $("use_calculator_toggle").addEventListener("change", () => {
    syncCalculatorToggle();
    debouncedRender();
  });

  $("calc_down_mode_toggle").addEventListener("change", () => {
    syncDownModeToggle();
    debouncedRender();
  });

  $("display_mode").addEventListener("change", () => {
    syncDisplayMode();
    debouncedRender();
  });

  const customInflationEl = document.getElementById("custom_inflation_rate");
  if (customInflationEl) {
    customInflationEl.addEventListener("blur", () => {
      const v = num(customInflationEl.value);
      if (!Number.isFinite(v) || v < 0) {
        customInflationEl.value = DEFAULT_INFLATION_PCT;
      } else {
        const clamped = Math.round(clamp(v, 0, 100) * 100) / 100;
        customInflationEl.value = clamped;
      }
      debouncedRender();
    });
  }

  $("allocation_slider").addEventListener("input", () => {
    syncSlider();
    render('slider'); // Pass 'slider' flag to indicate slider-only change
  });

  // Initial sync
  syncCalculatorToggle();
  syncDownModeToggle();
  syncDisplayMode();
  syncSlider();
  updateCalculatedPayment();
  syncMonthlyBudgetAndExtraCash("calculator");

  // Initial render
  render();
})();
