/**
 * Portfolio Growth Calculator - Main Application
 * Handles UI, chart rendering, and user interactions
 */

(function() {
  'use strict';

  // State
  let alignedData = null;
  let chart = null;
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
  const allocationContainer = document.getElementById('allocationContainer');
  const allocationTotal = document.getElementById('allocationTotal');
  const allocationError = document.getElementById('allocationError');
  const resetAllocationsBtn = document.getElementById('resetAllocations');
  const inflationAdjustedCheckbox = document.getElementById('inflationAdjusted');
  const endingValueDisplay = document.getElementById('endingValue');
  const cagrDisplay = document.getElementById('cagr');
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
   * Update allocation total display
   */
  function updateAllocationTotal() {
    const total = Object.values(allocations).reduce((sum, val) => sum + val, 0);
    allocationTotal.textContent = total.toFixed(1) + '%';
    
    if (Math.abs(total - 100) > 0.1) {
      allocationTotal.style.color = 'var(--error, #E85D75)';
      allocationError.textContent = `Allocations must sum to 100% (currently ${total.toFixed(1)}%)`;
      allocationError.style.display = 'block';
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
      if (updateAllocationTotal()) {
        calculateAndUpdate();
      }
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
      document.getElementById(`alloc-${key}`).textContent = (allocations[key] || 0).toFixed(1) + '%';
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
    
    // Get earliest date where we have at least one asset
    let earliestDate = null;
    for (const date of alignedData.dates) {
      let hasData = false;
      for (const assetKey of Object.keys(allocations)) {
        if (assetKey === 'cash') {
          hasData = true;
          break;
        }
        const assetSeries = alignedData.assets[assetKey];
        if (assetSeries && Compute.getValueAtDate(assetSeries, date) > 0) {
          hasData = true;
          break;
        }
      }
      if (hasData) {
        earliestDate = date;
        break;
      }
    }

    if (!earliestDate) {
      earliestDate = alignedData.dates[0];
    }

    // Add options (going back max 50 years or to earliest available)
    const now = new Date();
    const maxDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const minYear = Math.max(
      parseInt(earliestDate.split('-')[0]),
      now.getFullYear() - 50
    );

    for (let year = now.getFullYear(); year >= minYear; year--) {
      for (let month = 11; month >= 0; month--) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (alignedData.dates.includes(dateStr) && dateStr >= earliestDate) {
          const option = document.createElement('option');
          option.value = dateStr;
          option.textContent = dateStr;
          startDateSelect.appendChild(option);
        }
      }
    }

    // Set default to 20 years ago or earliest available
    const defaultYear = Math.max(minYear, now.getFullYear() - 20);
    const defaultDate = `${defaultYear}-01`;
    if (alignedData.dates.includes(defaultDate)) {
      startDateSelect.value = defaultDate;
    } else {
      startDateSelect.value = startDateSelect.options[startDateSelect.options.length - 1]?.value || earliestDate;
    }
  }

  /**
   * Get theme colors
   */
  function getThemeColors() {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    return {
      text: computedStyle.getPropertyValue('--text').trim() || '#eef2f7',
      muted: computedStyle.getPropertyValue('--muted').trim() || 'rgba(238,242,247,.72)',
      border: computedStyle.getPropertyValue('--border').trim() || 'rgba(238,242,247,.14)'
    };
  }

  /**
   * Initialize Chart.js
   */
  function initChart() {
    if (chart) {
      chart.destroy();
    }

    const themeColors = getThemeColors();
    const ctx = chartCanvas.getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: themeColors.text,
              font: {
                size: 12
              },
              usePointStyle: true,
              padding: 12
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: themeColors.text,
            bodyColor: themeColors.text,
            borderColor: themeColors.border,
            borderWidth: 1
          }
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Date',
              color: themeColors.text
            },
            ticks: {
              color: themeColors.muted,
              maxRotation: 45,
              minRotation: 0
            },
            grid: {
              color: themeColors.border
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Indexed Growth (Start = 1.0)',
              color: themeColors.text
            },
            ticks: {
              color: themeColors.muted
            },
            grid: {
              color: themeColors.border
            },
            type: 'logarithmic',
            min: 0.1
          }
        }
      }
    });
  }

  /**
   * Update chart with historical data and portfolio
   */
  function updateChart() {
    if (!alignedData || !chart) return;

    const startDate = startDateSelect.value || (alignedData.dates && alignedData.dates[0]);
    if (!startDate) return;

    const inflationAdjusted = inflationAdjustedCheckbox.checked;
    const datasets = [];

    // Asset colors
    const colors = {
      cash: '#888888',
      bonds: '#50C878',
      gic: '#FFB84D',
      equities: '#D9B46A'
    };

    // Add historical asset lines
    const assetNames = {
      cash: 'Cash',
      bonds: 'Bonds',
      gic: 'GIC Proxy',
      equities: 'Equities'
    };

    for (const [key, name] of Object.entries(assetNames)) {
      const assetSeries = alignedData.assets[key];
      if (assetSeries) {
        const indexed = Compute.indexAssetSeries(assetSeries, startDate);
        if (indexed.length > 0) {
          // Apply inflation adjustment if needed
          // Deflate to last available month (base = 100)
          let values = indexed.map(item => item.value);
          if (inflationAdjusted && alignedData.cpi && alignedData.cpi.length > 0) {
            const cpiEnd = alignedData.cpi[alignedData.cpi.length - 1].value;
            if (cpiEnd) {
              values = indexed.map(item => {
                const cpiCurrent = Compute.getCPIAtDate(alignedData, item.date);
                return cpiCurrent ? item.value * (cpiEnd / cpiCurrent) : item.value;
              });
            }
          }

          datasets.push({
            label: name,
            data: values,
            borderColor: colors[key],
            backgroundColor: colors[key] + '40',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1
          });
        }
      }
    }

    // Add portfolio line if allocations sum to 100%
    if (updateAllocationTotal()) {
      try {
        const portfolio = Compute.simulatePortfolio(alignedData, {
          startDate,
          startingAmount: parseFloat(startingAmountInput.value) || 0,
          monthlyContribution: parseFloat(monthlyContributionInput.value) || 0,
          allocations,
          inflationAdjusted
        });

        if (portfolio.length > 0) {
          const indexedPortfolio = Compute.indexPortfolio(portfolio, inflationAdjusted);
          if (indexedPortfolio.length > 0) {
            datasets.push({
              label: 'Your Portfolio',
              data: indexedPortfolio.map(p => p.value),
              borderColor: '#E85D75',
              backgroundColor: '#E85D7540',
              borderWidth: 2.5,
              pointRadius: 0,
              tension: 0.1,
              borderDash: [5, 5]
            });
          }
        }
      } catch (error) {
        console.error('Portfolio simulation error:', error);
      }
    }

    // Update chart
    const startIndex = alignedData.dates.indexOf(startDate);
    const chartDates = startIndex !== -1 
      ? alignedData.dates.slice(startIndex)
      : [];

    // Update theme colors
    const themeColors = getThemeColors();
    chart.options.plugins.legend.labels.color = themeColors.text;
    chart.options.plugins.tooltip.titleColor = themeColors.text;
    chart.options.plugins.tooltip.bodyColor = themeColors.text;
    chart.options.plugins.tooltip.borderColor = themeColors.border;
    chart.options.scales.x.title.color = themeColors.text;
    chart.options.scales.x.ticks.color = themeColors.muted;
    chart.options.scales.x.grid.color = themeColors.border;
    chart.options.scales.y.title.color = themeColors.text;
    chart.options.scales.y.ticks.color = themeColors.muted;
    chart.options.scales.y.grid.color = themeColors.border;

    chart.data.labels = chartDates;
    chart.data.datasets = datasets;
    chart.update();
  }

  /**
   * Calculate and update results
   */
  function calculateAndUpdate() {
    if (!alignedData) return;

    const startDate = startDateSelect.value;
    if (!startDate) return;

    if (!updateAllocationTotal()) {
      endingValueDisplay.textContent = '—';
      cagrDisplay.textContent = '—';
      periodDisplay.textContent = '—';
      return;
    }

    try {
      const startingAmount = parseFloat(startingAmountInput.value) || 0;
      const monthlyContribution = parseFloat(monthlyContributionInput.value) || 0;
      const inflationAdjusted = inflationAdjustedCheckbox.checked;

      const portfolio = Compute.simulatePortfolio(alignedData, {
        startDate,
        startingAmount,
        monthlyContribution,
        allocations,
        inflationAdjusted
      });

      if (portfolio.length === 0) {
        endingValueDisplay.textContent = '—';
        cagrDisplay.textContent = '—';
        periodDisplay.textContent = '—';
        return;
      }

      const finalValue = inflationAdjusted && portfolio[portfolio.length - 1].realValue != null
        ? portfolio[portfolio.length - 1].realValue
        : portfolio[portfolio.length - 1].value;

      endingValueDisplay.textContent = formatCurrency(finalValue);

      const irr = Compute.calculateIRR(portfolio, startingAmount, monthlyContribution);
      if (irr != null && isFinite(irr)) {
        // Annualize monthly IRR: (1 + irr_m)^12 - 1
        const annualIRR = (Math.pow(1 + irr, 12) - 1) * 100;
        cagrDisplay.textContent = formatPercent(annualIRR);
      } else {
        cagrDisplay.textContent = 'IRR unavailable';
      }

      const endDate = portfolio[portfolio.length - 1].date;
      periodDisplay.textContent = `${startDate} to ${endDate}`;

      updateChart();
    } catch (error) {
      console.error('Calculation error:', error);
      endingValueDisplay.textContent = '—';
      cagrDisplay.textContent = '—';
      periodDisplay.textContent = '—';
    }
  }

  /**
   * Initialize application
   */
  async function init() {
    // Initialize UI
    initAllocations();
    initChart();

    // Load data
    dataStatus.className = 'data-status loading';
    dataStatus.textContent = 'Loading data...';

    try {
      const result = await DataLoader.loadAll();
      alignedData = result.alignedData;

      if (!result.success) {
        dataStatus.className = 'data-status warning';
        dataStatus.textContent = `Warning: Some data files could not be loaded: ${result.missing.join(', ')}`;
      } else {
        dataStatus.className = 'data-status success';
        dataStatus.textContent = 'Data loaded successfully';
      }

      if (result.warnings.length > 0) {
        dataWarnings.style.display = 'block';
        dataWarnings.innerHTML = `<strong>Warnings:</strong> ${result.warnings.join(', ')}`;
      }

      // Populate start dates
      populateStartDates();

      // Set default allocations (equal weight)
      resetAllocations();

      // Show historical lines immediately (pre-populate chart)
      updateChart();

      // Initial calculation (will also update chart, but chart already has historical lines)
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
    inflationAdjustedCheckbox.addEventListener('change', calculateAndUpdate);
    resetAllocationsBtn.addEventListener('click', resetAllocations);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
