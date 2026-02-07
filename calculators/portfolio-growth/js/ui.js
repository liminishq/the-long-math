/**
 * Portfolio Growth Calculator - UI Controller
 * Wires inputs, sliders, chart, and results
 */

(function() {
  'use strict';
  
  // State
  let alignedData = null;
  // Basis points (0-1000 representing 0.0%-100.0%)
  let bondsBP = 0;     // 0.0%
  let gicBP = 0;       // 0.0%
  let eqBP = 0;        // 0.0%
  // cashBP is derived: 1000 - (bondsBP + gicBP + eqBP), defaults to 1000 (100.0%)
  
  // Helper functions for basis points
  // Supports 0.5% increments: 0.5% = 5 BP, 1.0% = 10 BP, etc.
  const toBP = (pct) => Math.round(parseFloat(pct) * 10);
  const fromBP = (bp) => (bp / 10).toFixed(1);

  // DOM elements
  const dataStatus = document.getElementById('dataStatus');
  const dataWarnings = document.getElementById('dataWarnings');
  const startDateSelect = document.getElementById('startDate');
  const startingAmountInput = document.getElementById('startingAmount');
  const monthlyContributionInput = document.getElementById('monthlyContribution');
  const horizonYearsInput = document.getElementById('horizonYears');
  const allocationContainer = document.getElementById('allocationContainer');
  const allocationTotal = document.getElementById('allocationTotal');
  const allocationError = document.getElementById('allocationError');
  const resetAllocationsBtn = document.getElementById('resetAllocations');
  const inflationAdjustedCheckbox = document.getElementById('inflationAdjusted');
  const endingValueDisplay = document.getElementById('endingValue');
  const cagrDisplay = document.getElementById('cagr');
  const returnLabel = document.getElementById('returnLabel');
  const totalContributionsDisplay = document.getElementById('totalContributions');
  const periodDisplay = document.getElementById('period');
  const chartCanvas = document.getElementById('growthChart');

  /**
   * Format currency
   */
  function formatCurrency(value) {
    if (value == null || !isFinite(value)) return '—';
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  /**
   * Format percentage
   */
  function formatPercent(value) {
    if (value == null || !isFinite(value)) return '—';
    return value.toFixed(2) + '%';
  }

  /**
   * Compute CAGR (only when no contributions)
   */
  function computeCAGR(startingAmount, finalValue, totalMonths) {
    if (startingAmount <= 0 || finalValue <= 0 || totalMonths <= 0) return null;
    const years = totalMonths / 12;
    const cagr = Math.pow(finalValue / startingAmount, 1 / years) - 1;
    if (!Number.isFinite(cagr)) return null;
    return cagr * 100; // Convert to percentage
  }

  /**
   * Calculate annual return for an asset class over a time period
   */
  function calculateAssetAnnualReturn(alignedData, assetKey, startDate, endDate) {
    const assetSeries = alignedData.assets[assetKey];
    if (!assetSeries || assetSeries.length === 0) return 0;

    const startValue = DataLocal.getValueAtDate(assetSeries, startDate);
    const endValue = DataLocal.getValueAtDate(assetSeries, endDate);
    
    if (!startValue || !endValue || startValue <= 0 || endValue <= 0) return 0;

    // Calculate number of years
    const startIndex = alignedData.dates.indexOf(startDate);
    const endIndex = alignedData.dates.indexOf(endDate);
    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) return 0;
    
    const months = endIndex - startIndex;
    const years = months / 12;
    if (years <= 0) return 0;

    // Calculate annualized return: (end/start)^(1/years) - 1
    const annualReturn = Math.pow(endValue / startValue, 1 / years) - 1;
    return annualReturn;
  }

  /**
   * Calculate weighted portfolio annual return based on allocations
   */
  function calculatePortfolioAnnualReturn(alignedData, allocations, startDate, endDate) {
    let weightedReturn = 0;
    
    for (const [assetKey, allocation] of Object.entries(allocations)) {
      if (allocation === 0) continue;
      
      const assetReturn = calculateAssetAnnualReturn(alignedData, assetKey, startDate, endDate);
      weightedReturn += (allocation / 100) * assetReturn;
    }
    
    return weightedReturn;
  }

  /**
   * Calculate NPV for IRR (annual rate, monthly cashflows)
   */
  function npv(annualRate, cashflows, months) {
    let sum = 0;
    const monthlyRate = Math.pow(1 + annualRate, 1/12) - 1;
    
    for (let i = 0; i < cashflows.length; i++) {
      const cf = cashflows[i];
      const t = i; // months
      sum += cf / Math.pow(1 + monthlyRate, t);
    }
    return sum;
  }

  /**
   * Calculate IRR using bisection method
   * Returns annual IRR as a decimal (e.g., 0.05 for 5%)
   */
  function calculateIRR(cashflows, months) {
    if (cashflows.length < 2) return null;
    
    let lo = -0.99; // -99% annual rate
    let hi = 10;    // 1000% annual rate
    
    let fLo = npv(lo, cashflows, months);
    let fHi = npv(hi, cashflows, months);
    
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
    if (Math.abs(fLo) < 1e-10) return lo;
    if (Math.abs(fHi) < 1e-10) return hi;
    if (fLo * fHi > 0) return null; // No sign change, no solution
    
    // Bisection
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const fMid = npv(mid, cashflows, months);
      
      if (!Number.isFinite(fMid)) return null;
      if (Math.abs(fMid) < 1e-10) return mid;
      
      if (fLo * fMid <= 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
      
      if (Math.abs(hi - lo) < 1e-10) break;
    }
    
    return (lo + hi) / 2;
  }

  /**
   * Find earliest common month across all required datasets
   */
  function findEarliestCommonMonth() {
    if (!alignedData || !alignedData.dates || alignedData.dates.length === 0) {
      return null;
    }

    // Check all asset keys (cash, bonds, gic, equities)
    const assetKeys = ['cash', 'bonds', 'gic', 'equities'];

    // Find earliest date where we have all required assets
    for (const date of alignedData.dates) {
      let hasAllData = true;
      for (const assetKey of assetKeys) {
        const assetSeries = alignedData.assets[assetKey];
        if (!assetSeries || DataLocal.getValueAtDate(assetSeries, date) == null) {
          hasAllData = false;
          break;
        }
      }
      if (hasAllData) {
        return date;
      }
    }

    return alignedData.dates[0];
  }

  /**
   * Clamp start date to available range
   */
  function clampStartDate(requestedDate) {
    const earliest = findEarliestCommonMonth();
    if (!earliest) return requestedDate;
    
    if (requestedDate < earliest) {
      return earliest;
    }
    return requestedDate;
  }

  /**
   * Update allocation total display (always 100.0%)
   */
  function updateAllocationTotal() {
    allocationTotal.textContent = '100.0%';
    allocationTotal.style.color = 'var(--accent)';
    allocationError.style.display = 'none';
  }
  
  /**
   * Update allocations object from basis points (for simulation)
   */
  function updateAllocationsFromBP() {
    const cashBP = 1000 - (bondsBP + gicBP + eqBP);
    return {
      cash: cashBP / 10,
      bonds: bondsBP / 10,
      gic: gicBP / 10,
      equities: eqBP / 10
    };
  }
  
  /**
   * Handle slider input for editable sliders (bonds, gic, equities)
   */
  function handleSliderInput(key, value) {
    const newBP = toBP(value);
    let maxBP;
    
    if (key === 'bonds') {
      maxBP = 1000 - (gicBP + eqBP);
      bondsBP = Math.max(0, Math.min(maxBP, newBP));
    } else if (key === 'gic') {
      maxBP = 1000 - (bondsBP + eqBP);
      gicBP = Math.max(0, Math.min(maxBP, newBP));
    } else if (key === 'equities') {
      maxBP = 1000 - (bondsBP + gicBP);
      eqBP = Math.max(0, Math.min(maxBP, newBP));
    }
    
    // Derive cash
    const cashBP = 1000 - (bondsBP + gicBP + eqBP);
    
    // Update all slider values and labels
    const bondsSlider = document.getElementById('slider-bonds');
    const gicSlider = document.getElementById('slider-gic');
    const eqSlider = document.getElementById('slider-equities');
    const cashSlider = document.getElementById('slider-cash');
    
    if (bondsSlider) {
      bondsSlider.value = fromBP(bondsBP);
      document.getElementById('alloc-bonds').textContent = fromBP(bondsBP) + '%';
    }
    if (gicSlider) {
      gicSlider.value = fromBP(gicBP);
      document.getElementById('alloc-gic').textContent = fromBP(gicBP) + '%';
    }
    if (eqSlider) {
      eqSlider.value = fromBP(eqBP);
      document.getElementById('alloc-equities').textContent = fromBP(eqBP) + '%';
    }
    if (cashSlider) {
      cashSlider.value = fromBP(cashBP);
      document.getElementById('alloc-cash').textContent = fromBP(cashBP) + '%';
    }
    
    updateAllocationTotal();
    calculateAndUpdate();
  }

  /**
   * Create allocation slider
   */
  function createAllocationSlider(key, asset) {
    const div = document.createElement('div');
    div.className = 'allocation-item';
    
    const label = document.createElement('label');
    label.innerHTML = `
      <span>${asset.name}</span>
      <span class="allocation-value" id="alloc-${key}">0%</span>
    `;
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '0.5';
    slider.id = `slider-${key}`;
    
    // Cash is derived (disabled), others are editable
    if (key === 'cash') {
      slider.disabled = true;
      slider.classList.add('disabled');
    } else {
      slider.addEventListener('input', function() {
        handleSliderInput(key, this.value);
      });
    }

    div.appendChild(label);
    div.appendChild(slider);
    return div;
  }

  /**
   * Initialize allocation sliders
   */
  function initAllocations() {
    allocationContainer.innerHTML = '';
    
    // Create sliders in order: Bonds, GIC Proxy, Equities, Cash (derived)
    const assetOrder = [
      { key: 'bonds', name: 'Bonds' },
      { key: 'gic', name: 'GIC Proxy' },
      { key: 'equities', name: 'Equities' },
      { key: 'cash', name: 'Cash' }
    ];

    for (const asset of assetOrder) {
      const slider = createAllocationSlider(asset.key, asset);
      allocationContainer.appendChild(slider);
    }
    
    // Initialize display values from basis points
    const cashBP = 1000 - (bondsBP + gicBP + eqBP);
    document.getElementById('alloc-bonds').textContent = fromBP(bondsBP) + '%';
    document.getElementById('alloc-gic').textContent = fromBP(gicBP) + '%';
    document.getElementById('alloc-equities').textContent = fromBP(eqBP) + '%';
    document.getElementById('alloc-cash').textContent = fromBP(cashBP) + '%';
    
    document.getElementById('slider-bonds').value = fromBP(bondsBP);
    document.getElementById('slider-gic').value = fromBP(gicBP);
    document.getElementById('slider-equities').value = fromBP(eqBP);
    document.getElementById('slider-cash').value = fromBP(cashBP);

    updateAllocationTotal();
  }

  /**
   * Reset allocations to default (all 0%, cash 100%)
   */
  function resetAllocations() {
    bondsBP = 0;   // 0.0%
    gicBP = 0;     // 0.0%
    eqBP = 0;      // 0.0%
    // cashBP = 1000 (100.0%) - derived
    
    const cashBP = 1000 - (bondsBP + gicBP + eqBP);
    
    document.getElementById('slider-bonds').value = fromBP(bondsBP);
    document.getElementById('slider-gic').value = fromBP(gicBP);
    document.getElementById('slider-equities').value = fromBP(eqBP);
    document.getElementById('slider-cash').value = fromBP(cashBP);
    
    document.getElementById('alloc-bonds').textContent = fromBP(bondsBP) + '%';
    document.getElementById('alloc-gic').textContent = fromBP(gicBP) + '%';
    document.getElementById('alloc-equities').textContent = fromBP(eqBP) + '%';
    document.getElementById('alloc-cash').textContent = fromBP(cashBP) + '%';
    
    updateAllocationTotal();
    calculateAndUpdate();
  }

  /**
   * Populate start date dropdown
   */
  function populateStartDates() {
    if (!alignedData || !alignedData.dates || alignedData.dates.length === 0) {
      return;
    }
    
    startDateSelect.innerHTML = '';
    
    const earliestDate = findEarliestCommonMonth();
    if (!earliestDate) {
      return;
    }

    // Add options from earliest to latest (going forward)
    for (const date of alignedData.dates) {
      if (date >= earliestDate) {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = date;
        startDateSelect.appendChild(option);
      }
    }

    // Set default to 2000-01 or earliest available
    const defaultDate = alignedData.dates.find(d => d >= '2000-01') || earliestDate;
    if (defaultDate) {
      startDateSelect.value = defaultDate;
    } else {
      startDateSelect.value = startDateSelect.options[startDateSelect.options.length - 1]?.value || earliestDate;
    }
  }

  /**
   * Update chart with historical data and portfolio
   */
  function updateChart() {
    if (!alignedData || !ChartManager.chart) return;

    let startDate = startDateSelect.value;
    if (!startDate) {
      startDate = findEarliestCommonMonth();
      if (!startDate) return;
    }

    // Clamp start date
    const clampedStart = clampStartDate(startDate);
    if (clampedStart !== startDate) {
      startDateSelect.value = clampedStart;
      startDate = clampedStart;
      // Show warning
      if (dataWarnings) {
        dataWarnings.style.display = 'block';
        dataWarnings.textContent = `Start date adjusted to ${clampedStart} (earliest available data)`;
      }
    } else {
      if (dataWarnings) {
        dataWarnings.style.display = 'none';
      }
    }

    const inflationAdjusted = inflationAdjustedCheckbox.checked;
    const datasets = [];

    // Asset colors
    const colors = {
      cash: '#888888',
      bonds: '#50C878',
      gic: '#FFB84D',
      equities: '#D9B46A'
    };

    // Add historical asset lines (pre-populated on load)
    const assetNames = {
      cash: 'Cash',
      bonds: 'Bonds',
      gic: 'GIC Proxy',
      equities: 'Equities'
    };

    for (const [key, name] of Object.entries(assetNames)) {
      const assetSeries = alignedData.assets[key];
      if (assetSeries && assetSeries.length > 0) {
        // Get the start value for indexing
        const startValue = DataLocal.getValueAtDate(assetSeries, startDate);
        
        if (startValue != null && startValue > 0) {
          // Get chart dates and index values
          const startIndex = alignedData.dates.indexOf(startDate);
          if (startIndex !== -1) {
            const chartDates = alignedData.dates.slice(startIndex);
            const values = [];
            
            for (const date of chartDates) {
              const value = DataLocal.getValueAtDate(assetSeries, date);
              if (value != null && value > 0) {
                let indexedValue = value / startValue;
                
                // Apply inflation adjustment if needed
                if (inflationAdjusted && alignedData.cpi && alignedData.cpi.length > 0) {
                  const cpiStart = DataLocal.getCPIAtDate(startDate);
                  const cpiCurrent = DataLocal.getCPIAtDate(date);
                  if (cpiStart && cpiCurrent && cpiStart > 0 && cpiCurrent > 0) {
                    indexedValue = indexedValue * (cpiStart / cpiCurrent);
                  }
                }
                
                values.push(indexedValue);
              } else {
                values.push(null); // Gap in data
              }
            }
            
            if (values.length > 0 && values.some(v => v != null)) {
              datasets.push({
                label: name,
                data: values,
                borderColor: colors[key],
                backgroundColor: colors[key] + '40',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.1,
                spanGaps: false
              });
            }
          }
        }
      }
    }

    // Get chart dates (same as used for asset lines)
    const startIndex = alignedData.dates.indexOf(clampedStart);
    const chartDates = startIndex !== -1 
      ? alignedData.dates.slice(startIndex)
      : [];

    // Add portfolio line if allocations sum to 100%
    updateAllocationTotal(); // Always shows 100.0%
    try {
      const horizonYears = parseFloat(horizonYearsInput.value) || 30;
      const allocations = updateAllocationsFromBP();
      const result = Sim.simulatePortfolio(alignedData, {
        startDate: clampedStart,
        startingAmount: parseFloat(startingAmountInput.value) || 0,
        monthlyContribution: parseFloat(monthlyContributionInput.value) || 0,
        horizonYears,
        allocations,
        inflationAdjusted
      });

      if (result.portfolio.length > 0) {
        const indexedPortfolio = Sim.indexPortfolio(result.portfolio, inflationAdjusted);
        if (indexedPortfolio.length > 0) {
          // Align portfolio data to chart dates
          const portfolioMap = new Map();
          for (const item of indexedPortfolio) {
            portfolioMap.set(item.date, item.value);
          }
          
          const portfolioValues = [];
          for (const date of chartDates) {
            const value = portfolioMap.get(date);
            portfolioValues.push(value != null ? value : null);
          }
          
          datasets.push({
            label: 'Your Portfolio',
            data: portfolioValues,
            borderColor: '#E85D75',
            backgroundColor: '#E85D7540',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.1,
            borderDash: [5, 5],
            spanGaps: false
          });
        }
      }
    } catch (error) {
      console.error('Portfolio simulation error:', error);
    }

    ChartManager.update(chartDates, datasets);
  }

  /**
   * Calculate and update results
   */
  function calculateAndUpdate() {
    if (!alignedData) return;

    let startDate = startDateSelect.value;
    if (!startDate) {
      startDate = findEarliestCommonMonth();
      if (!startDate) return;
    }

    // Clamp start date
    const clampedStart = clampStartDate(startDate);
    if (clampedStart !== startDate) {
      startDateSelect.value = clampedStart;
      startDate = clampedStart;
    }

    updateAllocationTotal(); // Always shows 100.0%
    
    try {
      const startingAmount = parseFloat(startingAmountInput.value) || 0;
      const monthlyContribution = parseFloat(monthlyContributionInput.value) || 0;
      const horizonYears = parseFloat(horizonYearsInput.value) || 30;
      const inflationAdjusted = inflationAdjustedCheckbox.checked;
      const allocations = updateAllocationsFromBP();

      const result = Sim.simulatePortfolio(alignedData, {
        startDate: clampedStart,
        startingAmount,
        monthlyContribution,
        horizonYears,
        allocations,
        inflationAdjusted
      });

      if (result.portfolio.length === 0) {
        endingValueDisplay.textContent = '—';
        cagrDisplay.textContent = '—';
        totalContributionsDisplay.textContent = '—';
        periodDisplay.textContent = '—';
        return;
      }

      const finalValue = inflationAdjusted && result.portfolio[result.portfolio.length - 1].realValue != null
        ? result.portfolio[result.portfolio.length - 1].realValue
        : result.portfolio[result.portfolio.length - 1].value;

      endingValueDisplay.textContent = formatCurrency(finalValue);

      // Calculate return metric: CAGR if no contributions, IRR if contributions exist
      const totalMonths = result.portfolio.length - 1;
      let returnValue = null;
      let labelText = 'CAGR';
      
      if (monthlyContribution === 0) {
        // No contributions: use CAGR
        returnValue = computeCAGR(startingAmount, finalValue, totalMonths);
        labelText = 'CAGR';
      } else {
        // Contributions exist: use IRR (Money-weighted return)
        labelText = 'Money-weighted return (IRR)';
        
        // Calculate portfolio annual return based on asset allocations and their returns
        const portfolioAnnualReturn = calculatePortfolioAnnualReturn(
          alignedData,
          allocations,
          result.actualStartDate,
          result.actualEndDate
        );
        
        // Build cashflow array: monthly cashflows
        // Month 0: -startingAmount (initial investment, negative outflow)
        // Months 1 to N-1: -monthlyContribution (monthly contributions, negative outflows)
        // Month N: +finalValue (ending portfolio value, positive inflow)
        const cashflows = [-startingAmount]; // Month 0: initial investment (negative)
        
        // Monthly contributions (negative outflows) for months 1 through N-1
        for (let i = 1; i < result.portfolio.length - 1; i++) {
          cashflows.push(-monthlyContribution);
        }
        
        // Final month: ending value (positive inflow)
        // This replaces what would have been the last contribution
        cashflows.push(finalValue);
        
        // Calculate IRR (returns annual rate as decimal)
        const irrAnnual = calculateIRR(cashflows, totalMonths);
        
        if (irrAnnual != null && Number.isFinite(irrAnnual) && irrAnnual > -1 && irrAnnual < 10) {
          returnValue = irrAnnual * 100; // Convert to percentage
        }
      }

      // Update label
      if (returnLabel) {
        returnLabel.textContent = labelText;
      }

      // Display result
      if (returnValue != null && isFinite(returnValue)) {
        cagrDisplay.textContent = formatPercent(returnValue);
      } else {
        cagrDisplay.textContent = '—';
      }

      const totalContributions = monthlyContribution * (result.portfolio.length - 1);
      totalContributionsDisplay.textContent = formatCurrency(totalContributions);

      // Check if horizon was clamped
      const requestedMonths = Math.floor(horizonYears * 12);
      const actualMonths = result.portfolio.length - 1;
      if (actualMonths < requestedMonths) {
        periodDisplay.textContent = `${result.actualStartDate} to ${result.actualEndDate} (horizon limited by available data)`;
      } else {
        periodDisplay.textContent = `${result.actualStartDate} to ${result.actualEndDate}`;
      }

      updateChart();
    } catch (error) {
      console.error('Calculation error:', error);
      endingValueDisplay.textContent = '—';
      cagrDisplay.textContent = '—';
      totalContributionsDisplay.textContent = '—';
      periodDisplay.textContent = '—';
    }
  }

  /**
   * Initialize application
   */
  async function init() {
    // Initialize UI
    initAllocations();
    ChartManager.init(chartCanvas);

    // Set default starting amount to 0
    startingAmountInput.value = '0';

    // Load data
    dataStatus.className = 'data-status loading';
    dataStatus.textContent = 'Loading data...';

    try {
      const result = await DataLocal.loadAll();
      alignedData = result.alignedData;

      if (!result.success) {
        dataStatus.className = 'data-status error';
        dataStatus.textContent = `Error: Missing data files: ${result.missing.join(', ')}`;
        return;
      }

      if (result.warnings.length > 0) {
        dataWarnings.style.display = 'block';
        dataWarnings.innerHTML = `<strong>Warnings:</strong> ${result.warnings.join(', ')}`;
      } else {
        dataWarnings.style.display = 'none';
      }

      dataStatus.className = 'data-status success';
      dataStatus.textContent = 'Data loaded successfully';

      // Populate start dates
      populateStartDates();

      // Set default allocations (all 0%, cash 100%)
      resetAllocations();

      // Pre-populate chart with historical lines (real/inflation-adjusted by default)
      updateChart();

      // Initial calculation
      calculateAndUpdate();

    } catch (error) {
      console.error('Initialization error:', error);
      dataStatus.className = 'data-status error';
      dataStatus.textContent = `Error: ${error.message}`;
    }

    // Event listeners
    startDateSelect.addEventListener('change', calculateAndUpdate);
    startingAmountInput.addEventListener('input', calculateAndUpdate);
    monthlyContributionInput.addEventListener('input', calculateAndUpdate);
    horizonYearsInput.addEventListener('input', calculateAndUpdate);
    inflationAdjustedCheckbox.addEventListener('change', function() {
      updateChart(); // Update chart immediately to show real/nominal switch
      calculateAndUpdate();
    });
    resetAllocationsBtn.addEventListener('click', resetAllocations);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
