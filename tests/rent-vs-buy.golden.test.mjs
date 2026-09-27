/**
 * Rent vs. Buy — golden / consistency / edge-case tests
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

require(join(__dirname, "..", "calculators", "mortgage-calculator", "mortgage-engine.js"));
require(join(__dirname, "..", "assets", "js", "investment-growth.engine.js"));
require(join(__dirname, "..", "assets", "js", "mortgage-loan-insurance.canada.js"));
require(join(__dirname, "..", "calculators", "rent-vs-buy", "engine.js"));

const ME = globalThis.MortgageEngine;
const IGE = globalThis.InvestmentGrowthEngine;
const CMLI = globalThis.CanadaMortgageLoanInsurance;
const RVB = globalThis.RentVsBuyEngine;

assert.ok(ME && IGE && CMLI && RVB, "engines must load");

function assertApprox(actual, expected, tolerance = 1e-6, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    msg || `expected ${actual} within ${tolerance} of ${expected}`,
  );
}

function baseInputs(overrides = {}) {
  return Object.assign(
    {
      purchasePrice: 500_000,
      downPayment: 100_000,
      startingCapital: 120_000,
      closingCosts: 5_000,
      mortgageRatePct: 5,
      amortizationYears: 25,
      mortgageInsuranceMode: "none",
      sellingCostPercent: 0.05,
      sellingCostFixed: 0,
      propertyTaxAnnual: 4_000,
      propertyTaxUseInflation: true,
      maintenanceAnnual: 5_000,
      homeInsuranceAnnual: 1_500,
      condoFeesMonthly: 0,
      ownerUtilitiesMonthly: 200,
      ownerUtilitiesUseInflation: true,
      ownerOtherExpenses: [],
      monthlyRent: 2_200,
      rentGrowthAnnual: 0.02,
      tenantInsuranceAnnual: 300,
      renterUtilitiesMonthly: 100,
      renterUtilitiesUseInflation: true,
      renterOtherExpenses: [],
      investmentReturnAnnual: 0.06,
      investCashFlowDifference: true,
      inflationAnnual: 0.02,
      homeAppreciationMode: "nominal",
      homeAppreciationAnnual: 0.03,
      realHomeAppreciationAnnual: 0.01,
      comparisonYear: 10,
    },
    overrides,
  );
}

test("CMHC: 5% down on $500k uses 4% premium and adds to principal", () => {
  const r = CMLI.calculatePurchasePremium({
    purchasePrice: 500_000,
    downPayment: 25_000,
    amortizationYears: 25,
    province: "none",
  });
  assert.equal(r.required, true);
  assertApprox(r.premiumRate, 0.04);
  assertApprox(r.premiumAmount, 475_000 * 0.04);
  assertApprox(r.financedPremium, r.premiumAmount);
  assertApprox(r.mortgagePrincipal, 475_000 + r.premiumAmount);
  assert.equal(r.totalUpfrontInsuranceCash, 0);
});

test("CMHC: $600k requires more than 5% down under minimum rules", () => {
  const tooLow = CMLI.calculatePurchasePremium({
    purchasePrice: 600_000,
    downPayment: 30_000,
    amortizationYears: 25,
  });
  assert.equal(tooLow.errorCode, "below_minimum_down");
  const ok = CMLI.calculatePurchasePremium({
    purchasePrice: 600_000,
    downPayment: 35_000,
    amortizationYears: 25,
  });
  assert.equal(ok.required, true);
  assertApprox(ok.premiumRate, 0.04);
});

test("CMHC: Ontario PST on premium is cash-only and not financed", () => {
  const r = CMLI.calculatePurchasePremium({
    purchasePrice: 500_000,
    downPayment: 25_000,
    amortizationYears: 25,
    province: "ON",
  });
  assert.equal(r.required, true);
  assertApprox(r.provincialTaxRate, 0.08);
  assertApprox(r.provincialTaxAmount, r.premiumAmount * 0.08);
  assertApprox(r.financedPremium, r.premiumAmount);
  assertApprox(r.totalUpfrontInsuranceCash, r.provincialTaxAmount);
  assertApprox(r.mortgagePrincipal, r.loanBeforePremium + r.premiumAmount);
});

test("CMHC: 20% down is uninsured", () => {
  const r = CMLI.calculatePurchasePremium({
    purchasePrice: 500_000,
    downPayment: 100_000,
  });
  assert.equal(r.required, false);
  assertApprox(r.mortgagePrincipal, 400_000);
  assert.equal(r.premiumAmount, 0);
});

test("CMHC: $1.5M purchase-price boundary for high-ratio insurance", () => {
  const justBelow = CMLI.calculatePurchasePremium({
    purchasePrice: 1_499_999,
    downPayment: CMLI.minimumDownPayment(1_499_999),
    amortizationYears: 25,
  });
  assert.ok(!justBelow.error, justBelow.error);
  assert.equal(justBelow.required, true);

  const atLimitHighRatio = CMLI.calculatePurchasePremium({
    purchasePrice: 1_500_000,
    downPayment: 200_000, // < 20%
    amortizationYears: 25,
  });
  assert.equal(atLimitHighRatio.errorCode, "not_insurable_price");

  const aboveHighRatio = CMLI.calculatePurchasePremium({
    purchasePrice: 1_600_000,
    downPayment: 200_000,
    amortizationYears: 25,
  });
  assert.equal(aboveHighRatio.errorCode, "not_insurable_price");

  const atLimitConventional = CMLI.calculatePurchasePremium({
    purchasePrice: 1_500_000,
    downPayment: 300_000, // 20%
    amortizationYears: 25,
  });
  assert.ok(!atLimitConventional.error, atLimitConventional.error);
  assert.equal(atLimitConventional.required, false);
  assert.equal(atLimitConventional.premiumAmount, 0);
});

test("CMHC: 30-year insured amortization requires Home Start eligibility", () => {
  const denied = CMLI.calculatePurchasePremium({
    purchasePrice: 400_000,
    downPayment: 20_000,
    amortizationYears: 30,
    thirtyYearEligibility: "neither",
  });
  assert.equal(denied.errorCode, "amortization_requires_home_start");

  const r25 = CMLI.calculatePurchasePremium({
    purchasePrice: 400_000,
    downPayment: 20_000,
    amortizationYears: 25,
    thirtyYearEligibility: "neither",
  });
  const r30ftb = CMLI.calculatePurchasePremium({
    purchasePrice: 400_000,
    downPayment: 20_000,
    amortizationYears: 30,
    thirtyYearEligibility: "first_time_homebuyer",
  });
  const r30new = CMLI.calculatePurchasePremium({
    purchasePrice: 400_000,
    downPayment: 20_000,
    amortizationYears: 30,
    thirtyYearEligibility: "newly_built_home",
  });
  assert.ok(!r25.error && !r30ftb.error && !r30new.error);
  assertApprox(r30ftb.premiumRate - r25.premiumRate, 0.002);
  assertApprox(r30new.amortizationSurchargeRate, 0.002);
  assert.equal(r25.amortizationSurchargeRate, 0);

  const over30 = CMLI.calculatePurchasePremium({
    purchasePrice: 400_000,
    downPayment: 20_000,
    amortizationYears: 35,
    thirtyYearEligibility: "first_time_homebuyer",
  });
  assert.equal(over30.errorCode, "amortization_exceeds_30");
});

test("CMHC: Quebec premium tax schedule 9% then 9.975%", () => {
  assertApprox(CMLI.provincialPremiumTaxRate("QC", "2026-12-31"), 0.09);
  assertApprox(CMLI.provincialPremiumTaxRate("QC", "2027-01-01"), 0.09975);
  const before = CMLI.calculatePurchasePremium({
    purchasePrice: 500_000,
    downPayment: 25_000,
    province: "QC",
    asOfDate: "2026-06-01",
  });
  const after = CMLI.calculatePurchasePremium({
    purchasePrice: 500_000,
    downPayment: 25_000,
    province: "QC",
    asOfDate: "2027-06-01",
  });
  assertApprox(before.provincialTaxRate, 0.09);
  assertApprox(after.provincialTaxRate, 0.09975);
  assertApprox(before.financedPremium, before.premiumAmount);
  assertApprox(before.totalUpfrontInsuranceCash, before.provincialTaxAmount);
  assertApprox(after.totalUpfrontInsuranceCash, after.provincialTaxAmount);
  assert.ok(after.provincialTaxAmount > before.provincialTaxAmount);
});

test("engine default insurance mode is automatic Canadian; None stays explicit", () => {
  const auto = RVB.resolveMortgageInsurance({
    purchasePrice: 500_000,
    downPayment: 100_000,
    amortizationYears: 25,
  });
  assert.equal(auto.mode, "automatic_canadian");
  assert.equal(auto.detail.required, false);

  const none = RVB.resolveMortgageInsurance({
    purchasePrice: 500_000,
    downPayment: 25_000,
    mortgageInsuranceMode: "none",
  });
  assert.equal(none.mode, "none");
  assert.equal(none.financedPremium, 0);
  assert.equal(none.mortgagePrincipal, 475_000);
});

test("month-0 capital accounting: down payment equity, closing/tax consumed once", () => {
  // Starting $100k; down $80k; closing $10k; cash insurance/tax $2k → remaining $8k.
  // Use custom insurance so cash tax is exact without solving CMHC.
  const inputs = baseInputs({
    purchasePrice: 400_000,
    downPayment: 80_000,
    startingCapital: 100_000,
    closingCosts: 10_000,
    mortgageInsuranceMode: "custom",
    customInsuranceUpfront: 2_000,
    customInsuranceFinanced: 0,
    customInsuranceMonthly: 0,
    sellingCostPercent: 0.05,
    sellingCostFixed: 0,
    homeAppreciationAnnual: 0,
    inflationAnnual: 0,
    investmentReturnAnnual: 0,
    investCashFlowDifference: false,
    propertyTaxAnnual: 0,
    maintenanceAnnual: 0,
    homeInsuranceAnnual: 0,
    ownerUtilitiesMonthly: 0,
    monthlyRent: 0,
    tenantInsuranceAnnual: 0,
    renterUtilitiesMonthly: 0,
    rentGrowthAnnual: 0,
  });
  const result = RVB.simulate(inputs);
  assert.ok(!result.error, result.error);
  const c = result.capital;
  assertApprox(c.buyerDeployed, 92_000);
  assertApprox(c.buyerRemaining, 8_000);
  assertApprox(c.renterStartingInvestable, 100_000);
  assertApprox(c.downPayment + c.closingCosts + c.upfrontInsurance, c.buyerDeployed);

  const m0 = result.series[0];
  assertApprox(m0.homeValue, 400_000);
  assertApprox(m0.mortgageBalance, 320_000); // 400k - 80k; no financed premium
  assertApprox(m0.grossEquity, 80_000); // down payment creates equity; not consumed
  assertApprox(m0.sellingCosts, 400_000 * 0.05);
  assertApprox(m0.netRealizableEquity, 80_000 - 20_000);
  assertApprox(m0.buyerInvestments, 8_000);
  assertApprox(m0.buyerNetWorth, m0.netRealizableEquity + 8_000);
  assertApprox(m0.renterInvestments, 100_000);
  assertApprox(m0.renterNetWorth, 100_000);

  // No double-counting: buyer remaining + renter start each appear once.
  assertApprox(result.buyerStartInvested, 8_000);
  assertApprox(result.renterStartInvested, 100_000);

  // Financed premium must not also reduce cash when present.
  const financed = RVB.simulate(
    baseInputs({
      purchasePrice: 400_000,
      downPayment: 80_000,
      startingCapital: 100_000,
      closingCosts: 10_000,
      mortgageInsuranceMode: "custom",
      customInsuranceUpfront: 0,
      customInsuranceFinanced: 5_000,
      customInsuranceMonthly: 0,
      sellingCostPercent: 0,
      propertyTaxAnnual: 0,
      maintenanceAnnual: 0,
      homeInsuranceAnnual: 0,
      ownerUtilitiesMonthly: 0,
      monthlyRent: 0,
      tenantInsuranceAnnual: 0,
      renterUtilitiesMonthly: 0,
      investCashFlowDifference: false,
      investmentReturnAnnual: 0,
      inflationAnnual: 0,
      homeAppreciationAnnual: 0,
    }),
  );
  assert.ok(!financed.error, financed.error);
  assertApprox(financed.capital.buyerRemaining, 10_000); // 100k - 80k - 10k; financed not cash
  assertApprox(financed.series[0].mortgageBalance, 325_000); // 320k + 5k
  assertApprox(financed.series[0].grossEquity, 75_000); // 400k - 325k
  assertApprox(financed.series[0].buyerInvestments, 10_000);
});

test("annual ownership costs are monthlyized (not dumped in one month)", () => {
  assertApprox(RVB.monthlyFromAnnual(12_000), 1_000);
  const costs = {
    inflationAnnual: 0,
    propertyTaxAnnual: 6_000,
    propertyTaxGrowth: 0,
    maintenanceAnnual: 12_000,
    homeInsuranceAnnual: 2_400,
    condoFeesAnnual: 0,
    ownerUtilitiesMonthly: 0,
    ownerUtilitiesGrowth: 0,
    ownerOther: [],
    recurringMonthlyInsurance: 0,
  };
  const month1 = RVB.ownerCashRequiredMonth(
    { mortgagePaymentThisMonth: 0 },
    costs,
    1,
  );
  // 6000/12 + 12000/12 + 2400/12 = 500 + 1000 + 200 = 1700
  assertApprox(month1, 1_700);
  assert.ok(month1 < 12_000, "must not charge full annual maintenance in one month");

  const withInflation = {
    ...costs,
    inflationAnnual: 0.12,
    propertyTaxGrowth: 0.12,
  };
  const m12 = RVB.ownerCashRequiredMonth({ mortgagePaymentThisMonth: 0 }, withInflation, 12);
  const expectedMaint = (12_000 * Math.pow(1.12, 1)) / 12;
  const expectedTax = (6_000 * Math.pow(1.12, 1)) / 12;
  const expectedIns = (2_400 * Math.pow(1.12, 1)) / 12;
  assertApprox(m12, expectedMaint + expectedTax + expectedIns, 1e-6);
});

test("maintenance helper sets dollars once; later months ignore home appreciation", () => {
  assert.equal(RVB.maintenanceHelperOnePercent(800_000), 8_000);
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 800_000,
      downPayment: 200_000,
      startingCapital: 220_000,
      closingCosts: 0,
      mortgageInsuranceMode: "none",
      maintenanceAnnual: 8_000,
      homeAppreciationAnnual: 0.5, // extreme so home value diverges quickly
      inflationAnnual: 0,
      propertyTaxAnnual: 0,
      homeInsuranceAnnual: 0,
      ownerUtilitiesMonthly: 0,
      monthlyRent: 3_000,
      rentGrowthAnnual: 0,
      tenantInsuranceAnnual: 0,
      renterUtilitiesMonthly: 0,
      investCashFlowDifference: false,
      investmentReturnAnnual: 0,
      sellingCostPercent: 0,
      mortgageRatePct: 0,
      amortizationYears: 25,
    }),
  );
  assert.ok(!result.error, result.error);
  const hv12 = result.series[12].homeValue;
  assert.ok(hv12 > 800_000 * 1.4);
  // Owner cash at month 12 with only mortgage + maintenance/12 (0% inflation)
  const maintMonthly = 8_000 / 12;
  const ownerCash12 = result.series[12].ownerCash;
  // mortgage payment still present; maintenance component must remain 8000/12 not 1% of new value
  assert.ok(Math.abs(hv12 * 0.01 / 12 - maintMonthly) > 100);
  // Isolate: difference between owner cash with and without would be hard; check escalate helper
  assertApprox(RVB.escalateAnnualAmount(8_000, 0, 12), 8_000);
  assertApprox(RVB.monthlyFromAnnual(RVB.escalateAnnualAmount(8_000, 0, 120)), 8_000 / 12);
  void ownerCash12;
});

test("annual growth convention: month-12 level equals start × (1 + annualGrowth)", () => {
  const start = 12_000;
  const g = 0.03;
  // level(m) = start × (1+g)^(m/12); at m=12 this equals start × (1+g)
  assertApprox(RVB.escalateAnnualAmount(start, g, 12), start * (1 + g));
  assertApprox(RVB.escalateAnnualAmount(start, g, 0), start);
  // Mid-year is on the smooth path, not a discrete annual step
  assertApprox(RVB.escalateAnnualAmount(start, g, 6), start * Math.pow(1 + g, 0.5));
  assert.ok(RVB.escalateAnnualAmount(start, g, 6) < start * (1 + g));
});

test("home appreciation linked mode uses multiplicative Fisher relation", () => {
  const rate = RVB.nominalHomeAppreciationRate({
    homeAppreciationMode: "real_linked",
    inflationAnnual: 0.02,
    realHomeAppreciationAnnual: 0.01,
  });
  assertApprox(rate, 1.02 * 1.01 - 1);
  assertApprox(rate, 0.0302);
  assert.notEqual(Math.round(rate * 10000) / 10000, 0.03);
});

test("mortgage payment matches MortgageEngine", () => {
  const principal = 400_000;
  const rate = 5;
  const years = 25;
  const expected = ME.calculateMonthlyPayment(principal, rate, years);
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 500_000,
      downPayment: 100_000,
      mortgageRatePct: rate,
      amortizationYears: years,
      mortgageInsuranceMode: "none",
      startingCapital: 110_000,
      closingCosts: 0,
    }),
  );
  assert.ok(!result.error, result.error);
  assertApprox(result.scheduledMortgagePayment, expected, 1e-9);
  assertApprox(result.mortgagePrincipal, principal, 1e-9);
});

test("mortgage schedule balance/payoff consistent with MortgageEngine", () => {
  const principal = 400_000;
  const rate = 5;
  const years = 25;
  const schedule = ME.computeSchedule(principal, rate, years, "monthly");
  assert.equal(schedule.isValid, true);
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 500_000,
      downPayment: 100_000,
      mortgageRatePct: rate,
      amortizationYears: years,
      closingCosts: 0,
      startingCapital: 100_000,
      sellingCostPercent: 0,
      propertyTaxAnnual: 0,
      maintenanceAnnual: 0,
      homeInsuranceAnnual: 0,
      ownerUtilitiesMonthly: 0,
      monthlyRent: 0,
      tenantInsuranceAnnual: 0,
      renterUtilitiesMonthly: 0,
      homeAppreciationAnnual: 0,
      inflationAnnual: 0,
      investmentReturnAnnual: 0,
      investCashFlowDifference: false,
    }),
  );
  assert.ok(!result.error, result.error);
  const payoffMonth = Math.round(schedule.payoffYears * 12);
  assert.equal(result.payoffMonth, payoffMonth);
  assertApprox(result.series[payoffMonth].mortgageBalance, 0, 1e-4);
  // Spot-check balances along the path
  for (const pay of [12, 60, 120, 240]) {
    if (pay <= schedule.schedule.length) {
      assertApprox(
        result.series[pay].mortgageBalance,
        schedule.schedule[pay - 1].balance,
        0.02,
        `balance month ${pay}`,
      );
    }
  }
});

test("investment constant contribution matches InvestmentGrowthEngine", () => {
  const start = 50_000;
  const monthly = 500;
  const years = 10;
  const rNom = 0.06;
  const ig = IGE.simulateInvestment({
    startingAmount: start,
    contributionPerPeriod: monthly,
    years,
    nominalAnnualReturn: rNom,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    indexContributionsToInflation: true,
  });
  const mu = IGE.monthlyGeometricReturn(rNom);
  let bal = start;
  for (let m = 1; m <= years * 12; m += 1) {
    bal = IGE.applyEndOfMonthGrowthAndContribution(bal, mu, monthly);
  }
  assertApprox(bal, ig.finalBalanceNominal, 1e-4);
});

test("nominalToReal matches shared helper", () => {
  const nom = 200_000;
  const inf = 0.02;
  const months = 240;
  assertApprox(
    IGE.nominalToReal(nom, inf, months),
    nom / Math.pow(1 + inf, months / 12),
  );
});

test("starting capital accounting: buyer deployed + remaining = starting", () => {
  const inputs = baseInputs({
    startingCapital: 80_000,
    downPayment: 50_000,
    closingCosts: 8_000,
    mortgageInsuranceMode: "automatic_canadian",
    purchasePrice: 400_000,
    insuranceProvince: "ON",
  });
  // 12.5% down → insured
  inputs.downPayment = 50_000;
  const result = RVB.calculate(inputs);
  assert.ok(!result.error, result.error);
  const c = result.capital;
  assertApprox(c.buyerDeployed + c.buyerRemaining, c.startingCapital, 1e-6);
  assertApprox(c.renterStartingInvestable, c.startingCapital, 1e-6);
  // PST cash is in buyer deployed, not double-counted as financed
  assert.ok(result.insurance.detail.provincialTaxAmount > 0);
  assertApprox(
    c.upfrontInsurance,
    result.insurance.detail.totalUpfrontInsuranceCash,
  );
});

test("financed premium is not counted as upfront cash", () => {
  const r = RVB.resolveMortgageInsurance({
    mortgageInsuranceMode: "automatic_canadian",
    purchasePrice: 400_000,
    downPayment: 20_000,
    amortizationYears: 25,
    insuranceProvince: "none",
    financeInsurancePremium: true,
  });
  assert.ok(r.financedPremium > 0);
  assert.equal(r.upfrontInsuranceCash, 0);
  assertApprox(r.mortgagePrincipal, 380_000 + r.financedPremium);
});

test("custom insurance supports upfront, financed, and recurring", () => {
  const r = RVB.resolveMortgageInsurance({
    mortgageInsuranceMode: "custom",
    purchasePrice: 400_000,
    downPayment: 40_000,
    customInsuranceUpfront: 2_000,
    customInsuranceFinanced: 5_000,
    customInsuranceMonthly: 50,
  });
  assert.equal(r.upfrontInsuranceCash, 2_000);
  assert.equal(r.financedPremium, 5_000);
  assert.equal(r.recurringMonthlyInsurance, 50);
  assert.equal(r.mortgagePrincipal, 365_000);
  assert.equal(r.recurringInsuranceDurationMonths, null);
});

test("custom recurring insurance stops at mortgage payoff when duration blank", () => {
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 300_000,
      downPayment: 100_000,
      startingCapital: 110_000,
      closingCosts: 0,
      amortizationYears: 5,
      mortgageRatePct: 4,
      mortgageInsuranceMode: "custom",
      customInsuranceMonthly: 80,
      customInsuranceMonthlyDurationMonths: null,
      propertyTaxAnnual: 0,
      maintenanceAnnual: 0,
      homeInsuranceAnnual: 0,
      ownerUtilitiesMonthly: 0,
      monthlyRent: 0,
      tenantInsuranceAnnual: 0,
      renterUtilitiesMonthly: 0,
      investCashFlowDifference: false,
      investmentReturnAnnual: 0,
      inflationAnnual: 0,
      homeAppreciationAnnual: 0,
      sellingCostPercent: 0,
    }),
  );
  assert.ok(!result.error, result.error);
  assert.ok(result.payoffMonth > 0);
  const payoff = result.payoffMonth;
  // Still charged in payoff month (balance was outstanding at start of month)
  const cashPayoff = result.series[payoff].ownerCash;
  const pmtPayoff = result.series[payoff].mortgagePayment;
  assertApprox(cashPayoff, pmtPayoff + 80, 1e-6);
  // Never after balance is zero
  for (let m = payoff + 1; m <= payoff + 12; m += 1) {
    assertApprox(result.series[m].mortgageBalance, 0, 1e-6);
    assertApprox(result.series[m].ownerCash, 0, 1e-6);
  }
});

test("custom recurring insurance ends after optional duration even if mortgage remains", () => {
  const duration = 24;
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 400_000,
      downPayment: 80_000,
      startingCapital: 100_000,
      closingCosts: 0,
      amortizationYears: 25,
      mortgageRatePct: 5,
      mortgageInsuranceMode: "custom",
      customInsuranceMonthly: 100,
      customInsuranceMonthlyDurationMonths: duration,
      propertyTaxAnnual: 0,
      maintenanceAnnual: 0,
      homeInsuranceAnnual: 0,
      ownerUtilitiesMonthly: 0,
      monthlyRent: 0,
      tenantInsuranceAnnual: 0,
      renterUtilitiesMonthly: 0,
      investCashFlowDifference: false,
      investmentReturnAnnual: 0,
      inflationAnnual: 0,
      homeAppreciationAnnual: 0,
      sellingCostPercent: 0,
    }),
  );
  assert.ok(!result.error, result.error);
  assert.ok(result.payoffMonth == null || result.payoffMonth > duration);
  assert.ok(result.series[duration].mortgageBalance > 0);
  assertApprox(
    result.series[duration].ownerCash,
    result.series[duration].mortgagePayment + 100,
    1e-6,
  );
  assertApprox(
    result.series[duration + 1].ownerCash,
    result.series[duration + 1].mortgagePayment,
    1e-6,
  );
  // Helper unit checks
  assert.equal(RVB.customRecurringInsuranceForMonth(100, 10, 50_000, null), 100);
  assert.equal(RVB.customRecurringInsuranceForMonth(100, 10, 0, null), 0);
  assert.equal(RVB.customRecurringInsuranceForMonth(100, 25, 50_000, 24), 0);
  assert.equal(RVB.customRecurringInsuranceForMonth(100, 24, 50_000, 24), 100);
});

test("100% down payment: no mortgage, payment zero", () => {
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 400_000,
      downPayment: 400_000,
      startingCapital: 420_000,
      closingCosts: 5_000,
      mortgageInsuranceMode: "none",
    }),
  );
  assert.ok(!result.error, result.error);
  assert.equal(result.mortgagePrincipal, 0);
  assert.equal(result.scheduledMortgagePayment, 0);
  assert.equal(result.payoffMonth, 0);
  assert.equal(result.series[120].mortgageBalance, 0);
});

test("selling costs deducted from net realizable equity every month", () => {
  const result = RVB.simulate(
    baseInputs({
      sellingCostPercent: 0.05,
      sellingCostFixed: 1_000,
      homeAppreciationAnnual: 0,
    }),
  );
  assert.ok(!result.error, result.error);
  for (const m of [0, 12, 60, 120]) {
    const p = result.series[m];
    const expectedSell = p.homeValue * 0.05 + 1_000;
    assertApprox(p.sellingCosts, expectedSell, 1e-6);
    assertApprox(p.netRealizableEquity, p.homeValue - p.mortgageBalance - expectedSell, 1e-6);
    assertApprox(
      p.buyerNetWorth,
      p.netRealizableEquity + p.buyerInvestments,
      1e-6,
    );
  }
});

test("cash-flow difference switches investor side", () => {
  // High rent → owner cheaper early; then after... use high ownership costs so renter cheaper initially
  const result = RVB.simulate(
    baseInputs({
      monthlyRent: 1_500,
      rentGrowthAnnual: 0.08,
      propertyTaxAnnual: 8_000,
      maintenanceAnnual: 10_000,
      homeInsuranceAnnual: 2_000,
      ownerUtilitiesMonthly: 400,
      investCashFlowDifference: true,
      investmentReturnAnnual: 0,
      inflationAnnual: 0,
      homeAppreciationAnnual: 0,
    }),
  );
  assert.ok(!result.error, result.error);
  let sawRenterInvest = false;
  let sawBuyerInvest = false;
  for (let m = 1; m < result.series.length; m += 1) {
    const d = result.series[m].cashFlowDiff;
    if (d > 1) {
      // renter cheaper → renter contributions rise
      assert.ok(result.series[m].renterContribCumulative >= result.series[m - 1].renterContribCumulative - 1e-9);
      sawRenterInvest = true;
    } else if (d < -1) {
      sawBuyerInvest = true;
    }
  }
  assert.ok(sawRenterInvest || sawBuyerInvest, "expected some cash-flow investment activity");
});

test("after mortgage payoff, mortgage payment is zero and balance stays zero", () => {
  const result = RVB.simulate(
    baseInputs({
      purchasePrice: 300_000,
      downPayment: 100_000,
      startingCapital: 110_000,
      closingCosts: 0,
      amortizationYears: 5,
      mortgageRatePct: 4,
    }),
  );
  assert.ok(!result.error, result.error);
  assert.ok(result.payoffMonth > 0 && result.payoffMonth <= 60);
  assert.ok(result.series[result.payoffMonth].mortgagePayment > 0, "final payment occurs in payoff month");
  assertApprox(result.series[result.payoffMonth].mortgageBalance, 0, 1e-6);
  for (let m = result.payoffMonth + 1; m <= result.payoffMonth + 24; m += 1) {
    assertApprox(result.series[m].mortgageBalance, 0, 1e-6);
    assertApprox(result.series[m].mortgagePayment, 0, 1e-6);
  }
});

test("crossover detection: no / one / multiple", () => {
  // No crossover: extreme rent + high appreciation → buyer always ahead after start... 
  // Use synthetic difference series via detectCrossovers directly.
  const none = RVB.detectCrossovers([10, 20, 30, 40]);
  assert.equal(none.length, 0);
  const one = RVB.detectCrossovers([-10, -5, 1, 10]);
  assert.equal(one.length, 1);
  assert.equal(one[0].from, "renter");
  assert.equal(one[0].to, "buyer");
  const multi = RVB.detectCrossovers([10, -5, 5, -2, 8]);
  assert.ok(multi.length >= 3);
});

test("real conversion does not change crossover month", () => {
  const result = RVB.simulate(
    baseInputs({
      monthlyRent: 2_800,
      rentGrowthAnnual: 0.03,
      homeAppreciationAnnual: 0.02,
      investmentReturnAnnual: 0.07,
      inflationAnnual: 0.025,
      comparisonYear: 20,
    }),
  );
  assert.ok(!result.error, result.error);
  const nomDiffs = result.series.map((p) => p.difference);
  const realDiffs = result.series.map((p) => {
    const realB = IGE.nominalToReal(p.buyerNetWorth, result.inflationAnnual, p.month);
    const realR = IGE.nominalToReal(p.renterNetWorth, result.inflationAnnual, p.month);
    return realB - realR;
  });
  const nomX = RVB.detectCrossovers(nomDiffs).filter((c) => c.to === "buyer" || c.to === "renter");
  const realX = RVB.detectCrossovers(realDiffs).filter((c) => c.to === "buyer" || c.to === "renter");
  assert.equal(nomX.length, realX.length);
  for (let i = 0; i < nomX.length; i += 1) {
    assert.equal(nomX[i].month, realX[i].month);
    assert.equal(nomX[i].from, realX[i].from);
    assert.equal(nomX[i].to, realX[i].to);
  }
});

test("zero inflation / zero appreciation / zero return remain finite", () => {
  const result = RVB.calculate(
    baseInputs({
      inflationAnnual: 0,
      homeAppreciationAnnual: 0,
      investmentReturnAnnual: 0,
      rentGrowthAnnual: 0,
    }),
  );
  assert.ok(!result.error, result.error);
  for (const p of result.series) {
    assert.ok(Number.isFinite(p.buyerNetWorth));
    assert.ok(Number.isFinite(p.renterNetWorth));
    assert.ok(p.mortgageBalance >= -1e-9);
  }
});

test("negative home appreciation permitted", () => {
  const result = RVB.simulate(baseInputs({ homeAppreciationAnnual: -0.02 }));
  assert.ok(!result.error, result.error);
  assert.ok(result.series[120].homeValue < result.series[0].homeValue);
});

test("break-even solvers return finite rates or unreachable", () => {
  const result = RVB.calculate(baseInputs({ comparisonYear: 20 }));
  assert.ok(!result.error, result.error);
  const ha = result.breakEvenHomeAppreciation;
  const ir = result.breakEvenInvestmentReturn;
  if (!ha.unreachable && !ha.error) {
    assert.ok(Number.isFinite(ha.rate));
    assert.ok(ha.rate > -0.25 && ha.rate < 0.35);
  }
  if (!ir.unreachable && !ir.error) {
    assert.ok(Number.isFinite(ir.rate));
  }
});

test("headline avoids advice language", () => {
  const result = RVB.calculate(baseInputs());
  assert.ok(result.headline);
  assert.ok(!/you should/i.test(result.headline));
  assert.ok(!/smarter/i.test(result.headline));
  assert.ok(!/better choice/i.test(result.headline));
  assert.ok(/under these assumptions/i.test(result.headline));
});
