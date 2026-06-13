(function (global) {
  'use strict';

  const CANADA_CPI_URL = '/tools/inflation-tables/data/CPI/CAN.json';

  /**
   * Year-over-year inflation (%) from annual CPI index values.
   * ((CPI[y] / CPI[y-1]) - 1) * 100, rounded to 1 dp.
   */
  function inflationRatesFromCpi(cpiObject) {
    const years = Object.keys(cpiObject || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const results = [];

    for (let i = 1; i < years.length; i++) {
      const year = years[i];
      const prevYear = years[i - 1];
      if (prevYear !== year - 1) {
        continue;
      }

      const prev = cpiObject[String(prevYear)];
      const curr = cpiObject[String(year)];
      if (typeof prev !== 'number' || typeof curr !== 'number' || !isFinite(prev) || !isFinite(curr) || prev <= 0) {
        continue;
      }

      const inflation = Math.round(((curr / prev) - 1) * 1000) / 10;
      results.push({ year, inflation });
    }

    return results.sort((a, b) => b.year - a.year);
  }

  /**
   * Simple arithmetic mean of annual inflation rates.
   * Options: fromYear, toYear (inclusive).
   */
  function simpleAverageInflation(rates, options) {
    if (!rates || !rates.length) {
      return null;
    }

    const fromYear = options && options.fromYear != null ? Number(options.fromYear) : null;
    const toYear = options && options.toYear != null ? Number(options.toYear) : null;

    let slice = rates;
    if (fromYear != null && Number.isFinite(fromYear)) {
      slice = slice.filter((row) => row.year >= fromYear);
    }
    if (toYear != null && Number.isFinite(toYear)) {
      slice = slice.filter((row) => row.year <= toYear);
    }
    if (!slice.length) {
      return null;
    }

    const sum = slice.reduce((acc, row) => acc + row.inflation, 0);
    return sum / slice.length;
  }

  async function loadCanadaCpiPayload() {
    const response = await fetch(CANADA_CPI_URL);
    if (!response.ok) {
      throw new Error('Failed to load Canada CPI: ' + CANADA_CPI_URL);
    }
    return response.json();
  }

  /** Canada long-run average (1960 through latest year), 2 dp. */
  async function canadaLongRunAverageSince1960() {
    const payload = await loadCanadaCpiPayload();
    const rates = inflationRatesFromCpi(payload.cpi || {});
    const avg = simpleAverageInflation(rates, { fromYear: 1960 });
    if (avg == null || !isFinite(avg)) {
      return null;
    }
    return Math.round(avg * 100) / 100;
  }

  function formatInflationPct(value, decimals) {
    if (value == null || !isFinite(value)) {
      return '—';
    }
    const places = decimals == null ? 2 : decimals;
    return value.toFixed(places);
  }

  global.CpiInflation = {
    CANADA_CPI_URL,
    inflationRatesFromCpi,
    simpleAverageInflation,
    loadCanadaCpiPayload,
    canadaLongRunAverageSince1960,
    formatInflationPct,
  };
})(typeof window !== 'undefined' ? window : globalThis);
