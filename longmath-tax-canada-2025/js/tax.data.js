/**
 * Data loading and normalization module
 * Loads tax data from JSON files and provides normalized access
 */

let federalData = null;
let provincesData = null;
let payrollData = null;
let dividendsData = null;

/**
 * Load all tax data files for a given year
 * @param {number} year - The tax year
 * @returns {Promise<Object>} Object containing all loaded data
 */
export async function loadTaxData(year) {
  try {
    const [federal, provinces, payroll, dividends] = await Promise.all([
      fetch(`data/${year}/federal.json`).then(r => r.json()),
      fetch(`data/${year}/provinces.json`).then(r => r.json()),
      fetch(`data/${year}/payroll.json`).then(r => r.json()),
      fetch(`data/${year}/dividends.json`).then(r => r.json())
    ]);

    federalData = federal;
    provincesData = provinces;
    payrollData = payroll;
    dividendsData = dividends;

    return {
      federal: federalData,
      provinces: provincesData,
      payroll: payrollData,
      dividends: dividendsData
    };
  } catch (error) {
    console.error('Error loading tax data:', error);
    throw new Error(`Failed to load tax data for year ${year}`);
  }
}

/**
 * Get federal tax data
 * @returns {Object} Federal tax data
 */
export function getFederalData() {
  if (!federalData) {
    throw new Error('Tax data not loaded. Call loadTaxData() first.');
  }
  return federalData;
}

/**
 * Get provincial/territorial tax data
 * @param {string} province - Province code (e.g., 'ON', 'BC')
 * @returns {Object} Provincial tax data
 */
export function getProvincialData(province) {
  if (!provincesData) {
    throw new Error('Tax data not loaded. Call loadTaxData() first.');
  }
  if (!provincesData[province]) {
    throw new Error(`Province ${province} not found in tax data`);
  }
  return provincesData[province];
}

/**
 * Get payroll data (CPP/EI)
 * @returns {Object} Payroll data
 */
export function getPayrollData() {
  if (!payrollData) {
    throw new Error('Tax data not loaded. Call loadTaxData() first.');
  }
  return payrollData;
}

/**
 * Get dividend data
 * @returns {Object} Dividend data
 */
export function getDividendsData() {
  if (!dividendsData) {
    throw new Error('Tax data not loaded. Call loadTaxData() first.');
  }
  return dividendsData;
}
