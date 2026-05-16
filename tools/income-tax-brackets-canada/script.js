(function() {
  'use strict';

  const AVAILABLE_YEARS = [2026, 2025];
  const DEFAULT_YEAR = AVAILABLE_YEARS[0];

  async function loadData(year) {
    const selectedYear = year || DEFAULT_YEAR;
    updateStaticTextForYear(selectedYear);
    setLoading(true);

    try {
      const federalUrl = `/calculators/canada-income-tax/data/${selectedYear}/federal.json`;
      const provincesUrl = `/calculators/canada-income-tax/data/${selectedYear}/provinces.json`;

      const [federalRes, provincesRes] = await Promise.all([
        fetch(federalUrl),
        fetch(provincesUrl)
      ]);

      if (!federalRes.ok || !provincesRes.ok) {
        throw new Error('Failed to load tax data');
      }

      const federalData = await federalRes.json();
      const provincesData = await provincesRes.json();

      renderFederalTable(federalData, selectedYear);
      renderProvinceTables(provincesData, selectedYear);
    } catch (error) {
      console.error('Error loading income tax bracket data:', error);
    } finally {
      setLoading(false);
    }
  }

  function renderFederalTable(federal, year) {
    if (!federal || !Array.isArray(federal.brackets)) {
      return;
    }

    const tbody = document.querySelector('#table-federal tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const brackets = federal.brackets.slice().sort((a, b) => a.threshold - b.threshold);

    const captionEl = document.getElementById('federal-caption');
    if (captionEl) {
      captionEl.textContent = `${year} federal personal income tax brackets (Canada)`;
    }

    const bandHeader = document.getElementById('federal-band-header');
    if (bandHeader) {
      bandHeader.textContent = `Taxable income band (${year})`;
    }

    for (let i = 0; i < brackets.length; i++) {
      const current = brackets[i];
      const next = brackets[i + 1] || null;

      const bandLabel = formatBand(current.threshold, next && next.threshold);
      const rateLabel = formatRate(current.rate);

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${bandLabel}</td>
        <td>${rateLabel}</td>
      `;
      tbody.appendChild(row);
    }
  }

  function renderProvinceTables(provinces, year) {
    if (!provinces || typeof provinces !== 'object') {
      return;
    }

    const container = document.getElementById('provinces-container');
    if (!container) return;

    container.innerHTML = '';

    const entries = Object.entries(provinces)
      .filter(([code]) => code !== '_source')
      .map(([code, data]) => ({ code, data }))
      .filter(entry => entry.data && Array.isArray(entry.data.brackets))
      .sort((a, b) => {
        const nameA = (a.data.name || a.code).toUpperCase();
        const nameB = (b.data.name || b.code).toUpperCase();
        return nameA.localeCompare(nameB);
      });

    entries.forEach(({ code, data }) => {
      const section = document.createElement('section');
      section.className = 'province-section';

      const title = document.createElement('h3');
      title.className = 'province-title';
      title.textContent = data.name || code;
      section.appendChild(title);

      const tableContainer = document.createElement('div');
      tableContainer.className = 'table-container';

      const table = document.createElement('table');
      const caption = document.createElement('caption');
      caption.textContent = `${year} personal income tax brackets — ${data.name || code}`;
      table.appendChild(caption);

      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>Taxable income brackets (${year})</th>
          <th>Tax rate</th>
        </tr>
      `;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      const brackets = data.brackets.slice().sort((a, b) => a.threshold - b.threshold);

      for (let i = 0; i < brackets.length; i++) {
        const current = brackets[i];
        const next = brackets[i + 1] || null;

        const bandLabel = formatBand(current.threshold, next && next.threshold);
        const rateLabel = formatRate(current.rate);

        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${bandLabel}</td>
          <td>${rateLabel}</td>
        `;
        tbody.appendChild(row);
      }

      table.appendChild(tbody);
      tableContainer.appendChild(table);
      section.appendChild(tableContainer);

      container.appendChild(section);
    });
  }

  function formatBand(lower, nextThreshold) {
    const lowerLabel = formatCurrency(lower);

    if (!nextThreshold && nextThreshold !== 0) {
      return `${lowerLabel} and over`;
    }

    const upper = Math.max(nextThreshold - 1, lower);
    const upperLabel = formatCurrency(upper);
    if (lower === 0) {
      return `Up to ${upperLabel}`;
    }
    return `${lowerLabel} to ${upperLabel}`;
  }

  function formatRate(rate) {
    if (typeof rate !== 'number' || !isFinite(rate)) {
      return '–';
    }
    return (rate * 100).toFixed(1).replace(/\.0$/, '') + '%';
  }

  function formatCurrency(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return '–';
    }
    return '$' + value.toLocaleString('en-CA', { maximumFractionDigits: 0 });
  }

  function populateYearSelect() {
    const select = document.getElementById('year-select');
    if (!select) return;

    select.innerHTML = '';

    const years = AVAILABLE_YEARS.slice().sort((a, b) => b - a);

    years.forEach(year => {
      const option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      if (year === DEFAULT_YEAR) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener('change', (event) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) {
        loadData(value);
      }
    });
  }

  function updateStaticTextForYear(year) {
    const federalHeading = document.getElementById('federal-heading');
    if (federalHeading) {
      federalHeading.textContent = `Federal income tax brackets (${year})`;
    }

    const provincialHeading = document.getElementById('provincial-heading');
    if (provincialHeading) {
      provincialHeading.textContent = `Provincial and territorial income tax brackets (${year})`;
    }
  }

  function setLoading(isLoading) {
    const loadingEl = document.getElementById('year-loading');
    if (loadingEl) {
      loadingEl.style.display = isLoading ? 'inline' : 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      populateYearSelect();
      loadData(DEFAULT_YEAR);
    });
  } else {
    populateYearSelect();
    loadData(DEFAULT_YEAR);
  }
})();

