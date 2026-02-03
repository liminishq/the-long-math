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
    // Refresh data button
    const refreshBtn = document.getElementById('refreshData');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadData(true);
      });
    }
    
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
    const refreshBtn = document.getElementById('refreshData');
    
    if (statusEl) {
      statusEl.textContent = 'Loading data...';
      statusEl.className = 'data-status loading';
    }
    if (refreshBtn) {
      refreshBtn.disabled = true;
    }
    
    try {
      const data = await window.portfolioData.fetchAll(forceRefresh);
      currentData = data;
      
      if (statusEl) {
        statusEl.textContent = 'Data loaded';
        statusEl.className = 'data-status success';
      }
      
      // Check for errors
      if (data.shiller?.error) {
        if (statusEl) {
          statusEl.textContent = 'Warning: Shiller data unavailable. Some features may not work.';
          statusEl.className = 'data-status warning';
        }
      }
      
      // Run simulation if we have inputs
      runSimulation();
    } catch (error) {
      console.error('Data load error:', error);
      if (statusEl) {
        statusEl.textContent = 'Error loading data. Please try refreshing.';
        statusEl.className = 'data-status error';
      }
    } finally {
      isLoading = false;
      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
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
    // Update result cards
    updateResultCard('cash', results.cash, 'Cash (0%)');
    updateResultCard('tBill', results.tBill, 'Canada T-bills');
    updateResultCard('bond', results.bond, 'Canada Bonds');
    updateResultCard('gic', results.gic, 'Canada 5-year GIC', {
      gicRate: results.gic.gicRate,
      gicStartDate: results.gic.gicStartDate
    });
    updateResultCard('equities', results.equities, 'US Equities');
    updateResultCard('activeFund', results.activeFund, 'Typical Active Fund');
  }
  
  // ============================================================
  // Update result card
  // ============================================================
  function updateResultCard(vehicleId, result, label, extra = {}) {
    const card = document.getElementById(`result-${vehicleId}`);
    if (!card) return;
    
    const endingEl = card.querySelector('.result-ending');
    const cagrEl = card.querySelector('.result-cagr');
    const contributionsEl = card.querySelector('.result-contributions');
    const extraEl = card.querySelector('.result-extra');
    
    if (endingEl) {
      endingEl.textContent = formatCurrency(result.endingValue);
    }
    if (cagrEl) {
      cagrEl.textContent = result.cagr.toFixed(2) + '%';
    }
    if (contributionsEl) {
      contributionsEl.textContent = formatCurrency(result.totalContributions);
    }
    if (extraEl && extra.gicRate) {
      extraEl.textContent = `Average GIC rate: ${extra.gicRate.toFixed(2)}% (from ${extra.gicStartDate})`;
      extraEl.style.display = 'block';
    } else if (extraEl) {
      extraEl.style.display = 'none';
    }
  }
  
  // ============================================================
  // Update chart
  // ============================================================
  function updateChart(results) {
    if (!chart) return;
    
    chart.setData(results);
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
