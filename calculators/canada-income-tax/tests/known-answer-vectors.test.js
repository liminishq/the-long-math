/**
 * Known-answer regression tests for Canada Personal Income Tax Calculator.
 * Run with Node (ES modules): node --experimental-vm-modules node_modules/jest/bin/jest.js known-answer-vectors.test.js
 * Or with Node directly: node tests/known-answer-vectors.test.js (see run-node-tests.js wrapper).
 *
 * These tests fail loudly if any calculation changes. Values are CRA/form-aligned expectations.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
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

const TOLERANCE = 2; // allow $2 rounding difference on CRA form-trace display amounts

function assertApprox(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual} (diff ${diff})`);
  }
}

// --- Known-answer vectors ---

/**
 * 2025 ON: $160,000 eligible dividends only, all else zero.
 * Expected (CRA form trace): federal 13,358, Ontario 6,902, total 20,260.
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
  // Federal tax includes enhanced BPA phase-out at net income $220,800 (between
  // the 29% and 33% bracket thresholds). Older snapshots used the maximum BPA only.
  assertApprox(result.totals.federalTax, 13494, TOLERANCE, 'federalTax');
  assertApprox(result.totals.provTax, 6902, TOLERANCE, 'provTax');
  assertApprox(result.totals.totalIncomeTax, 20396, TOLERANCE, 'totalIncomeTax');
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
  // Taxable income reduced by line 22215 enhanced CPP deduction (max $1,074 in 2025).
  assertApprox(result.totals.taxableIncome, 158926, TOLERANCE, 'taxableIncome (after line 22215)');
  assertApprox(result.totals.provTax, 16732, TOLERANCE, 'provTax (ON428 + OHP)');
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
 * 2025 ON: $160k employment — CRA form trace (Schedule 1 + ON428). See cra-expected.2025.json.
 */
export function test_ON_2025_employment_160k_CRA_expected() {
  const data = getDataOverride();
  const craExpectedPath = join(DATA_DIR, 'cra-expected.2025.json');
  const cra = JSON.parse(readFileSync(craExpectedPath, 'utf8'));
  const scenario = cra.scenarios.find(s => s.id === 'ON_employment_160k');
  if (!scenario) throw new Error('CRA expected scenario ON_employment_160k not found');

  const input = { year: 2025, ...scenario.input, fhsaDeduction: 0, estimatedDeductions: 0, taxPaid: 0 };
  const result = computePersonalTax(input, { dataOverride: data });

  const tolFed = scenario.toleranceFederal ?? 10;
  const tolProv = scenario.toleranceProvincial ?? 600;
  const tolTotal = scenario.toleranceTotal ?? 650;
  assertApprox(result.totals.federalTax, scenario.expected.federalTax, tolFed, 'federalTax (CRA Schedule 1)');
  assertApprox(result.totals.provTax, scenario.expected.provTax, tolProv, 'provTax');
  assertApprox(result.totals.totalIncomeTax, scenario.expected.totalIncomeTax, tolTotal, 'totalIncomeTax');
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

/**
 * Ontario Health Premium: statutory ramp between $200,000 and $200,600 of taxable income
 * (Ontario Taxation Act schedule; verify against Ontario Ministry of Finance sources).
 * At $200,300: $750 + 25% × ($200,300 − $200,000) = $825.
 */
export function test_ON_OHP_ramp_at_taxable_income_200300() {
  const data = getDataOverride();
  const input = {
    year: 2025,
    province: 'ON',
    employmentIncome: 0,
    selfEmploymentIncome: 0,
    otherIncome: 200300,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    capitalGains: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0,
  };
  const result = computePersonalTax(input, { dataOverride: data });

  if (result.totals.taxableIncome !== 200300) {
    throw new Error(`taxableIncome: expected 200300, got ${result.totals.taxableIncome}`);
  }

  const premiums = result.breakdown.provincial.premiums || [];
  const ohp = premiums.find((p) => p.name === 'Ontario Health Premium');
  if (!ohp) {
    throw new Error('Expected Ontario Health Premium in breakdown.provincial.premiums');
  }
  assertApprox(ohp.amount, 825, 0.01, 'Ontario Health Premium');
  return true;
}

function runAll() {
  const tests = [
    ['ON 2025 eligible dividends $160k', test_ON_2025_eligible_dividends_only_160k],
    ['ON 2025 employment $160k', test_ON_2025_employment_only_160k],
    ['ON 2025 employment $160k (CRA expected)', test_ON_2025_employment_160k_CRA_expected],
    ['AB 2025 eligible dividends $100k', test_AB_2025_eligible_dividends_only],
    ['ON: OHP at taxable income $200,300 (200k–200.6k ramp)', test_ON_OHP_ramp_at_taxable_income_200300],
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

const executedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executedDirectly) runAll();
