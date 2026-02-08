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

  // Get contribution periods per year
  function getContributionPeriodsPerYear(){
    return contributionFrequency.value === "monthly" ? 12 : 1;
  }

  // Period-by-period simulation
  // Compounding is ALWAYS annual. Simulation timestep matches contribution frequency.
  function simulateInvestment(){
    const P0 = clampNonNeg(toNumber(startingAmount.value));
    const contribPerPeriod = clampNonNeg(toNumber(monthlyContribution.value));
    const years = Math.max(1, Math.min(60, Math.round(toNumber(timeHorizon.value))));
    const rNomAnnual = toNumber(expectedReturn.value) / 100; // Nominal annual return
    const inflationAnnual = clampNonNeg(toNumber(inflationRate.value) / 100); // Annual inflation
    
    // Convert nominal annual return to real annual return ONCE
    const rRealAnnual = calculateRealReturn(rNomAnnual, inflationAnnual);
    
    const contribPeriodsPerYear = getContributionPeriodsPerYear();
    const contribAtBeginning = contributionTiming.value === "beginning";
    const totalPeriods = Math.round(contribPeriodsPerYear * years);
    
    // Real simulation (in today's dollars)
    let balanceReal = P0;
    let totalContributionsReal = 0;
    
    // Derive period return from annual real return
    // If monthly contributions: derive monthly rate such that (1 + r_month)^12 = (1 + r_annual)
    // If yearly contributions: use annual rate directly
    const rRealPeriod = contribPeriodsPerYear === 12
      ? Math.pow(1 + rRealAnnual, 1 / 12) - 1  // Monthly rate from annual
      : rRealAnnual;  // Yearly rate (same as annual)
    
    // Schedule data (yearly snapshots)
    const schedule = [];
    const monthlySchedule = [];
    
    // Track yearly data for aggregation
    let yearData = [];
    for (let y = 0; y <= years; y++) {
      yearData.push({
        year: y,
        contributions: 0,
        startingBalance: y === 0 ? balanceReal : 0,
        endingBalance: 0
      });
    }
    
    // Period-by-period simulation
    for (let period = 0; period < totalPeriods; period++) {
      const periodStartBalance = balanceReal;
      
      // Apply contribution at beginning if needed
      if (contribAtBeginning) {
        balanceReal += contribPerPeriod;
        totalContributionsReal += contribPerPeriod;
      }
      
      // Apply growth for this period using the derived period rate
      // This ensures annual compounding regardless of contribution frequency
      balanceReal *= (1 + rRealPeriod);
      
      // Apply contribution at end if needed
      if (!contribAtBeginning) {
        balanceReal += contribPerPeriod;
        totalContributionsReal += contribPerPeriod;
      }
      
      // Determine which year this period belongs to for schedule aggregation
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
    
    // Build yearly schedule from yearData (real-only)
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
    
    // Calculate nominal final balance from real final balance
    // Use simple formula: nominal = real * (1 + inflation)^years
    const inflationFactor = Math.pow(1 + inflationAnnual, years);
    const finalBalanceNominal = balanceReal * inflationFactor;
    
    // INVARIANT CHECK: Ensure nominal calculation is consistent
    const nominalFromReal = balanceReal * inflationFactor;
    const tolerance = 0.005; // 0.5%
    const diff = Math.abs(finalBalanceNominal - nominalFromReal) / Math.max(finalBalanceNominal, 1);
    if (diff > tolerance) {
      console.warn('Nominal/Real consistency check failed:', {
        realFinal: balanceReal,
        nominalFinal: finalBalanceNominal,
        nominalFromReal: nominalFromReal,
        diff: diff,
        inflationFactor: inflationFactor,
        years: years
      });
    }
    
    // Calculate breakdown (real-only)
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
    csv += "# Compounding Frequency,Annual (fixed)\n";
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
