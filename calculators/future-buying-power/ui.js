(function () {
  'use strict';

  const Engine = window.FutureBuyingPowerEngine;
  const CPI = window.CpiInflation;

  const amountTodayEl = document.getElementById('amountToday');
  const inflationRateEl = document.getElementById('inflationRate');
  const yearsEl = document.getElementById('years');

  const primarySentenceEl = document.getElementById('primarySentence');
  const secondarySentenceEl = document.getElementById('secondarySentence');

  const metricAmountToday = document.getElementById('metricAmountToday');
  const metricInflationRate = document.getElementById('metricInflationRate');
  const metricYears = document.getElementById('metricYears');
  const metricFutureDollars = document.getElementById('metricFutureDollars');
  const metricMultiplier = document.getElementById('metricMultiplier');
  const metricPowerRetained = document.getElementById('metricPowerRetained');
  const metricPowerLost = document.getElementById('metricPowerLost');
  const metricAdditionalDollars = document.getElementById('metricAdditionalDollars');

  const cpiReferenceBody = document.getElementById('cpiReferenceBody');

  function toNumber(value) {
    const n = Number(String(value).trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) {
      return '$—';
    }
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  }

  function formatMoneyExact(value) {
    if (!Number.isFinite(value)) {
      return '$—';
    }
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatPercent(value, decimals) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return value.toFixed(decimals == null ? 1 : decimals) + '%';
  }

  function formatYears(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (Math.abs(value - Math.round(value)) < 1e-9) {
      return String(Math.round(value));
    }
    return value.toFixed(1).replace(/\.0$/, '');
  }

  function formatMultiplier(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + 'x';
  }

  function readInputs() {
    return {
      amountToday: toNumber(amountTodayEl.value),
      inflationRatePct: toNumber(inflationRateEl.value),
      years: toNumber(yearsEl.value),
    };
  }

  function render() {
    if (!Engine) {
      return;
    }

    const inputs = readInputs();
    const result = Engine.computeFutureBuyingPower(inputs);
    if (!result) {
      primarySentenceEl.textContent = 'Enter valid inputs to see results.';
      secondarySentenceEl.textContent = '';
      return;
    }

    const amountText = formatMoneyExact(result.amountToday);
    const futureText = formatMoneyExact(result.futureDollarsNeeded);
    const todayPowerText = formatMoneyExact(result.futureBuyingPowerTodayDollars);
    const rateText = formatPercent(result.inflationRatePct, 1);
    const yearsText = formatYears(result.years);

    primarySentenceEl.textContent =
      amountText + ' today would need to become ' + futureText + ' in ' + yearsText +
      ' years to maintain the same buying power, assuming ' + rateText + ' annual inflation.';

    secondarySentenceEl.textContent =
      'If inflation averages ' + rateText + ' per year, ' + amountText + ' in ' + yearsText +
      ' years would have the same buying power as approximately ' + todayPowerText + ' today.';

    metricAmountToday.textContent = amountText;
    metricInflationRate.textContent = rateText;
    metricYears.textContent = yearsText;
    metricFutureDollars.textContent = futureText;
    metricMultiplier.textContent = formatMultiplier(result.inflationMultiplier);
    metricPowerRetained.textContent = formatPercent(result.purchasingPowerRetained * 100, 1);
    metricPowerLost.textContent = formatPercent(result.purchasingPowerLost * 100, 1);
    metricAdditionalDollars.textContent = formatMoneyExact(result.additionalDollarsNeeded);
  }

  function renderCpiReference(rows) {
    if (!cpiReferenceBody) {
      return;
    }
    cpiReferenceBody.innerHTML = '';
    rows.forEach(function (row) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + row.years + ' years</td>' +
        '<td>' + (row.canada == null ? '—' : formatPercent(row.canada, 1)) + '</td>' +
        '<td>' + (row.usa == null ? '—' : formatPercent(row.usa, 1)) + '</td>';
      cpiReferenceBody.appendChild(tr);
    });
  }

  async function loadCpiReference() {
    if (!CPI || !cpiReferenceBody) {
      return;
    }
    try {
      const rows = await CPI.historicalCpiCagrTable([5, 10, 20, 50]);
      renderCpiReference(rows);
    } catch (error) {
      console.warn('Could not load CPI reference data:', error);
      cpiReferenceBody.innerHTML =
        '<tr><td colspan="3">Historical CPI data could not be loaded.</td></tr>';
    }
  }

  [amountTodayEl, inflationRateEl, yearsEl].forEach(function (el) {
    el.addEventListener('input', render);
  });

  render();
  loadCpiReference();
})();
