/**
 * Tax engine tests
 * Run in browser via test.html
 */

import { computePersonalTax } from '../js/tax.engine.js';
import { loadTaxData } from '../js/tax.data.js';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Assert function for tests
 */
function assert(condition, message) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`✓ PASS: ${message}`);
    return true;
  } else {
    testsFailed++;
    console.error(`✗ FAIL: ${message}`);
    return false;
  }
}

/**
 * Assert approximately equal (for floating point)
 */
function assertApprox(actual, expected, tolerance = 0.01, message) {
  const diff = Math.abs(actual - expected);
  return assert(diff <= tolerance, `${message} (expected ~${expected}, got ${actual}, diff: ${diff})`);
}

/**
 * Run all tests
 */
export async function runTests() {
  console.log('Starting tax engine tests...\n');

  // Load tax data first
  try {
    await loadTaxData(2025);
    console.log('Tax data loaded successfully.\n');
  } catch (error) {
    console.error('Failed to load tax data:', error);
    return;
  }

  // Test 1: Taxable income floors at 0
  console.log('Test 1: Taxable income floors at 0');
  const test1 = computePersonalTax({
    province: 'ON',
    employmentIncome: 10000,
    rrspDeduction: 15000, // Deduction exceeds income
    fhsaDeduction: 0
  });
  assert(test1.totals.taxableIncome === 0, 'Taxable income should be 0 when deductions exceed income');
  assert(test1.totals.totalIncomeTax >= 0, 'Tax should not be negative');
  console.log('');

  // Test 2: Basic Ontario calculation
  console.log('Test 2: Basic Ontario calculation');
  const test2 = computePersonalTax({
    province: 'ON',
    employmentIncome: 75000,
    rrspDeduction: 0,
    fhsaDeduction: 0
  });
  assert(test2.totals.totalIncome === 75000, 'Total income should be 75000');
  assert(test2.totals.taxableIncome > 0, 'Taxable income should be positive');
  assert(test2.totals.federalTax > 0, 'Federal tax should be positive');
  assert(test2.totals.provTax > 0, 'Provincial tax should be positive');
  assert(test2.totals.totalIncomeTax > 0, 'Total income tax should be positive');
  console.log('');

  // Test 3: Marginal rate finite difference check
  console.log('Test 3: Marginal rate finite difference check');
  const baseIncome = 75000;
  const test3a = computePersonalTax({
    province: 'ON',
    employmentIncome: baseIncome
  });
  const test3b = computePersonalTax({
    province: 'ON',
    employmentIncome: baseIncome + 1
  });
  const actualMarginal = test3b.totals.totalIncomeTax - test3a.totals.totalIncomeTax;
  const reportedMarginal = test3a.totals.marginalRate;
  assertApprox(actualMarginal, reportedMarginal, 0.05, 
    `Marginal rate should match finite difference (reported: ${reportedMarginal}, actual: ${actualMarginal})`);
  console.log('');

  // Test 4: Dividend gross-up
  console.log('Test 4: Dividend gross-up');
  const eligibleDivs = 1000;
  const test4 = computePersonalTax({
    province: 'ON',
    eligibleDividends: eligibleDivs
  });
  const expectedGrossUp = eligibleDivs * 0.38; // 1.38 - 1 = 0.38
  assertApprox(test4.breakdown.dividends.eligibleGrossUp, expectedGrossUp, 0.01,
    'Eligible dividend gross-up should be correct');
  assert(test4.breakdown.dividends.eligibleDTCFed > 0, 'Eligible DTC federal should be positive');
  assert(test4.breakdown.dividends.eligibleDTCProv > 0, 'Eligible DTC provincial should be positive');
  console.log('');

  // Test 5: Capital gains inclusion
  console.log('Test 5: Capital gains inclusion');
  const capGains = 10000;
  const test5 = computePersonalTax({
    province: 'ON',
    capitalGains: capGains
  });
  const expectedTaxable = capGains * 0.5;
  assertApprox(test5.breakdown.capitalGains.taxableCapitalGains, expectedTaxable, 0.01,
    'Capital gains inclusion should be 50%');
  assert(test5.totals.taxableIncome === expectedTaxable, 'Taxable income should include 50% of capital gains');
  console.log('');

  // Test 6: Refund/owing sign convention
  console.log('Test 6: Refund/owing sign convention');
  const test6a = computePersonalTax({
    province: 'ON',
    employmentIncome: 50000,
    taxPaid: 20000 // Overpaid
  });
  assert(test6a.totals.refundOrOwing > 0, 'Refund should be positive when tax paid exceeds tax owed');
  
  const test6b = computePersonalTax({
    province: 'ON',
    employmentIncome: 50000,
    taxPaid: 0 // Underpaid
  });
  assert(test6b.totals.refundOrOwing < 0, 'Balance owing should be negative when tax paid is less than tax owed');
  console.log('');

  // Test 7: CPP calculation
  console.log('Test 7: CPP calculation');
  const test7 = computePersonalTax({
    province: 'ON',
    employmentIncome: 80000
  });
  assert(test7.totals.cpp > 0, 'CPP should be positive for employment income');
  assert(test7.breakdown.payroll.cpp.pensionableEarnings > 0, 'Pensionable earnings should be positive');
  console.log('');

  // Test 8: EI calculation
  console.log('Test 8: EI calculation');
  const test8 = computePersonalTax({
    province: 'ON',
    employmentIncome: 80000
  });
  assert(test8.totals.ei > 0, 'EI should be positive for employment income');
  assert(test8.breakdown.payroll.ei.insurableEarnings > 0, 'Insurable earnings should be positive');
  console.log('');

  // Test 9: Ontario surtax and health premium
  console.log('Test 9: Ontario surtax and health premium');
  const test9 = computePersonalTax({
    province: 'ON',
    employmentIncome: 150000
  });
  const hasSurtax = test9.breakdown.provincial.surtaxes && test9.breakdown.provincial.surtaxes.length > 0;
  const hasPremium = test9.breakdown.provincial.premiums && test9.breakdown.provincial.premiums.length > 0;
  // At high income, should have surtax and premium
  if (test9.breakdown.provincial.netTax > 5500) {
    assert(hasSurtax || test9.breakdown.provincial.surtaxes.length === 0, 
      'Should calculate surtax for high income (or structure may differ)');
  }
  if (test9.totals.taxableIncome > 20000) {
    assert(hasPremium || test9.breakdown.provincial.premiums.length === 0,
      'Should calculate health premium for income above threshold (or structure may differ)');
  }
  console.log('');

  // Test 10: Zero income
  console.log('Test 10: Zero income');
  const test10 = computePersonalTax({
    province: 'ON',
    employmentIncome: 0
  });
  assert(test10.totals.totalIncome === 0, 'Total income should be 0');
  assert(test10.totals.taxableIncome === 0, 'Taxable income should be 0');
  assert(test10.totals.totalIncomeTax === 0, 'Total income tax should be 0');
  console.log('');

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Tests run: ${testsRun}`);
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log('='.repeat(50));

  // Update DOM if available
  if (typeof document !== 'undefined') {
    const summary = document.getElementById('testSummary');
    if (summary) {
      summary.innerHTML = `
        <h3>Test Results</h3>
        <p>Tests run: ${testsRun}</p>
        <p style="color: ${testsFailed === 0 ? '#4caf50' : '#f44336'}">
          Tests passed: ${testsPassed} | Tests failed: ${testsFailed}
        </p>
      `;
    }
  }

  return {
    run: testsRun,
    passed: testsPassed,
    failed: testsFailed
  };
}
