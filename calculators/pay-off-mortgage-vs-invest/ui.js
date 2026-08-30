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

  function canadianMortgagePeriodicRate(annualRate, periodsPerYear) {
    const annualRateDecimal = annualRate / 100;
    return Math.pow(1 + annualRateDecimal / 2, 2 / periodsPerYear) - 1;
  }

  // Canadian CPI long-term average since 1960 (loaded from CPI JSON; fallback if fetch fails)
  let defaultInflationPct = 3.7;

  function getDefaultInflationPct() {
    return defaultInflationPct;
  }

  function formatDefaultInflationPct() {
    return defaultInflationPct.toFixed(2);
  }

  function applyDefaultInflationToUi() {
    const customInflationEl = document.getElementById("custom_inflation_rate");
    if (customInflationEl && !customInflationEl.dataset.userEdited) {
      customInflationEl.value = formatDefaultInflationPct();
    }

    document.querySelectorAll("[data-cpi-canada-avg]").forEach((el) => {
      el.textContent = formatDefaultInflationPct();
    });
  }

  async function loadDefaultInflationFromCpi() {
    if (!window.CpiInflation) {
      return;
    }
    try {
      const avg = await window.CpiInflation.canadaLongRunAverageSince1960();
      if (avg != null && Number.isFinite(avg)) {
        defaultInflationPct = avg;
        applyDefaultInflationToUi();
      }
    } catch (error) {
      console.warn("Could not load Canada CPI default inflation:", error);
    }
  }

  // -----------------------------
  // Chart rendering
  // -----------------------------
  class NetWorthChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.data = null;
      this.yMin = 0;
      this.yMax = null;
      this.lockedYMin = null;
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
      if (
        shouldRecalculateScale ||
        this.lockedYMin === null ||
        this.lockedYMax === null
      ) {
        this.computeYMax();
        this.lockedYMin = this.yMin;
        this.lockedYMax = this.yMax; // Lock the scale
      } else {
        // Use locked scale when slider changes
        this.yMin = this.lockedYMin;
        this.yMax = this.lockedYMax;
      }
      this.draw();
    }

    computeYMax() {
      if (!this.data) return;
      const { series } = this.data;
      let min = 0;
      let max = 0;
      for (const point of series) {
        const balance = point.balance ?? 0;
        const investValue = point.investValue ?? 0;
        const netWorth = point.netWorth ?? 0;
        min = Math.min(min, balance, investValue, netWorth);
        max = Math.max(max, balance, investValue, netWorth);
      }
      this.yMin = min < 0 ? -this.niceAxisMax(Math.abs(min) * 1.1) : 0;
      this.yMax = this.niceAxisMax(max * 1.1);
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
      if (!this.data || this.yMax == null) return;
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
      const yMin = this.yMin;
      const yMax = this.yMax;
      const yRange = yMax - yMin;
      if (!(yRange > 0)) return;

      const mapX = (x) => padding.left + (x / xMax) * chartWidth;
      const mapY = (y) =>
        padding.top + chartHeight - ((y - yMin) / yRange) * chartHeight;

      // Draw grid
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      for (let y = 0; y <= 5; y++) {
        const value = yMin + (y / 5) * yRange;
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
      const zeroY = mapY(Math.min(yMax, Math.max(yMin, 0)));
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
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
        const value = yMin + (y / 5) * yRange;
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
    
    const inputMode = $("extra_mode_lump").checked ? "lump" : "monthly";
    const monthlyBudget = clamp(num($("monthly_budget").value), 0, 100000);
    const extraCash = clamp(num($("extra_cash").value), 0, 100000);
    const lumpSum = clamp(num($("lump_sum").value), 0, 100000000);
    const allocationPercent = clamp(parseInt($("allocation_slider").value, 10), 0, 100);
    const expectedReturn = clamp(num($("expected_return").value), -50, 50);
    const fees = clamp(num($("fees").value), 0, 10);
    const timeHorizon = clamp(num($("time_horizon").value), 1, 75);
    // Note: investment_horizon removed - using time_horizon instead
    const homeGrowthInput = $("home_growth").value;
    const homeGrowthRate = homeGrowthInput === "" || !Number.isFinite(num(homeGrowthInput)) 
      ? 0 
      : clamp(num(homeGrowthInput), -10, 20);
    const isReal = $("display_basis_real").checked;
    const customInflationEl = document.getElementById("custom_inflation_rate");
    const rawInflation = customInflationEl ? num(customInflationEl.value) : getDefaultInflationPct();
    const customInflationPct = Number.isFinite(rawInflation) && rawInflation >= 0
      ? Math.round(clamp(rawInflation, 0, 100) * 100) / 100
      : getDefaultInflationPct();
    const currentBalance = clamp(num($("current_balance").value), 0, 10000000);
    const currentRate = clamp(num($("current_rate").value), 0, 20);
    const currentHomePrice = clamp(num($("current_home_price").value), 0, 10000000);
    
    return {
      inputMode,
      lumpSum,
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
    const periodRate = canadianMortgagePeriodicRate(rate, ppy);
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

    const calculationError = $("calculation_error");
    if (result.error) {
      console.error("Calculation error:", result.error);
      const errorMessage =
        result.errorCode === "non_amortizing_payment"
          ? "The mortgage payment (" +
            fmtCAD(result.payment) +
            ") must be greater than the first month's accrued interest (" +
            fmtCAD(result.interestDue) +
            ") under these assumptions. Increase the payment or change the mortgage assumptions."
          : result.error;
      calculationError.textContent = errorMessage;
      calculationError.classList.remove("hidden");
      [
        "net_worth",
        "invest_value",
        "home_value",
        "mortgage_balance",
        "break_even_return",
        "fact_100_mortgage",
        "fact_100_invest",
        "total_interest_paid",
        "total_interest_earned"
      ].forEach((id) => {
        $(id).textContent = "—";
      });
      $("break_even_blurb").textContent = "";
      $("fact_payoff_allocation_detail").textContent = "";
      $("summary_sentence_text").textContent = errorMessage;
      chart.setData([], inp.timeHorizon, inp.isReal, true);
      return;
    }
    calculationError.textContent = "";
    calculationError.classList.add("hidden");

    // Apply inflation adjustment if real mode.
    // Stocks at the horizon use the full-horizon factor.
    // Chart points and interest flows are deflated to the month they occur.
    const inflationRate = inp.customInflationPct / 100;
    const deflateAtMonth = (value, month) => {
      if (!inp.isReal) return value;
      return value / Math.pow(1 + inflationRate, (month || 0) / 12);
    };
    const adjustForInflation = (value, isReal) => {
      if (!isReal) return value;
      return value / Math.pow(1 + inflationRate, inp.timeHorizon);
    };
    const realInterestSum = (key, nominalTotal) => {
      if (!inp.isReal) return nominalTotal;
      if (!Array.isArray(result.series)) return adjustForInflation(nominalTotal, true);
      return result.series.reduce((sum, p) => {
        return sum + deflateAtMonth(p[key] || 0, p.month);
      }, 0);
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

    // Break-even return (extreme allocation strategies, same net worth at horizon)
    if (Number.isFinite(result.breakEvenGrossReturnPercent)) {
      $("break_even_return").textContent = result.breakEvenGrossReturnPercent.toFixed(2) + "%";
      const tiePhrase =
        inp.inputMode === "lump"
          ? "100% of the lump sum to extra mortgage principal and 100% of the lump sum to investing at the start"
          : "100% of extra cash to the mortgage and 100% to investing";
      $("break_even_blurb").textContent =
        "Shown as a gross annual % (same basis as the expected return field above). The investing path compounds at net return (gross minus your investment fee %). This value is the gross return at which " +
        tiePhrase +
        " would tie at your horizon. Changing the fee input changes that gross hurdle. Home price growth does not move this tie point: both paths share the same ending home value, so it drops out of the comparison.";
    } else {
      $("break_even_return").textContent = "—";
      if (result.breakEvenReason === "no_mortgage") {
        $("break_even_blurb").textContent = "Not applicable when there is no mortgage balance.";
      } else if (result.breakEvenReason === "no_extra") {
        $("break_even_blurb").textContent =
          inp.inputMode === "lump"
            ? "Enter a lump sum greater than zero to see a break-even return between the two extreme allocation strategies."
            : "Add extra cash (above the regular mortgage payment) to see a break-even return between the two extreme allocation strategies.";
      } else if (result.breakEvenReason === "non_amortizing_payment") {
        $("break_even_blurb").textContent =
          "The regular mortgage payment must exceed accrued monthly interest before the two strategies can be compared.";
      } else {
        $("break_even_blurb").textContent =
          "No break-even was found over a wide range of gross returns; with these inputs, one extreme strategy may always produce higher net worth at your horizon.";
      }
    }

    // Update key facts
    const fact100Mortgage = adjustForInflation(result.fact100Mortgage, inp.isReal);
    const fact100Invest = adjustForInflation(result.fact100Invest, inp.isReal);
    const totalInterestPaid = realInterestSum("interestPaid", result.totalInterestPaid);
    const totalInterestEarned = realInterestSum("interestEarned", result.totalInterestEarned);
    
    $("fact_100_mortgage").textContent = fmtCAD(fact100Mortgage);
    $("fact_100_invest").textContent = fmtCAD(fact100Invest);
    $("fact_horizon_1").textContent = inp.timeHorizon.toFixed(1);
    $("fact_horizon_2").textContent = inp.timeHorizon.toFixed(1);
    $("total_interest_paid").textContent = fmtCAD(totalInterestPaid);
    $("total_interest_earned").textContent = fmtCAD(totalInterestEarned);

    // Key facts: mortgage payoff timeline for current allocation vs baseline (all extra cash invested)
    const mortgageExtraPct = Math.round(100 - inp.allocationPercent);
    if (inp.inputMode === "lump") {
      $("fact_payoff_allocation_prefix").innerHTML =
        "If <strong class=\"fact-value\" id=\"fact_extra_cash_to_mortgage_pct\">" +
        mortgageExtraPct +
        "</strong>% of your lump sum (slider toward mortgage) goes to extra principal, ";
    } else {
      $("fact_payoff_allocation_prefix").innerHTML =
        "If <strong class=\"fact-value\" id=\"fact_extra_cash_to_mortgage_pct\">" +
        mortgageExtraPct +
        "</strong>% of extra monthly cash is allocated to mortgage payments, ";
    }

    $("kf_if_all_extra_mortgage").textContent =
      inp.inputMode === "lump"
        ? "If 100% of the lump sum goes to extra mortgage principal"
        : "If 100% of extra cash allocated to paying off mortgage faster";
    $("kf_if_all_extra_invest").textContent =
      inp.inputMode === "lump"
        ? "If 100% of the lump sum is invested at the start"
        : "If 100% of extra cash allocated to investing";

    const lumpNote = document.getElementById("cash_flow_lump_note");
    if (lumpNote) lumpNote.classList.toggle("hidden", inp.inputMode !== "lump");

    const horizonYears = inp.timeHorizon;
    const horizonLabel =
      horizonYears % 1 === 0
        ? horizonYears + " year" + (horizonYears !== 1 ? "s" : "")
        : horizonYears.toFixed(1) + " years";

    const parsePayoff = (payoffMonth) => {
      if (payoffMonth == null || !Number.isFinite(payoffMonth)) return null;
      const years = Math.floor(payoffMonth / 12);
      const months = payoffMonth % 12;
      return { years, months, totalMonths: years * 12 + months };
    };

    const analysisHorizonMonths =
      result.analysisHorizonMonths != null && Number.isFinite(result.analysisHorizonMonths)
        ? result.analysisHorizonMonths
        : Math.round(inp.timeHorizon * 12);

    const cur = parsePayoff(result.payoffMonth);
    const base = parsePayoff(result.payoffMonthAllInvest);

    const paidOffInPhrase = (p) =>
      "paid off in " +
      p.years +
      " year" +
      (p.years !== 1 ? "s" : "") +
      " and " +
      p.months +
      " month" +
      (p.months !== 1 ? "s" : "");

    let detail = "";
    if (result.payoffMonth === 0) {
      detail += "there is no mortgage balance to pay down under these inputs. ";
    } else if (cur && cur.totalMonths > 0) {
      detail += "your mortgage will be " + paidOffInPhrase(cur) + ". ";
      if (cur.totalMonths > analysisHorizonMonths) {
        detail +=
          "That payoff date is after your selected analysis horizon (" +
          horizonLabel +
          ") used for the chart and headline net worth above. ";
      }
    } else {
      detail +=
        "the mortgage would not be fully paid off within 100 years at these payment levels (for example, payments may not cover interest). ";
    }

    const baselineAllInvestLabel =
      inp.inputMode === "lump" ? "With the entire lump sum invested at the start" : "With all extra cash invested";

    if (result.payoffMonthAllInvest === 0) {
      detail += baselineAllInvestLabel + ", there is no mortgage balance to pay down under these inputs. ";
    } else if (base && base.totalMonths > 0) {
      detail +=
        baselineAllInvestLabel +
        ", payoff would be in " +
        base.years +
        " year" +
        (base.years !== 1 ? "s" : "") +
        " and " +
        base.months +
        " month" +
        (base.months !== 1 ? "s" : "") +
        ". ";
      if (base.totalMonths > analysisHorizonMonths) {
        detail +=
          "That payoff date is also after your selected analysis horizon (" + horizonLabel + "). ";
      }
    } else {
      detail +=
        baselineAllInvestLabel +
        ", payoff would not be reached within 100 years at these payment levels. ";
    }

    if (cur && cur.totalMonths > 0 && base && base.totalMonths > 0) {
      const delta = base.totalMonths - cur.totalMonths;
      if (delta === 0) detail += "That is the same payoff timing as the all-invest baseline.";
      else if (delta > 0)
        detail += "That is " + delta + " month" + (delta !== 1 ? "s" : "") + " sooner than the all-invest baseline.";
      else
        detail +=
          "That is " +
          Math.abs(delta) +
          " month" +
          (Math.abs(delta) !== 1 ? "s" : "") +
          " later than the all-invest baseline.";
    }

    $("fact_payoff_allocation_detail").textContent = detail.trim();

    // Update chart
    const adjustedSeries = result.series.map(p => ({
      month: p.month,
      balance: deflateAtMonth(p.balance || 0, p.month),
      investValue: deflateAtMonth(p.investValue || 0, p.month),
      netWorth: deflateAtMonth(p.netWorth || 0, p.month)
    }));
    // Only recalculate scale when non-slider inputs change
    const isSliderChange = changeSource === 'slider';
    chart.setData(adjustedSeries, inp.timeHorizon, inp.isReal, !isSliderChange);

    // Summary sentence: payoff time + net worth at horizon (reuses horizonLabel from Key facts block above)
    const netWorthDisplay = fmtCAD(netWorth);
    const analysisMonths =
      result.analysisHorizonMonths != null && Number.isFinite(result.analysisHorizonMonths)
        ? result.analysisHorizonMonths
        : Math.round(inp.timeHorizon * 12);

    let payoffText;
    if (result.payoffMonth === 0) {
      payoffText = "there is no mortgage balance to amortize,";
    } else if (result.payoffMonth != null && result.payoffMonth > 0) {
      const years = Math.floor(result.payoffMonth / 12);
      const months = result.payoffMonth % 12;
      payoffText =
        "mortgage will be paid off in " +
        years +
        " year" +
        (years !== 1 ? "s" : "") +
        (months > 0 ? " and " + months + " month" + (months !== 1 ? "s" : "") : "");
      if (result.payoffMonth > analysisMonths) {
        payoffText += ", which is after your selected " + horizonLabel + " analysis window ends";
      }
      payoffText += ",";
    } else {
      payoffText =
        "the mortgage would not be fully paid off within 100 years at these payment levels,";
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
    const isReal = $("display_basis_real").checked;
    $("real_explainer").classList.toggle("hidden", !isReal);
  }

  function syncSlider() {
    const value = parseInt($("allocation_slider").value, 10);
    $("slider_value_display").textContent = value + "%";
  }

  function syncExtraCashMode() {
    const lump = $("extra_mode_lump").checked;
    $("monthly_extra_wrap").classList.toggle("hidden", lump);
    $("lump_sum_wrap").classList.toggle("hidden", !lump);
    $("monthly_budget").disabled = lump;
    $("extra_cash").disabled = lump;
    $("lump_sum").disabled = !lump;
    $("allocation_slider_label").textContent = lump
      ? "Allocation: lump sum to mortgage vs. investing"
      : "Allocation: extra cash to mortgage vs. investing";
    const help = $("allocation_slider_help");
    help.textContent = lump
      ? "The slider splits your lump sum at the very start: left sends more to extra mortgage principal, right sends more to the portfolio. Your regular mortgage payment still goes to the mortgage until it is paid off; there is no recurring extra cash in this mode."
      : "The slider controls how your extra cash is allocated. Your regular mortgage payment always goes to the mortgage until it's paid off.";
  }

  // Sync monthly budget and extra cash
  // If user updates monthly budget, update extra cash
  // If user updates extra cash, update monthly budget
  function syncMonthlyBudgetAndExtraCash(source) {
    if ($("extra_mode_lump").checked) return;
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
    "calc_amortization",
    "lump_sum"
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

  ["display_basis_nominal", "display_basis_real"].forEach((id) => {
    $(id).addEventListener("change", () => {
      syncDisplayMode();
      debouncedRender();
    });
  });

  const customInflationEl = document.getElementById("custom_inflation_rate");
  if (customInflationEl) {
    customInflationEl.addEventListener("input", () => {
      customInflationEl.dataset.userEdited = "1";
    });
    customInflationEl.addEventListener("blur", () => {
      const v = num(customInflationEl.value);
      if (!Number.isFinite(v) || v < 0) {
        delete customInflationEl.dataset.userEdited;
        customInflationEl.value = formatDefaultInflationPct();
      } else {
        customInflationEl.dataset.userEdited = "1";
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

  ["extra_mode_monthly", "extra_mode_lump"].forEach((id) => {
    $(id).addEventListener("change", () => {
      syncExtraCashMode();
      if ($("extra_mode_monthly").checked) {
        syncMonthlyBudgetAndExtraCash("calculator");
      }
      debouncedRender();
    });
  });

  // Initial sync
  syncCalculatorToggle();
  syncDownModeToggle();
  syncDisplayMode();
  syncExtraCashMode();
  syncSlider();
  updateCalculatedPayment();
  syncMonthlyBudgetAndExtraCash("calculator");
  applyDefaultInflationToUi();

  // Load CPI default, then initial render
  loadDefaultInflationFromCpi().finally(() => {
    render();
  });
})();
