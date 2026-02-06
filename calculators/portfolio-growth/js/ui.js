/**
 * Portfolio Growth Calculator - UI Controller
 * Wires inputs, sliders, chart, and results
 */

(function() {
  'use strict';
  
  // State
  let alignedData = null;
  let allocations = {
    cash: 0,
    bonds: 0,
    gic: 0,
    equities: 0
  };
  let lastTouchedSlider = null;

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
   * Find earliest common month across all required datasets
   */
  function findEarliestCommonMonth() {
    if (!alignedData || !alignedData.dates || alignedData.dates.length === 0) {
      return null;
    }

    // Find earliest date where we have all required assets
    for (const date of alignedData.dates) {
      let hasAllData = true;
      for (const assetKey of Object.keys(allocations)) {
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
   * Update allocation total display and normalize if needed
   */
  function updateAllocationTotal() {
    const total = Object.values(allocations).reduce((sum, val) => sum + val, 0);
    allocationTotal.textContent = total.toFixed(1) + '%';
    
    if (Math.abs(total - 100) > 0.1) {
      allocationTotal.style.color = 'var(--error, #E85D75)';
      allocationError.textContent = `Allocations must sum to 100% (currently ${total.toFixed(1)}%)`;
      allocationError.style.display = 'block';
      
      // Auto-normalize by adjusting the last-touched slider
      if (lastTouchedSlider && total !== 0) {
        const currentValue = allocations[lastTouchedSlider];
        const adjustment = 100 - total;
        allocations[lastTouchedSlider] = Math.max(0, Math.min(100, currentValue + adjustment));
        
        const slider = document.getElementById(`slider-${lastTouchedSlider}`);
        if (slider) {
          slider.value = allocations[lastTouchedSlider];
          document.getElementById(`alloc-${lastTouchedSlider}`).textContent = allocations[lastTouchedSlider].toFixed(1) + '%';
        }
        
        // Recursive call to check again
        return updateAllocationTotal();
      }
      
      return false;
    } else {
      allocationTotal.style.color = 'var(--accent)';
      allocationError.style.display = 'none';
      return true;
    }
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
    slider.step = '0.1';
    slider.value = allocations[key] || 0;
    slider.id = `slider-${key}`;
    
    slider.addEventListener('input', function() {
      lastTouchedSlider = key;
      allocations[key] = parseFloat(this.value);
      document.getElementById(`alloc-${key}`).textContent = allocations[key].toFixed(1) + '%';
      updateAllocationTotal();
      calculateAndUpdate();
    });

    div.appendChild(label);
    div.appendChild(slider);
    return div;
  }

  /**
   * Initialize allocation sliders
   */
  function initAllocations() {
    allocationContainer.innerHTML = '';
    
    const assetNames = {
      cash: 'Cash',
      bonds: 'Bonds',
      gic: 'GIC Proxy',
      equities: 'Equities'
    };

    for (const [key, name] of Object.entries(assetNames)) {
      const slider = createAllocationSlider(key, { name });
      allocationContainer.appendChild(slider);
      const allocDisplay = document.getElementById(`alloc-${key}`);
      if (allocDisplay) {
        allocDisplay.textContent = (allocations[key] || 0).toFixed(1) + '%';
      }
    }

    updateAllocationTotal();
  }

  /**
   * Reset allocations to equal weight
   */
  function resetAllocations() {
    const count = Object.keys(allocations).length;
    const equalWeight = 100 / count;
    
    for (const key of Object.keys(allocations)) {
      allocations[key] = equalWeight;
      const slider = document.getElementById(`slider-${key}`);
      if (slider) {
        slider.value = equalWeight;
        document.getElementById(`alloc-${key}`).textContent = equalWeight.toFixed(1) + '%';
      }
    }
    
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

    // Add portfolio line if allocations sum to 100%
    if (updateAllocationTotal()) {
      try {
        const horizonYears = parseFloat(horizonYearsInput.value) || 30;
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
    }

    // Get chart dates (same as used for asset lines)
    const startIndex = alignedData.dates.indexOf(clampedStart);
    const chartDates = startIndex !== -1 
      ? alignedData.dates.slice(startIndex)
      : [];

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

    if (!updateAllocationTotal()) {
      endingValueDisplay.textContent = '—';
      cagrDisplay.textContent = '—';
      totalContributionsDisplay.textContent = '—';
      periodDisplay.textContent = '—';
      updateChart();
      return;
    }
    
    try {
      const startingAmount = parseFloat(startingAmountInput.value) || 0;
      const monthlyContribution = parseFloat(monthlyContributionInput.value) || 0;
      const horizonYears = parseFloat(horizonYearsInput.value) || 30;
      const inflationAdjusted = inflationAdjustedCheckbox.checked;

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

      const cagr = Sim.calculateCAGR(result.portfolio, startingAmount, monthlyContribution);
      if (cagr != null && isFinite(cagr)) {
        cagrDisplay.textContent = formatPercent(cagr);
      } else {
        cagrDisplay.textContent = 'IRR unavailable';
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

      // Set default allocations (equal weight)
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
