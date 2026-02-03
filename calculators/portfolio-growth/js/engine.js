/* ============================================================
   Portfolio Growth Calculator — Simulation Engine
   ============================================================
   
   Monthly simulation engine for multiple investment vehicles.
   Computes portfolio paths, CAGR, and inflation-adjusted values.
   
   Vehicles:
   - Cash (0% nominal)
   - Canada T-bills (3-month yield → monthly return)
   - Canada Government Bonds (5-10 year yield → monthly return)
   - Canada 5-year GIC (constant historical average)
   - US Equities (Shiller total return → CAD)
   - Typical Active Fund (US equities minus 1.25%/yr fee drag)
   ============================================================ */

// ============================================================
// Constants
// ============================================================

const ACTIVE_FUND_FEE_ANNUAL = 0.0125; // 1.25% per year
const ACTIVE_FUND_FEE_MONTHLY = Math.pow(1 - ACTIVE_FUND_FEE_ANNUAL, 1/12);

// ============================================================
// Helper: Yield to monthly return
// ============================================================
function yieldToMonthlyReturn(yieldPercent) {
  // y(t) is annual yield in percent
  // r_m(t) = (1 + y(t)/100)^(1/12) - 1
  return Math.pow(1 + yieldPercent / 100, 1/12) - 1;
}

// ============================================================
// Helper: Calculate CAGR
// ============================================================
function calculateCAGR(startValue, endValue, years) {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return 0;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

// ============================================================
// Helper: Get value from monthly series at month key
// ============================================================
function getValueAtMonth(series, monthKey) {
  // series is array of [month, value] pairs
  const entry = series.find(([m]) => m === monthKey);
  return entry ? entry[1] : null;
}

// ============================================================
// Helper: Get previous month key
// ============================================================
function prevMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

// ============================================================
// Helper: Get next month key
// ============================================================
function nextMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// ============================================================
// Helper: Generate month sequence
// ============================================================
function generateMonthSequence(startMonth, numMonths) {
  const months = [];
  let current = startMonth;
  for (let i = 0; i < numMonths; i++) {
    months.push(current);
    current = nextMonth(current);
  }
  return months;
}

// ============================================================
// Vehicle: Cash (0% nominal)
// ============================================================
function simulateCash(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq) {
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  months.forEach((month, idx) => {
    // V(t) = V(t-1)*(1 + r(t)) + contribution(t)
    // For cash: r(t) = 0, so V(t) = V(t-1) + contribution(t)
    // Contribution at end of month
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    // Record value at end of month
    path.push({ month, value });
  });
  
  return path;
}

// ============================================================
// Vehicle: Canada T-bills (3-month yield)
// ============================================================
function simulateTBill(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, tBillSeries) {
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  months.forEach((month, idx) => {
    // Get yield for this month (or use previous if not available)
    let yieldVal = getValueAtMonth(tBillSeries, month);
    if (yieldVal == null && idx > 0) {
      yieldVal = getValueAtMonth(tBillSeries, months[idx - 1]);
    }
    if (yieldVal == null) yieldVal = 0;
    
    // Growth from yield
    const monthlyReturn = yieldToMonthlyReturn(yieldVal);
    value *= (1 + monthlyReturn);
    
    // Contribution at end of month
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    path.push({ month, value });
  });
  
  return path;
}

// ============================================================
// Vehicle: Canada Government Bonds (5-10 year yield)
// ============================================================
function simulateBonds(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, bondSeries) {
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  months.forEach((month, idx) => {
    let yieldVal = getValueAtMonth(bondSeries, month);
    if (yieldVal == null && idx > 0) {
      yieldVal = getValueAtMonth(bondSeries, months[idx - 1]);
    }
    if (yieldVal == null) yieldVal = 0;
    
    const monthlyReturn = yieldToMonthlyReturn(yieldVal);
    value *= (1 + monthlyReturn);
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    path.push({ month, value });
  });
  
  return path;
}

// ============================================================
// Vehicle: Canada 5-year GIC (constant rate)
// ============================================================
function simulateGIC(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, gicRate) {
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  const monthlyReturn = yieldToMonthlyReturn(gicRate);
  
  months.forEach((month, idx) => {
    value *= (1 + monthlyReturn);
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    path.push({ month, value });
  });
  
  return path;
}

// ============================================================
// Vehicle: US Equities (Shiller data, converted to CAD)
// ============================================================
function simulateUSEquities(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, shillerData, fxSeries) {
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  // Build lookup for Shiller data
  const shillerMap = new Map();
  shillerData.forEach(d => {
    shillerMap.set(d.month, { price: d.price, dividend: d.dividend });
  });
  
  months.forEach((month, idx) => {
    const current = shillerMap.get(month);
    const prev = idx > 0 ? shillerMap.get(months[idx - 1]) : null;
    
    if (current && prev) {
      // Monthly total return: r_eq(t) = (P(t) + D(t)) / P(t-1) - 1
      const returnUSD = (current.price + current.dividend) / prev.price - 1;
      
      // FX return: r_fx(t) = fx(t)/fx(t-1) - 1
      const fxCurrent = getValueAtMonth(fxSeries, month);
      const fxPrev = getValueAtMonth(fxSeries, months[idx - 1]);
      
      if (fxCurrent != null && fxPrev != null) {
        const fxReturn = fxCurrent / fxPrev - 1;
        
        // Combined CAD return: (1 + r_cad) = (1 + r_usd) * (1 + r_fx)
        const returnCAD = (1 + returnUSD) * (1 + fxReturn) - 1;
        value *= (1 + returnCAD);
      } else {
        // Fallback: use USD return only
        value *= (1 + returnUSD);
      }
    }
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    path.push({ month, value });
  });
  
  return path;
}

// ============================================================
// Vehicle: Typical Active Fund (US equities minus fee drag)
// ============================================================
function simulateActiveFund(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, shillerData, fxSeries) {
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  const shillerMap = new Map();
  shillerData.forEach(d => {
    shillerMap.set(d.month, { price: d.price, dividend: d.dividend });
  });
  
  months.forEach((month, idx) => {
    const current = shillerMap.get(month);
    const prev = idx > 0 ? shillerMap.get(months[idx - 1]) : null;
    
    if (current && prev) {
      const returnUSD = (current.price + current.dividend) / prev.price - 1;
      
      const fxCurrent = getValueAtMonth(fxSeries, month);
      const fxPrev = getValueAtMonth(fxSeries, months[idx - 1]);
      
      if (fxCurrent != null && fxPrev != null) {
        const fxReturn = fxCurrent / fxPrev - 1;
        const returnCAD = (1 + returnUSD) * (1 + fxReturn) - 1;
        
        // Apply fee drag: (1 + r_active) = (1 + r_eq) * monthly_multiplier
        value *= (1 + returnCAD) * ACTIVE_FUND_FEE_MONTHLY;
      } else {
        value *= (1 + returnUSD) * ACTIVE_FUND_FEE_MONTHLY;
      }
    }
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    path.push({ month, value });
  });
  
  return path;
}

// ============================================================
// Helper: Determine if contribution should be made
// ============================================================
function shouldContribute(monthIndex, freq) {
  if (freq === 'monthly') return true;
  if (freq === 'quarterly') return monthIndex % 3 === 0;
  if (freq === 'annually') return monthIndex % 12 === 0;
  return false;
}

// ============================================================
// Apply inflation adjustment
// ============================================================
function applyInflationAdjustment(path, cpiSeries, startMonth) {
  const startCPI = getValueAtMonth(cpiSeries, startMonth);
  if (!startCPI) return path;
  
  return path.map(({ month, value }) => {
    const currentCPI = getValueAtMonth(cpiSeries, month);
    if (!currentCPI) return { month, value, valueReal: value };
    
    const valueReal = value * (startCPI / currentCPI);
    return { month, value, valueReal };
  });
}

// ============================================================
// Main simulation function
// ============================================================
function simulatePortfolio({
  startMonth,
  horizonYears,
  startingAmount,
  contributionAmount,
  contributionFreq, // 'monthly', 'quarterly', 'annually'
  showReal, // boolean
  data // { fxUSDCAD, cpiCanada, tBill3M, bond5_10Y, gic5Y, shiller }
}) {
  const numMonths = Math.round(horizonYears * 12);
  
  // Run simulations for each vehicle
  const cashPath = simulateCash(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq);
  const tBillPath = simulateTBill(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.tBill3M);
  const bondPath = simulateBonds(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.bond5_10Y);
  const gicPath = simulateGIC(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.gic5Y.averageRate);
  const equitiesPath = simulateUSEquities(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.shiller, data.fxUSDCAD);
  const activeFundPath = simulateActiveFund(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.shiller, data.fxUSDCAD);
  
  // Apply inflation adjustment if requested
  let cashPathFinal = cashPath;
  let tBillPathFinal = tBillPath;
  let bondPathFinal = bondPath;
  let gicPathFinal = gicPath;
  let equitiesPathFinal = equitiesPath;
  let activeFundPathFinal = activeFundPath;
  
  if (showReal && data.cpiCanada) {
    cashPathFinal = applyInflationAdjustment(cashPath, data.cpiCanada, startMonth);
    tBillPathFinal = applyInflationAdjustment(tBillPath, data.cpiCanada, startMonth);
    bondPathFinal = applyInflationAdjustment(bondPath, data.cpiCanada, startMonth);
    gicPathFinal = applyInflationAdjustment(gicPath, data.cpiCanada, startMonth);
    equitiesPathFinal = applyInflationAdjustment(equitiesPath, data.cpiCanada, startMonth);
    activeFundPathFinal = applyInflationAdjustment(activeFundPath, data.cpiCanada, startMonth);
  }
  
  // Calculate results
  const getEndingValue = (path) => showReal && path[0]?.valueReal != null ? path[path.length - 1].valueReal : path[path.length - 1].value;
  const getStartingValue = (path) => showReal && path[0]?.valueReal != null ? path[0].valueReal : path[0].value;
  
  const totalContributions = contributionAmount * (contributionFreq === 'monthly' ? numMonths : contributionFreq === 'quarterly' ? Math.floor(numMonths / 3) : Math.floor(numMonths / 12));
  
  const results = {
    cash: {
      path: cashPathFinal,
      endingValue: getEndingValue(cashPathFinal),
      cagr: calculateCAGR(getStartingValue(cashPathFinal), getEndingValue(cashPathFinal), horizonYears),
      totalContributions
    },
    tBill: {
      path: tBillPathFinal,
      endingValue: getEndingValue(tBillPathFinal),
      cagr: calculateCAGR(getStartingValue(tBillPathFinal), getEndingValue(tBillPathFinal), horizonYears),
      totalContributions
    },
    bond: {
      path: bondPathFinal,
      endingValue: getEndingValue(bondPathFinal),
      cagr: calculateCAGR(getStartingValue(bondPathFinal), getEndingValue(bondPathFinal), horizonYears),
      totalContributions
    },
    gic: {
      path: gicPathFinal,
      endingValue: getEndingValue(gicPathFinal),
      cagr: calculateCAGR(getStartingValue(gicPathFinal), getEndingValue(gicPathFinal), horizonYears),
      totalContributions,
      gicRate: data.gic5Y.averageRate,
      gicStartDate: data.gic5Y.startDate
    },
    equities: {
      path: equitiesPathFinal,
      endingValue: getEndingValue(equitiesPathFinal),
      cagr: calculateCAGR(getStartingValue(equitiesPathFinal), getEndingValue(equitiesPathFinal), horizonYears),
      totalContributions
    },
    activeFund: {
      path: activeFundPathFinal,
      endingValue: getEndingValue(activeFundPathFinal),
      cagr: calculateCAGR(getStartingValue(activeFundPathFinal), getEndingValue(activeFundPathFinal), horizonYears),
      totalContributions
    }
  };
  
  return results;
}

// ============================================================
// Export
// ============================================================
window.portfolioEngine = {
  simulate: simulatePortfolio,
  calculateCAGR: calculateCAGR
};
