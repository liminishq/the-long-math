/**
 * UI module for tax calculator
 * Handles DOM interactions, validation, and rendering
 */

import { computePersonalTax } from './tax.engine.js';
import { loadTaxData, getFederalData, getProvincialData } from './tax.data.js';
import { formatCurrency, formatPercent, parseInput } from './format.js';

let taxDataLoaded = false;

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
    yearSelect.value = '2025';
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
    await loadTaxData(2025);
    taxDataLoaded = true;
  } catch (error) {
    console.error('Failed to load tax data:', error);
    showError('Failed to load tax data. Please refresh the page.');
    return;
  }

  // Attach event listeners
  attachEventListeners();

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
  const selects = document.querySelectorAll('select');
  selects.forEach(select => {
    select.addEventListener('change', calculate);
    // Ensure select is interactive
    select.style.pointerEvents = 'auto';
    select.style.cursor = 'pointer';
  });

  // Reset button
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', resetAllInputs);
  }
}

/**
 * Reset all input fields to default/empty values
 */
function resetAllInputs() {
  document.getElementById('year').value = '2025';
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
  
  // Remove validation state
  const provinceSelect = document.getElementById('province');
  const provinceWarning = document.getElementById('provinceWarning');
  provinceSelect.classList.remove('is-invalid');
  if (provinceWarning) {
    provinceWarning.style.display = 'none';
  }
  
  // Clear results and recalculate
  clearResults();
  calculate();
  
  // Clear breakdown sections
  document.getElementById('federalBrackets').innerHTML = '';
  document.getElementById('provincialBrackets').innerHTML = '';
  document.getElementById('dividendsBreakdown').innerHTML = '';
  document.getElementById('capitalGainsBreakdown').innerHTML = '';
  document.getElementById('payrollBreakdown').innerHTML = '';
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
    taxPaid: document.getElementById('taxPaid').value
  };

  // Development-only debug guard: log raw strings before parsing to confirm no truncation.
  // Safe to remove or wrap in an environment flag later.
  console.debug('Raw input values before parsing:', {
    eligibleDividends: raw.eligibleDividends
  });

  const MAX_INPUT = 1e9;

  const parsed = {
    year: parseInt(raw.year) || 2025,
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
    taxPaid: parseInput(raw.taxPaid)
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

  return {
    ...parsed,
    _hasRangeError: hasRangeError
  };
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
      getProvincialData(inputs.province);
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

    // Remove validation state
    provinceSelect.classList.remove('is-invalid');
    if (provinceWarning) {
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

    const result = computePersonalTax(inputs);

    renderResults(result);
    renderBreakdown(result);
  } catch (error) {
    console.error('Calculation error:', error);
    showError('Calculation error: ' + error.message);
  }
}

/**
 * Render main results
 */
function renderResults(result) {
  const { totals } = result;

  if (!totals) {
    console.error('No totals in result:', result);
    return;
  }

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
  
  // Refund/Owing display with proper styling and label
  const refundOwingEl = document.getElementById('refundOrOwing');
  const refundOwingLabel = document.getElementById('refundOrOwingLabel');
  const refundOwingResult = document.getElementById('refundOrOwingResult');
  
  if (refundOwing !== undefined && refundOwing !== null) {
    // Display: positive = refund, negative = balance owing (show absolute value for owing)
    if (refundOwing >= 0) {
      refundOwingLabel.textContent = 'Refund';
      refundOwingEl.textContent = formatCurrency(refundOwing);
      refundOwingResult.className = 'result refund';
    } else {
      refundOwingLabel.textContent = 'Balance Owing';
      refundOwingEl.textContent = formatCurrency(Math.abs(refundOwing));
      refundOwingResult.className = 'result owing';
    }
  } else {
    refundOwingLabel.textContent = 'Balance Owing / Refund';
    refundOwingEl.textContent = '$–';
    refundOwingResult.className = 'result';
  }
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
  
  div.innerHTML += `
    <h4>CPP</h4>
    <p>Pensionable Earnings: ${formatCurrency(payroll.cpp.pensionableEarnings)}</p>
    <p>CPP1 Rate: ${formatPercent(payroll.cpp.inputs.rate)}</p>
    <p>CPP1 Contribution: ${formatCurrency(payroll.cpp.cpp1 || payroll.cpp.cpp)}</p>
    ${payroll.cpp.cpp2 > 0 ? `
      <p>CPP2 Rate: ${formatPercent(payroll.cpp.inputs.cpp2Rate || 0.04)}</p>
      <p>CPP2 Contribution: ${formatCurrency(payroll.cpp.cpp2)}</p>
    ` : ''}
    <p><strong>Total CPP Contribution: ${formatCurrency(payroll.cpp.cpp)}</strong></p>
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
  document.getElementById('refundOrOwingLabel').textContent = 'Balance Owing / Refund';
  const refundOwingResult = document.getElementById('refundOrOwingResult');
  if (refundOwingResult) {
    refundOwingResult.className = 'result';
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
    const federalData = getFederalData();
    const rrspMaxEl = document.getElementById('rrsp-max-value');
    const rrspMaxText = document.getElementById('rrsp-max-text');
    
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
