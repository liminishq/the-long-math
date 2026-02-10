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
            {
              label: "Interest",
              data: [],
              borderColor: cssVar("--chart-interest-line") || "#D3C3B1",
              backgroundColor: cssVar("--chart-interest-fill") || "rgba(211,195,177,0.35)",
              fill: true,
              stack: "payment",
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 3,
            },
            {
              label: "Principal",
              data: [],
              borderColor: cssVar("--chart-principal-line") || "#9CB3CB",
              backgroundColor: cssVar("--chart-principal-fill") || "rgba(156,179,203,0.35)",
              fill: true,
              stack: "payment",
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 3,
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
              stacked: true,
              ticks: {
                autoSkip: true,
                maxTicksLimit: 7,
                minRotation: 0,
                maxRotation: 0,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                callback: function (value, index) {
                  const labelValue = paymentChart.data.labels[index];
                  return labelValue;
                },
              },
              title: {
                display: true,
                text: "Payment #",
                color: cssVar("--chart-axis-dim") || cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
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
            y: {
              stacked: true,
              ticks: {
                maxTicksLimit: 6,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                callback: function (value) {
                  return fmtCurrency(value);
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
          },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: {
                usePointStyle: true,
                color: cssVar("--chart-axis") || "rgba(255,255,255,0.72)",
                boxWidth: 10,
                padding: 14,
              },
            },
            tooltip: {
              callbacks: {
                title: function (items) {
                  if (!items || !items.length) return "";
                  const idx = items[0].dataIndex;
                  const prefix = paymentChart && paymentChart.$freqPrefix ? paymentChart.$freqPrefix : "";
                  const labelValue = paymentChart.data.labels[idx];
                  return prefix + labelValue;
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

            const principalLine = cssVar("--chart-principal-line") || "#9CB3CB";
            const principalFill = cssVar("--chart-principal-fill") || "rgba(156,179,203,0.35)";
            const interestLine = cssVar("--chart-interest-line") || "#D3C3B1";
            const interestFill = cssVar("--chart-interest-fill") || "rgba(211,195,177,0.35)";
            const gridColor = cssVar("--chart-grid") || "rgba(255,255,255,0.08)";
            const axisColor = cssVar("--chart-axis") || "rgba(255,255,255,0.72)";
            const axisDim = cssVar("--chart-axis-dim") || axisColor;

            paymentChart.data.datasets[0].borderColor = interestLine;
            paymentChart.data.datasets[0].backgroundColor = interestFill;
            paymentChart.data.datasets[1].borderColor = principalLine;
            paymentChart.data.datasets[1].backgroundColor = principalFill;

            const scales = paymentChart.options.scales;
            if (scales && scales.x && scales.y) {
              scales.x.ticks.color = axisColor;
              scales.x.title.color = axisDim;
              scales.x.grid.color = gridColor;
              scales.y.ticks.color = axisColor;
              scales.y.grid.color = gridColor;
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

  function renderCharts(scheduleRows, principal, totalInterest, paymentsPerYear) {
    ensureCharts();

    if (paymentChart && Array.isArray(scheduleRows) && scheduleRows.length > 0) {
      const labels = scheduleRows.map(function (_, idx) {
        return idx + 1;
      });
      const interestSeries = scheduleRows.map(function (row) {
        return row.interest;
      });
      const principalSeries = scheduleRows.map(function (row) {
        return row.principalPaid;
      });

      // Set frequency prefix for tick/tooltip formatting
      paymentChart.$freqPrefix = paymentsPerYear === 12 ? "M" : "W";

      paymentChart.data.labels = labels;
      paymentChart.data.datasets[0].data = interestSeries;
      paymentChart.data.datasets[1].data = principalSeries;
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
      renderCharts([], 0, 0, inp.paymentsPerYear || 12);
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
    renderCharts(result.scheduleRows, inp.principal, result.totalInterest, inp.paymentsPerYear);
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

