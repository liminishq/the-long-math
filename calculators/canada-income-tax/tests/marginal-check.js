/**
 * Quick check: Ontario $160k other income and $160k eligible dividends — marginal should be ~30–50%.
 * Run from repo root: node calculators/canada-income-tax/tests/marginal-check.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computePersonalTax } from '../js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data/2025');

function loadJson(name) {
  return JSON.parse(readFileSync(join(DATA_DIR, `${name}.json`), 'utf8'));
}
const dataOverride = {
  federal: loadJson('federal'),
  provinces: loadJson('provinces'),
  payroll: loadJson('payroll'),
  dividends: loadJson('dividends'),
};

function run(label, input) {
  const result = computePersonalTax(input, { dataOverride });
  const m = result.totals.marginalRate;
  const pct = m != null ? (m * 100).toFixed(2) + '%' : '–%';
  console.log(`${label}: marginal = ${pct} (raw: ${m})`);
}

console.log('Ontario 2025 marginal check:\n');
run('ON $160k other income', {
  year: 2025,
  province: 'ON',
  employmentIncome: 0,
  selfEmploymentIncome: 0,
  otherIncome: 160000,
  eligibleDividends: 0,
  nonEligibleDividends: 0,
  capitalGains: 0,
  rrspDeduction: 0,
  fhsaDeduction: 0,
  estimatedDeductions: 0,
  taxPaid: 0,
});
run('ON $160k eligible dividends', {
  year: 2025,
  province: 'ON',
  employmentIncome: 0,
  selfEmploymentIncome: 0,
  otherIncome: 0,
  eligibleDividends: 160000,
  nonEligibleDividends: 0,
  capitalGains: 0,
  rrspDeduction: 0,
  fhsaDeduction: 0,
  estimatedDeductions: 0,
  taxPaid: 0,
});
// Simulate form passing string (e.g. "160000.") — engine must still show ~45% marginal, never -22455%
run('ON $160k other income (as string, like form)', {
  year: 2025,
  province: 'ON',
  employmentIncome: 0,
  selfEmploymentIncome: 0,
  otherIncome: '160000',
  eligibleDividends: 0,
  nonEligibleDividends: 0,
  capitalGains: 0,
  rrspDeduction: 0,
  fhsaDeduction: 0,
  estimatedDeductions: 0,
  taxPaid: 0,
});
console.log('\nExpected: marginal ~30–50%, not negative thousands.');
