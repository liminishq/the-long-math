/**
 * Compatibility module for older CCPC imports.
 *
 * Personal tax math is canonical in calculators/canada-income-tax/js/tax.engine.js.
 * Keep this file as a re-export so the CCPC calculator cannot drift into a separate
 * implementation again.
 */
export {
  computePersonalTax,
  employerCppForT4Employment,
} from '../../canada-income-tax/js/tax.engine.js';
