/**
 * Golden tests tied to docs/form-traces/*.md
 * Run: node tests/form-trace-vectors.test.js
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computePersonalTax } from '../js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOL = 2;

function loadData(year) {
  const dir = join(__dirname, `../data/${year}`);
  return {
    federal: JSON.parse(readFileSync(join(dir, 'federal.json'), 'utf8')),
    provinces: JSON.parse(readFileSync(join(dir, 'provinces.json'), 'utf8')),
    payroll: JSON.parse(readFileSync(join(dir, 'payroll.json'), 'utf8')),
    dividends: JSON.parse(readFileSync(join(dir, 'dividends.json'), 'utf8')),
  };
}

function assertApprox(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual} (diff ${diff})`);
  }
}

function compute(overrides) {
  const year = overrides.year ?? 2025;
  return computePersonalTax(
    {
      employmentIncome: 0,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0,
      ...overrides,
    },
    { dataOverride: loadData(year) }
  );
}

// --- BC employment (see BC-employment-85000-2025-vs-2026.md) ---
export function test_BC_2025_employment_85k() {
  const r = compute({ year: 2025, province: 'BC', employmentIncome: 85000 });
  assertApprox(r.totals.taxableIncome, 83926, TOL, 'taxableIncome');
  assertApprox(r.totals.federalTax, 10457, TOL, 'federalTax');
  assertApprox(r.totals.provTax, 4283, TOL, 'provTax');
  assertApprox(r.totals.totalIncomeTax, 14740, TOL, 'totalIncomeTax');
}

export function test_BC_2026_employment_85k() {
  const r = compute({ year: 2026, province: 'BC', employmentIncome: 85000 });
  assertApprox(r.totals.taxableIncome, 83873, TOL, 'taxableIncome');
  assertApprox(r.totals.federalTax, 10227, TOL, 'federalTax');
  assertApprox(r.totals.provTax, 4400, TOL, 'provTax');
  assertApprox(r.totals.totalIncomeTax, 14627, TOL, 'totalIncomeTax');
}

// --- ON employment (see ON-employment-160000-2025-vs-2026.md) ---
export function test_ON_2025_employment_160k() {
  const r = compute({ year: 2025, province: 'ON', employmentIncome: 160000 });
  assertApprox(r.totals.taxableIncome, 158926, TOL, 'taxableIncome');
  assertApprox(r.totals.cppDeductible, 1074, TOL, 'cppDeductible');
  assertApprox(r.totals.federalTax, 28262, TOL, 'federalTax');
  assertApprox(r.totals.provTax, 16732, TOL, 'provTax');
  assertApprox(r.totals.totalIncomeTax, 44994, TOL, 'totalIncomeTax');
}

export function test_ON_2026_employment_160k() {
  const r = compute({ year: 2026, province: 'ON', employmentIncome: 160000 });
  assertApprox(r.totals.taxableIncome, 158873, TOL, 'taxableIncome');
  assertApprox(r.totals.federalTax, 27902, TOL, 'federalTax');
  // Provincial tax reflects CRA T4032-ON 2026 surtax thresholds ($5,818 / $7,446).
  assertApprox(r.totals.provTax, 16486, TOL, 'provTax');
  assertApprox(r.totals.totalIncomeTax, 44388, TOL, 'totalIncomeTax');
}

// --- ON eligible dividends (see ON-eligible-dividends-160000-2025.md) ---
export function test_ON_2025_eligible_dividends_160k() {
  const r = compute({ year: 2025, province: 'ON', eligibleDividends: 160000 });
  assertApprox(r.totals.taxableIncome, 220800, TOL, 'taxableIncome');
  assertApprox(r.totals.federalTax, 13494, TOL, 'federalTax');
  assertApprox(r.totals.provTax, 6902, TOL, 'provTax');
  assertApprox(r.totals.totalIncomeTax, 20396, TOL, 'totalIncomeTax');
  assertApprox(r.totals.cpp, 0, 0, 'cpp');
}

// --- AB eligible dividends (known-answer legacy) ---
export function test_AB_2025_eligible_dividends_100k() {
  const r = compute({ year: 2025, province: 'AB', eligibleDividends: 100000 });
  assertApprox(r.totals.taxableIncome, 138000, TOL, 'taxableIncome');
  assertApprox(r.totals.provTax, 0, 0, 'provTax');
  assertApprox(r.totals.federalTax, 2979, TOL, 'federalTax');
}

// --- Capital gains + employment BC 2025 ---
export function test_BC_2025_employment_75k_capital_gains_50k() {
  const r = compute({
    year: 2025,
    province: 'BC',
    employmentIncome: 75000,
    capitalGains: 50000,
  });
  assertApprox(r.totals.totalIncome, 125000, 0, 'totalIncome cash');
  assertApprox(r.totals.taxableIncome, 99174, TOL, 'taxableIncome');
  assertApprox(r.totals.cpp, 4182.1, TOL, 'cpp');
}

// --- OHP ramp (other income only so no CPP deduction) ---
export function test_ON_2025_OHP_at_TI_200300() {
  const r = compute({ year: 2025, province: 'ON', otherIncome: 200300 });
  const ohp = r.breakdown.provincial.premiums?.find((p) => p.name === 'Ontario Health Premium');
  if (!ohp) throw new Error('missing OHP');
  assertApprox(ohp.amount, 825, 0.01, 'OHP');
}

function runAll() {
  const tests = [
    ['BC 2025 employment $85k', test_BC_2025_employment_85k],
    ['BC 2026 employment $85k', test_BC_2026_employment_85k],
    ['ON 2025 employment $160k', test_ON_2025_employment_160k],
    ['ON 2026 employment $160k', test_ON_2026_employment_160k],
    ['ON 2025 eligible dividends $160k', test_ON_2025_eligible_dividends_160k],
    ['AB 2025 eligible dividends $100k', test_AB_2025_eligible_dividends_100k],
    ['BC 2025 $75k employment + $50k cap gains', test_BC_2025_employment_75k_capital_gains_50k],
    ['ON OHP at TI $200,300', test_ON_2025_OHP_at_TI_200300],
  ];
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`FAIL: ${name}`);
      console.error(e.message);
      failed++;
    }
  }
  console.log(`\nForm trace vectors: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

const executedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executedDirectly) runAll();
