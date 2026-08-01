(function () {
  "use strict";

  if (window.TLM && window.TLM.calculatorInDevelopment) {
    return;
  }

  var Engine = window.InvestmentGrowthEngine;
  if (!Engine) {
    console.error("InvestmentGrowthEngine not loaded");
    return;
  }

  var el = function (id) { return document.getElementById(id); };

  var startingAmount = el("startingAmount");
  var targetBalance = el("targetBalance");
  var contributionAmount = el("contributionAmount");
  var timeHorizon = el("timeHorizon");
  var inflationRate = el("inflationRate");
  var contributionFrequency = el("contributionFrequency");
  var contributionTiming = el("contributionTiming");
  var contributionLabel = el("contributionLabel");

  var requiredReturnNominal = el("requiredReturnNominal");
  var requiredReturnReal = el("requiredReturnReal");
  var targetNominalEquivalent = el("targetNominalEquivalent");
  var returnWarning = el("returnWarning");
  var shortfallWarning = el("shortfallWarning");
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
  var lastSolve = null;
  var latestSharePayload = null;

  function toNumber(v) {
    var x = Number(String(v).trim().replace(/,/g, ""));
    return Number.isFinite(x) ? x : 0;
  }

  function fmtMoney(x) {
    return "$" + new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(x);
  }

  function fmtPct(x) {
    return (x * 100).toFixed(2) + "%";
  }

  function getContributionPeriodsPerYear() {
    return contributionFrequency.value === "monthly" ? 12 : 1;
  }

  function updateContributionLabel() {
    if (contributionLabel) {
      if (isFrench()) {
        contributionLabel.textContent = contributionFrequency.value === "monthly"
          ? "Cotisation mensuelle (dollars d'aujourd'hui)"
          : "Cotisation annuelle (dollars d'aujourd'hui)";
      } else {
        contributionLabel.textContent = contributionFrequency.value === "monthly"
          ? "Monthly contribution (today's dollars)"
          : "Yearly contribution (today's dollars)";
      }
    }
  }

  function readInputs() {
    return {
      startingAmount: Math.max(0, toNumber(startingAmount.value)),
      contributionPerPeriod: toNumber(contributionAmount.value),
      years: toNumber(timeHorizon.value),
      inflationAnnual: Math.max(0, toNumber(inflationRate.value) / 100),
      contributionPeriodsPerYear: getContributionPeriodsPerYear(),
      contributionAtBeginning: contributionTiming.value === "beginning",
      indexContributionsToInflation: true,
    };
  }

  function readTargetReal() {
    return Math.max(0, toNumber(targetBalance.value));
  }

  function scenarioFromInputs() {
    var inputs = readInputs();
    return {
      sa: inputs.startingAmount,
      tg: readTargetReal(),
      ca: inputs.contributionPerPeriod,
      th: inputs.years,
      inf: (inputs.inflationAnnual * 100).toFixed(2),
      cf: inputs.contributionPeriodsPerYear === 12 ? "m" : "y",
      ct: inputs.contributionAtBeginning ? "b" : "e",
    };
  }

  function applyScenarioFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (!params.toString()) return;
      if (params.has("sa")) startingAmount.value = params.get("sa");
      if (params.has("tg")) targetBalance.value = params.get("tg");
      if (params.has("ca")) contributionAmount.value = params.get("ca");
      if (params.has("th")) timeHorizon.value = params.get("th");
      if (params.has("inf")) inflationRate.value = params.get("inf");
      if (params.has("cf")) contributionFrequency.value = params.get("cf") === "y" ? "yearly" : "monthly";
      if (params.has("ct")) contributionTiming.value = params.get("ct") === "b" ? "beginning" : "end";
      if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
        window.TLM.shareCard.track("calculator_shared_scenario_loaded", {
          calculator_name: "investment-return-to-reach-goal",
        });
      }
    } catch (_err) {
      /* ignore malformed query */
    }
  }

  function solve() {
    var inputs = readInputs();
    return Engine.solveRequiredNominalReturn(Object.assign({}, inputs, {
      targetBalanceReal: readTargetReal(),
    }));
  }

  function isFrench() {
    var lang = (document.documentElement.lang || "").toLowerCase();
    return lang.indexOf("fr") === 0;
  }

  function updateReturnWarning(solved) {
    if (!returnWarning) return;
    if (solved.exceedsHistoricalWarning) {
      // Fallbacks keep the warning readable if an older engine bundle is still cached.
      var histNominal = Number(Engine.SP500_NOMINAL_ANNUAL_RETURN_50Y);
      var histReal = Number(Engine.SP500_REAL_ANNUAL_RETURN_50Y);
      if (!Number.isFinite(histNominal)) histNominal = 0.1211;
      if (!Number.isFinite(histReal)) histReal = 0.082;
      var histNominalPct = (histNominal * 100).toFixed(1);
      var histRealPct = (histReal * 100).toFixed(1);
      var period = Engine.SP500_REFERENCE_PERIOD || "1975–2024";
      returnWarning.hidden = false;
      if (isFrench()) {
        returnWarning.textContent =
          "Un rendement nominal requis au-dessus de 7 % dépasse plusieurs hypothèses de planification à long terme. " +
          "À titre de référence, sur la période " + period + ", le rendement total annualisé du S&P 500 " +
          "(dividendes réinvestis) était d'environ " + histNominalPct + " % en termes nominaux et " +
          histRealPct + " % après inflation. Les rendements passés ne préjugent pas des résultats futurs.";
      } else {
        returnWarning.textContent =
          "A required nominal return above 7% exceeds many long-run planning assumptions. " +
          "For context, over " + period + ", the S&P 500's annualized total return " +
          "(with dividends reinvested) was about " + histNominalPct + "% nominal and " +
          histRealPct + "% after inflation. Past performance is not a forecast.";
      }
    } else {
      returnWarning.hidden = true;
      returnWarning.textContent = "";
    }
  }

  function updateShortfallWarning(solved) {
    if (!shortfallWarning) return;
    if (solved.unreachableAtCap && solved.shortfallReal > 0.01) {
      shortfallWarning.hidden = false;
      if (isFrench()) {
        shortfallWarning.textContent =
          "Même avec un rendement nominal de " + fmtPct(solved.nominalAnnualReturn) + ", le solde réel projeté (" +
          fmtMoney(solved.projectedFinalReal) + ") est inférieur à l'objectif de " +
          fmtMoney(solved.shortfallReal) + " en dollars d'aujourd'hui.";
      } else {
        shortfallWarning.textContent =
          "Even at a " + fmtPct(solved.nominalAnnualReturn) + " nominal return, the projected real balance (" +
          fmtMoney(solved.projectedFinalReal) + ") falls short of the target by " +
          fmtMoney(solved.shortfallReal) + " in today's dollars.";
      }
    } else {
      shortfallWarning.hidden = true;
      shortfallWarning.textContent = "";
    }
  }

  function updateBreakdown(sim) {
    breakdownStarting.textContent = fmtMoney(sim.startingAmount);
    breakdownContributions.textContent = fmtMoney(sim.totalContributions);
    breakdownGrowth.textContent = fmtMoney(sim.growth);

    var positiveStarting = Math.max(0, sim.startingAmount);
    var positiveContrib = Math.max(0, sim.totalContributions);
    var positiveGrowth = Math.max(0, sim.growth);
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
  }

  function updateSchedule(results) {
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
        var row = document.createElement("tr");
        row.innerHTML =
          "<td>" + entry.period + "</td>" +
          "<td>" + fmtMoney(entry.contributions) + "</td>" +
          "<td>" + fmtMoney(entry.growth) + "</td>" +
          "<td>" + fmtMoney(entry.balance) + "</td>";
        scheduleBody.appendChild(row);
      });
    } else {
      rowsToRender.forEach(function (entry) {
        var row = document.createElement("tr");
        row.innerHTML =
          "<td>" + entry.year + "</td>" +
          "<td>" + fmtMoney(entry.contributions) + "</td>" +
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

  function buildSharePayload(solved) {
    if (!window.TLM || !window.TLM.shareCard) return null;
    var scenario = scenarioFromInputs();
    var url = window.TLM.shareCard.buildResultUrl(window.location.href, scenario);
    return {
      calculatorName: "investment-return-to-reach-goal",
      brand: "The Long Math",
      title: "Investment return required to reach a goal",
      headline: "Required nominal return",
      mainValue: fmtPct(solved.nominalAnnualReturn),
      subline: "Real return: " + fmtPct(solved.realAnnualReturn),
      contextLine: "Target: " + fmtMoney(readTargetReal()) + " (today's dollars) over " + readInputs().years + " years",
      shareText: "Required return to reach my investment goal: " + fmtPct(solved.nominalAnnualReturn) + " nominal",
      url: url,
    };
  }

  function updateDisplay() {
    var solved = solve();
    if (solved.error) return;

    lastSolve = solved;
    var sim = solved.simulation;
    var targetReal = readTargetReal();
    var inflation = readInputs().inflationAnnual;
    // Use the same effective horizon the simulation ran (fractional years preserved).
    var years = sim && Number.isFinite(sim.years) ? sim.years : readInputs().years;
    var targetNominal = targetReal * Math.pow(1 + inflation, years);

    requiredReturnNominal.textContent = fmtPct(solved.nominalAnnualReturn);
    requiredReturnReal.textContent = fmtPct(solved.realAnnualReturn);
    targetNominalEquivalent.textContent = fmtMoney(targetNominal);

    updateReturnWarning(solved);
    updateShortfallWarning(solved);
    updateBreakdown(sim);
    updateSchedule(sim);

    latestSharePayload = buildSharePayload(solved);
  }

  function exportCSV() {
    if (!lastSolve || !lastSolve.simulation) return;
    var solved = lastSolve;
    var sim = solved.simulation;
    var inputs = readInputs();
    var csv = "# Investment Return Required to Reach a Goal\n";
    csv += "# Generated: " + new Date().toLocaleString() + "\n";
    csv += "#\n";
    csv += "# Inputs:\n";
    csv += "# Starting Amount (today's dollars)," + fmtMoney(inputs.startingAmount).replace(/[$,]/g, "") + "\n";
    csv += "# Target Balance (today's dollars)," + fmtMoney(readTargetReal()).replace(/[$,]/g, "") + "\n";
    csv += "# Contribution per period (today's dollars)," + fmtMoney(inputs.contributionPerPeriod).replace(/[$,]/g, "") + "\n";
    csv += "# Time Horizon (years)," + inputs.years + "\n";
    csv += "# Assumed Inflation Rate," + (inputs.inflationAnnual * 100) + "%\n";
    csv += "# Contribution Frequency," + (inputs.contributionPeriodsPerYear === 12 ? "Monthly" : "Yearly") + "\n";
    csv += "# Contribution Timing," + (inputs.contributionAtBeginning ? "Beginning of period" : "End of period") + "\n";
    csv += "# Contributions indexed to inflation,yes\n";
    csv += "#\n";
    csv += "# Results:\n";
    csv += "# Required Nominal Return," + fmtPct(solved.nominalAnnualReturn) + "\n";
    csv += "# Required Real Return," + fmtPct(solved.realAnnualReturn) + "\n";
    csv += "#\n";
    csv += "Year,Contributions (real),Growth (real),Ending Balance (real)\n";
    sim.schedule.forEach(function (entry) {
      csv += entry.year + ",";
      csv += fmtMoney(entry.contributions).replace(/[$,]/g, "") + ",";
      csv += fmtMoney(entry.growth).replace(/[$,]/g, "") + ",";
      csv += fmtMoney(entry.balance).replace(/[$,]/g, "") + "\n";
    });

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", "investment-return-to-reach-goal-results.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function wireShareButtons() {
    if (!window.TLM || !window.TLM.shareCard) return;

    window.TLM.shareCard.wireCalculatorShare("investment-return-to-reach-goal", function () {
      if (!latestSharePayload) return null;
      return {
        scenario: scenarioFromInputs(),
        card: {
          title: latestSharePayload.title,
          headline: latestSharePayload.headline,
          mainValue: latestSharePayload.mainValue,
          subline: latestSharePayload.subline,
          contextLine: latestSharePayload.contextLine,
          shareText: latestSharePayload.shareText,
        },
      };
    });
  }

  [
    startingAmount,
    targetBalance,
    contributionAmount,
    timeHorizon,
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
      if (!lastSolve || !lastSolve.simulation) return;
      showFullSchedule = !showFullSchedule;
      updateSchedule(lastSolve.simulation);
    });
  }

  var printButton = el("printButton");
  var exportCSVButton = el("exportCSVButton");
  if (printButton) printButton.addEventListener("click", function () { window.print(); });
  if (exportCSVButton) exportCSVButton.addEventListener("click", exportCSV);

  applyScenarioFromUrl();
  updateContributionLabel();
  wireShareButtons();
  updateDisplay();
})();
