/**
 * Sole proprietor vs corporation — invested-capital comparison (Canada).
 * Reuses computePersonalTax from canada-income-tax; corporate rates from CCPC JSON.
 *
 * Formula transparency: see runComparison output breakdown and inspect-the-arithmetic page.
 */

import { computePersonalTax } from "../canada-income-tax/js/tax.engine.js";
import { loadTaxData, getFederalData } from "../canada-income-tax/js/tax.data.js";

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
  const lim = Math.min(fed.sbd.limit, p.sbd.limit ?? fed.sbd.limit);
  const sbdRate = fed.sbd.rate + p.sbd.rate;
  const genRate = fed.general.rate + p.general.rate;
  const lowSlice = Math.min(income, lim);
  const highSlice = Math.max(0, income - lim);
  return lowSlice * sbdRate + highSlice * genRate;
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

function personalNetTakeHome(input, taxYear) {
  const r = computePersonalTax({ ...input, year: taxYear }, {});
  return r.totals.takeHomeAfterPayroll;
}

function personalIncomeTax(input, taxYear) {
  const r = computePersonalTax({ ...input, year: taxYear }, {});
  return r.totals.totalIncomeTax;
}

/**
 * Minimal gross dividend (non-eligible) such that net take-home >= need.
 * If impossible at maxDiv, returns best effort and flags.
 */
function solveNonEligibleDividendWithdrawal({ province, taxYear, spendingNeed, maxGrossDividend }) {
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
      taxYear
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
        taxYear
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
      taxYear
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
        taxYear
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
    taxYear
  );

  return {
    grossDividend,
    netTakeHome,
    feasible: true,
    shortfall: 0,
    taxOnWithdrawal,
  };
}

function solveSalaryWithdrawal({ province, taxYear, spendingNeed, maxSalary }) {
  const S = Math.max(0, spendingNeed);
  const maxSal = Math.max(0, maxSalary);

  const net = (sal) =>
    personalNetTakeHome(
      {
        province,
        employmentIncome: sal,
        selfEmploymentIncome: 0,
        nonEligibleDividends: 0,
        rrspDeduction: 0,
      },
      taxYear
    );

  const net0 = net(0);
  const netMax = net(maxSal);

  if (S <= 0) {
    return {
      salary: 0,
      netTakeHome: net0,
      feasible: true,
      shortfall: 0,
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, rrspDeduction: 0 },
        taxYear
      ),
    };
  }

  if (netMax + 1e-6 < S) {
    const taxMax = personalIncomeTax(
      { province, employmentIncome: maxSal, selfEmploymentIncome: 0, rrspDeduction: 0 },
      taxYear
    );
    return {
      salary: maxSal,
      netTakeHome: netMax,
      feasible: false,
      shortfall: S - netMax,
      taxOnWithdrawal: taxMax,
    };
  }

  if (net0 >= S) {
    return {
      salary: 0,
      netTakeHome: net0,
      feasible: true,
      shortfall: 0,
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, rrspDeduction: 0 },
        taxYear
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
    taxYear
  );

  return {
    salary,
    netTakeHome: net(salary),
    feasible: true,
    shortfall: 0,
    taxOnWithdrawal,
  };
}

/**
 * Blend: salary = k * W, non-eligible dividends = (1-k) * W; corporate tax on (G - salary).
 * Feasibility: cash available for dividends after salary + corp tax must cover (1-k)*W.
 * Search minimal W in [0, G] on a fine grid so behaviour stays stable when feasibility is non-monotone.
 */
function solveBlendWithdrawal({ province, taxYear, spendingNeed, grossCorpIncome, fed, provinces, provinceCode, salaryFraction, corpOpts }) {
  const k = Math.min(1, Math.max(0, salaryFraction));
  const G = Math.max(0, grossCorpIncome);
  const S = Math.max(0, spendingNeed);

  const netW = (W) => {
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
      taxYear
    );
  };

  const evalState = (W) => {
    const sal = k * W;
    const div = (1 - k) * W;
    const corpTI = Math.max(0, G - sal);
    const tc = computeCorporateTaxAmount(corpTI, fed, provinces, provinceCode, corpOpts);
    const cashAfter = G - sal - tc;
    const ok = sal <= G + 1e-6 && div <= cashAfter + 1e-2;
    return { sal, div, tc, ok, net: netW(W) };
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
      corpTax: computeCorporateTaxAmount(G, fed, provinces, provinceCode, corpOpts),
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, nonEligibleDividends: 0, rrspDeduction: 0 },
        taxYear
      ),
    };
  }

  if (netW(0) >= S) {
    const tc = computeCorporateTaxAmount(G, fed, provinces, provinceCode, corpOpts);
    return {
      blendTotalW: 0,
      salary: 0,
      grossDividend: 0,
      netTakeHome: netW(0),
      feasible: true,
      shortfall: 0,
      corpTax: tc,
      taxOnWithdrawal: personalIncomeTax(
        { province, employmentIncome: 0, selfEmploymentIncome: 0, nonEligibleDividends: 0, rrspDeduction: 0 },
        taxYear
      ),
    };
  }

  const STEPS = 500;
  let best = null;
  for (let i = 0; i <= STEPS; i++) {
    const W = (G * i) / STEPS;
    const st = evalState(W);
    if (!st.ok) continue;
    if (st.net + 0.5 >= S && (best == null || W < best.W)) {
      best = { W, ...st };
    }
  }

  if (!best) {
    const st = evalState(G);
    const taxOnWithdrawal = personalIncomeTax(
      {
        province,
        employmentIncome: st.sal,
        nonEligibleDividends: st.div,
        selfEmploymentIncome: 0,
        rrspDeduction: 0,
      },
      taxYear
    );
    return {
      blendTotalW: G,
      salary: st.sal,
      grossDividend: st.div,
      netTakeHome: st.net,
      feasible: false,
      shortfall: Math.max(0, S - st.net),
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
    taxYear
  );

  return {
    blendTotalW: best.W,
    salary: best.sal,
    grossDividend: best.div,
    netTakeHome: best.net,
    feasible: true,
    shortfall: 0,
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

  await loadTaxData(taxYear, { basePath: TAX_BASE });
  const fedPersonal = getFederalData();
  const rrspDollarMax = fedPersonal.rrspDollarMax ?? 32490;

  const { fed: fedCorp, provinces: provCorp } = await loadCorporateTaxTables(corpYear);

  const G = Math.max(0, Number(raw.businessIncome) || 0);
  const S = Math.max(0, Number(raw.spendingNeed) || 0);
  const room = Math.max(0, Number(raw.rrspRoom) || 0);

  let rrspContribution = Math.max(0, Number(raw.rrspContribution) || 0);
  if (raw.autoRrsp !== false) {
    rrspContribution = Math.min(room, G, rrspDollarMax);
  } else {
    // Match CRA annual cap; manual entry cannot deduct more than the dollar max.
    rrspContribution = Math.min(rrspContribution, room, G, rrspDollarMax);
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
    {}
  );

  const taxWithout = computePersonalTax(
    {
      year: taxYear,
      province,
      selfEmploymentIncome: G,
      employmentIncome: 0,
      rrspDeduction: 0,
    },
    {}
  );

  const personalTaxWith = taxWith.totals.totalIncomeTax;
  const personalTaxWithout = taxWithout.totals.totalIncomeTax;
  const rrspRefund = Math.max(0, personalTaxWithout - personalTaxWith);
  const takeHomeWithRrsp = taxWith.totals.takeHomeAfterPayroll;

  // Ledger: cash after contributing RRSP (no timing of refund in take-home)
  const walletAfterRrspAndTax = takeHomeWithRrsp - rrspContribution;
  const nonRegSurplus = investSurplus ? Math.max(0, walletAfterRrspAndTax - S) : 0;
  const refundInvested = reinvestRefund ? rrspRefund : 0;

  const personalInvested =
    rrspContribution + refundInvested + nonRegSurplus;
  const personalLifestyleShortfall = Math.max(0, S - walletAfterRrspAndTax);
  const walletOk =
    Number.isFinite(walletAfterRrspAndTax) &&
    Number.isFinite(S) &&
    walletAfterRrspAndTax + 1e-6 >= S;

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
      spendingNeed: S,
      maxSalary: G,
    });
    const corpTI = Math.max(0, G - sol.salary);
    const tc = computeCorporateTaxAmount(corpTI, fedCorp, provCorp, province, corpOpts);
    afterTaxCorp = G - sol.salary - tc;
    corpTaxFull = tc;
    corpResult = {
      mode: "salary",
      corporateTax: tc,
      afterTaxCorporateIncome: afterTaxCorp,
      grossDividend: 0,
      salary: sol.salary,
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
      spendingNeed: S,
      grossCorpIncome: G,
      fed: fedCorp,
      provinces: provCorp,
      provinceCode: province,
      salaryFraction: salaryBlendFrac,
      corpOpts,
    });
    const sal = sol.salary;
    const corpTI = Math.max(0, G - sal);
    const tc = sol.corpTax;
    afterTaxCorp = G - sal - tc;
    corpResult = {
      mode: "blend",
      corporateTax: tc,
      afterTaxCorporateIncome: afterTaxCorp,
      grossDividend: sol.grossDividend,
      salary: sal,
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
      spendingNeed: S,
      maxGrossDividend: afterTaxCorp,
    });
    corpResult = {
      mode: "dividend",
      corporateTax: corpTaxFull,
      afterTaxCorporateIncome: afterTaxCorp,
      grossDividend: sol.grossDividend,
      salary: 0,
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
      spendingNeed: S,
      walletAfterRrspContribution: walletAfterRrspAndTax,
      refundReinvested: refundInvested,
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
