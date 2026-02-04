/* ============================================================
   Portfolio Growth Calculator — Data Acquisition Module
   ============================================================
   
   Fetches and processes data from:
   - Bank of Canada Valet API (USD/CAD FX, CPI, T-bills, bonds, GIC)
   - Yale/Shiller dataset (US equities)
   
   Converts all series to monthly format (YYYY-MM).
   Caches results in localStorage with timestamp.
   
   DATA REFRESH MECHANISM:
   -----------------------
   - Data is cached in localStorage with a timestamp
   - Cache expires after 24 hours (CACHE_EXPIRY_HOURS)
   - On page load: fetchAllData() checks cache first
     - If cache exists and is fresh (< 24h old): use cached data
     - If cache expired or missing: fetch fresh data from APIs
   - "Refresh Data" button: calls fetchAllData(true) to force refresh
     - Bypasses cache and fetches fresh data
     - Updates cache with new timestamp
   - Cache keys: pg_fx_usdcad, pg_cpi_canada, pg_tbill_3m, etc.
   - To clear cache manually: localStorage.removeItem('pg_*')
   
   NOTE: Bank of Canada Valet API series codes may need adjustment
   based on actual API structure. Check BOC_VALET_BASE and BOC_SERIES
   constants for current series codes.
   
   NOTE: If Shiller data fetch fails due to CORS, embed a static
   snapshot file and update manually. See fetchShillerData() function.
   ============================================================ */

// ============================================================
// Configuration: Bank of Canada Valet API endpoints
// ============================================================

const BOC_VALET_BASE = 'https://www.bankofcanada.ca/valet';

// Series codes for Bank of Canada Valet API
// See: https://www.bankofcanada.ca/valet/docs for available series
// Note: These codes may need to be verified against the BOC Valet API lists endpoint
const BOC_SERIES = {
  // USD/CAD exchange rate (daily) - Bank of Canada uses FXUSDCAD for daily closing rate
  // Alternative formats to try
  FX_USDCAD: ['FXUSDCAD', 'IEXE0101', 'FXCADUSD'],
  
  // Canada CPI (monthly) - V41690973 is CPI all-items, V41690914 is CPI excluding food/energy
  CPI_CANADA: ['V41690973', 'V41690914', 'CPI'],
  
  // 3-month T-bill yield (daily, then monthly average)
  // V39051 is 3-month T-bill, V39052 is 5-year bond, V39053 is 10-year bond
  T_BILL_3M: ['V39051', 'V122530', 'TB3MS'],
  
  // Government of Canada bond yield, 5-10 year average
  BOND_5Y: ['V39052', 'V122531'], // 5-year bond
  BOND_10Y: ['V39053', 'V122532'], // 10-year bond
  
  // Posted 5-year GIC rate (weekly/daily)
  GIC_5Y: ['V121764', 'V121765', 'V121766']
};

// Shiller dataset URL (Yale) - try CSV first, fallback to other formats
const SHILLER_URL_CSV = 'https://www.econ.yale.edu/~shiller/data/ie_data.csv';
const SHILLER_URL_XLS = 'https://www.econ.yale.edu/~shiller/data/ie_data.xls';

// Cache keys
const CACHE_KEYS = {
  FX_USDCAD: 'pg_fx_usdcad',
  CPI_CANADA: 'pg_cpi_canada',
  T_BILL_3M: 'pg_tbill_3m',
  BOND_5_10Y: 'pg_bond_5_10y',
  GIC_5Y: 'pg_gic_5y',
  SHILLER: 'pg_shiller',
  CACHE_TIMESTAMP: 'pg_cache_timestamp'
};

const CACHE_EXPIRY_HOURS = 24;

// ============================================================
// SeriesLoadResult type structure
// ============================================================
/**
 * @typedef {Object} SeriesLoadResult
 * @property {boolean} ok - Whether the series loaded successfully
 * @property {string} seriesId - Internal identifier (e.g. "FX_USDCAD", "SHILLER")
 * @property {string} label - Display label for UI
 * @property {string} [reason] - User-friendly error message
 * @property {string} [detail] - Technical detail for console
 * @property {Array<{month: string, value: number}>} [data] - Validated monthly data
 */

// ============================================================
// Validation: Check if value is finite
// ============================================================
function isValidValue(value) {
  return value != null && Number.isFinite(value);
}

// ============================================================
// Validation: Validate monthly data array
// ============================================================
function validateMonthlyData(data, seriesId) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      valid: false,
      reason: 'No data available',
      detail: `${seriesId}: Data array is empty or not an array`
    };
  }

  // Check all values are finite
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') {
      return {
        valid: false,
        reason: 'Invalid data format',
        detail: `${seriesId}: Item ${i} is not an object`
      };
    }
    
    const month = item.month || item[0];
    const value = item.value !== undefined ? item.value : item[1];
    
    if (!month || typeof month !== 'string') {
      return {
        valid: false,
        reason: 'Invalid date format',
        detail: `${seriesId}: Item ${i} has invalid month: ${month}`
      };
    }
    
    if (!isValidValue(value)) {
      return {
        valid: false,
        reason: 'Invalid data values',
        detail: `${seriesId}: Item ${i} has non-finite value: ${value}`
      };
    }
  }

  // Check dates are monotonic (increasing)
  const months = data.map(item => {
    const month = item.month || item[0];
    return month;
  });
  
  for (let i = 1; i < months.length; i++) {
    if (months[i] <= months[i - 1]) {
      return {
        valid: false,
        reason: 'Dates not in order',
        detail: `${seriesId}: Dates are not monotonic at index ${i}`
      };
    }
  }

  return { valid: true };
}

// ============================================================
// Helper: Create failure result
// ============================================================
function createFailureResult(seriesId, label, reason, detail, attemptedUrls = []) {
  const result = {
    ok: false,
    seriesId,
    label,
    reason,
    detail
  };
  
  if (attemptedUrls.length > 0) {
    result.detail = `${detail} Attempted URLs: ${attemptedUrls.join(', ')}`;
  }
  
  console.error(`[${seriesId}] Load failed:`, reason, result.detail);
  return result;
}

// ============================================================
// Helper: Create success result
// ============================================================
function createSuccessResult(seriesId, label, data) {
  // Convert to standard format if needed
  const normalizedData = data.map(item => {
    if (Array.isArray(item)) {
      return { month: item[0], value: item[1] };
    }
    return item;
  });
  
  const validation = validateMonthlyData(normalizedData, seriesId);
  if (!validation.valid) {
    return createFailureResult(seriesId, label, validation.reason, validation.detail);
  }
  
  return {
    ok: true,
    seriesId,
    label,
    data: normalizedData
  };
}

// ============================================================
// Helper: Parse date to YYYY-MM format
// ============================================================
function toMonthKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// ============================================================
// Helper: Convert daily series to monthly (average)
// ============================================================
function dailyToMonthly(dailyData) {
  const monthlyMap = new Map();
  
  for (const [dateStr, value] of dailyData) {
    const monthKey = toMonthKey(dateStr);
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, []);
    }
    monthlyMap.get(monthKey).push(value);
  }
  
  const monthly = [];
  for (const [month, values] of monthlyMap.entries()) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    monthly.push([month, avg]);
  }
  
  return monthly.sort((a, b) => a[0].localeCompare(b[0]));
}

// ============================================================
// Helper: Convert weekly/daily series to monthly (average)
// ============================================================
function weeklyToMonthly(weeklyData) {
  return dailyToMonthly(weeklyData); // Same logic
}

// ============================================================
// Query available series from Bank of Canada Valet API
// ============================================================
async function queryAvailableSeries() {
  try {
    const url = `${BOC_VALET_BASE}/lists/series/json`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      return data;
    }
  } catch (error) {
    console.warn('Could not query available series:', error);
  }
  return null;
}

// ============================================================
// Find series code by searching available series
// ============================================================
async function findSeriesCode(searchTerms) {
  try {
    const availableSeries = await queryAvailableSeries();
    if (!availableSeries || !availableSeries.series) {
      return null;
    }
    
    // Search for series that match any of the search terms
    const searchLower = searchTerms.map(term => term.toLowerCase());
    const matches = availableSeries.series.filter(series => {
      const label = (series.label || '').toLowerCase();
      const name = (series.name || '').toLowerCase();
      return searchLower.some(term => label.includes(term) || name.includes(term));
    });
    
    if (matches.length > 0) {
      return matches[0].name; // Return the first match
    }
  } catch (error) {
    console.warn('Error finding series code:', error);
  }
  return null;
}

// ============================================================
// Bank of Canada Valet API fetcher
// Returns SeriesLoadResult
// ============================================================
async function fetchBOCSeries(seriesCodeOrArray, seriesId, label) {
  // Valet API format: GET /valet/observations/{seriesNames}/json
  // Returns JSON with observations array
  // Documentation: https://www.bankofcanada.ca/valet/docs
  
  // Handle array of possible series codes (try each until one works)
  const seriesCodes = Array.isArray(seriesCodeOrArray) ? seriesCodeOrArray : [seriesCodeOrArray];
  const attemptedUrls = [];
  let lastError = null;
  let lastStatus = null;
  
  for (const seriesCode of seriesCodes) {
    try {
      // Correct BOC Valet API format: /valet/observations/{seriesName}/json
      const urlFormats = [
        `${BOC_VALET_BASE}/observations/${seriesCode}/json`,
        `${BOC_VALET_BASE}/observations/${seriesCode}/json?recent=1`,
        `${BOC_VALET_BASE}/observations/${seriesCode}`,
        `${BOC_VALET_BASE}/observations/${seriesCode}?recent=1`
      ];
      
      for (const url of urlFormats) {
        attemptedUrls.push(url);
        try {
          const response = await fetch(url);
          
          if (response.ok) {
            const data = await response.json();
            const rawResult = parseBOCResponse(data, seriesCode);
            
            if (rawResult.length > 0) {
              // Convert to monthly format and validate
              const monthlyData = dailyToMonthly(rawResult);
              const normalizedData = monthlyData.map(([month, value]) => ({ month, value }));
              
              const validation = validateMonthlyData(normalizedData, seriesId);
              if (validation.valid) {
                console.log(`[${seriesId}] Successfully fetched from ${url}`);
                return createSuccessResult(seriesId, label, normalizedData);
              } else {
                return createFailureResult(seriesId, label, validation.reason, validation.detail, [url]);
              }
            }
          } else {
            lastStatus = response.status;
            if (response.status === 404) {
              console.debug(`[${seriesId}] 404 for ${url} (trying next format)`);
            } else {
              console.warn(`[${seriesId}] BOC API returned ${response.status} for ${url}`);
            }
          }
        } catch (urlError) {
          lastError = urlError;
          console.debug(`[${seriesId}] Error fetching ${url}:`, urlError.message);
          continue;
        }
      }
    } catch (error) {
      lastError = error;
      continue; // Try next series code
    }
  }
  
  // If all series codes failed, try to find the series by searching available series
  console.warn(`[${seriesId}] All provided series codes failed for: ${seriesCodes.join(', ')}, attempting to find series...`);
  
  try {
    // Try to find a matching series by searching
    const foundCode = await findSeriesCode(seriesCodes);
    if (foundCode) {
      console.log(`[${seriesId}] Found matching series: ${foundCode}, attempting to fetch...`);
      // Recursively try to fetch with the found code
      return await fetchBOCSeries(foundCode, seriesId, label);
    }
  } catch (searchError) {
    console.warn(`[${seriesId}] Series search also failed:`, searchError);
  }
  
  // If everything failed, return failure result
  const reason = lastStatus ? `HTTP ${lastStatus}` : 'Network or API error';
  const detail = lastError ? lastError.message : 'All URL formats failed';
  return createFailureResult(seriesId, label, `Failed to load: ${reason}`, detail, attemptedUrls);
}

// ============================================================
// Parse Bank of Canada API response
// ============================================================
function parseBOCResponse(data, seriesCode = null) {
  // BOC Valet API returns: { observations: [{ d: "YYYY-MM-DD", SERIESCODE: { v: value } }, ...] }
  // OR: { observations: [{ d: "YYYY-MM-DD", v: value }, ...] }
  let observations = [];
  
  if (data.observations && Array.isArray(data.observations)) {
    observations = data.observations;
  } else if (data.series && Array.isArray(data.series) && data.series[0]) {
    observations = data.series[0].observations || [];
  }
  
  // Extract date and value - BOC format can have nested structure
  const result = observations
    .map(obs => {
      const date = obs.d || obs.date || obs.DATE;
      let value = null;
      
      // Try nested format first (obs.SERIESCODE.v)
      if (seriesCode && obs[seriesCode] && obs[seriesCode].v !== undefined) {
        value = obs[seriesCode].v;
      } 
      // Try direct format (obs.v)
      else if (obs.v !== undefined) {
        value = obs.v;
      }
      // Try other common formats
      else if (obs.value !== undefined) {
        value = obs.value;
      }
      // Try to find any property with a 'v' field (for nested format)
      else {
        for (const key in obs) {
          if (key !== 'd' && key !== 'date' && key !== 'DATE' && obs[key] && typeof obs[key] === 'object' && obs[key].v !== undefined) {
            value = obs[key].v;
            break;
          }
        }
      }
      
      return [date, value];
    })
    .filter(([date, value]) => date && value != null && !isNaN(value));
  
  return result;
}

// ============================================================
// Fetch USD/CAD FX (daily → monthly average)
// Returns SeriesLoadResult
// ============================================================
async function fetchUSDCAD() {
  return await fetchBOCSeries(BOC_SERIES.FX_USDCAD, 'FX_USDCAD', 'USD/CAD Exchange Rate');
}

// ============================================================
// Fetch Canada CPI (monthly, or daily → monthly average)
// Returns SeriesLoadResult
// ============================================================
async function fetchCanadaCPI() {
  return await fetchBOCSeries(BOC_SERIES.CPI_CANADA, 'CPI_CANADA', 'Canada CPI');
}

// ============================================================
// Fetch 3-month T-bill yield (daily → monthly average)
// Returns SeriesLoadResult
// ============================================================
async function fetchTBill3M() {
  return await fetchBOCSeries(BOC_SERIES.T_BILL_3M, 'T_BILL_3M', 'Canada 3-month T-bills');
}

// ============================================================
// Fetch 5-10 year bond yield (daily → monthly average)
// Returns SeriesLoadResult
// ============================================================
async function fetchBond5_10Y() {
  // Fetch both 5-year and 10-year, then average them
  const [bond5Y, bond10Y] = await Promise.all([
    fetchBOCSeries(BOC_SERIES.BOND_5Y, 'BOND_5Y', 'Canada 5-year Bonds'),
    fetchBOCSeries(BOC_SERIES.BOND_10Y, 'BOND_10Y', 'Canada 10-year Bonds')
  ]);
  
  // If we have both, average them
  if (bond5Y.ok && bond10Y.ok) {
    const monthlyMap = new Map();
    
    // Add 5-year data
    bond5Y.data.forEach(({ month, value }) => {
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, []);
      }
      monthlyMap.get(month).push(value);
    });
    
    // Add 10-year data
    bond10Y.data.forEach(({ month, value }) => {
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, []);
      }
      monthlyMap.get(month).push(value);
    });
    
    // Average values for each month
    const averaged = [];
    for (const [month, values] of monthlyMap.entries()) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (isValidValue(avg)) {
        averaged.push({ month, value: avg });
      }
    }
    
    const sorted = averaged.sort((a, b) => a.month.localeCompare(b.month));
    const validation = validateMonthlyData(sorted, 'BOND_5_10Y');
    
    if (validation.valid) {
      return createSuccessResult('BOND_5_10Y', 'Canada Bonds (5-10 year)', sorted);
    } else {
      return createFailureResult('BOND_5_10Y', 'Canada Bonds (5-10 year)', validation.reason, validation.detail);
    }
  }
  
  // If only one works, use it
  if (bond5Y.ok) {
    return createSuccessResult('BOND_5_10Y', 'Canada Bonds (5-year only)', bond5Y.data);
  }
  if (bond10Y.ok) {
    return createSuccessResult('BOND_5_10Y', 'Canada Bonds (10-year only)', bond10Y.data);
  }
  
  // Both failed - return failure with combined reason
  const reasons = [bond5Y.reason, bond10Y.reason].filter(Boolean).join('; ');
  return createFailureResult('BOND_5_10Y', 'Canada Bonds (5-10 year)', 'Failed to load bond data', reasons);
}

// ============================================================
// Fetch 5-year GIC rate and compute historical average
// Returns SeriesLoadResult with additional metadata
// ============================================================
async function fetchGIC5Y() {
  const result = await fetchBOCSeries(BOC_SERIES.GIC_5Y, 'GIC_5Y', 'Canada 5-year GIC');
  
  if (!result.ok) {
    return result;
  }
  
  // Compute average from 1990-01-01 to latest (or since inception)
  const startDate = '1990-01';
  const filtered = result.data.filter(({ month }) => month >= startDate);
  
  if (filtered.length === 0) {
    // Use all available data if filtered is empty
    const values = result.data.map(({ value }) => value).filter(isValidValue);
    if (values.length === 0) {
      return createFailureResult('GIC_5Y', 'Canada 5-year GIC', 'No valid data values', 'All values are invalid');
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (!isValidValue(avg)) {
      return createFailureResult('GIC_5Y', 'Canada 5-year GIC', 'Invalid average calculation', 'Average is not finite');
    }
    return {
      ...result,
      metadata: {
        averageRate: avg,
        startDate: result.data[0]?.month || 'unknown'
      }
    };
  }
  
  const values = filtered.map(({ value }) => value).filter(isValidValue);
  if (values.length === 0) {
    return createFailureResult('GIC_5Y', 'Canada 5-year GIC', 'No valid data after filtering', 'No valid values in date range');
  }
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (!isValidValue(avg)) {
    return createFailureResult('GIC_5Y', 'Canada 5-year GIC', 'Invalid average calculation', 'Average is not finite');
  }
  
  return {
    ...result,
    metadata: {
      averageRate: avg,
      startDate: filtered[0]?.month || startDate
    }
  };
}

// ============================================================
// Fetch Shiller dataset (US equities)
// Returns SeriesLoadResult
// ============================================================
async function fetchShillerData() {
  const attemptedUrls = [SHILLER_URL_CSV];
  
  try {
    // Try CSV version first
    const response = await fetch(SHILLER_URL_CSV, { mode: 'cors' });
    
    if (!response.ok) {
      return createFailureResult(
        'SHILLER',
        'US Equities (Shiller)',
        `HTTP ${response.status}`,
        `Shiller CSV not available: ${response.status} ${response.statusText}`,
        attemptedUrls
      );
    }
    
    const csv = await response.text();
    const parsed = parseShillerCSV(csv);
    
    if (parsed.length === 0) {
      return createFailureResult(
        'SHILLER',
        'US Equities (Shiller)',
        'No data after parsing',
        'Shiller CSV parsing returned no data',
        attemptedUrls
      );
    }
    
    // Validate the parsed data
    const validation = validateMonthlyData(parsed, 'SHILLER');
    if (!validation.valid) {
      return createFailureResult('SHILLER', 'US Equities (Shiller)', validation.reason, validation.detail, attemptedUrls);
    }
    
    return createSuccessResult('SHILLER', 'US Equities (Shiller)', parsed);
  } catch (error) {
    const detail = error.message || 'CORS or network error';
    console.warn('[SHILLER] Fetch failed:', error);
    return createFailureResult(
      'SHILLER',
      'US Equities (Shiller)',
      'Network or CORS error',
      detail,
      attemptedUrls
    );
  }
}

// ============================================================
// Parse Shiller CSV
// ============================================================
function parseShillerCSV(csv) {
  const lines = csv.split('\n');
  const data = [];
  
  // Shiller CSV format: Date, Price, Dividend, ...
  // Skip header, parse data
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(',');
    if (parts.length < 3) continue;
    
    const dateStr = parts[0].trim();
    const price = parseFloat(parts[1]);
    const dividend = parseFloat(parts[2]);
    
    if (isNaN(price) || isNaN(dividend)) continue;
    
    // Convert date to YYYY-MM format
    // Shiller format varies - handle common formats
    let monthKey;
    if (dateStr.includes('.')) {
      // Format: YYYY.MM
      const [year, month] = dateStr.split('.');
      monthKey = `${year}-${month.padStart(2, '0')}`;
    } else if (dateStr.includes('/')) {
      // Format: MM/YYYY
      const [month, year] = dateStr.split('/');
      monthKey = `${year}-${month.padStart(2, '0')}`;
    } else {
      continue;
    }
    
    // Validate values are finite
    if (!isValidValue(price) || !isValidValue(dividend)) {
      continue;
    }
    
    data.push({
      month: monthKey,
      price: price,
      dividend: dividend
    });
  }
  
  return data.sort((a, b) => a.month.localeCompare(b.month));
}

// ============================================================
// Cache management
// ============================================================
function getCached(key) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    const parsed = JSON.parse(cached);
    const timestamp = parsed.timestamp;
    const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
    
    if (ageHours > CACHE_EXPIRY_HOURS) {
      localStorage.removeItem(key);
      return null;
    }
    
    return parsed.data;
  } catch (e) {
    return null;
  }
}

function setCached(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      data: data
    }));
  } catch (e) {
    console.warn('Cache write failed:', e);
  }
}

// ============================================================
// Main data fetcher (with caching)
// Returns object with SeriesLoadResult for each series
// ============================================================
async function fetchAllData(forceRefresh = false) {
  const results = {};
  
  // USD/CAD FX
  if (forceRefresh || !getCached(CACHE_KEYS.FX_USDCAD)) {
    results.fxUSDCAD = await fetchUSDCAD();
    if (results.fxUSDCAD.ok) {
      setCached(CACHE_KEYS.FX_USDCAD, results.fxUSDCAD);
    }
  } else {
    const cached = getCached(CACHE_KEYS.FX_USDCAD);
    if (cached && cached.ok !== undefined) {
      results.fxUSDCAD = cached;
    } else {
      // Legacy cache format - re-fetch
      results.fxUSDCAD = await fetchUSDCAD();
      if (results.fxUSDCAD.ok) {
        setCached(CACHE_KEYS.FX_USDCAD, results.fxUSDCAD);
      }
    }
  }
  
  // Canada CPI
  if (forceRefresh || !getCached(CACHE_KEYS.CPI_CANADA)) {
    results.cpiCanada = await fetchCanadaCPI();
    if (results.cpiCanada.ok) {
      setCached(CACHE_KEYS.CPI_CANADA, results.cpiCanada);
    }
  } else {
    const cached = getCached(CACHE_KEYS.CPI_CANADA);
    if (cached && cached.ok !== undefined) {
      results.cpiCanada = cached;
    } else {
      results.cpiCanada = await fetchCanadaCPI();
      if (results.cpiCanada.ok) {
        setCached(CACHE_KEYS.CPI_CANADA, results.cpiCanada);
      }
    }
  }
  
  // T-bill 3M
  if (forceRefresh || !getCached(CACHE_KEYS.T_BILL_3M)) {
    results.tBill3M = await fetchTBill3M();
    if (results.tBill3M.ok) {
      setCached(CACHE_KEYS.T_BILL_3M, results.tBill3M);
    }
  } else {
    const cached = getCached(CACHE_KEYS.T_BILL_3M);
    if (cached && cached.ok !== undefined) {
      results.tBill3M = cached;
    } else {
      results.tBill3M = await fetchTBill3M();
      if (results.tBill3M.ok) {
        setCached(CACHE_KEYS.T_BILL_3M, results.tBill3M);
      }
    }
  }
  
  // Bond 5-10Y
  if (forceRefresh || !getCached(CACHE_KEYS.BOND_5_10Y)) {
    results.bond5_10Y = await fetchBond5_10Y();
    if (results.bond5_10Y.ok) {
      setCached(CACHE_KEYS.BOND_5_10Y, results.bond5_10Y);
    }
  } else {
    const cached = getCached(CACHE_KEYS.BOND_5_10Y);
    if (cached && cached.ok !== undefined) {
      results.bond5_10Y = cached;
    } else {
      results.bond5_10Y = await fetchBond5_10Y();
      if (results.bond5_10Y.ok) {
        setCached(CACHE_KEYS.BOND_5_10Y, results.bond5_10Y);
      }
    }
  }
  
  // GIC 5Y
  if (forceRefresh || !getCached(CACHE_KEYS.GIC_5Y)) {
    results.gic5Y = await fetchGIC5Y();
    if (results.gic5Y.ok) {
      setCached(CACHE_KEYS.GIC_5Y, results.gic5Y);
    }
  } else {
    const cached = getCached(CACHE_KEYS.GIC_5Y);
    if (cached && cached.ok !== undefined) {
      results.gic5Y = cached;
    } else {
      results.gic5Y = await fetchGIC5Y();
      if (results.gic5Y.ok) {
        setCached(CACHE_KEYS.GIC_5Y, results.gic5Y);
      }
    }
  }
  
  // Shiller
  if (forceRefresh || !getCached(CACHE_KEYS.SHILLER)) {
    results.shiller = await fetchShillerData();
    if (results.shiller.ok) {
      setCached(CACHE_KEYS.SHILLER, results.shiller);
    }
  } else {
    const cached = getCached(CACHE_KEYS.SHILLER);
    if (cached && cached.ok !== undefined) {
      results.shiller = cached;
    } else {
      results.shiller = await fetchShillerData();
      if (results.shiller.ok) {
        setCached(CACHE_KEYS.SHILLER, results.shiller);
      }
    }
  }
  
  // Update cache timestamp
  setCached(CACHE_KEYS.CACHE_TIMESTAMP, Date.now());
  
  return results;
}

// ============================================================
// Export
// ============================================================
window.portfolioData = {
  fetchAll: fetchAllData,
  getCached: getCached,
  setCached: setCached,
  CACHE_KEYS: CACHE_KEYS
};
