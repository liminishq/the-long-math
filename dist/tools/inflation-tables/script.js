(function() {
  'use strict';

  // Data storage
  let canadaData = [];
  let usData = [];

  // Load and process data
  async function loadData() {
    try {
      const [canadaResponse, usResponse] = await Promise.all([
        fetch('/tools/inflation-tables/data/inflation_canada.json'),
        fetch('/tools/inflation-tables/data/inflation_us.json')
      ]);

      if (!canadaResponse.ok || !usResponse.ok) {
        throw new Error('Failed to load data');
      }

      canadaData = await canadaResponse.json();
      usData = await usResponse.json();

      // Sort by year descending (most recent first)
      canadaData.sort((a, b) => b.year - a.year);
      usData.sort((a, b) => b.year - a.year);

      populateTables();
      computeAverages();
      setupCSVDownloads();
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  // Populate tables
  function populateTables() {
    const canadaTbody = document.querySelector('#table-canada tbody');
    const usTbody = document.querySelector('#table-us tbody');

    // Clear existing rows
    canadaTbody.innerHTML = '';
    usTbody.innerHTML = '';

    // Populate Canada table
    canadaData.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.year}</td>
        <td>${formatInflation(item.inflation)}</td>
      `;
      canadaTbody.appendChild(row);
    });

    // Populate US table
    usData.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.year}</td>
        <td>${formatInflation(item.inflation)}</td>
      `;
      usTbody.appendChild(row);
    });
  }

  // Format inflation rate
  function formatInflation(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return '–';
    }
    return value.toFixed(1);
  }

  // Compute averages
  function computeAverages() {
    // Canada averages
    const canada5 = computeAverage(canadaData, 5);
    const canada10 = computeAverage(canadaData, 10);
    const canada20 = computeAverage(canadaData, 20);
    const canadaAll = computeAverage(canadaData, canadaData.length);

    document.getElementById('avg-canada-5').textContent = formatAverage(canada5);
    document.getElementById('avg-canada-10').textContent = formatAverage(canada10);
    document.getElementById('avg-canada-20').textContent = formatAverage(canada20);
    document.getElementById('avg-canada-all').textContent = formatAverage(canadaAll);

    // US averages
    const us5 = computeAverage(usData, 5);
    const us10 = computeAverage(usData, 10);
    const us20 = computeAverage(usData, 20);
    const usAll = computeAverage(usData, usData.length);

    document.getElementById('avg-us-5').textContent = formatAverage(us5);
    document.getElementById('avg-us-10').textContent = formatAverage(us10);
    document.getElementById('avg-us-20').textContent = formatAverage(us20);
    document.getElementById('avg-us-all').textContent = formatAverage(usAll);
  }

  // Compute simple arithmetic average
  function computeAverage(data, count) {
    if (!data || data.length === 0 || count <= 0) {
      return null;
    }
    const slice = data.slice(0, Math.min(count, data.length));
    const sum = slice.reduce((acc, item) => acc + item.inflation, 0);
    return sum / slice.length;
  }

  // Format average for display
  function formatAverage(value) {
    if (value === null || !isFinite(value)) {
      return '–';
    }
    return value.toFixed(2) + '%';
  }

  // Setup CSV downloads
  function setupCSVDownloads() {
    document.getElementById('download-canada-csv').addEventListener('click', (e) => {
      e.preventDefault();
      downloadCSV(canadaData, 'inflation_canada.csv');
    });

    document.getElementById('download-us-csv').addEventListener('click', (e) => {
      e.preventDefault();
      downloadCSV(usData, 'inflation_us.csv');
    });
  }

  // Generate and download CSV
  function downloadCSV(data, filename) {
    // CSV header
    const header = 'Year,CPI inflation rate (%)\n';
    
    // CSV rows (data is already sorted descending)
    const rows = data.map(item => {
      return `${item.year},${formatInflation(item.inflation)}`;
    }).join('\n');

    const csv = header + rows;

    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  }

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadData);
  } else {
    loadData();
  }
})();
