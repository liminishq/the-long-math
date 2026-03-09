/**
 * UI module for CCPC tax calculator
 * Handles DOM interactions, validation, and rendering
 */

import { computeCCPCTax } from './ccpc.bridge.js';
import { loadCorporateTaxData } from './corporate.data.js';
import { loadTaxData } from './tax.data.js';
import { formatCurrency, formatPercent, parseInput } from './format.js';

let corporateDataLoaded = false;
let personalDataLoaded = false;

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
  document.getElementById('year').value = '2025';

  // Load tax data
  try {
    await Promise.all([
      loadCorporateTaxData(2025),
      loadTaxData(2025)
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

  // Show/hide province note based on selection
  updateProvinceNote();
}

/**
 * Attach event listeners to input fields
 */
function attachEventListeners() {
  const inputs = document.querySelectorAll('input[type="text"], select');
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

  // Reset button
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', resetAllInputs);
  }
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
  document.getElementById('year').value = '2025';
  document.getElementById('province').value = '';
  document.getElementById('grossRevenue').value = '';
  document.getElementById('expenses').value = '';
  document.getElementById('salary').value = '';
  document.getElementById('eligibleDividends').value = '';
  document.getElementById('nonEligibleDividends').value = '';
  document.getElementById('personalOtherIncome').value = '';
  document.getElementById('personalDeductions').value = '';
  
  // Clear results
  clearResults();
  
  // Clear breakdown sections
  document.getElementById('corporateBreakdown').innerHTML = '';
  document.getElementById('personalBreakdown').innerHTML = '';
  
  // Hide province note
  updateProvinceNote();
}

/**
 * Get inputs from form
 */
function getInputs() {
  return {
    year: parseInt(document.getElementById('year').value) || 2025,
    province: document.getElementById('province').value,
    grossRevenue: parseInput(document.getElementById('grossRevenue').value),
    expenses: parseInput(document.getElementById('expenses').value),
    salary: parseInput(document.getElementById('salary').value),
    eligibleDividends: parseInput(document.getElementById('eligibleDividends').value),
    nonEligibleDividends: parseInput(document.getElementById('nonEligibleDividends').value),
    personalOtherIncome: parseInput(document.getElementById('personalOtherIncome').value),
    personalDeductions: parseInput(document.getElementById('personalDeductions').value)
  };
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
  const { corporate, personal, combined } = result;

  // Corporate results
  document.getElementById('corporateTaxableIncome').textContent = formatCurrency(corporate.taxableIncome);
  document.getElementById('corporateTax').textContent = formatCurrency(corporate.totalCorporateTax);
  document.getElementById('afterTaxCorporateCash').textContent = formatCurrency(corporate.afterTaxCash);
  document.getElementById('retainedEarnings').textContent = formatCurrency(combined.retainedEarnings);

  // Personal results
  document.getElementById('personalTax').textContent = formatCurrency(personal.totalIncomeTax);
  document.getElementById('netPersonalTakeHome').textContent = formatCurrency(combined.netPersonalTakeHome);

  // Combined results
  document.getElementById('totalTaxBurden').textContent = formatCurrency(combined.totalTaxBurden);
  document.getElementById('effectiveTaxRate').textContent = formatPercent(combined.effectiveTaxRate);
}

/**
 * Render breakdown sections
 */
function renderBreakdown(result) {
  renderCorporateBreakdown(result.corporate);
  renderPersonalBreakdown(result.personal);
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
    <p><strong>SBD Limit:</strong> ${formatCurrency(corporate.breakdown.federal.sbdLimit)}</p>
  `;

  container.appendChild(div);
}

/**
 * Render personal tax breakdown (simplified - can expand later)
 */
function renderPersonalBreakdown(personal) {
  const container = document.getElementById('personalBreakdown');
  container.innerHTML = '';

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

  container.appendChild(div);
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
}

/**
 * Show error message
 */
function showError(message) {
  console.error(message);
  // Could add an error display element if needed
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
