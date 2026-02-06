/**
 * Data Loader for Portfolio Growth Calculator
 * Loads and aligns JSON datasets to a common monthly date axis
 */

const DataLoader = {
  datasets: {},
  alignedData: null,
  cpiData: null,
  
  // Asset class definitions
  assetClasses: {
    cash: { name: 'Cash', file: 'cash_tr.json', isIndex: true },
    bonds: { name: 'Bonds', file: 'bonds10y_tr.json', isIndex: true },
    gic: { name: 'GIC Proxy', file: 'gic5y_proxy_tr.json', isIndex: true },
    equities: { name: 'Equities', file: 'equities_us_tr.json', isIndex: true }
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
   * Align all datasets to a common monthly date axis
   */
  alignDatasets() {
    const allDates = new Set();
    
    // Collect all dates from all datasets
    for (const [key, asset] of Object.entries(this.assetClasses)) {
      if (key === 'cash') continue; // Cash has no data file
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
      assets: {}
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
      missing.push('CPI data');
    }

    // Load asset datasets
    for (const [key, asset] of Object.entries(this.assetClasses)) {
      if (!asset.file) continue;

      const rawData = await this.loadDataset(asset.file);
      if (!rawData) {
        missing.push(asset.name);
        this.datasets[key] = null;
        continue;
      }

      // Data is already in index format (from build script)
      // Just validate structure
      if (!rawData.series || !Array.isArray(rawData.series) || rawData.series.length === 0) {
        warnings.push(`${asset.name} (empty or invalid data)`);
        this.datasets[key] = null;
      } else {
        this.datasets[key] = rawData;
      }

      if (!indexData || !indexData.series || indexData.series.length === 0) {
        warnings.push(`${asset.name} (empty or invalid data)`);
        this.datasets[key] = null;
      } else {
        this.datasets[key] = indexData;
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
