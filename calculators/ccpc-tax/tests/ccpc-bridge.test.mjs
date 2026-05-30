/**
 * CCPC bridge regression tests (corporate taxable income vs salary / employer CPP).
 * Run from repo root: node --test calculators/ccpc-tax/tests/ccpc-bridge.test.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test, before } from 'node:test';

import { loadTaxData } from '../../canada-income-tax/js/tax.data.js';
import { computePersonalTax } from '../../canada-income-tax/js/tax.engine.js';
import { applyCorporateTaxDataSnapshot } from '../js/corporate.data.js';
import { computeCCPCTax } from '../js/ccpc.bridge.js';
import { employerCppForT4Employment } from '../js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CCPC_DATA_ROOT = join(__dirname, '..', 'data');
const PERSONAL_DATA_ROOT = join(__dirname, '..', '..', 'canada-income-tax', 'data');

async function loadYear(year) {
  await loadTaxData(year, { fsDataRoot: PERSONAL_DATA_ROOT });

  const data = join(CCPC_DATA_ROOT, String(year));
  const federalCorp = JSON.parse(readFileSync(join(data, 'federal-corporate.json'), 'utf8'));
  const provincesCorp = JSON.parse(readFileSync(join(data, 'provinces-corporate.json'), 'utf8'));
  applyCorporateTaxDataSnapshot({ federal: federalCorp, provinces: provincesCorp });
}

before(async () => {
  await loadYear(2025);
});

const ON = 'ON';

test('A: no salary, no dividends — corporate taxable equals pre-compensation income', () => {
  const r = computeCCPCTax({
    province: ON,
    grossRevenue: 180_000,
    expenses: 30_000,
    salary: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  assert.equal(r.corporate.corporateIncomeBeforeCompensation, 150_000);
  assert.equal(r.corporate.taxableIncome, 150_000);
  assert.equal(r.corporate.salaryExpense, 0);
  assert.equal(r.corporate.employerCppExpense, 0);
});

test('B: salary only — salary and employer CPP reduce corporate taxable income; employee CPP stays personal', () => {
  const base = computeCCPCTax({
    province: ON,
    grossRevenue: 400_000,
    expenses: 100_000,
    salary: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  const withSalary = computeCCPCTax({
    province: ON,
    grossRevenue: 400_000,
    expenses: 100_000,
    salary: 80_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  const empCpp = employerCppForT4Employment(80_000);
  assert.equal(withSalary.corporate.corporateIncomeBeforeCompensation, 300_000);
  assert.equal(withSalary.corporate.salaryExpense, 80_000);
  assert.equal(withSalary.corporate.employerCppExpense, empCpp);
  assert.equal(
    withSalary.corporate.taxableIncome,
    Math.max(0, 300_000 - 80_000 - empCpp)
  );
  assert.ok(withSalary.corporate.taxableIncome < base.corporate.taxableIncome);
  assert.ok(withSalary.personal.cpp > 0);
  assert.equal(withSalary.corporate.employerCppExpense, withSalary.personal.cpp);
});

test('C: salary plus dividends — comp deductions before corp tax; dividends from after-tax corp cash only', () => {
  const gross = 500_000;
  const exp = 200_000;
  const salary = 100_000;
  const elig = 40_000;
  const nonElig = 10_000;
  const r = computeCCPCTax({
    province: ON,
    grossRevenue: gross,
    expenses: exp,
    salary,
    eligibleDividends: elig,
    nonEligibleDividends: nonElig
  });
  const pre = gross - exp;
  const empCpp = employerCppForT4Employment(salary);
  const expectedTi = Math.max(0, pre - salary - empCpp);
  assert.equal(r.corporate.corporateIncomeBeforeCompensation, pre);
  assert.equal(r.corporate.taxableIncome, expectedTi);
  assert.equal(r.corporate.dividendDistributions, elig + nonElig);
  const afterTax = r.combined.afterTaxCorporateCash;
  assert.equal(r.combined.retainedEarnings, Math.max(0, afterTax - elig - nonElig));
});

test('D: high salary — corporate taxable income and corporate tax do not go negative', () => {
  const r = computeCCPCTax({
    province: ON,
    grossRevenue: 250_000,
    expenses: 50_000,
    salary: 500_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  assert.equal(r.corporate.taxableIncome, 0);
  assert.equal(r.corporate.totalCorporateTax, 0);
  assert.ok(r.corporate.totalCorporateTax >= 0);
});

test('E: CPP threshold — employer CPP tracks payroll rules; corporate deduction is employer side only', () => {
  const belowYmpe = 71_200;
  const aboveYmpe = 72_000;
  const empLow = employerCppForT4Employment(belowYmpe);
  const empHigh = employerCppForT4Employment(aboveYmpe);
  assert.ok(empHigh > empLow);

  const rLow = computeCCPCTax({
    province: ON,
    grossRevenue: 200_000,
    expenses: 50_000,
    salary: belowYmpe,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  const rHigh = computeCCPCTax({
    province: ON,
    grossRevenue: 200_000,
    expenses: 50_000,
    salary: aboveYmpe,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  assert.equal(rLow.corporate.employerCppExpense, empLow);
  assert.equal(rHigh.corporate.employerCppExpense, empHigh);
  assert.ok(rHigh.corporate.taxableIncome < rLow.corporate.taxableIncome);
  assert.equal(rLow.personal.cpp, empLow);
  assert.equal(rHigh.personal.cpp, empHigh);
});

test('F: monotonicity — more salary does not leave corporate taxable unchanged; more employer CPP does not increase TI', () => {
  const base = computeCCPCTax({
    province: ON,
    grossRevenue: 300_000,
    expenses: 40_000,
    salary: 50_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  const moreSalary = computeCCPCTax({
    province: ON,
    grossRevenue: 300_000,
    expenses: 40_000,
    salary: 120_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  assert.ok(moreSalary.corporate.taxableIncome < base.corporate.taxableIncome);

  const cpp50 = employerCppForT4Employment(50_000);
  const cpp120 = employerCppForT4Employment(120_000);
  assert.ok(cpp120 >= cpp50);
});

test('Income splitting: combined salaries and per-shareholder employer CPP reduce corporate TI', () => {
  const s1 = 60_000;
  const s2 = 40_000;
  const split = computeCCPCTax({
    province: ON,
    grossRevenue: 400_000,
    expenses: 80_000,
    incomeSplitting: true,
    shareholder1: { salary: s1, eligibleDividends: 0, nonEligibleDividends: 0, otherIncome: 0, deductions: 0 },
    shareholder2: { salary: s2, eligibleDividends: 0, nonEligibleDividends: 0, otherIncome: 0, deductions: 0 }
  });
  const expectedEmployerCpp = employerCppForT4Employment(s1) + employerCppForT4Employment(s2);
  const pre = 400_000 - 80_000;
  assert.equal(split.corporate.salaryExpense, s1 + s2);
  assert.equal(split.corporate.employerCppExpense, expectedEmployerCpp);
  assert.equal(split.corporate.taxableIncome, Math.max(0, pre - s1 - s2 - expectedEmployerCpp));
  assert.equal(split.personal1.cpp + split.personal2.cpp, expectedEmployerCpp);
});

test('Income splitting: shareholder personal tax matches canonical personal engine', async () => {
  await loadYear(2026);

  const shareholderInput = {
    year: 2026,
    province: ON,
    employmentIncome: 0,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 240_000,
    capitalGains: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0
  };

  const canonical = computePersonalTax(shareholderInput);
  const ccpc = computeCCPCTax({
    year: 2026,
    province: ON,
    grossRevenue: 700_000,
    expenses: 0,
    incomeSplitting: true,
    shareholder1: {
      salary: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 240_000,
      otherIncome: 0,
      deductions: 0
    },
    shareholder2: {
      salary: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      otherIncome: 0,
      deductions: 0
    }
  });

  assert.equal(ccpc.personal1.totalIncomeTax, canonical.totals.totalIncomeTax);
  assert.equal(Math.round(ccpc.personal1.totalIncomeTax), 69_679);
});
