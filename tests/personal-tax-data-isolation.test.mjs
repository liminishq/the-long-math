import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  getTaxDataBundle,
  loadTaxData
} from "../calculators/canada-income-tax/js/tax.data.js";
import {
  computePersonalTax
} from "../calculators/canada-income-tax/js/tax.engine.js";
import {
  projectTaxData,
  resolveTaxDataForYear
} from "../calculators/canada-income-tax/js/tax.projection.js";
import {
  runComparison
} from "../calculators/sole-proprietor-vs-corporation/spvc-engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAX_DATA_ROOT = path.join(ROOT, "calculators/canada-income-tax/data");

function taxInput(year, province = "ON") {
  return {
    year,
    province,
    employmentIncome: 120_000,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    capitalGains: 0,
    rrspDeduction: 0
  };
}

function totalTax(year, province, taxData) {
  return computePersonalTax(
    taxInput(year, province),
    { taxData }
  ).totals.totalIncomeTax;
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("explicit A(2025)/B(2026)/A calculations ignore legacy active data", async () => {
  const data2025 = await getTaxDataBundle(2025, { fsDataRoot: TAX_DATA_ROOT });
  const data2026 = await getTaxDataBundle(2026, { fsDataRoot: TAX_DATA_ROOT });

  const firstA = totalTax(2025, "ON", data2025);
  const resultB = totalTax(2026, "BC", data2026);

  await loadTaxData(2026, { fsDataRoot: TAX_DATA_ROOT });
  const secondA = totalTax(2025, "ON", data2025);

  assert.equal(firstA, secondA);
  assert.notEqual(firstA, resultB);

  await loadTaxData(2025, { fsDataRoot: TAX_DATA_ROOT });
  assert.equal(totalTax(2026, "BC", data2026), resultB);
});

test("concurrent per-request loads are cached by year and source without contamination", async () => {
  const distinctSourceIdentity = `${TAX_DATA_ROOT}${path.sep}`;
  const pending2025a = getTaxDataBundle(2025, {
    fsDataRoot: distinctSourceIdentity
  });
  const pending2025b = getTaxDataBundle(2025, {
    fsDataRoot: distinctSourceIdentity
  });
  const pending2026 = getTaxDataBundle(2026, {
    fsDataRoot: distinctSourceIdentity
  });

  assert.strictEqual(pending2025a, pending2025b);
  const [data2025, same2025, data2026] = await Promise.all([
    pending2025a,
    pending2025b,
    pending2026
  ]);

  assert.strictEqual(data2025, same2025);
  assert.equal(data2025.year, 2025);
  assert.equal(data2026.year, 2026);
  assert.notStrictEqual(data2025, data2026);
  assert.equal(data2025.federal.year, 2025);
  assert.equal(data2026.federal.year, 2026);

  const canonicalSource2025 = await getTaxDataBundle(2025, {
    fsDataRoot: TAX_DATA_ROOT
  });
  assert.notStrictEqual(data2025, canonicalSource2025);
});

test("failed bundle-load promises are evicted so a later request can retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  let attempts = 0;
  console.error = () => {};
  globalThis.fetch = async () => {
    attempts += 1;
    throw new Error("deliberate load failure");
  };

  try {
    await assert.rejects(
      getTaxDataBundle(2099, { basePath: "/deliberate-failure" }),
      /deliberate load failure/
    );
    const attemptsAfterFirstFailure = attempts;
    await assert.rejects(
      getTaxDataBundle(2099, { basePath: "/deliberate-failure" }),
      /deliberate load failure/
    );
    assert.ok(attempts > attemptsAfterFirstFailure);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("official source bundles are deeply immutable", async () => {
  const bundle = await getTaxDataBundle(2025, {
    fsDataRoot: TAX_DATA_ROOT
  });
  assertDeepFrozen(bundle);
  assert.throws(() => {
    bundle.federal.brackets[1].threshold = -1;
  }, TypeError);
  assert.equal(bundle.federal.brackets[1].threshold > 0, true);
});

test("projected and resolved bundles are frozen and leave official base unchanged", async () => {
  const base = await getTaxDataBundle(2026, {
    fsDataRoot: TAX_DATA_ROOT
  });
  const before = JSON.stringify(base);
  const projected = projectTaxData(base, {
    baseYear: 2026,
    targetYear: 2028,
    federalInflationRate: 0.02,
    defaultProvincialInflationRate: 0.02
  });

  assert.equal(JSON.stringify(base), before);
  assert.equal(projected.year, 2028);
  assertDeepFrozen(projected);
  assert.throws(() => {
    projected.provinces.ON.brackets[1].threshold = -1;
  }, TypeError);

  const zeroYear = projectTaxData(base, {
    baseYear: 2026,
    targetYear: 2026,
    federalInflationRate: 0.02
  });
  assert.strictEqual(zeroYear.federal, base.federal);
  assert.strictEqual(zeroYear.provinces, base.provinces);
  assert.equal(Object.isFrozen(zeroYear.meta), true);

  const resolved = await resolveTaxDataForYear(2027, {
    loadOfficialYear: (year) =>
      getTaxDataBundle(year, { fsDataRoot: TAX_DATA_ROOT }),
    federalInflationRate: 0.02
  });
  assert.equal(resolved.year, 2027);
  assertDeepFrozen(resolved);
  assert.equal(JSON.stringify(base), before);
});

test("explicit tax-data options reject partial bundles and year mismatches", async () => {
  const data2025 = await getTaxDataBundle(2025, {
    fsDataRoot: TAX_DATA_ROOT
  });
  const data2026 = await getTaxDataBundle(2026, {
    fsDataRoot: TAX_DATA_ROOT
  });

  assert.throws(
    () =>
      computePersonalTax(taxInput(2025), {
        taxData: { federal: data2025.federal }
      }),
    /bundle is incomplete; missing: provinces, payroll, dividends/
  );
  assert.throws(
    () =>
      computePersonalTax(taxInput(2025), {
        dataOverride: { federal: data2025.federal }
      }),
    /bundle is incomplete/
  );
  assert.throws(
    () => computePersonalTax(taxInput(2025), { taxData: data2026 }),
    /Tax data year 2026 does not match calculation year 2025/
  );
});

test("overlapping SPVC requests remain equal to isolated calculations during legacy churn", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const relative = String(url).replace(/^\/+/, "");
    const filePath = path.join(ROOT, relative);
    const yearMatch = relative.match(/\/(2025|2026)\//);
    const isCorporate = relative.includes("-corporate.json");
    const delay =
      yearMatch?.[1] === "2025"
        ? (isCorporate ? 5 : 40)
        : (isCorporate ? 40 : 5);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return {
      ok: true,
      json: async () => JSON.parse(await fs.readFile(filePath, "utf8"))
    };
  };

  const args = (taxYear) => ({
    province: "ON",
    taxYear,
    businessIncome: 150_000,
    spendingNeed: 70_000,
    rrspRoom: 50_000,
    annualReturn: 5,
    projectionYears: 20,
    autoRrsp: true,
    reinvestRefund: true,
    investSurplus: true,
    retainEarnings: true,
    withdrawalMode: "dividend"
  });
  const compact = (result) => ({
    year: result.inputs.taxYear,
    rrspContribution: result.personal.rrspContribution,
    personalTaxWithRrsp: result.personal.personalTaxWithRrsp,
    personalTaxWithoutRrsp: result.personal.personalTaxWithoutRrsp,
    rrspRefund: result.personal.rrspRefund,
    personalInvested: result.comparison.personalInvested
  });

  try {
    const oldRequest = runComparison(args(2025));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const latestRequest = runComparison(args(2026));
    const legacyChurn = loadTaxData(2025, { fsDataRoot: TAX_DATA_ROOT });

    const [concurrent2025, concurrent2026] = await Promise.all([
      oldRequest,
      latestRequest,
      legacyChurn
    ]);
    const isolated2025 = await runComparison(args(2025));
    const isolated2026 = await runComparison(args(2026));

    assert.deepEqual(compact(concurrent2025), compact(isolated2025));
    assert.deepEqual(compact(concurrent2026), compact(isolated2026));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
