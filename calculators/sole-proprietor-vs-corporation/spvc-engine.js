/**
 * Sole proprietor vs corporation — invested-capital comparison (Canada).
 * Reuses computePersonalTax from canada-income-tax; corporate rates from CCPC JSON.
 *
 * Formula transparency: see runComparison output breakdown and inspect-the-arithmetic page.
 */

import {
  computePersonalTax,
  employerCppForT4Employment,
} from "../canada-income-tax/js/tax.engine.js";
import { getTaxDataBundle } from "../canada-income-tax/js/tax.data.js";

const TAX_BASE = "/calculators/canada-income-tax/data";
const CORP_BASE = "/calculators/ccpc-tax/data";

const CORP_CACHE = {};
const LATEST_TAX_DATA_YEAR = 2026;
const EARLIEST_TAX_DATA_YEAR = 2025;

/** Map future tax years to latest available bracket data. */
export function resolvePersonalTaxYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return LATEST_TAX_DATA_YEAR;
  if (y >= LATEST_TAX_DATA_YEAR) return LATEST_TAX_DATA_YEAR;
  if (y <= EARLIEST_TAX_DATA_YEAR) return EARLIEST_TAX_DATA_YEAR;
  return y;
}

export function resolveCorporateDataYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return LATEST_TAX_DATA_YEAR;
  if (y >= LATEST_TAX_DATA_YEAR) return LATEST_TAX_DATA_YEAR;
  if (y <= EARLIEST_TAX_DATA_YEAR) return EARLIEST_TAX_DATA_YEAR;
  return y;
}

export async function loadCorporateTaxTables(year) {
  const y = resolveCorporateDataYear(year);
  if (CORP_CACHE[y]) return CORP_CACHE[y];
  const [fed, provinces] = await Promise.all([
    fetch(`${CORP_BASE}/${y}/federal-corporate.json`).then((r) => r.json()),
    fetch(`${CORP_BASE}/${y}/provinces-corporate.json`).then((r) => r.json()),
  ]);
  CORP_CACHE[y] = { fed, provinces, year: y };
  return CORP_CACHE[y];
}

/**
 * Combined federal + provincial corporate tax on active business income,
 * splitting small-business vs general pools using each jurisdiction's SBD limit.
 */
export function computeCorporateTaxAmount(activeIncomeAfterSalary, fed, provObj, provinceCode, opts = {}) {
  const income = Math.max(0, activeIncomeAfterSalary);
  const overridePct = opts.overrideEffectiveRatePct;
  if (overridePct != null && Number.isFinite(overridePct)) {
    return income * (overridePct / 100);
  }
  const p = provObj[provinceCode];
  if (!p || !p.sbd || !p.general) throw new Error(`Corporate data missing for ${provinceCode}`);
  const federalLimit = fed.sbd.limit;
  const provincialLimit = p.sbd.limit ?? federalLimit;
  const federalTax =
    Math.min(income, federalLimit) * fed.sbd.rate +
    Math.max(0, income - federalLimit) * fed.general.rate;
  const provincialTax =
    Math.min(income, provincialLimit) * p.sbd.rate +
    Math.max(0, income - provincialLimit) * p.general.rate;
  return federalTax + provincialTax;
}

/** Display default: combined small-business rate (first dollar) for province. */
export function defaultSmallBusinessCombinedRatePct(fed, provObj, provinceCode) {
  const p = provObj[provinceCode];
  if (!p || !p.sbd) return null;
  return (fed.sbd.rate + p.sbd.rate) * 100;
}

function roundMoney(x) {
  return Math.round(Number(x) || 0);
}

function personalNetTakeHome(input, taxYear, taxData, opts = {}) {
  const taxOpts = {
    taxData,
    skipMarginalRateCalculation: true,
  };
  if (opts.roundToDollar === false) taxOpts.roundToDollar = false;
  const r = computePersonalTax(
    { ...input, year: taxYear },
    taxOpts
  );
  return r.totals.takeHomeAfterPayroll;
}

function personalIncomeTax(input, taxYear, taxData) {
  const r = computePersonalTax(
    { ...input, year: taxYear },
    {
      taxData,
      skipMarginalRateCalculation: true,
    }
  );
  return r.totals.totalIncomeTax;
}

/**
 * Minimal gross dividend (non-eligible) such that net take-home >= need.
 * If impossible at maxDiv, returns best effort and flags.
 */
function solveNonEligibleDividendWithdrawal({ province, taxYear, taxData, spendingNeed, maxGrossDividend }) {
  const S = Math.max(0, spendingNeed);
  const rawMax = Number(maxGrossDividend);
  const maxD = Math.max(0, Number.isFinite(rawMax) ? rawMax : 0);

  const net = (d) =>
    personalNetTakeHome(
      {
        province,
        employmentIncome: 0,
        selfEmploymentIncome: 0,
        nonEligibleDividends: d,
        rrspDeduction: 0,
      },
      taxYear,
      taxData
    );

  const net0 = net(0);
  const netMax = net(maxD);

  if (S <= 0) {
    return {
      grossDividend: 0,
      netTakeHome: net0,
      feasible: true,
      shortfall: 0,
      taxOnWithdrawal: personalIncomeTax(
        { province, nonEligibleDividends: 0, employmentIncome: 0, selfEmploymentIncome: 0, rrspDeduction: 0 },
        taxYear,
        taxData
      ),
    };
  }

  if (netMax + 1e-6 < S) {
    const taxMax = personalIncomeTax(
      {
        province,
        nonEligibleDividends: maxD,
        employmentIncome: 0,
        selfEmploymentIncome: 0,
        rrspDeduction: 0,
      },
      taxYear,
      taxData
    );
    return {
      grossDividend: maxD,
      netTakeHome: netMax,
      feasible: false,
      shortfall: S - netMax,
      taxOnWithdrawal: taxMax,
    };
  }

  if (net0 >= S) {
    return {
      grossDividend: 0,
      netTakeHome: net0,
      feasible: true,
      shortfall: 0,
      taxOnWithdrawal: personalIncomeTax(
        { province, nonEligibleDividends: 0, employmentIncome: 0, selfEmploymentIncome: 0, rrspDeduction: 0 },
        taxYear,
        taxData
      ),
    };
  }

  let lo = 0;
  let hi = maxD;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (net(mid) >= S) hi = mid;
    else lo = mid;
  }
  const grossDividend = hi;
  const netTakeHome = net(grossDividend);
  const taxOnWithdrawal = personalIncomeTax(
    {
      province,
      nonEligibleDividends: grossDividend,
      employmentIncome: 0,
      selfEmploymentIncome: 0,
      rrspDeduction: 0,
    },
    taxYear,
    taxData
  );

  return {
    grossDividend,
    netTakeHome,
    feasible: true,
    shortfall: 0,
    taxOnWithdrawal,
  };
}

function maximumAffordableSalary(grossCorpIncome, taxData) {
  const G = Math.max(0, grossCorpIncome);
  let lo = 0;
  let hi = G;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid + employerCppForT4Employment(mid, { taxData }) <= G) lo = mid;
    else hi = mid;
  }
  return lo;
}

function solveSalaryWithdrawal({ province, taxYear, taxData, spendingNeed, grossCorpIncome }) {
  const S = Math.max(0, spendingNeed);
  const maxSal = maximumAffordableSalary(grossCorpIncome, taxData);

  const net = (sal) =>
    personalNetTakeHome(
      {
        province,
        employmentIncome: sal,
        selfEmploymentIncome: 0,
        nonEligibleDividends: 0,
        rrspDeduction: 0,
      },
      taxYear,
      taxData
    );

  const net0 = net(0);
  const netMax = net(maxSal);

  if (S <= 0) {
    return {
      salary: 0,
      netTakeHome: net0,
      feasible: true,
      shortfall: 0,
      employerCpp: 0,
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, rrspDeduction: 0 },
        taxYear,
        taxData
      ),
    };
  }

  if (netMax + 1e-6 < S) {
    const taxMax = personalIncomeTax(
      { province, employmentIncome: maxSal, selfEmploymentIncome: 0, rrspDeduction: 0 },
      taxYear,
      taxData
    );
    return {
      salary: maxSal,
      netTakeHome: netMax,
      feasible: false,
      shortfall: S - netMax,
      employerCpp: employerCppForT4Employment(maxSal, { taxData }),
      taxOnWithdrawal: taxMax,
    };
  }

  if (net0 >= S) {
    return {
      salary: 0,
      netTakeHome: net0,
      feasible: true,
      shortfall: 0,
      employerCpp: 0,
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, rrspDeduction: 0 },
        taxYear,
        taxData
      ),
    };
  }

  let lo = 0;
  let hi = maxSal;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (net(mid) >= S) hi = mid;
    else lo = mid;
  }
  const salary = hi;
  const taxOnWithdrawal = personalIncomeTax(
    { province, employmentIncome: salary, selfEmploymentIncome: 0, rrspDeduction: 0 },
    taxYear,
    taxData
  );

  return {
    salary,
    netTakeHome: net(salary),
    feasible: true,
    shortfall: 0,
    employerCpp: employerCppForT4Employment(salary, { taxData }),
    taxOnWithdrawal,
  };
}

/**
 * Blend: salary = k * W, non-eligible dividends = (1-k) * W; corporate tax on
 * (G - salary - employer CPP).
 * Feasibility: cash after salary, employer CPP, and corporate tax must cover dividends.
 *
 * Corporate resource use is monotone for the supported 0..100% marginal
 * corporate-tax rates, so its exact affordable endpoint can be bisected.
 * Personal tax is searched differently: whole-dollar federal and provincial
 * tax rounding creates small downward sawteeth, making a binary search on the
 * rounded net unsafe. The unrounded result is monotone. The tax engine rounds
 * each federal/provincial bracket line and each final jurisdiction total, with
 * at most $0.50 error per rounding operation. The explicit bundle's bracket
 * counts therefore provide a formal rounded-vs-smooth net bound. Roots at the
 * target plus/minus that bound enclose a small cent-searched interval.
 */
function solveBlendWithdrawal({ province, taxYear, taxData, spendingNeed, grossCorpIncome, fed, provinces, provinceCode, salaryFraction, corpOpts }) {
  const NET_TOLERANCE = 0.5;
  const personalProvince = taxData.provinces[provinceCode];
  const TAX_ROUNDING_NET_BOUND =
    0.5 *
    (
      taxData.federal.brackets.length +
      personalProvince.brackets.length +
      2
    );
  const CENTS_PER_DOLLAR = 100;
  const ROOT_ITERATIONS = 70;
  const FLOAT_GUARD_DOLLARS = 0.02;
  const k = Math.min(1, Math.max(0, salaryFraction));
  const G = Math.max(0, grossCorpIncome);
  const S = Math.max(0, spendingNeed);

  const netW = (W, roundToDollar = true) => {
    const sal = k * W;
    const div = (1 - k) * W;
    return personalNetTakeHome(
      {
        province,
        employmentIncome: sal,
        selfEmploymentIncome: 0,
        nonEligibleDividends: div,
        rrspDeduction: 0,
      },
      taxYear,
      taxData,
      { roundToDollar }
    );
  };

  const evalState = (W, includeNet = true) => {
    const sal = k * W;
    const div = (1 - k) * W;
    const employerCpp = employerCppForT4Employment(sal, { taxData });
    const corpTI = Math.max(0, G - sal - employerCpp);
    const tc = computeCorporateTaxAmount(corpTI, fed, provinces, provinceCode, corpOpts);
    const cashAfter = G - sal - employerCpp - tc;
    const retained = cashAfter - div;
    const ok =
      sal + employerCpp <= G &&
      retained >= 0;
    return {
      W,
      sal,
      div,
      employerCpp,
      tc,
      retained,
      ok,
      net: includeNet ? netW(W) : null,
    };
  };

  const firstSmoothWAtOrAbove = (target, maxW) => {
    if (netW(0, false) >= target) return 0;
    if (netW(maxW, false) < target) return null;
    let lo = 0;
    let hi = maxW;
    for (let i = 0; i < ROOT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      if (netW(mid, false) >= target) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  const forEachCent = (fromW, toW, visit) => {
    const firstCent = Math.max(
      0,
      Math.floor((fromW - FLOAT_GUARD_DOLLARS) * CENTS_PER_DOLLAR)
    );
    const lastCent = Math.floor(
      (toW + 1e-9) * CENTS_PER_DOLLAR
    );
    for (let cents = firstCent; cents <= lastCent; cents++) {
      if (visit(cents / CENTS_PER_DOLLAR) === false) break;
    }
  };

  if (S <= 0) {
    const z = evalState(0);
    return {
      blendTotalW: 0,
      salary: 0,
      grossDividend: 0,
      netTakeHome: z.net,
      feasible: true,
      shortfall: 0,
      employerCpp: z.employerCpp,
      corpTax: computeCorporateTaxAmount(G, fed, provinces, provinceCode, corpOpts),
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, nonEligibleDividends: 0, rrspDeduction: 0 },
        taxYear,
        taxData
      ),
    };
  }

  if (netW(0) + NET_TOLERANCE >= S) {
    const tc = computeCorporateTaxAmount(G, fed, provinces, provinceCode, corpOpts);
    return {
      blendTotalW: 0,
      salary: 0,
      grossDividend: 0,
      netTakeHome: netW(0),
      feasible: true,
      shortfall: 0,
      employerCpp: 0,
      corpTax: tc,
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, nonEligibleDividends: 0, rrspDeduction: 0 },
        taxYear,
        taxData
      ),
    };
  }

  // Find the exact end of the affordable prefix, including the endpoint even
  // when it is not an even cent. This prevents near-maximum false shortfalls.
  let maxAffordableW = 0;
  const stateAtG = evalState(G, false);
  if (stateAtG.ok) {
    maxAffordableW = G;
  } else {
    let lo = 0;
    let hi = G;
    for (let i = 0; i < ROOT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      if (evalState(mid, false).ok) lo = mid;
      else hi = mid;
    }
    maxAffordableW = lo;
  }

  const roundedTarget = S - NET_TOLERANCE;
  const smoothLowerW =
    firstSmoothWAtOrAbove(
      roundedTarget - TAX_ROUNDING_NET_BOUND,
      maxAffordableW
    ) ?? maxAffordableW;
  const smoothUpperW =
    firstSmoothWAtOrAbove(
      roundedTarget + TAX_ROUNDING_NET_BOUND,
      maxAffordableW
    ) ?? maxAffordableW;

  let best = null;
  forEachCent(
    smoothLowerW,
    Math.min(maxAffordableW, smoothUpperW + FLOAT_GUARD_DOLLARS),
    (W) => {
      const st = evalState(W);
      if (st.ok && st.net + NET_TOLERANCE >= S) {
        best = st;
        return false;
      }
      return true;
    }
  );

  // A non-cent feasibility endpoint can be the only affordable point meeting
  // a near-maximum target.
  if (!best) {
    const endpoint = evalState(maxAffordableW);
    if (endpoint.ok && endpoint.net + NET_TOLERANCE >= S) best = endpoint;
  }

  if (!best) {
    // Rounded net can peak just before the endpoint. Any point whose smooth
    // net is more than $2 below the endpoint cannot beat it: both rounded
    // values are within $1 of their smooth values.
    const endpointSmoothNet = netW(maxAffordableW, false);
    const bestBandStart =
      firstSmoothWAtOrAbove(
        endpointSmoothNet - 2 * TAX_ROUNDING_NET_BOUND,
        maxAffordableW
      ) ?? 0;
    let bestFeasible = evalState(maxAffordableW);
    forEachCent(bestBandStart, maxAffordableW, (W) => {
      const st = evalState(W);
      if (
        st.ok &&
        (
          st.net > bestFeasible.net + 1e-9 ||
          (
            Math.abs(st.net - bestFeasible.net) <= 1e-9 &&
            st.W < bestFeasible.W
          )
        )
      ) {
        bestFeasible = st;
      }
      return true;
    });

    const st = bestFeasible;
    const taxOnWithdrawal = personalIncomeTax(
      {
        province,
        employmentIncome: st.sal,
        nonEligibleDividends: st.div,
        selfEmploymentIncome: 0,
        rrspDeduction: 0,
      },
      taxYear,
      taxData
    );
    return {
      blendTotalW: st.W,
      salary: st.sal,
      grossDividend: st.div,
      netTakeHome: st.net,
      feasible: false,
      shortfall: Math.max(0, S - st.net),
      employerCpp: st.employerCpp,
      corpTax: st.tc,
      taxOnWithdrawal,
    };
  }

  const taxOnWithdrawal = personalIncomeTax(
    {
      province,
      employmentIncome: best.sal,
      nonEligibleDividends: best.div,
      selfEmploymentIncome: 0,
      rrspDeduction: 0,
    },
    taxYear,
    taxData
  );

  return {
    blendTotalW: best.W,
    salary: best.sal,
    grossDividend: best.div,
    netTakeHome: best.net,
    feasible: true,
    shortfall: 0,
    employerCpp: best.employerCpp,
    corpTax: best.tc,
    taxOnWithdrawal,
  };
}

function futureValue(capital, annualReturnPct, years, dragPct) {
  const r = (Number(annualReturnPct) || 0) / 100;
  const d = (Number(dragPct) || 0) / 100;
  const y = Math.max(0, Number(years) || 0);
  const eff = r * (1 - d);
  return capital * Math.pow(1 + eff, y);
}

/**
 * Main entry: loads tax data, compares paths.
 * @param {object} raw — see spvc-ui for shape
 */
export async function runComparison(raw) {
  const province = raw.province;
  const taxYear = resolvePersonalTaxYear(raw.taxYear);
  const corpYear = resolveCorporateDataYear(raw.taxYear);

  const personalTaxData = await getTaxDataBundle(taxYear, { basePath: TAX_BASE });
  const fedPersonal = personalTaxData.federal;
  const rrspDollarMax = fedPersonal.rrspDollarMax ?? null;

  const { fed: fedCorp, provinces: provCorp } = await loadCorporateTaxTables(corpYear);

  const G = Math.max(0, Number(raw.businessIncome) || 0);
  const S = Math.max(0, Number(raw.spendingNeed) || 0);
  const room = Math.max(0, Number(raw.rrspRoom) || 0);

  let rrspContribution = Math.max(0, Number(raw.rrspContribution) || 0);
  if (raw.autoRrsp !== false) {
    // Cap at available room (may include carry-forward) and income — not a second annual-dollar max.
    rrspContribution = Math.min(room, G);
  } else {
    rrspContribution = Math.min(rrspContribution, room, G);
  }

  const reinvestRefund = raw.reinvestRefund !== false;
  const investSurplus = raw.investSurplus !== false;

  const taxWith = computePersonalTax(
    {
      year: taxYear,
      province,
      selfEmploymentIncome: G,
      employmentIncome: 0,
      rrspDeduction: rrspContribution,
    },
    { taxData: personalTaxData }
  );

  const taxWithout = computePersonalTax(
    {
      year: taxYear,
      province,
      selfEmploymentIncome: G,
      employmentIncome: 0,
      rrspDeduction: 0,
    },
    { taxData: personalTaxData }
  );

  const personalTaxWith = taxWith.totals.totalIncomeTax;
  const personalTaxWithout = taxWithout.totals.totalIncomeTax;
  const rrspRefund = Math.max(0, personalTaxWithout - personalTaxWith);
  const takeHomeWithRrsp = taxWith.totals.takeHomeAfterPayroll;
  const takeHomeBeforeRrspTaxSaving = taxWithout.totals.takeHomeAfterPayroll;

  // Keep the incremental RRSP tax saving outside surplus cash so it can be
  // allocated exactly once by the refund-reinvestment toggle.
  const walletAfterRrspAndTax =
    takeHomeBeforeRrspTaxSaving - rrspContribution;
  const nonRegSurplus = investSurplus ? Math.max(0, walletAfterRrspAndTax - S) : 0;
  const refundInvested = reinvestRefund ? rrspRefund : 0;
  const refundAvailableForSpending = reinvestRefund ? 0 : rrspRefund;
  const cashAvailableForSpending =
    walletAfterRrspAndTax + refundAvailableForSpending;

  const personalInvested =
    rrspContribution + refundInvested + nonRegSurplus;
  const personalLifestyleShortfall = Math.max(0, S - cashAvailableForSpending);
  const walletOk =
    Number.isFinite(cashAvailableForSpending) &&
    Number.isFinite(S) &&
    cashAvailableForSpending + 1e-6 >= S;

  let corpOverridePct =
    raw.corpRateOverride && String(raw.corpRateOverride).trim() !== ""
      ? Number(raw.corpRateOverride)
      : null;
  if (corpOverridePct != null && !Number.isFinite(corpOverridePct)) corpOverridePct = null;

  const corpOpts = { overrideEffectiveRatePct: corpOverridePct };

  const withdrawalMode = raw.withdrawalMode || "dividend"; // dividend | salary | blend
  const salaryBlendFrac = Math.min(1, Math.max(0, Number(raw.salaryBlendFraction) ?? 0.5));

  let corpTaxFull = computeCorporateTaxAmount(G, fedCorp, provCorp, province, corpOpts);
  if (!Number.isFinite(corpTaxFull)) corpTaxFull = 0;
  let afterTaxCorp = G - corpTaxFull;
  if (!Number.isFinite(afterTaxCorp)) afterTaxCorp = Math.max(0, G);

  let corpResult;

  if (withdrawalMode === "salary") {
    const sol = solveSalaryWithdrawal({
      province,
      taxYear,
      taxData: personalTaxData,
      spendingNeed: S,
      grossCorpIncome: G,
    });
    const employerCpp = sol.employerCpp;
    const corpTI = Math.max(0, G - sol.salary - employerCpp);
    const tc = computeCorporateTaxAmount(corpTI, fedCorp, provCorp, province, corpOpts);
    afterTaxCorp = G - sol.salary - employerCpp - tc;
    corpTaxFull = tc;
    corpResult = {
      mode: "salary",
      corporateTax: tc,
      afterTaxCorporateIncome: afterTaxCorp,
      grossDividend: 0,
      salary: sol.salary,
      employerCpp,
      personalTaxOnWithdrawal: sol.taxOnWithdrawal,
      corpCashForWithdrawal: sol.salary,
      retainedCorporate: raw.retainEarnings !== false ? Math.max(0, afterTaxCorp) : 0,
      feasible: sol.feasible,
      lifestyleShortfall: sol.shortfall || 0,
    };
  } else if (withdrawalMode === "blend") {
    const sol = solveBlendWithdrawal({
      province,
      taxYear,
      taxData: personalTaxData,
      spendingNeed: S,
      grossCorpIncome: G,
      fed: fedCorp,
      provinces: provCorp,
      provinceCode: province,
      salaryFraction: salaryBlendFrac,
      corpOpts,
    });
    const sal = sol.salary;
    const employerCpp = sol.employerCpp;
    const corpTI = Math.max(0, G - sal - employerCpp);
    const tc = sol.corpTax;
    afterTaxCorp = G - sal - employerCpp - tc;
    corpResult = {
      mode: "blend",
      corporateTax: tc,
      afterTaxCorporateIncome: afterTaxCorp,
      grossDividend: sol.grossDividend,
      salary: sal,
      employerCpp,
      personalTaxOnWithdrawal: sol.taxOnWithdrawal,
      corpCashForWithdrawal: sal + sol.grossDividend,
      retainedCorporate: raw.retainEarnings !== false ? Math.max(0, afterTaxCorp - sol.grossDividend) : 0,
      feasible: sol.feasible,
      lifestyleShortfall: sol.shortfall || 0,
      blendTotalW: sol.blendTotalW,
    };
  } else {
    const sol = solveNonEligibleDividendWithdrawal({
      province,
      taxYear,
      taxData: personalTaxData,
      spendingNeed: S,
      maxGrossDividend: afterTaxCorp,
    });
    corpResult = {
      mode: "dividend",
      corporateTax: corpTaxFull,
      afterTaxCorporateIncome: afterTaxCorp,
      grossDividend: sol.grossDividend,
      salary: 0,
      employerCpp: 0,
      personalTaxOnWithdrawal: sol.taxOnWithdrawal,
      corpCashForWithdrawal: sol.grossDividend,
      retainedCorporate:
        raw.retainEarnings !== false ? Math.max(0, afterTaxCorp - sol.grossDividend) : 0,
      feasible: sol.feasible,
      lifestyleShortfall: sol.shortfall || 0,
    };
  }

  const corpInvested = corpResult.retainedCorporate;

  const diff = corpInvested - personalInvested;
  const winner = diff >= 0 ? "corporation" : "personal";
  const losing = winner === "corporation" ? Math.abs(personalInvested) : Math.abs(corpInvested);
  const pctVsLoser =
    losing > 1e-6 ? (Math.abs(diff) / losing) * 100 : personalInvested === corpInvested ? 0 : null;

  const annualReturn = Number(raw.annualReturn) || 0;
  const projYears = Math.max(0, Number(raw.projectionYears) || 0);
  const corpDrag = Number(raw.corpPassiveDrag) || 0;

  let fvPersonal = null;
  let fvCorp = null;
  let fvDiff = null;
  if (raw.showProjection) {
    fvPersonal = futureValue(personalInvested, annualReturn, projYears, 0);
    fvCorp = futureValue(corpInvested, annualReturn, projYears, corpDrag);
    fvDiff = fvCorp - fvPersonal;
  }

  const effectivePersonalPerDollar = G > 0 ? personalInvested / G : 0;
  const effectiveCorpPerDollar = G > 0 ? corpInvested / G : 0;

  const defaultSbRate = defaultSmallBusinessCombinedRatePct(fedCorp, provCorp, province);

  return {
    inputs: {
      province,
      taxYear,
      businessIncome: G,
      spendingNeed: S,
      rrspRoom: room,
      rrspContribution,
      autoRrsp: raw.autoRrsp !== false,
      reinvestRefund,
      investSurplus,
      withdrawalMode,
      salaryBlendFraction: salaryBlendFrac,
      retainEarnings: raw.retainEarnings !== false,
      annualReturn,
      projectionYears: projYears,
      showProjection: !!raw.showProjection,
      corpPassiveDrag: corpDrag,
      corpRateOverridePct: corpOverridePct,
    },
    meta: {
      personalTaxDataYear: taxYear,
      corporateDataYear: corpYear,
      rrspDollarMax,
      defaultSmallBusinessCombinedRatePct: defaultSbRate,
    },
    personal: {
      grossBusinessIncome: G,
      rrspContribution,
      taxableIncomeAfterRrsp: taxWith.totals.taxableIncome,
      personalTaxWithRrsp: personalTaxWith,
      personalTaxWithoutRrsp: personalTaxWithout,
      rrspRefund,
      takeHomeAfterTax: takeHomeWithRrsp,
      takeHomeBeforeRrspTaxSaving,
      spendingNeed: S,
      walletAfterRrspContribution: walletAfterRrspAndTax,
      refundReinvested: refundInvested,
      refundAvailableForSpending,
      cashAvailableForSpending,
      nonRegisteredSurplusInvested: nonRegSurplus,
      totalInvested: personalInvested,
      effectivePerDollarGross: effectivePersonalPerDollar,
      lifestyleFeasible: walletOk,
      lifestyleShortfall: personalLifestyleShortfall,
    },
    corporate: {
      grossCorporateIncome: G,
      corporateTax: corpResult.corporateTax,
      afterTaxCorporateIncome: corpResult.afterTaxCorporateIncome,
      withdrawalMode: corpResult.mode,
      grossDividendPaid: corpResult.grossDividend,
      salaryPaid: corpResult.salary,
      employerCpp: corpResult.employerCpp,
      personalTaxOnWithdrawal: corpResult.personalTaxOnWithdrawal,
      corpCashUsedForWithdrawal: corpResult.corpCashForWithdrawal,
      retainedForInvestment: corpInvested,
      effectivePerDollarGross: effectiveCorpPerDollar,
      feasible: corpResult.feasible,
      lifestyleShortfall: corpResult.lifestyleShortfall || 0,
    },
    comparison: {
      winner,
      diffFirstYear: diff,
      pctAdvantageVsLoser: pctVsLoser,
      personalInvested,
      corpInvested,
    },
    projection:
      raw.showProjection
        ? {
            years: projYears,
            annualReturnPct: annualReturn,
            corpDragPct: corpDrag,
            fvPersonal,
            fvCorp,
            fvDiff,
          }
        : null,
  };
}

export function formatSummarySentence(result) {
  return formatShareSummary(result);
}

/** Cleaner share sentence per product copy (winner-relative). */
export function formatShareSummary(result) {
  const winnerIsCorp = result.comparison.winner === "corporation";
  const structure = winnerIsCorp ? "a corporation (retained earnings)" : "sole proprietorship with RRSP";
  const alt = winnerIsCorp ? "the sole proprietor / RRSP path" : "the corporation path";
  const diff = Math.abs(result.comparison.diffFirstYear);
  const pct =
    result.comparison.pctAdvantageVsLoser == null ? "0.0" : result.comparison.pctAdvantageVsLoser.toFixed(1);
  const dollars = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(roundMoney(diff));
  return `Using these assumptions, ${structure} leaves approximately ${dollars} more capital available to invest this year, a ${pct}% advantage over ${alt}.`;
}
