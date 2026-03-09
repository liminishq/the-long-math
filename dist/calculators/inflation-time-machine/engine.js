/* ============================================================
   The Long Math — Inflation Time Machine (Then ↔ Now) — Engine
   ============================================================
   Pure math + data plumbing. No DOM.
   - ratio = CPI[endYear] / CPI[startYear]
   - converted = amount * ratio (whole dollars)
   - Annualized rate: ratio^(1/n) - 1, n = |endYear - startYear|
*/

(function (global) {
  "use strict";

  const MANIFEST_URL = "/data/cpi/countries.json";
  const countryDataCache = new Map(); // code -> { meta, cpi }

  function formatMoneyInt(n) {
    if (n == null || !Number.isFinite(n)) return "–";
    const rounded = Math.round(n);
    return rounded.toLocaleString("en-CA", { maximumFractionDigits: 0 });
  }

  function computeRatio(cpiMap, startYear, endYear) {
    if (!cpiMap || typeof cpiMap !== "object") return null;
    const start = cpiMap[String(startYear)];
    const end = cpiMap[String(endYear)];
    if (start == null || end == null || start <= 0) return null;
    return end / start;
  }

  function computeConverted(amount, ratio) {
    if (!Number.isFinite(amount) || ratio == null || !Number.isFinite(ratio)) return null;
    return Math.round(amount * ratio);
  }

  function computeAnnualizedRate(ratio, startYear, endYear) {
    if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
    const n = Math.abs(Number(endYear) - Number(startYear));
    if (n === 0) return 0;
    return Math.pow(ratio, 1 / n) - 1;
  }

  function computePercentChangeMagnitude(ratio) {
    if (ratio == null || !Number.isFinite(ratio)) return null;
    return Math.abs((ratio - 1) * 100);
  }

  function availability(countryMeta, startYear, endYear) {
    if (!countryMeta) return false;
    const start = Number(countryMeta.startYear);
    const end = Number(countryMeta.endYear);
    const s = Number(startYear);
    const e = Number(endYear);
    return s >= start && e <= end;
  }

  async function loadManifest() {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error("Failed to load countries manifest");
    return response.json();
  }

  async function loadCountryData(codeOrPath) {
    const code = typeof codeOrPath === "string" && codeOrPath.length === 3
      ? codeOrPath
      : null;
    const path = code ? `/data/cpi/${code}.json` : codeOrPath;
    const cacheKey = code || path;
    if (countryDataCache.has(cacheKey)) return countryDataCache.get(cacheKey);
    const response = await fetch(path);
    if (!response.ok) throw new Error("Failed to load country data: " + path);
    const data = await response.json();
    countryDataCache.set(cacheKey, data);
    return data;
  }

  function getCachedCountryData(code) {
    return countryDataCache.get(code) || null;
  }

  global.InflationTimeMachine = global.InflationTimeMachine || {};
  global.InflationTimeMachine.formatMoneyInt = formatMoneyInt;
  global.InflationTimeMachine.computeRatio = computeRatio;
  global.InflationTimeMachine.computeConverted = computeConverted;
  global.InflationTimeMachine.computeAnnualizedRate = computeAnnualizedRate;
  global.InflationTimeMachine.computePercentChangeMagnitude = computePercentChangeMagnitude;
  global.InflationTimeMachine.availability = availability;
  global.InflationTimeMachine.loadManifest = loadManifest;
  global.InflationTimeMachine.loadCountryData = loadCountryData;
  global.InflationTimeMachine.getCachedCountryData = getCachedCountryData;
})(typeof window !== "undefined" ? window : this);
