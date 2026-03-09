/**
 * Corporate tax data loading and normalization module
 * Loads corporate tax data from JSON files and provides normalized access
 */

let federalCorporateData = null;
let provincesCorporateData = null;

/**
 * Load all corporate tax data files for a given year
 * @param {number} year - The tax year
 * @returns {Promise<Object>} Object containing all loaded data
 */
export async function loadCorporateTaxData(year) {
  try {
    const [federal, provinces] = await Promise.all([
      fetch(`data/${year}/federal-corporate.json`).then(r => r.json()),
      fetch(`data/${year}/provinces-corporate.json`).then(r => r.json())
    ]);

    federalCorporateData = federal;
    provincesCorporateData = provinces;

    return {
      federal: federalCorporateData,
      provinces: provincesCorporateData
    };
  } catch (error) {
    console.error('Error loading corporate tax data:', error);
    throw new Error(`Failed to load corporate tax data for year ${year}`);
  }
}

/**
 * Get federal corporate tax data
 * @returns {Object} Federal corporate tax data
 */
export function getFederalCorporateData() {
  if (!federalCorporateData) {
    throw new Error('Corporate tax data not loaded. Call loadCorporateTaxData() first.');
  }
  return federalCorporateData;
}

/**
 * Get provincial/territorial corporate tax data
 * @param {string} province - Province code (e.g., 'ON', 'BC')
 * @returns {Object} Provincial corporate tax data
 */
export function getProvincialCorporateData(province) {
  if (!provincesCorporateData) {
    throw new Error('Corporate tax data not loaded. Call loadCorporateTaxData() first.');
  }
  if (!provincesCorporateData[province]) {
    throw new Error(`Province ${province} not found in corporate tax data`);
  }
  return provincesCorporateData[province];
}
