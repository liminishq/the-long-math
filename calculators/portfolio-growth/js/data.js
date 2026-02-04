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
// ============================================================
async function fetchBOCSeries(seriesCodeOrArray) {
  // Valet API format: GET /valet/observations/{seriesNames}/json
  // Returns JSON with observations array
  // Documentation: https://www.bankofcanada.ca/valet/docs
  
  // Handle array of possible series codes (try each until one works)
  const seriesCodes = Array.isArray(seriesCodeOrArray) ? seriesCodeOrArray : [seriesCodeOrArray];
  
  let lastError = null;
  
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
        try {
          const response = await fetch(url);
          
      if (response.ok) {
        const data = await response.json();
        const result = parseBOCResponse(data, seriesCode);
        if (result.length > 0) {
          console.log(`Successfully fetched ${seriesCode} from ${url}`);
          return result;
        }
      } else {
            // Log the status for debugging
            if (response.status === 404) {
              console.debug(`404 for ${url} (trying next format)`);
            } else {
              console.warn(`BOC API returned ${response.status} for ${url}`);
            }
          }
        } catch (urlError) {
          // Try next URL format
          console.debug(`Error fetching ${url}:`, urlError.message);
          continue;
        }
      }
      
      lastError = new Error(`BOC API error: All URL formats failed for series ${seriesCode}`);
    } catch (error) {
      lastError = error;
      continue; // Try next series code
    }
  }
  
  // If all series codes failed, try to find the series by searching available series
  console.warn(`All provided series codes failed for: ${seriesCodes.join(', ')}, attempting to find series...`);
  
  try {
    // Try to find a matching series by searching
    const foundCode = await findSeriesCode(seriesCodes);
    if (foundCode) {
      console.log(`Found matching series: ${foundCode}, attempting to fetch...`);
      // Recursively try to fetch with the found code
      return await fetchBOCSeries(foundCode);
    }
  } catch (searchError) {
    console.warn('Series search also failed:', searchError);
  }
  
  // If everything failed, throw the last error
  console.error(`All series codes failed for: ${seriesCodes.join(', ')}`, lastError);
  throw lastError || new Error(`Failed to fetch BOC series: ${seriesCodes.join(', ')}`);
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
// ============================================================
async function fetchUSDCAD() {
  const daily = await fetchBOCSeries(BOC_SERIES.FX_USDCAD);
  return dailyToMonthly(daily);
}

// ============================================================
// Fetch Canada CPI (monthly, or daily → monthly average)
// ============================================================
async function fetchCanadaCPI() {
  const data = await fetchBOCSeries(BOC_SERIES.CPI_CANADA);
  // If already monthly, convert format; otherwise average
  return dailyToMonthly(data);
}

// ============================================================
// Fetch 3-month T-bill yield (daily → monthly average)
// ============================================================
async function fetchTBill3M() {
  const daily = await fetchBOCSeries(BOC_SERIES.T_BILL_3M);
  return dailyToMonthly(daily);
}

// ============================================================
// Fetch 5-10 year bond yield (daily → monthly average)
// ============================================================
async function fetchBond5_10Y() {
  // Fetch both 5-year and 10-year, then average them
  try {
    const [bond5Y, bond10Y] = await Promise.all([
      fetchBOCSeries(BOC_SERIES.BOND_5Y).catch(() => null),
      fetchBOCSeries(BOC_SERIES.BOND_10Y).catch(() => null)
    ]);
    
    // If we have both, average them
    if (bond5Y && bond10Y) {
      // Convert both to monthly
      const monthly5Y = dailyToMonthly(bond5Y);
      const monthly10Y = dailyToMonthly(bond10Y);
      
      // Create a map for averaging
      const monthlyMap = new Map();
      
      // Add 5-year data
      monthly5Y.forEach(([month, value]) => {
        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, []);
        }
        monthlyMap.get(month).push(value);
      });
      
      // Add 10-year data
      monthly10Y.forEach(([month, value]) => {
        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, []);
        }
        monthlyMap.get(month).push(value);
      });
      
      // Average values for each month
      const averaged = [];
      for (const [month, values] of monthlyMap.entries()) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        averaged.push([month, avg]);
      }
      
      return averaged.sort((a, b) => a[0].localeCompare(b[0]));
    }
    
    // Fallback: use whichever one we have
    if (bond5Y) {
      return dailyToMonthly(bond5Y);
    }
    if (bond10Y) {
      return dailyToMonthly(bond10Y);
    }
    
    throw new Error('Failed to fetch bond data');
  } catch (error) {
    console.warn('Failed to fetch bond series:', error);
    throw error;
  }
}

// ============================================================
// Fetch 5-year GIC rate and compute historical average
// ============================================================
async function fetchGIC5Y() {
  const data = await fetchBOCSeries(BOC_SERIES.GIC_5Y);
  const monthly = weeklyToMonthly(data);
  
  // Compute average from 1990-01-01 to latest (or since inception)
  const startDate = '1990-01';
  const filtered = monthly.filter(([month]) => month >= startDate);
  
  if (filtered.length === 0) {
    // Fallback: use all available data
    const values = monthly.map(([_, v]) => v).filter(v => v != null);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { averageRate: avg, startDate: monthly[0]?.[0] || 'unknown', data: monthly };
  }
  
  const values = filtered.map(([_, v]) => v).filter(v => v != null);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  
  return {
    averageRate: avg,
    startDate: filtered[0]?.[0] || startDate,
    data: monthly
  };
}

// ============================================================
// Fetch Shiller dataset (US equities)
// ============================================================
async function fetchShillerData() {
  // Shiller data: Try CSV first, fallback to other methods
  // If CORS blocks, embed a static snapshot file (see comments in code)
  
  try {
    // Try CSV version first
    const response = await fetch(SHILLER_URL_CSV, { mode: 'cors' });
    
    if (!response.ok) {
      throw new Error('Shiller CSV not available');
    }
    
    const csv = await response.text();
    const parsed = parseShillerCSV(csv);
    
    if (parsed.length === 0) {
      throw new Error('Shiller CSV parsing returned no data');
    }
    
    return parsed;
  } catch (error) {
    console.warn('Shiller fetch failed:', error);
    // Fallback: try to load from embedded static file if available
    // TODO: If CORS continues to block, embed a static snapshot file
    // and update it manually. See: https://www.econ.yale.edu/~shiller/data/ie_data.csv
    return { error: 'Shiller data fetch failed due to CORS or network error. Please check console for details.' };
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
// ============================================================
async function fetchAllData(forceRefresh = false) {
  const results = {};
  
  // USD/CAD FX
  if (forceRefresh || !getCached(CACHE_KEYS.FX_USDCAD)) {
    results.fxUSDCAD = await fetchUSDCAD();
    setCached(CACHE_KEYS.FX_USDCAD, results.fxUSDCAD);
  } else {
    results.fxUSDCAD = getCached(CACHE_KEYS.FX_USDCAD);
  }
  
  // Canada CPI
  if (forceRefresh || !getCached(CACHE_KEYS.CPI_CANADA)) {
    results.cpiCanada = await fetchCanadaCPI();
    setCached(CACHE_KEYS.CPI_CANADA, results.cpiCanada);
  } else {
    results.cpiCanada = getCached(CACHE_KEYS.CPI_CANADA);
  }
  
  // T-bill 3M
  if (forceRefresh || !getCached(CACHE_KEYS.T_BILL_3M)) {
    results.tBill3M = await fetchTBill3M();
    setCached(CACHE_KEYS.T_BILL_3M, results.tBill3M);
  } else {
    results.tBill3M = getCached(CACHE_KEYS.T_BILL_3M);
  }
  
  // Bond 5-10Y
  if (forceRefresh || !getCached(CACHE_KEYS.BOND_5_10Y)) {
    results.bond5_10Y = await fetchBond5_10Y();
    setCached(CACHE_KEYS.BOND_5_10Y, results.bond5_10Y);
  } else {
    results.bond5_10Y = getCached(CACHE_KEYS.BOND_5_10Y);
  }
  
  // GIC 5Y
  if (forceRefresh || !getCached(CACHE_KEYS.GIC_5Y)) {
    const gicData = await fetchGIC5Y();
    results.gic5Y = gicData;
    setCached(CACHE_KEYS.GIC_5Y, gicData);
  } else {
    results.gic5Y = getCached(CACHE_KEYS.GIC_5Y);
  }
  
  // Shiller
  if (forceRefresh || !getCached(CACHE_KEYS.SHILLER)) {
    results.shiller = await fetchShillerData();
    setCached(CACHE_KEYS.SHILLER, results.shiller);
  } else {
    results.shiller = getCached(CACHE_KEYS.SHILLER);
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
