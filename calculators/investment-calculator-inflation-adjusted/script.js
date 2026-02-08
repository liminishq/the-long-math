// Investment Calculator - Inflation Adjusted
// Version: 1.0
(function(){
  'use strict';
  const el = (id) => document.getElementById(id);

  // Input elements
  const startingAmount = el("startingAmount");
  const monthlyContribution = el("monthlyContribution");
  const timeHorizon = el("timeHorizon");
  const expectedReturn = el("expectedReturn");
  const inflationRate = el("inflationRate");
  const compoundingFrequency = el("compoundingFrequency");
  const contributionFrequency = el("contributionFrequency");
  const contributionTiming = el("contributionTiming");

  // Output elements
  const finalBalanceReal = el("finalBalanceReal");
  const finalBalanceNominal = el("finalBalanceNominal");
  const breakdownStarting = el("breakdownStarting");
  const breakdownContributions = el("breakdownContributions");
  const breakdownGrowth = el("breakdownGrowth");
  const barStarting = el("barStarting");
  const barContributions = el("barContributions");
  const barGrowth = el("barGrowth");
  const scheduleBody = el("scheduleBody");
  const scheduleViewRadios = document.querySelectorAll('input[name="scheduleView"]');

  // Helper functions
  function toNumber(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }

  function clampNonNeg(x){ return Math.max(0, x); }

  function fmtMoney(x){
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(x);
  }

  // Calculate real return from nominal return and inflation
  function calculateRealReturn(rNom, inflation){
    if (inflation <= -1) return rNom; // Avoid division issues
    return (1 + rNom) / (1 + inflation) - 1;
  }

  // Get compounding periods per year
  function getCompoundingPeriodsPerYear(){
    const val = compoundingFrequency.value;
    if (val === "continuous") return Infinity;
    return Math.max(1, Math.round(toNumber(val)));
  }

  // Get contribution periods per year
  function getContributionPeriodsPerYear(){
    return contributionFrequency.value === "monthly" ? 12 : 1;
  }

  // Calculate period return based on compounding frequency
  function getPeriodReturn(rAnnual, periodsPerYear){
    if (periodsPerYear === Infinity) {
      // Continuous compounding: use effective annual rate
      return Math.exp(rAnnual) - 1;
    }
    if (periodsPerYear <= 0) return 0;
    return Math.pow(1 + rAnnual, 1 / periodsPerYear) - 1;
  }

  // Period-by-period simulation
  function simulateInvestment(){
    const P0 = clampNonNeg(toNumber(startingAmount.value));
    const contribPerPeriod = clampNonNeg(toNumber(monthlyContribution.value));
    const years = Math.max(1, Math.min(60, Math.round(toNumber(timeHorizon.value))));
    const rNom = toNumber(expectedReturn.value) / 100;
    const inflation = clampNonNeg(toNumber(inflationRate.value) / 100);
    const rReal = calculateRealReturn(rNom, inflation);
    
    const contribPeriodsPerYear = getContributionPeriodsPerYear();
    const compoundingPeriodsPerYear = getCompoundingPeriodsPerYear();
    const contribAtBeginning = contributionTiming.value === "beginning";
    
    const totalPeriods = Math.round(contribPeriodsPerYear * years);
    const totalCompoundingPeriods = compoundingPeriodsPerYear === Infinity 
      ? totalPeriods 
      : Math.round(compoundingPeriodsPerYear * years);
    
    // Real simulation (in today's dollars)
    let balanceReal = P0;
    let totalContributionsReal = 0;
    
    // For nominal calculation, we'll track the inflation factor
    let inflationFactor = 1;
    const inflationPerPeriod = Math.pow(1 + inflation, 1 / contribPeriodsPerYear) - 1;
    
    // Calculate period returns
    const realPeriodReturn = getPeriodReturn(rReal, compoundingPeriodsPerYear);
    const nominalPeriodReturn = getPeriodReturn(rNom, compoundingPeriodsPerYear);
    
    // Determine how many compounding steps per contribution period
    const compoundingStepsPerContribPeriod = compoundingPeriodsPerYear === Infinity
      ? 1
      : Math.max(1, Math.round(compoundingPeriodsPerYear / contribPeriodsPerYear));
    
    // Schedule data (yearly snapshots)
    const schedule = [];
    const monthlySchedule = [];
    
    // Track yearly data
    let yearData = [];
    for (let y = 0; y <= years; y++) {
      yearData.push({
        year: y,
        contributions: 0,
        startingBalance: y === 0 ? balanceReal : 0,
        endingBalance: 0
      });
    }
    
    for (let period = 0; period < totalPeriods; period++) {
      const periodStartBalance = balanceReal;
      
      // Apply contribution at beginning if needed
      if (contribAtBeginning) {
        balanceReal += contribPerPeriod;
        totalContributionsReal += contribPerPeriod;
      }
      
      // Apply compounding for this contribution period
      if (compoundingPeriodsPerYear === Infinity) {
        // Continuous compounding
        const timeInYears = 1 / contribPeriodsPerYear;
        balanceReal *= Math.exp(rReal * timeInYears);
      } else {
        // Discrete compounding
        for (let step = 0; step < compoundingStepsPerContribPeriod; step++) {
          balanceReal *= (1 + realPeriodReturn);
        }
      }
      
      // Apply contribution at end if needed
      if (!contribAtBeginning) {
        balanceReal += contribPerPeriod;
        totalContributionsReal += contribPerPeriod;
      }
      
      // Track inflation factor for nominal calculation
      inflationFactor *= (1 + inflationPerPeriod);
      
      // Determine which year this period belongs to
      const yearNum = Math.floor((period + 1) / contribPeriodsPerYear);
      if (yearNum <= years && yearData[yearNum]) {
        yearData[yearNum].contributions += contribPerPeriod;
        yearData[yearNum].endingBalance = balanceReal;
        if (yearNum > 0 && yearData[yearNum].startingBalance === 0) {
          yearData[yearNum].startingBalance = periodStartBalance;
        }
      }
      
      // Record monthly schedule if contribution frequency is monthly
      if (contribPeriodsPerYear === 12) {
        const month = period + 1;
        const year = Math.floor((period) / contribPeriodsPerYear);
        const periodGrowth = balanceReal - periodStartBalance - contribPerPeriod;
        monthlySchedule.push({
          period: month,
          year: year,
          contributions: contribPerPeriod,
          growth: periodGrowth,
          balance: balanceReal
        });
      }
    }
    
    // Build yearly schedule from yearData
    for (let y = 0; y <= years; y++) {
      if (y === 0) {
        schedule.push({
          year: 0,
          contributions: 0,
          growth: 0,
          balance: P0
        });
      } else if (yearData[y]) {
        const growth = yearData[y].endingBalance - yearData[y].startingBalance - yearData[y].contributions;
        schedule.push({
          year: y,
          contributions: yearData[y].contributions,
          growth: growth,
          balance: yearData[y].endingBalance
        });
      }
    }
    
    // Calculate nominal final balance
    // We can derive it from the real balance by applying the inflation factor
    const finalBalanceNominal = balanceReal * inflationFactor;
    
    // Calculate breakdown
    const growthReal = balanceReal - P0 - totalContributionsReal;
    
    return {
      finalBalanceReal: balanceReal,
      finalBalanceNominal: finalBalanceNominal,
      startingAmount: P0,
      totalContributions: totalContributionsReal,
      growth: growthReal,
      schedule: schedule,
      monthlySchedule: monthlySchedule
    };
  }

  function updateDisplay(){
    const results = simulateInvestment();
    
    // Update headline outputs
    finalBalanceReal.textContent = fmtMoney(results.finalBalanceReal);
    finalBalanceNominal.textContent = fmtMoney(results.finalBalanceNominal);
    
    // Update breakdown
    breakdownStarting.textContent = fmtMoney(results.startingAmount);
    breakdownContributions.textContent = fmtMoney(results.totalContributions);
    breakdownGrowth.textContent = fmtMoney(results.growth);
    
    // Update breakdown bar
    const total = results.finalBalanceReal;
    if (total > 0) {
      const startPct = (results.startingAmount / total) * 100;
      const contribPct = (results.totalContributions / total) * 100;
      const growthPct = (results.growth / total) * 100;
      
      barStarting.style.width = startPct + "%";
      barContributions.style.width = contribPct + "%";
      barGrowth.style.width = growthPct + "%";
    } else {
      barStarting.style.width = "0%";
      barContributions.style.width = "0%";
      barGrowth.style.width = "0%";
    }
    
    // Update schedule
    updateSchedule(results);
  }

  function updateSchedule(results){
    const isMonthly = scheduleViewRadios[1]?.checked;
    const contribPeriodsPerYear = getContributionPeriodsPerYear();
    const scheduleData = (isMonthly && contribPeriodsPerYear === 12 && results.monthlySchedule.length > 0) 
      ? results.monthlySchedule 
      : results.schedule;
    
    scheduleBody.innerHTML = "";
    
    if (isMonthly && contribPeriodsPerYear === 12 && results.monthlySchedule.length > 0) {
      // Monthly schedule - show all months
      scheduleData.forEach(entry => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${entry.period}</td>
          <td>${fmtMoney(entry.contributions)}</td>
          <td>${fmtMoney(entry.growth)}</td>
          <td>${fmtMoney(entry.balance)}</td>
        `;
        scheduleBody.appendChild(row);
      });
    } else {
      // Yearly schedule
      results.schedule.forEach(entry => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${entry.year}</td>
          <td>${fmtMoney(entry.contributions)}</td>
          <td>${fmtMoney(entry.growth)}</td>
          <td>${fmtMoney(entry.balance)}</td>
        `;
        scheduleBody.appendChild(row);
      });
    }
  }

  // Print functionality
  function printResults(){
    window.print();
  }

  // CSV export functionality
  function exportCSV(){
    const results = simulateInvestment();
    
    // Build CSV content
    let csv = "# Investment Calculator - Inflation Adjusted Results\n";
    csv += "# Generated: " + new Date().toLocaleString() + "\n";
    csv += "#\n";
    csv += "# Inputs:\n";
    csv += "# Starting Amount," + fmtMoney(toNumber(startingAmount.value)).replace(/[$,]/g, "") + "\n";
    csv += "# Monthly Contribution," + fmtMoney(toNumber(monthlyContribution.value)).replace(/[$,]/g, "") + "\n";
    csv += "# Time Horizon (years)," + timeHorizon.value + "\n";
    csv += "# Expected Annual Return (nominal)," + expectedReturn.value + "%\n";
    csv += "# Assumed Inflation Rate," + inflationRate.value + "%\n";
    csv += "# Compounding Frequency," + compoundingFrequency.options[compoundingFrequency.selectedIndex].text + "\n";
    csv += "# Contribution Frequency," + contributionFrequency.options[contributionFrequency.selectedIndex].text + "\n";
    csv += "# Contribution Timing," + contributionTiming.options[contributionTiming.selectedIndex].text + "\n";
    csv += "#\n";
    csv += "# Results:\n";
    csv += "# Final Balance (Inflation-Adjusted)," + fmtMoney(results.finalBalanceReal).replace(/[$,]/g, "") + "\n";
    csv += "# Final Balance (Nominal)," + fmtMoney(results.finalBalanceNominal).replace(/[$,]/g, "") + "\n";
    csv += "# Starting Amount," + fmtMoney(results.startingAmount).replace(/[$,]/g, "") + "\n";
    csv += "# Total Contributions," + fmtMoney(results.totalContributions).replace(/[$,]/g, "") + "\n";
    csv += "# Investment Growth," + fmtMoney(results.growth).replace(/[$,]/g, "") + "\n";
    csv += "#\n";
    csv += "# Accumulation Schedule (Inflation-Adjusted, Today's Dollars):\n";
    csv += "Year,Contributions,Growth,Ending Balance\n";
    
    results.schedule.forEach(entry => {
      csv += entry.year + ",";
      csv += fmtMoney(entry.contributions).replace(/[$,]/g, "") + ",";
      csv += fmtMoney(entry.growth).replace(/[$,]/g, "") + ",";
      csv += fmtMoney(entry.balance).replace(/[$,]/g, "") + "\n";
    });
    
    // Create download
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "investment-calculator-results.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Event listeners
  [
    startingAmount,
    monthlyContribution,
    timeHorizon,
    expectedReturn,
    inflationRate,
    compoundingFrequency,
    contributionFrequency,
    contributionTiming
  ].forEach((node) => node.addEventListener("input", updateDisplay));

  scheduleViewRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      updateDisplay();
    });
  });

  el("printButton").addEventListener("click", printResults);
  el("exportCSVButton").addEventListener("click", exportCSV);

  // Initial calculation
  updateDisplay();
})();
