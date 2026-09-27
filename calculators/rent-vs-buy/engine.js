/**
 * Rent vs. Buy Calculator — orchestration engine.
 *
 * Reuses:
 *   - MortgageEngine (Canadian amortization / payment)
 *   - InvestmentGrowthEngine (monthly geometric return, nominal→real)
 *   - CanadaMortgageLoanInsurance (CMHC-style premiums)
 *
 * Model: monthly, up to 60 years. Equal starting resources; cash-flow
 * difference may be invested. Net worth uses net realizable home equity.
 *
 * Exposes globalThis.RentVsBuyEngine.
 */
(function (g) {
  "use strict";

  var HORIZON_MONTHS = 720; // 60 years
  var MORTGAGE_EPS = 1e-6;
  var PAYMENT_EPS = 1e-9;
  var CROSSOVER_EPS = 1e-6;
  var SOLVER_TOLERANCE_DOLLARS = 1;
  var INV_BE_SEARCH_MIN = -0.5;
  var INV_BE_SEARCH_MAX = 0.4;
  /** Coarse scan step: 0.10 percentage points. */
  var INV_BE_COARSE_STEP = 0.001;
  /** Distinct-root identity in annual return units. */
  var INV_BE_ROOT_DEDUP = 5e-5;
  /**
   * Local-extremum |f| must be at most this large (dollars) before we spend
   * refinement effort looking for a tangent / touching root.
   */
  var INV_BE_TANGENT_CANDIDATE_DOLLARS = 25000;

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function requireMortgageEngine() {
    var ME = g.MortgageEngine;
    if (!ME) {
      throw new Error("MortgageEngine is required for RentVsBuyEngine");
    }
    return ME;
  }

  function requireInvestmentEngine() {
    var IGE = g.InvestmentGrowthEngine;
    if (!IGE) {
      throw new Error("InvestmentGrowthEngine is required for RentVsBuyEngine");
    }
    return IGE;
  }

  function annualToMonthlyGrowth(annualDecimal) {
    var r = Number(annualDecimal);
    if (!Number.isFinite(r) || r <= -1) return NaN;
    if (Math.abs(r) < 1e-15) return 0;
    return Math.pow(1 + r, 1 / 12) - 1;
  }

  function nominalHomeAppreciationRate(inputs) {
    var mode = inputs.homeAppreciationMode || "nominal";
    var inflation = Number(inputs.inflationAnnual) || 0;
    if (mode === "real_linked") {
      var realAppr = Number(inputs.realHomeAppreciationAnnual) || 0;
      return (1 + inflation) * (1 + realAppr) - 1;
    }
    return Number(inputs.homeAppreciationAnnual) || 0;
  }

  function sellingCostsAt(homeValue, sellingCostPct, sellingCostFixed) {
    var hv = Math.max(0, Number(homeValue) || 0);
    var pct = Math.max(0, Number(sellingCostPct) || 0);
    var fixed = Math.max(0, Number(sellingCostFixed) || 0);
    return hv * pct + fixed;
  }

  function escalateAnnualAmount(baseAnnual, annualGrowth, monthIndex) {
    // Amount applicable during month m (1-based): grow by full years elapsed after month 0.
    // After m months, yearsElapsed = (m - 1) / 12 for start-of-month level, or m/12 end.
    // Use end-of-month calendar year fraction (m/12) for expense level during month m.
    var g = Number(annualGrowth) || 0;
    var m = Math.max(0, monthIndex);
    if (Math.abs(g) < 1e-15 || m === 0) return baseAnnual;
    return baseAnnual * Math.pow(1 + g, m / 12);
  }

  function monthlyFromAnnual(annualAmount) {
    return (Number(annualAmount) || 0) / 12;
  }

  function normalizeOtherExpenses(rows) {
    var list = Array.isArray(rows) ? rows : [];
    return list.map(function (row) {
      var amount = Number(row && row.amount) || 0;
      var freq = (row && row.frequency) === "annual" ? "annual" : "monthly";
      var monthly = freq === "annual" ? amount / 12 : amount;
      return {
        description: (row && row.description) || "",
        amount: amount,
        frequency: freq,
        monthlyBase: monthly,
      };
    });
  }

  function otherExpensesMonthly(rows, inflationAnnual, monthIndex) {
    var total = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var baseAnnualEquivalent = rows[i].monthlyBase * 12;
      total += monthlyFromAnnual(
        escalateAnnualAmount(baseAnnualEquivalent, inflationAnnual, monthIndex)
      );
    }
    return total;
  }

  /**
   * Resolve mortgage insurance into cash and financed components.
   */
  function resolveMortgageInsurance(inputs) {
    var mode = inputs.mortgageInsuranceMode || "automatic_canadian";
    var purchasePrice = Number(inputs.purchasePrice) || 0;
    var downPayment = Number(inputs.downPayment) || 0;
    var loanBefore = Math.max(0, purchasePrice - downPayment);

    if (mode === "none") {
      return {
        mode: "none",
        loanBeforePremium: loanBefore,
        financedPremium: 0,
        upfrontInsuranceCash: 0,
        recurringMonthlyInsurance: 0,
        recurringInsuranceDurationMonths: null,
        mortgagePrincipal: loanBefore,
        detail: null,
      };
    }

    if (mode === "custom") {
      var upfront = Math.max(0, Number(inputs.customInsuranceUpfront) || 0);
      var financed = Math.max(0, Number(inputs.customInsuranceFinanced) || 0);
      var recurring = Math.max(0, Number(inputs.customInsuranceMonthly) || 0);
      var durationRaw = inputs.customInsuranceMonthlyDurationMonths;
      var durationMonths = null;
      if (
        durationRaw !== "" &&
        durationRaw != null &&
        Number.isFinite(Number(durationRaw)) &&
        Number(durationRaw) > 0
      ) {
        durationMonths = Math.floor(Number(durationRaw));
      }
      return {
        mode: "custom",
        loanBeforePremium: loanBefore,
        financedPremium: financed,
        upfrontInsuranceCash: upfront,
        recurringMonthlyInsurance: recurring,
        recurringInsuranceDurationMonths: durationMonths,
        mortgagePrincipal: loanBefore + financed,
        detail: null,
      };
    }

    // automatic Canadian
    var CMLI = g.CanadaMortgageLoanInsurance;
    if (!CMLI) {
      return {
        error: "Canadian mortgage loan insurance module is not loaded.",
        errorCode: "missing_cmhc_module",
      };
    }
    var result = CMLI.calculatePurchasePremium({
      purchasePrice: purchasePrice,
      downPayment: downPayment,
      amortizationYears: Number(inputs.amortizationYears) || 25,
      province: inputs.insuranceProvince || "none",
      nonTraditionalDownPayment: !!inputs.nonTraditionalDownPayment,
      financePremium: inputs.financeInsurancePremium !== false,
      thirtyYearEligibility: inputs.thirtyYearEligibility || "neither",
      asOfDate: inputs.insuranceTaxAsOfDate,
    });
    if (result.error) {
      return {
        error: result.error,
        errorCode: result.errorCode,
        detail: result,
      };
    }
    return {
      mode: "automatic_canadian",
      loanBeforePremium: result.loanBeforePremium,
      financedPremium: result.financedPremium,
      upfrontInsuranceCash: result.totalUpfrontInsuranceCash,
      recurringMonthlyInsurance: 0,
      recurringInsuranceDurationMonths: null,
      mortgagePrincipal: result.mortgagePrincipal,
      detail: result,
    };
  }

  /**
   * Custom recurring monthly mortgage insurance for month m.
   * Never charged once the mortgage balance is already zero.
   * Optional durationMonths: stop after that many months (1-based occupancy months).
   * If durationMonths is null/blank, continues only while the mortgage remains outstanding
   * (stops at mortgage payoff).
   */
  function customRecurringInsuranceForMonth(
    recurringAmount,
    month,
    mortgageBalanceBeforePayment,
    durationMonths
  ) {
    var amount = Number(recurringAmount) || 0;
    if (!(amount > 0)) return 0;
    if (!(mortgageBalanceBeforePayment > MORTGAGE_EPS)) return 0;
    if (
      durationMonths != null &&
      Number.isFinite(durationMonths) &&
      durationMonths >= 0 &&
      month > durationMonths
    ) {
      return 0;
    }
    return amount;
  }

  function buildStartingCapitalSplit(inputs, insurance) {
    var startingCapital = Math.max(0, Number(inputs.startingCapital) || 0);
    var downPayment = Math.max(0, Number(inputs.downPayment) || 0);
    var closingCosts = Math.max(0, Number(inputs.closingCosts) || 0);
    var upfrontInsurance = Math.max(0, insurance.upfrontInsuranceCash || 0);
    var buyerDeployed = downPayment + closingCosts + upfrontInsurance;
    var buyerRemaining = startingCapital - buyerDeployed;
    var renterUpfront = Math.max(0, Number(inputs.renterUpfrontCosts) || 0);
    var renterStartingInvestable = startingCapital - renterUpfront;

    return {
      startingCapital: startingCapital,
      buyerDeployed: buyerDeployed,
      buyerRemaining: buyerRemaining,
      renterStartingInvestable: renterStartingInvestable,
      renterUpfront: renterUpfront,
      downPayment: downPayment,
      closingCosts: closingCosts,
      upfrontInsurance: upfrontInsurance,
      shortfall: buyerRemaining < -1e-9,
      shortfallAmount: buyerRemaining < 0 ? -buyerRemaining : 0,
      renterUpfrontShortfall: renterUpfront > startingCapital + 1e-9,
      renterUpfrontShortfallAmount:
        renterUpfront > startingCapital ? renterUpfront - startingCapital : 0,
    };
  }

  function ownerCashRequiredMonth(state, costs, month) {
    var mortgagePayment = state.mortgagePaymentThisMonth;
    var propTax = monthlyFromAnnual(
      escalateAnnualAmount(
        costs.propertyTaxAnnual,
        costs.propertyTaxGrowth,
        month
      )
    );
    var maintenance = monthlyFromAnnual(
      escalateAnnualAmount(costs.maintenanceAnnual, costs.inflationAnnual, month)
    );
    var homeIns = monthlyFromAnnual(
      escalateAnnualAmount(costs.homeInsuranceAnnual, costs.inflationAnnual, month)
    );
    var condo = monthlyFromAnnual(
      escalateAnnualAmount(costs.condoFeesAnnual, costs.inflationAnnual, month)
    );
    var utilities =
      costs.ownerUtilitiesMonthly *
      Math.pow(1 + costs.ownerUtilitiesGrowth, month / 12);
    var other = otherExpensesMonthly(
      costs.ownerOther,
      costs.inflationAnnual,
      month
    );
    var balBefore =
      state.mortgageBalanceBeforePayment != null
        ? state.mortgageBalanceBeforePayment
        : 0;
    var recurringIns = customRecurringInsuranceForMonth(
      costs.recurringMonthlyInsurance,
      month,
      balBefore,
      costs.recurringInsuranceDurationMonths
    );
    return (
      mortgagePayment +
      propTax +
      maintenance +
      homeIns +
      condo +
      utilities +
      other +
      recurringIns
    );
  }

  function renterCashRequiredMonth(costs, month) {
    var rent =
      costs.monthlyRent * Math.pow(1 + costs.rentGrowthAnnual, month / 12);
    var tenantIns = monthlyFromAnnual(
      escalateAnnualAmount(costs.tenantInsuranceAnnual, costs.inflationAnnual, month)
    );
    var utilities =
      costs.renterUtilitiesMonthly *
      Math.pow(1 + costs.renterUtilitiesGrowth, month / 12);
    var other = otherExpensesMonthly(
      costs.renterOther,
      costs.inflationAnnual,
      month
    );
    return rent + tenantIns + utilities + other;
  }

  function detectCrossovers(differenceSeries) {
    // differenceSeries[t] = buyerNW - renterNW at end of month t (t=0..N)
    var crossovers = [];
    var prevSign = 0;
    for (var t = 0; t < differenceSeries.length; t += 1) {
      var d = differenceSeries[t];
      var sign = 0;
      if (d > CROSSOVER_EPS) sign = 1;
      else if (d < -CROSSOVER_EPS) sign = -1;

      if (t === 0) {
        prevSign = sign;
        continue;
      }
      if (sign === 0) {
        // Exact (near) equality: treat as a crossing marker once when arriving at zero from nonzero.
        if (prevSign !== 0) {
          crossovers.push({
            month: t,
            years: t / 12,
            from: prevSign > 0 ? "buyer" : "renter",
            to: "tie",
            difference: d,
          });
          prevSign = 0;
        }
        continue;
      }
      if (prevSign === 0) {
        // Leaving equality: not a strategy flip yet unless previous nonzero existed.
        prevSign = sign;
        continue;
      }
      if (sign !== prevSign) {
        crossovers.push({
          month: t,
          years: t / 12,
          from: prevSign > 0 ? "buyer" : "renter",
          to: sign > 0 ? "buyer" : "renter",
          difference: d,
        });
        prevSign = sign;
      }
    }
    return crossovers;
  }

  function summarizeCrossovers(crossovers, firstDiff, lastDiff) {
    var startLead =
      firstDiff > CROSSOVER_EPS
        ? "buyer"
        : firstDiff < -CROSSOVER_EPS
          ? "renter"
          : "tie";
    var endLead =
      lastDiff > CROSSOVER_EPS
        ? "buyer"
        : lastDiff < -CROSSOVER_EPS
          ? "renter"
          : "tie";

    // Filter "to: tie" for narrative; keep strategy-to-strategy flips.
    var flips = crossovers.filter(function (c) {
      return c.to === "buyer" || c.to === "renter";
    });

    return {
      startLead: startLead,
      endLead: endLead,
      flips: flips,
      allMarkers: crossovers,
      kind:
        flips.length === 0
          ? startLead === "tie"
            ? "always_tied"
            : startLead === "buyer"
              ? "buyer_always"
              : "renter_always"
          : flips.length === 1
            ? "single_crossover"
            : "multiple_crossovers",
    };
  }

  function snapshotAt(series, month) {
    var idx = Math.min(series.length - 1, Math.max(0, Math.round(month)));
    return series[idx];
  }

  function toRealPoint(point, inflationAnnual) {
    var IGE = requireInvestmentEngine();
    var m = point.month;
    function r(v) {
      return IGE.nominalToReal(v, inflationAnnual, m);
    }
    return {
      month: m,
      homeValue: r(point.homeValue),
      mortgageBalance: r(point.mortgageBalance),
      grossEquity: r(point.grossEquity),
      sellingCosts: r(point.sellingCosts),
      netRealizableEquity: r(point.netRealizableEquity),
      buyerInvestments: r(point.buyerInvestments),
      buyerNetWorth: r(point.buyerNetWorth),
      renterInvestments: r(point.renterInvestments),
      renterNetWorth: r(point.renterNetWorth),
      difference: r(point.buyerNetWorth) - r(point.renterNetWorth),
      ownerCash: r(point.ownerCash),
      renterCash: r(point.renterCash),
      mortgagePrincipalPortion: r(point.mortgagePrincipalPortion),
      mortgageInterestPortion: r(point.mortgageInterestPortion),
    };
  }

  /**
   * Core monthly simulation.
   */
  function simulate(rawInputs) {
    var ME = requireMortgageEngine();
    var IGE = requireInvestmentEngine();
    var inputs = rawInputs || {};

    var purchasePrice = Number(inputs.purchasePrice);
    var downPayment = Number(inputs.downPayment);
    var startingCapital = Number(inputs.startingCapital);
    var amortizationYears = Number(inputs.amortizationYears);
    var mortgageRatePct = Number(inputs.mortgageRatePct);
    var closingCosts = Math.max(0, Number(inputs.closingCosts) || 0);
    var sellingCostPct = Math.max(0, Number(inputs.sellingCostPercent) || 0);
    var sellingCostFixed = Math.max(0, Number(inputs.sellingCostFixed) || 0);

    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return { error: "Purchase price must be zero or greater.", errorCode: "invalid_purchase_price" };
    }
    if (!Number.isFinite(downPayment) || downPayment < 0) {
      return { error: "Down payment must be zero or greater.", errorCode: "invalid_down_payment" };
    }
    if (downPayment > purchasePrice + 1e-9) {
      return { error: "Down payment cannot exceed purchase price.", errorCode: "down_exceeds_price" };
    }
    if (!Number.isFinite(startingCapital) || startingCapital < 0) {
      return { error: "Starting capital must be zero or greater.", errorCode: "invalid_starting_capital" };
    }
    if (!Number.isFinite(amortizationYears) || amortizationYears < 0 || amortizationYears > 40) {
      return { error: "Amortization period must be between 0 and 40 years.", errorCode: "invalid_amortization" };
    }
    if (!Number.isFinite(mortgageRatePct) || mortgageRatePct < 0) {
      return { error: "Mortgage rate must be zero or greater.", errorCode: "invalid_mortgage_rate" };
    }

    var inflationAnnual = Number(inputs.inflationAnnual);
    if (!Number.isFinite(inflationAnnual) || inflationAnnual <= -1) {
      return { error: "Inflation must be greater than -100%.", errorCode: "invalid_inflation" };
    }
    var investmentReturnAnnual = Number(inputs.investmentReturnAnnual);
    if (!Number.isFinite(investmentReturnAnnual) || investmentReturnAnnual <= -1) {
      return {
        error: "Investment return must be greater than -100%.",
        errorCode: "invalid_investment_return",
      };
    }

    var homeApprAnnual = nominalHomeAppreciationRate(inputs);
    if (!Number.isFinite(homeApprAnnual) || homeApprAnnual <= -1) {
      return {
        error: "Home appreciation must be greater than -100%.",
        errorCode: "invalid_home_appreciation",
      };
    }

    var rentGrowthAnnual = Number(inputs.rentGrowthAnnual);
    if (!Number.isFinite(rentGrowthAnnual) || rentGrowthAnnual <= -1) {
      return { error: "Rent growth must be greater than -100%.", errorCode: "invalid_rent_growth" };
    }

    var insurance = resolveMortgageInsurance(inputs);
    if (insurance.error) {
      return {
        error: insurance.error,
        errorCode: insurance.errorCode,
        insurance: insurance.detail || null,
      };
    }

    var capital = buildStartingCapitalSplit(inputs, insurance);
    if (capital.renterUpfrontShortfall) {
      return {
        error: "Upfront renter costs cannot exceed available starting capital.",
        errorCode: "renter_upfront_exceeds_capital",
        capital: capital,
        insurance: insurance.detail,
      };
    }
    if (capital.shortfall) {
      return {
        error:
          "Starting capital is less than buyer upfront costs (down payment + closing costs + any upfront mortgage insurance). Increase starting capital or reduce upfront costs.",
        errorCode: "starting_capital_shortfall",
        capital: capital,
        insurance: insurance.detail,
      };
    }

    var mortgagePrincipal = insurance.mortgagePrincipal;
    var scheduledPayment = 0;
    var amortYearsEffective = amortizationYears;

    if (mortgagePrincipal > MORTGAGE_EPS) {
      if (amortizationYears < 1e-9) {
        return {
          error: "Amortization period must be at least a fraction of a year when a mortgage exists.",
          errorCode: "invalid_amortization",
        };
      }
      scheduledPayment = ME.calculateMonthlyPayment(
        mortgagePrincipal,
        mortgageRatePct,
        amortYearsEffective
      );
      if (!Number.isFinite(scheduledPayment) || scheduledPayment < 0) {
        return { error: "Could not compute mortgage payment.", errorCode: "payment_error" };
      }
      var periodRateCheck = ME.calculatePeriodicRate(mortgageRatePct, 12);
      if (periodRateCheck > 0 && scheduledPayment <= mortgagePrincipal * periodRateCheck + PAYMENT_EPS) {
        return {
          error: "Mortgage payment does not amortize the loan at this rate.",
          errorCode: "non_amortizing_payment",
        };
      }
    }

    var propertyTaxGrowth = inputs.propertyTaxUseInflation !== false
      ? inflationAnnual
      : Number(inputs.propertyTaxGrowthAnnual) || 0;
    var ownerUtilGrowth = inputs.ownerUtilitiesUseInflation !== false
      ? inflationAnnual
      : Number(inputs.ownerUtilitiesGrowthAnnual) || 0;
    var renterUtilGrowth = inputs.renterUtilitiesUseInflation !== false
      ? inflationAnnual
      : Number(inputs.renterUtilitiesGrowthAnnual) || 0;

    var costs = {
      inflationAnnual: inflationAnnual,
      propertyTaxAnnual: Math.max(0, Number(inputs.propertyTaxAnnual) || 0),
      propertyTaxGrowth: propertyTaxGrowth,
      maintenanceAnnual: Math.max(0, Number(inputs.maintenanceAnnual) || 0),
      homeInsuranceAnnual: Math.max(0, Number(inputs.homeInsuranceAnnual) || 0),
      condoFeesAnnual: Math.max(
        0,
        (Number(inputs.condoFeesMonthly) || 0) * 12
      ),
      ownerUtilitiesMonthly: Math.max(0, Number(inputs.ownerUtilitiesMonthly) || 0),
      ownerUtilitiesGrowth: ownerUtilGrowth,
      ownerOther: normalizeOtherExpenses(inputs.ownerOtherExpenses),
      recurringMonthlyInsurance: insurance.recurringMonthlyInsurance || 0,
      recurringInsuranceDurationMonths: insurance.recurringInsuranceDurationMonths,
      monthlyRent: Math.max(0, Number(inputs.monthlyRent) || 0),
      rentGrowthAnnual: rentGrowthAnnual,
      tenantInsuranceAnnual: Math.max(0, Number(inputs.tenantInsuranceAnnual) || 0),
      renterUtilitiesMonthly: Math.max(0, Number(inputs.renterUtilitiesMonthly) || 0),
      renterUtilitiesGrowth: renterUtilGrowth,
      renterOther: normalizeOtherExpenses(inputs.renterOtherExpenses),
    };

    var investCashFlowDiff = inputs.investCashFlowDifference !== false;
    var monthlyMu = IGE.monthlyGeometricReturn(investmentReturnAnnual);
    var monthlyHomeG = annualToMonthlyGrowth(homeApprAnnual);
    var monthlyMortgageRate = ME.calculatePeriodicRate(mortgageRatePct, 12);

    var buyerInvest = capital.buyerRemaining;
    var renterInvest = capital.renterStartingInvestable;
    var buyerContribCumulative = 0;
    var renterContribCumulative = 0;
    // Starting balances count as initial invested capital, not "additional" CF.
    var buyerStartInvested = capital.buyerRemaining;
    var renterStartInvested = capital.renterStartingInvestable;

    var mortgageBalance = mortgagePrincipal;
    var homeValue = purchasePrice;
    var payoffMonth = mortgagePrincipal <= MORTGAGE_EPS ? 0 : null;

    var series = [];
    var differenceSeries = [];

    function pushPoint(month, extras) {
      var selling = sellingCostsAt(homeValue, sellingCostPct, sellingCostFixed);
      var grossEquity = homeValue - mortgageBalance;
      var netEquity = homeValue - mortgageBalance - selling;
      var buyerNW = netEquity + buyerInvest;
      var renterNW = renterInvest;
      var point = {
        month: month,
        homeValue: homeValue,
        mortgageBalance: Math.max(0, mortgageBalance),
        grossEquity: grossEquity,
        sellingCosts: selling,
        netRealizableEquity: netEquity,
        buyerInvestments: buyerInvest,
        buyerNetWorth: buyerNW,
        renterInvestments: renterInvest,
        renterNetWorth: renterNW,
        difference: buyerNW - renterNW,
        buyerContribCumulative: buyerContribCumulative,
        renterContribCumulative: renterContribCumulative,
        ownerCash: extras && extras.ownerCash != null ? extras.ownerCash : 0,
        renterCash: extras && extras.renterCash != null ? extras.renterCash : 0,
        mortgagePayment: extras && extras.mortgagePayment != null ? extras.mortgagePayment : 0,
        mortgagePrincipalPortion:
          extras && extras.principalPortion != null ? extras.principalPortion : 0,
        mortgageInterestPortion:
          extras && extras.interestPortion != null ? extras.interestPortion : 0,
        cashFlowDiff:
          extras && extras.cashFlowDiff != null ? extras.cashFlowDiff : 0,
      };
      series.push(point);
      differenceSeries.push(point.difference);
      return point;
    }

    // Month 0: at purchase, before first month of occupancy cash flows.
    var ownerCash0 =
      ownerCashRequiredMonth(
        {
          mortgagePaymentThisMonth: scheduledPayment,
          mortgageBalanceBeforePayment: mortgagePrincipal,
        },
        costs,
        0
      );
    // At t=0 show first-month scheduled cash requirements for affordability context.
    var renterCash0 = renterCashRequiredMonth(costs, 0);
    pushPoint(0, {
      ownerCash: ownerCash0,
      renterCash: renterCash0,
      mortgagePayment: scheduledPayment,
      principalPortion: 0,
      interestPortion: 0,
      cashFlowDiff: ownerCash0 - renterCash0,
    });

    for (var month = 1; month <= HORIZON_MONTHS; month += 1) {
      // Home appreciation (end-of-month)
      homeValue = homeValue * (1 + monthlyHomeG);
      if (homeValue < 0) homeValue = 0;

      var interestPortion = 0;
      var principalPortion = 0;
      var actualMortgagePayment = 0;
      var balanceBeforePayment = mortgageBalance;

      if (mortgageBalance > MORTGAGE_EPS) {
        interestPortion = mortgageBalance * monthlyMortgageRate;
        var intended = scheduledPayment;
        var maxNeeded = interestPortion + mortgageBalance;
        actualMortgagePayment = Math.min(intended, maxNeeded);
        if (actualMortgagePayment < 0) actualMortgagePayment = 0;

        if (monthlyMortgageRate > 0 && actualMortgagePayment <= interestPortion + PAYMENT_EPS) {
          return {
            error: "Mortgage payment does not amortize the loan at this rate.",
            errorCode: "non_amortizing_payment",
          };
        }

        principalPortion = actualMortgagePayment - interestPortion;
        if (principalPortion > mortgageBalance) {
          principalPortion = mortgageBalance;
          actualMortgagePayment = interestPortion + principalPortion;
        }
        mortgageBalance -= principalPortion;
        if (mortgageBalance < MORTGAGE_EPS) {
          mortgageBalance = 0;
          if (payoffMonth == null) payoffMonth = month;
        }
      } else {
        mortgageBalance = 0;
        if (payoffMonth == null) payoffMonth = month - 1;
      }

      var ownerCash = ownerCashRequiredMonth(
        {
          mortgagePaymentThisMonth: actualMortgagePayment,
          mortgageBalanceBeforePayment: balanceBeforePayment,
        },
        costs,
        month
      );
      var renterCash = renterCashRequiredMonth(costs, month);
      var d = ownerCash - renterCash; // >0 => renter cheaper

      var buyerContrib = 0;
      var renterContrib = 0;
      if (investCashFlowDiff) {
        if (d > 0) renterContrib = d;
        else if (d < 0) buyerContrib = -d;
      }

      buyerInvest = IGE.applyEndOfMonthGrowthAndContribution(
        buyerInvest,
        monthlyMu,
        buyerContrib
      );
      renterInvest = IGE.applyEndOfMonthGrowthAndContribution(
        renterInvest,
        monthlyMu,
        renterContrib
      );
      buyerContribCumulative += buyerContrib;
      renterContribCumulative += renterContrib;

      pushPoint(month, {
        ownerCash: ownerCash,
        renterCash: renterCash,
        mortgagePayment: actualMortgagePayment,
        principalPortion: principalPortion,
        interestPortion: interestPortion,
        cashFlowDiff: d,
      });
    }

    if (payoffMonth == null && mortgageBalance <= MORTGAGE_EPS) {
      payoffMonth = 0;
    }

    var crossoverSummary = summarizeCrossovers(
      detectCrossovers(differenceSeries),
      differenceSeries[0],
      differenceSeries[differenceSeries.length - 1]
    );

    var comparisonYear = Number(inputs.comparisonYear);
    if (!Number.isFinite(comparisonYear) || comparisonYear < 0) comparisonYear = 10;
    comparisonYear = clamp(comparisonYear, 0, 60);
    var comparisonMonth = Math.round(comparisonYear * 12);
    var comparisonPoint = snapshotAt(series, comparisonMonth);

    var standardYears = [5, 10, 20, 30];
    var snapshots = standardYears.map(function (y) {
      var p = snapshotAt(series, y * 12);
      return {
        label: "Year " + y,
        year: y,
        month: y * 12,
        buyerNetWorth: p.buyerNetWorth,
        renterNetWorth: p.renterNetWorth,
        difference: p.difference,
      };
    });
    if (payoffMonth != null && payoffMonth > 0) {
      var pp = snapshotAt(series, payoffMonth);
      snapshots.push({
        label: "Mortgage payoff — final payment",
        year: payoffMonth / 12,
        month: payoffMonth,
        buyerNetWorth: pp.buyerNetWorth,
        renterNetWorth: pp.renterNetWorth,
        difference: pp.difference,
        isPayoff: true,
      });
    }

    return {
      horizonMonths: HORIZON_MONTHS,
      nominalHomeAppreciationAnnual: homeApprAnnual,
      scheduledMortgagePayment: scheduledPayment,
      mortgagePrincipal: mortgagePrincipal,
      insurance: insurance,
      capital: capital,
      investCashFlowDifference: investCashFlowDiff,
      investmentReturnAnnual: investmentReturnAnnual,
      inflationAnnual: inflationAnnual,
      series: series,
      crossover: crossoverSummary,
      payoffMonth: payoffMonth,
      comparisonYear: comparisonYear,
      comparisonMonth: comparisonMonth,
      comparisonPoint: comparisonPoint,
      snapshots: snapshots,
      month0Cash: {
        owner: series[0].ownerCash,
        renter: series[0].renterCash,
        difference: series[0].cashFlowDiff,
        mortgagePayment: series[0].mortgagePayment,
        // First payment principal (month 1) for equity context
        firstMonthPrincipal: series.length > 1 ? series[1].mortgagePrincipalPortion : 0,
        firstMonthInterest: series.length > 1 ? series[1].mortgageInterestPortion : 0,
      },
      buyerStartInvested: buyerStartInvested,
      renterStartInvested: renterStartInvested,
    };
  }

  function formatHeadline(result) {
    if (!result || result.error) return null;
    var c = result.crossover;
    var flips = c.flips || [];
    function yearsLabel(y) {
      var rounded = Math.round(y * 10) / 10;
      return String(rounded);
    }
    if (c.kind === "buyer_always") {
      return "Buying produces the higher projected net worth throughout the period modelled under these assumptions.";
    }
    if (c.kind === "renter_always") {
      return "Renting produces the higher projected net worth throughout the period modelled under these assumptions.";
    }
    if (c.kind === "always_tied") {
      return "Buying and renting produce approximately equal projected net worth throughout the period modelled under these assumptions.";
    }
    if (c.kind === "single_crossover" && flips.length === 1) {
      var f = flips[0];
      if (f.from === "renter" && f.to === "buyer") {
        return (
          "Renting produces the higher projected net worth for the first " +
          yearsLabel(f.years) +
          " years. Buying is ahead thereafter under these assumptions."
        );
      }
      if (f.from === "buyer" && f.to === "renter") {
        return (
          "Buying produces the higher projected net worth for the first " +
          yearsLabel(f.years) +
          " years. Renting is ahead thereafter under these assumptions."
        );
      }
    }
    // Multiple crossovers
    var lead =
      c.startLead === "buyer"
        ? "Buying is ahead initially"
        : c.startLead === "renter"
          ? "Renting is ahead initially"
          : "The strategies start approximately tied";
    var flipParts = [];
    for (var i = 0; i < flips.length; i += 1) {
      var flip = flips[i];
      var who = flip.to === "buyer" ? "buying" : "renting";
      flipParts.push(
        who + " moves ahead after " + yearsLabel(flip.years) + " years"
      );
    }
    return (
      "The strategies change position more than once under these assumptions. " +
      lead +
      ", " +
      flipParts.join(", and ") +
      "."
    );
  }

  /**
   * Re-run simulation with one parameter overridden; return difference at comparison month.
   */
  function differenceAtComparison(baseInputs, overrides) {
    var merged = Object.assign({}, baseInputs, overrides);
    var result = simulate(merged);
    if (result.error) return { error: result.error, errorCode: result.errorCode };
    var month = Math.round((Number(baseInputs.comparisonYear) || 10) * 12);
    month = clamp(month, 0, HORIZON_MONTHS);
    var point = result.series[month];
    return {
      difference: point.difference,
      buyerNetWorth: point.buyerNetWorth,
      renterNetWorth: point.renterNetWorth,
      result: result,
    };
  }

  function solveBreakEvenHomeAppreciation(baseInputs) {
    var mode = baseInputs.homeAppreciationMode || "nominal";
    var lo = -0.2;
    var hi = 0.3;
    var mid;
    var iter;
    var atLo = differenceAtComparison(
      baseInputs,
      mode === "real_linked"
        ? { realHomeAppreciationAnnual: lo }
        : { homeAppreciationAnnual: lo, homeAppreciationMode: "nominal" }
    );
    if (atLo.error) return { error: atLo.error, errorCode: atLo.errorCode };
    var atHi = differenceAtComparison(
      baseInputs,
      mode === "real_linked"
        ? { realHomeAppreciationAnnual: hi }
        : { homeAppreciationAnnual: hi, homeAppreciationMode: "nominal" }
    );
    if (atHi.error) return { error: atHi.error, errorCode: atHi.errorCode };

    // Higher appreciation should raise buyer NW relative to renter.
    if (Math.abs(atLo.difference) <= SOLVER_TOLERANCE_DOLLARS) {
      return {
        rate: lo,
        mode: mode,
        comparisonYear: Number(baseInputs.comparisonYear) || 10,
        difference: atLo.difference,
      };
    }
    if (Math.abs(atHi.difference) <= SOLVER_TOLERANCE_DOLLARS) {
      return {
        rate: hi,
        mode: mode,
        comparisonYear: Number(baseInputs.comparisonYear) || 10,
        difference: atHi.difference,
      };
    }
    if (atLo.difference * atHi.difference > 0) {
      return {
        unreachable: true,
        message:
          "No break-even home-appreciation rate was found within −20% to +30% per year at the selected comparison year under these assumptions.",
        comparisonYear: Number(baseInputs.comparisonYear) || 10,
        differenceAtLow: atLo.difference,
        differenceAtHigh: atHi.difference,
      };
    }

    for (iter = 0; iter < 64; iter += 1) {
      mid = (lo + hi) / 2;
      var atMid = differenceAtComparison(
        baseInputs,
        mode === "real_linked"
          ? { realHomeAppreciationAnnual: mid }
          : { homeAppreciationAnnual: mid, homeAppreciationMode: "nominal" }
      );
      if (atMid.error) return { error: atMid.error, errorCode: atMid.errorCode };
      if (Math.abs(atMid.difference) <= SOLVER_TOLERANCE_DOLLARS) {
        return {
          rate: mid,
          mode: mode,
          comparisonYear: Number(baseInputs.comparisonYear) || 10,
          difference: atMid.difference,
        };
      }
      if (atLo.difference * atMid.difference <= 0) {
        hi = mid;
        atHi = atMid;
      } else {
        lo = mid;
        atLo = atMid;
      }
    }
    return {
      rate: mid,
      mode: mode,
      comparisonYear: Number(baseInputs.comparisonYear) || 10,
      difference: atMid.difference,
    };
  }

  /**
   * Investment return does not affect ownership/rental cash requirements or home equity.
   * One baseline simulate establishes the contribution schedule; f(r) is then evaluated by
   * replaying the same monthly geometric investment math at each candidate return.
   * Every accepted root is verified with a full simulate round-trip.
   */
  function buildInvestmentReturnSensitivityPath(baseInputs) {
    var baseline = simulate(baseInputs);
    if (baseline.error) {
      return { error: baseline.error, errorCode: baseline.errorCode };
    }
    var month = Math.round((Number(baseInputs.comparisonYear) || 10) * 12);
    month = clamp(month, 0, HORIZON_MONTHS);
    var series = baseline.series;
    var buyerContribByMonth = new Array(month + 1);
    var renterContribByMonth = new Array(month + 1);
    buyerContribByMonth[0] = 0;
    renterContribByMonth[0] = 0;
    var m;
    for (m = 1; m <= month; m += 1) {
      buyerContribByMonth[m] =
        series[m].buyerContribCumulative - series[m - 1].buyerContribCumulative;
      renterContribByMonth[m] =
        series[m].renterContribCumulative - series[m - 1].renterContribCumulative;
    }
    return {
      buyerStart: baseline.buyerStartInvested,
      renterStart: baseline.renterStartInvested,
      buyerContribByMonth: buyerContribByMonth,
      renterContribByMonth: renterContribByMonth,
      netEquityAtMonth: series[month].netRealizableEquity,
      comparisonMonth: month,
      comparisonYear: baseline.comparisonYear,
    };
  }

  function evaluateInvestmentReturnOnPath(path, annualReturn) {
    var IGE = requireInvestmentEngine();
    if (!Number.isFinite(annualReturn) || annualReturn <= -1) {
      return { error: "Investment return must be greater than -100%.", errorCode: "invalid_investment_return" };
    }
    var mu = IGE.monthlyGeometricReturn(annualReturn);
    var buyer = path.buyerStart;
    var renter = path.renterStart;
    var m;
    for (m = 1; m <= path.comparisonMonth; m += 1) {
      buyer = IGE.applyEndOfMonthGrowthAndContribution(
        buyer,
        mu,
        path.buyerContribByMonth[m]
      );
      renter = IGE.applyEndOfMonthGrowthAndContribution(
        renter,
        mu,
        path.renterContribByMonth[m]
      );
    }
    var buyerNW = path.netEquityAtMonth + buyer;
    var renterNW = renter;
    return {
      difference: buyerNW - renterNW,
      buyerNetWorth: buyerNW,
      renterNetWorth: renterNW,
      buyerInvestments: buyer,
      renterInvestments: renter,
    };
  }

  function refineInvestmentReturnBracket(path, baseInputs, rLo, fLo, rHi, fHi) {
    var lo = rLo;
    var hi = rHi;
    var atLo = { difference: fLo };
    var atHi = { difference: fHi };
    var mid = lo;
    var atMid = atLo;
    var iter;
    if (Math.abs(fLo) <= SOLVER_TOLERANCE_DOLLARS) {
      return verifyInvestmentReturnRoot(baseInputs, rLo);
    }
    if (Math.abs(fHi) <= SOLVER_TOLERANCE_DOLLARS) {
      return verifyInvestmentReturnRoot(baseInputs, rHi);
    }
    for (iter = 0; iter < 64; iter += 1) {
      mid = (lo + hi) / 2;
      atMid = evaluateInvestmentReturnOnPath(path, mid);
      if (atMid.error) return atMid;
      if (Math.abs(atMid.difference) <= SOLVER_TOLERANCE_DOLLARS) {
        return verifyInvestmentReturnRoot(baseInputs, mid);
      }
      if (atLo.difference * atMid.difference <= 0) {
        hi = mid;
        atHi = atMid;
      } else {
        lo = mid;
        atLo = atMid;
      }
    }
    return verifyInvestmentReturnRoot(baseInputs, mid);
  }

  function verifyInvestmentReturnRoot(baseInputs, rate) {
    var full = differenceAtComparison(baseInputs, { investmentReturnAnnual: rate });
    if (full.error) return full;
    if (Math.abs(full.difference) > SOLVER_TOLERANCE_DOLLARS) {
      return null;
    }
    return {
      rate: rate,
      difference: full.difference,
      buyerNetWorth: full.buyerNetWorth,
      renterNetWorth: full.renterNetWorth,
    };
  }

  function minimizeAbsDifferenceInInterval(path, baseInputs, rLo, rHi) {
    // Nested ternary / golden-ish search on |f| over [rLo, rHi].
    var a = rLo;
    var b = rHi;
    var iter;
    var bestRate = (a + b) / 2;
    var best = evaluateInvestmentReturnOnPath(path, bestRate);
    if (best.error) return best;
    for (iter = 0; iter < 48; iter += 1) {
      var m1 = a + (b - a) / 3;
      var m2 = a + (2 * (b - a)) / 3;
      var f1 = evaluateInvestmentReturnOnPath(path, m1);
      var f2 = evaluateInvestmentReturnOnPath(path, m2);
      if (f1.error) return f1;
      if (f2.error) return f2;
      if (Math.abs(f1.difference) <= SOLVER_TOLERANCE_DOLLARS) {
        return verifyInvestmentReturnRoot(baseInputs, m1);
      }
      if (Math.abs(f2.difference) <= SOLVER_TOLERANCE_DOLLARS) {
        return verifyInvestmentReturnRoot(baseInputs, m2);
      }
      if (Math.abs(f1.difference) < Math.abs(f2.difference)) {
        b = m2;
        if (Math.abs(f1.difference) < Math.abs(best.difference)) {
          best = f1;
          bestRate = m1;
        }
      } else {
        a = m1;
        if (Math.abs(f2.difference) < Math.abs(best.difference)) {
          best = f2;
          bestRate = m2;
        }
      }
    }
    if (Math.abs(best.difference) <= SOLVER_TOLERANCE_DOLLARS) {
      return verifyInvestmentReturnRoot(baseInputs, bestRate);
    }
    return null;
  }

  function dedupeInvestmentReturnRoots(roots) {
    if (!roots.length) return roots;
    roots.sort(function (a, b) {
      return a.rate - b.rate;
    });
    var out = [roots[0]];
    var i;
    for (i = 1; i < roots.length; i += 1) {
      var prev = out[out.length - 1];
      if (Math.abs(roots[i].rate - prev.rate) > INV_BE_ROOT_DEDUP) {
        out.push(roots[i]);
      }
    }
    return out;
  }

  function solveBreakEvenInvestmentReturn(baseInputs) {
    var comparisonYear = Number(baseInputs.comparisonYear);
    if (!Number.isFinite(comparisonYear) || comparisonYear < 0) comparisonYear = 10;
    comparisonYear = clamp(comparisonYear, 0, 60);

    var empty = {
      reachable: false,
      unreachable: true,
      roots: [],
      searchMin: INV_BE_SEARCH_MIN,
      searchMax: INV_BE_SEARCH_MAX,
      comparisonYear: comparisonYear,
      message:
        "No break-even investment return occurs between −50% and +40% at year " +
        comparisonYear +
        " under these assumptions.",
      coarseEvaluations: 0,
    };

    var path = buildInvestmentReturnSensitivityPath(baseInputs);
    if (path.error) {
      return { error: path.error, errorCode: path.errorCode, comparisonYear: comparisonYear };
    }

    var rates = [];
    var diffs = [];
    var r;
    var evalCount = 0;
    for (r = INV_BE_SEARCH_MIN; r <= INV_BE_SEARCH_MAX + 1e-12; r += INV_BE_COARSE_STEP) {
      var rate = Math.round(r * 1e9) / 1e9; // tame float drift
      if (rate > INV_BE_SEARCH_MAX) rate = INV_BE_SEARCH_MAX;
      var ev = evaluateInvestmentReturnOnPath(path, rate);
      evalCount += 1;
      if (ev.error) {
        return { error: ev.error, errorCode: ev.errorCode, comparisonYear: comparisonYear };
      }
      rates.push(rate);
      diffs.push(ev.difference);
      if (rate >= INV_BE_SEARCH_MAX) break;
    }

    var roots = [];
    var gridHits = {};
    var i;

    function pushRoot(root) {
      if (!root || root.error || !Number.isFinite(root.rate)) return;
      roots.push(root);
    }

    // Exact/near-tolerance hits on the coarse grid (avoid double-counting adjacent brackets).
    for (i = 0; i < diffs.length; i += 1) {
      if (Math.abs(diffs[i]) <= SOLVER_TOLERANCE_DOLLARS) {
        var key = String(Math.round(rates[i] / INV_BE_ROOT_DEDUP));
        if (!gridHits[key]) {
          gridHits[key] = true;
          pushRoot(verifyInvestmentReturnRoot(baseInputs, rates[i]));
        }
      }
    }

    // Sign-change brackets between consecutive coarse samples.
    for (i = 0; i < diffs.length - 1; i += 1) {
      var f0 = diffs[i];
      var f1 = diffs[i + 1];
      if (Math.abs(f0) <= SOLVER_TOLERANCE_DOLLARS || Math.abs(f1) <= SOLVER_TOLERANCE_DOLLARS) {
        continue; // already handled as grid hits
      }
      if (f0 * f1 < 0) {
        pushRoot(
          refineInvestmentReturnBracket(path, baseInputs, rates[i], f0, rates[i + 1], f1)
        );
      }
    }

    // Local-extremum / near-tangent safeguard on |f|.
    for (i = 1; i < diffs.length - 1; i += 1) {
      var dPrev = diffs[i] - diffs[i - 1];
      var dNext = diffs[i + 1] - diffs[i];
      var isExtremum = dPrev * dNext < 0 || (Math.abs(dPrev) < 1e-9 && Math.abs(dNext) > 1e-9);
      if (!isExtremum) continue;
      if (Math.abs(diffs[i]) > INV_BE_TANGENT_CANDIDATE_DOLLARS) continue;
      if (Math.abs(diffs[i]) <= SOLVER_TOLERANCE_DOLLARS) continue; // already a grid hit
      // Same-sign neighbours: possible touch without sign change across the coarse step.
      if (diffs[i - 1] * diffs[i + 1] > 0 || Math.abs(diffs[i]) < Math.abs(diffs[i - 1])) {
        pushRoot(
          minimizeAbsDifferenceInInterval(path, baseInputs, rates[i - 1], rates[i + 1])
        );
      }
    }

    roots = dedupeInvestmentReturnRoots(roots.filter(Boolean));

    if (!roots.length) {
      empty.coarseEvaluations = evalCount;
      empty.differenceAtLow = diffs[0];
      empty.differenceAtHigh = diffs[diffs.length - 1];
      return empty;
    }

    var primary = roots[0];
    return {
      reachable: true,
      unreachable: false,
      roots: roots,
      rate: primary.rate,
      difference: primary.difference,
      buyerNetWorth: primary.buyerNetWorth,
      renterNetWorth: primary.renterNetWorth,
      searchMin: INV_BE_SEARCH_MIN,
      searchMax: INV_BE_SEARCH_MAX,
      comparisonYear: comparisonYear,
      coarseEvaluations: evalCount,
      message:
        roots.length > 1
          ? "More than one break-even return exists because the two strategies invest different amounts at different times."
          : null,
    };
  }

  function calculate(inputs, options) {
    var opts = options || {};
    var result = simulate(inputs);
    if (result.error) return result;
    result.headline = formatHeadline(result);
    result.breakEvenHomeAppreciation = solveBreakEvenHomeAppreciation(inputs);
    if (opts.skipInvestmentBreakEven) {
      result.breakEvenInvestmentReturn = {
        pending: true,
        reachable: false,
        unreachable: false,
        roots: [],
        searchMin: INV_BE_SEARCH_MIN,
        searchMax: INV_BE_SEARCH_MAX,
        comparisonYear: result.comparisonYear,
        message: "Calculating break-even investment return…",
      };
    } else {
      result.breakEvenInvestmentReturn = solveBreakEvenInvestmentReturn(inputs);
    }
    result.toRealPoint = function (point) {
      return toRealPoint(point, result.inflationAnnual);
    };
    return result;
  }

  function maintenanceHelperOnePercent(purchasePrice) {
    return Math.max(0, Number(purchasePrice) || 0) * 0.01;
  }

  g.RentVsBuyEngine = {
    HORIZON_MONTHS: HORIZON_MONTHS,
    SOLVER_TOLERANCE_DOLLARS: SOLVER_TOLERANCE_DOLLARS,
    INV_BE_SEARCH_MIN: INV_BE_SEARCH_MIN,
    INV_BE_SEARCH_MAX: INV_BE_SEARCH_MAX,
    INV_BE_COARSE_STEP: INV_BE_COARSE_STEP,
    simulate: simulate,
    calculate: calculate,
    formatHeadline: formatHeadline,
    detectCrossovers: detectCrossovers,
    summarizeCrossovers: summarizeCrossovers,
    nominalHomeAppreciationRate: nominalHomeAppreciationRate,
    sellingCostsAt: sellingCostsAt,
    resolveMortgageInsurance: resolveMortgageInsurance,
    buildStartingCapitalSplit: buildStartingCapitalSplit,
    solveBreakEvenHomeAppreciation: solveBreakEvenHomeAppreciation,
    solveBreakEvenInvestmentReturn: solveBreakEvenInvestmentReturn,
    maintenanceHelperOnePercent: maintenanceHelperOnePercent,
    toRealPoint: toRealPoint,
    annualToMonthlyGrowth: annualToMonthlyGrowth,
    monthlyFromAnnual: monthlyFromAnnual,
    escalateAnnualAmount: escalateAnnualAmount,
    ownerCashRequiredMonth: ownerCashRequiredMonth,
    renterCashRequiredMonth: renterCashRequiredMonth,
    customRecurringInsuranceForMonth: customRecurringInsuranceForMonth,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
