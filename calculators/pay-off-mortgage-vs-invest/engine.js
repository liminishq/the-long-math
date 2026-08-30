/* ============================================================
   Pay Off Mortgage vs Invest Calculator — Engine
   ============================================================

   CASH-FLOW-NEUTRAL LOGIC:
   - Total budget per period = mortgage payment + extra cash (FIXED in monthly mode)
   - Lump-sum mode: no recurring extra cash; a one-time amount at the start of month 1 is split
     by the same slider (0% = all lump to mortgage principal, 100% = all lump to investing).
   - Regular mortgage payment always goes to mortgage (until paid off)
   - Slider controls allocation of recurring extra cash and/or the lump:
     * 0% slider = 100% of that cash → mortgage
     * 100% slider = 100% → investing
   - After mortgage payoff: entire budget goes to investing
   - Recurring cash timing is end-of-period and symmetric:
     mortgage interest accrues, then payment/extra principal;
     investment balance earns the period return, then the contribution is added.
   - Initial lump sums at t=0 are applied immediately (before that month's interest/growth).
*/

/* ============================================================
   Helper: Clamp number
   ============================================================ */
function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/* ============================================================
   Convert payment frequency to periods per year
   ============================================================ */
function periodsPerYear(frequency) {
  switch (frequency) {
    case "weekly": return 52;
    case "semi-monthly": return 24;
    case "monthly": return 12;
    default: return 12;
  }
}

/* ============================================================
   Canadian mortgage periodic rate
   ============================================================ */
function canadianMortgagePeriodicRate(annualRate, periodsPerYear) {
  const annualRateDecimal = annualRate / 100;
  return Math.pow(1 + annualRateDecimal / 2, 2 / periodsPerYear) - 1;
}

/* ============================================================
   Calculate monthly mortgage payment from parameters
   ============================================================ */
function calculateMortgagePayment(principal, annualRate, years, periodsPerYear) {
  if (annualRate === 0) {
    return principal / (years * periodsPerYear);
  }
  const periodRate = canadianMortgagePeriodicRate(annualRate, periodsPerYear);
  const numPayments = years * periodsPerYear;
  const payment = principal * periodRate / (1 - Math.pow(1 + periodRate, -numPayments));
  return payment;
}

/* ============================================================
   Calculate monthly investment return (geometric)
   ============================================================ */
function monthlyReturnFromAnnual(rAnnualNet) {
  const rNet = Math.max(-0.999, rAnnualNet);
  if (Math.abs(rNet) < 1e-12) return 0;
  return Math.pow(1 + rNet, 1 / 12) - 1;
}

/* ============================================================
   Payoff month (independent of analysis time horizon)
   Same principal/interest/mortgage-payment rules as simulate(), but
   runs until the balance hits zero or a safety cap.
   Investment return does not change the mortgage balance.
   ============================================================ */
const MAX_PAYOFF_SEARCH_MONTHS = 1200; // 100 years
const MORTGAGE_BALANCE_EPSILON = 1e-6;
const PAYMENT_EPSILON = 1e-9;
const NON_AMORTIZING_PAYMENT_ERROR = "Mortgage payment must exceed the accrued monthly interest under these assumptions.";

function getNonAmortizingPaymentError(balance, payment, annualRate) {
  if (!Number.isFinite(balance) || balance <= MORTGAGE_BALANCE_EPSILON) return null;
  const interestDue = balance * canadianMortgagePeriodicRate(annualRate, 12);
  if (payment > interestDue + PAYMENT_EPSILON) return null;
  return {
    error: NON_AMORTIZING_PAYMENT_ERROR,
    errorCode: "non_amortizing_payment",
    interestDue,
    payment
  };
}

function findMortgagePayoffMonth({
  initialMortgageBalance,
  mortgagePaymentPerPeriod,
  extraCashPerPeriod,
  allocationPercent,
  annualRate,
  lumpSumAtStart = 0
}) {
  if (!Number.isFinite(initialMortgageBalance) || initialMortgageBalance <= 0) {
    return 0;
  }
  const periodRate = canadianMortgagePeriodicRate(annualRate, 12);
  const extraToMortgage = ((100 - allocationPercent) / 100) * extraCashPerPeriod;
  let balance = initialMortgageBalance;

  for (let period = 1; period <= MAX_PAYOFF_SEARCH_MONTHS; period++) {
    if (period === 1 && lumpSumAtStart > 0) {
      const lumpMortgage = ((100 - allocationPercent) / 100) * lumpSumAtStart;
      const lumpToPrincipal = Math.min(Math.max(0, lumpMortgage), balance);
      balance -= lumpToPrincipal;
      if (balance < 0) balance = 0;
      if (balance <= MORTGAGE_BALANCE_EPSILON) {
        return period;
      }
    }
    const interestDue = balance * periodRate;
    const intendedMortgagePayment = mortgagePaymentPerPeriod + extraToMortgage;
    if (intendedMortgagePayment <= interestDue + PAYMENT_EPSILON) {
      return null;
    }
    const maxNeededToClose = interestDue + balance;
    const actualMortgagePayment = Math.min(intendedMortgagePayment, maxNeededToClose);
    const actualMortgagePaymentClamped = Math.max(0, actualMortgagePayment);
    const interestPaid = Math.min(actualMortgagePaymentClamped, interestDue);
    const principalPaid = actualMortgagePaymentClamped - interestPaid;
    balance = balance - principalPaid;
    if (balance < MORTGAGE_BALANCE_EPSILON) balance = 0;
    if (balance <= 0) {
      return Math.ceil(period);
    }
  }
  return null;
}

/* ============================================================
   Simulate with allocation slider
   ============================================================ */
function simulate({
  initialMortgageBalance,
  mortgagePaymentPerPeriod,
  extraCashPerPeriod,
  allocationPercent, // 0-100: % of extra cash going to mortgage
  annualRate,
  horizonMonths,
  monthlyReturn,
  homePrice,
  homeGrowthRate,
  lumpSumAtStart = 0 // optional one-time amount at start of month 1; split by same slider as recurring extra
}) {
  // Everything is monthly; convert Canadian nominal mortgage rates to a monthly rate.
  const periodRate = canadianMortgagePeriodicRate(annualRate, 12);
  const periodReturn = monthlyReturn;
  
  let balance = initialMortgageBalance;
  let investValue = 0;
  let totalInterestPaid = 0;
  let totalInterestEarned = 0;
  let totalPrincipalPaid = 0;
  let totalMortgageCashPaid = 0;
  let payoffPeriod = null;
  
  const series = [];
  
  // Record initial state (month 0)
  const initialHomeValue = homePrice;
  const initialEquity = initialHomeValue - balance;
  const initialNetWorth = initialEquity + investValue;
  series.push({
    month: 0,
    balance,
    investValue,
    netWorth: initialNetWorth,
    interestPaid: 0,
    interestEarned: 0
  });
  
  // Calculate allocation amounts
  // allocationPercent: 0 = 100% to mortgage (left), 100 = 100% to invest (right)
  const extraToMortgage = ((100 - allocationPercent) / 100) * extraCashPerPeriod;
  const extraToInvest = (allocationPercent / 100) * extraCashPerPeriod;
  
  // Total budget per period (fixed)
  const totalBudgetPerPeriod = mortgagePaymentPerPeriod + extraCashPerPeriod;
  
  // Total periods in horizon (everything is monthly now)
  const totalPeriods = horizonMonths;
  
  // Track last recorded month for series data
  let lastRecordedMonth = 0;
  
  for (let period = 1; period <= totalPeriods; period++) {
    // Each period is one month
    const currentMonth = period;

    // Lump sum at t = 0: applied at the start of month 1 (first loop iteration), before interest and scheduled payment
    if (period === 1 && lumpSumAtStart > 0) {
      const lumpMortgage = ((100 - allocationPercent) / 100) * lumpSumAtStart;
      const lumpInvest = (allocationPercent / 100) * lumpSumAtStart;
      const lumpToPrincipal = Math.min(Math.max(0, lumpMortgage), balance);
      balance -= lumpToPrincipal;
      if (balance < 0) balance = 0;
      totalPrincipalPaid += lumpToPrincipal;
      totalMortgageCashPaid += lumpToPrincipal;
      const mortgageOverflow = lumpMortgage - lumpToPrincipal;
      investValue += lumpInvest + mortgageOverflow;
    }
    
    let monthInterestPaid = 0;
    let monthInterestEarned = 0;

    if (balance <= 0) {
      // Mortgage paid off - entire budget goes to investing at end of period:
      // existing balance earns this period's return, then the contribution is added.
      const interestEarned = investValue * periodReturn;
      investValue = investValue * (1 + periodReturn) + totalBudgetPerPeriod;
      if (investValue < 0) investValue = 0;
      totalInterestEarned += interestEarned;
      monthInterestEarned = interestEarned;
    } else {
      // Calculate interest due for this period
      const interestDue = balance * periodRate;
      
      // Mortgage payment allocation
      // Regular payment always goes to mortgage
      // Plus allocated portion of extra cash
      const intendedMortgagePayment = mortgagePaymentPerPeriod + extraToMortgage;
      
      // Max needed to close mortgage
      const maxNeededToClose = interestDue + balance;
      
      // Actual mortgage payment (cannot exceed what's needed)
      const actualMortgagePayment = Math.min(intendedMortgagePayment, maxNeededToClose);
      const actualMortgagePaymentClamped = Math.max(0, actualMortgagePayment);

      const paymentError = getNonAmortizingPaymentError(
        balance,
        actualMortgagePaymentClamped,
        annualRate
      );
      if (paymentError) {
        return paymentError;
      }
      
      // Cash paid is split explicitly between interest and principal.
      const interestPaid = Math.min(actualMortgagePaymentClamped, interestDue);
      const principalPaid = actualMortgagePaymentClamped - interestPaid;
      
      // Update balance
      balance = balance - principalPaid;
      if (balance < MORTGAGE_BALANCE_EPSILON) balance = 0;
      
      // Track the actual cash components paid.
      totalInterestPaid += interestPaid;
      totalPrincipalPaid += principalPaid;
      totalMortgageCashPaid += actualMortgagePaymentClamped;
      
      // Track payoff period
      if (payoffPeriod === null && balance <= 0) {
        payoffPeriod = period;
      }
      
      // Investment allocation
      // Regular extra cash allocation plus remainder from mortgage payment
      const remainderFromMortgage = intendedMortgagePayment - actualMortgagePaymentClamped;
      const investContribution = extraToInvest + remainderFromMortgage;
      
      // End-of-period investment: existing balance earns this period's return,
      // then the recurring contribution is added (symmetric with mortgage extra
      // applied after interest accrues).
      const interestEarned = investValue * periodReturn;
      investValue = investValue * (1 + periodReturn) + investContribution;
      if (investValue < 0) investValue = 0;
      
      // Track interest earned
      totalInterestEarned += interestEarned;
      monthInterestPaid = interestPaid;
      monthInterestEarned = interestEarned;
    }
    
    // Record series data at the end of each calendar month
    // Check if we've crossed into a new month or reached the end
    if (currentMonth > lastRecordedMonth || period === totalPeriods) {
      // Calculate home value at this month
      const homeValue = homePrice * Math.pow(1 + homeGrowthRate / 100, currentMonth / 12);
      
      // Calculate equity
      const equity = homeValue - balance;
      
      // Net worth = equity + investments
      const netWorth = equity + investValue;
      
      series.push({
        month: currentMonth,
        balance,
        investValue,
        netWorth,
        interestPaid: monthInterestPaid,
        interestEarned: monthInterestEarned
      });
      
      lastRecordedMonth = currentMonth;
    }
  }
  
  // Payoff period is already in months
  const payoffMonth = payoffPeriod;
  
  return {
    finalBalance: balance,
    finalInvestValue: investValue,
    totalInterestPaid,
    totalInterestEarned,
    totalPrincipalPaid,
    totalMortgageCashPaid,
    payoffMonth: payoffMonth !== null ? Math.ceil(payoffMonth) : null,
    series
  };
}

/* ============================================================
   Net worth at horizon from a simulation result
   (must match logic in calculateMortgageVsInvest for final row)
   ============================================================ */
function finalNetWorthAtHorizon(sim, finalHomeValue) {
  const finalEquity = finalHomeValue - sim.finalBalance;
  return finalEquity + sim.finalInvestValue;
}

/* ============================================================
   Break-even gross expected return (before fees): R such that
   NW(all extra → mortgage) = NW(all extra → invest) at the same horizon,
   holding fees fixed and using the same mortgage/investment rules as simulate().
   ============================================================ */
function findBreakEvenGrossReturnPercent({
  initialMortgageBalance,
  mortgagePaymentPerPeriod,
  extraCashPerPeriod,
  annualRate,
  horizonMonths,
  homePrice,
  homeGrowthRate,
  fees,
  timeHorizon,
  lumpSumAtStart = 0
}) {
  if (initialMortgageBalance <= 0) {
    return { value: null, reason: "no_mortgage" };
  }
  if (extraCashPerPeriod <= 1e-9 && (!lumpSumAtStart || lumpSumAtStart <= 1e-9)) {
    return { value: null, reason: "no_extra" };
  }
  if (getNonAmortizingPaymentError(initialMortgageBalance, mortgagePaymentPerPeriod, annualRate)) {
    return { value: null, reason: "non_amortizing_payment" };
  }

  const finalHomeValue = homePrice * Math.pow(1 + homeGrowthRate / 100, timeHorizon);

  const diff = (grossPct) => {
    const netAnnual = (grossPct - fees) / 100;
    const mr = monthlyReturnFromAnnual(netAnnual);
    const simM = simulate({
      initialMortgageBalance,
      mortgagePaymentPerPeriod,
      extraCashPerPeriod,
      allocationPercent: 0,
      annualRate,
      horizonMonths,
      monthlyReturn: mr,
      homePrice,
      homeGrowthRate,
      lumpSumAtStart
    });
    const simI = simulate({
      initialMortgageBalance,
      mortgagePaymentPerPeriod,
      extraCashPerPeriod,
      allocationPercent: 100,
      annualRate,
      horizonMonths,
      monthlyReturn: mr,
      homePrice,
      homeGrowthRate,
      lumpSumAtStart
    });
    return finalNetWorthAtHorizon(simM, finalHomeValue) - finalNetWorthAtHorizon(simI, finalHomeValue);
  };

  let lo = -50;
  let hi = 50;
  let fLo = diff(lo);
  let fHi = diff(hi);

  let expand = 0;
  while (fLo * fHi > 0 && expand < 60) {
    hi += 40;
    fHi = diff(hi);
    lo -= 40;
    fLo = diff(lo);
    expand++;
    if (hi > 900 || lo < -450) break;
  }

  if (fLo * fHi > 0) {
    return { value: null, reason: "no_crossing" };
  }

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = diff(mid);
    if (hi - lo < 0.0005) {
      return { value: mid, reason: "ok" };
    }
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return { value: (lo + hi) / 2, reason: "ok" };
}

/* ============================================================
   Main calculation function
   ============================================================ */
function calculateMortgageVsInvest(inputs) {
  const {
    inputMode = "monthly",
    lumpSum = 0,
    mortgagePayment,
    monthlyBudget,
    extraCash,
    allocationPercent,
    expectedReturn,
    fees,
    timeHorizon,
    homeGrowthRate,
    // Mortgage calculator inputs (if used)
    calcHomePrice,
    calcDownAmount,
    calcDownPct,
    calcDownMode,
    calcInterestRate,
    calcAmortization,
    useCalculator,
    // Direct inputs (if not using calculator)
    currentBalance,
    currentRate,
    currentHomePrice
  } = inputs;

  const lumpMode = inputMode === "lump";
  const lumpSumAtStart = lumpMode ? clamp(Number.isFinite(lumpSum) ? lumpSum : 0, 0, 1e9) : 0;
  
  // Use monthlyBudget if provided, otherwise calculate from mortgagePayment + extraCash (monthly mode only)
  const actualExtraCash = lumpMode
    ? 0
    : (monthlyBudget > 0 ? Math.max(0, monthlyBudget - mortgagePayment) : extraCash);
  
  // Validate inputs
  if (!Number.isFinite(mortgagePayment) || mortgagePayment < 0) {
    return { error: "Invalid mortgage payment" };
  }
  if (!lumpMode && (!Number.isFinite(extraCash) || extraCash < 0)) {
    return { error: "Invalid extra cash" };
  }
  if (lumpMode && (!Number.isFinite(lumpSumAtStart) || lumpSumAtStart < 0)) {
    return { error: "Invalid lump sum" };
  }
  if (!Number.isFinite(allocationPercent) || allocationPercent < 0 || allocationPercent > 100) {
    return { error: "Invalid allocation percentage" };
  }
  if (!Number.isFinite(expectedReturn)) {
    return { error: "Invalid expected return" };
  }
  if (!Number.isFinite(fees) || fees < 0) {
    return { error: "Invalid fees" };
  }
  if (!Number.isFinite(timeHorizon) || timeHorizon <= 0 || timeHorizon > 75) {
    return { error: "Invalid time horizon" };
  }
  // Treat empty/NaN as 0 for home growth
  const homeGrowth = Number.isFinite(homeGrowthRate) ? homeGrowthRate : 0;
  
  // Determine mortgage payment
  let actualMortgagePayment = mortgagePayment;
  let initialMortgageBalance = 0;
  let annualRate = 0;
  
  if (useCalculator) {
    // Calculate mortgage payment from calculator inputs
    const homePrice = Number.isFinite(calcHomePrice) && calcHomePrice > 0 ? calcHomePrice : 600000;
    let downPayment;
    if (calcDownMode) {
      // Percentage mode
      const pct = clamp(Number.isFinite(calcDownPct) ? calcDownPct : 20, 0, 100);
      downPayment = homePrice * (pct / 100);
    } else {
      // Amount mode
      downPayment = clamp(Number.isFinite(calcDownAmount) ? calcDownAmount : 0, 0, homePrice);
    }
    initialMortgageBalance = homePrice - downPayment;
    annualRate = clamp(Number.isFinite(calcInterestRate) ? calcInterestRate : 5, 0, 20);
    const amortYears = clamp(Number.isFinite(calcAmortization) ? calcAmortization : 25, 1, 40);
    
    // Always monthly (12 periods per year)
    const ppy = 12;
    actualMortgagePayment = calculateMortgagePayment(initialMortgageBalance, annualRate, amortYears, ppy);
  } else {
    // Use direct inputs. Explicit 0 means debt-free; missing/blank is not zero.
    if (Number.isFinite(currentBalance)) {
      initialMortgageBalance = clamp(currentBalance, 0, 10000000);
    } else {
      initialMortgageBalance = 480000;
    }
    annualRate = clamp(Number.isFinite(currentRate) ? currentRate : 5, 0, 20);
  }
  
  // Everything is monthly now
  const ppy = 12;
  const mortgagePaymentMonthly = actualMortgagePayment;
  const extraCashMonthly = actualExtraCash;
  
  // Net annual return (after fees)
  const annualReturnNet = (expectedReturn - fees) / 100;
  const monthlyReturn = monthlyReturnFromAnnual(annualReturnNet);
  
  // Horizon in months
  const horizonMonths = Math.round(timeHorizon * 12);
  
  // Home price (use calc home price if available, otherwise use direct input)
  const homePrice = useCalculator && Number.isFinite(calcHomePrice) && calcHomePrice > 0
    ? calcHomePrice
    : (Number.isFinite(currentHomePrice) && currentHomePrice > 0 ? currentHomePrice : 600000);
  
  // Missing/blank balance (not an explicit 0): estimate principal from payment.
  // Explicit currentBalance === 0 is debt-free and must not invent a mortgage.
  if (!useCalculator && !Number.isFinite(currentBalance)) {
    const estAmortYears = 25;
    const estRate = 5;
    const estPpy = 12;
    const estPeriodRate = canadianMortgagePeriodicRate(estRate, estPpy);
    const estNumPayments = estAmortYears * estPpy;
    if (estPeriodRate > 0) {
      initialMortgageBalance = actualMortgagePayment * (1 - Math.pow(1 + estPeriodRate, -estNumPayments)) / estPeriodRate;
    } else {
      initialMortgageBalance = actualMortgagePayment * estNumPayments;
    }
    annualRate = estRate;
  }

  // Every result compares against the all-invest path, where only the regular
  // mortgage payment services the original balance. Reject assumptions that
  // would require negative amortization instead of silently dropping interest.
  const paymentError = getNonAmortizingPaymentError(
    initialMortgageBalance,
    mortgagePaymentMonthly,
    annualRate
  );
  if (paymentError) {
    return paymentError;
  }
  
  // Simulate with current allocation
  const currentResult = simulate({
    initialMortgageBalance,
    mortgagePaymentPerPeriod: mortgagePaymentMonthly,
    extraCashPerPeriod: extraCashMonthly,
    allocationPercent,
    annualRate,
    horizonMonths,
    monthlyReturn,
    homePrice,
    homeGrowthRate: homeGrowth,
    lumpSumAtStart
  });
  if (currentResult.error) return currentResult;
  
  // Simulate 100% mortgage (for key facts)
  const result100Mortgage = simulate({
    initialMortgageBalance,
    mortgagePaymentPerPeriod: mortgagePaymentMonthly,
    extraCashPerPeriod: extraCashMonthly,
    allocationPercent: 0, // 0 = 100% to mortgage (slider left)
    annualRate,
    horizonMonths,
    monthlyReturn,
    homePrice,
    homeGrowthRate: homeGrowth,
    lumpSumAtStart
  });
  if (result100Mortgage.error) return result100Mortgage;
  
  // Simulate 100% invest (for key facts)
  const result100Invest = simulate({
    initialMortgageBalance,
    mortgagePaymentPerPeriod: mortgagePaymentMonthly,
    extraCashPerPeriod: extraCashMonthly,
    allocationPercent: 100, // 100 = 100% to invest (slider right)
    annualRate,
    horizonMonths,
    monthlyReturn,
    homePrice,
    homeGrowthRate: homeGrowth,
    lumpSumAtStart
  });
  if (result100Invest.error) return result100Invest;
  
  // Final home value
  const finalHomeValue = homePrice * Math.pow(1 + homeGrowth / 100, timeHorizon);
  
  // Final net worth
  const finalEquity = finalHomeValue - currentResult.finalBalance;
  const finalNetWorth = finalEquity + currentResult.finalInvestValue;

  // True payoff timing (not limited to the chart / net-worth time horizon)
  const payoffMonthProjected = findMortgagePayoffMonth({
    initialMortgageBalance,
    mortgagePaymentPerPeriod: mortgagePaymentMonthly,
    extraCashPerPeriod: extraCashMonthly,
    allocationPercent,
    annualRate,
    lumpSumAtStart
  });
  const payoffMonthAllInvestProjected = findMortgagePayoffMonth({
    initialMortgageBalance,
    mortgagePaymentPerPeriod: mortgagePaymentMonthly,
    extraCashPerPeriod: extraCashMonthly,
    allocationPercent: 100,
    annualRate,
    lumpSumAtStart
  });

  const breakEven = findBreakEvenGrossReturnPercent({
    initialMortgageBalance,
    mortgagePaymentPerPeriod: mortgagePaymentMonthly,
    extraCashPerPeriod: extraCashMonthly,
    annualRate,
    horizonMonths,
    homePrice,
    homeGrowthRate: homeGrowth,
    fees,
    timeHorizon,
    lumpSumAtStart
  });
  
  return {
    netWorth: finalNetWorth,
    investValue: currentResult.finalInvestValue,
    homeValue: finalHomeValue,
    mortgageBalance: currentResult.finalBalance,
    totalInterestPaid: currentResult.totalInterestPaid,
    totalInterestEarned: currentResult.totalInterestEarned,
    series: currentResult.series,
    payoffMonth: payoffMonthProjected,
    payoffMonthAllInvest: payoffMonthAllInvestProjected,
    analysisHorizonMonths: horizonMonths,
    fact100Mortgage: result100Mortgage.series[result100Mortgage.series.length - 1].netWorth,
    fact100Invest: result100Invest.series[result100Invest.series.length - 1].netWorth,
    fact100MortgageInterestPaid: result100Mortgage.totalInterestPaid,
    fact100InvestInterestPaid: result100Invest.totalInterestPaid,
    fact100MortgageInterestEarned: result100Mortgage.totalInterestEarned,
    fact100InvestInterestEarned: result100Invest.totalInterestEarned,
    breakEvenGrossReturnPercent: breakEven.value,
    breakEvenReason: breakEven.reason,
    inputMode: lumpMode ? "lump" : "monthly"
  };
}

// Export to window for UI and tests
window.PayOffMortgageVsInvestEngine = {
  canadianMortgagePeriodicRate,
  calculateMortgagePayment,
  getNonAmortizingPaymentError,
  findMortgagePayoffMonth,
  monthlyReturnFromAnnual,
  simulate,
  calculateMortgageVsInvest,
};
window.calculateMortgageVsInvest = calculateMortgageVsInvest;
