(function (global) {
  'use strict';

  const CANADA_CPI_URL = '/tools/inflation-tables/data/CPI/CAN.json';
  const USA_CPI_URL = '/tools/inflation-tables/data/CPI/USA.json';

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

  async function loadCpiPayload(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to load CPI: ' + url);
    }
    return response.json();
  }

  async function loadCanadaCpiPayload() {
    return loadCpiPayload(CANADA_CPI_URL);
  }

  async function loadUsaCpiPayload() {
    return loadCpiPayload(USA_CPI_URL);
  }

  function cpiYearRange(cpiObject) {
    const years = Object.keys(cpiObject || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!years.length) {
      return null;
    }
    return { startYear: years[0], endYear: years[years.length - 1] };
  }

  /**
   * Geometric average annual CPI inflation over a trailing period (decimal rate).
   * averageAnnualInflation = (CPI[endYear] / CPI[startYear])^(1/years) - 1
   */
  function cpiCagrDecimal(cpiObject, periodYears) {
    const years = Number(periodYears);
    if (!isFinite(years) || years <= 0) {
      return null;
    }
    const range = cpiYearRange(cpiObject);
    if (!range) {
      return null;
    }
    const endYear = range.endYear;
    const startYear = endYear - years;
    const end = cpiObject[String(endYear)];
    const start = cpiObject[String(startYear)];
    if (typeof end !== 'number' || typeof start !== 'number' || !isFinite(end) || !isFinite(start) || start <= 0 || end <= 0) {
      return null;
    }
    return Math.pow(end / start, 1 / years) - 1;
  }

  function cpiCagrPercent(cpiObject, periodYears) {
    const decimal = cpiCagrDecimal(cpiObject, periodYears);
    if (decimal == null || !isFinite(decimal)) {
      return null;
    }
    return Math.round(decimal * 1000) / 10;
  }

  async function historicalCpiCagrTable(periodYearsList) {
    const periods = Array.isArray(periodYearsList) ? periodYearsList : [5, 10, 20, 50];
    const [canadaPayload, usaPayload] = await Promise.all([
      loadCanadaCpiPayload(),
      loadUsaCpiPayload(),
    ]);
    const canadaCpi = (canadaPayload && canadaPayload.cpi) || {};
    const usaCpi = (usaPayload && usaPayload.cpi) || {};
    return periods.map(function (years) {
      return {
        years,
        canada: cpiCagrPercent(canadaCpi, years),
        usa: cpiCagrPercent(usaCpi, years),
      };
    });
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
    USA_CPI_URL,
    inflationRatesFromCpi,
    simpleAverageInflation,
    loadCpiPayload,
    loadCanadaCpiPayload,
    loadUsaCpiPayload,
    cpiYearRange,
    cpiCagrDecimal,
    cpiCagrPercent,
    historicalCpiCagrTable,
    canadaLongRunAverageSince1960,
    formatInflationPct,
  };
})(typeof window !== 'undefined' ? window : globalThis);
