/**
 * UI module for tax calculator
 * Handles DOM interactions, validation, and rendering
 */

import { computePersonalTax, compareIncomeReduction } from './tax.engine.js';
import { getTaxDataBundle, normalizeProvince } from './tax.data.js';
import { formatCurrency, formatPercent, parseInput } from './format.js';

const MARGINAL_DEDUCTION_PROBE = 1000;
let taxDataLoaded = false;
let taxDataBundle = null;
let taxDataRequestSeq = 0;
let latestTotals = null;
let latestSharePayload = null;

// Province codes in alphabetical order
const PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' }
];

/**
 * Initialize the UI
 */
export async function initUI() {
  // Populate province selector
  const provinceSelect = document.getElementById('province');
  if (!provinceSelect) {
    console.error('Province select element not found');
    return;
  }
  
  // Ensure select is enabled first
  provinceSelect.disabled = false;
  provinceSelect.removeAttribute('disabled');
  provinceSelect.removeAttribute('readonly');
  
  // Clear existing options
  while (provinceSelect.firstChild) {
    provinceSelect.removeChild(provinceSelect.firstChild);
  }
  
  // Add placeholder option
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Select...';
  provinceSelect.appendChild(placeholderOption);
  
  // Add all province options
  PROVINCES.forEach(prov => {
    const option = document.createElement('option');
    option.value = prov.code;
    option.textContent = prov.name;
    provinceSelect.appendChild(option);
  });

  // Set default year
  const yearSelect = document.getElementById('year');
  if (yearSelect) {
    yearSelect.value = '2026';
  }

  // Use setTimeout to ensure DOM is updated before setting value
  setTimeout(() => {
    // Set default province to Ontario (after options are added and DOM is updated)
    if (provinceSelect.options.length > 1) {
      provinceSelect.value = 'ON';
    }
    
    // Ensure select remains enabled and interactive
    provinceSelect.disabled = false;
    provinceSelect.removeAttribute('disabled');
    provinceSelect.removeAttribute('readonly');
    provinceSelect.setAttribute('tabindex', '0');
    provinceSelect.style.pointerEvents = 'auto';
    provinceSelect.style.cursor = 'pointer';
    provinceSelect.style.userSelect = 'auto';
    provinceSelect.style.webkitUserSelect = 'auto';
    provinceSelect.style.mozUserSelect = 'auto';
    
    // Force a reflow to ensure styles are applied
    void provinceSelect.offsetHeight;
  }, 0);

  // Load tax data
  try {
    taxDataBundle = await getTaxDataBundle(2026);
    taxDataLoaded = true;
  } catch (error) {
    console.error('Failed to load tax data:', error);
    showError('Failed to load tax data. Please refresh the page.');
    return;
  }

  // Attach event listeners
  attachEventListeners();
  wireShareButtons();
  syncHouseholdDisclosure();

  // Initial calculation (will trigger after data loads)
  calculate();
  
  // Update RRSP max value from data (after data is loaded)
  updateRRSPMaxValue();
}

/**
 * Attach event listeners to input fields
 */
function attachEventListeners() {
  // Text inputs get both input and change events
  const textInputs = document.querySelectorAll('input[type="text"]');
  textInputs.forEach(input => {
    // Ensure no artificial character-length truncation; validation is numeric/range-based.
    input.removeAttribute('maxlength');

    input.addEventListener('input', calculate);
    input.addEventListener('change', calculate);
  });

  // Select elements only get change events (they don't fire input events)
  const selects = document.querySelectorAll('select:not(#year)');
  selects.forEach(select => {
    select.addEventListener('change', calculate);
    // Ensure select is interactive
    select.style.pointerEvents = 'auto';
    select.style.cursor = 'pointer';
  });

  const yearSelect = document.getElementById('year');
  if (yearSelect) {
    yearSelect.addEventListener('change', async () => {
      const y = parseInt(yearSelect.value, 10) || 2026;
      const requestSeq = ++taxDataRequestSeq;
      try {
        taxDataLoaded = false;
        const bundle = await getTaxDataBundle(y);
        if (requestSeq !== taxDataRequestSeq) return;
        taxDataBundle = bundle;
        taxDataLoaded = true;
        updateRRSPMaxValue();
        calculate();
      } catch (error) {
        if (requestSeq !== taxDataRequestSeq) return;
        console.error('Failed to load tax data for year', y, error);
        showError('Failed to load tax data for the selected year. Please try again.');
      }
    });
  }

  // Reset button
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', resetAllInputs);
  }

  const maritalStatus = document.getElementById('maritalStatus');
  if (maritalStatus) {
    maritalStatus.addEventListener('change', () => {
      syncHouseholdDisclosure();
      calculate();
    });
  }

  const numberOfChildren = document.getElementById('numberOfChildren');
  if (numberOfChildren) {
    numberOfChildren.addEventListener('input', () => {
      syncHouseholdDisclosure();
      calculate();
    });
    numberOfChildren.addEventListener('change', () => {
      syncHouseholdDisclosure();
      calculate();
    });
  }
}

/**
 * Show/hide spouse and child-age fields based on household selections.
 */
function syncHouseholdDisclosure() {
  const marital = document.getElementById('maritalStatus')?.value || 'single';
  const isCouple = marital === 'married';
  const spouseIncomeField = document.getElementById('spouseIncomeField');
  const spouseWorkingIncomeField = document.getElementById('spouseWorkingIncomeField');
  if (spouseIncomeField) spouseIncomeField.hidden = !isCouple;
  if (spouseWorkingIncomeField) spouseWorkingIncomeField.hidden = !isCouple;

  const n = Math.max(0, Math.min(12, parseInt(document.getElementById('numberOfChildren')?.value, 10) || 0));
  const container = document.getElementById('childAgesContainer');
  const fields = document.getElementById('childAgeFields');
  if (!container || !fields) return;

  if (n <= 0) {
    container.hidden = true;
    fields.innerHTML = '';
    return;
  }

  container.hidden = false;
  const existing = {};
  fields.querySelectorAll('input[data-child-index]').forEach((input) => {
    existing[input.getAttribute('data-child-index')] = input.value;
  });
  fields.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const id = `childAge_${i}`;
    wrap.innerHTML = `
      <label for="${id}">Age of child ${i + 1}</label>
      <input type="number" id="${id}" data-child-index="${i}" min="0" max="18" step="1" value="${existing[String(i)] ?? '0'}" inputmode="numeric">
    `;
    const input = wrap.querySelector('input');
    input.addEventListener('input', calculate);
    input.addEventListener('change', calculate);
    fields.appendChild(wrap);
  }
}

/**
 * Reset all input fields to default/empty values
 */
function resetAllInputs() {
  const yearSelect = document.getElementById('year');
  const yearChanged = yearSelect?.value !== '2026';
  if (yearSelect) yearSelect.value = '2026';
  document.getElementById('province').value = 'ON';
  document.getElementById('employmentIncome').value = '';
  document.getElementById('selfEmploymentIncome').value = '';
  document.getElementById('otherIncome').value = '';
  document.getElementById('eligibleDividends').value = '';
  document.getElementById('nonEligibleDividends').value = '';
  document.getElementById('capitalGains').value = '';
  document.getElementById('rrspDeduction').value = '';
  document.getElementById('fhsaDeduction').value = '';
  document.getElementById('estimatedDeductions').value = '';
  document.getElementById('taxPaid').value = '';

  const maritalStatus = document.getElementById('maritalStatus');
  if (maritalStatus) maritalStatus.value = 'single';
  const spouseNetIncome = document.getElementById('spouseNetIncome');
  if (spouseNetIncome) spouseNetIncome.value = '';
  const spouseWorkingIncome = document.getElementById('spouseWorkingIncome');
  if (spouseWorkingIncome) spouseWorkingIncome.value = '';
  const numberOfChildren = document.getElementById('numberOfChildren');
  if (numberOfChildren) numberOfChildren.value = '0';
  syncHouseholdDisclosure();
  
  // Remove validation state
  const provinceSelect = document.getElementById('province');
  const provinceWarning = document.getElementById('provinceWarning');
  provinceSelect.classList.remove('is-invalid');
  if (provinceWarning) {
    provinceWarning.style.display = 'none';
  }
  
  // Clear results and recalculate
  clearResults();
  if (yearChanged && yearSelect) {
    yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    calculate();
  }
  
  // Clear breakdown sections
  document.getElementById('federalBrackets').innerHTML = '';
  document.getElementById('provincialBrackets').innerHTML = '';
  document.getElementById('dividendsBreakdown').innerHTML = '';
  document.getElementById('capitalGainsBreakdown').innerHTML = '';
  document.getElementById('payrollBreakdown').innerHTML = '';
  const benefitsBreakdown = document.getElementById('benefitsBreakdown');
  if (benefitsBreakdown) benefitsBreakdown.innerHTML = '';
}

/**
 * Get all input values from the form
 */
function getInputs() {
  const raw = {
    year: document.getElementById('year').value,
    province: document.getElementById('province').value,
    employmentIncome: document.getElementById('employmentIncome').value,
    selfEmploymentIncome: document.getElementById('selfEmploymentIncome').value,
    otherIncome: document.getElementById('otherIncome').value,
    eligibleDividends: document.getElementById('eligibleDividends').value,
    nonEligibleDividends: document.getElementById('nonEligibleDividends').value,
    capitalGains: document.getElementById('capitalGains').value,
    rrspDeduction: document.getElementById('rrspDeduction').value,
    fhsaDeduction: document.getElementById('fhsaDeduction').value,
    estimatedDeductions: document.getElementById('estimatedDeductions').value,
    taxPaid: document.getElementById('taxPaid').value,
    maritalStatus: document.getElementById('maritalStatus')?.value || 'single',
    spouseNetIncome: document.getElementById('spouseNetIncome')?.value || '',
    spouseWorkingIncome: document.getElementById('spouseWorkingIncome')?.value || '',
    numberOfChildren: document.getElementById('numberOfChildren')?.value || '0',
  };

  const MAX_INPUT = 1e9;
  const nChildren = Math.max(0, Math.min(12, parseInt(raw.numberOfChildren, 10) || 0));
  const childAges = [];
  for (let i = 0; i < nChildren; i++) {
    const el = document.getElementById(`childAge_${i}`);
    childAges.push(Math.max(0, Math.min(18, parseInt(el?.value, 10) || 0)));
  }

  const maritalStatus = raw.maritalStatus === 'married' ? 'married' : 'single';
  const household = {
    maritalStatus,
    spouseNetIncome: maritalStatus === 'married' ? parseInput(raw.spouseNetIncome) : 0,
    spouseEmploymentIncome: maritalStatus === 'married' ? parseInput(raw.spouseWorkingIncome) : 0,
    numberOfChildren: nChildren,
    childAges,
  };

  const parsed = {
    year: parseInt(raw.year) || 2026,
    province: raw.province,
    employmentIncome: parseInput(raw.employmentIncome),
    selfEmploymentIncome: parseInput(raw.selfEmploymentIncome),
    otherIncome: parseInput(raw.otherIncome),
    eligibleDividends: parseInput(raw.eligibleDividends),
    nonEligibleDividends: parseInput(raw.nonEligibleDividends),
    capitalGains: parseInput(raw.capitalGains),
    rrspDeduction: parseInput(raw.rrspDeduction),
    fhsaDeduction: parseInput(raw.fhsaDeduction),
    estimatedDeductions: parseInput(raw.estimatedDeductions),
    taxPaid: parseInput(raw.taxPaid),
    household,
  };

  // Numeric range validation: clamp is not applied, but values beyond MAX_INPUT
  // will be flagged so the user sees a validation error instead of silent truncation.
  const numericFields = [
    'employmentIncome',
    'selfEmploymentIncome',
    'otherIncome',
    'eligibleDividends',
    'nonEligibleDividends',
    'capitalGains',
    'rrspDeduction',
    'fhsaDeduction',
    'estimatedDeductions',
    'taxPaid'
  ];

  let hasRangeError = false;
  numericFields.forEach(field => {
    if (parsed[field] > MAX_INPUT) {
      hasRangeError = true;
      console.warn(`Value for ${field} exceeds maximum supported amount (${MAX_INPUT}). Raw:`, raw[field]);
    }
  });
  if (household.spouseNetIncome > MAX_INPUT || household.spouseEmploymentIncome > MAX_INPUT) {
    hasRangeError = true;
  }

  return {
    ...parsed,
    _hasRangeError: hasRangeError
  };
}

const QC_SCOPE_WARNING =
  'Quebec personal tax (QPP, QPIP, TP-1) is not form-verified in this version. Figures may not match a Quebec return.';

/** Show v1 out-of-scope notice for Quebec; returns true if warning is displayed. */
function setProvinceScopeWarning(province) {
  const provinceWarning = document.getElementById('provinceWarning');
  if (!provinceWarning) return false;
  if (province === 'QC') {
    provinceWarning.textContent = QC_SCOPE_WARNING;
    provinceWarning.style.display = 'block';
    return true;
  }
  return false;
}

/**
 * Perform tax calculation and update UI
 */
function calculate() {
  if (!taxDataLoaded) {
    return;
  }

  try {
    const inputs = getInputs();
    const provinceSelect = document.getElementById('province');
    const provinceWarning = document.getElementById('provinceWarning');
    const resultsSection = document.querySelector('.results');
    
    // Validate province
    if (!inputs.province || inputs.province === '') {
      // Show validation state
      provinceSelect.classList.add('is-invalid');
      if (provinceWarning) {
        provinceWarning.textContent = 'Select a province/territory to calculate tax.';
        provinceWarning.style.display = 'block';
      }
      // Show placeholder in results
      showProvincePlaceholder();
      return;
    }

    // Validate province exists in data
    try {
      const code = normalizeProvince(inputs.province);
      if (!code || !taxDataBundle?.provinces?.[code]) {
        throw new Error(`Province "${inputs.province}" not found in tax data.`);
      }
    } catch (error) {
      // Province not found in data
      provinceSelect.classList.add('is-invalid');
      if (provinceWarning) {
        provinceWarning.textContent = 'Select a province/territory to calculate tax.';
        provinceWarning.style.display = 'block';
      }
      showProvincePlaceholder();
      return;
    }

    provinceSelect.classList.remove('is-invalid');
    if (!setProvinceScopeWarning(inputs.province) && provinceWarning) {
      provinceWarning.style.display = 'none';
    }

    // Remove placeholder if present
    if (resultsSection) {
      const placeholder = resultsSection.querySelector('.province-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
    }

    // Numeric range validation: if any numeric input is beyond supported range,
    // surface a user-facing error instead of silently truncating.
    if (inputs._hasRangeError) {
      showError('One or more amounts exceed the maximum supported value. Please reduce the input and try again.');
      return;
    }

    const result = computePersonalTax(inputs, { taxData: taxDataBundle });

    let marginalDeduction = null;
    try {
      marginalDeduction = compareIncomeReduction({
        baselineInput: inputs,
        deductionAmount: MARGINAL_DEDUCTION_PROBE,
        deductionField: 'rrspDeduction',
        taxData: taxDataBundle,
        household: inputs.household,
      });
    } catch (probeError) {
      console.warn('Marginal deduction probe failed:', probeError);
    }

    renderResults(result, marginalDeduction);
    renderBreakdown(result);
  } catch (error) {
    console.error('Calculation error:', error);
    showError('Calculation error: ' + error.message);
  }
}

/**
 * Render main results
 */
function renderResults(result, marginalDeduction = null) {
  const { totals, benefits } = result;

  if (!totals) {
    console.error('No totals in result:', result);
    latestTotals = null;
    latestSharePayload = null;
    return;
  }
  latestTotals = totals;

  document.getElementById('totalIncome').textContent = formatCurrency(totals.totalIncome);
  document.getElementById('taxableIncome').textContent = formatCurrency(totals.taxableIncome);
  document.getElementById('totalBurden').textContent = formatCurrency(totals.totalBurden);
  document.getElementById('federalTax').textContent = formatCurrency(totals.federalTax);
  document.getElementById('provTax').textContent = formatCurrency(totals.provTax);
  document.getElementById('cpp').textContent = formatCurrency(totals.cpp);
  document.getElementById('ei').textContent = formatCurrency(totals.ei);
  
  // Check if values exist before formatting
  const takeHome = totals.takeHomeAfterPayroll;
  const avgRate = totals.avgRate;
  const marginalRate = totals.marginalRate;
  const refundOwing = totals.refundOrOwing;
  
  document.getElementById('takeHomeAfterPayroll').textContent = (takeHome !== undefined && takeHome !== null) ? formatCurrency(takeHome) : '$–';
  document.getElementById('avgRate').textContent = (avgRate !== undefined && avgRate !== null) ? formatPercent(avgRate) : '–%';
  document.getElementById('marginalRate').textContent = (marginalRate !== undefined && marginalRate !== null) ? formatPercent(marginalRate) : '–%';
  
  const refundOwingEl = document.getElementById('refundOrOwing');
  const refundOwingLabel = document.getElementById('refundOrOwingLabel');
  const refundOwingResult = document.getElementById('refundOrOwingResult');

  // Income tax balance only (positive = refund, negative = owing; excludes CPP/EI)
  if (refundOwing !== undefined && refundOwing !== null) {
    // Display: positive = refund, negative = balance owing (show absolute value for owing)
    if (refundOwing >= 0) {
      refundOwingLabel.textContent = 'Income tax refund';
      refundOwingEl.textContent = formatCurrency(refundOwing);
      refundOwingResult.className = 'result refund';
    } else {
      refundOwingLabel.textContent = 'Income tax owing';
      refundOwingEl.textContent = formatCurrency(Math.abs(refundOwing));
      refundOwingResult.className = 'result owing';
    }
  } else {
    refundOwingLabel.textContent = 'Tax balance (income tax)';
    refundOwingEl.textContent = '$–';
    refundOwingResult.className = 'result';
  }

  const programs = benefits?.programs || {};
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const projectionEl = document.getElementById('benefitsProjectionDisclosure');
  if (projectionEl) {
    if (benefits?.metadata?.anyProjected) {
      projectionEl.hidden = false;
      projectionEl.textContent =
        benefits.metadata.projectionDisclosure ||
        'Future benefit estimate: Current CCB, CGEB and CWB rules and parameters are applied where future program parameters have not yet been published. Actual future benefits may differ.';
    } else {
      projectionEl.hidden = true;
      projectionEl.textContent = '';
    }
  }

  setText('incomeTestedBenefitsTotal', formatCurrency(totals.incomeTestedBenefitsTotal || 0));
  setText(
    'disposableIncomeAfterBenefits',
    formatCurrency(totals.disposableIncomeAfterBenefits ?? totals.afterTaxIncome)
  );

  const formatProgramSublabel = (program, fallbackPeriod) => {
    const parts = [];
    if (program?.projected) {
      parts.push(
        `Projected current-rules estimate (basis tax year ${program.basisTaxYear}` +
          (program.basisBenefitYear != null ? `, benefit base year ${program.basisBenefitYear}` : '') +
          ')'
      );
    }
    if (program?.paymentPeriodLabel) parts.push(program.paymentPeriodLabel);
    else if (fallbackPeriod) parts.push(fallbackPeriod);
    return parts.join(' · ');
  };

  const gst = programs.gstHstCredit;
  if (gst?.available === false) {
    setText('gstHstCreditAmount', 'Not available');
    setText('gstHstCreditPeriod', gst.unavailableReason || 'Parameters not published for this tax year.');
  } else {
    setText('gstHstCreditAmount', formatCurrency(gst?.annualAmount || 0));
    setText('gstHstCreditPeriod', formatProgramSublabel(gst));
  }

  const cwb = programs.canadaWorkersBenefit;
  if (cwb?.available === false) {
    setText('cwbAmount', 'Not available');
  } else {
    setText('cwbAmount', formatCurrency(cwb?.annualAmount || 0));
  }

  const ccb = programs.canadaChildBenefit;
  if (ccb?.available === false) {
    setText('ccbAmount', 'Not available');
    setText('ccbPeriod', ccb.unavailableReason || 'Parameters not published for this tax year.');
  } else {
    setText('ccbAmount', formatCurrency(ccb?.annualAmount || 0));
    setText('ccbPeriod', formatProgramSublabel(ccb));
  }

  if (marginalDeduction && Number.isFinite(marginalDeduction.effectiveValueRate)) {
    setText('marginalDeductionEffectiveValue', formatPercent(marginalDeduction.effectiveValueRate));
    setText(
      'marginalDeductionDetail',
      `Income tax saved ${formatCurrency(marginalDeduction.taxSavings)}; ` +
      `additional benefits ${formatCurrency(marginalDeduction.additionalBenefits)}; ` +
      `total economic value ${formatCurrency(marginalDeduction.totalEconomicValue)} ` +
      `on a $${MARGINAL_DEDUCTION_PROBE.toLocaleString('en-CA')} net-income reduction.`
    );
  } else {
    setText('marginalDeductionEffectiveValue', '–%');
  }

  latestSharePayload = buildSharePayload();
}

/**
 * Render detailed breakdown
 */
function renderBreakdown(result) {
  const { breakdown } = result;

  // Federal brackets
  renderBrackets('federalBrackets', breakdown.federal.bracketLines, breakdown.federal.baseTax, breakdown.federal.credits, breakdown.federal.dtcApplied, breakdown.federal.netTax);

  // Provincial brackets
  renderBrackets('provincialBrackets', breakdown.provincial.bracketLines, breakdown.provincial.baseTax, breakdown.provincial.credits, breakdown.provincial.dtcApplied, breakdown.provincial.netTax, breakdown.provincial.surtaxes, breakdown.provincial.premiums);

  // Dividends
  renderDividends(breakdown.dividends);

  // Capital gains
  renderCapitalGains(breakdown.capitalGains);

  // Payroll
  renderPayroll(breakdown.payroll);

  // Income-tested benefits
  renderBenefits(result.benefits);
}

/**
 * Render income-tested benefit arithmetic.
 */
function renderBenefits(benefits) {
  const container = document.getElementById('benefitsBreakdown');
  if (!container) return;
  container.innerHTML = '';

  if (!benefits) {
    container.innerHTML = '<p>Benefit parameters were not loaded for this tax year.</p>';
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'helper';
  intro.textContent =
    'Amounts below are estimated annual entitlements generated by this tax year’s income. ' +
    'CCB and the GST/HST credit / Canada Groceries and Essentials Benefit are paid in the following July–June benefit year. ' +
    'The Canada workers benefit is a refundable credit for this tax year. Income tax payable is unchanged by these lines.';
  container.appendChild(intro);

  if (benefits.metadata?.anyProjected && benefits.metadata?.projectionDisclosure) {
    const proj = document.createElement('p');
    proj.className = 'helper';
    proj.style.fontWeight = '600';
    proj.textContent = benefits.metadata.projectionDisclosure;
    container.appendChild(proj);
  }

  const afni = benefits.incomeMeasures?.adjustedFamilyNetIncome;
  if (afni != null) {
    const afniEl = document.createElement('div');
    afniEl.className = 'breakdown-line';
    afniEl.innerHTML = `<strong>Adjusted family net income (as modeled):</strong> ${formatCurrency(afni)}`;
    container.appendChild(afniEl);
  }

  const programs = benefits.programs || {};
  for (const [key, program] of Object.entries(programs)) {
    const section = document.createElement('div');
    section.className = 'breakdown-section';
    const title = program.statutoryName || key;
    section.innerHTML = `<h4>${title}</h4>`;
    if (program.available === false) {
      const p = document.createElement('p');
      p.textContent = program.unavailableReason || 'Not available for this tax year / jurisdiction.';
      section.appendChild(p);
    } else {
      const list = document.createElement('ul');
      (program.calculationSteps || []).forEach((step) => {
        const li = document.createElement('li');
        const amountPart = step.amount != null ? ` ${formatCurrency(step.amount)}` : '';
        const detailPart = step.detail ? ` — ${step.detail}` : '';
        li.textContent = `${step.label}:${amountPart}${detailPart}`;
        list.appendChild(li);
      });
      section.appendChild(list);
      const total = document.createElement('div');
      total.className = 'breakdown-line total';
      total.innerHTML = `<strong>Estimated annual entitlement:</strong> ${formatCurrency(program.annualAmount || 0)}`;
      section.appendChild(total);
    }
    container.appendChild(section);
  }

  if (benefits.metadata?.excludedPrograms?.length) {
    const excl = document.createElement('div');
    excl.className = 'breakdown-section';
    excl.innerHTML = '<h4>Explicitly not included</h4>';
    const ul = document.createElement('ul');
    benefits.metadata.excludedPrograms.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.id}: ${item.reason}`;
      ul.appendChild(li);
    });
    excl.appendChild(ul);
    container.appendChild(excl);
  }
}

/**
 * Render bracket calculations
 */
function renderBrackets(containerId, bracketLines, baseTax, credits, dtcApplied, netTax, surtaxes = [], premiums = []) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  // Brackets table
  const table = document.createElement('table');
  table.className = 'breakdown-table';
  
  const header = document.createElement('thead');
  header.innerHTML = '<tr><th>Bracket</th><th>Rate</th><th>Taxable in Bracket</th><th>Tax</th></tr>';
  table.appendChild(header);

  const tbody = document.createElement('tbody');
  bracketLines.forEach(line => {
    if (line.taxableInBracket > 0 || line.tax > 0) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${formatCurrency(line.threshold)}+</td>
        <td>${formatPercent(line.rate)}</td>
        <td>${formatCurrency(line.taxableInBracket)}</td>
        <td>${formatCurrency(line.tax)}</td>
      `;
      tbody.appendChild(row);
    }
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // Base tax
  const baseTaxEl = document.createElement('div');
  baseTaxEl.className = 'breakdown-line';
  baseTaxEl.innerHTML = `<strong>Base Tax:</strong> ${formatCurrency(baseTax)}`;
  container.appendChild(baseTaxEl);

  // Credits
  if (credits && credits.length > 0) {
    const creditsDiv = document.createElement('div');
    creditsDiv.className = 'breakdown-section';
    creditsDiv.innerHTML = '<strong>Credits:</strong>';
    const creditsList = document.createElement('ul');
    credits.forEach(credit => {
      const li = document.createElement('li');
      li.textContent = `${credit.name}: ${formatCurrency(credit.amount)}`;
      creditsList.appendChild(li);
    });
    creditsDiv.appendChild(creditsList);
    container.appendChild(creditsDiv);
  }

  // Dividend tax credits
  if (dtcApplied && dtcApplied > 0) {
    const dtcEl = document.createElement('div');
    dtcEl.className = 'breakdown-line';
    dtcEl.innerHTML = `<strong>Dividend Tax Credits Applied:</strong> ${formatCurrency(dtcApplied)}`;
    container.appendChild(dtcEl);
  }

  // Surtaxes
  if (surtaxes && surtaxes.length > 0) {
    surtaxes.forEach(surtax => {
      const surtaxEl = document.createElement('div');
      surtaxEl.className = 'breakdown-line';
      surtaxEl.innerHTML = `<strong>${surtax.name}:</strong> ${formatCurrency(surtax.amount)}`;
      container.appendChild(surtaxEl);
    });
  }

  // Premiums
  if (premiums && premiums.length > 0) {
    premiums.forEach(premium => {
      const premiumEl = document.createElement('div');
      premiumEl.className = 'breakdown-line';
      premiumEl.innerHTML = `<strong>${premium.name}:</strong> ${formatCurrency(premium.amount)}`;
      container.appendChild(premiumEl);
    });
  }

  // Net tax
  const netTaxEl = document.createElement('div');
  netTaxEl.className = 'breakdown-line total';
  netTaxEl.innerHTML = `<strong>Net Tax:</strong> ${formatCurrency(netTax)}`;
  container.appendChild(netTaxEl);
}

/**
 * Render dividend breakdown
 */
function renderDividends(dividends) {
  const container = document.getElementById('dividendsBreakdown');
  container.innerHTML = '';

  if (dividends.eligibleGrossUp === 0 && dividends.nonEligibleGrossUp === 0) {
    container.innerHTML = '<p>No dividends entered.</p>';
    return;
  }

  const div = document.createElement('div');
  div.className = 'breakdown-section';
  
  if (dividends.eligibleGrossUp > 0) {
    div.innerHTML += `
      <h4>Eligible Dividends</h4>
      <p>Gross-up: ${formatCurrency(dividends.eligibleGrossUp)}</p>
      <p>Federal DTC: ${formatCurrency(dividends.eligibleDTCFed)}</p>
      <p>Provincial DTC: ${formatCurrency(dividends.eligibleDTCProv)}</p>
    `;
  }

  if (dividends.nonEligibleGrossUp > 0) {
    div.innerHTML += `
      <h4>Non-Eligible Dividends</h4>
      <p>Gross-up: ${formatCurrency(dividends.nonEligibleGrossUp)}</p>
      <p>Federal DTC: ${formatCurrency(dividends.nonEligibleDTCFed)}</p>
      <p>Provincial DTC: ${formatCurrency(dividends.nonEligibleDTCProv)}</p>
    `;
  }

  container.appendChild(div);
}

/**
 * Render capital gains breakdown
 */
function renderCapitalGains(capitalGains) {
  const container = document.getElementById('capitalGainsBreakdown');
  container.innerHTML = '';

  if (capitalGains.taxableCapitalGains === 0) {
    container.innerHTML = '<p>No capital gains entered.</p>';
    return;
  }

  const div = document.createElement('div');
  div.className = 'breakdown-section';
  div.innerHTML = `
    <p><strong>Inclusion Rate:</strong> ${formatPercent(capitalGains.inclusionRate)}</p>
    <p><strong>Taxable Capital Gains:</strong> ${formatCurrency(capitalGains.taxableCapitalGains)}</p>
  `;
  container.appendChild(div);
}

/**
 * Render payroll breakdown
 */
function renderPayroll(payroll) {
  const container = document.getElementById('payrollBreakdown');
  container.innerHTML = '';

  const div = document.createElement('div');
  div.className = 'breakdown-section';
  
  const cpp = payroll.cpp;
  div.innerHTML += `
    <h4>CPP</h4>
    <p>Pensionable Earnings (CPP1): ${formatCurrency(cpp.pensionableEarnings)}</p>
    <p>Base CPP (line 30800 credit): ${formatCurrency(cpp.cppBaseCreditable ?? 0)}</p>
    <p>First additional CPP (line 22215 deduction): ${formatCurrency(cpp.cppFirstAdditionalDeductible ?? 0)}</p>
    ${cpp.cpp2 > 0 ? `<p>CPP2 (line 22215 deduction): ${formatCurrency(cpp.cpp2Deductible ?? cpp.cpp2)}</p>` : ''}
    <p>Total employee CPP: ${formatCurrency(cpp.cpp)}</p>
    <p class="formula-meta">Enhanced CPP (first additional + CPP2) reduces taxable income; base CPP is a federal/provincial non-refundable credit only.</p>
  `;

  div.innerHTML += `
    <h4>EI</h4>
    <p>Insurable Earnings: ${formatCurrency(payroll.ei.insurableEarnings)}</p>
    <p>Rate: ${formatPercent(payroll.ei.inputs.rate)}</p>
    <p>Premium: ${formatCurrency(payroll.ei.ei)}</p>
  `;

  container.appendChild(div);
}

/**
 * Clear all results
 */
function clearResults() {
  document.getElementById('totalIncome').textContent = '$–';
  document.getElementById('taxableIncome').textContent = '$–';
  document.getElementById('totalBurden').textContent = '$–';
  document.getElementById('federalTax').textContent = '$–';
  document.getElementById('provTax').textContent = '$–';
  document.getElementById('cpp').textContent = '$–';
  document.getElementById('ei').textContent = '$–';
  document.getElementById('takeHomeAfterPayroll').textContent = '$–';
  document.getElementById('avgRate').textContent = '–%';
  document.getElementById('marginalRate').textContent = '–%';
  document.getElementById('refundOrOwing').textContent = '$–';
  document.getElementById('refundOrOwingLabel').textContent = 'Tax balance (income tax)';
  const refundOwingResult = document.getElementById('refundOrOwingResult');
  if (refundOwingResult) {
    refundOwingResult.className = 'result';
  }
  latestTotals = null;
  latestSharePayload = null;
}

function setShareStatus(msg, isError = false) {
  const el = document.getElementById('tax_result_share_status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--error)' : '';
}

function buildSharePayload() {
  if (!latestTotals || !window.TLM || !window.TLM.shareCard) return null;
  const provinceEl = document.getElementById('province');
  const provinceLabel = (provinceEl && provinceEl.selectedOptions && provinceEl.selectedOptions[0])
    ? provinceEl.selectedOptions[0].textContent
    : 'Selected province';
  return {
    calculatorName: 'canada-income-tax',
    title: 'Canada Personal Income Tax Calculator | The Long Math',
    brand: 'The Long Math',
    headline: 'Canada Personal Income Tax Estimate',
    mainValue: formatCurrency(latestTotals.totalBurden),
    subline: 'Estimated total tax burden (income tax + CPP + EI)',
    contextLines: [
      'Take-home pay: ' + formatCurrency(latestTotals.takeHomeAfterPayroll || 0),
      'Average tax rate: ' + formatPercent(latestTotals.avgRate || 0),
      'Marginal tax rate: ' + formatPercent(latestTotals.marginalRate || 0),
      'Province/territory: ' + provinceLabel
    ],
    footer: 'Run your own numbers at TheLongMath.com',
    shareText: 'Canada personal income tax estimate: total burden ' + formatCurrency(latestTotals.totalBurden),
    url: window.location.href
  };
}

function exportCsv() {
  if (!latestTotals) return;
  const provinceEl = document.getElementById('province');
  const provinceLabel = (provinceEl && provinceEl.selectedOptions && provinceEl.selectedOptions[0])
    ? provinceEl.selectedOptions[0].textContent
    : '';
  const rows = [
    'Canada Personal Income Tax Calculator (export)',
    'Generated,' + new Date().toISOString(),
    'Province/Territory,' + provinceLabel,
    '',
    'Metric,Value',
    'Total Income,' + (latestTotals.totalIncome || 0),
    'Taxable Income,' + (latestTotals.taxableIncome || 0),
    'Total Tax Burden,' + (latestTotals.totalBurden || 0),
    'Federal Income Tax,' + (latestTotals.federalTax || 0),
    'Provincial/Territorial Income Tax,' + (latestTotals.provTax || 0),
    'CPP Contributions,' + (latestTotals.cpp || 0),
    'EI Contributions,' + (latestTotals.ei || 0),
    'Take-Home Pay,' + (latestTotals.takeHomeAfterPayroll || 0),
    'Average Tax Rate,' + ((latestTotals.avgRate || 0) * 100).toFixed(3) + '%',
    'Marginal Tax Rate,' + ((latestTotals.marginalRate || 0) * 100).toFixed(3) + '%',
    'Tax balance (income tax) [Fed + Prov-Terr income tax minus paid; excl CPP/EI],' + (latestTotals.refundOrOwing || 0)
  ];
  const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'thelongmath-canada-income-tax-results.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function wireShareButtons() {
  const shareBtn = document.getElementById('tax_share_result_btn');
  const downloadBtn = document.getElementById('tax_download_result_btn');
  const copyBtn = document.getElementById('tax_copy_result_link_btn');
  const csvBtn = document.getElementById('tax_export_csv_btn');
  if (csvBtn) {
    csvBtn.addEventListener('click', () => {
      exportCsv();
      setShareStatus('CSV downloaded.');
    });
  }
  if (!window.TLM || !window.TLM.shareCard) return;

  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const payload = latestSharePayload || buildSharePayload();
      if (!payload) return;
      setShareStatus('Preparing image...');
      try {
        const result = await window.TLM.shareCard.shareResultCard(payload);
        if (result && result.mode === 'download-and-copy-fallback') {
          setShareStatus(result.copied ? 'Calculation image saved and shareable link copied.' : 'Calculation image saved.');
        } else {
          setShareStatus('Share dialog opened.');
        }
      } catch (_e) {
        setShareStatus('Share cancelled or unavailable.', true);
      }
    });
  }
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const payload = latestSharePayload || buildSharePayload();
      if (!payload) return;
      setShareStatus('Preparing image...');
      try {
        await window.TLM.shareCard.downloadResultCard(payload);
        setShareStatus('Calculation image saved.');
      } catch (_e) {
        setShareStatus('Could not prepare image.', true);
      }
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await window.TLM.shareCard.copyResultLink({ url: window.location.href, calculatorName: 'canada-income-tax' });
        setShareStatus('Shareable link copied.');
      } catch (_e) {
        setShareStatus('Could not copy link.', true);
      }
    });
  }
}

/**
 * Show error message
 */
function showError(message) {
  // Could add an error display element if needed
  console.error(message);
}

/**
 * Show placeholder message when province is not selected
 */
function showProvincePlaceholder() {
  // Clear all result values
  clearResults();
  
  // Add placeholder message in results area
  const resultsSection = document.querySelector('.results');
  if (resultsSection) {
    // Remove existing placeholder if present
    const existingPlaceholder = resultsSection.querySelector('.province-placeholder');
    if (existingPlaceholder) {
      existingPlaceholder.remove();
    }
    
    // Add new placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'province-placeholder';
    placeholder.style.cssText = 'text-align: center; padding: 20px; color: var(--muted); font-size: 13px; grid-column: 1 / -1;';
    placeholder.textContent = 'Waiting for province/territory selection.';
    resultsSection.appendChild(placeholder);
  }
}

/**
 * Update RRSP max value from federal data
 */
function updateRRSPMaxValue() {
  try {
    if (!taxDataLoaded) {
      return;
    }
    const federalData = taxDataBundle?.federal;
    const rrspMaxEl = document.getElementById('rrsp-max-value');
    const rrspMaxText = document.getElementById('rrsp-max-text');
    const rrspYearEl = document.getElementById('rrsp-max-year');
    const yearVal = document.getElementById('year')?.value;

    if (rrspYearEl && yearVal) {
      rrspYearEl.textContent = yearVal;
    }

    if (federalData && federalData.rrspDollarMax && rrspMaxEl) {
      rrspMaxEl.textContent = formatCurrency(federalData.rrspDollarMax);
    } else if (rrspMaxText) {
      // Fallback: hide the paragraph with specific max value
      rrspMaxText.style.display = 'none';
    }
  } catch (error) {
    // Silently fail - will show fallback text
    console.debug('Could not load RRSP max value:', error);
  }
}
