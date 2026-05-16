(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Inputs
  const portfolio = $("portfolio");
  const annualReturn = $("annualReturn");
  const retirementYears = $("retirementYears");
  const wtDollar = $("wt_dollar");
  const wtRate = $("wt_rate");
  const withdrawalAmount = $("withdrawalAmount");
  const withdrawalRate = $("withdrawalRate");
  const frequency = $("frequency");
  const dollarModeWrap = $("dollarModeFields");
  const rateModeWrap = $("rateModeFields");
  const realToggle = $("realToggle");
  const inflationRate = $("inflationRate");
  const inflationFieldWrap = $("inflationFieldWrap");

  // Outputs
  const errorBanner = $("errorBanner");
  const outPortfolio = $("out_portfolio");
  const outAnnualW = $("out_annualW");
  const outStartWR = $("out_startWR");
  const outDepletion = $("out_depletion");
  const outEnding = $("out_ending");
  const outRealEnding = $("out_realEnding");
  const outRealCard = $("out_realCard");
  const resultSummary = $("resultSummary");
  const lblPortfolio = $("lbl_portfolio");

  // Chart
  const chartCanvas = $("rwChart");
  const chartWrap = $("chartWrap");
  const chartTooltip = $("chartTooltip");
  const chartLegendReal = $("chartLegendReal");

  // Table
  const yearTableHead = $("yearTableHead");
  const yearTableBody = $("yearTableBody");

  // Share / export
  const shareBlock = $("rw_share_block");
  const shareBtn = $("share_result_btn");
  const downloadBtn = $("download_result_btn");
  const copyBtn = $("copy_result_link_btn");
  const exportBtn = $("export_csv_btn");
  const resultShareStatus = $("result_share_status");

  const CALC_NAME = "retirement-withdrawal";
  const SCRIPT_VER = "20260426";

  var latestSim = null;
  var latestSharePayload = null;

  function toNumber(v) {
    const x = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(x) ? x : NaN;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function fmtMoney(x) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0
    }).format(x);
  }

  function fmtMoney2(x) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(x);
  }

  function fmtPct(x, decimals) {
    const d = typeof decimals === "number" ? decimals : 2;
    return (x * 100).toFixed(d) + "%";
  }

  function fmtYearsApprox(years) {
    if (!Number.isFinite(years)) return "—";
    const rounded = Math.round(years * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
      return String(Math.round(rounded)) + " years";
    }
    return rounded.toFixed(1) + " years";
  }

  function periodsPerYearFromSelect() {
    return Math.max(1, Math.round(toNumber(frequency.value)));
  }

  function setError(msg) {
    if (!errorBanner) return;
    if (!msg) {
      errorBanner.classList.add("hidden");
      errorBanner.textContent = "";
      return;
    }
    errorBanner.classList.remove("hidden");
    errorBanner.textContent = msg;
  }

  function setShareStatus(msg, isError) {
    if (!resultShareStatus) return;
    resultShareStatus.textContent = msg || "";
    resultShareStatus.style.color = isError ? "var(--danger, #e57373)" : "";
  }

  function markShareReady() {
    if (shareBlock) shareBlock.classList.add("is-ready-to-share");
  }

  function readWithdrawalType() {
    if (wtRate && wtRate.checked) return "rate";
    return "dollar";
  }

  function applyWithdrawalTypeUI() {
    const t = readWithdrawalType();
    if (dollarModeWrap) dollarModeWrap.classList.toggle("hidden", t !== "dollar");
    if (rateModeWrap) rateModeWrap.classList.toggle("hidden", t !== "rate");
  }

  function applyInflationUI() {
    if (inflationFieldWrap) inflationFieldWrap.classList.toggle("hidden", !realToggle.checked);
    if (outRealCard) outRealCard.classList.toggle("hidden", !realToggle.checked);
    if (yearTableHead) {
      const thReal = yearTableHead.querySelector("[data-rw-col='real']");
      if (thReal) thReal.classList.toggle("hidden", !realToggle.checked);
    }
  }

  function annualToPeriodic(annual, ppy) {
    const base = 1 + annual;
    if (!Number.isFinite(base) || base <= 0) return NaN;
    return Math.pow(base, 1 / ppy) - 1;
  }

  function simulate() {
    const p0 = toNumber(portfolio.value);
    const rA = toNumber(annualReturn.value) / 100;
    const years = Math.max(1, Math.round(toNumber(retirementYears.value)));
    const ppy = periodsPerYearFromSelect();
    const wType = readWithdrawalType();
    const inflOn = realToggle.checked;
    const infl = toNumber(inflationRate.value) / 100;

    if (!Number.isFinite(p0) || p0 < 0) {
      return { ok: false, error: "Enter a current portfolio value of $0 or more." };
    }
    if (!Number.isFinite(rA) || rA <= -0.999999) {
      return { ok: false, error: "Expected return is too low for this model. Enter a return above -99.9%." };
    }
    if (!Number.isFinite(years) || years < 1) {
      return { ok: false, error: "Enter a retirement withdrawal period of at least 1 year." };
    }
    if (inflOn && (!Number.isFinite(infl) || infl <= -0.999999)) {
      return { ok: false, error: "Inflation rate is too low. Enter a rate above -99.9%, or turn inflation adjustment off." };
    }

    const portfolioAtStart = p0;
    if (!Number.isFinite(portfolioAtStart) || portfolioAtStart < 0) {
      return { ok: false, error: "Could not compute the portfolio value at withdrawal start. Check your inputs." };
    }

    const rPeriod = annualToPeriodic(rA, ppy);
    if (!Number.isFinite(rPeriod)) {
      return { ok: false, error: "Could not compute a periodic return from the annual return. Check your inputs." };
    }

    // Withdrawals
    var periodicW = 0;
    var annualW = 0;
    var startWR = 0;

    if (wType === "dollar") {
      const wd = toNumber(withdrawalAmount.value);
      if (!Number.isFinite(wd) || wd < 0) {
        return { ok: false, error: "Withdrawal amount must be $0 or more." };
      }
      periodicW = wd;
      annualW = periodicW * ppy;
      startWR = portfolioAtStart > 0 ? annualW / portfolioAtStart : 0;
    } else {
      const wr = toNumber(withdrawalRate.value) / 100;
      if (!Number.isFinite(wr) || wr < 0) {
        return { ok: false, error: "Withdrawal rate must be 0% or more." };
      }
      if (wr > 0.5) {
        return { ok: false, error: "Withdrawal rate looks unrealistically high for this model (cap: 50%)." };
      }
      annualW = portfolioAtStart * wr;
      periodicW = annualW / ppy;
      startWR = wr;
    }

    const totalPeriods = years * ppy;

    const yearly = [];
    yearly.push({
      year: 0,
      starting: portfolioAtStart,
      withdrawals: 0,
      growth: 0,
      ending: portfolioAtStart,
      endingReal: inflOn ? portfolioAtStart : null
    });

    var bal = portfolioAtStart;
    var depleted = false;
    var depletionRetirementYears = null;

    var yStart = portfolioAtStart;
    var yW = 0;
    var yG = 0;

    function closeYear(yNum) {
      const ending = bal;
      const endingReal = inflOn ? ending / Math.pow(1 + infl, yNum) : null;
      yearly.push({
        year: yNum,
        starting: yStart,
        withdrawals: yW,
        growth: yG,
        ending: ending,
        endingReal: endingReal
      });
      yStart = ending;
      yW = 0;
      yG = 0;
    }

    for (var p = 0; p < totalPeriods; p += 1) {
      if (depleted) {
        if ((p + 1) % ppy === 0) {
          closeYear((p + 1) / ppy);
        }
        continue;
      }

      if (bal <= 0) {
        depleted = true;
        depletionRetirementYears = p / ppy;
        if ((p + 1) % ppy === 0) {
          closeYear((p + 1) / ppy);
        }
        continue;
      }

      const b0 = bal;
      const growth = b0 * rPeriod;
      const afterG = b0 * (1 + rPeriod);

      if (afterG > periodicW) {
        yG += growth;
        yW += periodicW;
        bal = afterG - periodicW;
      } else {
        if (periodicW > 0) {
          const frac = clamp(afterG / periodicW, 0, 1);
          yG += growth * frac;
          yW += periodicW * frac;
        } else {
          yG += growth;
        }
        bal = 0;
        depleted = true;
        depletionRetirementYears = (p + (periodicW > 0 ? clamp(afterG / periodicW, 0, 1) : 1)) / ppy;
      }

      if ((p + 1) % ppy === 0) {
        closeYear((p + 1) / ppy);
      }
    }

    var yearlyForUi = yearly;
    if (depleted && depletionRetirementYears != null && Number.isFinite(depletionRetirementYears)) {
      const yCut = Math.min(years, Math.ceil(depletionRetirementYears - 1e-9));
      yearlyForUi = yearly.filter(function (row) {
        return row.year === 0 || row.year <= yCut;
      });
    }

    const last = yearlyForUi[yearlyForUi.length - 1];
    const finalNominal = last.ending;
    const finalReal = inflOn ? last.endingReal : null;
    const fullHorizon = !depleted;

    // Chart
    const chartYears = yearlyForUi.map((r) => r.year);
    const chartNom = yearlyForUi.map((r) => r.ending);
    const chartReal = inflOn ? yearlyForUi.map((r) => (r.endingReal == null ? 0 : r.endingReal)) : null;

    return {
      ok: true,
      inputs: {
        portfolio: p0,
        rA: rA,
        retirementYears: years,
        ppy: ppy,
        withdrawalType: wType,
        periodicWithdrawal: periodicW,
        annualWithdrawal: annualW,
        startingWR: startWR,
        inflOn: inflOn,
        infl: infl
      },
      portfolioAtStart: portfolioAtStart,
      yearly: yearlyForUi,
      finalNominal: finalNominal,
      finalReal: finalReal,
      depleted: depleted,
      depletionRetirementYears: depletionRetirementYears,
      fullHorizon: fullHorizon,
      chart: { years: chartYears, nominal: chartNom, real: chartReal }
    };
  }

  function buildQueryParams(sim) {
    return {
      v: 1,
      sver: SCRIPT_VER,
      p: String(Math.round(sim.inputs.portfolio)),
      r: String((sim.inputs.rA * 100).toFixed(3)),
      y: String(sim.inputs.retirementYears),
      f: String(sim.inputs.ppy),
      t: sim.inputs.withdrawalType === "rate" ? "r" : "d",
      w:
        sim.inputs.withdrawalType === "rate"
          ? String(toNumber(withdrawalRate.value).toFixed(3))
          : String(toNumber(withdrawalAmount.value).toFixed(2)),
      i: sim.inputs.inflOn ? "1" : "0",
      ir: sim.inputs.inflOn ? String(toNumber(inflationRate.value).toFixed(3)) : "0"
    };
  }

  function buildSharePayload(sim) {
    if (!window.TLM || !window.TLM.shareCard) return null;
    const q = buildQueryParams(sim);
    const url = window.TLM.shareCard.buildResultUrl(window.location.href.split("#")[0], q);
    const inflPct = toNumber(inflationRate.value).toFixed(1) + "%";

    var primaryLine;
    if (sim.depleted) {
      primaryLine = "Portfolio depleted after approximately " + fmtYearsApprox(sim.depletionRetirementYears);
    } else {
      primaryLine =
        "Projected portfolio left after " + sim.inputs.retirementYears + " years: " + fmtMoney(Math.max(0, sim.finalNominal));
    }

    const contextLines = [
      "Starting portfolio at retirement: " + fmtMoney(sim.portfolioAtStart),
      "Annual withdrawal: " + fmtMoney(sim.inputs.annualWithdrawal),
      "Return: " + (sim.inputs.rA * 100).toFixed(1) + "%"
    ];
    if (sim.inputs.inflOn) {
      contextLines.push("Today’s-dollar ending value: " + (sim.finalReal == null ? "—" : fmtMoney(sim.finalReal)));
      contextLines.push("Inflation assumption: " + inflPct);
    }

    return {
      calculatorName: CALC_NAME,
      title: "Retirement Withdrawal Calculator | The Long Math",
      brand: "The Long Math",
      headline: "Retirement Withdrawal Estimate",
      mainValue: sim.depleted ? "~" + fmtYearsApprox(sim.depletionRetirementYears) : fmtMoney(Math.max(0, sim.finalNominal)),
      subline: primaryLine,
      contextLines: contextLines,
      footer: "Run your own numbers at TheLongMath.com",
      shareText: "Retirement withdrawal estimate: " + primaryLine,
      url: url
    };
  }

  function applyQueryToInputs() {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("v") == null) return;
      if (u.searchParams.get("p") != null && Number.isFinite(toNumber(u.searchParams.get("p")))) {
        portfolio.value = String(toNumber(u.searchParams.get("p")));
      }
      if (u.searchParams.get("r") != null && Number.isFinite(toNumber(u.searchParams.get("r")))) {
        annualReturn.value = String(toNumber(u.searchParams.get("r")));
      }
      if (u.searchParams.get("y") != null && Number.isFinite(toNumber(u.searchParams.get("y")))) {
        retirementYears.value = String(toNumber(u.searchParams.get("y")));
      }
      if (u.searchParams.get("f") != null && Number.isFinite(toNumber(u.searchParams.get("f")))) {
        frequency.value = String(Math.round(toNumber(u.searchParams.get("f"))));
      }
      if (u.searchParams.get("t") === "r") {
        if (wtRate) wtRate.checked = true;
        if (wtDollar) wtDollar.checked = false;
      } else {
        if (wtDollar) wtDollar.checked = true;
        if (wtRate) wtRate.checked = false;
      }
      const wq = u.searchParams.get("w");
      if (wq != null) {
        if (u.searchParams.get("t") === "r") withdrawalRate.value = String(wq);
        else withdrawalAmount.value = String(wq);
      }
      if (u.searchParams.get("i") === "0") {
        if (realToggle) realToggle.checked = false;
      } else if (u.searchParams.get("i") === "1") {
        if (realToggle) realToggle.checked = true;
      }
      const irq = u.searchParams.get("ir");
      if (irq != null && Number.isFinite(toNumber(irq))) {
        inflationRate.value = String(toNumber(irq));
      }
    } catch (_e) {
      // ignore
    }
  }

  function update() {
    setError("");
    applyWithdrawalTypeUI();
    applyInflationUI();

    const sim = simulate();
    latestSim = sim.ok ? sim : null;
    if (!sim.ok) {
      if (lblPortfolio) lblPortfolio.textContent = "Starting portfolio";
      if (outPortfolio) outPortfolio.textContent = "—";
      if (outAnnualW) outAnnualW.textContent = "—";
      if (outStartWR) outStartWR.textContent = "—";
      if (outDepletion) outDepletion.textContent = "—";
      if (outEnding) outEnding.textContent = "—";
      if (outRealEnding) outRealEnding.textContent = "—";
      if (resultSummary) resultSummary.textContent = "";
      if (yearTableBody) yearTableBody.innerHTML = "";
      if (shareBlock) shareBlock.classList.remove("is-ready-to-share");
      latestSharePayload = null;
      setShareStatus("");
      setError(sim.error || "Invalid inputs.");
      drawChart(null);
      return;
    }

    if (lblPortfolio) lblPortfolio.textContent = "Starting portfolio";
    if (outPortfolio) outPortfolio.textContent = fmtMoney(sim.portfolioAtStart);
    if (outAnnualW) outAnnualW.textContent = fmtMoney(sim.inputs.annualWithdrawal);
    if (outStartWR) outStartWR.textContent = fmtPct(sim.inputs.startingWR, 2);

    if (outDepletion) {
      if (sim.depleted) {
        outDepletion.textContent = "Depleted after approximately " + fmtYearsApprox(sim.depletionRetirementYears);
      } else {
        outDepletion.textContent = "Lasts full " + sim.inputs.retirementYears + "-year period";
      }
    }

    if (outEnding) {
      outEnding.textContent = fmtMoney(Math.max(0, sim.finalNominal));
    }
    if (outRealEnding) {
      outRealEnding.textContent = sim.inputs.inflOn && sim.finalReal != null ? fmtMoney(sim.finalReal) : "—";
    }

    if (resultSummary) {
      const endBal = fmtMoney(Math.max(0, sim.finalNominal));
      const inflPct = toNumber(inflationRate.value).toFixed(1) + "%";
      if (sim.depleted) {
        resultSummary.textContent =
          "Based on these assumptions, the portfolio is depleted after approximately " + fmtYearsApprox(sim.depletionRetirementYears) +
          ". The selected withdrawal amount does not last for the full " + sim.inputs.retirementYears + "-year period.";
      } else if (sim.inputs.inflOn) {
        resultSummary.textContent =
          "Based on these assumptions, the portfolio lasts the full retirement period and ends with an estimated balance of " + endBal +
          ", equal to about " + fmtMoney(sim.finalReal) + " in today’s dollars using " + inflPct + " inflation.";
      } else {
        resultSummary.textContent =
          "Based on these assumptions, the portfolio lasts the full retirement period and ends with an estimated balance of " + endBal + ".";
      }
      if (sim.inputs.withdrawalType === "rate") {
        resultSummary.textContent +=
          " A " + fmtPct(toNumber(withdrawalRate.value) / 100, 2) + " withdrawal rate equals approximately " +
          fmtMoney(sim.inputs.annualWithdrawal) + " per year, or " + fmtMoney2(sim.inputs.periodicWithdrawal) +
          " per period, based on the starting portfolio value at retirement.";
      }
    }

    renderTable(sim);
    drawChart(sim);
    latestSharePayload = buildSharePayload(sim);
    markShareReady();
    setShareStatus("");
  }

  function renderTable(sim) {
    if (!yearTableBody) return;
    yearTableBody.innerHTML = "";
    for (const row of sim.yearly) {
      const tr = document.createElement("tr");
      const realCell = sim.inputs.inflOn ? "<td>" + fmtMoney(row.endingReal) + "</td>" : "";
      tr.innerHTML = `
        <td>${row.year}</td>
        <td>${fmtMoney(row.starting)}</td>
        <td>${fmtMoney(row.withdrawals)}</td>
        <td>${fmtMoney(row.growth)}</td>
        <td>${fmtMoney(row.ending)}</td>
        ${realCell}
      `;
      yearTableBody.appendChild(tr);
    }
  }

  function drawChart(sim) {
    if (!chartCanvas) return;
    const ctx = chartCanvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = chartCanvas.getBoundingClientRect();
    const wCss = Math.max(200, Math.floor(rect.width));
    const hCss = Math.max(180, Math.floor(rect.height));
    chartCanvas.width = Math.floor(wCss * dpr);
    chartCanvas.height = Math.floor(hCss * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, wCss, hCss);

    if (!sim || !sim.chart || !sim.chart.years.length) {
      ctx.fillStyle = "rgba(238,242,247,0.7)";
      ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("Enter valid inputs to see the chart.", 12, 24);
      return;
    }

    const years = sim.chart.years;
    const nom = sim.chart.nominal;
    const real = sim.chart.real;
    const showReal = sim.inputs.inflOn && real && real.length === nom.length;
    if (chartLegendReal) chartLegendReal.classList.toggle("hidden", !showReal);

    const maxY = Math.max(1, ...nom.map((x) => Math.max(0, x)), showReal ? Math.max(0, ...real) : 0);
    const padL = 58;
    const padR = 10;
    const padT = 8;
    const padB = 30;
    const plotW = wCss - padL - padR;
    const plotH = hCss - padT - padB;
    const n = years.length;
    const barW = n > 0 ? (plotW / n) * 0.55 : 6;
    const step = n > 0 ? plotW / n : plotW;

    // Axes
    ctx.strokeStyle = "rgba(238,242,247,0.2)";
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // Y tick labels
    ctx.fillStyle = "rgba(238,242,247,0.7)";
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const ticks = 4;
    for (var t0 = 0; t0 <= ticks; t0 += 1) {
      const frac = t0 / ticks;
      const val = maxY * (1 - frac);
      const y = padT + plotH * frac;
      ctx.fillText(fmtMoney(val), 4, y + 3);
    }

    // Bars (nominal)
    for (var i = 0; i < n; i += 1) {
      const x0 = padL + i * step + (step - barW) / 2;
      const h = (Math.max(0, nom[i]) / maxY) * plotH;
      const y = padT + (plotH - h);
      ctx.fillStyle = "rgba(217, 180, 106, 0.92)";
      ctx.fillRect(x0, y, barW, h);
    }

    // Real line
    if (showReal) {
      ctx.strokeStyle = "rgba(120, 200, 255, 0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (var j = 0; j < n; j += 1) {
        const cx = padL + j * step + step / 2;
        const h2 = (Math.max(0, real[j]) / maxY) * plotH;
        const y2 = padT + (plotH - h2);
        if (j === 0) ctx.moveTo(cx, y2);
        else ctx.lineTo(cx, y2);
      }
      ctx.stroke();
    }

    // X labels (sparse)
    ctx.fillStyle = "rgba(238,242,247,0.7)";
    const maxLabels = 8;
    const stepL = Math.max(1, Math.ceil(n / maxLabels));
    for (var k = 0; k < n; k += stepL) {
      const x = padL + k * step + 4;
      ctx.fillText(String(years[k]), x, padT + plotH + 18);
    }

    chartCanvas._rwMeta = { sim: sim, padL, padT, plotW, plotH, step, n, showReal, maxY };
  }

  function onChartMove(ev) {
    const meta = chartCanvas && chartCanvas._rwMeta;
    if (!meta || !chartTooltip) return;
    const clientX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX);
    const clientY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY);
    if (clientX == null || clientY == null) return;
    const rect = chartCanvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < meta.padL || x > meta.padL + meta.plotW) {
      chartTooltip.style.display = "none";
      return;
    }
    const idx = Math.floor((x - meta.padL) / meta.step);
    if (idx < 0 || idx >= meta.n) {
      chartTooltip.style.display = "none";
      return;
    }
    const yr = meta.sim.chart.years[idx];
    const nBal = meta.sim.chart.nominal[idx];
    var html = "<strong>Year " + yr + "</strong><br>";
    html += "Nominal balance: " + fmtMoney(nBal) + "<br>";
    if (meta.showReal) {
      html += "Inflation-adjusted balance: " + fmtMoney(meta.sim.chart.real[idx]) + "<br>";
    }
    chartTooltip.innerHTML = html;
    chartTooltip.style.display = "block";
    const tx = clamp(x + 12, 8, rect.width - 200);
    const ty = clamp(y + 12, 8, rect.height - 60);
    chartTooltip.style.left = tx + "px";
    chartTooltip.style.top = ty + "px";
  }

  function onChartLeave() {
    if (chartTooltip) chartTooltip.style.display = "none";
  }

  function exportCsv() {
    if (!latestSim) return;
    const sim = latestSim;
    const rows = [];
    rows.push("Retirement Withdrawal Calculator (export)");
    rows.push("Generated: " + new Date().toISOString());
    rows.push("Query: sver=" + SCRIPT_VER);
    rows.push("Starting portfolio at retirement: " + String(Math.round(sim.portfolioAtStart)));
    rows.push("Annual return (nominal): " + (sim.inputs.rA * 100).toFixed(3) + "%");
    rows.push("Periods per year: " + String(sim.inputs.ppy));
    rows.push("Annual withdrawal: " + String(Math.round(sim.inputs.annualWithdrawal)));
    rows.push("Starting withdrawal rate: " + (sim.inputs.startingWR * 100).toFixed(3) + "%");
    if (sim.inputs.inflOn) {
      rows.push("Inflation (display only): " + (sim.inputs.infl * 100).toFixed(3) + "%");
    }
    rows.push("");
    if (sim.inputs.inflOn) {
      rows.push("Year,Starting balance,Withdrawals,Investment growth,Ending balance,Inflation-adjusted ending balance");
    } else {
      rows.push("Year,Starting balance,Withdrawals,Investment growth,Ending balance");
    }
    for (const r of sim.yearly) {
      if (sim.inputs.inflOn) {
        rows.push(
          r.year + "," + Math.round(r.starting) + "," + Math.round(r.withdrawals) + "," + Math.round(r.growth) + "," + Math.round(r.ending) + "," + Math.round(r.endingReal)
        );
      } else {
        rows.push(
          r.year + "," + Math.round(r.starting) + "," + Math.round(r.withdrawals) + "," + Math.round(r.growth) + "," + Math.round(r.ending)
        );
      }
    }
    const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "thelongmath-retirement-withdrawal-results.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function wireShareButtons() {
    if (!window.TLM || !window.TLM.shareCard) return;
    if (shareBtn) {
      shareBtn.addEventListener("click", async function () {
        if (!latestSharePayload) return;
        setShareStatus("Preparing image...");
        window.TLM.shareCard.track("calculator_result_share_clicked", { calculator_name: latestSharePayload.calculatorName });
        try {
          const result = await window.TLM.shareCard.shareResultCard(latestSharePayload);
          if (result && result.mode === "download-and-copy-fallback") {
            if (result.copied) setShareStatus("Shared via fallback: calculation image opened/saved and scenario link copied.");
            else setShareStatus("Calculation image opened/saved. Copy shareable link manually if needed.");
          } else if (result && result.mode === "native-share-link") {
            setShareStatus("Share dialog opened with result summary and scenario link.");
          } else {
            setShareStatus("Share dialog opened with image, summary, and scenario link.");
          }
        } catch (_e) {
          setShareStatus("Share cancelled or unavailable. Try Save this calculation instead.", true);
        }
      });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener("click", async function () {
        if (!latestSharePayload) return;
        setShareStatus("Preparing image...");
        try {
          await window.TLM.shareCard.downloadResultCard(latestSharePayload);
          setShareStatus("Calculation image saved.");
        } catch (_e) {
          setShareStatus("Could not prepare image. Please try again.", true);
        }
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", async function () {
        if (!latestSharePayload) return;
        try {
          await window.TLM.shareCard.copyResultLink(latestSharePayload);
          setShareStatus("Shareable link copied.");
        } catch (_e) {
          setShareStatus("Could not copy link on this browser.", true);
        }
      });
    }
  }

  function wire() {
    [
      portfolio, annualReturn, retirementYears, withdrawalAmount, withdrawalRate, frequency, inflationRate,
      wtDollar, wtRate, realToggle
    ].forEach((elx) => {
      if (!elx) return;
      elx.addEventListener("input", update);
      elx.addEventListener("change", update);
    });

    if (chartCanvas) {
      chartCanvas.addEventListener("mousemove", onChartMove);
      chartCanvas.addEventListener("mouseleave", onChartLeave);
      chartCanvas.addEventListener("touchstart", onChartMove, { passive: true });
      chartCanvas.addEventListener("touchmove", onChartMove, { passive: true });
    }
    window.addEventListener("resize", function () {
      if (latestSim) drawChart(latestSim);
    });

    if (exportBtn) exportBtn.addEventListener("click", exportCsv);
    wireShareButtons();
    applyQueryToInputs();
    update();
  }

  wire();
})();
