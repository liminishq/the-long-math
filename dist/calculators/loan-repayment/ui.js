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

  function fmtCurrency(n) {
    if (!Number.isFinite(n)) return "$—";
    return n.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function fmtNumber(n) {
    if (!Number.isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-CA");
  }

  // -----------------------------
  // State for charts
  // -----------------------------
  let paymentChart = null;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    if (!hex) return "";
    const cleaned = hex.replace("#", "");
    if (cleaned.length !== 6 && cleaned.length !== 3) return "";
    const full = cleaned.length === 3
      ? cleaned.split("").map(ch => ch + ch).join("")
      : cleaned;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function ensureCharts() {
    if (typeof Chart === "undefined") {
      return;
    }

    const ctx = document.getElementById("chart-payment-composition");

    if (ctx && !paymentChart) {
      const ctx2d = ctx.getContext("2d");

      paymentChart = new Chart(ctx2d, {
        type: "line",
          data: {
          labels: [],
          datasets: [
            // Dataset 0: Interest area (from 0 up to interest line)
            {
              label: "Interest (per payment)",
              data: [],
              borderColor: cssVar("--chart-interest-line") || "#D3C3B1",
              backgroundColor: cssVar("--chart-interest-fill") || "rgba(211,195,177,0.35)",
              fill: "origin",
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 3,
              borderWidth: 1.5,
              yAxisID: "payment",
            },
            // Dataset 1: Principal area (from interest line up to principal line)
            {
              label: "Principal (per payment)",
              data: [],
              borderColor: cssVar("--chart-principal-line") || "#9CB3CB",
              backgroundColor: cssVar("--chart-principal-fill") || "rgba(156,179,203,0.35)",
              fill: "-1", // fill between this line and previous (interest) line
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 3,
              borderWidth: 1.5,
              yAxisID: "payment",
            },
            // Dataset 2: Remaining principal curve (no fill, separate axis)
            {
              label: "Remaining principal",
              data: [],
              borderColor: cssVar("--chart-balance-line") || "#F2C94C",
              backgroundColor: "transparent",
              fill: false,
              borderWidth: 2,
              tension: 0.25,
              pointRadius: 0,
              pointHoverRadius: 3,
              yAxisID: "balance",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: { top: 6, right: 10, bottom: 6, left: 10 },
          },
          scales: {
            x: {
              stacked: false,
              ticks: {
                autoSkip: false,
                maxTicksLimit: 20,
                minRotation: 0,
                maxRotation: 0,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                font: {
                  size: 9,
                },
                callback: function (value, index) {
                  const labels = paymentChart.data.labels || [];
                  const raw = labels[index];
                  if (!Number.isFinite(raw) || !paymentChart.$paymentsPerYear) return "";
                  const year = raw / paymentChart.$paymentsPerYear;
                  if (year < 0) return "";
                  // Show 0 and then every 5 years up to the term
                  if (Math.abs(year) < 1e-8) return "0";
                  if (Math.abs(Math.round(year / 5) * 5 - year) < 1e-8 && year <= (paymentChart.$totalYears || year)) {
                    return String(Math.round(year));
                  }
                  return "";
                },
              },
              title: {
                display: true,
                text: "Years",
                color: cssVar("--chart-axis-dim") || cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                font: {
                  size: 10,
                },
              },
              grid: {
                color: cssVar("--chart-grid") || "rgba(255,255,255,0.08)",
                lineWidth: 1,
                drawBorder: false,
              },
              border: {
                display: false,
              },
            },
            payment: {
              stacked: true,
              position: "left",
              ticks: {
                maxTicksLimit: 6,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                font: {
                  size: 8,
                },
                callback: function () {
                  // Hide numeric labels for payment axis (y) for a cleaner visual
                  return "";
                },
              },
              grid: {
                color: cssVar("--chart-grid") || "rgba(255,255,255,0.08)",
                lineWidth: 1,
                drawBorder: false,
              },
              border: {
                display: false,
              },
              title: { display: false },
            },
            balance: {
              stacked: false,
              position: "right",
              ticks: {
                maxTicksLimit: 6,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                font: {
                  size: 8,
                },
                callback: function () {
                  // Hide numeric labels; curve shape communicates scale
                  return "";
                },
              },
              grid: {
                drawOnChartArea: false,
                drawBorder: false,
              },
              border: {
                display: false,
              },
              title: {
                display: true,
                text: "Remaining principal",
                color: cssVar("--chart-axis-dim") || cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                font: {
                  size: 10,
                },
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: {
                usePointStyle: true,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                boxWidth: 10,
                padding: 10,
                font: {
                  size: 10,
                },
              },
            },
            tooltip: {
              callbacks: {
                title: function (items) {
                  if (!items || !items.length) return "";
                  const idx = items[0].dataIndex;
                  const labels = paymentChart.data.labels || [];
                  const raw = labels[idx];
                  if (!Number.isFinite(raw) || !paymentChart.$paymentsPerYear) return "";
                  const year = raw / paymentChart.$paymentsPerYear;
                  return "Year " + year.toFixed(2);
                },
                label: function (ctx) {
                  return ctx.dataset.label + ": " + fmtCurrency(ctx.parsed.y);
                },
              },
            },
          },
        },
      });

      // Theme-aware reapplication of colors when theme toggles
      const rootEl = document.documentElement;
      const observer = new MutationObserver(function (mutations) {
        for (const m of mutations) {
          if (m.type === "attributes" && m.attributeName === "data-theme") {
            if (!paymentChart) return;

            const balanceLine = cssVar("--chart-balance-line") || "#F2C94C";
            const principalLine = cssVar("--chart-principal-line") || "#9CB3CB";
            const principalFill = cssVar("--chart-principal-fill") || "rgba(156,179,203,0.35)";
            const interestLine = cssVar("--chart-interest-line") || "#D3C3B1";
            const interestFill = cssVar("--chart-interest-fill") || "rgba(211,195,177,0.35)";
            const gridColor = cssVar("--chart-grid") || "rgba(255,255,255,0.08)";
            const axisColor = cssVar("--chart-axis") || "rgba(255,255,255,0.72)";
            const axisDim = cssVar("--chart-axis-dim") || axisColor;

            // Dataset 0: interest
            paymentChart.data.datasets[0].borderColor = interestLine;
            paymentChart.data.datasets[0].backgroundColor = interestFill;
            // Dataset 1: principal
            paymentChart.data.datasets[1].borderColor = principalLine;
            paymentChart.data.datasets[1].backgroundColor = principalFill;
            // Dataset 2: remaining principal curve
            paymentChart.data.datasets[2].borderColor = balanceLine;

            const scales = paymentChart.options.scales;
            if (scales && scales.x && scales.payment && scales.balance) {
              scales.x.ticks.color = axisColor;
              scales.x.title.color = axisDim;
              scales.x.grid.color = gridColor;
              scales.payment.ticks.color = axisColor;
              scales.payment.grid.color = gridColor;
              scales.balance.ticks.color = axisColor;
              scales.balance.title.color = axisDim;
            }

            if (paymentChart.options.plugins && paymentChart.options.plugins.legend && paymentChart.options.plugins.legend.labels) {
              paymentChart.options.plugins.legend.labels.color = axisColor;
            }

            paymentChart.update();
            break;
          }
        }
      });

      observer.observe(rootEl, { attributes: true, attributeFilter: ["data-theme"] });
    }
  }

  // -----------------------------
  // Validation helpers
  // -----------------------------
  function setFieldError(id, hasError, message) {
    const field = document.getElementById("field-" + id);
    const errorEl = document.getElementById("error-" + id);
    if (!field || !errorEl) return;

    if (hasError) {
      field.classList.add("loan-field-error");
      errorEl.style.display = "";
      if (message) errorEl.textContent = message;
    } else {
      field.classList.remove("loan-field-error");
      errorEl.style.display = "none";
    }
  }

  function readInputs() {
    const principal = num($("loanPrincipal").value);
    const annualRatePct = num($("annualRate").value);
    const years = num($("loanYears").value);
    const paymentsPerYear = num($("paymentFrequency").value);

    let hasError = false;

    if (!Number.isFinite(principal) || principal <= 0) {
      hasError = true;
      setFieldError("principal", true, "Principal must be greater than zero.");
    } else {
      setFieldError("principal", false);
    }

    if (!Number.isFinite(annualRatePct) || annualRatePct < 0) {
      hasError = true;
      setFieldError("rate", true, "Rate cannot be negative.");
    } else {
      setFieldError("rate", false);
    }

    if (!Number.isFinite(years) || years <= 0) {
      hasError = true;
      setFieldError("years", true, "Term must be greater than zero.");
    } else {
      setFieldError("years", false);
    }

    if (!Number.isFinite(paymentsPerYear) || paymentsPerYear <= 0) {
      hasError = true;
      setFieldError("frequency", true, "Choose a payment frequency.");
    } else {
      setFieldError("frequency", false);
    }

    return {
      principal,
      annualRatePct,
      years,
      paymentsPerYear,
      hasError,
    };
  }

  // -----------------------------
  // Render functions
  // -----------------------------
  function renderSchedule(scheduleRows, totalsRow) {
    const tbody = $("amortization-body");

    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }

    if (!Array.isArray(scheduleRows) || scheduleRows.length === 0) {
      return;
    }

    scheduleRows.forEach(function (row) {
      const tr = document.createElement("tr");

      const tdLabel = document.createElement("td");
      tdLabel.textContent = row.label;
      tr.appendChild(tdLabel);

      const tdPayment = document.createElement("td");
      tdPayment.textContent = fmtCurrency(row.payment);
      tr.appendChild(tdPayment);

      const tdInterest = document.createElement("td");
      tdInterest.textContent = fmtCurrency(row.interest);
      tr.appendChild(tdInterest);

      const tdPrincipal = document.createElement("td");
      tdPrincipal.textContent = fmtCurrency(row.principalPaid);
      tr.appendChild(tdPrincipal);

      const tdBalance = document.createElement("td");
      tdBalance.textContent = fmtCurrency(Math.max(0, row.balance));
      tr.appendChild(tdBalance);

      tbody.appendChild(tr);
    });

    $("totals-payment").textContent = fmtCurrency(totalsRow.payment);
    $("totals-interest").textContent = fmtCurrency(totalsRow.interest);
    $("totals-principal").textContent = fmtCurrency(totalsRow.principalPaid);
    $("totals-balance").textContent = fmtCurrency(0);
  }

  function renderCharts(scheduleRows, principal, totalInterest, paymentsPerYear, years) {
    ensureCharts();

    if (paymentChart && Array.isArray(scheduleRows) && scheduleRows.length > 0) {
      const labels = [0];
      const balanceSeries = [principal];
      const interestSeries = [0];
      const principalSeries = [0];

      scheduleRows.forEach(function (row, idx) {
        const k = idx + 1;
        labels.push(k);
        interestSeries.push(row.interest);
        principalSeries.push(row.principalPaid);
        balanceSeries.push(Math.max(0, row.balance));
      });

      // Store frequency + term for axis/tooltip formatting
      paymentChart.$paymentsPerYear = paymentsPerYear;
      paymentChart.$totalYears = years;

      paymentChart.data.labels = labels;
      // Dataset order: 0 = interest, 1 = principal, 2 = remaining principal curve
      paymentChart.data.datasets[0].data = interestSeries;
      paymentChart.data.datasets[1].data = principalSeries;
      paymentChart.data.datasets[2].data = balanceSeries;

      // Lock balance axis to [0, principal] so the curve intercepts at the top of the plot area
      if (paymentChart.options && paymentChart.options.scales && paymentChart.options.scales.balance) {
        const balanceScale = paymentChart.options.scales.balance;
        balanceScale.min = 0;
        balanceScale.max = principal > 0 ? principal : undefined;
      }

      paymentChart.update();
    }
  }

  function renderResults(engineResult, inputs) {
    if (!engineResult) {
      $("out-payment").textContent = "$—";
      $("out-total-paid").textContent = "$—";
      $("out-total-interest").textContent = "$—";
      $("out-num-payments").textContent = "—";
      $("results-caption").textContent =
        "With these inputs: a $P loan at r% annual interest over term years, paid frequency.";
      return;
    }

    $("out-payment").textContent = fmtCurrency(engineResult.paymentPerPeriod);
    $("out-total-paid").textContent = fmtCurrency(engineResult.totalPaid);
    $("out-total-interest").textContent = fmtCurrency(engineResult.totalInterest);
    $("out-num-payments").textContent = fmtNumber(engineResult.numPayments);

    var freqLabel = "Monthly (12)";
    if (inputs.paymentsPerYear === 26) freqLabel = "Biweekly (26)";
    else if (inputs.paymentsPerYear === 52) freqLabel = "Weekly (52)";

    $("results-caption").textContent =
      "With these inputs: a " +
      fmtCurrency(inputs.principal) +
      " loan at " +
      inputs.annualRatePct.toFixed(2) +
      "% annual interest over " +
      inputs.years.toFixed(2) +
      " years, paid " +
      freqLabel +
      ".";
  }

  // -----------------------------
  // Main render pipeline
  // -----------------------------
  function render() {
    const inp = readInputs();

    if (inp.hasError || typeof window.computeLoanSchedule !== "function") {
      renderResults(null, inp);
      renderSchedule([], {
        payment: 0,
        interest: 0,
        principalPaid: 0,
      });
      renderCharts([], 0, 0, inp.paymentsPerYear || 12, inp.years || 0);
      return;
    }

    const result = window.computeLoanSchedule({
      principal: inp.principal,
      annualRatePct: inp.annualRatePct,
      years: inp.years,
      paymentsPerYear: inp.paymentsPerYear,
    });

    renderResults(result, inp);
    renderSchedule(result.scheduleRows, result.totalsRow);
    renderCharts(result.scheduleRows, inp.principal, result.totalInterest, inp.paymentsPerYear, inp.years);
  }

  // -----------------------------
  // Wire events
  // -----------------------------
  function wire() {
    ["loanPrincipal", "annualRate", "loanYears", "paymentFrequency"].forEach(function (id) {
      $(id).addEventListener("input", render);
      $(id).addEventListener("change", render);
    });

    ensureCharts();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();

