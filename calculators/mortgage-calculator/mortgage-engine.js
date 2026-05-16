/**
 * Pure mortgage math (payment + amortization schedule).
 * Loaded before script.js; exposes globalThis.MortgageEngine for the browser
 * and the same object on globalThis for Node (tests use createRequire).
 */
(function (g) {
  "use strict";

  function calculatePeriodicRate(annualRate, paymentsPerYear) {
    const annualRateDecimal = annualRate / 100;
    return Math.pow(1 + annualRateDecimal / 2, 2 / paymentsPerYear) - 1;
  }

  /**
   * Calculate standard monthly payment for fixed-rate mortgage.
   * Canadian mortgage rates are quoted as nominal annual rates compounded semi-annually.
   */
  function calculateMonthlyPayment(principal, annualRate, years) {
    if (annualRate === 0) {
      return principal / (years * 12);
    }
    const monthlyRate = calculatePeriodicRate(annualRate, 12);
    const numPayments = years * 12;
    const payment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numPayments));
    return payment;
  }

  function calculatePaymentAmount(principal, annualRate, years, frequency) {
    const monthlyPayment = calculateMonthlyPayment(principal, annualRate, years);

    switch (frequency) {
      case "monthly":
        return monthlyPayment;
      case "biweekly":
        return (monthlyPayment * 12) / 26;
      case "accelerated_biweekly":
        return monthlyPayment / 2;
      case "weekly":
        return (monthlyPayment * 12) / 52;
      case "accelerated_weekly":
        return monthlyPayment / 4;
      default:
        return monthlyPayment;
    }
  }

  function getPaymentsPerYear(frequency) {
    switch (frequency) {
      case "monthly":
        return 12;
      case "biweekly":
        return 26;
      case "accelerated_biweekly":
        return 26;
      case "weekly":
        return 52;
      case "accelerated_weekly":
        return 52;
      default:
        return 12;
    }
  }

  function computeSchedule(principal, annualRate, years, frequency) {
    if (isNaN(principal) || principal < 0) {
      return {
        isValid: false,
        errorMessage: "Invalid principal amount",
        pointsBalance: [],
        pointsCumInterest: [],
        schedule: [],
        totalInterest: 0,
        totalPaid: 0,
        payoffYears: 0,
      };
    }

    if (isNaN(annualRate) || annualRate < 0) {
      return {
        isValid: false,
        errorMessage: "Invalid interest rate",
        pointsBalance: [],
        pointsCumInterest: [],
        schedule: [],
        totalInterest: 0,
        totalPaid: 0,
        payoffYears: 0,
      };
    }

    if (isNaN(years) || years < 1 || years > 40) {
      return {
        isValid: false,
        errorMessage: "Invalid amortization period",
        pointsBalance: [],
        pointsCumInterest: [],
        schedule: [],
        totalInterest: 0,
        totalPaid: 0,
        payoffYears: 0,
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
        payoffYears: 0,
      };
    }

    const paymentsPerYear = getPaymentsPerYear(frequency);
    const periodicRate = calculatePeriodicRate(annualRate, paymentsPerYear);
    const totalPayments = Math.floor(years * paymentsPerYear);

    let paymentAmount;
    try {
      paymentAmount = calculatePaymentAmount(principal, annualRate, years, frequency);
      if (!isFinite(paymentAmount) || paymentAmount <= 0) {
        return {
          isValid: false,
          errorMessage: "Cannot compute payment amount",
          pointsBalance: [],
          pointsCumInterest: [],
          schedule: [],
          totalInterest: 0,
          totalPaid: 0,
          payoffYears: 0,
          maxPlottedY: principal || 0,
        };
      }
    } catch {
      return {
        isValid: false,
        errorMessage: "Error calculating payment",
        pointsBalance: [],
        pointsCumInterest: [],
        schedule: [],
        totalInterest: 0,
        totalPaid: 0,
        payoffYears: 0,
        maxPlottedY: principal || 0,
      };
    }

    if (periodicRate > 0 && paymentAmount <= principal * periodicRate) {
      return {
        isValid: false,
        errorMessage: "Payment does not amortize the loan at this rate",
        pointsBalance: [{ year: 0, balance: principal }],
        pointsCumInterest: [{ year: 0, cumulativeInterest: 0 }],
        schedule: [],
        totalInterest: 0,
        totalPaid: 0,
        payoffYears: 0,
        maxPlottedY: principal,
      };
    }

    const schedule = [];
    let balance = principal;
    let totalInterest = 0;
    let cumulativeInterest = 0;

    const maxPoints = 800;
    const pointsBalance = [{ year: 0, balance: principal }];
    const pointsCumInterest = [{ year: 0, cumulativeInterest: 0 }];
    const sampleInterval = Math.max(1, Math.ceil(totalPayments / maxPoints));

    for (let paymentNum = 1; paymentNum <= totalPayments && balance > 1e-6; paymentNum++) {
      let interestPortion;
      let principalPortion;

      if (periodicRate === 0) {
        interestPortion = 0;
        principalPortion = paymentAmount;
      } else {
        interestPortion = balance * periodicRate;
        principalPortion = paymentAmount - interestPortion;
      }

      if (principalPortion <= 0) {
        let maxPlottedY = principal;
        pointsBalance.forEach((p) => {
          if (p.balance !== undefined && isFinite(p.balance)) {
            maxPlottedY = Math.max(maxPlottedY, p.balance);
          }
        });
        pointsCumInterest.forEach((p) => {
          if (p.cumulativeInterest !== undefined && isFinite(p.cumulativeInterest)) {
            maxPlottedY = Math.max(maxPlottedY, p.cumulativeInterest);
          }
        });

        return {
          isValid: false,
          errorMessage: "Payment does not amortize the loan",
          pointsBalance: pointsBalance.length > 0 ? pointsBalance : [{ year: 0, balance: principal }],
          pointsCumInterest:
            pointsCumInterest.length > 0 ? pointsCumInterest : [{ year: 0, cumulativeInterest: 0 }],
          schedule,
          totalInterest,
          totalPaid: principal + totalInterest,
          payoffYears: (paymentNum - 1) / paymentsPerYear,
          maxPlottedY,
        };
      }

      if (principalPortion > balance) {
        principalPortion = balance;
      }

      balance -= principalPortion;
      totalInterest += interestPortion;
      cumulativeInterest += interestPortion;

      if (balance < 1e-6) {
        balance = 0;
      }

      schedule.push({
        paymentNum,
        paymentAmount,
        interestPortion,
        principalPortion,
        balance: Math.max(0, balance),
      });

      if (paymentNum % sampleInterval === 0 || paymentNum === totalPayments || balance <= 1e-6) {
        const tYears = paymentNum / paymentsPerYear;
        if (tYears <= 40) {
          pointsBalance.push({ year: tYears, balance: Math.max(0, balance) });
          pointsCumInterest.push({ year: tYears, cumulativeInterest });
        }
      }
    }

    const payoffYears = schedule.length / paymentsPerYear;

    if (pointsBalance.length === 0 || pointsBalance[pointsBalance.length - 1].year < payoffYears) {
      pointsBalance.push({ year: Math.min(payoffYears, 40), balance: 0 });
      pointsCumInterest.push({ year: Math.min(payoffYears, 40), cumulativeInterest });
    }

    let maxPlottedY = 0;
    if (pointsBalance.length > 0) {
      maxPlottedY = Math.max(maxPlottedY, pointsBalance[0].balance);
    }
    pointsBalance.forEach((p) => {
      if (p.balance !== undefined && isFinite(p.balance)) {
        maxPlottedY = Math.max(maxPlottedY, p.balance);
      }
    });
    pointsCumInterest.forEach((p) => {
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
      maxPlottedY: Math.max(maxPlottedY, principal),
    };
  }

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
        interestOverTime: result.pointsCumInterest,
      };
    }
    return {
      schedule: result.schedule,
      totalInterest: result.totalInterest,
      totalPaid: result.totalPaid,
      payoffYears: result.payoffYears,
      balanceOverTime: result.pointsBalance,
      interestOverTime: result.pointsCumInterest,
    };
  }

  g.MortgageEngine = {
    calculatePeriodicRate,
    calculateMonthlyPayment,
    calculatePaymentAmount,
    getPaymentsPerYear,
    computeSchedule,
    buildAmortizationSchedule,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
