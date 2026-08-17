/**
 * Canadian Income Tax Bracket Calculator — threshold & consistency tests.
 * Uses the shared personal tax engine + tax-thresholds analysis (no duplicate rates).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const dataRoot = join(root, "calculators", "canada-income-tax", "data");

const thresholdsUrl = pathToFileURL(
  join(root, "calculators", "canada-income-tax", "js", "tax-thresholds.js")
).href;
const taxEngineUrl = pathToFileURL(
  join(root, "calculators", "canada-income-tax", "js", "tax.engine.js")
).href;

const {
  SUPPORTED_TAX_YEARS,
  ORDINARY_MARGINAL_DELTA,
  computeOrdinaryIncomeTax,
  ordinaryMarginalRate,
  findCombinedTaxThresholds,
  locateThresholds,
  analyzeOrdinaryTaxPosition,
  finiteDifferenceMarginal
} = await import(thresholdsUrl);
const { computePersonalTax } = await import(taxEngineUrl);

const PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"
];

const KNOWN_INCOMES = [
  0, 10000, 25000, 50000, 75000, 100000, 121300, 150000, 200000, 250000, 500000, 1000000
];

function loadYearData(year) {
  const dir = join(dataRoot, String(year));
  return {
    federal: JSON.parse(readFileSync(join(dir, "federal.json"), "utf8")),
    provinces: JSON.parse(readFileSync(join(dir, "provinces.json"), "utf8")),
    payroll: JSON.parse(readFileSync(join(dir, "payroll.json"), "utf8")),
    dividends: JSON.parse(readFileSync(join(dir, "dividends.json"), "utf8"))
  };
}

function dataYearsOnDisk() {
  return readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => Number(d.name))
    .sort((a, b) => a - b);
}

test("SUPPORTED_TAX_YEARS matches data directories on disk", () => {
  assert.deepEqual(SUPPORTED_TAX_YEARS.slice().sort((a, b) => a - b), dataYearsOnDisk());
});

for (const year of SUPPORTED_TAX_YEARS) {
  const dataOverride = loadYearData(year);
  const opts = { dataOverride, taxData: dataOverride };

  for (const province of PROVINCES) {
    test(`${year} ${province}: thresholds sorted, unique, and change the marginal rate`, () => {
      const thresholds = findCombinedTaxThresholds(year, province, opts);
      assert.ok(thresholds.length >= 2, "expected multiple combined thresholds");

      for (let i = 0; i < thresholds.length; i++) {
        const t = thresholds[i];
        assert.ok(t.income > 0);
        if (i > 0) {
          assert.ok(
            t.income > thresholds[i - 1].income,
            `thresholds must increase (${thresholds[i - 1].income} → ${t.income})`
          );
        }
        assert.ok(
          Math.abs(t.rateAtOrAbove - t.rateBelow) > 1e-5,
          `threshold ${t.income} must change marginal rate`
        );
      }
    });

    test(`${year} ${province}: boundary T-1 / T / T+1 continuity and neighbour links`, () => {
      const thresholds = findCombinedTaxThresholds(year, province, opts);
      for (const t of thresholds) {
        const T = t.income;
        const mLo = ordinaryMarginalRate(year, province, T - ORDINARY_MARGINAL_DELTA, opts);
        const mAt = ordinaryMarginalRate(year, province, T, opts);
        const mHi = ordinaryMarginalRate(year, province, T + ORDINARY_MARGINAL_DELTA, opts);

        assert.ok(
          Math.abs(mLo - t.rateBelow) < 1e-4,
          `${province} @${T}: rate below mismatch`
        );
        assert.ok(
          Math.abs(mAt - t.rateAtOrAbove) < 1e-4,
          `${province} @${T}: rate at mismatch`
        );
        // Immediately above T should stay in the new band (same as at T for ordinary steps).
        assert.ok(
          Math.abs(mHi - mAt) < 1e-3 || Math.abs(mHi - mAt) < 0.05,
          `${province} @${T}: rate just above should match band (got ${mAt} vs ${mHi})`
        );

        const taxLo = computeOrdinaryIncomeTax(year, province, T - 1, opts).totals.totalIncomeTax;
        const taxAt = computeOrdinaryIncomeTax(year, province, T, opts).totals.totalIncomeTax;
        const taxHi = computeOrdinaryIncomeTax(year, province, T + 1, opts).totals.totalIncomeTax;

        // Monotonic non-decreasing tax across the boundary (rounded dollars).
        assert.ok(taxAt + 2 >= taxLo, `${province} tax drop at T-1→T: ${taxLo}→${taxAt}`);
        assert.ok(taxHi + 2 >= taxAt, `${province} tax drop at T→T+1: ${taxAt}→${taxHi}`);

        const locAt = locateThresholds(thresholds, T);
        assert.ok(locAt.previous && Math.abs(locAt.previous.income - T) < 0.02);
        if (locAt.next) assert.ok(locAt.next.income > T);

        const locBelow = locateThresholds(thresholds, T - 1);
        assert.ok(locBelow.next && Math.abs(locBelow.next.income - T) < 0.02);
      }
    });

    test(`${year} ${province}: monotonicity sample and FD marginal convergence`, () => {
      const sample = [0, 5000, 15000, 30000, 60000, 90000, 120000, 180000, 300000, 800000];
      let prevTax = -1;
      let prevAfter = -1;
      for (const income of sample) {
        const r = computeOrdinaryIncomeTax(year, province, income, opts);
        assert.ok(
          r.totals.totalIncomeTax + 2 >= prevTax,
          `tax decreased ${prevTax} → ${r.totals.totalIncomeTax} at ${income}`
        );
        assert.ok(
          r.totals.afterTaxIncome + 2 >= prevAfter,
          `after-tax decreased at ${income}`
        );
        prevTax = r.totals.totalIncomeTax;
        prevAfter = r.totals.afterTaxIncome;
      }

      // Away from thresholds, Δ=$1/$10/$100 should agree.
      const thresholds = findCombinedTaxThresholds(year, province, opts);
      const safeIncome = 110000;
      const near = thresholds.some((t) => Math.abs(t.income - safeIncome) < 150);
      const income = near ? 95000 : safeIncome;
      const near2 = thresholds.some((t) => Math.abs(t.income - income) < 150);
      if (!near2) {
        const r1 = finiteDifferenceMarginal(year, province, income, 1, opts);
        const r10 = finiteDifferenceMarginal(year, province, income, 10, opts);
        const r100 = finiteDifferenceMarginal(year, province, income, 100, opts);
        assert.ok(Math.abs(r1 - r10) < 0.01, `Δ1 vs Δ10 at ${income}: ${r1} ${r10}`);
        assert.ok(Math.abs(r1 - r100) < 0.02, `Δ1 vs Δ100 at ${income}: ${r1} ${r100}`);
      }
    });

    test(`${year} ${province}: known incomes — rates, neighbours, cross-calculator tax match`, () => {
      const thresholds = findCombinedTaxThresholds(year, province, opts);
      for (const income of KNOWN_INCOMES) {
        const analysis = analyzeOrdinaryTaxPosition(year, province, income, opts);
        const personal = computePersonalTax(
          {
            year,
            province,
            otherIncome: income,
            employmentIncome: 0,
            selfEmploymentIncome: 0,
            eligibleDividends: 0,
            nonEligibleDividends: 0,
            capitalGains: 0,
            rrspDeduction: 0,
            fhsaDeduction: 0,
            estimatedDeductions: 0,
            taxPaid: 0
          },
          { dataOverride }
        );

        assert.equal(
          analysis.totalIncomeTax,
          personal.totals.totalIncomeTax,
          `cross-calc tax mismatch at ${income}`
        );
        assert.equal(analysis.federalTax, personal.totals.federalTax);
        assert.equal(analysis.provincialTax, personal.totals.provTax);

        if (income === 0) {
          assert.equal(analysis.averageRate, 0);
          assert.ok(analysis.marginalRate >= 0);
        } else {
          assert.ok(Math.abs(analysis.averageRate - analysis.totalIncomeTax / income) < 1e-12);
        }

        const { previous, next } = locateThresholds(thresholds, income);
        if (!next) {
          assert.equal(analysis.next, null);
        } else {
          assert.ok(analysis.next);
          assert.ok(Math.abs(analysis.next.threshold - next.income) < 0.02);
          assert.ok(analysis.next.distanceBelow > 0 || income === next.income);
        }

        if (!previous) {
          assert.ok(analysis.previous?.none);
        } else {
          assert.ok(analysis.previous && !analysis.previous.none);
        }
      }
    });
  }
}

test("ON 2026: Ontario Health Premium and surtax appear among thresholds", () => {
  const dataOverride = loadYearData(2026);
  const thresholds = findCombinedTaxThresholds(2026, "ON", {
    dataOverride,
    taxData: dataOverride
  });
  const reasons = thresholds.map((t) => t.reason || "").join(" | ");
  assert.ok(
    reasons.includes("Ontario Health Premium phase-in begins") ||
      reasons.includes("Ontario Health Premium becomes flat"),
    reasons
  );
  assert.ok(reasons.includes("Ontario surtax") || reasons.includes("surtax"), reasons);
  assert.ok(reasons.includes("Federal tax bracket"), reasons);
  assert.ok(reasons.includes("Ontario tax bracket"), reasons);
});

test("negative taxable income normalizes to zero", () => {
  const dataOverride = loadYearData(2026);
  const a = analyzeOrdinaryTaxPosition(2026, "ON", -5000, {
    dataOverride,
    taxData: dataOverride
  });
  assert.equal(a.taxableIncome, 0);
  assert.equal(a.totalIncomeTax, 0);
});
