/**
 * Income-tested benefits — CRA worked examples and edge cases.
 *
 * Sources (concise):
 * - CCB Martha / Fatima / Julie / Kira examples:
 *   https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/how-much.html
 *   (July 2026–June 2027 payment period; 2025 AFNI)
 * - CGEB / GST/HST payment amounts (2025 base year):
 *   https://www.canada.ca/en/revenue-agency/services/child-family-benefits/goods-services-tax-harmonized-sales-tax-gst-hst-credit/goods-services-tax-harmonized-sales-tax-gst-hst-credit-payment-amounts-tax-year-2016.html
 * - CWB Schedule 6 (2025):
 *   https://www.canada.ca/en/revenue-agency/services/forms-publications/tax-packages-years/general-income-tax-benefit-package/5000-s6.html
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTaxDataBundle } from '../js/tax.data.js';
import {
  computePersonalTax,
  compareIncomeReduction,
} from '../js/tax.engine.js';
import {
  calculateGstHstCredit,
  calculateCanadaWorkersBenefit,
  calculateCanadaChildBenefit,
  calculateIncomeTestedBenefits,
  computeIncomeMeasures,
  resolveBenefitsDataForCalculation,
  CURRENT_RULES_PROJECTION_METHOD,
  FUTURE_BENEFIT_PROJECTION_DISCLOSURE,
} from '../js/tax.benefits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAX_DATA_ROOT = path.join(__dirname, '..', 'data');

const TOL = 0.02; // nearest cent

function approx(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= TOL,
    `${label}: expected ${expected}, got ${actual}`
  );
}

const taxData2025 = await getTaxDataBundle(2025, { fsDataRoot: TAX_DATA_ROOT });
const taxData2026 = await getTaxDataBundle(2026, { fsDataRoot: TAX_DATA_ROOT });
const benefits2025 = taxData2025.benefits;

test('benefits.json loads for 2025 and 2026; raw 2026 CCB/CGEB unpublished', () => {
  assert.ok(taxData2025.benefits);
  assert.ok(taxData2026.benefits);
  assert.ok(taxData2026.benefitsByYear?.[2025]);
  assert.equal(taxData2025.benefits.gstHstCredit.available, true);
  assert.equal(taxData2026.benefits.gstHstCredit.available, false);
  assert.equal(taxData2026.benefits.canadaChildBenefit.available, false);
  assert.equal(taxData2026.benefits.canadaWorkersBenefit.available, true);
});

test('regression: ON 2025 $160k employment tax unchanged when benefits present', () => {
  const withoutBenefits = computePersonalTax(
    { year: 2025, province: 'ON', employmentIncome: 160000 },
    { taxData: taxData2025, skipBenefits: true, skipMarginalRateCalculation: true }
  );
  const withBenefits = computePersonalTax(
    { year: 2025, province: 'ON', employmentIncome: 160000 },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );
  assert.equal(withBenefits.totals.totalIncomeTax, withoutBenefits.totals.totalIncomeTax);
  assert.equal(withBenefits.totals.federalTax, withoutBenefits.totals.federalTax);
  assert.equal(withBenefits.totals.provTax, withoutBenefits.totals.provTax);
  // High income: benefits phased out
  assert.equal(withBenefits.totals.incomeTestedBenefitsTotal, 0);
});

test('CCB CRA example: Martha, one child under 6, AFNI $45,000 → $7,683.59', () => {
  // Source: CRA CCB how-much page (July 2026–June 2027 / 2025 AFNI)
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 45000,
    household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [3] },
  });
  const result = calculateCanadaChildBenefit({
    params: benefits2025.canadaChildBenefit,
    household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [3] },
    incomeMeasures,
  });
  approx(result.annualAmount, 7683.59, 'Martha CCB');
});

test('CCB CRA example: Martha tier 2, AFNI $100,000 → $4,485.11', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 100000,
    household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [4] },
  });
  const result = calculateCanadaChildBenefit({
    params: benefits2025.canadaChildBenefit,
    household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [4] },
    incomeMeasures,
  });
  approx(result.annualAmount, 4485.11, 'Martha CCB tier 2');
});

test('CCB CRA example: Fatima, two children under 6, AFNI $60,000 → $13,376.00', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 60000,
    household: { maritalStatus: 'single', numberOfChildren: 2, childAges: [2, 4] },
  });
  const result = calculateCanadaChildBenefit({
    params: benefits2025.canadaChildBenefit,
    household: { maritalStatus: 'single', numberOfChildren: 2, childAges: [2, 4] },
    incomeMeasures,
  });
  approx(result.annualAmount, 13376.0, 'Fatima CCB');
});

test('CCB CRA example: Fatima tier 2, AFNI $125,000 → $7,889.28', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 125000,
    household: { maritalStatus: 'married', spouseNetIncome: 0, numberOfChildren: 2, childAges: [1, 3] },
  });
  const result = calculateCanadaChildBenefit({
    params: benefits2025.canadaChildBenefit,
    household: { maritalStatus: 'married', spouseNetIncome: 0, numberOfChildren: 2, childAges: [1, 3] },
    incomeMeasures,
  });
  approx(result.annualAmount, 7889.28, 'Fatima CCB tier 2');
});

test('CCB CRA example: Julie, three children 6–17, AFNI $50,000 → $18,414.03', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 50000,
    household: { maritalStatus: 'single', numberOfChildren: 3, childAges: [8, 10, 12] },
  });
  const result = calculateCanadaChildBenefit({
    params: benefits2025.canadaChildBenefit,
    household: { maritalStatus: 'single', numberOfChildren: 3, childAges: [8, 10, 12] },
    incomeMeasures,
  });
  approx(result.annualAmount, 18414.03, 'Julie CCB');
});

test('CCB CRA example: Kira, four children 6–17, AFNI $45,000 → $25,976.51', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 45000,
    household: { maritalStatus: 'single', numberOfChildren: 4, childAges: [7, 9, 11, 13] },
  });
  const result = calculateCanadaChildBenefit({
    params: benefits2025.canadaChildBenefit,
    household: { maritalStatus: 'single', numberOfChildren: 4, childAges: [7, 9, 11, 13] },
    incomeMeasures,
  });
  approx(result.annualAmount, 25976.51, 'Kira CCB');
});

test('GST/CGEB: single, no children, AFNI at phase-out threshold keeps full phased-in credit', () => {
  // Base year 2025 amounts from CRA payment-amounts table
  const params = benefits2025.gstHstCredit;
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: params.phaseOutThreshold,
    household: { maritalStatus: 'single' },
  });
  // At AFNI = threshold, reduction = 0. Single at high enough income for full single supplement:
  // phase-in of supplement: 2% × (ANI − 11564), capped at 234.
  // At 46432: 2% × (46432−11564) = 697.36 → capped at 234.
  // Preliminary = 445 + 234 = 679; reduction = 0 → 679
  const result = calculateGstHstCredit({
    params,
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  approx(result.annualAmount, 679, 'single at threshold');
});

test('GST/CGEB: $1 above phase-out reduces by 5 cents', () => {
  const params = benefits2025.gstHstCredit;
  const afni = params.phaseOutThreshold + 1;
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: afni,
    household: { maritalStatus: 'single' },
  });
  const result = calculateGstHstCredit({
    params,
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  approx(result.annualAmount, 679 - 0.05, 'single $1 above threshold');
});

test('GST/CGEB: couple no children fully phased out at high AFNI', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 100000,
    household: { maritalStatus: 'married', spouseNetIncome: 0 },
  });
  const result = calculateGstHstCredit({
    params: benefits2025.gstHstCredit,
    household: { maritalStatus: 'married', spouseNetIncome: 0 },
    incomeMeasures,
  });
  assert.equal(result.annualAmount, 0);
});

test('CWB: single reaches maximum basic before phase-out', () => {
  // Working income $10,000 → (10000−3000)×27% = 1890, capped at 1633; AFNI $10,000 < 26855
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 10000,
    household: { maritalStatus: 'single' },
    incomeComponents: { employmentIncome: 10000 },
    cwbParams: benefits2025.canadaWorkersBenefit,
  });
  const result = calculateCanadaWorkersBenefit({
    params: benefits2025.canadaWorkersBenefit,
    province: 'ON',
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  approx(result.annualAmount, 1633, 'CWB maximum basic');
});

test('CWB: single at working income $8,000 nets phase-in only', () => {
  // (8000-3000)*0.27 = 1350; AFNI 8000 < phase-out → 1350
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 8000,
    household: { maritalStatus: 'single' },
    incomeComponents: { employmentIncome: 8000 },
    cwbParams: benefits2025.canadaWorkersBenefit,
  });
  const result = calculateCanadaWorkersBenefit({
    params: benefits2025.canadaWorkersBenefit,
    province: 'ON',
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  approx(result.annualAmount, 1350, 'CWB phase-in');
});

test('CWB: single phase-out region', () => {
  // WI high enough for max 1633; AFNI 30000 → excess 30000-26855=3145 × 15% = 471.75 → 1633-471.75 = 1161.25
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 30000,
    household: { maritalStatus: 'single' },
    incomeComponents: { employmentIncome: 30000 },
    cwbParams: benefits2025.canadaWorkersBenefit,
  });
  const result = calculateCanadaWorkersBenefit({
    params: benefits2025.canadaWorkersBenefit,
    province: 'ON',
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  approx(result.annualAmount, 1161.25, 'CWB phase-out');
});

test('CWB: fully phased out at end threshold', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 37742,
    household: { maritalStatus: 'single' },
    incomeComponents: { employmentIncome: 37742 },
    cwbParams: benefits2025.canadaWorkersBenefit,
  });
  const result = calculateCanadaWorkersBenefit({
    params: benefits2025.canadaWorkersBenefit,
    province: 'ON',
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  approx(result.annualAmount, 0, 'CWB at phase-out end');
});

test('CWB: QC excluded', () => {
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 20000,
    household: { maritalStatus: 'single' },
    incomeComponents: { employmentIncome: 20000 },
    cwbParams: benefits2025.canadaWorkersBenefit,
  });
  const result = calculateCanadaWorkersBenefit({
    params: benefits2025.canadaWorkersBenefit,
    province: 'QC',
    household: { maritalStatus: 'single' },
    incomeMeasures,
  });
  assert.equal(result.available, false);
  assert.equal(result.annualAmount, 0);
});

test('CWB: married two incomes uses secondary earner exemption', () => {
  const household = {
    maritalStatus: 'married',
    spouseNetIncome: 15000,
    spouseEmploymentIncome: 15000,
  };
  const incomeMeasures = computeIncomeMeasures({
    individualNetIncome: 20000,
    household,
    incomeComponents: {
      employmentIncome: 20000,
      spouseEmploymentIncome: 15000,
    },
    cwbParams: benefits2025.canadaWorkersBenefit,
  });
  assert.ok(incomeMeasures.secondaryEarnerExemption > 0);
  assert.ok(incomeMeasures.cwbAdjustedFamilyNetIncome < incomeMeasures.adjustedFamilyNetIncome);
});

test('no tax payable but GST/CGEB remains', () => {
  const result = computePersonalTax(
    {
      year: 2025,
      province: 'ON',
      employmentIncome: 12000,
      household: { maritalStatus: 'single' },
    },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );
  assert.equal(result.totals.totalIncomeTax, 0);
  assert.ok(result.totals.incomeTestedBenefitsTotal > 0);
  assert.ok(result.benefits.programs.gstHstCredit.annualAmount > 0);
});

test('compareIncomeReduction: RRSP-like deduction increases benefits near CCB threshold', () => {
  const baselineInput = {
    year: 2025,
    province: 'ON',
    employmentIncome: 50000,
    household: {
      maritalStatus: 'married',
      spouseNetIncome: 0,
      numberOfChildren: 1,
      childAges: [3],
    },
  };
  const delta = compareIncomeReduction({
    baselineInput,
    deductionAmount: 1000,
    deductionField: 'rrspDeduction',
    taxData: taxData2025,
  });
  assert.ok(delta.taxSavings >= 0);
  assert.ok(delta.additionalBenefits > 0, 'CCB should increase when AFNI falls in tier 1');
  assert.ok(delta.totalEconomicValue > delta.taxSavings);
  assert.ok(delta.effectiveValueRate > 0);
});

test('edge: negative / invalid incomes treated as zero', () => {
  const result = calculateIncomeTestedBenefits({
    taxYear: 2025,
    province: 'ON',
    individualNetIncome: -5000,
    household: { maritalStatus: 'single', spouseNetIncome: -100 },
    incomeComponents: { employmentIncome: -200 },
    benefitsData: benefits2025,
  });
  assert.equal(result.incomeMeasures.individualNetIncome, 0);
  assert.equal(result.incomeMeasures.familyWorkingIncome, 0);
});

test('edge: very high income zeros benefits', () => {
  const result = computePersonalTax(
    {
      year: 2025,
      province: 'BC',
      employmentIncome: 500000,
      household: { maritalStatus: 'married', spouseNetIncome: 100000, numberOfChildren: 2, childAges: [2, 8] },
    },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );
  assert.equal(result.totals.incomeTestedBenefitsTotal, 0);
});

test('tax year 2026: CWB published; CCB/CGEB use projected current-rules (not zero)', () => {
  const result = computePersonalTax(
    {
      year: 2026,
      province: 'ON',
      employmentIncome: 20000,
      household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [4] },
    },
    { taxData: taxData2026, skipMarginalRateCalculation: true }
  );

  const cwb = result.benefits.programs.canadaWorkersBenefit;
  const ccb = result.benefits.programs.canadaChildBenefit;
  const gst = result.benefits.programs.gstHstCredit;

  assert.equal(cwb.available, true);
  assert.equal(cwb.projected, false);
  assert.ok(cwb.annualAmount > 0);

  assert.equal(ccb.available, true);
  assert.equal(ccb.projected, true);
  assert.equal(ccb.targetTaxYear, 2026);
  assert.equal(ccb.basisTaxYear, 2025);
  assert.equal(ccb.basisBenefitYear, 2025);
  assert.equal(ccb.projectionMethod, CURRENT_RULES_PROJECTION_METHOD);
  assert.ok(ccb.annualAmount > 0, 'projected CCB must not be zero/unavailable');

  assert.equal(gst.available, true);
  assert.equal(gst.projected, true);
  assert.equal(gst.basisTaxYear, 2025);
  assert.ok(gst.annualAmount > 0, 'projected CGEB must not be zero/unavailable');

  assert.equal(result.benefits.metadata.anyProjected, true);
  assert.equal(result.benefits.metadata.projectionDisclosure, FUTURE_BENEFIT_PROJECTION_DISCLOSURE);
  assert.ok(result.totals.incomeTestedBenefitsTotal > 0);
});

test('projected 2026 CCB matches latest published (2025) params on same AFNI', () => {
  const household = { maritalStatus: 'single', numberOfChildren: 1, childAges: [3] };
  const published = calculateIncomeTestedBenefits({
    taxYear: 2025,
    province: 'ON',
    individualNetIncome: 45000,
    household,
    incomeComponents: { employmentIncome: 45000 },
    benefitsData: benefits2025,
    benefitsByYear: taxData2025.benefitsByYear,
  });
  const projected = calculateIncomeTestedBenefits({
    taxYear: 2026,
    province: 'ON',
    individualNetIncome: 45000,
    household,
    incomeComponents: { employmentIncome: 45000 },
    benefitsData: taxData2026.benefits,
    benefitsByYear: taxData2026.benefitsByYear,
  });

  assert.equal(published.programs.canadaChildBenefit.projected, false);
  assert.equal(projected.programs.canadaChildBenefit.projected, true);
  approx(
    projected.programs.canadaChildBenefit.annualAmount,
    published.programs.canadaChildBenefit.annualAmount,
    'projected CCB uses 2025 published dollars'
  );
  approx(
    projected.programs.gstHstCredit.annualAmount,
    published.programs.gstHstCredit.annualAmount,
    'projected CGEB uses 2025 published dollars'
  );
});

test('resolveBenefitsDataForCalculation distinguishes published vs projected', () => {
  const resolved = resolveBenefitsDataForCalculation({
    targetTaxYear: 2026,
    benefitsData: taxData2026.benefits,
    benefitsByYear: taxData2026.benefitsByYear,
  });
  assert.equal(resolved.anyProjected, true);
  assert.equal(resolved.programResolution.canadaWorkersBenefit.projected, false);
  assert.equal(resolved.programResolution.canadaChildBenefit.projected, true);
  assert.equal(resolved.programResolution.gstHstCredit.basisTaxYear, 2025);
  assert.equal(
    resolved.resolvedBenefits.canadaChildBenefit.maxUnder6,
    benefits2025.canadaChildBenefit.maxUnder6
  );
  assert.equal(
    resolved.resolvedBenefits.gstHstCredit.adultAmount,
    benefits2025.gstHstCredit.adultAmount
  );
});

test('tax year 2025 remains fully published (not projected)', () => {
  const result = computePersonalTax(
    {
      year: 2025,
      province: 'ON',
      employmentIncome: 20000,
      household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [4] },
    },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );
  assert.equal(result.benefits.metadata.anyProjected, false);
  assert.equal(result.benefits.programs.canadaChildBenefit.projected, false);
  assert.equal(result.benefits.programs.gstHstCredit.projected, false);
  assert.equal(result.benefits.programs.canadaWorkersBenefit.projected, false);
});

test('province change does not alter federal CCB formula', () => {
  const mk = (province) =>
    calculateIncomeTestedBenefits({
      taxYear: 2025,
      province,
      individualNetIncome: 45000,
      household: { maritalStatus: 'single', numberOfChildren: 1, childAges: [3] },
      incomeComponents: { employmentIncome: 45000 },
      benefitsData: benefits2025,
    });
  approx(mk('ON').programs.canadaChildBenefit.annualAmount, 7683.59, 'ON');
  approx(mk('BC').programs.canadaChildBenefit.annualAmount, 7683.59, 'BC');
});
