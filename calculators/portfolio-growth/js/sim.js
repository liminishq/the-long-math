/**
 * Portfolio Simulation Engine
 * Handles portfolio simulation, inflation adjustment, and CAGR calculation
 */

const Sim = {
  /**
   * Get asset return for a specific date
   */
  getAssetReturn(alignedData, assetKey, date) {
    const assetSeries = alignedData.assets[assetKey];
    if (!assetSeries || assetSeries.length === 0) return 0;

    // Find the month's return
    const dateIndex = alignedData.dates.indexOf(date);
    if (dateIndex <= 0) return 0;

    const prevDate = alignedData.dates[dateIndex - 1];
    const prevValue = DataLocal.getValueAtDate(assetSeries, prevDate);
    const currValue = DataLocal.getValueAtDate(assetSeries, date);

    if (prevValue > 0 && currValue > 0) {
      return (currValue / prevValue) - 1;
    }
    return 0;
  },

  /**
   * Simulate portfolio growth
   */
  simulatePortfolio(alignedData, config) {
    const {
      startDate,
      startingAmount,
      monthlyContribution,
      horizonYears,
      allocations,
      inflationAdjusted
    } = config;

    // Find start index
    let startIndex = alignedData.dates.indexOf(startDate);
    if (startIndex === -1) {
      // Find nearest date >= startDate
      for (let i = 0; i < alignedData.dates.length; i++) {
        if (alignedData.dates[i] >= startDate) {
          startIndex = i;
          break;
        }
      }
      if (startIndex === -1) {
        throw new Error(`Start date ${startDate} is after all available data`);
      }
    }

    // Calculate end index based on horizon
    const horizonMonths = Math.floor(horizonYears * 12);
    let endIndex = Math.min(startIndex + horizonMonths, alignedData.dates.length - 1);
    const actualEndDate = alignedData.dates[endIndex];
    
    // Warn if horizon was clamped
    if (startIndex + horizonMonths > alignedData.dates.length - 1) {
      // Horizon exceeds available data - will be handled in UI
    }

    // Get CPI at start (for inflation adjustment)
    const cpiStart = inflationAdjusted ? DataLocal.getCPIAtDate(alignedData.dates[startIndex]) : null;
    if (inflationAdjusted && !cpiStart) {
      throw new Error('CPI data not available for inflation adjustment');
    }

    // Initialize portfolio
    const portfolio = [];
    let portfolioValue = startingAmount;
    const assetValues = {};

    // Initialize asset values based on allocation
    for (const assetKey of Object.keys(allocations)) {
      assetValues[assetKey] = portfolioValue * (allocations[assetKey] / 100);
    }

    // Add starting point
    portfolio.push({
      date: alignedData.dates[startIndex],
      value: portfolioValue,
      realValue: inflationAdjusted ? portfolioValue * (cpiStart / cpiStart) : null
    });

    // Simulate month by month
    for (let i = startIndex + 1; i <= endIndex; i++) {
      const date = alignedData.dates[i];
      const prevDate = alignedData.dates[i - 1];

      // Apply returns to existing holdings
      let newPortfolioValue = 0;
      for (const [assetKey, allocation] of Object.entries(allocations)) {
        if (allocation === 0) continue;

        const assetReturn = this.getAssetReturn(alignedData, assetKey, date);
        const assetValue = assetValues[assetKey] || 0;
        assetValues[assetKey] = assetValue * (1 + assetReturn);
        newPortfolioValue += assetValues[assetKey];
      }

      // Add monthly contribution at end of month
      newPortfolioValue += monthlyContribution;
      portfolioValue = newPortfolioValue;

      // Reallocate contribution
      for (const [assetKey, allocation] of Object.entries(allocations)) {
        const contributionAllocation = monthlyContribution * (allocation / 100);
        assetValues[assetKey] = (assetValues[assetKey] || 0) + contributionAllocation;
      }

      // Calculate real value if inflation-adjusted
      // Deflate to start month (base = start month CPI)
      let realValue = null;
      if (inflationAdjusted && cpiStart) {
        const cpiCurrent = DataLocal.getCPIAtDate(date);
        if (cpiCurrent && cpiCurrent > 0) {
          realValue = portfolioValue * (cpiStart / cpiCurrent);
        }
      }

      portfolio.push({
        date,
        value: portfolioValue,
        realValue
      });
    }

    return {
      portfolio,
      actualStartDate: alignedData.dates[startIndex],
      actualEndDate
    };
  },

  /**
   * Calculate IRR using Newton-Raphson method
   */
  calculateIRRFromCashflows(cashflows, initialGuess = 0.001) {
    if (cashflows.length < 2) return null;

    const maxIterations = 100;
    const tolerance = 1e-6;
    let rate = initialGuess;

    // NPV function
    const npv = (r) => {
      let sum = 0;
      for (let i = 0; i < cashflows.length; i++) {
        const cf = cashflows[i];
        const t = i / 12; // Convert months to years
        sum += cf / Math.pow(1 + r, t);
      }
      return sum;
    };

    // NPV derivative
    const npvDerivative = (r) => {
      let sum = 0;
      for (let i = 0; i < cashflows.length; i++) {
        const cf = cashflows[i];
        const t = i / 12;
        sum -= (t * cf) / Math.pow(1 + r, t + 1);
      }
      return sum;
    };

    // Newton-Raphson iteration
    for (let iter = 0; iter < maxIterations; iter++) {
      const npvVal = npv(rate);
      const npvDeriv = npvDerivative(rate);

      if (Math.abs(npvVal) < tolerance) {
        return rate;
      }

      if (Math.abs(npvDeriv) < tolerance) {
        break; // Derivative too small, can't converge
      }

      const newRate = rate - npvVal / npvDeriv;
      
      // Guard against invalid rates
      if (newRate <= -1 || newRate > 10 || !isFinite(newRate)) {
        break;
      }

      if (Math.abs(newRate - rate) < tolerance) {
        return newRate;
      }

      rate = newRate;
    }

    return null;
  },

  /**
   * Calculate CAGR from portfolio simulation (money-weighted return)
   */
  calculateCAGR(portfolio, startingAmount, monthlyContribution) {
    if (portfolio.length < 2) return null;

    const endValue = portfolio[portfolio.length - 1].value;

    // Build cashflow array for IRR
    // t0: -starting_amount
    // each month: -monthly_contribution
    // final month: +ending_value
    const cashflows = [-startingAmount]; // Initial investment (negative)
    
    // Monthly contributions (negative)
    for (let i = 1; i < portfolio.length; i++) {
      cashflows.push(-monthlyContribution);
    }

    // Final value (positive) - replace last contribution with net final value
    cashflows[cashflows.length - 1] = endValue - monthlyContribution;

    // Calculate monthly IRR
    const monthlyIRR = this.calculateIRRFromCashflows(cashflows);
    
    if (monthlyIRR != null && isFinite(monthlyIRR) && monthlyIRR > -1 && monthlyIRR < 10) {
      // Annualize: (1 + irr_m)^12 - 1
      return (Math.pow(1 + monthlyIRR, 12) - 1) * 100;
    }

    return null;
  },

  /**
   * Index asset series to start at 1.0 at a specific date
   */
  indexAssetSeries(series, startDate) {
    if (!series || series.length === 0) return [];

    // Find start value
    const startValue = DataLocal.getValueAtDate(series, startDate);
    if (startValue <= 0) return [];

    // Index all values
    return series
      .filter(item => item.date >= startDate)
      .map(item => ({
        date: item.date,
        value: item.value / startValue
      }));
  },

  /**
   * Index portfolio to start at 1.0 for comparison
   */
  indexPortfolio(portfolio, useRealValue = false) {
    if (portfolio.length === 0) return [];

    const startValue = useRealValue && portfolio[0].realValue != null
      ? portfolio[0].realValue
      : portfolio[0].value;

    if (startValue <= 0) return [];

    return portfolio.map(p => ({
      date: p.date,
      value: (useRealValue && p.realValue != null ? p.realValue : p.value) / startValue
    }));
  }
};
