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
  // Grossed-up non-eligible dividends push net income above the federal BPA
  // phase-out end, so the minimum BPA applies (higher federal tax than max-BPA snapshots).
  assert.equal(Math.round(ccpc.personal1.totalIncomeTax), 69_910);
});

test('RRSP contribution reduces personal taxable income and personal tax', () => {
  const base = {
    province: ON,
    grossRevenue: 400_000,
    expenses: 100_000,
    salary: 120_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    personalOtherIncome: 0,
    personalDeductions: 0
  };
  const withoutRrsp = computeCCPCTax({ ...base, rrspContribution: 0 });
  const withRrsp = computeCCPCTax({ ...base, rrspContribution: 20_000 });

  assert.equal(withRrsp.personal.taxableIncome, withoutRrsp.personal.taxableIncome - 20_000);
  assert.ok(withRrsp.personal.totalIncomeTax < withoutRrsp.personal.totalIncomeTax);
  assert.equal(withRrsp.corporate.taxableIncome, withoutRrsp.corporate.taxableIncome);
});

test('Legacy rrspDeduction input still maps to current-year personal deduction', () => {
  const viaContribution = computeCCPCTax({
    province: ON,
    grossRevenue: 300_000,
    expenses: 50_000,
    salary: 100_000,
    rrspContribution: 15_000
  });
  const viaLegacy = computeCCPCTax({
    province: ON,
    grossRevenue: 300_000,
    expenses: 50_000,
    salary: 100_000,
    rrspDeduction: 15_000
  });
  assert.equal(viaContribution.personal.taxableIncome, viaLegacy.personal.taxableIncome);
  assert.equal(viaContribution.personal.totalIncomeTax, viaLegacy.personal.totalIncomeTax);
});

test('FHSA deduction reduces personal taxable income and personal tax', () => {
  const base = {
    province: ON,
    grossRevenue: 400_000,
    expenses: 100_000,
    salary: 120_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    personalOtherIncome: 0,
    personalDeductions: 0
  };
  const withoutFhsa = computeCCPCTax({ ...base, fhsaDeduction: 0 });
  const withFhsa = computeCCPCTax({ ...base, fhsaDeduction: 8_000 });

  assert.equal(withFhsa.personal.taxableIncome, withoutFhsa.personal.taxableIncome - 8_000);
  assert.ok(withFhsa.personal.totalIncomeTax < withoutFhsa.personal.totalIncomeTax);
  assert.equal(withFhsa.corporate.taxableIncome, withoutFhsa.corporate.taxableIncome);
});

test('Capital gains increase personal taxable income by the 50% inclusion amount', () => {
  const base = {
    province: ON,
    grossRevenue: 400_000,
    expenses: 100_000,
    salary: 80_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    personalOtherIncome: 0,
    personalDeductions: 0
  };
  const withoutGains = computeCCPCTax({ ...base, capitalGains: 0 });
  const withGains = computeCCPCTax({ ...base, capitalGains: 40_000 });

  assert.equal(withGains.personal.taxableIncome, withoutGains.personal.taxableIncome + 20_000);
  assert.ok(withGains.personal.totalIncomeTax > withoutGains.personal.totalIncomeTax);
  assert.equal(withGains.corporate.taxableIncome, withoutGains.corporate.taxableIncome);
});

test('Headline totalTaxBurden is corporate + personal income tax, excluding employee CPP/EI', () => {
  const r = computeCCPCTax({
    year: 2025,
    province: ON,
    grossRevenue: 150_000,
    expenses: 0,
    salary: 100_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  assert.equal(
    r.combined.totalTaxBurden,
    r.corporate.totalCorporateTax + r.personal.totalIncomeTax
  );
  assert.ok(r.combined.employeeCppEi > 0);
  assert.ok(r.combined.employerCppExpense > 0);
  assert.notEqual(r.combined.totalTaxBurden, r.corporate.totalCorporateTax + r.personal.totalBurden);
});

test('Salary above current-year corporate income is still taxed as paid and flagged', () => {
  const r = computeCCPCTax({
    year: 2025,
    province: ON,
    grossRevenue: 50_000,
    expenses: 0,
    salary: 100_000,
    eligibleDividends: 0,
    nonEligibleDividends: 0
  });
  assert.equal(r.corporate.taxableIncome, 0);
  assert.equal(r.corporate.totalCorporateTax, 0);
  assert.ok(r.personal.totalIncomeTax > 0);
  const salaryNote = (r.combined.fundingNotes || []).find(
    (n) => n.code === 'salary_exceeds_current_year_income'
  );
  assert.ok(salaryNote, 'expected salary funding note');
  assert.ok(salaryNote.compensationCost > 50_000);
});

test('Dividends above after-tax corporate cash clip retained earnings and are flagged', () => {
  const r = computeCCPCTax({
    year: 2025,
    province: ON,
    grossRevenue: 80_000,
    expenses: 0,
    salary: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 200_000
  });
  assert.equal(r.combined.retainedEarnings, 0);
  const divNote = (r.combined.fundingNotes || []).find(
    (n) => n.code === 'dividends_exceed_current_year_cash'
  );
  assert.ok(divNote, 'expected dividend funding note');
  assert.equal(divNote.dividendDistributions, 200_000);
  assert.ok(divNote.afterTaxCorporateCash < 200_000);
});
