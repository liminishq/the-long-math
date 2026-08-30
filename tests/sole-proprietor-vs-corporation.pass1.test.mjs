import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTaxDataBundle,
  loadTaxData,
} from "../calculators/canada-income-tax/js/tax.data.js";
import {
  computePersonalTax,
  employerCppForT4Employment,
} from "../calculators/canada-income-tax/js/tax.engine.js";
import {
  computeCorporateTaxAmount,
  loadCorporateTaxTables,
  runComparison,
} from "../calculators/sole-proprietor-vs-corporation/spvc-engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAX_DATA_ROOT = path.join(
  ROOT,
  "calculators/canada-income-tax/data"
);

globalThis.fetch = async (url) => {
  const filePath = path.join(ROOT, String(url).replace(/^\/+/, ""));
  return {
    ok: true,
    json: async () => JSON.parse(await fs.readFile(filePath, "utf8")),
  };
};

function approx(actual, expected, tolerance = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function blendInput(overrides = {}) {
  return {
    province: "ON",
    taxYear: 2025,
    businessIncome: 200000,
    spendingNeed: 50000,
    rrspRoom: 0,
    autoRrsp: false,
    reinvestRefund: true,
    investSurplus: true,
    withdrawalMode: "blend",
    salaryBlendFraction: 0.5,
    retainEarnings: true,
    ...overrides,
  };
}

function blendWithdrawal(result) {
  return result.corporate.salaryPaid + result.corporate.grossDividendPaid;
}

function assertCorporateCashConservation(result, tolerance = 1e-6) {
  const corp = result.corporate;
  approx(
    corp.salaryPaid +
      corp.grossDividendPaid +
      corp.employerCpp +
      corp.corporateTax +
      corp.retainedForInvestment,
    corp.grossCorporateIncome,
    tolerance
  );
}

function blendNet(input, W, taxData, roundToDollar = true) {
  const salary = input.salaryBlendFraction * W;
  const dividend = (1 - input.salaryBlendFraction) * W;
  const opts = {
    taxData,
    skipMarginalRateCalculation: true,
  };
  if (!roundToDollar) opts.roundToDollar = false;
  return computePersonalTax(
    {
      year: input.taxYear,
      province: input.province,
      employmentIncome: salary,
      selfEmploymentIncome: 0,
      nonEligibleDividends: dividend,
      rrspDeduction: 0,
    },
    opts
  ).totals.takeHomeAfterPayroll;
}

async function assertBlendMinimalToPriorCent(input, result) {
  const W = blendWithdrawal(result);
  const taxData = await getTaxDataBundle(input.taxYear, {
    fsDataRoot: TAX_DATA_ROOT,
  });
  const currentNet = blendNet(input, W, taxData);
  assert.ok(
    currentNet + 0.5 >= input.spendingNeed,
    `W=${W} did not meet spending ${input.spendingNeed}`
  );
  if (W >= 0.01) {
    const previousNet = blendNet(input, W - 0.01, taxData);
    assert.ok(
      previousNet + 0.5 < input.spendingNeed,
      `previous cent at W=${W - 0.01} also met spending ${input.spendingNeed}`
    );
  }
}

async function independentCentReference(input, searchStart, searchEnd) {
  const taxData = await getTaxDataBundle(input.taxYear, {
    fsDataRoot: TAX_DATA_ROOT,
  });
  const { fed, provinces } = await loadCorporateTaxTables(input.taxYear);
  const firstCent = Math.ceil(searchStart * 100);
  const lastCent = Math.floor(searchEnd * 100);

  for (let cents = firstCent; cents <= lastCent; cents++) {
    const W = cents / 100;
    const salary = input.salaryBlendFraction * W;
    const dividend = (1 - input.salaryBlendFraction) * W;
    const employerCpp = employerCppForT4Employment(salary, { taxData });
    const corporateTax = computeCorporateTaxAmount(
      Math.max(0, input.businessIncome - salary - employerCpp),
      fed,
      provinces,
      input.province
    );
    const retained =
      input.businessIncome -
      salary -
      dividend -
      employerCpp -
      corporateTax;
    if (
      retained >= 0 &&
      blendNet(input, W, taxData) + 0.5 >= input.spendingNeed
    ) {
      return { W, retained };
    }
  }
  return null;
}

test("self-employed CPP follows Schedule 8 treatment at YMPE and YAMPE", async () => {
  await loadTaxData(2025, { fsDataRoot: TAX_DATA_ROOT });
  const calculate = (income) =>
    computePersonalTax(
      { year: 2025, province: "ON", selfEmploymentIncome: income },
      { roundToDollar: false }
    );

  approx(calculate(3500).totals.cpp, 0);
  const firstPensionableDollar = calculate(3501);
  approx(firstPensionableDollar.totals.cpp, 0.12);
  approx(firstPensionableDollar.totals.cppCreditable, 0.05);
  approx(firstPensionableDollar.totals.cppDeductible, 0.07);

  const halfCentBoundary = calculate(3700.75);
  approx(
    halfCentBoundary.breakdown.payroll.cpp.selfEmployment.firstAdditionalDeductible,
    4.02
  );
  approx(halfCentBoundary.totals.cpp, 23.89);
  approx(halfCentBoundary.totals.cppCreditable, 9.94);
  approx(halfCentBoundary.totals.cppDeductible, 13.95);

  const atYmpe = calculate(71300);
  approx(atYmpe.totals.cpp, 8068.2);
  approx(atYmpe.totals.cppCreditable, 3356.1);
  approx(atYmpe.totals.cppDeductible, 4712.1);
  approx(atYmpe.totals.taxableIncome, 71300 - 4712.1);

  const aboveYmpe = calculate(71301);
  approx(aboveYmpe.totals.cpp - atYmpe.totals.cpp, 0.08);
  approx(
    aboveYmpe.breakdown.payroll.cpp.selfEmployment.cpp2Deductible,
    0.08
  );

  const atYampe = calculate(81200);
  const aboveYampe = calculate(81201);
  approx(atYampe.totals.cpp, 8860.2);
  approx(aboveYampe.totals.cpp, atYampe.totals.cpp);
});

test("Quebec aliases do not approximate QPP with doubled federal CPP", async () => {
  await loadTaxData(2025, { fsDataRoot: TAX_DATA_ROOT });
  for (const province of ["QC", "QC ", "Quebec", "Québec"]) {
    const result = computePersonalTax(
      { year: 2025, province, selfEmploymentIncome: 100000 },
      { roundToDollar: false }
    );
    approx(result.totals.cpp, 0);
    approx(result.totals.cppDeductible, 0);
  }
});

test("RRSP tax saving is allocated once in the personal cash ledger", async () => {
  const input = {
    province: "ON",
    taxYear: 2025,
    businessIncome: 200000,
    spendingNeed: 50000,
    rrspRoom: 32490,
    rrspContribution: 32490,
    autoRrsp: false,
    reinvestRefund: true,
    investSurplus: true,
    withdrawalMode: "dividend",
    retainEarnings: true,
  };
  const withRefund = await runComparison(input);
  const withoutRefund = await runComparison({
    ...input,
    reinvestRefund: false,
  });

  const expectedSurplus = Math.max(
    0,
    withRefund.personal.takeHomeBeforeRrspTaxSaving -
      withRefund.personal.rrspContribution -
      withRefund.personal.spendingNeed
  );
  approx(withRefund.personal.nonRegisteredSurplusInvested, expectedSurplus);
  approx(
    withRefund.personal.totalInvested,
    withRefund.personal.rrspContribution +
      withRefund.personal.rrspRefund +
      expectedSurplus
  );
  approx(
    withRefund.personal.totalInvested - withoutRefund.personal.totalInvested,
    withRefund.personal.rrspRefund
  );

  approx(withRefund.comparison.personalInvested, 94292.8);
  approx(withRefund.comparison.corpInvested, 123010);
  assert.equal(withRefund.comparison.winner, "corporation");
});

test("an RRSP refund not reinvested remains available for lifestyle spending", async () => {
  const result = await runComparison({
    province: "ON",
    taxYear: 2025,
    businessIncome: 200000,
    spendingNeed: 48000,
    rrspRoom: 32490,
    rrspContribution: 32490,
    autoRrsp: false,
    reinvestRefund: false,
    investSurplus: true,
    withdrawalMode: "dividend",
    retainEarnings: true,
  });

  assert.equal(result.personal.refundReinvested, 0);
  assert.ok(result.personal.rrspRefund > 0);
  assert.equal(result.personal.lifestyleFeasible, true);
  assert.equal(result.personal.lifestyleShortfall, 0);
});

test("salary and blend deduct employer CPP and preserve corporate cash", async () => {
  for (const withdrawalMode of ["salary", "blend"]) {
    const result = await runComparison({
      province: "ON",
      taxYear: 2025,
      businessIncome: 200000,
      spendingNeed: 50000,
      rrspRoom: 0,
      autoRrsp: false,
      withdrawalMode,
      salaryBlendFraction: 0.5,
      retainEarnings: true,
    });
    const corp = result.corporate;
    const expectedEmployerCpp = employerCppForT4Employment(corp.salaryPaid);
    approx(corp.employerCpp, expectedEmployerCpp);
    assert.ok(corp.employerCpp > 0);
    approx(
      corp.salaryPaid +
        corp.grossDividendPaid +
        corp.employerCpp +
        corp.corporateTax +
        corp.retainedForInvestment,
      200000
    );
  }
});

test("Saskatchewan 2025 keeps its provincial SBD limit independent", async () => {
  const { fed, provinces } = await loadCorporateTaxTables(2025);
  const actual = computeCorporateTaxAmount(
    550000,
    fed,
    provinces,
    "SK"
  );
  const expected =
    500000 * fed.sbd.rate +
    50000 * fed.general.rate +
    550000 * provinces.SK.sbd.rate;
  approx(actual, expected);
  approx(actual, 58000);
});

test("tax solver probes skip marginal calculations without changing tax results or shape", async () => {
  const taxData = await getTaxDataBundle(2026, {
    fsDataRoot: TAX_DATA_ROOT,
  });
  const input = {
    year: 2026,
    province: "AB",
    employmentIncome: 76004.621,
    nonEligibleDividends: 684041.589,
  };
  const full = computePersonalTax(input, { taxData });
  const probe = computePersonalTax(input, {
    taxData,
    skipMarginalRateCalculation: true,
  });

  assert.deepEqual(Object.keys(probe), Object.keys(full));
  assert.deepEqual(Object.keys(probe.totals), Object.keys(full.totals));
  assert.deepEqual(Object.keys(probe.breakdown), Object.keys(full.breakdown));
  for (const [key, value] of Object.entries(full.totals)) {
    if (key !== "marginalRate") assert.deepEqual(probe.totals[key], value);
  }
  assert.equal(probe.totals.marginalRate, null);
  assert.deepEqual(probe.breakdown.marginalRates, {
    employment: null,
    eligibleDividends: null,
    nonEligibleDividends: null,
    otherIncome: null,
    capitalGains: null,
    combined: null,
  });
  assert.deepEqual(probe.breakdown.federal, full.breakdown.federal);
  assert.deepEqual(probe.breakdown.provincial, full.breakdown.provincial);
  assert.notEqual(full.totals.marginalRate, null);
});

test("blend solver searches through the exact affordable endpoint near maximum spending", async () => {
  const input = blendInput({
    province: "AB",
    taxYear: 2025,
    businessIncome: 1000000,
    salaryBlendFraction: 0.5,
    spendingNeed: 548700,
  });
  const result = await runComparison(input);

  assert.equal(result.corporate.feasible, true);
  assert.equal(result.corporate.lifestyleShortfall, 0);
  approx(blendWithdrawal(result), 932009.08, 1e-7);
  approx(result.corporate.retainedForInvestment, 1760.7872, 1e-6);
  assertCorporateCashConservation(result);
  await assertBlendMinimalToPriorCent(input, result);
});

test("blend solver corrects the AB 2026 headline winner", async () => {
  const input = blendInput({
    province: "AB",
    taxYear: 2026,
    businessIncome: 1000000,
    salaryBlendFraction: 0.1,
    spendingNeed: 472600,
  });
  const result = await runComparison(input);

  assert.equal(result.comparison.winner, "corporation");
  approx(blendWithdrawal(result), 760044.2, 1e-7);
  approx(result.corporate.retainedForInvestment, 84136.113964, 1e-6);
  approx(result.comparison.personalInvested, 83905.1, 1e-7);
  assertCorporateCashConservation(result);
  await assertBlendMinimalToPriorCent(input, result);
});

test("one dollar of spending no longer creates a two-thousand-dollar blend jump", async () => {
  const lowerInput = blendInput({
    province: "SK",
    taxYear: 2026,
    businessIncome: 1000000,
    salaryBlendFraction: 0.75,
    spendingNeed: 150599,
  });
  const upperInput = { ...lowerInput, spendingNeed: 150600 };
  const lower = await runComparison(lowerInput);
  const upper = await runComparison(upperInput);

  approx(blendWithdrawal(lower), 223996.02, 1e-7);
  approx(blendWithdrawal(upper), 223999.02, 1e-7);
  assert.ok(blendWithdrawal(upper) - blendWithdrawal(lower) <= 3);
  assert.ok(
    lower.corporate.retainedForInvestment -
      upper.corporate.retainedForInvestment <
      3
  );
  assertCorporateCashConservation(lower);
  assertCorporateCashConservation(upper);
  await assertBlendMinimalToPriorCent(lowerInput, lower);
  await assertBlendMinimalToPriorCent(upperInput, upper);
});

test("independent cent searches agree with representative blend results", async () => {
  const cases = [
    {
      input: blendInput({
        province: "AB",
        taxYear: 2025,
        businessIncome: 1000000,
        salaryBlendFraction: 0.5,
        spendingNeed: 548700,
      }),
      range: [932000, 932100],
    },
    {
      input: blendInput({
        province: "AB",
        taxYear: 2026,
        businessIncome: 1000000,
        salaryBlendFraction: 0.1,
        spendingNeed: 472600,
      }),
      range: [760000, 760100],
    },
    {
      input: blendInput({
        province: "SK",
        taxYear: 2025,
        businessIncome: 200000,
        salaryBlendFraction: 0.1,
        spendingNeed: 118700,
      }),
      range: [152700, 152900],
    },
  ];

  for (const { input, range } of cases) {
    const result = await runComparison(input);
    const reference = await independentCentReference(
      input,
      range[0],
      range[1]
    );
    assert.ok(reference, `reference search failed for ${JSON.stringify(input)}`);
    approx(blendWithdrawal(result), reference.W, 1e-7);
    approx(
      result.corporate.retainedForInvestment,
      reference.retained,
      1e-6
    );
    await assertBlendMinimalToPriorCent(input, result);
  }
});

test("blend solver remains minimal across payroll, tax-bracket, and SBD boundaries", async () => {
  const cases = [
    // 2025 CPP YMPE and YAMPE.
    blendInput({ spendingNeed: 105184.92 }),
    blendInput({ spendingNeed: 116561.92 }),
    // 2026 CPP YMPE and YAMPE.
    blendInput({
      province: "AB",
      taxYear: 2026,
      spendingNeed: 112692.98,
    }),
    blendInput({
      province: "AB",
      taxYear: 2026,
      spendingNeed: 126072.98,
    }),
    // 2025 federal personal brackets and Ontario federal SBD boundary.
    blendInput({
      businessIncome: 550000,
      spendingNeed: 84834.40023364486,
    }),
    blendInput({
      businessIncome: 550000,
      spendingNeed: 118947.6176744186,
    }),
    blendInput({
      businessIncome: 550000,
      spendingNeed: 76473.20665408211,
    }),
    // Saskatchewan's $600k provincial and $500k federal SBD boundaries.
    blendInput({
      province: "SK",
      businessIncome: 700000,
      spendingNeed: 134359.72,
    }),
    blendInput({
      province: "SK",
      businessIncome: 700000,
      spendingNeed: 247321.72,
    }),
    // Nova Scotia's $700k provincial SBD boundary in 2026.
    blendInput({
      province: "NS",
      taxYear: 2026,
      businessIncome: 1000000,
      spendingNeed: 318108.08,
    }),
    // Low-income and zero-spending branches.
    blendInput({
      province: "SK",
      taxYear: 2026,
      businessIncome: 50000,
      salaryBlendFraction: 0.25,
      spendingNeed: 27900,
    }),
    blendInput({ businessIncome: 50000, spendingNeed: 0 }),
  ];

  for (const input of cases) {
    const result = await runComparison(input);
    assert.equal(result.corporate.feasible, true);
    assertCorporateCashConservation(result);
    if (input.spendingNeed === 0) {
      assert.equal(blendWithdrawal(result), 0);
    } else {
      await assertBlendMinimalToPriorCent(input, result);
    }
  }
});

test("infeasible blends return the highest-net affordable state and exact shortfall", async () => {
  const input = blendInput({
    province: "AB",
    taxYear: 2025,
    businessIncome: 200000,
    salaryBlendFraction: 0.5,
    spendingNeed: 1000000,
  });
  const result = await runComparison(input);
  const taxData = await getTaxDataBundle(2025, {
    fsDataRoot: TAX_DATA_ROOT,
  });
  const { fed, provinces } = await loadCorporateTaxTables(2025);
  const W = blendWithdrawal(result);
  const net = blendNet(input, W, taxData);

  assert.equal(result.corporate.feasible, false);
  approx(result.corporate.lifestyleShortfall, input.spendingNeed - net, 1e-7);
  assertCorporateCashConservation(result);
  for (let cents = -500; cents <= 500; cents++) {
    const candidateW = W + cents / 100;
    if (candidateW < 0) continue;
    const salary = input.salaryBlendFraction * candidateW;
    const dividend = (1 - input.salaryBlendFraction) * candidateW;
    const employerCpp = employerCppForT4Employment(salary, { taxData });
    const corporateTax = computeCorporateTaxAmount(
      Math.max(0, input.businessIncome - salary - employerCpp),
      fed,
      provinces,
      input.province
    );
    const retained =
      input.businessIncome -
      salary -
      dividend -
      employerCpp -
      corporateTax;
    if (retained < 0) continue;
    assert.ok(
      blendNet(input, candidateW, taxData) <= net + 1e-7,
      `found higher net at W=${candidateW}`
    );
  }
});

test("blend endpoints preserve dedicated withdrawal affordability mechanics", async () => {
  const blendBase = {
    province: "ON",
    taxYear: 2026,
    businessIncome: 100000,
    spendingNeed: 50000,
    rrspRoom: 0,
    autoRrsp: false,
    retainEarnings: true,
  };
  // Dedicated modes require net >= spending. Blend mode intentionally keeps
  // its historical net + $0.50 >= spending tolerance, so subtract that
  // tolerance when comparing otherwise-equivalent endpoint mechanics.
  const dedicatedBase = {
    ...blendBase,
    spendingNeed: blendBase.spendingNeed - 0.5,
  };

  const dividend = await runComparison({
    ...dedicatedBase,
    withdrawalMode: "dividend",
  });
  const blendDividend = await runComparison({
    ...blendBase,
    withdrawalMode: "blend",
    salaryBlendFraction: 0,
  });
  approx(
    blendWithdrawal(blendDividend),
    dividend.corporate.grossDividendPaid,
    0.01
  );

  const salary = await runComparison({
    ...dedicatedBase,
    withdrawalMode: "salary",
  });
  const blendSalary = await runComparison({
    ...blendBase,
    withdrawalMode: "blend",
    salaryBlendFraction: 1,
  });
  approx(blendWithdrawal(blendSalary), salary.corporate.salaryPaid, 0.01);
  assertCorporateCashConservation(blendDividend);
  assertCorporateCashConservation(blendSalary);
});
