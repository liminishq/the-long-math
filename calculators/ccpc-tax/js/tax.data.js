/**
 * Compatibility module for older CCPC imports.
 *
 * Personal tax data is canonical in calculators/canada-income-tax/data and is
 * loaded/validated by calculators/canada-income-tax/js/tax.data.js.
 */
import {
  loadTaxData as loadCanonicalTaxData,
  getFederalData,
  getProvincesData,
  getProvincialData,
  getPayrollData,
  getDividendsData,
  normalizeProvince,
} from '../../canada-income-tax/js/tax.data.js';

const PERSONAL_TAX_DATA_BASE = '/calculators/canada-income-tax/data';

export function loadTaxData(year, opts = {}) {
  return loadCanonicalTaxData(year, {
    basePath: PERSONAL_TAX_DATA_BASE,
    ...opts,
  });
}

export {
  getFederalData,
  getProvincesData,
  getProvincialData,
  getPayrollData,
  getDividendsData,
  normalizeProvince,
};
