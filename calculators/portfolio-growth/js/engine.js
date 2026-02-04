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
// (Legacy function - kept for compatibility but prefer direct Map lookups)
// ============================================================
function getValueAtMonth(series, monthKey) {
  if (!series) return null;
  // Handle both old format [month, value] and new format {month, value}
  if (Array.isArray(series)) {
    const entry = series.find(item => {
      const month = Array.isArray(item) ? item[0] : item.month;
      return month === monthKey;
    });
    return entry ? (Array.isArray(entry) ? entry[1] : entry.value) : null;
  }
  return null;
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
// Returns { ok: boolean, path?: Array, reason?: string }
// ============================================================
function simulateTBill(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, tBillSeries) {
  // Validate inputs - NO FALLBACKS
  if (!tBillSeries || !tBillSeries.ok || !Array.isArray(tBillSeries.data) || tBillSeries.data.length === 0) {
    return {
      ok: false,
      reason: tBillSeries?.reason || 'Missing T-bill data',
      detail: tBillSeries?.detail || 'T-bill series not available'
    };
  }
  
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  // Build lookup map
  const seriesMap = new Map();
  tBillSeries.data.forEach(({ month, value: seriesValue }) => {
    if (month && isValidValue(seriesValue)) {
      seriesMap.set(month, seriesValue);
    }
  });
  
  let hasValidData = false;
  
  months.forEach((month, idx) => {
    // Get yield for this month (or use previous if not available)
    let yieldVal = seriesMap.get(month);
    if (yieldVal == null && idx > 0) {
      yieldVal = seriesMap.get(months[idx - 1]);
    }
    
    if (yieldVal != null && isValidValue(yieldVal)) {
      // Growth from yield
      const monthlyReturn = yieldToMonthlyReturn(yieldVal);
      if (isValidValue(monthlyReturn)) {
        value *= (1 + monthlyReturn);
        hasValidData = true;
      }
    }
    
    // Contribution at end of month
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    if (!isValidValue(value)) {
      return {
        ok: false,
        reason: 'Invalid calculation result',
        detail: `Non-finite value computed at ${month}`
      };
    }
    
    path.push({ month, value });
  });
  
  if (!hasValidData) {
    return {
      ok: false,
      reason: 'Insufficient data for simulation period',
      detail: 'No valid T-bill data found for the selected time period'
    };
  }
  
  return { ok: true, path };
}

// ============================================================
// Vehicle: Canada Government Bonds (5-10 year yield)
// Returns { ok: boolean, path?: Array, reason?: string }
// ============================================================
function simulateBonds(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, bondSeries) {
  // Validate inputs - NO FALLBACKS
  if (!bondSeries || !bondSeries.ok || !Array.isArray(bondSeries.data) || bondSeries.data.length === 0) {
    return {
      ok: false,
      reason: bondSeries?.reason || 'Missing bond data',
      detail: bondSeries?.detail || 'Bond series not available'
    };
  }
  
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  // Build lookup map
  const seriesMap = new Map();
  bondSeries.data.forEach(({ month, value: seriesValue }) => {
    if (month && isValidValue(seriesValue)) {
      seriesMap.set(month, seriesValue);
    }
  });
  
  let hasValidData = false;
  
  months.forEach((month, idx) => {
    let yieldVal = seriesMap.get(month);
    if (yieldVal == null && idx > 0) {
      yieldVal = seriesMap.get(months[idx - 1]);
    }
    
    if (yieldVal != null && isValidValue(yieldVal)) {
      const monthlyReturn = yieldToMonthlyReturn(yieldVal);
      if (isValidValue(monthlyReturn)) {
        value *= (1 + monthlyReturn);
        hasValidData = true;
      }
    }
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    if (!isValidValue(value)) {
      return {
        ok: false,
        reason: 'Invalid calculation result',
        detail: `Non-finite value computed at ${month}`
      };
    }
    
    path.push({ month, value });
  });
  
  if (!hasValidData) {
    return {
      ok: false,
      reason: 'Insufficient data for simulation period',
      detail: 'No valid bond data found for the selected time period'
    };
  }
  
  return { ok: true, path };
}

// ============================================================
// Vehicle: Canada 5-year GIC (constant rate)
// Returns { ok: boolean, path?: Array, reason?: string }
// ============================================================
function simulateGIC(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, gicData) {
  // Validate inputs - NO FALLBACKS
  if (!gicData || !gicData.ok || !gicData.metadata || !isValidValue(gicData.metadata.averageRate)) {
    return {
      ok: false,
      reason: gicData?.reason || 'Missing GIC data',
      detail: gicData?.detail || 'GIC rate not available'
    };
  }
  
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  const monthlyReturn = yieldToMonthlyReturn(gicData.metadata.averageRate);
  
  if (!isValidValue(monthlyReturn)) {
    return {
      ok: false,
      reason: 'Invalid GIC rate',
      detail: 'GIC rate calculation produced non-finite value'
    };
  }
  
  months.forEach((month, idx) => {
    value *= (1 + monthlyReturn);
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    if (!isValidValue(value)) {
      return {
        ok: false,
        reason: 'Invalid calculation result',
        detail: `Non-finite value computed at ${month}`
      };
    }
    
    path.push({ month, value });
  });
  
  return { ok: true, path };
}

// ============================================================
// Vehicle: US Equities (Shiller data, converted to CAD)
// Returns { ok: boolean, path?: Array, reason?: string }
// ============================================================
function simulateUSEquities(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, shillerData, fxSeries) {
  // Validate inputs - NO FALLBACKS
  if (!shillerData || !shillerData.ok || !Array.isArray(shillerData.data) || shillerData.data.length === 0) {
    return {
      ok: false,
      reason: shillerData?.reason || 'Missing US Equities data',
      detail: shillerData?.detail || 'Shiller data not available'
    };
  }
  
  // FX is required for USD to CAD conversion
  if (!fxSeries || !fxSeries.ok || !Array.isArray(fxSeries.data) || fxSeries.data.length === 0) {
    return {
      ok: false,
      reason: 'Missing USD/CAD exchange-rate data',
      detail: fxSeries?.detail || 'FX data required for USD to CAD conversion'
    };
  }
  
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  // Build lookup for Shiller data
  const shillerMap = new Map();
  shillerData.data.forEach(d => {
    if (d.month && isValidValue(d.price) && isValidValue(d.dividend)) {
      shillerMap.set(d.month, { price: d.price, dividend: d.dividend });
    }
  });
  
  // Build lookup for FX data
  const fxMap = new Map();
  fxSeries.data.forEach(({ month, value: fxValue }) => {
    if (month && isValidValue(fxValue)) {
      fxMap.set(month, fxValue);
    }
  });
  
  let hasValidData = false;
  
  months.forEach((month, idx) => {
    const current = shillerMap.get(month);
    const prev = idx > 0 ? shillerMap.get(months[idx - 1]) : null;
    const fxCurrent = fxMap.get(month);
    const fxPrev = idx > 0 ? fxMap.get(months[idx - 1]) : null;
    
    if (current && prev && isValidValue(current.price) && isValidValue(prev.price)) {
      // Monthly total return: r_eq(t) = (P(t) + D(t)) / P(t-1) - 1
      const returnUSD = (current.price + current.dividend) / prev.price - 1;
      
      if (!isValidValue(returnUSD)) {
        // Skip this month if return is invalid
        if (shouldContribute(idx, contributionFreq)) {
          value += contributionAmount;
        }
        path.push({ month, value });
        return;
      }
      
      // FX return: r_fx(t) = fx(t)/fx(t-1) - 1
      if (fxCurrent != null && fxPrev != null && isValidValue(fxCurrent) && isValidValue(fxPrev) && fxPrev !== 0) {
        const fxReturn = fxCurrent / fxPrev - 1;
        
        if (isValidValue(fxReturn)) {
          // Combined CAD return: (1 + r_cad) = (1 + r_usd) * (1 + r_fx)
          const returnCAD = (1 + returnUSD) * (1 + fxReturn) - 1;
          
          if (isValidValue(returnCAD)) {
            value *= (1 + returnCAD);
            hasValidData = true;
          }
        }
      } else {
        // Cannot convert without FX - mark as failed
        return;
      }
    }
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    if (!isValidValue(value)) {
      return {
        ok: false,
        reason: 'Invalid calculation result',
        detail: `Non-finite value computed at ${month}`
      };
    }
    
    path.push({ month, value });
  });
  
  if (!hasValidData) {
    return {
      ok: false,
      reason: 'Insufficient data for simulation period',
      detail: 'No valid return data found for the selected time period'
    };
  }
  
  return { ok: true, path };
}

// ============================================================
// Helper: Check if value is finite
// ============================================================
function isValidValue(value) {
  return value != null && Number.isFinite(value);
}

// ============================================================
// Vehicle: Typical Active Fund (US equities minus fee drag)
// Returns { ok: boolean, path?: Array, reason?: string }
// ============================================================
function simulateActiveFund(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, shillerData, fxSeries) {
  // Validate inputs - NO FALLBACKS
  if (!shillerData || !shillerData.ok || !Array.isArray(shillerData.data) || shillerData.data.length === 0) {
    return {
      ok: false,
      reason: shillerData?.reason || 'Missing US Equities data',
      detail: shillerData?.detail || 'Shiller data not available'
    };
  }
  
  // FX is required for USD to CAD conversion
  if (!fxSeries || !fxSeries.ok || !Array.isArray(fxSeries.data) || fxSeries.data.length === 0) {
    return {
      ok: false,
      reason: 'Missing USD/CAD exchange-rate data',
      detail: fxSeries?.detail || 'FX data required for USD to CAD conversion'
    };
  }
  
  const months = generateMonthSequence(startMonth, numMonths);
  const path = [];
  let value = startingAmount;
  
  const shillerMap = new Map();
  shillerData.data.forEach(d => {
    if (d.month && isValidValue(d.price) && isValidValue(d.dividend)) {
      shillerMap.set(d.month, { price: d.price, dividend: d.dividend });
    }
  });
  
  // Build lookup for FX data
  const fxMap = new Map();
  fxSeries.data.forEach(({ month, value: fxValue }) => {
    if (month && isValidValue(fxValue)) {
      fxMap.set(month, fxValue);
    }
  });
  
  let hasValidData = false;
  
  months.forEach((month, idx) => {
    const current = shillerMap.get(month);
    const prev = idx > 0 ? shillerMap.get(months[idx - 1]) : null;
    const fxCurrent = fxMap.get(month);
    const fxPrev = idx > 0 ? fxMap.get(months[idx - 1]) : null;
    
    if (current && prev && isValidValue(current.price) && isValidValue(prev.price)) {
      const returnUSD = (current.price + current.dividend) / prev.price - 1;
      
      if (!isValidValue(returnUSD)) {
        if (shouldContribute(idx, contributionFreq)) {
          value += contributionAmount;
        }
        path.push({ month, value });
        return;
      }
      
      if (fxCurrent != null && fxPrev != null && isValidValue(fxCurrent) && isValidValue(fxPrev) && fxPrev !== 0) {
        const fxReturn = fxCurrent / fxPrev - 1;
        
        if (isValidValue(fxReturn)) {
          const returnCAD = (1 + returnUSD) * (1 + fxReturn) - 1;
          
          if (isValidValue(returnCAD)) {
            // Apply fee drag: (1 + r_active) = (1 + r_eq) * monthly_multiplier
            value *= (1 + returnCAD) * ACTIVE_FUND_FEE_MONTHLY;
            hasValidData = true;
          }
        }
      } else {
        return;
      }
    }
    
    if (shouldContribute(idx, contributionFreq)) {
      value += contributionAmount;
    }
    
    if (!isValidValue(value)) {
      return {
        ok: false,
        reason: 'Invalid calculation result',
        detail: `Non-finite value computed at ${month}`
      };
    }
    
    path.push({ month, value });
  });
  
  if (!hasValidData) {
    return {
      ok: false,
      reason: 'Insufficient data for simulation period',
      detail: 'No valid return data found for the selected time period'
    };
  }
  
  return { ok: true, path };
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
// Sanity check: Detect if series collapsed to cash (fallback behavior)
// ============================================================
function detectCollapseToCash(path, cashPath, seriesId) {
  if (!path || !cashPath || path.length !== cashPath.length) {
    return false;
  }
  
  // Check if all values are exactly equal (within floating point tolerance)
  for (let i = 0; i < path.length; i++) {
    const diff = Math.abs(path[i].value - cashPath[i].value);
    if (diff > 0.01) { // Allow small floating point differences
      return false;
    }
  }
  
  return true;
}

// ============================================================
// Main simulation function
// Returns results with ok status for each series
// ============================================================
function simulatePortfolio({
  startMonth,
  horizonYears,
  startingAmount,
  contributionAmount,
  contributionFreq, // 'monthly', 'quarterly', 'annually'
  showReal, // boolean
  data // { fxUSDCAD, cpiCanada, tBill3M, bond5_10Y, gic5Y, shiller } - all SeriesLoadResult
}) {
  const numMonths = Math.round(horizonYears * 12);
  
  // Run simulations for each vehicle
  const cashResult = { ok: true, path: simulateCash(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq) };
  const tBillResult = simulateTBill(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.tBill3M);
  const bondResult = simulateBonds(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.bond5_10Y);
  const gicResult = simulateGIC(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.gic5Y);
  const equitiesResult = simulateUSEquities(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.shiller, data.fxUSDCAD);
  const activeFundResult = simulateActiveFund(startMonth, numMonths, startingAmount, contributionAmount, contributionFreq, data.shiller, data.fxUSDCAD);
  
  // Sanity check: Detect if any series collapsed to cash (except cash itself)
  if (tBillResult.ok && detectCollapseToCash(tBillResult.path, cashResult.path, 'tBill')) {
    tBillResult.ok = false;
    tBillResult.reason = 'Series data invalid (collapsed to fallback)';
    tBillResult.detail = 'T-bill series values match cash exactly - likely fallback behavior';
  }
  if (bondResult.ok && detectCollapseToCash(bondResult.path, cashResult.path, 'bond')) {
    bondResult.ok = false;
    bondResult.reason = 'Series data invalid (collapsed to fallback)';
    bondResult.detail = 'Bond series values match cash exactly - likely fallback behavior';
  }
  if (equitiesResult.ok && detectCollapseToCash(equitiesResult.path, cashResult.path, 'equities')) {
    equitiesResult.ok = false;
    equitiesResult.reason = 'Series data invalid (collapsed to fallback)';
    equitiesResult.detail = 'Equities series values match cash exactly - likely fallback behavior';
  }
  if (activeFundResult.ok && detectCollapseToCash(activeFundResult.path, cashResult.path, 'activeFund')) {
    activeFundResult.ok = false;
    activeFundResult.reason = 'Series data invalid (collapsed to fallback)';
    activeFundResult.detail = 'Active fund series values match cash exactly - likely fallback behavior';
  }
  
  // Extract paths (only if ok)
  const cashPath = cashResult.path;
  const tBillPath = tBillResult.ok ? tBillResult.path : null;
  const bondPath = bondResult.ok ? bondResult.path : null;
  const gicPath = gicResult.ok ? gicResult.path : null;
  const equitiesPath = equitiesResult.ok ? equitiesResult.path : null;
  const activeFundPath = activeFundResult.ok ? activeFundResult.path : null;
  
  // Apply inflation adjustment if requested (only for valid series)
  let cashPathFinal = cashPath;
  let tBillPathFinal = tBillPath;
  let bondPathFinal = bondPath;
  let gicPathFinal = gicPath;
  let equitiesPathFinal = equitiesPath;
  let activeFundPathFinal = activeFundPath;
  
  if (showReal && data.cpiCanada && data.cpiCanada.ok) {
    cashPathFinal = applyInflationAdjustment(cashPath, data.cpiCanada.data, startMonth);
    if (tBillPath) tBillPathFinal = applyInflationAdjustment(tBillPath, data.cpiCanada.data, startMonth);
    if (bondPath) bondPathFinal = applyInflationAdjustment(bondPath, data.cpiCanada.data, startMonth);
    if (gicPath) gicPathFinal = applyInflationAdjustment(gicPath, data.cpiCanada.data, startMonth);
    if (equitiesPath) equitiesPathFinal = applyInflationAdjustment(equitiesPath, data.cpiCanada.data, startMonth);
    if (activeFundPath) activeFundPathFinal = applyInflationAdjustment(activeFundPath, data.cpiCanada.data, startMonth);
  }
  
  // Calculate results helper
  const getEndingValue = (path) => {
    if (!path || path.length === 0) return null;
    return showReal && path[0]?.valueReal != null ? path[path.length - 1].valueReal : path[path.length - 1].value;
  };
  const getStartingValue = (path) => {
    if (!path || path.length === 0) return null;
    return showReal && path[0]?.valueReal != null ? path[0].valueReal : path[0].value;
  };
  
  const totalContributions = contributionAmount * (contributionFreq === 'monthly' ? numMonths : contributionFreq === 'quarterly' ? Math.floor(numMonths / 3) : Math.floor(numMonths / 12));
  
  // Build results with ok status
  const results = {
    cash: {
      ok: true,
      path: cashPathFinal,
      endingValue: getEndingValue(cashPathFinal),
      cagr: calculateCAGR(getStartingValue(cashPathFinal), getEndingValue(cashPathFinal), horizonYears),
      totalContributions
    },
    tBill: tBillResult.ok ? {
      ok: true,
      path: tBillPathFinal,
      endingValue: getEndingValue(tBillPathFinal),
      cagr: calculateCAGR(getStartingValue(tBillPathFinal), getEndingValue(tBillPathFinal), horizonYears),
      totalContributions
    } : {
      ok: false,
      reason: tBillResult.reason,
      detail: tBillResult.detail
    },
    bond: bondResult.ok ? {
      ok: true,
      path: bondPathFinal,
      endingValue: getEndingValue(bondPathFinal),
      cagr: calculateCAGR(getStartingValue(bondPathFinal), getEndingValue(bondPathFinal), horizonYears),
      totalContributions
    } : {
      ok: false,
      reason: bondResult.reason,
      detail: bondResult.detail
    },
    gic: gicResult.ok ? {
      ok: true,
      path: gicPathFinal,
      endingValue: getEndingValue(gicPathFinal),
      cagr: calculateCAGR(getStartingValue(gicPathFinal), getEndingValue(gicPathFinal), horizonYears),
      totalContributions,
      gicRate: data.gic5Y.metadata?.averageRate,
      gicStartDate: data.gic5Y.metadata?.startDate
    } : {
      ok: false,
      reason: gicResult.reason,
      detail: gicResult.detail
    },
    equities: equitiesResult.ok ? {
      ok: true,
      path: equitiesPathFinal,
      endingValue: getEndingValue(equitiesPathFinal),
      cagr: calculateCAGR(getStartingValue(equitiesPathFinal), getEndingValue(equitiesPathFinal), horizonYears),
      totalContributions
    } : {
      ok: false,
      reason: equitiesResult.reason,
      detail: equitiesResult.detail
    },
    activeFund: activeFundResult.ok ? {
      ok: true,
      path: activeFundPathFinal,
      endingValue: getEndingValue(activeFundPathFinal),
      cagr: calculateCAGR(getStartingValue(activeFundPathFinal), getEndingValue(activeFundPathFinal), horizonYears),
      totalContributions
    } : {
      ok: false,
      reason: activeFundResult.reason,
      detail: activeFundResult.detail
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
