/**
 * UI module for CCPC tax calculator
 * Handles DOM interactions, validation, and rendering
 */

import { computeCCPCTax } from './ccpc.bridge.js';
import { loadCorporateTaxData } from './corporate.data.js';
import { getTaxDataBundle } from '../../canada-income-tax/js/tax.data.js';
import { formatCurrency, formatPercent, parseInput } from './format.js';

let corporateDataLoaded = false;
let personalDataLoaded = false;
let personalTaxData = null;
let taxDataRequestSeq = 0;
let latestInputs = null;
let latestResult = null;

const MAX_SHAREHOLDERS = 5;
let visibleShareholderCount = 2;

const PERSONAL_TAX_DATA_BASE = '/calculators/canada-income-tax/data';

function setDefaultCorporateTaxYearStart(year) {
  const startEl = document.getElementById('corporateTaxYearStart');
  if (startEl) {
    startEl.value = `${year}-01-01`;
  }
}

function loadPersonalTaxData(year) {
  return getTaxDataBundle(year, { basePath: PERSONAL_TAX_DATA_BASE });
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
    const [, personalBundle] = await Promise.all([
      loadCorporateTaxData(2026),
      loadPersonalTaxData(2026)
    ]);
    personalTaxData = personalBundle;
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
  wireAddShareholderSelects();
  updateShareholderInputPanels();

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
      const requestSeq = ++taxDataRequestSeq;
      setDefaultCorporateTaxYearStart(y);
      try {
        corporateDataLoaded = false;
        personalDataLoaded = false;
        const [, personalBundle] = await Promise.all([
          loadCorporateTaxData(y),
          loadPersonalTaxData(y)
        ]);
        if (requestSeq !== taxDataRequestSeq) return;
        personalTaxData = personalBundle;
        corporateDataLoaded = true;
        personalDataLoaded = true;
        updateProvinceNote();
        calculate();
      } catch (error) {
        if (requestSeq !== taxDataRequestSeq) return;
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

function readShareholderInput(index) {
  return {
    salary: parseInput(document.getElementById(`sh${index}Salary`)?.value),
    eligibleDividends: parseInput(document.getElementById(`sh${index}EligibleDividends`)?.value),
    nonEligibleDividends: parseInput(document.getElementById(`sh${index}NonEligibleDividends`)?.value),
    otherIncome: parseInput(document.getElementById(`sh${index}OtherIncome`)?.value),
    capitalGains: parseInput(document.getElementById(`sh${index}CapitalGains`)?.value),
    rrspContribution: parseInput(document.getElementById(`sh${index}RrspContribution`)?.value),
    fhsaDeduction: parseInput(document.getElementById(`sh${index}FhsaDeduction`)?.value),
    deductions: parseInput(document.getElementById(`sh${index}Deductions`)?.value)
  };
}

function setVisibleShareholderCount(count) {
  visibleShareholderCount = Math.min(MAX_SHAREHOLDERS, Math.max(2, count));
  updateShareholderInputPanels();
}

function updateShareholderInputPanels() {
  const splitting = document.getElementById('incomeSplitting')?.checked;
  if (!splitting) return;

  for (let n = 3; n <= MAX_SHAREHOLDERS; n++) {
    const panel = document.getElementById(`shPanel${n}`);
    if (panel) panel.hidden = visibleShareholderCount < n;
  }

  for (let n = 2; n < MAX_SHAREHOLDERS; n++) {
    const addField = document.getElementById(`addShareholderAfter${n}`);
    if (addField) addField.hidden = visibleShareholderCount !== n;
  }
}

function wireAddShareholderSelects() {
  for (let n = 2; n < MAX_SHAREHOLDERS; n++) {
    const select = document.getElementById(`addShareholderSelect${n}`);
    if (!select) continue;
    select.addEventListener('change', () => {
      const nextCount = parseInt(select.value, 10);
      if (nextCount > visibleShareholderCount) {
        setVisibleShareholderCount(nextCount);
      }
      select.value = '';
      calculate();
    });
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
  if (singleResult) singleResult.style.display = enabled ? 'none' : 'flex';
  if (splitResult) splitResult.style.display = enabled ? 'flex' : 'none';
  if (singlePersonalDetail) singlePersonalDetail.style.display = enabled ? 'none' : 'block';
  if (personal1Detail) personal1Detail.style.display = enabled ? 'block' : 'none';
  if (personal2Detail) personal2Detail.style.display = enabled ? 'block' : 'none';

  if (enabled) {
    setVisibleShareholderCount(visibleShareholderCount);
  } else {
    updateShareholderInputPanels();
  }
}

/**
 * Update province notes for AB/QC administration and 2025 NS/PEI mid-year rates.
 */
function updateProvinceNote() {
  const province = document.getElementById('province').value;
  const year = parseInt(document.getElementById('year')?.value, 10);
  const noteEl = document.getElementById('provinceNote');
  const midYearEl = document.getElementById('midYearRateNote');
  if (noteEl) {
    noteEl.style.display = (province === 'AB' || province === 'QC') ? 'block' : 'none';
  }
  if (midYearEl) {
    const showMidYear = year === 2025 && (province === 'NS' || province === 'PE');
    midYearEl.style.display = showMidYear ? 'block' : 'none';
  }
}

/**
 * Reset all input fields to default/empty values
 */
function resetAllInputs() {
  const yearSelect = document.getElementById('year');
  const yearChanged = yearSelect?.value !== '2026';
  if (yearSelect) yearSelect.value = '2026';
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
  document.getElementById('capitalGains').value = '';
  document.getElementById('rrspContribution').value = '';
  document.getElementById('fhsaDeduction').value = '';
  document.getElementById('personalDeductions').value = '';

  document.getElementById('sh1Salary').value = '';
  document.getElementById('sh1EligibleDividends').value = '';
  document.getElementById('sh1NonEligibleDividends').value = '';
  document.getElementById('sh1OtherIncome').value = '';
  document.getElementById('sh1CapitalGains').value = '';
  document.getElementById('sh1RrspContribution').value = '';
  document.getElementById('sh1FhsaDeduction').value = '';
  document.getElementById('sh1Deductions').value = '';
  document.getElementById('sh2Salary').value = '';
  document.getElementById('sh2EligibleDividends').value = '';
  document.getElementById('sh2NonEligibleDividends').value = '';
  document.getElementById('sh2OtherIncome').value = '';
  document.getElementById('sh2CapitalGains').value = '';
  document.getElementById('sh2RrspContribution').value = '';
  document.getElementById('sh2FhsaDeduction').value = '';
  document.getElementById('sh2Deductions').value = '';
  for (let n = 3; n <= MAX_SHAREHOLDERS; n++) {
    document.getElementById(`sh${n}Salary`).value = '';
    document.getElementById(`sh${n}EligibleDividends`).value = '';
    document.getElementById(`sh${n}NonEligibleDividends`).value = '';
    document.getElementById(`sh${n}OtherIncome`).value = '';
    document.getElementById(`sh${n}CapitalGains`).value = '';
    document.getElementById(`sh${n}RrspContribution`).value = '';
    document.getElementById(`sh${n}FhsaDeduction`).value = '';
    document.getElementById(`sh${n}Deductions`).value = '';
  }
  setVisibleShareholderCount(2);

  clearResults();

  document.getElementById('corporateBreakdown').innerHTML = '';
  document.getElementById('personalBreakdown').innerHTML = '';
  const pb1 = document.getElementById('personal1Breakdown');
  const pb2 = document.getElementById('personal2Breakdown');
  const extraBreakdowns = document.getElementById('splitPersonalBreakdowns');
  if (pb1) pb1.innerHTML = '';
  if (pb2) pb2.innerHTML = '';
  if (extraBreakdowns) extraBreakdowns.innerHTML = '';

  updateProvinceNote();
  if (yearChanged && yearSelect) {
    yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
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
    const shareholders = [];
    for (let i = 1; i <= visibleShareholderCount; i++) {
      shareholders.push(readShareholderInput(i));
    }
    base.shareholders = shareholders;
    base.shareholder1 = shareholders[0];
    base.shareholder2 = shareholders[1];
  } else {
    base.salary = parseInput(document.getElementById('salary').value);
    base.eligibleDividends = parseInput(document.getElementById('eligibleDividends').value);
    base.nonEligibleDividends = parseInput(document.getElementById('nonEligibleDividends').value);
    base.personalOtherIncome = parseInput(document.getElementById('personalOtherIncome').value);
    base.capitalGains = parseInput(document.getElementById('capitalGains').value);
    base.rrspContribution = parseInput(document.getElementById('rrspContribution').value);
    base.fhsaDeduction = parseInput(document.getElementById('fhsaDeduction').value);
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

    const result = computeCCPCTax(inputs, { taxData: personalTaxData });
    latestInputs = inputs;
    latestResult = result;

    renderResults(result);
    renderBreakdown(result);
  } catch (error) {
    console.error('Calculation error:', error);
    showError('Calculation error: ' + error.message);
  }
}

function renderFundingNotes(notes) {
  const el = document.getElementById('fundingAssumptionNote');
  if (!el) return;
  if (!notes || !notes.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const paragraphs = notes.map((n) => {
    if (n.code === 'salary_exceeds_current_year_income') {
      return `Salary plus employer CPP (${formatCurrency(n.compensationCost)}) exceeds this year’s modeled corporate income before compensation (${formatCurrency(n.corporateIncomeBeforeCompensation)}). Corporate taxable income is floored at $0, but the salary is still taxed as paid. The illustration assumes other corporate resources (for example prior cash) fund the difference. Opening cash is not modeled.`;
    }
    if (n.code === 'dividends_exceed_current_year_cash') {
      return `Dividends (${formatCurrency(n.dividendDistributions)}) exceed this year’s after-tax corporate cash (${formatCurrency(n.afterTaxCorporateCash)}). Retained earnings are shown as $0. The extra amount is an implicit prior-cash assumption. GRIP and RDTOH are not tracked.`;
    }
    return '';
  }).filter(Boolean);
  el.innerHTML = '<p style="margin:0 0 8px;font-weight:600;color:var(--text);">Funding assumption</p>' +
    paragraphs.map((p) => `<p style="margin:0 0 8px;line-height:1.5;">${p}</p>`).join('');
  el.style.display = 'block';
}

function payrollAmountIsNonZero(amount) {
  return (Number(amount) || 0) > 0.005;
}

function setNonZeroResultRow(valueEl, rowEl, amount) {
  if (!valueEl || !rowEl) return;
  const n = Number(amount) || 0;
  const show = payrollAmountIsNonZero(n);
  valueEl.textContent = formatCurrency(n);
  rowEl.hidden = !show;
}

function shareholderCppEi(totals) {
  return (totals?.cpp || 0) + (totals?.ei || 0);
}

function shareholderResultMetric(label, value) {
  return `
    <div class="panel-metric">
      <p class="k">${label}</p>
      <p class="v">${value}</p>
    </div>
  `;
}

function renderSplitShareholderResults(shareholders) {
  const container = document.getElementById('splitShareholderResults');
  if (!container) return;
  container.innerHTML = '';

  shareholders.forEach((sh, idx) => {
    const cppEi = shareholderCppEi(sh);
    const metrics = [
      shareholderResultMetric('Personal Income Tax Rate', formatPercent(sh.avgRate || 0)),
      shareholderResultMetric('Personal Income Tax', formatCurrency(sh.totalIncomeTax)),
      shareholderResultMetric('Net Take-Home', formatCurrency(sh.takeHomeAfterPayroll))
    ];

    const cppFooter = payrollAmountIsNonZero(cppEi)
      ? `
        <div class="panel-inline-subcard">
          <span class="k">Employee CPP and EI</span>
          <span class="v">${formatCurrency(cppEi)}</span>
        </div>
      `
      : '';

    const panel = document.createElement('div');
    panel.className = 'shareholder-result-panel';
    panel.innerHTML = `
      <h4 class="panel-title">Shareholder ${idx + 1}</h4>
      <div class="panel-metrics">${metrics.join('')}</div>
      ${cppFooter}
    `;
    container.appendChild(panel);
  });
}

/**
 * Render main results
 */
function renderResults(result) {
  const { corporate, personal, combined, incomeSplitting, shareholders } = result;
  renderFundingNotes(combined.fundingNotes);

  if (incomeSplitting) {
    document.getElementById('splitCorporateTaxableIncome').textContent = formatCurrency(corporate.taxableIncome);
    document.getElementById('splitCorporateTax').textContent = formatCurrency(corporate.totalCorporateTax);
    setNonZeroResultRow(
      document.getElementById('splitEmployerCpp'),
      document.getElementById('splitEmployerCppRow'),
      combined.employerCppExpense || 0
    );
    document.getElementById('splitAfterTaxCorporateCash').textContent = formatCurrency(corporate.afterTaxCash);
    document.getElementById('splitRetainedEarnings').textContent = formatCurrency(combined.retainedEarnings);
    renderSplitShareholderResults(shareholders || []);
    document.getElementById('splitTotalTaxBurden').textContent = formatCurrency(combined.totalTaxBurden);
    document.getElementById('splitEffectiveTaxRate').textContent = formatPercent(combined.effectiveTaxRate);
    document.getElementById('splitSummaryTotalTakeHome').textContent = formatCurrency(combined.netPersonalTakeHome);
  } else {
    document.getElementById('corporateTaxableIncome').textContent = formatCurrency(corporate.taxableIncome);
    document.getElementById('corporateTax').textContent = formatCurrency(corporate.totalCorporateTax);
    setNonZeroResultRow(
      document.getElementById('employerCpp'),
      document.getElementById('employerCppRow'),
      combined.employerCppExpense || 0
    );
    document.getElementById('afterTaxCorporateCash').textContent = formatCurrency(corporate.afterTaxCash);
    document.getElementById('retainedEarnings').textContent = formatCurrency(combined.retainedEarnings);
    document.getElementById('personalTax').textContent = formatCurrency(personal.totalIncomeTax);
    setNonZeroResultRow(
      document.getElementById('employeeCppEi'),
      document.getElementById('employeeCppEiRow'),
      combined.employeeCppEi || 0
    );
    document.getElementById('totalTaxBurden').textContent = formatCurrency(combined.totalTaxBurden);
    document.getElementById('effectiveTaxRate').textContent = formatPercent(combined.effectiveTaxRate);
    document.getElementById('summaryTotalTakeHome').textContent = formatCurrency(combined.netPersonalTakeHome);
  }
}

function renderSplitPersonalBreakdowns(shareholders) {
  const extraContainer = document.getElementById('splitPersonalBreakdowns');
  if (shareholders[0]) {
    renderPersonalBreakdown(shareholders[0], document.getElementById('personal1Breakdown'));
  }
  if (shareholders[1]) {
    renderPersonalBreakdown(shareholders[1], document.getElementById('personal2Breakdown'));
  }
  if (extraContainer) {
    extraContainer.innerHTML = '';
    for (let i = 2; i < shareholders.length; i++) {
      const n = i + 1;
      const details = document.createElement('details');
      details.className = 'method-item method-item-split';
      details.innerHTML = `
        <summary><strong>Personal Tax — Shareholder ${n}</strong></summary>
        <div class="breakdown-content"></div>
      `;
      extraContainer.appendChild(details);
      renderPersonalBreakdown(shareholders[i], details.querySelector('.breakdown-content'));
    }
  }
}

/**
 * Render breakdown sections
 */
function renderBreakdown(result) {
  renderCorporateBreakdown(result.corporate);
  if (result.incomeSplitting) {
    renderSplitPersonalBreakdowns(result.shareholders || []);
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
    <p>Total Personal Income Tax: ${formatCurrency(personal.totalIncomeTax)}</p>
    <p>CPP: ${formatCurrency(personal.cpp)}</p>
    <p>EI: ${formatCurrency(personal.ei)}</p>
    <p>Income tax + employee CPP/EI: ${formatCurrency(personal.totalBurden)}</p>
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
  document.getElementById('totalTaxBurden').textContent = '$–';
  document.getElementById('effectiveTaxRate').textContent = '–%';
  document.getElementById('summaryTotalTakeHome').textContent = '$–';
  setNonZeroResultRow(document.getElementById('employerCpp'), document.getElementById('employerCppRow'), 0);
  setNonZeroResultRow(document.getElementById('employeeCppEi'), document.getElementById('employeeCppEiRow'), 0);
  renderFundingNotes([]);

  const splitIds = [
    'splitCorporateTaxableIncome', 'splitCorporateTax', 'splitAfterTaxCorporateCash', 'splitRetainedEarnings',
    'splitTotalTaxBurden', 'splitEffectiveTaxRate', 'splitSummaryTotalTakeHome'
  ];
  splitIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id.includes('Effective') ? '–%' : '$–';
  });
  setNonZeroResultRow(document.getElementById('splitEmployerCpp'), document.getElementById('splitEmployerCppRow'), 0);
  const splitShareholders = document.getElementById('splitShareholderResults');
  if (splitShareholders) splitShareholders.innerHTML = '';
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
    subline: 'Corporate + personal income tax',
    contextLines: [
      'Effective overall income-tax rate (% of gross revenue): ' + formatPercent(combined.effectiveTaxRate || 0),
      'Employee CPP and EI: ' + formatCurrency(combined.employeeCppEi || 0),
      'Employer CPP: ' + formatCurrency(combined.employerCppExpense || 0),
      'Net personal take-home: ' + formatCurrency(combined.netPersonalTakeHome || 0),
      'Retained earnings: ' + formatCurrency(combined.retainedEarnings || 0),
      'Mode: ' + (incomeSplitting
        ? `${latestResult.shareholderCount || 2}-shareholder split`
        : 'Single shareholder'),
      'Corporate tax year start: ' + (latestInputs.corporateTaxYearStart || 'Not specified'),
      'Province/territory: ' + provinceLabel
    ],
    footer: 'Run your own numbers at TheLongMath.com',
    shareText: 'CCPC estimate: total income tax ' + formatCurrency(combined.totalTaxBurden || 0),
    url: window.location.href
  };
}

function exportCsv() {
  if (!latestResult || !latestInputs) return;
  const { corporate, combined, personal, shareholders, incomeSplitting } = latestResult;
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
    'Employer CPP,' + (combined.employerCppExpense || 0),
    'After-tax corporate cash,' + (corporate.afterTaxCash || 0),
    'Retained earnings,' + (combined.retainedEarnings || 0),
    'Total income tax (corporate + personal),' + (combined.totalTaxBurden || 0),
    'Employee CPP and EI,' + (combined.employeeCppEi || 0),
    'Effective overall income-tax rate (% of gross revenue),' + ((combined.effectiveTaxRate || 0) * 100).toFixed(3) + '%'
  ];
  if (incomeSplitting && shareholders) {
    shareholders.forEach((sh, idx) => {
      rows.push(`Shareholder ${idx + 1} personal tax,${sh.totalIncomeTax || 0}`);
      rows.push(`Shareholder ${idx + 1} net take-home,${sh.takeHomeAfterPayroll || 0}`);
    });
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
