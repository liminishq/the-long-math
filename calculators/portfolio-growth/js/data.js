/* ============================================================
   Portfolio Growth Calculator — Data Acquisition Module
   ============================================================
   
   Loads pre-validated, static historical datasets from local JSON files.
   All data is served from this domain to avoid CORS issues and ensure
   stability and transparency.
   
   Data sources (historical, static):
   - Bank of Canada (USD/CAD FX, CPI, T-bills, bonds, GIC)
   - Yale/Shiller dataset (US equities)
   
   All series are in monthly format (YYYY-MM).
   ============================================================ */

// ============================================================
// Configuration: Local data file paths
// ============================================================

const DATA_BASE_PATH = '/assets/data';

const DATA_FILES = {
  FX_USDCAD: `${DATA_BASE_PATH}/usdcad_monthly.json`,
  CPI_CANADA: `${DATA_BASE_PATH}/canada_cpi.json`,
  T_BILL_3M: `${DATA_BASE_PATH}/canada_tbill_3m.json`,
  BOND_5_10Y: `${DATA_BASE_PATH}/canada_bond_5_10y.json`,
  GIC_5Y: `${DATA_BASE_PATH}/canada_gic_5y.json`,
  SHILLER: `${DATA_BASE_PATH}/shiller_real_returns.json`
};

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
// Load local JSON data file
// Returns SeriesLoadResult
// ============================================================
async function loadLocalDataFile(filePath, seriesId, label) {
  try {
    const response = await fetch(filePath);
    
    if (!response.ok) {
      return createFailureResult(
        seriesId,
        label,
        `HTTP ${response.status}`,
        `Failed to load ${filePath}: ${response.status} ${response.statusText}`,
        [filePath]
      );
    }
    
    const jsonData = await response.json();
    
    // Validate JSON structure
    if (!jsonData || !jsonData.series || !Array.isArray(jsonData.series)) {
      return createFailureResult(
        seriesId,
        label,
        'Invalid data format',
        `File ${filePath} does not contain a valid 'series' array`,
        [filePath]
      );
    }
    
    // Convert to standard format: { month, value } or { month, price, dividend } for Shiller
    const normalizedData = jsonData.series.map(item => {
      const month = item.date || item.month;
      if (item.price !== undefined && item.dividend !== undefined) {
        // Shiller format
        return {
          month: month,
          price: item.price,
          dividend: item.dividend
        };
      } else {
        // Standard format
        return {
          month: month,
          value: item.value
        };
      }
    });
    
    // Validate the data
    const validation = validateMonthlyData(normalizedData, seriesId);
    if (!validation.valid) {
      return createFailureResult(seriesId, label, validation.reason, validation.detail, [filePath]);
    }
    
    console.log(`[${seriesId}] Successfully loaded from ${filePath}`);
    return createSuccessResult(seriesId, label, normalizedData);
    
  } catch (error) {
    const detail = error.message || 'Network or parse error';
    console.error(`[${seriesId}] Error loading ${filePath}:`, error);
    return createFailureResult(seriesId, label, 'Failed to load data file', detail, [filePath]);
  }
}

// ============================================================
// Load USD/CAD FX (monthly)
// Returns SeriesLoadResult
// ============================================================
async function fetchUSDCAD() {
  return await loadLocalDataFile(DATA_FILES.FX_USDCAD, 'FX_USDCAD', 'USD/CAD Exchange Rate');
}

// ============================================================
// Load Canada CPI (monthly)
// Returns SeriesLoadResult
// ============================================================
async function fetchCanadaCPI() {
  return await loadLocalDataFile(DATA_FILES.CPI_CANADA, 'CPI_CANADA', 'Canada CPI');
}

// ============================================================
// Load 3-month T-bill yield (monthly)
// Returns SeriesLoadResult
// ============================================================
async function fetchTBill3M() {
  return await loadLocalDataFile(DATA_FILES.T_BILL_3M, 'T_BILL_3M', 'Canada 3-month T-bills');
}

// ============================================================
// Load 5-10 year bond yield (monthly)
// Returns SeriesLoadResult
// ============================================================
async function fetchBond5_10Y() {
  return await loadLocalDataFile(DATA_FILES.BOND_5_10Y, 'BOND_5_10Y', 'Canada Bonds (5-10 year)');
}

// ============================================================
// Load 5-year GIC rate and extract metadata
// Returns SeriesLoadResult with additional metadata
// ============================================================
async function fetchGIC5Y() {
  try {
    const response = await fetch(DATA_FILES.GIC_5Y);
    
    if (!response.ok) {
      return createFailureResult(
        'GIC_5Y',
        'Canada 5-year GIC',
        `HTTP ${response.status}`,
        `Failed to load ${DATA_FILES.GIC_5Y}: ${response.status} ${response.statusText}`,
        [DATA_FILES.GIC_5Y]
      );
    }
    
    const jsonData = await response.json();
    
    // Validate JSON structure
    if (!jsonData || !jsonData.series || !Array.isArray(jsonData.series)) {
      return createFailureResult(
        'GIC_5Y',
        'Canada 5-year GIC',
        'Invalid data format',
        `File ${DATA_FILES.GIC_5Y} does not contain a valid 'series' array`,
        [DATA_FILES.GIC_5Y]
      );
    }
    
    // Convert to standard format
    const normalizedData = jsonData.series.map(item => ({
      month: item.date || item.month,
      value: item.value
    }));
    
    // Validate the data
    const validation = validateMonthlyData(normalizedData, 'GIC_5Y');
    if (!validation.valid) {
      return createFailureResult('GIC_5Y', 'Canada 5-year GIC', validation.reason, validation.detail, [DATA_FILES.GIC_5Y]);
    }
    
    // Extract metadata (average rate and start date)
    let metadata = null;
    if (jsonData.metadata && jsonData.metadata.averageRate != null) {
      // Use provided metadata
      metadata = {
        averageRate: jsonData.metadata.averageRate,
        startDate: jsonData.metadata.startDate || jsonData.start || normalizedData[0]?.month
      };
    } else {
      // Compute average from data
      const startDate = jsonData.start || '1990-01';
      const filtered = normalizedData.filter(({ month }) => month >= startDate);
      const values = (filtered.length > 0 ? filtered : normalizedData)
        .map(({ value }) => value)
        .filter(isValidValue);
      
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        if (isValidValue(avg)) {
          metadata = {
            averageRate: avg,
            startDate: filtered.length > 0 ? filtered[0]?.month : normalizedData[0]?.month || startDate
          };
        }
      }
    }
    
    if (!metadata || !isValidValue(metadata.averageRate)) {
      return createFailureResult('GIC_5Y', 'Canada 5-year GIC', 'Invalid metadata', 'Average rate not available or invalid', [DATA_FILES.GIC_5Y]);
    }
    
    console.log(`[GIC_5Y] Successfully loaded from ${DATA_FILES.GIC_5Y}`);
    return {
      ...createSuccessResult('GIC_5Y', 'Canada 5-year GIC', normalizedData),
      metadata: metadata
    };
    
  } catch (error) {
    const detail = error.message || 'Network or parse error';
    console.error(`[GIC_5Y] Error loading ${DATA_FILES.GIC_5Y}:`, error);
    return createFailureResult('GIC_5Y', 'Canada 5-year GIC', 'Failed to load data file', detail, [DATA_FILES.GIC_5Y]);
  }
}

// ============================================================
// Load Shiller dataset (US equities)
// Returns SeriesLoadResult
// ============================================================
async function fetchShillerData() {
  try {
    const response = await fetch(DATA_FILES.SHILLER);
    
    if (!response.ok) {
      return createFailureResult(
        'SHILLER',
        'US Equities (Shiller)',
        `HTTP ${response.status}`,
        `Failed to load ${DATA_FILES.SHILLER}: ${response.status} ${response.statusText}`,
        [DATA_FILES.SHILLER]
      );
    }
    
    const jsonData = await response.json();
    
    // Validate JSON structure
    if (!jsonData || !jsonData.series || !Array.isArray(jsonData.series)) {
      return createFailureResult(
        'SHILLER',
        'US Equities (Shiller)',
        'Invalid data format',
        `File ${DATA_FILES.SHILLER} does not contain a valid 'series' array`,
        [DATA_FILES.SHILLER]
      );
    }
    
    // Convert to standard format: { month, price, dividend }
    const normalizedData = jsonData.series.map(item => ({
      month: item.date || item.month,
      price: item.price,
      dividend: item.dividend
    }));
    
    // Validate the data (custom validation for Shiller format)
    if (normalizedData.length === 0) {
      return createFailureResult('SHILLER', 'US Equities (Shiller)', 'No data available', 'Series array is empty', [DATA_FILES.SHILLER]);
    }
    
    // Check all values are finite
    for (let i = 0; i < normalizedData.length; i++) {
      const item = normalizedData[i];
      if (!item.month || typeof item.month !== 'string') {
        return createFailureResult('SHILLER', 'US Equities (Shiller)', 'Invalid date format', `Item ${i} has invalid month: ${item.month}`, [DATA_FILES.SHILLER]);
      }
      if (!isValidValue(item.price) || !isValidValue(item.dividend)) {
        return createFailureResult('SHILLER', 'US Equities (Shiller)', 'Invalid data values', `Item ${i} has non-finite price or dividend`, [DATA_FILES.SHILLER]);
      }
    }
    
    // Check dates are monotonic
    const months = normalizedData.map(item => item.month);
    for (let i = 1; i < months.length; i++) {
      if (months[i] <= months[i - 1]) {
        return createFailureResult('SHILLER', 'US Equities (Shiller)', 'Dates not in order', `Dates are not monotonic at index ${i}`, [DATA_FILES.SHILLER]);
      }
    }
    
    console.log(`[SHILLER] Successfully loaded from ${DATA_FILES.SHILLER}`);
    return createSuccessResult('SHILLER', 'US Equities (Shiller)', normalizedData);
    
  } catch (error) {
    const detail = error.message || 'Network or parse error';
    console.error(`[SHILLER] Error loading ${DATA_FILES.SHILLER}:`, error);
    return createFailureResult('SHILLER', 'US Equities (Shiller)', 'Failed to load data file', detail, [DATA_FILES.SHILLER]);
  }
}

// ============================================================
// Main data loader
// Returns object with SeriesLoadResult for each series
// ============================================================
async function fetchAllData(forceRefresh = false) {
  // Note: forceRefresh parameter kept for API compatibility but ignored
  // since we're loading static local files
  
  const results = {};
  
  // Load all series in parallel
  const [
    fxUSDCAD,
    cpiCanada,
    tBill3M,
    bond5_10Y,
    gic5Y,
    shiller
  ] = await Promise.all([
    fetchUSDCAD(),
    fetchCanadaCPI(),
    fetchTBill3M(),
    fetchBond5_10Y(),
    fetchGIC5Y(),
    fetchShillerData()
  ]);
  
  results.fxUSDCAD = fxUSDCAD;
  results.cpiCanada = cpiCanada;
  results.tBill3M = tBill3M;
  results.bond5_10Y = bond5_10Y;
  results.gic5Y = gic5Y;
  results.shiller = shiller;
  
  return results;
}

// ============================================================
// Export
// ============================================================
window.portfolioData = {
  fetchAll: fetchAllData
};
