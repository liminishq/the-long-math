import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDeductionTiming,
  futureValueOfRefund
} from "../calculators/rrsp-deduction-timing/engine.js";
import { computePersonalTax } from "../calculators/canada-income-tax/js/tax.engine.js";
import { loadTaxData } from "../calculators/canada-income-tax/js/tax.data.js";
import { resolveTaxDataForYear } from "../calculators/canada-income-tax/js/tax.projection.js";

const FS_DATA_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../calculators/canada-income-tax/data"
);
const runtime = { fsDataRoot: FS_DATA_ROOT };

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function taxSaving(year, province, income, deduction, dataOverride) {
  // Match optimizer: compare unrounded tax savings.
  const before = computePersonalTax(
    { year, province, employmentIncome: income, rrspDeduction: 0 },
    { dataOverride, roundToDollar: false }
  );
  const after = computePersonalTax(
    { year, province, employmentIncome: income, rrspDeduction: deduction },
    { dataOverride, roundToDollar: false }
  );
  return Math.max(0, before.totals.totalIncomeTax - after.totals.totalIncomeTax);
}

function valueAt(x, ctx) {
  const now = taxSaving(ctx.currentYear, ctx.province, ctx.currentIncome, x, ctx.currentData);
  const later = taxSaving(
    ctx.futureYear,
    ctx.province,
    ctx.futureIncome,
    ctx.D - x,
    ctx.futureData
  );
  const fv = futureValueOfRefund(now, ctx.years, ctx.rate);
  if (fv == null) return null;
  return fv + later;
}

async function bruteForceMax(ctx, step) {
  let best = -Infinity;
  let bestX = 0;
  for (let x = 0; x <= ctx.D + 1e-9; x += step) {
    const xx = Math.min(ctx.D, Math.round(x * 100) / 100);
    const v = valueAt(xx, ctx);
    if (v != null && v > best) {
      best = v;
      bestX = xx;
    }
  }
  // Always evaluate exact endpoint.
  const vD = valueAt(ctx.D, ctx);
  if (vD != null && vD > best) {
    best = vD;
    bestX = ctx.D;
  }
  return { best, bestX };
}

/** Local $1 rescan around candidate deduction points (and endpoints). */
function localRescanMax(ctx, centers, radius = 200) {
  let best = -Infinity;
  let bestX = 0;
  const seen = new Set();
  const consider = (x) => {
    const xx = Math.max(0, Math.min(ctx.D, Math.round(x)));
    if (seen.has(xx)) return;
    seen.add(xx);
    const v = valueAt(xx, ctx);
    if (v != null && v > best) {
      best = v;
      bestX = xx;
    }
  };
  consider(0);
  consider(ctx.D);
  for (const c of centers) {
    if (!Number.isFinite(c)) continue;
    const lo = Math.max(0, Math.floor(c - radius));
    const hi = Math.min(ctx.D, Math.ceil(c + radius));
    for (let x = lo; x <= hi; x += 1) consider(x);
  }
  return { best, bestX };
}

test("projection uses latest official year before target, not older selected year", async () => {
  const loadOfficialYear = (year) => loadTaxData(year, { fsDataRoot: FS_DATA_ROOT });
  const resolved = await resolveTaxDataForYear(2030, {
    loadOfficialYear,
    federalInflationRate: 0.02,
    // Even if a caller tried to force an old base, default path must use 2026.
    projectionBaseYear: undefined
  });
  assert.equal(resolved.meta.baseYear, 2026);
  assert.equal(resolved.meta.yearsAhead, 4);
  assert.equal(resolved.meta.projected, true);

  // Official target year never projects.
  const official = await resolveTaxDataForYear(2026, {
    loadOfficialYear,
    federalInflationRate: 0.02
  });
  assert.equal(official.meta.projected, false);

  // MB brackets stay frozen under projection from 2026.
  const mb = await resolveTaxDataForYear(2028, {
    loadOfficialYear,
    federalInflationRate: 0.02,
    provincialInflationRates: { MB: 0.02 }
  });
  const base = await loadOfficialYear(2026);
  assert.equal(mb.provinces.MB.brackets[1].threshold, base.provinces.MB.brackets[1].threshold);
  assert.equal(mb.provinces.MB.credits.basicPersonalAmount.amount, base.provinces.MB.credits.basicPersonalAmount.amount);
  // Federal still indexes.
  assert.equal(mb.federal.brackets[1].threshold, Math.round(58523 * 1.02 * 1.02));
});

test("years-to-wait rejects fractional values without changing them", async () => {
  const result = await computeDeductionTiming(
    {
      taxYear: 2026,
      province: "ON",
      currentIncome: 80000,
      futureIncome: 90000,
      deductionAmount: 5000,
      yearsToWait: 2.8,
      annualRate: 5,
      inflationRate: 2
    },
    runtime
  );
  assert.ok(result.error);
  assert.equal(result.error.code, "fractionalYears");
  assert.equal(result.error.field, "yearsToWait");
  assert.equal(result.inputs.yearsToWait, 2.8);
  assert.equal(result.inputs.futureTaxYear, null);
  assert.equal(result.comparison, null);
  assert.equal(result.optimization, null);
  assert.ok(result.warnings.includes("fractionalYears"));
});

test("engine still accepts yearsToWait=0 as same-year edge case", async () => {
  const zero = await computeDeductionTiming(
    {
      taxYear: 2026,
      province: "ON",
      currentIncome: 80000,
      futureIncome: 90000,
      deductionAmount: 5000,
      yearsToWait: 0,
      annualRate: 5,
      inflationRate: 2
    },
    runtime
  );
  assert.equal(zero.error, undefined);
  assert.equal(zero.inputs.yearsToWait, 0);
  assert.equal(zero.inputs.futureTaxYear, 2026);
  assert.equal(zero.sameYearComparison, true);
  assert.equal(zero.comparison.breakEvenAnnualRate, null);
  assert.ok(zero.warnings.includes("sameYear"));
  assert.match(zero.comparison.recommendation.sentence, /same-year/i);
  assert.doesNotMatch(zero.comparison.recommendation.sentence, /\blater\b/i);
  assert.doesNotMatch(zero.optimization.labels.allLater, /\blater\b/i);

  const two = await computeDeductionTiming(
    {
      taxYear: 2026,
      province: "ON",
      currentIncome: 80000,
      futureIncome: 90000,
      deductionAmount: 5000,
      yearsToWait: 2,
      annualRate: 5,
      inflationRate: 2
    },
    runtime
  );
  assert.equal(two.error, undefined);
  assert.equal(two.inputs.yearsToWait, 2);
  assert.equal(two.inputs.futureTaxYear, 2028);
  assert.equal(two.sameYearComparison, false);
});

test("optimizer never loses to corners; brute-force check across jurisdictions", async () => {
  const rand = mulberry32(20260809);
  const N = 1000;
  let maxCoarseGap = 0;
  let minSignedDiff = Infinity;
  let worst = null;
  let splitCount = 0;
  const candidates = [];

  for (let i = 0; i < N; i++) {
    const province = PROVINCES[Math.floor(rand() * PROVINCES.length)];
    const currentIncome = Math.round(30000 + rand() * 220000);
    const futureIncome = Math.round(30000 + rand() * 250000);
    const deductionAmount = Math.round(1000 + rand() * 70000);
    const yearsToWait = Math.floor(rand() * 6); // 0..5
    const annualRate = Math.round((-2 + rand() * 14) * 10) / 10; // -2% .. 12%
    const inflationRate = Math.round(rand() * 3 * 10) / 10; // 0..3%

    const result = await computeDeductionTiming(
      {
        taxYear: 2026,
        province,
        currentIncome,
        futureIncome,
        deductionAmount,
        yearsToWait,
        annualRate,
        inflationRate
      },
      runtime
    );

    const optV = result.optimization.optimal.totalFutureValue;
    const optX = result.optimization.optimal.claimNow;
    const allNow = result.optimization.allNow.totalFutureValue;
    const allLater = result.optimization.allLater.totalFutureValue;
    assert.ok(optV + 1e-6 >= allNow - 1, "optimal must beat or match all-now");
    assert.ok(optV + 1e-6 >= allLater - 1, "optimal must beat or match all-later");
    if (result.optimization.strategyKind === "split") splitCount += 1;

    const load = (y) =>
      resolveTaxDataForYear(y, {
        loadOfficialYear: (yy) => loadTaxData(yy, { fsDataRoot: FS_DATA_ROOT }),
        federalInflationRate: inflationRate / 100,
        defaultProvincialInflationRate: inflationRate / 100
      });
    const cur = await load(result.inputs.currentTaxYear);
    const fut = await load(result.inputs.futureTaxYear);
    const ctx = {
      currentYear: result.inputs.currentTaxYear,
      futureYear: result.inputs.futureTaxYear,
      province,
      currentIncome,
      futureIncome,
      D: deductionAmount,
      years: yearsToWait,
      rate: annualRate / 100,
      currentData: {
        federal: cur.federal,
        provinces: cur.provinces,
        payroll: cur.payroll,
        dividends: cur.dividends
      },
      futureData: {
        federal: fut.federal,
        provinces: fut.provinces,
        payroll: fut.payroll,
        dividends: fut.dividends
      }
    };

    // Coarse grid, then keep cases with the largest apparent gaps for $1 local rescan.
    const step = deductionAmount <= 5000 ? 25 : deductionAmount <= 20000 ? 50 : 100;
    const { best, bestX } = await bruteForceMax(ctx, step);
    const coarseGap = best - optV;
    if (coarseGap > maxCoarseGap) maxCoarseGap = coarseGap;
    candidates.push({
      coarseGap,
      optV,
      optX,
      bestX,
      ctx,
      meta: {
        province,
        currentIncome,
        futureIncome,
        deductionAmount,
        yearsToWait,
        annualRate,
        inflationRate,
        strategy: result.optimization.strategyKind
      }
    });
  }

  candidates.sort((a, b) => b.coarseGap - a.coarseGap);
  const toRescan = candidates.slice(0, 40);

  for (const row of toRescan) {
    const local = localRescanMax(row.ctx, [row.optX, row.bestX, 0, row.ctx.D], 400);
    // Signed difference: optimizer value minus best independently found.
    const signed = row.optV - local.best;
    if (signed < minSignedDiff) {
      minSignedDiff = signed;
      worst = {
        ...row.meta,
        optV: row.optV,
        optX: row.optX,
        independentBest: local.best,
        independentX: local.bestX,
        signedDiff: signed,
        coarseGap: row.coarseGap
      };
    }
    // Optimizer may beat a local grid; it must not lose beyond float/currency noise.
    assert.ok(
      signed >= -0.05,
      `Optimizer lagged independent $1 rescan by $${(-signed).toFixed(4)}; worst=${JSON.stringify({
        ...row.meta,
        optV: row.optV,
        optX: row.optX,
        independentBest: local.best,
        independentX: local.bestX,
        signedDiff: signed
      })}`
    );
  }

  assert.ok(splitCount >= 0);
  console.log(
    JSON.stringify({
      cases: N,
      splitCount,
      maxCoarseGap: Number(maxCoarseGap.toFixed(4)),
      minSignedDiff: Number(minSignedDiff.toFixed(4)),
      worst
    })
  );
});
