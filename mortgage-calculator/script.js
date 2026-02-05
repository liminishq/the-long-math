/* ============================================================
   Mortgage Calculator — Main Script
   ============================================================
   
   Handles mortgage calculations, amortization schedules,
   graph rendering, and real-time UI updates.
   ============================================================ */

// ============================================================
// Formatting Utilities
// ============================================================
const formatter = {
  currency: new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }),

  percent: (value) => {
    return value.toFixed(2) + '%';
  },

  number: (value, decimals = 0) => {
    return new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }
};

// ============================================================
// Mortgage Calculation Engine
// ============================================================

/**
 * Calculate standard monthly payment for fixed-rate mortgage
 * Formula: P * r / (1 - (1+r)^-n)
 * Where P = principal, r = periodic rate, n = number of payments
 */
function calculateMonthlyPayment(principal, annualRate, years) {
  if (annualRate === 0) {
    return principal / (years * 12);
  }
  const monthlyRate = annualRate / 100 / 12;
  const numPayments = years * 12;
  const payment = principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -numPayments));
  return payment;
}

/**
 * Calculate payment amount based on frequency
 * For accelerated schedules, use monthly payment / frequency multiplier
 */
function calculatePaymentAmount(principal, annualRate, years, frequency) {
  const monthlyPayment = calculateMonthlyPayment(principal, annualRate, years);
  
  switch (frequency) {
    case 'monthly':
      return monthlyPayment;
    case 'biweekly':
      // Standard bi-weekly: monthly payment * 12 / 26
      return monthlyPayment * 12 / 26;
    case 'accelerated_biweekly':
      // Accelerated: monthly payment / 2
      return monthlyPayment / 2;
    case 'weekly':
      // Standard weekly: monthly payment * 12 / 52
      return monthlyPayment * 12 / 52;
    case 'accelerated_weekly':
      // Accelerated: monthly payment / 4
      return monthlyPayment / 4;
    default:
      return monthlyPayment;
  }
}

/**
 * Get payments per year for frequency
 */
function getPaymentsPerYear(frequency) {
  switch (frequency) {
    case 'monthly': return 12;
    case 'biweekly': return 26;
    case 'accelerated_biweekly': return 26;
    case 'weekly': return 52;
    case 'accelerated_weekly': return 52;
    default: return 12;
  }
}

/**
 * Build full amortization schedule
 * Returns: {
 *   schedule: array of payment objects,
 *   totalInterest: number,
 *   totalPaid: number,
 *   payoffYears: number,
 *   balanceOverTime: array of {year, balance},
 *   interestOverTime: array of {year, cumulativeInterest}
 * }
 */
function buildAmortizationSchedule(principal, annualRate, years, frequency) {
  const paymentAmount = calculatePaymentAmount(principal, annualRate, years, frequency);
  const paymentsPerYear = getPaymentsPerYear(frequency);
  const periodicRate = annualRate / 100 / paymentsPerYear;
  const totalPayments = years * paymentsPerYear;
  
  const schedule = [];
  let balance = principal;
  let totalInterest = 0;
  let cumulativeInterest = 0;
  
  // Arrays for graph plotting (annual snapshots)
  const balanceOverTime = [{ year: 0, balance: principal }];
  const interestOverTime = [{ year: 0, cumulativeInterest: 0 }];
  
  let currentYear = 0;
  let yearStartBalance = principal;
  let yearInterest = 0;
  let yearPrincipal = 0;
  let yearPayments = 0;
  
  // Check if payment is sufficient
  if (periodicRate > 0 && paymentAmount <= balance * periodicRate) {
    return {
      error: 'Payment does not amortize the loan at this rate.',
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0,
      balanceOverTime: [],
      interestOverTime: []
    };
  }
  
  for (let paymentNum = 1; paymentNum <= totalPayments && balance > 0.01; paymentNum++) {
    const yearFraction = paymentNum / paymentsPerYear;
    const newYear = Math.floor(yearFraction);
    
    // Calculate interest and principal for this payment
    let interestPortion, principalPortion;
    
    if (periodicRate === 0) {
      // Zero interest case
      interestPortion = 0;
      principalPortion = paymentAmount;
    } else {
      interestPortion = balance * periodicRate;
      principalPortion = paymentAmount - interestPortion;
    }
    
    // Ensure we don't overpay
    if (principalPortion > balance) {
      principalPortion = balance;
      paymentAmount = principalPortion + interestPortion;
    }
    
    balance -= principalPortion;
    totalInterest += interestPortion;
    cumulativeInterest += interestPortion;
    
    // Track annual summaries
    yearInterest += interestPortion;
    yearPrincipal += principalPortion;
    yearPayments += paymentAmount;
    
    schedule.push({
      paymentNum,
      paymentAmount,
      interestPortion,
      principalPortion,
      balance: Math.max(0, balance)
    });
    
    // Annual snapshots for graph
    if (newYear > currentYear || paymentNum === totalPayments) {
      balanceOverTime.push({ year: newYear, balance: Math.max(0, balance) });
      interestOverTime.push({ year: newYear, cumulativeInterest });
      currentYear = newYear;
    }
  }
  
  const payoffYears = schedule.length / paymentsPerYear;
  
  return {
    schedule,
    totalInterest,
    totalPaid: principal + totalInterest,
    payoffYears,
    balanceOverTime,
    interestOverTime
  };
}

// ============================================================
// Graph Rendering (Canvas)
// ============================================================

class MortgageChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const oldWidth = this.canvas.width;
    const oldHeight = this.canvas.height;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    // Force redraw after resize
    this.draw();
  }
  
  // Force a redraw (useful for recovery)
  redraw() {
    if (this.data) {
      this.draw();
    }
  }
  
  setData(data) {
    // Always replace data completely to ensure clean state
    this.data = data ? { ...data } : null;
    // Force redraw
    this.draw();
  }
  
  draw() {
    try {
      const ctx = this.ctx;
      const width = this.canvas.width / (window.devicePixelRatio || 1);
      const height = this.canvas.height / (window.devicePixelRatio || 1);
      
      // Always clear canvas first
      ctx.clearRect(0, 0, width, height);
      
      // Check for error or missing data
      if (!this.data || this.data.error) {
        this.drawError();
        return;
      }
      
      const padding = { top: 20, right: 20, bottom: 40, left: 70 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      
      const { balanceOverTime, interestOverTime } = this.data;
      
      // Validate data structure
      if (!balanceOverTime || !interestOverTime || 
          !Array.isArray(balanceOverTime) || !Array.isArray(interestOverTime) ||
          balanceOverTime.length === 0 || interestOverTime.length === 0) {
        // Draw empty state message
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,.72)';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data to display', width / 2, height / 2);
        return;
      }
      
      // Validate data points have required properties
      if (balanceOverTime.length > 0 && interestOverTime.length > 0) {
        if (!balanceOverTime[0].hasOwnProperty('year') || !balanceOverTime[0].hasOwnProperty('balance') ||
            !interestOverTime[0].hasOwnProperty('year') || !interestOverTime[0].hasOwnProperty('cumulativeInterest')) {
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,.72)';
          ctx.font = '14px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Invalid data structure', width / 2, height / 2);
          return;
        }
      }
      
      // Find max values for scaling
      const maxYear = Math.max(
        ...balanceOverTime.map(d => d.year),
        ...interestOverTime.map(d => d.year),
        1 // Ensure at least 1 year
      );
      const maxValue = Math.max(
        ...balanceOverTime.map(d => d.balance),
        ...interestOverTime.map(d => d.cumulativeInterest),
        1000 // Ensure minimum scale
      );
      
      const yMax = maxValue * 1.1; // 10% padding
      
      // Helper to convert data to screen coordinates
      const xScale = (year) => padding.left + (year / maxYear) * chartWidth;
      const yScale = (value) => padding.top + chartHeight - (value / yMax) * chartHeight;
      
      // Draw grid lines
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border') || 'rgba(238,242,247,.14)';
      ctx.lineWidth = 1;
      
      // Horizontal grid lines (Y axis)
      for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
      }
      
      // Vertical grid lines (X axis)
      for (let i = 0; i <= 5; i++) {
        const x = padding.left + (chartWidth / 5) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartHeight);
        ctx.stroke();
      }
      
      // Draw curves
      ctx.lineWidth = 2;
      
      // Remaining principal curve (amber)
      ctx.strokeStyle = '#D9B46A';
      ctx.beginPath();
      for (let i = 0; i < balanceOverTime.length; i++) {
        const point = balanceOverTime[i];
        const x = xScale(point.year);
        const y = yScale(point.balance);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      
      // Cumulative interest curve (blue)
      ctx.strokeStyle = '#4A90E2';
      ctx.beginPath();
      for (let i = 0; i < interestOverTime.length; i++) {
        const point = interestOverTime[i];
        const x = xScale(point.year);
        const y = yScale(point.cumulativeInterest);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      
      // Draw axes
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#eef2f7';
      ctx.lineWidth = 1;
      
      // X axis
      ctx.beginPath();
      ctx.moveTo(padding.left, padding.top + chartHeight);
      ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
      ctx.stroke();
      
      // Y axis
      ctx.beginPath();
      ctx.moveTo(padding.left, padding.top);
      ctx.lineTo(padding.left, padding.top + chartHeight);
      ctx.stroke();
      
      // Axis labels
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,.72)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      
      // X axis labels (years)
      for (let i = 0; i <= 5; i++) {
        const year = (maxYear / 5) * i;
        const x = xScale(year);
        ctx.fillText(Math.round(year), x, padding.top + chartHeight + 8);
      }
      
      // Y axis labels (dollars)
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 5; i++) {
        const value = (yMax / 5) * (5 - i);
        const y = padding.top + (chartHeight / 5) * i;
        const label = formatter.currency.format(value);
        ctx.fillText(label, padding.left - 8, y);
      }
      
      // Axis titles
      ctx.textAlign = 'center';
      ctx.fillText('Years', width / 2, height - 10);
      
      ctx.save();
      ctx.translate(15, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('Dollars', 0, 0);
      ctx.restore();
    } catch (error) {
      // If any error occurs during drawing, show error message
      console.error('Graph drawing error:', error);
      this.drawError();
    }
  }
  
  drawError() {
    const ctx = this.ctx;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,.72)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Unable to calculate amortization', width / 2, height / 2);
  }
}

// ============================================================
// UI State and Updates
// ============================================================

let chart = null;
let updateTimeout = null;

function getInputs() {
  const homePrice = parseFloat(document.getElementById('home_price').value) || 500000;
  const downPaymentAmount = parseFloat(document.getElementById('down_payment_amount').value) || 100000;
  const downPaymentPercent = parseFloat(document.getElementById('down_payment_percent').value) || 20;
  const isAmountMode = document.getElementById('down_payment_mode_amount').classList.contains('active');
  const interestRate = parseFloat(document.getElementById('interest_rate').value) || 5.5;
  const amortizationYears = parseFloat(document.getElementById('amortization_years').value) || 25;
  const paymentFrequency = document.getElementById('payment_frequency').value;
  
  // Calculate down payment based on mode
  let downPayment;
  if (isAmountMode) {
    downPayment = Math.min(downPaymentAmount, homePrice);
  } else {
    downPayment = homePrice * (downPaymentPercent / 100);
  }
  
  const loanAmount = Math.max(0, homePrice - downPayment);
  
  return {
    homePrice,
    downPayment,
    loanAmount,
    interestRate,
    amortizationYears,
    paymentFrequency,
    isAmountMode
  };
}

function updateOutputs(data) {
  const summarySentence = document.getElementById('summary_sentence');
  
  if (data.error) {
    document.getElementById('out_payment').textContent = '—';
    document.getElementById('out_loan_amount').textContent = '—';
    document.getElementById('out_total_interest').textContent = '—';
    document.getElementById('out_total_paid').textContent = '—';
    document.getElementById('out_payoff_time').textContent = '—';
    
    // Restore summary sentence structure if it was replaced
    if (!summarySentence.querySelector('#summary_years')) {
      summarySentence.innerHTML = 'With these inputs, the mortgage is paid off in <span id="summary_years">–</span> years, with <span id="summary_interest">$–</span> paid in interest and <span id="summary_total">$–</span> paid in total mortgage payments (principal + interest).';
    }
    summarySentence.innerHTML = '<span class="error-state">Payment does not amortize the loan at this rate.</span>';
    return;
  }
  
  // Restore summary sentence structure if it was replaced by error
  if (!summarySentence.querySelector('#summary_years')) {
    summarySentence.innerHTML = 'With these inputs, the mortgage is paid off in <span id="summary_years">–</span> years, with <span id="summary_interest">$–</span> paid in interest and <span id="summary_total">$–</span> paid in total mortgage payments (principal + interest).';
  }
  
  const inputs = getInputs();
  
  // Handle zero loan amount case
  if (inputs.loanAmount === 0) {
    document.getElementById('out_payment').textContent = formatter.currency.format(0);
    document.getElementById('out_loan_amount').textContent = formatter.currency.format(0);
    document.getElementById('out_total_interest').textContent = formatter.currency.format(0);
    document.getElementById('out_total_paid').textContent = formatter.currency.format(0);
    document.getElementById('out_payoff_time').textContent = '0 years';
    
    document.getElementById('summary_years').textContent = '0';
    document.getElementById('summary_interest').textContent = formatter.currency.format(0);
    document.getElementById('summary_total').textContent = formatter.currency.format(0);
    return;
  }
  
  const paymentAmount = calculatePaymentAmount(inputs.loanAmount, inputs.interestRate, inputs.amortizationYears, inputs.paymentFrequency);
  
  document.getElementById('out_payment').textContent = formatter.currency.format(paymentAmount);
  document.getElementById('out_loan_amount').textContent = formatter.currency.format(inputs.loanAmount);
  document.getElementById('out_total_interest').textContent = formatter.currency.format(data.totalInterest);
  document.getElementById('out_total_paid').textContent = formatter.currency.format(data.totalPaid);
  
  const payoffYears = data.payoffYears;
  const payoffDisplay = payoffYears % 1 === 0 ? payoffYears.toString() : payoffYears.toFixed(1);
  document.getElementById('out_payoff_time').textContent = payoffDisplay + ' years';
  
  // Update summary sentence
  document.getElementById('summary_years').textContent = payoffDisplay;
  document.getElementById('summary_interest').textContent = formatter.currency.format(data.totalInterest);
  document.getElementById('summary_total').textContent = formatter.currency.format(data.totalPaid);
}

function updateGraph(data) {
  if (chart) {
    chart.setData(data);
  }
}

function updateTables(data) {
  if (data.error || !data.schedule) {
    document.getElementById('table_12months_body').innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Unable to calculate amortization</td></tr>';
    document.getElementById('table_annual_body').innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Unable to calculate amortization</td></tr>';
    return;
  }
  
  // First 12 months table (first 12 payment periods)
  const tbody12 = document.getElementById('table_12months_body');
  tbody12.innerHTML = '';
  
  const first12Payments = data.schedule.slice(0, 12);
  if (first12Payments.length === 0) {
    tbody12.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">No payments to display</td></tr>';
  } else {
    first12Payments.forEach(payment => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${payment.paymentNum}</td>
        <td>${formatter.currency.format(payment.paymentAmount)}</td>
        <td>${formatter.currency.format(payment.interestPortion)}</td>
        <td>${formatter.currency.format(payment.principalPortion)}</td>
        <td>${formatter.currency.format(payment.balance)}</td>
      `;
      tbody12.appendChild(row);
    });
  }
  
  // Annual summary table
  const tbodyAnnual = document.getElementById('table_annual_body');
  tbodyAnnual.innerHTML = '';
  
  const inputs = getInputs();
  const paymentsPerYear = getPaymentsPerYear(inputs.paymentFrequency);
  const annualData = [];
  
  let currentYear = 0;
  let yearPayments = 0;
  let yearInterest = 0;
  let yearPrincipal = 0;
  let yearStartBalance = inputs.loanAmount;
  let lastPaymentInYear = null;
  
  data.schedule.forEach((payment, idx) => {
    const paymentYear = Math.floor((payment.paymentNum - 1) / paymentsPerYear);
    
    if (paymentYear > currentYear && currentYear >= 0) {
      // Save previous year
      annualData.push({
        year: currentYear + 1, // Display as year 1, 2, 3...
        totalPayments: yearPayments,
        totalInterest: yearInterest,
        totalPrincipal: yearPrincipal,
        endingBalance: lastPaymentInYear ? lastPaymentInYear.balance : yearStartBalance
      });
      // Start new year
      currentYear = paymentYear;
      yearStartBalance = lastPaymentInYear ? lastPaymentInYear.balance : inputs.loanAmount;
      yearPayments = 0;
      yearInterest = 0;
      yearPrincipal = 0;
    }
    
    yearPayments += payment.paymentAmount;
    yearInterest += payment.interestPortion;
    yearPrincipal += payment.principalPortion;
    lastPaymentInYear = payment;
  });
  
  // Add final year
  if (data.schedule.length > 0) {
    annualData.push({
      year: currentYear + 1, // Display as year 1, 2, 3...
      totalPayments: yearPayments,
      totalInterest: yearInterest,
      totalPrincipal: yearPrincipal,
      endingBalance: data.schedule[data.schedule.length - 1].balance
    });
  }
  
  annualData.forEach(yearData => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${yearData.year}</td>
      <td>${formatter.currency.format(yearData.totalPayments)}</td>
      <td>${formatter.currency.format(yearData.totalInterest)}</td>
      <td>${formatter.currency.format(yearData.totalPrincipal)}</td>
      <td>${formatter.currency.format(yearData.endingBalance)}</td>
    `;
    tbodyAnnual.appendChild(row);
  });
}

function recalculate() {
  const inputs = getInputs();
  
  if (inputs.loanAmount < 0 || inputs.amortizationYears <= 0 || inputs.homePrice <= 0) {
    const errorData = { error: 'Invalid inputs', schedule: [], totalInterest: 0, totalPaid: 0, payoffYears: 0, balanceOverTime: [], interestOverTime: [] };
    updateOutputs(errorData);
    updateGraph(errorData);
    updateTables(errorData);
    return;
  }
  
  // Handle zero loan amount case (no mortgage needed)
  if (inputs.loanAmount === 0) {
    const zeroData = {
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0,
      balanceOverTime: [{ year: 0, balance: 0 }],
      interestOverTime: [{ year: 0, cumulativeInterest: 0 }]
    };
    updateOutputs(zeroData);
    updateGraph(zeroData);
    updateTables(zeroData);
    return;
  }
  
  const data = buildAmortizationSchedule(
    inputs.loanAmount,
    inputs.interestRate,
    inputs.amortizationYears,
    inputs.paymentFrequency
  );
  
  updateOutputs(data);
  updateGraph(data);
  updateTables(data);
}

function debouncedRecalculate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    requestAnimationFrame(recalculate);
  }, 10);
}

// ============================================================
// Slider Management
// ============================================================

function updateSlider() {
  const inputs = getInputs();
  const sliderTarget = document.querySelector('input[name="slider_target"]:checked').value;
  const slider = document.getElementById('active_slider');
  const sliderLabel = document.getElementById('slider_label');
  const sliderValue = document.getElementById('slider_value');
  
  let min, max, step, value, displayValue;
  
  switch (sliderTarget) {
    case 'price':
      min = 50000;
      max = 3000000;
      step = 1000;
      value = inputs.homePrice;
      displayValue = formatter.currency.format(value);
      sliderLabel.textContent = 'Home price';
      break;
    case 'down_payment':
      if (inputs.isAmountMode) {
        min = 0;
        max = inputs.homePrice;
        step = 1000;
        value = inputs.downPayment;
        displayValue = formatter.currency.format(value);
        sliderLabel.textContent = 'Down payment amount';
      } else {
        min = 0;
        max = 100;
        step = 0.1;
        value = (inputs.downPayment / inputs.homePrice) * 100;
        displayValue = formatter.percent(value);
        sliderLabel.textContent = 'Down payment %';
      }
      break;
    case 'interest_rate':
      min = 0.5;
      max = 15;
      step = 0.05;
      value = inputs.interestRate;
      displayValue = formatter.percent(value);
      sliderLabel.textContent = 'Interest rate';
      break;
    case 'amortization':
      min = 5;
      max = 40;
      step = 1;
      value = inputs.amortizationYears;
      displayValue = value + ' years';
      sliderLabel.textContent = 'Amortization period';
      break;
  }
  
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = value;
  sliderValue.textContent = displayValue;
  
  // Update slider value display on change
  slider.oninput = () => {
    const newValue = parseFloat(slider.value);
    let newDisplayValue;
    
    switch (sliderTarget) {
      case 'price':
        document.getElementById('home_price').value = newValue;
        newDisplayValue = formatter.currency.format(newValue);
        break;
      case 'down_payment':
        if (inputs.isAmountMode) {
          document.getElementById('down_payment_amount').value = newValue;
          newDisplayValue = formatter.currency.format(newValue);
        } else {
          document.getElementById('down_payment_percent').value = newValue;
          newDisplayValue = formatter.percent(newValue);
        }
        break;
      case 'interest_rate':
        document.getElementById('interest_rate').value = newValue;
        newDisplayValue = formatter.percent(newValue);
        break;
      case 'amortization':
        document.getElementById('amortization_years').value = newValue;
        newDisplayValue = newValue + ' years';
        break;
    }
    
    sliderValue.textContent = newDisplayValue;
    debouncedRecalculate();
  };
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners() {
  // Input changes
  const inputs = ['home_price', 'down_payment_amount', 'down_payment_percent', 'interest_rate', 'amortization_years', 'payment_frequency'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        // Sync down payment when home price changes
        if (id === 'home_price') {
          const inputs = getInputs();
          const isAmountMode = document.getElementById('down_payment_mode_amount').classList.contains('active');
          if (isAmountMode) {
            // Keep amount, update percent
            const percent = (inputs.downPayment / inputs.homePrice) * 100;
            document.getElementById('down_payment_percent').value = percent.toFixed(1);
          } else {
            // Keep percent, update amount
            const percent = parseFloat(document.getElementById('down_payment_percent').value) || 20;
            const amount = inputs.homePrice * (percent / 100);
            document.getElementById('down_payment_amount').value = Math.round(amount);
          }
        }
        updateSlider();
        debouncedRecalculate();
      });
    }
  });
  
  // Down payment mode toggle
  document.getElementById('down_payment_mode_amount').addEventListener('click', () => {
    document.getElementById('down_payment_mode_amount').classList.add('active');
    document.getElementById('down_payment_mode_percent').classList.remove('active');
    document.getElementById('down_payment_amount_row').style.display = 'grid';
    document.getElementById('down_payment_percent_row').style.display = 'none';
    updateSlider();
    debouncedRecalculate();
  });
  
  document.getElementById('down_payment_mode_percent').addEventListener('click', () => {
    document.getElementById('down_payment_mode_percent').classList.add('active');
    document.getElementById('down_payment_mode_amount').classList.remove('active');
    document.getElementById('down_payment_amount_row').style.display = 'none';
    document.getElementById('down_payment_percent_row').style.display = 'grid';
    
    // Sync percent from amount
    const inputs = getInputs();
    const percent = (inputs.downPayment / inputs.homePrice) * 100;
    document.getElementById('down_payment_percent').value = percent.toFixed(1);
    
    updateSlider();
    debouncedRecalculate();
  });
  
  // Sync down payment amount and percent
  document.getElementById('down_payment_amount').addEventListener('input', () => {
    const inputs = getInputs();
    const percent = (inputs.downPayment / inputs.homePrice) * 100;
    document.getElementById('down_payment_percent').value = percent.toFixed(1);
  });
  
  document.getElementById('down_payment_percent').addEventListener('input', () => {
    const inputs = getInputs();
    const amount = inputs.homePrice * (parseFloat(document.getElementById('down_payment_percent').value) / 100);
    document.getElementById('down_payment_amount').value = Math.round(amount);
  });
  
  // Slider target selection
  document.querySelectorAll('input[name="slider_target"]').forEach(radio => {
    radio.addEventListener('change', () => {
      updateSlider();
    });
  });
  
  // Accordion toggles
  document.getElementById('accordion_12months').addEventListener('click', () => {
    const content = document.getElementById('accordion_12months_content');
    const button = document.getElementById('accordion_12months');
    const isOpen = content.classList.contains('open');
    content.classList.toggle('open');
    button.textContent = isOpen ? '▼ First 12 months — monthly amortization' : '▲ First 12 months — monthly amortization';
    button.setAttribute('aria-expanded', !isOpen);
  });
  
  document.getElementById('accordion_annual').addEventListener('click', () => {
    const content = document.getElementById('accordion_annual_content');
    const button = document.getElementById('accordion_annual');
    const isOpen = content.classList.contains('open');
    content.classList.toggle('open');
    button.textContent = isOpen ? '▼ Full amortization — annual summary' : '▲ Full amortization — annual summary';
    button.setAttribute('aria-expanded', !isOpen);
  });
}

// ============================================================
// Initialization
// ============================================================

function init() {
  // Initialize chart
  const canvas = document.getElementById('chartCanvas');
  if (canvas) {
    chart = new MortgageChart(canvas);
  }
  
  // Setup event listeners
  setupEventListeners();
  
  // Initial calculation
  updateSlider();
  recalculate();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
