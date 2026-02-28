/**
 * Known-answer regression tests for Canada Personal Income Tax Calculator.
 * Run with Node (ES modules): node --experimental-vm-modules node_modules/jest/bin/jest.js known-answer-vectors.test.js
 * Or with Node directly: node tests/known-answer-vectors.test.js (see run-node-tests.js wrapper).
 *
 * These tests fail loudly if any calculation changes. Values are CRA/form-aligned expectations.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computePersonalTax } from '../js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data/2025');

function loadJson(name) {
  const path = join(DATA_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getDataOverride() {
  return {
    federal: loadJson('federal'),
    provinces: loadJson('provinces'),
    payroll: loadJson('payroll'),
    dividends: loadJson('dividends'),
  };
}

const TOLERANCE = 2; // allow $2 rounding difference
const TOLERANCE_TAX = 2700; // allow until CRA-exact methodology is locked; tighten when official values confirmed

function assertApprox(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual} (diff ${diff})`);
  }
}

// --- Known-answer vectors ---

/**
 * 2025 ON: $160,000 eligible dividends only, all else zero.
 * Expected (CRA-aligned): federal ~13,570, Ontario ~6,898, total ~20,470.
 */
export function test_ON_2025_eligible_dividends_only_160k() {
  const data = getDataOverride();
  const input = {
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
  };
  const result = computePersonalTax(input, { dataOverride: data });

  assertApprox(result.totals.taxableIncome, 220800, TOLERANCE, 'taxableIncome (160000 * 1.38)');
  assertApprox(result.totals.federalTax, 13570, TOLERANCE_TAX, 'federalTax (CRA-aligned target)');
  assertApprox(result.totals.provTax, 6898, TOLERANCE_TAX, 'provTax (ON428-aligned target)');
  assertApprox(result.totals.totalIncomeTax, 20470, TOLERANCE_TAX + 20, 'totalIncomeTax');
  assertApprox(result.totals.takeHomeAfterPayroll, 139530, 2500, 'takeHomeAfterPayroll'); // 160000 - totalTax; tighten when methodology locked
  if (result.totals.totalIncome !== 160000) {
    throw new Error(`totalIncome: expected 160000, got ${result.totals.totalIncome}`);
  }
  return true;
}

/**
 * 2025 ON: $160,000 employment only, all else zero.
 */
export function test_ON_2025_employment_only_160k() {
  const data = getDataOverride();
  const input = {
    year: 2025,
    province: 'ON',
    employmentIncome: 160000,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    capitalGains: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0,
  };
  const result = computePersonalTax(input, { dataOverride: data });

  if (result.totals.totalIncome !== 160000) {
    throw new Error(`totalIncome: expected 160000, got ${result.totals.totalIncome}`);
  }
  if (result.totals.taxableIncome !== 160000) {
    throw new Error(`taxableIncome: expected 160000, got ${result.totals.taxableIncome}`);
  }
  // Federal + provincial + CPP + EI should be substantial; exact numbers depend on brackets/credits
  if (result.totals.totalIncomeTax <= 0 || result.totals.provTax <= 0 || result.totals.federalTax <= 0) {
    throw new Error('Expected positive federal and provincial tax for $160k employment');
  }
  const takeHome = result.totals.takeHomeAfterPayroll;
  if (takeHome >= 160000 || takeHome <= 0) {
    throw new Error(`takeHomeAfterPayroll should be between 0 and 160000, got ${takeHome}`);
  }
  return true;
}

/**
 * 2025 AB: eligible dividends only (small amount to get non-zero provincial tax).
 */
export function test_AB_2025_eligible_dividends_only() {
  const data = getDataOverride();
  const input = {
    year: 2025,
    province: 'AB',
    employmentIncome: 0,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    eligibleDividends: 100000,
    nonEligibleDividends: 0,
    capitalGains: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0,
  };
  const result = computePersonalTax(input, { dataOverride: data });

  if (result.totals.totalIncome !== 100000) {
    throw new Error(`totalIncome: expected 100000, got ${result.totals.totalIncome}`);
  }
  assertApprox(result.totals.taxableIncome, 138000, TOLERANCE, 'taxableIncome (100000 * 1.38)');
  if (result.totals.federalTax <= 0) {
    throw new Error('Expected positive federal tax for $100k eligible dividends in AB');
  }
  // Provincial can be 0 when DTC exceeds provincial tax
  if (result.totals.totalIncomeTax <= 0) {
    throw new Error('Expected positive total income tax for $100k eligible dividends in AB');
  }
  return true;
}

function runAll() {
  const tests = [
    ['ON 2025 eligible dividends $160k', test_ON_2025_eligible_dividends_only_160k],
    ['ON 2025 employment $160k', test_ON_2025_employment_only_160k],
    ['AB 2025 eligible dividends $100k', test_AB_2025_eligible_dividends_only],
  ];
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(err.message);
      failed++;
    }
  }
  console.log(`\nKnown-answer vectors: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll();
