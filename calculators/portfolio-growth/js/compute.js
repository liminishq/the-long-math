/**
 * Portfolio Growth Computation Engine
 * Handles portfolio simulation, inflation adjustment, and IRR calculation
 */

const Compute = {
  /**
   * Calculate monthly returns from index values
   */
  getMonthlyReturns(indexSeries) {
    const returns = [];
    for (let i = 1; i < indexSeries.length; i++) {
      const prev = indexSeries[i - 1].value;
      const curr = indexSeries[i].value;
      if (prev > 0) {
        returns.push({
          date: indexSeries[i].date,
          return: (curr / prev) - 1
        });
      }
    }
    return returns;
  },

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
    const prevValue = this.getValueAtDate(assetSeries, prevDate);
    const currValue = this.getValueAtDate(assetSeries, date);

    if (prevValue > 0 && currValue > 0) {
      return (currValue / prevValue) - 1;
    }
    return 0;
  },

  /**
   * Get value at a specific date (or nearest before)
   */
  getValueAtDate(series, date) {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].date <= date) {
        return series[i].value;
      }
    }
    return series[0]?.value || 1.0;
  },

  /**
   * Get CPI value at a specific date
   */
  getCPIAtDate(alignedData, date) {
    if (!alignedData.cpi) return null;
    return this.getValueAtDate(alignedData.cpi, date);
  },

  /**
   * Simulate portfolio growth
   */
  simulatePortfolio(alignedData, config) {
    const {
      startDate,
      startingAmount,
      monthlyContribution,
      allocations,
      inflationAdjusted
    } = config;

    // Find start index
    const startIndex = alignedData.dates.indexOf(startDate);
    if (startIndex === -1) {
      throw new Error(`Start date ${startDate} not found in data`);
    }

    // Get CPI at start and end (for inflation adjustment)
    // Deflate to last available month (base = 100)
    const cpiStart = inflationAdjusted ? this.getCPIAtDate(alignedData, startDate) : null;
    const cpiEnd = inflationAdjusted && alignedData.cpi && alignedData.cpi.length > 0
      ? alignedData.cpi[alignedData.cpi.length - 1].value
      : null;
    if (inflationAdjusted && (!cpiStart || !cpiEnd)) {
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
      date: startDate,
      value: portfolioValue,
      realValue: inflationAdjusted ? portfolioValue * (cpiStart / cpiStart) : null
    });

    // Simulate month by month
    for (let i = startIndex + 1; i < alignedData.dates.length; i++) {
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

      // Add monthly contribution and allocate
      newPortfolioValue += monthlyContribution;
      portfolioValue = newPortfolioValue;

      // Reallocate contribution
      for (const [assetKey, allocation] of Object.entries(allocations)) {
        const contributionAllocation = monthlyContribution * (allocation / 100);
        assetValues[assetKey] = (assetValues[assetKey] || 0) + contributionAllocation;
      }

      // Calculate real value if inflation-adjusted
      // Deflate to last available month (base = 100)
      let realValue = null;
      if (inflationAdjusted && cpiEnd) {
        const cpiCurrent = this.getCPIAtDate(alignedData, date);
        if (cpiCurrent) {
          realValue = portfolioValue * (cpiEnd / cpiCurrent);
        }
      }

      portfolio.push({
        date,
        value: portfolioValue,
        realValue
      });
    }

    return portfolio;
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

    // Fallback: simple CAGR if IRR fails
    const firstCF = cashflows[0];
    const lastCF = cashflows[cashflows.length - 1];
    if (firstCF < 0 && lastCF > 0) {
      const years = (cashflows.length - 1) / 12;
      if (years > 0) {
        return Math.pow(Math.abs(lastCF / firstCF), 1 / years) - 1;
      }
    }

    return null;
  },

  /**
   * Calculate IRR from portfolio simulation (money-weighted return)
   * Returns monthly IRR, or null if calculation fails
   */
  calculateIRR(portfolio, startingAmount, monthlyContribution) {
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
    return this.calculateIRRFromCashflows(cashflows);
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
  },

  /**
   * Index asset series to start at 1.0 at a specific date
   */
  indexAssetSeries(series, startDate) {
    if (!series || series.length === 0) return [];

    // Find start value
    const startValue = this.getValueAtDate(series, startDate);
    if (startValue <= 0) return [];

    // Index all values
    return series
      .filter(item => item.date >= startDate)
      .map(item => ({
        date: item.date,
        value: item.value / startValue
      }));
  }
};
