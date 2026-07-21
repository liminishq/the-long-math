/**
 * UI module for CCPC tax calculator
 * Handles DOM interactions, validation, and rendering
 */

import { computeCCPCTax } from './ccpc.bridge.js';
import { loadCorporateTaxData } from './corporate.data.js';
import { loadTaxData } from '../../canada-income-tax/js/tax.data.js';
import { formatCurrency, formatPercent, parseInput } from './format.js';

let corporateDataLoaded = false;
let personalDataLoaded = false;
let latestInputs = null;
let latestResult = null;

const PERSONAL_TAX_DATA_BASE = '/calculators/canada-income-tax/data';

function setDefaultCorporateTaxYearStart(year) {
  const startEl = document.getElementById('corporateTaxYearStart');
  if (startEl) {
    startEl.value = `${year}-01-01`;
  }
}

function loadPersonalTaxData(year) {
  return loadTaxData(year, { basePath: PERSONAL_TAX_DATA_BASE });
}

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
  PROVINCES.forEach(prov => {
    const option = document.createElement('option');
    option.value = prov.code;
    option.textContent = prov.name;
    provinceSelect.appendChild(option);
  });

  // Set default year
  document.getElementById('year').value = '2026';
  setDefaultCorporateTaxYearStart(2026);

  // Load tax data
  try {
    await Promise.all([
      loadCorporateTaxData(2026),
      loadPersonalTaxData(2026)
    ]);
    corporateDataLoaded = true;
    personalDataLoaded = true;
  } catch (error) {
    console.error('Failed to load tax data:', error);
    showError('Failed to load tax data. Please refresh the page.');
    return;
  }

  // Attach event listeners
  attachEventListeners();
  wireShareButtons();

  // Show/hide province note based on selection
  updateProvinceNote();
}

/**
 * Attach event listeners to input fields
 */
function attachEventListeners() {
  const yearSelect = document.getElementById('year');
  if (yearSelect) {
    yearSelect.addEventListener('change', async () => {
      const y = parseInt(yearSelect.value, 10) || 2026;
      setDefaultCorporateTaxYearStart(y);
      try {
        corporateDataLoaded = false;
        personalDataLoaded = false;
        await Promise.all([loadCorporateTaxData(y), loadPersonalTaxData(y)]);
        corporateDataLoaded = true;
        personalDataLoaded = true;
        calculate();
      } catch (error) {
        console.error('Failed to load tax data for year', y, error);
        showError('Failed to load tax data for the selected year. Please try again.');
      }
    });
  }

  const inputs = document.querySelectorAll('input[type="text"], input[type="date"], select:not(#year)');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      updateProvinceNote();
      calculate();
    });
    input.addEventListener('change', () => {
      updateProvinceNote();
      calculate();
    });
  });

  const incomeSplittingCheckbox = document.getElementById('incomeSplitting');
  if (incomeSplittingCheckbox) {
    incomeSplittingCheckbox.addEventListener('change', () => {
      toggleIncomeSplitting(incomeSplittingCheckbox.checked);
      calculate();
    });
  }

  // Reset button
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', resetAllInputs);
  }
}

function toggleIncomeSplitting(enabled) {
  const singleBlock = document.getElementById('singleShareholderBlock');
  const splitBlock = document.getElementById('incomeSplittingBlock');
  const singleResult = document.getElementById('singleResultBlock');
  const splitResult = document.getElementById('splitResultBlock');
  const singlePersonalDetail = document.getElementById('singlePersonalBreakdownDetail');
  const personal1Detail = document.getElementById('personal1BreakdownDetail');
  const personal2Detail = document.getElementById('personal2BreakdownDetail');

  if (singleBlock) singleBlock.style.display = enabled ? 'none' : 'block';
  if (splitBlock) splitBlock.style.display = enabled ? 'block' : 'none';
  if (singleResult) singleResult.style.display = enabled ? 'none' : 'grid';
  if (splitResult) splitResult.style.display = enabled ? 'grid' : 'none';
  if (singlePersonalDetail) singlePersonalDetail.style.display = enabled ? 'none' : 'block';
  if (personal1Detail) personal1Detail.style.display = enabled ? 'block' : 'none';
  if (personal2Detail) personal2Detail.style.display = enabled ? 'block' : 'none';
}

/**
 * Update province note visibility for AB/QC
 */
function updateProvinceNote() {
  const province = document.getElementById('province').value;
  const noteEl = document.getElementById('provinceNote');
  if (noteEl) {
    if (province === 'AB' || province === 'QC') {
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
    }
  }
}

/**
 * Reset all input fields to default/empty values
 */
function resetAllInputs() {
  document.getElementById('year').value = '2026';
  setDefaultCorporateTaxYearStart(2026);
  document.getElementById('province').value = '';
  document.getElementById('grossRevenue').value = '';
  document.getElementById('expenses').value = '';
  document.getElementById('incomeSplitting').checked = false;
  toggleIncomeSplitting(false);

  document.getElementById('salary').value = '';
  document.getElementById('eligibleDividends').value = '';
  document.getElementById('nonEligibleDividends').value = '';
  document.getElementById('personalOtherIncome').value = '';
  document.getElementById('personalDeductions').value = '';

  document.getElementById('sh1Salary').value = '';
  document.getElementById('sh1EligibleDividends').value = '';
  document.getElementById('sh1NonEligibleDividends').value = '';
  document.getElementById('sh1OtherIncome').value = '';
  document.getElementById('sh1Deductions').value = '';
  document.getElementById('sh2Salary').value = '';
  document.getElementById('sh2EligibleDividends').value = '';
  document.getElementById('sh2NonEligibleDividends').value = '';
  document.getElementById('sh2OtherIncome').value = '';
  document.getElementById('sh2Deductions').value = '';

  clearResults();

  document.getElementById('corporateBreakdown').innerHTML = '';
  document.getElementById('personalBreakdown').innerHTML = '';
  const pb1 = document.getElementById('personal1Breakdown');
  const pb2 = document.getElementById('personal2Breakdown');
  if (pb1) pb1.innerHTML = '';
  if (pb2) pb2.innerHTML = '';

  updateProvinceNote();
}

/**
 * Get inputs from form
 */
function getInputs() {
  const incomeSplitting = document.getElementById('incomeSplitting').checked;
  const base = {
    year: parseInt(document.getElementById('year').value) || 2026,
    corporateTaxYearStart: document.getElementById('corporateTaxYearStart').value,
    province: document.getElementById('province').value,
    grossRevenue: parseInput(document.getElementById('grossRevenue').value),
    expenses: parseInput(document.getElementById('expenses').value),
    incomeSplitting
  };

  if (incomeSplitting) {
    base.shareholder1 = {
      salary: parseInput(document.getElementById('sh1Salary').value),
      eligibleDividends: parseInput(document.getElementById('sh1EligibleDividends').value),
      nonEligibleDividends: parseInput(document.getElementById('sh1NonEligibleDividends').value),
      otherIncome: parseInput(document.getElementById('sh1OtherIncome').value),
      deductions: parseInput(document.getElementById('sh1Deductions').value)
    };
    base.shareholder2 = {
      salary: parseInput(document.getElementById('sh2Salary').value),
      eligibleDividends: parseInput(document.getElementById('sh2EligibleDividends').value),
      nonEligibleDividends: parseInput(document.getElementById('sh2NonEligibleDividends').value),
      otherIncome: parseInput(document.getElementById('sh2OtherIncome').value),
      deductions: parseInput(document.getElementById('sh2Deductions').value)
    };
  } else {
    base.salary = parseInput(document.getElementById('salary').value);
    base.eligibleDividends = parseInput(document.getElementById('eligibleDividends').value);
    base.nonEligibleDividends = parseInput(document.getElementById('nonEligibleDividends').value);
    base.personalOtherIncome = parseInput(document.getElementById('personalOtherIncome').value);
    base.personalDeductions = parseInput(document.getElementById('personalDeductions').value);
  }

  return base;
}

/**
 * Main calculation function
 */
function calculate() {
  try {
    if (!corporateDataLoaded || !personalDataLoaded) {
      return;
    }

    const inputs = getInputs();

    // Validate required fields
    if (!inputs.province) {
      clearResults();
      return;
    }

    const result = computeCCPCTax(inputs);
    latestInputs = inputs;
    latestResult = result;

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
  const { corporate, personal, personal1, personal2, combined, incomeSplitting } = result;

  if (incomeSplitting) {
    document.getElementById('splitCorporateTaxableIncome').textContent = formatCurrency(corporate.taxableIncome);
    document.getElementById('splitCorporateTax').textContent = formatCurrency(corporate.totalCorporateTax);
    document.getElementById('splitAfterTaxCorporateCash').textContent = formatCurrency(corporate.afterTaxCash);
    document.getElementById('splitRetainedEarnings').textContent = formatCurrency(combined.retainedEarnings);
    document.getElementById('sh1PersonalTax').textContent = formatCurrency(personal1.totalIncomeTax);
    document.getElementById('sh1NetTakeHome').textContent = formatCurrency(personal1.takeHomeAfterPayroll);
    document.getElementById('sh2PersonalTax').textContent = formatCurrency(personal2.totalIncomeTax);
    document.getElementById('sh2NetTakeHome').textContent = formatCurrency(personal2.takeHomeAfterPayroll);
    document.getElementById('splitTotalTaxBurden').textContent = formatCurrency(combined.totalTaxBurden);
    document.getElementById('splitEffectiveTaxRate').textContent = formatPercent(combined.effectiveTaxRate);
  } else {
    document.getElementById('corporateTaxableIncome').textContent = formatCurrency(corporate.taxableIncome);
    document.getElementById('corporateTax').textContent = formatCurrency(corporate.totalCorporateTax);
    document.getElementById('afterTaxCorporateCash').textContent = formatCurrency(corporate.afterTaxCash);
    document.getElementById('retainedEarnings').textContent = formatCurrency(combined.retainedEarnings);
    document.getElementById('personalTax').textContent = formatCurrency(personal.totalIncomeTax);
    document.getElementById('netPersonalTakeHome').textContent = formatCurrency(combined.netPersonalTakeHome);
    document.getElementById('totalTaxBurden').textContent = formatCurrency(combined.totalTaxBurden);
    document.getElementById('effectiveTaxRate').textContent = formatPercent(combined.effectiveTaxRate);
  }
}

/**
 * Render breakdown sections
 */
function renderBreakdown(result) {
  renderCorporateBreakdown(result.corporate);
  if (result.incomeSplitting) {
    renderPersonalBreakdown(result.personal1, document.getElementById('personal1Breakdown'));
    renderPersonalBreakdown(result.personal2, document.getElementById('personal2Breakdown'));
  } else {
    renderPersonalBreakdown(result.personal, document.getElementById('personalBreakdown'));
  }
}

/**
 * Render corporate tax breakdown
 */
function renderCorporateBreakdown(corporate) {
  const container = document.getElementById('corporateBreakdown');
  container.innerHTML = '';

  const div = document.createElement('div');
  div.className = 'breakdown-section';

  div.innerHTML += `
    <h4>Federal Corporate Tax</h4>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Income in Bracket</th>
          <th>Rate</th>
          <th>Tax</th>
        </tr>
      </thead>
      <tbody>
  `;

  corporate.breakdown.federal.brackets.forEach(bracket => {
    div.innerHTML += `
      <tr>
        <td>${bracket.type}</td>
        <td>${formatCurrency(bracket.incomeInBracket)}</td>
        <td>${formatPercent(bracket.rate)}</td>
        <td>${formatCurrency(bracket.tax)}</td>
      </tr>
    `;
  });

  div.innerHTML += `
        <tr>
          <td colspan="3"><strong>Total Federal Tax</strong></td>
          <td><strong>${formatCurrency(corporate.breakdown.federal.totalTax)}</strong></td>
        </tr>
      </tbody>
    </table>
  `;

  div.innerHTML += `
    <h4>Provincial Corporate Tax</h4>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Income in Bracket</th>
          <th>Rate</th>
          <th>Tax</th>
        </tr>
      </thead>
      <tbody>
  `;

  corporate.breakdown.provincial.brackets.forEach(bracket => {
    div.innerHTML += `
      <tr>
        <td>${bracket.type}</td>
        <td>${formatCurrency(bracket.incomeInBracket)}</td>
        <td>${formatPercent(bracket.rate)}</td>
        <td>${formatCurrency(bracket.tax)}</td>
      </tr>
    `;
  });

  div.innerHTML += `
        <tr>
          <td colspan="3"><strong>Total Provincial Tax</strong></td>
          <td><strong>${formatCurrency(corporate.breakdown.provincial.totalTax)}</strong></td>
        </tr>
      </tbody>
    </table>
    <p><strong>Total Corporate Tax:</strong> ${formatCurrency(corporate.totalCorporateTax)}</p>
    <p><strong>Federal SBD Limit:</strong> ${formatCurrency(corporate.breakdown.federal.sbdLimit)}</p>
    <p><strong>Provincial SBD Limit:</strong> ${formatCurrency(corporate.breakdown.provincial.sbdLimit)}</p>
  `;

  container.appendChild(div);
}

/**
 * Render personal tax breakdown (simplified - can expand later)
 * @param {Object} personal - personal totals + breakdown
 * @param {HTMLElement} [container] - optional container (default: personalBreakdown)
 */
function renderPersonalBreakdown(personal, container) {
  const el = container || document.getElementById('personalBreakdown');
  if (!el) return;
  el.innerHTML = '';

  const div = document.createElement('div');
  div.className = 'breakdown-section';

  div.innerHTML += `
    <h4>Personal Tax Summary</h4>
    <p>Federal Tax: ${formatCurrency(personal.federalTax)}</p>
    <p>Provincial Tax: ${formatCurrency(personal.provTax)}</p>
    <p>Total Personal Tax: ${formatCurrency(personal.totalIncomeTax)}</p>
    <p>CPP: ${formatCurrency(personal.cpp)}</p>
    <p>EI: ${formatCurrency(personal.ei)}</p>
    <p>Total Burden: ${formatCurrency(personal.totalBurden)}</p>
  `;

  el.appendChild(div);
}

/**
 * Clear all results
 */
function clearResults() {
  document.getElementById('corporateTaxableIncome').textContent = '$–';
  document.getElementById('corporateTax').textContent = '$–';
  document.getElementById('afterTaxCorporateCash').textContent = '$–';
  document.getElementById('retainedEarnings').textContent = '$–';
  document.getElementById('personalTax').textContent = '$–';
  document.getElementById('netPersonalTakeHome').textContent = '$–';
  document.getElementById('totalTaxBurden').textContent = '$–';
  document.getElementById('effectiveTaxRate').textContent = '–%';

  const splitIds = ['splitCorporateTaxableIncome', 'splitCorporateTax', 'splitAfterTaxCorporateCash', 'splitRetainedEarnings', 'sh1PersonalTax', 'sh1NetTakeHome', 'sh2PersonalTax', 'sh2NetTakeHome', 'splitTotalTaxBurden', 'splitEffectiveTaxRate'];
  splitIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id.includes('Effective') ? '–%' : '$–';
  });
  latestInputs = null;
  latestResult = null;
}

/**
 * Show error message
 */
function showError(message) {
  console.error(message);
  // Could add an error display element if needed
}

function setShareStatus(msg, isError = false) {
  const el = document.getElementById('ccpc_result_share_status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--error)' : '';
}

function buildSharePayload() {
  if (!latestResult || !window.TLM || !window.TLM.shareCard) return null;
  const { combined, incomeSplitting } = latestResult;
  const provinceEl = document.getElementById('province');
  const provinceLabel = (provinceEl && provinceEl.selectedOptions && provinceEl.selectedOptions[0])
    ? provinceEl.selectedOptions[0].textContent
    : 'Selected province';
  return {
    calculatorName: 'ccpc-tax',
    title: 'CCPC Income Tax Calculator | The Long Math',
    brand: 'The Long Math',
    headline: 'CCPC Income Tax Estimate',
    mainValue: formatCurrency(combined.totalTaxBurden || 0),
    subline: 'Combined corporate + personal tax burden',
    contextLines: [
      'Effective overall tax rate: ' + formatPercent(combined.effectiveTaxRate || 0),
      'Net personal take-home: ' + formatCurrency(combined.netPersonalTakeHome || 0),
      'Retained earnings: ' + formatCurrency(combined.retainedEarnings || 0),
      'Mode: ' + (incomeSplitting ? 'Two-shareholder split' : 'Single shareholder'),
      'Corporate tax year start: ' + (latestInputs.corporateTaxYearStart || 'Not specified'),
      'Province/territory: ' + provinceLabel
    ],
    footer: 'Run your own numbers at TheLongMath.com',
    shareText: 'CCPC estimate: total tax burden ' + formatCurrency(combined.totalTaxBurden || 0),
    url: window.location.href
  };
}

function exportCsv() {
  if (!latestResult || !latestInputs) return;
  const { corporate, combined, personal, personal1, personal2, incomeSplitting } = latestResult;
  const rows = [
    'CCPC Income Tax Calculator (export)',
    'Generated,' + new Date().toISOString(),
    'Income splitting mode,' + (incomeSplitting ? 'Yes' : 'No'),
    'Corporate tax year start,' + (latestInputs.corporateTaxYearStart || ''),
    'Gross corporate revenue,' + (latestInputs.grossRevenue || 0),
    'Business expenses,' + (latestInputs.expenses || 0),
    '',
    'Metric,Value',
    'Corporate taxable income,' + (corporate.taxableIncome || 0),
    'Corporate tax,' + (corporate.totalCorporateTax || 0),
    'After-tax corporate cash,' + (corporate.afterTaxCash || 0),
    'Retained earnings,' + (combined.retainedEarnings || 0),
    'Total tax burden,' + (combined.totalTaxBurden || 0),
    'Effective overall tax rate,' + ((combined.effectiveTaxRate || 0) * 100).toFixed(3) + '%'
  ];
  if (incomeSplitting) {
    rows.push('Shareholder 1 personal tax,' + (personal1.totalIncomeTax || 0));
    rows.push('Shareholder 1 net take-home,' + (personal1.takeHomeAfterPayroll || 0));
    rows.push('Shareholder 2 personal tax,' + (personal2.totalIncomeTax || 0));
    rows.push('Shareholder 2 net take-home,' + (personal2.takeHomeAfterPayroll || 0));
  } else if (personal) {
    rows.push('Personal tax,' + (personal.totalIncomeTax || 0));
    rows.push('Net personal take-home,' + (combined.netPersonalTakeHome || 0));
  }
  const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'thelongmath-ccpc-tax-results.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function wireShareButtons() {
  const csvBtn = document.getElementById('ccpc_export_csv_btn');
  const shareBtn = document.getElementById('ccpc_share_result_btn');
  const pngBtn = document.getElementById('ccpc_download_result_btn');
  const copyBtn = document.getElementById('ccpc_copy_result_link_btn');

  if (csvBtn) {
    csvBtn.addEventListener('click', () => {
      exportCsv();
      setShareStatus('CSV downloaded.');
    });
  }
  if (!window.TLM || !window.TLM.shareCard) return;

  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const payload = buildSharePayload();
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
  if (pngBtn) {
    pngBtn.addEventListener('click', async () => {
      const payload = buildSharePayload();
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
        await window.TLM.shareCard.copyResultLink({ url: window.location.href, calculatorName: 'ccpc-tax' });
        setShareStatus('Shareable link copied.');
      } catch (_e) {
        setShareStatus('Could not copy link.', true);
      }
    });
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
