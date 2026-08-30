// Investment Calculator - Inflation Adjusted
// Uses shared InvestmentGrowthEngine
(function () {
  "use strict";

  var Engine = window.InvestmentGrowthEngine;
  if (!Engine) {
    console.error("InvestmentGrowthEngine not loaded");
    return;
  }

  var el = function (id) { return document.getElementById(id); };

  var startingAmount = el("startingAmount");
  var monthlyContribution = el("monthlyContribution");
  var timeHorizon = el("timeHorizon");
  var expectedReturn = el("expectedReturn");
  var inflationRate = el("inflationRate");
  var contributionFrequency = el("contributionFrequency");
  var contributionTiming = el("contributionTiming");
  var contributionLabel = el("contributionLabel");

  if (!startingAmount || !monthlyContribution || !timeHorizon || !expectedReturn ||
      !inflationRate || !contributionFrequency || !contributionTiming) {
    console.error("Required input elements not found");
    return;
  }

  var finalBalanceReal = el("finalBalanceReal");
  var finalBalanceNominal = el("finalBalanceNominal");
  var breakdownStarting = el("breakdownStarting");
  var breakdownContributions = el("breakdownContributions");
  var breakdownGrowth = el("breakdownGrowth");
  var barStarting = el("barStarting");
  var barContributions = el("barContributions");
  var barGrowth = el("barGrowth");
  var scheduleBody = el("scheduleBody");
  var scheduleViewRadios = document.querySelectorAll('input[name="scheduleView"]');
  var scheduleToggleButton = el("scheduleToggleButton");

  var showFullSchedule = false;
  var lastResults = null;

  function toNumber(v) {
    if (window.TLM && window.TLM.calcInputs && typeof window.TLM.calcInputs.parseNumber === "function") {
      return window.TLM.calcInputs.parseNumber(v, 2);
    }
    var x = Number(String(v).trim().replace(/,/g, ""));
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function fmtMoney(x) {
    if (window.TLM && window.TLM.calcInputs && typeof window.TLM.calcInputs.formatMoney === "function") {
      return window.TLM.calcInputs.formatMoney(x, 2);
    }
    return "$" + new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(x);
  }

  function getContributionPeriodsPerYear() {
    return contributionFrequency.value === "monthly" ? 12 : 1;
  }

  function updateContributionLabel() {
    if (contributionLabel) {
      contributionLabel.textContent = contributionFrequency.value === "monthly"
        ? "Monthly contribution"
        : "Yearly contribution";
    }
  }

  function readInputs() {
    return {
      startingAmount: toNumber(startingAmount.value),
      contributionPerPeriod: toNumber(monthlyContribution.value),
      years: toNumber(timeHorizon.value),
      nominalAnnualReturn: toNumber(expectedReturn.value) / 100,
      inflationAnnual: toNumber(inflationRate.value) / 100,
      contributionPeriodsPerYear: getContributionPeriodsPerYear(),
      contributionAtBeginning: contributionTiming.value === "beginning",
      indexContributionsToInflation: true,
    };
  }

  function simulateInvestment() {
    return Engine.simulateInvestment(readInputs());
  }

  function updateDisplay() {
    var results = simulateInvestment();
    lastResults = results;

    if (results.error) {
      finalBalanceReal.textContent = results.error;
      finalBalanceNominal.textContent = "—";
      breakdownStarting.textContent = "—";
      breakdownContributions.textContent = "—";
      breakdownGrowth.textContent = "—";
      barStarting.style.width = "0%";
      barContributions.style.width = "0%";
      barGrowth.style.width = "0%";
      scheduleBody.innerHTML = "";
      if (scheduleToggleButton) scheduleToggleButton.style.display = "none";
      return;
    }

    finalBalanceReal.textContent = fmtMoney(results.finalBalanceReal);
    finalBalanceNominal.textContent = fmtMoney(results.finalBalanceNominal);

    breakdownStarting.textContent = fmtMoney(results.startingAmount);
    breakdownContributions.textContent = fmtMoney(results.totalContributions);
    breakdownGrowth.textContent = fmtMoney(results.growth);

    var positiveStarting = Math.max(0, results.startingAmount);
    var positiveContrib = Math.max(0, results.totalContributions);
    var positiveGrowth = Math.max(0, results.growth);
    var totalPositive = positiveStarting + positiveContrib + positiveGrowth;
    if (totalPositive > 0) {
      barStarting.style.width = ((positiveStarting / totalPositive) * 100) + "%";
      barContributions.style.width = ((positiveContrib / totalPositive) * 100) + "%";
      barGrowth.style.width = ((positiveGrowth / totalPositive) * 100) + "%";
    } else {
      barStarting.style.width = "0%";
      barContributions.style.width = "0%";
      barGrowth.style.width = "0%";
    }

    updateSchedule(results);
  }

  function updateSchedule(results) {
    if (!results || results.error) {
      scheduleBody.innerHTML = "";
      if (scheduleToggleButton) scheduleToggleButton.style.display = "none";
      return;
    }
    var isMonthly = scheduleViewRadios[1] && scheduleViewRadios[1].checked;
    var contribPeriodsPerYear = getContributionPeriodsPerYear();
    var scheduleData = (isMonthly && contribPeriodsPerYear === 12 && results.monthlySchedule.length > 0)
      ? results.monthlySchedule
      : results.schedule;

    var maxRowsCollapsed = 6;
    var rowsToRender = showFullSchedule ? scheduleData : scheduleData.slice(0, maxRowsCollapsed);

    scheduleBody.innerHTML = "";

    if (isMonthly && contribPeriodsPerYear === 12 && results.monthlySchedule.length > 0) {
      rowsToRender.forEach(function (entry) {
        var cashFlow = entry.netCashFlow != null ? entry.netCashFlow : entry.contributions;
        var row = document.createElement("tr");
        row.innerHTML =
          "<td>" + entry.period + "</td>" +
          "<td>" + fmtMoney(cashFlow) + "</td>" +
          "<td>" + fmtMoney(entry.growth) + "</td>" +
          "<td>" + fmtMoney(entry.balance) + "</td>";
        scheduleBody.appendChild(row);
      });
    } else {
      rowsToRender.forEach(function (entry) {
        var cashFlow = entry.netCashFlow != null ? entry.netCashFlow : entry.contributions;
        var row = document.createElement("tr");
        row.innerHTML =
          "<td>" + entry.year + "</td>" +
          "<td>" + fmtMoney(cashFlow) + "</td>" +
          "<td>" + fmtMoney(entry.growth) + "</td>" +
          "<td>" + fmtMoney(entry.balance) + "</td>";
        scheduleBody.appendChild(row);
      });
    }

    if (scheduleToggleButton) {
      if (scheduleData.length > maxRowsCollapsed) {
        scheduleToggleButton.style.display = "inline-flex";
        scheduleToggleButton.textContent = showFullSchedule ? "Show fewer rows" : "Show full schedule";
      } else {
        scheduleToggleButton.style.display = "none";
      }
    }
  }

  function exportCSV() {
    var results = simulateInvestment();
    var inputs = readInputs();
    if (results.error) return;
    var csv = "# Investment Calculator - Inflation Adjusted Results\n";
    csv += "# Generated: " + new Date().toLocaleString() + "\n";
    csv += "#\n";
    csv += "# Inputs:\n";
    csv += "# Starting Amount," + fmtMoney(inputs.startingAmount).replace(/[$,]/g, "") + "\n";
    csv += "# Contribution per period (today's dollars)," + fmtMoney(inputs.contributionPerPeriod).replace(/[$,]/g, "") + "\n";
    csv += "# Time Horizon (years)," + inputs.years + "\n";
    csv += "# Expected Annual Return (nominal)," + (inputs.nominalAnnualReturn * 100) + "%\n";
    csv += "# Assumed Inflation Rate," + (inputs.inflationAnnual * 100) + "%\n";
    csv += "# Contribution Frequency," + (inputs.contributionPeriodsPerYear === 12 ? "Monthly" : "Yearly") + "\n";
    csv += "# Contribution Timing," + (inputs.contributionAtBeginning ? "Beginning of period" : "End of period") + "\n";
    csv += "# Contributions indexed to inflation,yes\n";
    csv += "#\n";
    csv += "# Results:\n";
    csv += "# Final Balance (Inflation-Adjusted)," + fmtMoney(results.finalBalanceReal).replace(/[$,]/g, "") + "\n";
    csv += "# Final Balance (Nominal)," + fmtMoney(results.finalBalanceNominal).replace(/[$,]/g, "") + "\n";
    csv += "#\n";
    csv += "Year,Contributions (real),Growth (real),Ending Balance (real)\n";
    results.schedule.forEach(function (entry) {
      var cashFlow = entry.netCashFlow != null ? entry.netCashFlow : entry.contributions;
      csv += entry.year + ",";
      csv += fmtMoney(cashFlow).replace(/[$,]/g, "") + ",";
      csv += fmtMoney(entry.growth).replace(/[$,]/g, "") + ",";
      csv += fmtMoney(entry.balance).replace(/[$,]/g, "") + "\n";
    });

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", "investment-calculator-results.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  [
    startingAmount,
    monthlyContribution,
    timeHorizon,
    expectedReturn,
    inflationRate,
    contributionFrequency,
    contributionTiming,
  ].filter(function (node) { return node !== null; }).forEach(function (node) {
    node.addEventListener("input", updateDisplay);
  });

  if (contributionFrequency) {
    contributionFrequency.addEventListener("change", function () {
      updateContributionLabel();
      updateDisplay();
    });
  }

  scheduleViewRadios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      showFullSchedule = false;
      updateDisplay();
    });
  });

  if (scheduleToggleButton) {
    scheduleToggleButton.addEventListener("click", function () {
      if (!lastResults || lastResults.error) return;
      showFullSchedule = !showFullSchedule;
      updateSchedule(lastResults);
    });
  }

  var printButton = el("printButton");
  var exportCSVButton = el("exportCSVButton");
  if (printButton) printButton.addEventListener("click", function () { window.print(); });
  if (exportCSVButton) exportCSVButton.addEventListener("click", exportCSV);

  updateContributionLabel();
  updateDisplay();
})();
