/* ============================================================
   Portfolio Growth Calculator — UI Module
   ============================================================
   
   Handles user interactions, data loading, and result display.
   ============================================================ */

(function() {
  'use strict';
  
  let chart = null;
  let currentData = null;
  let isLoading = false;
  
  // ============================================================
  // Initialize
  // ============================================================
  function init() {
    setupEventListeners();
    loadData();
  }
  
  // ============================================================
  // Setup event listeners
  // ============================================================
  function setupEventListeners() {
    // Calculate button
    const calculateBtn = document.getElementById('calculateBtn');
    if (calculateBtn) {
      calculateBtn.addEventListener('click', runSimulation);
    }
    
    // Input changes
    const inputs = ['startMonth', 'startingAmount', 'contributionAmount', 'contributionFreq', 'horizonYears', 'showReal'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', runSimulation);
        el.addEventListener('input', runSimulation);
      }
    });
    
    // Legend toggles
    const legendItems = document.querySelectorAll('.legend-item input[type="checkbox"]');
    legendItems.forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        updateChartVisibility();
      });
    });
    
    // Initialize chart
    const canvas = document.getElementById('chartCanvas');
    if (canvas) {
      chart = new PortfolioChart(canvas);
    }
  }
  
  // ============================================================
  // Load data
  // ============================================================
  async function loadData(forceRefresh = false) {
    if (isLoading) return;
    
    isLoading = true;
    const statusEl = document.getElementById('dataStatus');
    
    if (statusEl) {
      statusEl.textContent = 'Loading data...';
      statusEl.className = 'data-status loading';
    }
    
    try {
      const data = await window.portfolioData.fetchAll(forceRefresh);
      currentData = data;
      
      // Count available vs unavailable series
      const seriesCount = Object.keys(data).length;
      const availableCount = Object.values(data).filter(s => s && s.ok).length;
      
      if (statusEl) {
        if (availableCount === seriesCount) {
          statusEl.textContent = 'Data loaded';
          statusEl.className = 'data-status success';
        } else {
          statusEl.textContent = `Data loaded (${availableCount}/${seriesCount} series available)`;
          statusEl.className = 'data-status warning';
        }
      }
      
      // Run simulation if we have inputs
      runSimulation();
    } catch (error) {
      console.error('Data load error:', error);
      if (statusEl) {
        statusEl.textContent = 'Error loading data. Please check console for details.';
        statusEl.className = 'data-status error';
      }
    } finally {
      isLoading = false;
    }
  }
  
  // ============================================================
  // Run simulation
  // ============================================================
  function runSimulation() {
    if (!currentData) {
      console.warn('Data not loaded yet');
      return;
    }
    
    // Get inputs
    const startMonth = document.getElementById('startMonth')?.value || '2000-01';
    const startingAmount = parseFloat(document.getElementById('startingAmount')?.value || 0);
    const contributionAmount = parseFloat(document.getElementById('contributionAmount')?.value || 0);
    const contributionFreq = document.getElementById('contributionFreq')?.value || 'monthly';
    const horizonYears = parseFloat(document.getElementById('horizonYears')?.value || 30);
    const showReal = document.getElementById('showReal')?.checked || false;
    
    // Validate
    if (horizonYears < 1 || horizonYears > 60) {
      console.warn('Invalid horizon');
      return;
    }
    
    // Run simulation
    try {
      const results = window.portfolioEngine.simulate({
        startMonth,
        horizonYears,
        startingAmount,
        contributionAmount,
        contributionFreq,
        showReal,
        data: currentData
      });
      
      // Update UI
      displayResults(results);
      updateChart(results);
    } catch (error) {
      console.error('Simulation error:', error);
    }
  }
  
  // ============================================================
  // Display results
  // ============================================================
  function displayResults(results) {
    // Collect unavailable series for warning
    const unavailable = [];
    
    // Update result cards
    updateResultCard('cash', results.cash, 'Cash (0%)', unavailable);
    updateResultCard('tBill', results.tBill, 'Canada T-bills', unavailable);
    updateResultCard('bond', results.bond, 'Canada Bonds', unavailable);
    updateResultCard('gic', results.gic, 'Canada 5-year GIC', unavailable, {
      gicRate: results.gic.gicRate,
      gicStartDate: results.gic.gicStartDate
    });
    updateResultCard('equities', results.equities, 'US Equities', unavailable);
    updateResultCard('activeFund', results.activeFund, 'Typical Active Fund', unavailable);
    
    // Show/hide warnings
    showSeriesWarnings(unavailable);
    
    // Update legend checkboxes
    updateLegendAvailability(results);
  }
  
  // ============================================================
  // Update result card
  // ============================================================
  function updateResultCard(vehicleId, result, label, unavailable, extra = {}) {
    const card = document.getElementById(`result-${vehicleId}`);
    if (!card) return;
    
    // Check if this series is unavailable
    if (!result || !result.ok) {
      unavailable.push({
        label: label,
        reason: result?.reason || 'Unknown error',
        vehicleId: vehicleId
      });
      
      // Show disabled state
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
      
      const endingEl = card.querySelector('.result-ending');
      const cagrEl = card.querySelector('.result-cagr');
      const contributionsEl = card.querySelector('.result-contributions');
      const extraEl = card.querySelector('.result-extra');
      
      if (endingEl) endingEl.textContent = 'Unavailable';
      if (cagrEl) cagrEl.textContent = '—';
      if (contributionsEl) contributionsEl.textContent = '—';
      if (extraEl) extraEl.style.display = 'none';
      
      // Add reason tooltip or text
      const reasonText = result?.reason || 'Data unavailable';
      if (endingEl) {
        endingEl.title = reasonText;
      }
      
      return;
    }
    
    // Series is available - show normal state
    card.style.opacity = '1';
    card.style.pointerEvents = 'auto';
    
    const endingEl = card.querySelector('.result-ending');
    const cagrEl = card.querySelector('.result-cagr');
    const contributionsEl = card.querySelector('.result-contributions');
    const extraEl = card.querySelector('.result-extra');
    
    // Validate values before displaying
    if (endingEl) {
      const endingValue = result.endingValue;
      if (endingValue != null && Number.isFinite(endingValue)) {
        endingEl.textContent = formatCurrency(endingValue);
      } else {
        endingEl.textContent = '—';
        console.warn(`[${vehicleId}] Invalid ending value:`, endingValue);
      }
    }
    
    if (cagrEl) {
      const cagr = result.cagr;
      if (cagr != null && Number.isFinite(cagr)) {
        cagrEl.textContent = cagr.toFixed(2) + '%';
      } else {
        cagrEl.textContent = '—';
        console.warn(`[${vehicleId}] Invalid CAGR:`, cagr);
      }
    }
    
    if (contributionsEl) {
      const contributions = result.totalContributions;
      if (contributions != null && Number.isFinite(contributions)) {
        contributionsEl.textContent = formatCurrency(contributions);
      } else {
        contributionsEl.textContent = '—';
      }
    }
    
    if (extraEl && extra.gicRate != null && Number.isFinite(extra.gicRate)) {
      extraEl.textContent = `Average GIC rate: ${extra.gicRate.toFixed(2)}% (from ${extra.gicStartDate || 'unknown'})`;
      extraEl.style.display = 'block';
    } else if (extraEl) {
      extraEl.style.display = 'none';
    }
  }
  
  // ============================================================
  // Show series warnings
  // ============================================================
  function showSeriesWarnings(unavailable) {
    const warningsEl = document.getElementById('seriesWarnings');
    const warningsListEl = document.getElementById('seriesWarningsList');
    
    if (!warningsEl || !warningsListEl) return;
    
    if (unavailable.length === 0) {
      warningsEl.style.display = 'none';
      return;
    }
    
    warningsEl.style.display = 'block';
    warningsListEl.innerHTML = '';
    
    unavailable.forEach(({ label, reason }) => {
      const li = document.createElement('li');
      li.textContent = `${label} — ${reason}`;
      warningsListEl.appendChild(li);
    });
  }
  
  // ============================================================
  // Update legend availability
  // ============================================================
  function updateLegendAvailability(results) {
    const legendMap = {
      cash: 'legend-cash',
      tBill: 'legend-tBill',
      bond: 'legend-bond',
      gic: 'legend-gic',
      equities: 'legend-equities',
      activeFund: 'legend-activeFund'
    };
    
    Object.entries(legendMap).forEach(([vehicleId, checkboxId]) => {
      const checkbox = document.getElementById(checkboxId);
      if (!checkbox) return;
      
      const result = results[vehicleId];
      if (!result || !result.ok) {
        // Disable and uncheck unavailable series
        checkbox.disabled = true;
        checkbox.checked = false;
        checkbox.parentElement.style.opacity = '0.5';
      } else {
        // Enable available series
        checkbox.disabled = false;
        checkbox.parentElement.style.opacity = '1';
      }
    });
  }
  
  // ============================================================
  // Update chart
  // ============================================================
  function updateChart(results) {
    if (!chart) return;
    
    // Filter out unavailable series
    const availableResults = {};
    Object.entries(results).forEach(([key, value]) => {
      if (value && value.ok) {
        availableResults[key] = value;
      }
    });
    
    chart.setData(availableResults);
  }
  
  // ============================================================
  // Update chart visibility from legend
  // ============================================================
  function updateChartVisibility() {
    if (!chart) return;
    
    const visible = [];
    const checkboxes = document.querySelectorAll('.legend-item input[type="checkbox"]');
    checkboxes.forEach(cb => {
      if (cb.checked) {
        visible.push(cb.value);
      }
    });
    
    chart.setVisibleSeries(visible);
  }
  
  // ============================================================
  // Format currency
  // ============================================================
  function formatCurrency(value) {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }
  
  // ============================================================
  // Boot
  // ============================================================
  document.addEventListener('DOMContentLoaded', init);
})();
