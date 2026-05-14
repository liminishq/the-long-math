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
   Calculate monthly mortgage payment from parameters
   ============================================================ */
function calculateMortgagePayment(principal, annualRate, years, periodsPerYear) {
  if (annualRate === 0) {
    return principal / (years * periodsPerYear);
  }
  const periodRate = annualRate / 100 / periodsPerYear;
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
  const periodRate = annualRate / 100 / 12;
  const extraToMortgage = ((100 - allocationPercent) / 100) * extraCashPerPeriod;
  let balance = initialMortgageBalance;

  for (let period = 1; period <= MAX_PAYOFF_SEARCH_MONTHS; period++) {
    if (period === 1 && lumpSumAtStart > 0) {
      const lumpMortgage = ((100 - allocationPercent) / 100) * lumpSumAtStart;
      const lumpToPrincipal = Math.min(Math.max(0, lumpMortgage), balance);
      balance -= lumpToPrincipal;
      if (balance < 0) balance = 0;
    }
    const interestDue = balance * periodRate;
    const intendedMortgagePayment = mortgagePaymentPerPeriod + extraToMortgage;
    const maxNeededToClose = interestDue + balance;
    const actualMortgagePayment = Math.min(intendedMortgagePayment, maxNeededToClose);
    const actualMortgagePaymentClamped = Math.max(0, actualMortgagePayment);
    const principalPaid = Math.max(0, actualMortgagePaymentClamped - interestDue);
    balance = balance - principalPaid;
    if (balance < 0) balance = 0;
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
  // Everything is monthly now, so period rate = monthly rate
  const periodRate = annualRate / 100 / 12;
  const periodReturn = monthlyReturn;
  
  let balance = initialMortgageBalance;
  let investValue = 0;
  let totalInterestPaid = 0;
  let totalInterestEarned = 0;
  let payoffPeriod = null;
  
  const series = [];
  
  // Record initial state (month 0)
  const initialHomeValue = homePrice;
  const initialEquity = Math.max(0, initialHomeValue - balance);
  const initialNetWorth = initialEquity + investValue;
  series.push({
    month: 0,
    balance,
    investValue,
    netWorth: initialNetWorth
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
      const mortgageOverflow = lumpMortgage - lumpToPrincipal;
      investValue += lumpInvest + mortgageOverflow;
    }
    
    if (balance <= 0) {
      // Mortgage paid off - entire budget goes to investing
      // Beginning of period: add contribution first, then compound
      // Interest is earned on the balance AFTER adding the contribution
      const balanceAfterContribution = investValue + totalBudgetPerPeriod;
      const interestEarned = balanceAfterContribution * periodReturn;
      investValue = balanceAfterContribution * (1 + periodReturn);
      if (investValue < 0) investValue = 0;
      totalInterestEarned += interestEarned;
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
      
      // Principal paid
      const principalPaid = Math.max(0, actualMortgagePaymentClamped - interestDue);
      
      // Update balance
      balance = balance - principalPaid;
      if (balance < 0) balance = 0;
      
      // Track interest paid
      if (actualMortgagePaymentClamped > 0) {
        totalInterestPaid += interestDue;
      }
      
      // Track payoff period
      if (payoffPeriod === null && balance <= 0) {
        payoffPeriod = period;
      }
      
      // Investment allocation
      // Regular extra cash allocation plus remainder from mortgage payment
      const remainderFromMortgage = intendedMortgagePayment - actualMortgagePaymentClamped;
      const investContribution = extraToInvest + remainderFromMortgage;
      
      // Update investment value (beginning of period: add contribution first, then compound)
      // Interest is earned on the balance AFTER adding the contribution
      const balanceAfterContribution = investValue + investContribution;
      const interestEarned = balanceAfterContribution * periodReturn;
      investValue = balanceAfterContribution * (1 + periodReturn);
      if (investValue < 0) investValue = 0;
      
      // Track interest earned
      totalInterestEarned += interestEarned;
    }
    
    // Record series data at the end of each calendar month
    // Check if we've crossed into a new month or reached the end
    if (currentMonth > lastRecordedMonth || period === totalPeriods) {
      // Calculate home value at this month
      const homeValue = homePrice * Math.pow(1 + homeGrowthRate / 100, currentMonth / 12);
      
      // Calculate equity
      const equity = Math.max(0, homeValue - balance);
      
      // Net worth = equity + investments
      const netWorth = equity + investValue;
      
      series.push({
        month: currentMonth,
        balance,
        investValue,
        netWorth
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
    payoffMonth: payoffMonth !== null ? Math.ceil(payoffMonth) : null,
    series
  };
}

/* ============================================================
   Net worth at horizon from a simulation result
   (must match logic in calculateMortgageVsInvest for final row)
   ============================================================ */
function finalNetWorthAtHorizon(sim, finalHomeValue) {
  const finalEquity = Math.max(0, finalHomeValue - sim.finalBalance);
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
    // Use direct inputs
    initialMortgageBalance = clamp(Number.isFinite(currentBalance) ? currentBalance : 480000, 0, 10000000);
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
  
  // If we don't have initial balance, estimate from payment
  if (initialMortgageBalance <= 0 && !useCalculator) {
    // Rough estimate: assume 25 year amortization at 5%
    // This is not ideal but allows calculator to work
    const estAmortYears = 25;
    const estRate = 5;
    const estPpy = 12; // Always monthly
    // Reverse calculate: payment * (1 - (1+r)^-n) / r = principal
    const estPeriodRate = estRate / 100 / estPpy;
    const estNumPayments = estAmortYears * estPpy;
    if (estPeriodRate > 0) {
      initialMortgageBalance = actualMortgagePayment * (1 - Math.pow(1 + estPeriodRate, -estNumPayments)) / estPeriodRate;
    } else {
      initialMortgageBalance = actualMortgagePayment * estNumPayments;
    }
    annualRate = estRate;
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
  
  // Final home value
  const finalHomeValue = homePrice * Math.pow(1 + homeGrowth / 100, timeHorizon);
  
  // Final net worth
  const finalEquity = Math.max(0, finalHomeValue - currentResult.finalBalance);
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

// Export to window for UI
window.calculateMortgageVsInvest = calculateMortgageVsInvest;
