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
 * Compute amortization schedule with robust error handling
 * Returns: {
 *   isValid: boolean,
 *   errorMessage: string | null,
 *   pointsBalance: array of {year, balance},
 *   pointsCumInterest: array of {year, cumulativeInterest},
 *   schedule: array of payment objects,
 *   totalInterest: number,
 *   totalPaid: number,
 *   payoffYears: number
 * }
 */
function computeSchedule(principal, annualRate, years, frequency) {
  // Input validation
  if (isNaN(principal) || principal < 0) {
    return {
      isValid: false,
      errorMessage: 'Invalid principal amount',
      pointsBalance: [],
      pointsCumInterest: [],
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0
    };
  }
  
  if (isNaN(annualRate) || annualRate < 0) {
    return {
      isValid: false,
      errorMessage: 'Invalid interest rate',
      pointsBalance: [],
      pointsCumInterest: [],
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0
    };
  }
  
  if (isNaN(years) || years < 1 || years > 40) {
    return {
      isValid: false,
      errorMessage: 'Invalid amortization period',
      pointsBalance: [],
      pointsCumInterest: [],
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0
    };
  }
  
  if (principal === 0) {
    return {
      isValid: true,
      errorMessage: null,
      pointsBalance: [{ year: 0, balance: 0 }],
      pointsCumInterest: [{ year: 0, cumulativeInterest: 0 }],
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0
    };
  }
  
  const paymentsPerYear = getPaymentsPerYear(frequency);
  const periodicRate = annualRate / 100 / paymentsPerYear;
  const totalPayments = Math.floor(years * paymentsPerYear);
  
  // Calculate payment amount
  let paymentAmount;
  try {
    paymentAmount = calculatePaymentAmount(principal, annualRate, years, frequency);
    if (!isFinite(paymentAmount) || paymentAmount <= 0) {
      return {
        isValid: false,
        errorMessage: 'Cannot compute payment amount',
        pointsBalance: [],
        pointsCumInterest: [],
        schedule: [],
        totalInterest: 0,
        totalPaid: 0,
        payoffYears: 0,
        maxPlottedY: principal || 0
      };
    }
  } catch (e) {
    return {
      isValid: false,
      errorMessage: 'Error calculating payment',
      pointsBalance: [],
      pointsCumInterest: [],
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0,
      maxPlottedY: principal || 0
    };
  }
  
  // Check if payment is sufficient to amortize
  if (periodicRate > 0 && paymentAmount <= principal * periodicRate) {
    // Return invalid but include maxPlottedY for axis scaling
    return {
      isValid: false,
      errorMessage: 'Payment does not amortize the loan at this rate',
      pointsBalance: [{ year: 0, balance: principal }],
      pointsCumInterest: [{ year: 0, cumulativeInterest: 0 }],
      schedule: [],
      totalInterest: 0,
      totalPaid: 0,
      payoffYears: 0,
      maxPlottedY: principal // Use principal for axis scaling even when invalid
    };
  }
  
  // Build schedule
  const schedule = [];
  let balance = principal;
  let totalInterest = 0;
  let cumulativeInterest = 0;
  
  // Arrays for graph plotting - downsample to max ~800 points
  const maxPoints = 800;
  const pointsBalance = [{ year: 0, balance: principal }];
  const pointsCumInterest = [{ year: 0, cumulativeInterest: 0 }];
  const sampleInterval = Math.max(1, Math.ceil(totalPayments / maxPoints));
  
  for (let paymentNum = 1; paymentNum <= totalPayments && balance > 1e-6; paymentNum++) {
    // Calculate interest and principal
    let interestPortion, principalPortion;
    
    if (periodicRate === 0) {
      interestPortion = 0;
      principalPortion = paymentAmount;
    } else {
      interestPortion = balance * periodicRate;
      principalPortion = paymentAmount - interestPortion;
    }
    
    // Check if payment is sufficient (should not happen if we passed initial check, but guard anyway)
    if (principalPortion <= 0) {
      // Calculate maxPlottedY from what we have so far
      let maxPlottedY = principal;
      pointsBalance.forEach(p => {
        if (p.balance !== undefined && isFinite(p.balance)) {
          maxPlottedY = Math.max(maxPlottedY, p.balance);
        }
      });
      pointsCumInterest.forEach(p => {
        if (p.cumulativeInterest !== undefined && isFinite(p.cumulativeInterest)) {
          maxPlottedY = Math.max(maxPlottedY, p.cumulativeInterest);
        }
      });
      
      return {
        isValid: false,
        errorMessage: 'Payment does not amortize the loan',
        pointsBalance: pointsBalance.length > 0 ? pointsBalance : [{ year: 0, balance: principal }],
        pointsCumInterest: pointsCumInterest.length > 0 ? pointsCumInterest : [{ year: 0, cumulativeInterest: 0 }],
        schedule,
        totalInterest,
        totalPaid: principal + totalInterest,
        payoffYears: (paymentNum - 1) / paymentsPerYear,
        maxPlottedY
      };
    }
    
    // Ensure we don't overpay
    if (principalPortion > balance) {
      principalPortion = balance;
    }
    
    balance -= principalPortion;
    totalInterest += interestPortion;
    cumulativeInterest += interestPortion;
    
    // Clamp tiny negatives due to floating point error
    if (balance < 1e-6) {
      balance = 0;
    }
    
    schedule.push({
      paymentNum,
      paymentAmount,
      interestPortion,
      principalPortion,
      balance: Math.max(0, balance)
    });
    
    // Sample points for graph (downsample for performance)
    if (paymentNum % sampleInterval === 0 || paymentNum === totalPayments || balance <= 1e-6) {
      const tYears = paymentNum / paymentsPerYear;
      if (tYears <= 40) { // Only include points within our axis range
        pointsBalance.push({ year: tYears, balance: Math.max(0, balance) });
        pointsCumInterest.push({ year: tYears, cumulativeInterest });
      }
    }
  }
  
  const payoffYears = schedule.length / paymentsPerYear;
  
  // Ensure final point is included
  if (pointsBalance.length === 0 || pointsBalance[pointsBalance.length - 1].year < payoffYears) {
    pointsBalance.push({ year: Math.min(payoffYears, 40), balance: 0 });
    pointsCumInterest.push({ year: Math.min(payoffYears, 40), cumulativeInterest });
  }
  
  // Calculate max plotted Y value for axis scaling (curves only)
  let maxPlottedY = 0;
  if (pointsBalance.length > 0) {
    maxPlottedY = Math.max(maxPlottedY, pointsBalance[0].balance); // Initial balance
  }
  pointsBalance.forEach(p => {
    if (p.balance !== undefined && isFinite(p.balance)) {
      maxPlottedY = Math.max(maxPlottedY, p.balance);
    }
  });
  pointsCumInterest.forEach(p => {
    if (p.cumulativeInterest !== undefined && isFinite(p.cumulativeInterest)) {
      maxPlottedY = Math.max(maxPlottedY, p.cumulativeInterest);
    }
  });
  const totalPaid = principal + totalInterest;
  
  return {
    isValid: true,
    errorMessage: null,
    pointsBalance,
    pointsCumInterest,
    schedule,
    totalInterest,
    totalPaid,
    payoffYears,
    maxPlottedY: Math.max(maxPlottedY, principal) // Ensure initial principal is included
  };
}

/**
 * Legacy wrapper for backward compatibility
 */
function buildAmortizationSchedule(principal, annualRate, years, frequency) {
  const result = computeSchedule(principal, annualRate, years, frequency);
  if (!result.isValid) {
    return {
      error: result.errorMessage,
      schedule: result.schedule,
      totalInterest: result.totalInterest,
      totalPaid: result.totalPaid,
      payoffYears: result.payoffYears,
      balanceOverTime: result.pointsBalance,
      interestOverTime: result.pointsCumInterest
    };
  }
  return {
    schedule: result.schedule,
    totalInterest: result.totalInterest,
    totalPaid: result.totalPaid,
    payoffYears: result.payoffYears,
    balanceOverTime: result.pointsBalance,
    interestOverTime: result.pointsCumInterest
  };
}

// ============================================================
// Axis Manager - Handles stable axis ranges during slider dragging
// ============================================================

/**
 * AxisManager - Manages stable axis ranges with hysteresis during slider dragging
 * 
 * Y-axis hysteresis policy:
 * - During slider drag: yMax only EXPANDS if curves would clip (>95% of current yMax), never shrinks
 * - On init/target change/non-slider change: recompute yMax fresh from CURRENT schedule only
 * - We do NOT precompute worst-case across slider extremes (e.g., sampling price 50k-3M)
 *   This prevents unreadable compression at typical values (e.g., 500k home shows curves compressed
 *   near bottom if yMax is set to accommodate 3M worst-case)
 */
class AxisManager {
  constructor() {
    // X-axis is always fixed: 0..40 years
    this.xMin = 0;
    this.xMax = 40;
    this.yMin = 0;
    this.yMaxCached = null; // Cached Y max with hysteresis - only expands during drag, recomputes on changes
    this.lastSliderTarget = null;
    this.lastNonSliderInputs = null;
  }
  
  /**
   * Compute axis max with gentle rounding.
   * Uses steps 1, 2, 2.5, 5, 10 * 10^k to avoid big jumps.
   */
  niceAxisMax(paddedMax, desiredTicks = 6) {
    if (!isFinite(paddedMax) || paddedMax <= 0) return 100000;
    const rawStep = paddedMax / desiredTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let stepNorm;
    if (normalized <= 1) stepNorm = 1;
    else if (normalized <= 2) stepNorm = 2;
    else if (normalized <= 2.5) stepNorm = 2.5;
    else if (normalized <= 5) stepNorm = 5;
    else stepNorm = 10;
    const step = stepNorm * magnitude;
    return step * desiredTicks;
  }
  
  /**
   * Update axis range based on schedule and reason
   * reason: "INIT" | "SLIDER_TARGET_CHANGE" | "NON_SLIDER_INPUT_CHANGE" | "SLIDER_DRAG"
   * 
   * Y-axis hysteresis logic:
   * - During slider drag: only expand if curves would clip (never shrink)
   * - On init/target change/non-slider change: recompute fresh from current schedule only
   * - We do NOT precompute worst-case across slider extremes (prevents unreadable compression)
   */
  update(scheduleResult, reason) {
    // X-axis is always fixed
    const xMin = 0;
    const xMax = 40;
    
    if (reason === 'SLIDER_DRAG') {
      // During drag: only expand if needed, never shrink
      if (scheduleResult.isValid && this.yMaxCached !== null) {
        const maxPlottedY = scheduleResult.maxPlottedY || 0;
        // If curves would exceed 97% of current yMax, expand slightly
        if (maxPlottedY > 0.97 * this.yMaxCached) {
          const expanded = this.niceAxisMax(maxPlottedY * 1.03, 6);
          this.yMaxCached = Math.max(this.yMaxCached, expanded); // Only expand, never shrink
        }
        // Otherwise keep yMaxCached unchanged
      }
    } else {
      // INIT, SLIDER_TARGET_CHANGE, or NON_SLIDER_INPUT_CHANGE: recompute fresh from current schedule
      // Handle both valid and invalid schedules (invalid may still have maxPlottedY for axis scaling)
      const maxPlottedY = scheduleResult.maxPlottedY || 0;
      const initialBalance = scheduleResult.pointsBalance.length > 0 
        ? scheduleResult.pointsBalance[0].balance 
        : 0;
      
      if (scheduleResult.isValid) {
        // Valid schedule: base max from plotted curves (initial balance, final cumulative interest)
        const finalCumInterest = scheduleResult.pointsCumInterest.length > 0
          ? scheduleResult.pointsCumInterest[scheduleResult.pointsCumInterest.length - 1].cumulativeInterest || 0
          : 0;
        const baseMax = Math.max(
          initialBalance,
          finalCumInterest,
          maxPlottedY
        );
        // Apply tighter padding (5%) and round to nice number, with floor
        const padded = baseMax * 1.05;
        const nice = this.niceAxisMax(padded, 6);
        this.yMaxCached = Math.max(nice, 100000); // Floor at 100k
      } else {
        // Invalid schedule: use maxPlottedY if available, otherwise default
        if (maxPlottedY > 0) {
          const padded = maxPlottedY * 1.05;
          const nice = this.niceAxisMax(padded, 6);
          this.yMaxCached = Math.max(nice, 100000);
        } else if (this.yMaxCached === null) {
          this.yMaxCached = 1000000; // Default fallback
        }
        // If we already have a cached value, keep it (maintains stability)
      }
    }
  }
  
  /**
   * Get current axis range
   */
  getAxisRange() {
    return {
      xMin: this.xMin,
      xMax: this.xMax,
      yMin: this.yMin,
      yMax: this.yMaxCached || 1000000 // Fallback if not initialized
    };
  }
}

// ============================================================
// Graph Rendering (Canvas)
// ============================================================

class MortgageChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;
    this.axisManager = new AxisManager();
    this.isDraggingSlider = false;
    this.currentInputs = null;
    this.currentSliderTarget = null;
    this.rafPending = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  
  setDraggingSlider(isDragging) {
    this.isDraggingSlider = isDragging;
  }
  
  setCurrentInputs(inputs, sliderTarget) {
    this.currentInputs = inputs;
    this.currentSliderTarget = sliderTarget;
  }
  
  resize() {
    if (!this.canvas) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    // Re-establish context after resize
    this.ctx = this.canvas.getContext('2d');
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
  
  setData(scheduleResult, reason) {
    // Store schedule result directly
    this.data = scheduleResult;
    
    // Determine reason if not provided
    if (!reason) {
      if (!this.axisManager.yMaxCached) {
        reason = 'INIT';
      } else if (this.isDraggingSlider) {
        reason = 'SLIDER_DRAG';
      } else {
        // Check if slider target changed
        const currentSliderTarget = this.currentSliderTarget;
        if (currentSliderTarget !== this.axisManager.lastSliderTarget) {
          reason = 'SLIDER_TARGET_CHANGE';
          this.axisManager.lastSliderTarget = currentSliderTarget;
        } else if (this.currentInputs && this.axisManager.lastNonSliderInputs) {
          // Check if non-slider inputs changed
          const currentNonSlider = {
            homePrice: this.currentInputs.homePrice,
            downPayment: this.currentInputs.downPayment,
            interestRate: this.currentInputs.interestRate,
            amortizationYears: this.currentInputs.amortizationYears,
            paymentFrequency: this.currentInputs.paymentFrequency,
            isAmountMode: this.currentInputs.isAmountMode
          };
          const inputsChanged = JSON.stringify(currentNonSlider) !== JSON.stringify(this.axisManager.lastNonSliderInputs);
          reason = inputsChanged ? 'NON_SLIDER_INPUT_CHANGE' : 'SLIDER_DRAG'; // Default to SLIDER_DRAG if no change detected
        } else {
          reason = 'NON_SLIDER_INPUT_CHANGE'; // First time with inputs
        }
      }
    }
    
    // Update axis range with hysteresis logic
    this.axisManager.update(scheduleResult, reason);
    
    // Update last non-slider inputs if not dragging
    if (!this.isDraggingSlider && this.currentInputs) {
      this.axisManager.lastNonSliderInputs = {
        homePrice: this.currentInputs.homePrice,
        downPayment: this.currentInputs.downPayment,
        interestRate: this.currentInputs.interestRate,
        amortizationYears: this.currentInputs.amortizationYears,
        paymentFrequency: this.currentInputs.paymentFrequency,
        isAmountMode: this.currentInputs.isAmountMode
      };
    }
    
    // Schedule render (throttled with RAF)
    if (!this.rafPending) {
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        this.draw();
      });
    }
  }
  
  draw() {
    try {
      // Ensure canvas context is valid
      if (!this.canvas) {
        console.error('Canvas not available');
        return;
      }
      
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      const displayWidth = rect.width;
      const displayHeight = rect.height;
      
      // Ensure canvas size matches display size
      if (this.canvas.width !== displayWidth * dpr || this.canvas.height !== displayHeight * dpr) {
        this.canvas.width = displayWidth * dpr;
        this.canvas.height = displayHeight * dpr;
        // Re-establish context after resize
        this.ctx = this.canvas.getContext('2d');
        this.ctx.scale(dpr, dpr);
        this.canvas.style.width = displayWidth + 'px';
        this.canvas.style.height = displayHeight + 'px';
      }
      
      const ctx = this.ctx;
      const width = displayWidth;
      const height = displayHeight;
      
      // Always clear canvas first
      ctx.clearRect(0, 0, width, height);
      
      // Get axis range (cached, stable during slider drag)
      const axisRange = this.axisManager.getAxisRange();
      
      // Draw axes first (always, even for invalid data)
      this.drawAxes(ctx, width, height, axisRange);
      
      // Check for invalid data
      if (!this.data || !this.data.isValid) {
        this.drawInvalidMessage(ctx, width, height);
        return;
      }
      
      // Draw curves using stable axis range
      this.drawCurves(ctx, width, height, axisRange, this.data);
      
    } catch (error) {
      // If any error occurs during drawing, show error message
      console.error('Graph drawing error:', error);
      try {
        const ctx = this.ctx;
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, width, height);
        const axisRange = this.axisManager.getAxisRange();
        this.drawAxes(ctx, width, height, axisRange);
        this.drawInvalidMessage(ctx, width, height);
      } catch (e) {
        console.error('Error in error handler:', e);
      }
    }
  }
  
  /**
   * Draw axes and grid using stable axis range
   */
  drawAxes(ctx, width, height, axisRange) {
    const padding = { top: 20, right: 20, bottom: 40, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    ctx.save();
    
    // Draw grid lines
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border') || 'rgba(238,242,247,.14)';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines (Y axis) - 5 lines
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
    }
    
    // Vertical grid lines (X axis) - fixed at 0, 5, 10, 15, 20, 25, 30, 35, 40
    const xTicks = [0, 5, 10, 15, 20, 25, 30, 35, 40];
    xTicks.forEach(year => {
      const x = padding.left + ((year - axisRange.xMin) / (axisRange.xMax - axisRange.xMin)) * chartWidth;
      if (x >= padding.left && x <= padding.left + chartWidth) {
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartHeight);
        ctx.stroke();
      }
    });
    
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
    
    // X axis labels (years) - fixed ticks
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,.72)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    xTicks.forEach(year => {
      const x = padding.left + ((year - axisRange.xMin) / (axisRange.xMax - axisRange.xMin)) * chartWidth;
      if (x >= padding.left && x <= padding.left + chartWidth) {
        ctx.fillText(Math.round(year), x, padding.top + chartHeight + 8);
      }
    });
    
    // Y axis labels (dollars) - nice ticks
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    const yRange = axisRange.yMax - axisRange.yMin;
    for (let i = 0; i <= 5; i++) {
      const value = axisRange.yMax - (yRange / 5) * i;
      const y = padding.top + (chartHeight / 5) * i;
      const label = this.formatCurrencyCompact(value);
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
    
    ctx.restore();
  }
  
  /**
   * Format currency compactly for axis labels
   */
  formatCurrencyCompact(value) {
    if (value >= 1000000) {
      return '$' + (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return '$' + (value / 1000).toFixed(0) + 'k';
    } else {
      return formatter.currency.format(value);
    }
  }
  
  /**
   * Draw curves using schedule data and stable axis range
   */
  drawCurves(ctx, width, height, axisRange, scheduleResult) {
    const padding = { top: 20, right: 20, bottom: 40, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    const { pointsBalance, pointsCumInterest } = scheduleResult;
    
    // Scaling functions using stable axis range
    const xScale = (year) => {
      const t = (year - axisRange.xMin) / (axisRange.xMax - axisRange.xMin);
      return padding.left + t * chartWidth;
    };
    
    const yScale = (value) => {
      const t = (value - axisRange.yMin) / (axisRange.yMax - axisRange.yMin);
      return padding.top + chartHeight - t * chartHeight;
    };
    
    ctx.save();
    
    // Remaining principal curve (amber)
    if (pointsBalance && pointsBalance.length > 0) {
      ctx.strokeStyle = '#D9B46A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < pointsBalance.length; i++) {
        const point = pointsBalance[i];
        const x = xScale(point.year);
        const y = yScale(point.balance);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    
    // Cumulative interest curve (blue)
    if (pointsCumInterest && pointsCumInterest.length > 0) {
      ctx.strokeStyle = '#4A90E2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < pointsCumInterest.length; i++) {
        const point = pointsCumInterest[i];
        const x = xScale(point.year);
        const y = yScale(point.cumulativeInterest);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    
    ctx.restore();
  }
  
  /**
   * Draw invalid message overlay
   */
  drawInvalidMessage(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || 'rgba(238,242,247,.72)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const message = this.data && this.data.errorMessage 
      ? this.data.errorMessage 
      : 'Cannot amortize with these inputs';
    ctx.fillText(message, width / 2, height / 2);
    ctx.restore();
  }
  
  drawError() {
    // Legacy method - now handled by drawInvalidMessage
    this.draw();
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
      summarySentence.innerHTML = '<div class="summary-title">With these inputs:</div><ul class="summary-list"><li><span class="summary-label">Mortgage is paid off in</span> <span id="summary_years" class="summary-value">–</span> <span class="summary-label">years</span></li><li><span id="summary_interest" class="summary-value">$–</span> <span class="summary-label">paid in interest</span></li><li><span id="summary_total" class="summary-value">$–</span> <span class="summary-label">paid in total mortgage payments (principal + interest)</span></li></ul>';
    }
    summarySentence.innerHTML = '<span class="error-state">Payment does not amortize the loan at this rate.</span>';
    return;
  }
  
  // Restore summary sentence structure if it was replaced by error
  if (!summarySentence.querySelector('#summary_years')) {
    summarySentence.innerHTML = '<div class="summary-title">With these inputs:</div><ul class="summary-list"><li><span class="summary-label">Mortgage is paid off in</span> <span id="summary_years" class="summary-value">–</span> <span class="summary-label">years</span></li><li><span id="summary_interest" class="summary-value">$–</span> <span class="summary-label">paid in interest</span></li><li><span id="summary_total" class="summary-value">$–</span> <span class="summary-label">paid in total mortgage payments (principal + interest)</span></li></ul>';
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

function updateGraph(scheduleResult) {
  if (chart) {
    const inputs = getInputs();
    const sliderTarget = document.querySelector('input[name="slider_target"]:checked')?.value || 'price';
    chart.setCurrentInputs(inputs, sliderTarget);
    // setData will determine the reason automatically based on state
    chart.setData(scheduleResult);
  } else {
    // Chart not initialized yet, try to initialize it
    const canvas = document.getElementById('chartCanvas');
    if (canvas) {
      chart = new MortgageChart(canvas);
      const inputs = getInputs();
      const sliderTarget = document.querySelector('input[name="slider_target"]:checked')?.value || 'price';
      chart.setCurrentInputs(inputs, sliderTarget);
      chart.setData(scheduleResult, 'INIT');
    }
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
    let totalPayments = 0;
    let totalInterest = 0;
    let totalPrincipal = 0;
    let finalBalance = 0;
    
    first12Payments.forEach(payment => {
      totalPayments += payment.paymentAmount;
      totalInterest += payment.interestPortion;
      totalPrincipal += payment.principalPortion;
      finalBalance = payment.balance;
      
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
    
    // Add summary row
    const summaryRow = document.createElement('tr');
    summaryRow.style.fontWeight = '700';
    summaryRow.style.borderTop = '2px solid var(--border)';
    summaryRow.innerHTML = `
      <td><strong>Total</strong></td>
      <td><strong>${formatter.currency.format(totalPayments)}</strong></td>
      <td><strong>${formatter.currency.format(totalInterest)}</strong></td>
      <td><strong>${formatter.currency.format(totalPrincipal)}</strong></td>
      <td><strong>${formatter.currency.format(finalBalance)}</strong></td>
    `;
    tbody12.appendChild(summaryRow);
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
  
  let grandTotalPayments = 0;
  let grandTotalInterest = 0;
  let grandTotalPrincipal = 0;
  let finalEndingBalance = 0;
  
  annualData.forEach(yearData => {
    grandTotalPayments += yearData.totalPayments;
    grandTotalInterest += yearData.totalInterest;
    grandTotalPrincipal += yearData.totalPrincipal;
    finalEndingBalance = yearData.endingBalance;
    
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
  
  // Add summary row
  if (annualData.length > 0) {
    const summaryRow = document.createElement('tr');
    summaryRow.style.fontWeight = '700';
    summaryRow.style.borderTop = '2px solid var(--border)';
    summaryRow.innerHTML = `
      <td><strong>Total</strong></td>
      <td><strong>${formatter.currency.format(grandTotalPayments)}</strong></td>
      <td><strong>${formatter.currency.format(grandTotalInterest)}</strong></td>
      <td><strong>${formatter.currency.format(grandTotalPrincipal)}</strong></td>
      <td><strong>${formatter.currency.format(finalEndingBalance)}</strong></td>
    `;
    tbodyAnnual.appendChild(summaryRow);
  }
}

function recalculate() {
  const inputs = getInputs();
  
  // Compute schedule using new robust function
  const scheduleResult = computeSchedule(
    inputs.loanAmount,
    inputs.interestRate,
    inputs.amortizationYears,
    inputs.paymentFrequency
  );
  
  // Convert to legacy format for outputs and tables
  const legacyData = scheduleResult.isValid ? {
    schedule: scheduleResult.schedule,
    totalInterest: scheduleResult.totalInterest,
    totalPaid: scheduleResult.totalPaid,
    payoffYears: scheduleResult.payoffYears,
    balanceOverTime: scheduleResult.pointsBalance,
    interestOverTime: scheduleResult.pointsCumInterest
  } : {
    error: scheduleResult.errorMessage,
    schedule: [],
    totalInterest: 0,
    totalPaid: 0,
    payoffYears: 0,
    balanceOverTime: [],
    interestOverTime: []
  };
  
  updateOutputs(legacyData);
  updateGraph(scheduleResult);
  updateTables(legacyData);
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
  
  // Remove old event listeners by cloning and replacing
  const newSlider = slider.cloneNode(true);
  slider.parentNode.replaceChild(newSlider, slider);
  const activeSlider = document.getElementById('active_slider');
  
  // Slider drag state tracking - use window-level listeners so pointerup always fires
  const handleSliderStart = (e) => {
    if (chart) {
      chart.setDraggingSlider(true);
    }
    // Add window-level end listeners to ensure they fire even if pointer leaves slider
    const handleWindowEnd = () => {
      if (chart) {
        chart.setDraggingSlider(false);
      }
      window.removeEventListener('pointerup', handleWindowEnd);
      window.removeEventListener('mouseup', handleWindowEnd);
      window.removeEventListener('touchend', handleWindowEnd);
    };
    window.addEventListener('pointerup', handleWindowEnd, { once: true });
    window.addEventListener('mouseup', handleWindowEnd, { once: true });
    window.addEventListener('touchend', handleWindowEnd, { once: true });
  };
  
  const handleSliderEnd = () => {
    if (chart) {
      chart.setDraggingSlider(false);
      // Keep yMax as-is after drag ends (no shrink) for stability
    }
  };
  
  const handleSliderInput = () => {
    const newValue = parseFloat(activeSlider.value);
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
  
  // Add event listeners for drag tracking
  activeSlider.addEventListener('pointerdown', handleSliderStart);
  activeSlider.addEventListener('mousedown', handleSliderStart);
  activeSlider.addEventListener('touchstart', handleSliderStart);
  
  activeSlider.addEventListener('pointerup', handleSliderEnd);
  activeSlider.addEventListener('mouseup', handleSliderEnd);
  activeSlider.addEventListener('touchend', handleSliderEnd);
  activeSlider.addEventListener('pointerleave', handleSliderEnd); // Handle drag outside
  
  // Input handler (fires during drag)
  activeSlider.addEventListener('input', handleSliderInput);
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
  
  // Sync down payment amount and percent with validation
  document.getElementById('down_payment_amount').addEventListener('input', () => {
    const homePrice = parseFloat(document.getElementById('home_price').value) || 500000;
    const downPaymentAmount = parseFloat(document.getElementById('down_payment_amount').value) || 0;
    // Cap down payment at home price
    const cappedAmount = Math.min(downPaymentAmount, homePrice);
    if (downPaymentAmount !== cappedAmount) {
      document.getElementById('down_payment_amount').value = cappedAmount;
    }
    const percent = (cappedAmount / homePrice) * 100;
    document.getElementById('down_payment_percent').value = percent.toFixed(1);
  });
  
  document.getElementById('down_payment_percent').addEventListener('input', () => {
    const homePrice = parseFloat(document.getElementById('home_price').value) || 500000;
    const percent = Math.min(100, Math.max(0, parseFloat(document.getElementById('down_payment_percent').value) || 0));
    // Cap percent at 100
    if (parseFloat(document.getElementById('down_payment_percent').value) !== percent) {
      document.getElementById('down_payment_percent').value = percent.toFixed(1);
    }
    const amount = homePrice * (percent / 100);
    document.getElementById('down_payment_amount').value = Math.round(amount);
  });
  
  // Slider target selection - force axis range recomputation
  document.querySelectorAll('input[name="slider_target"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (chart) {
        // Reset to force recomputation on next update
        chart.axisManager.lastSliderTarget = null;
      }
      updateSlider();
      debouncedRecalculate();
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
