/**
 * CRA-aligned CPP split and T1-flow regression tests (2025/2026).
 * Run: node tests/cra-cpp-vectors.test.js
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computePersonalTax } from '../js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadData(year) {
  const dir = join(__dirname, `../data/${year}`);
  return {
    federal: JSON.parse(readFileSync(join(dir, 'federal.json'), 'utf8')),
    provinces: JSON.parse(readFileSync(join(dir, 'provinces.json'), 'utf8')),
    payroll: JSON.parse(readFileSync(join(dir, 'payroll.json'), 'utf8')),
    dividends: JSON.parse(readFileSync(join(dir, 'dividends.json'), 'utf8')),
  };
}

const TOL = 2;

function assertApprox(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual} (diff ${diff})`);
  }
}

function baseInput(overrides = {}) {
  return {
    year: 2026,
    province: 'BC',
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
  };
}

function compute(input) {
  const year = input.year ?? 2026;
  return computePersonalTax(input, { dataOverride: loadData(year) });
}

/** BC 2025 employment $85,000 — form trace BC-employment-85000-2025-vs-2026.md */
export function test_BC_2025_employment_85k() {
  const r = compute(baseInput({ year: 2025, employmentIncome: 85000 }));
  const { totals, breakdown } = r;

  assertApprox(totals.taxableIncome, 83926, TOL, 'taxableIncome');
  assertApprox(totals.cpp, 4430.10, TOL, 'cpp total');
  assertApprox(totals.cppCreditable, 3356.10, TOL, 'cpp creditable base');
  assertApprox(totals.cppDeductible, 1074, TOL, 'cpp deductible (enhanced)');
  assertApprox(breakdown.payroll.cpp.cpp2Deductible, 396, TOL, 'cpp2 deductible');
  assertApprox(totals.ei, 1077.48, TOL, 'ei');
  assertApprox(breakdown.federal.baseTax, 13762, TOL, 'federal tax before credits');
  assertApprox(totals.federalTax, 10457, TOL, 'federal tax after credits');
  assertApprox(totals.provTax, 4283, TOL, 'BC tax after credits (BC428; 5.06% 2025)');
  assertApprox(totals.totalIncomeTax, 14740, TOL, 'combined income tax');
  assertApprox(totals.totalBurden, 20247.58, TOL, 'total burden incl. CPP/EI');
}

/** BC 2026 employment $85,000 — primary audit vector (Schedule 1 + line 22215 + BC428). */
export function test_BC_2026_employment_85k() {
  const r = compute(baseInput({ employmentIncome: 85000 }));
  const { totals, breakdown } = r;

  assertApprox(totals.taxableIncome, 83873, TOL, 'taxableIncome');
  assertApprox(totals.cpp, 4646.45, TOL, 'cpp total');
  assertApprox(totals.cppCreditable, 3519.45, TOL, 'cpp creditable base');
  assertApprox(totals.cppDeductible, 1127, TOL, 'cpp deductible (enhanced)');
  assertApprox(breakdown.payroll.cpp.cpp2Deductible, 416, TOL, 'cpp2 deductible');
  assertApprox(totals.ei, 1123.07, TOL, 'ei');
  assertApprox(breakdown.federal.baseTax, 13390, TOL, 'federal tax before credits');
  assertApprox(totals.federalTax, 10227, TOL, 'federal tax after credits');
  assertApprox(totals.provTax, 4400, TOL, 'BC tax after credits (BC428; 5.60% bracket/credits 2026)');
  assertApprox(totals.totalIncomeTax, 14627, TOL, 'combined income tax');
  assertApprox(totals.totalBurden, 20396.52, TOL, 'total burden incl. CPP/EI');
}

/** Below YMPE — no CPP2, partial CPP1. */
export function test_BC_2026_below_ympe() {
  const r = compute(baseInput({ employmentIncome: 40000 }));
  assertApprox(r.totals.cpp, 2171.75, TOL, 'cpp');
  assertApprox(r.totals.cppDeductible, 365, TOL, 'cpp deductible (first additional only)');
  assertApprox(r.breakdown.payroll.cpp.cpp2, 0, 0, 'cpp2');
  assertApprox(r.totals.taxableIncome, 39635, TOL, 'taxable income');
}

/** Above YMPE, below YAMPE — CPP2 applies. */
export function test_BC_2026_between_ympe_yampe() {
  const r = compute(baseInput({ employmentIncome: 80000 }));
  assertApprox(r.breakdown.payroll.cpp.cpp2, 216, TOL, 'cpp2');
  assertApprox(r.totals.cppDeductible, 927, TOL, 'cpp deductible');
}

/** At YAMPE — max CPP2. */
export function test_BC_2026_at_yampe() {
  const r = compute(baseInput({ employmentIncome: 85000 }));
  assertApprox(r.breakdown.payroll.cpp.cpp2, 416, TOL, 'cpp2 max at YAMPE');
}

/** Federal first bracket ceiling 2026. */
export function test_BC_2026_federal_bracket_threshold() {
  const r = compute(baseInput({ employmentIncome: 58523 }));
  assertApprox(r.totals.taxableIncome, 57972.77, TOL, 'taxable at bracket edge (after line 22215)');
  assertApprox(r.breakdown.federal.baseTax, 8117, TOL, 'federal base at edge');
}

/** BC first bracket ceiling 2026. */
export function test_BC_2026_provincial_bracket_threshold() {
  const r = compute(baseInput({ employmentIncome: 50363 }));
  assertApprox(r.totals.taxableIncome, 49894.37, TOL, 'taxable at BC bracket edge (after line 22215)');
}

/** No employment — no CPP/EI. */
export function test_BC_2026_no_payroll() {
  const r = compute(baseInput({ otherIncome: 50000 }));
  assertApprox(r.totals.cpp, 0, 0, 'cpp');
  assertApprox(r.totals.ei, 0, 0, 'ei');
  assertApprox(r.totals.taxableIncome, 50000, 0, 'taxable');
}

/** RRSP reduces taxable income; CPP unchanged (employment-driven). */
export function test_BC_2026_rrsp_deduction() {
  const r = compute(baseInput({ employmentIncome: 85000, rrspDeduction: 5000 }));
  assertApprox(r.totals.taxableIncome, 78873, TOL, 'taxable after RRSP and CPP ded.');
  assertApprox(r.totals.cpp, 4646.45, TOL, 'cpp unchanged');
}

/** Eligible dividends only — CPP/EI zero; gross-up in taxable income. */
export function test_BC_2026_eligible_dividends_only() {
  const r = compute(baseInput({ employmentIncome: 0, eligibleDividends: 10000 }));
  assertApprox(r.totals.cpp, 0, 0, 'cpp');
  assertApprox(r.totals.taxableIncome, 13800, TOL, 'grossed-up dividends');
}

function runAll() {
  const tests = [
    ['BC 2025 employment $85k (form trace)', test_BC_2025_employment_85k],
    ['BC 2026 employment $85k (form trace)', test_BC_2026_employment_85k],
    ['BC 2026 below YMPE', test_BC_2026_below_ympe],
    ['BC 2026 between YMPE and YAMPE', test_BC_2026_between_ympe_yampe],
    ['BC 2026 at YAMPE', test_BC_2026_at_yampe],
    ['BC 2026 federal bracket threshold', test_BC_2026_federal_bracket_threshold],
    ['BC 2026 provincial bracket threshold', test_BC_2026_provincial_bracket_threshold],
    ['BC 2026 no CPP/EI', test_BC_2026_no_payroll],
    ['BC 2026 RRSP deduction', test_BC_2026_rrsp_deduction],
    ['BC 2026 eligible dividends only', test_BC_2026_eligible_dividends_only],
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
  console.log(`\nCRA CPP vectors: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

const executedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (executedDirectly) runAll();
