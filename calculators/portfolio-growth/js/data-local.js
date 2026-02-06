/**
 * Data Loader - Local JSON files only
 * Loads and aligns JSON datasets to a common monthly date axis
 */

const DataLocal = {
  datasets: {},
  cpiData: null,
  alignedData: null,
  
  // Asset class definitions
  assetClasses: {
    cash: { name: 'Cash', file: 'cash_tr.json' },
    bonds: { name: 'Bonds', file: 'bonds10y_tr.json' },
    gic: { name: 'GIC Proxy', file: 'gic5y_proxy_tr.json' },
    equities: { name: 'Equities', file: 'equities_us_tr.json' }
  },

  /**
   * Load a single JSON dataset
   */
  async loadDataset(file) {
    try {
      const response = await fetch(`/assets/data/${file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Failed to load ${file}:`, error);
      return null;
    }
  },

  /**
   * Get value at a specific date (or nearest before)
   */
  getValueAtDate(series, date) {
    if (!series || series.length === 0) return null;
    
    // First try exact match
    for (let i = 0; i < series.length; i++) {
      if (series[i].date === date) {
        return series[i].value;
      }
    }
    
    // Then find nearest before
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].date <= date) {
        return series[i].value;
      }
    }
    
    // If date is before all data, return first value
    if (series.length > 0 && date < series[0].date) {
      return series[0].value;
    }
    
    return null;
  },

  /**
   * Get CPI value at a specific date
   */
  getCPIAtDate(date) {
    if (!this.cpiData || !this.cpiData.series) return null;
    return this.getValueAtDate(this.cpiData.series, date);
  },

  /**
   * Align all datasets to a common monthly date axis
   */
  alignDatasets() {
    const allDates = new Set();
    
    // Collect all dates from all datasets
    for (const [key, asset] of Object.entries(this.assetClasses)) {
      const data = this.datasets[key];
      if (data && data.series) {
        for (const item of data.series) {
          allDates.add(item.date);
        }
      }
    }

    // Also include CPI dates
    if (this.cpiData && this.cpiData.series) {
      for (const item of this.cpiData.series) {
        allDates.add(item.date);
      }
    }

    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) {
      return null;
    }

    // Create aligned data structure
    const aligned = {
      dates: sortedDates,
      assets: {},
      cpi: null
    };

    // For each asset, create aligned series
    for (const [key, asset] of Object.entries(this.assetClasses)) {
      const data = this.datasets[key];
      if (!data || !data.series) {
        aligned.assets[key] = null;
        continue;
      }

      // Create a map for quick lookup
      const dataMap = new Map();
      for (const item of data.series) {
        dataMap.set(item.date, item.value);
      }

      // Align to common dates, forward-filling missing values
      const alignedSeries = [];
      let lastValue = null;

      for (const date of sortedDates) {
        let value = dataMap.get(date);
        
        if (value == null || isNaN(value)) {
          value = lastValue; // Forward fill
        } else {
          lastValue = value;
        }

        if (value != null && !isNaN(value) && value > 0) {
          alignedSeries.push({ date, value });
        }
      }

      aligned.assets[key] = alignedSeries.length > 0 ? alignedSeries : null;
    }

    // Align CPI
    if (this.cpiData && this.cpiData.series) {
      const cpiMap = new Map();
      for (const item of this.cpiData.series) {
        cpiMap.set(item.date, item.value);
      }

      const alignedCPI = [];
      let lastCPI = null;

      for (const date of sortedDates) {
        let cpi = cpiMap.get(date);
        if (cpi == null || isNaN(cpi)) {
          cpi = lastCPI;
        } else {
          lastCPI = cpi;
        }

        if (cpi != null && !isNaN(cpi) && cpi > 0) {
          alignedCPI.push({ date, value: cpi });
        }
      }

      aligned.cpi = alignedCPI.length > 0 ? alignedCPI : null;
    }

    return aligned;
  },

  /**
   * Load all datasets
   */
  async loadAll() {
    const missing = [];
    const warnings = [];

    // Load CPI first (needed for inflation adjustment)
    this.cpiData = await this.loadDataset('cpi_us.json');
    if (!this.cpiData) {
      missing.push('CPI data (cpi_us.json)');
    }

    // Load asset datasets
    for (const [key, asset] of Object.entries(this.assetClasses)) {
      const rawData = await this.loadDataset(asset.file);
      if (!rawData) {
        missing.push(`${asset.name} (${asset.file})`);
        this.datasets[key] = null;
        continue;
      }

      // Data is already in index format (from build script)
      if (!rawData.series || !Array.isArray(rawData.series) || rawData.series.length === 0) {
        warnings.push(`${asset.name} (empty or invalid data)`);
        this.datasets[key] = null;
      } else {
        this.datasets[key] = rawData;
      }
    }

    // Align all datasets
    this.alignedData = this.alignDatasets();

    return {
      success: missing.length === 0,
      missing,
      warnings,
      alignedData: this.alignedData
    };
  }
};
