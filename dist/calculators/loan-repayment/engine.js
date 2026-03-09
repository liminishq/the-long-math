// QA INVARIANT — Loan Repayment Calculator
//
// 1. Sum of all payment amounts in the amortization table
//    MUST equal the “Total paid” headline output (within rounding tolerance).
//
// 2. Sum of all interest amounts in the amortization table
//    MUST equal the “Total interest” headline output (within rounding tolerance).
//
// 3. The final amortization row MUST be a totals row with:
//    - Payment = sum of all payments
//    - Interest = sum of all interest
//    - Principal = sum of all principal
//    - Remaining balance = 0.00
//
// 4. Remaining balance MUST monotonically decrease and end at zero.
//    No negative balances are permitted (clamp final value if required).
//
// If any of the above conditions fail, the calculator is incorrect
// even if the UI renders without errors.

(function () {
  "use strict";

  /**
   * Core loan amortization engine for the Loan Repayment Calculator.
   *
   * Pure function – no DOM access, no side effects.
   *
   * @param {Object} params
   * @param {number} params.principal         Loan amount (P)
   * @param {number} params.annualRatePct     Annual interest rate in percent
   * @param {number} params.years             Amortization term in years
   * @param {number} params.paymentsPerYear   m = payments per year (12/26/52)
   * @returns {{
   *   paymentPerPeriod: number,
   *   totalPaid: number,
   *   totalInterest: number,
   *   numPayments: number,
   *   scheduleRows: Array<{
   *     periodIndex: number,
   *     label: string,
   *     payment: number,
   *     interest: number,
   *     principalPaid: number,
   *     balance: number
   *   }>,
   *   totalsRow: {
   *     label: string,
   *     payment: number,
   *     interest: number,
   *     principalPaid: number,
   *     balance: number
   *   }
   * }}
   */
  function computeLoanSchedule(params) {
    const principal = Number(params.principal);
    const annualRatePct = Number(params.annualRatePct);
    const years = Number(params.years);
    const paymentsPerYear = Number(params.paymentsPerYear);

    if (
      !Number.isFinite(principal) ||
      !Number.isFinite(annualRatePct) ||
      !Number.isFinite(years) ||
      !Number.isFinite(paymentsPerYear)
    ) {
      throw new Error("Invalid loan parameters");
    }

    if (principal <= 0 || years <= 0 || paymentsPerYear <= 0) {
      throw new Error("Loan parameters must be positive");
    }

    const r = annualRatePct / 100;
    const m = paymentsPerYear;
    const i = r / m;
    const N = Math.round(years * m);

    if (!Number.isFinite(N) || N <= 0) {
      throw new Error("Invalid number of payments");
    }

    let paymentPerPeriod;
    if (r === 0) {
      paymentPerPeriod = principal / N;
    } else {
      const pow = Math.pow(1 + i, N);
      paymentPerPeriod = principal * ((i * pow) / (pow - 1));
    }

    // Amortization schedule
    let balance = principal;
    const scheduleRows = [];

    let sumPayment = 0;
    let sumInterest = 0;
    let sumPrincipal = 0;

    // Helpers for labels
    function periodLabel(k) {
      // Monthly => "Month n"; Biweekly/Weekly => "Week n"
      if (m === 12) {
        return "Month " + k;
      }
      return "Week " + k;
    }

    for (let k = 1; k <= N; k++) {
      const interest = balance * i;
      const principalPaid = paymentPerPeriod - interest;
      let nextBalance = balance - principalPaid;

      // Track monotonicity – we rely on design (standard amortization)
      // and clamp only at the very end to avoid negative final balance.

      const rowPayment = paymentPerPeriod;

      sumPayment += rowPayment;
      sumInterest += interest;
      sumPrincipal += principalPaid;

      // For intermediate rows, keep raw balance (can be slightly above zero near the end)
      scheduleRows.push({
        periodIndex: k,
        label: periodLabel(k),
        payment: rowPayment,
        interest: interest,
        principalPaid: principalPaid,
        balance: nextBalance,
      });

      balance = nextBalance;
    }

    // Clamp final balance to zero for display safety
    const lastRow = scheduleRows[scheduleRows.length - 1];
    if (lastRow) {
      if (lastRow.balance < 0 && Math.abs(lastRow.balance) < 0.01) {
        lastRow.balance = 0;
      } else if (lastRow.balance < 0) {
        lastRow.balance = 0;
      }
      balance = lastRow.balance;
    }

    // Derive totals from unrounded sums
    const totalPaid = sumPayment;
    const totalInterest = sumInterest;
    const principalPaidTotal = sumPrincipal;

    const totalsRow = {
      label: "Total",
      payment: totalPaid,
      interest: totalInterest,
      principalPaid: principalPaidTotal,
      balance: 0,
    };

    return {
      paymentPerPeriod,
      totalPaid,
      totalInterest,
      numPayments: N,
      scheduleRows,
      totalsRow,
    };
  }

  // Export to global for UI
  window.computeLoanSchedule = computeLoanSchedule;
})();

