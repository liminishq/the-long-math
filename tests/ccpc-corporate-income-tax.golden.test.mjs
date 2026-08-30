/**
 * CCPC / corporate income tax — golden totals on pure corporate.engine rates
 * (complements calculators/ccpc-tax/tests/ccpc-bridge.test.mjs integration tests).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test, before } from "node:test";

import { applyCorporateTaxDataSnapshot } from "../calculators/ccpc-tax/js/corporate.data.js";
import { calculateCorporateTax } from "../calculators/ccpc-tax/js/corporate.engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(__dirname, "..", "calculators", "ccpc-tax", "data");

function loadCorporateYear(year) {
  const data = join(DATA_ROOT, String(year));
  const federal = JSON.parse(readFileSync(join(data, "federal-corporate.json"), "utf8"));
  const provinces = JSON.parse(readFileSync(join(data, "provinces-corporate.json"), "utf8"));
  applyCorporateTaxDataSnapshot({ federal, provinces });
}

before(() => {
  loadCorporateYear(2025);
});

test("ON: $100k taxable income — entirely within SBD (hand-checked from JSON rates)", () => {
  const r = calculateCorporateTax(100_000, "ON");
  assert.equal(r.federalTax, 9000); // 100k * 0.09
  assert.equal(r.provincialTax, 3200); // 100k * 0.032
  assert.equal(r.totalCorporateTax, 12_200);
  assert.equal(r.taxableIncome, 100_000);
});

test("ON: $600k taxable income — federal + ON split across SBD / general", () => {
  const r = calculateCorporateTax(600_000, "ON");
  const expectedFed = 500_000 * 0.09 + 100_000 * 0.15;
  const expectedProv = 500_000 * 0.032 + 100_000 * 0.115;
  assert.equal(r.federalTax, expectedFed);
  assert.equal(r.provincialTax, expectedProv);
  assert.equal(r.totalCorporateTax, expectedFed + expectedProv);
});

test("NS 2026: federal and provincial SBD limits are applied separately", () => {
  loadCorporateYear(2026);

  const r = calculateCorporateTax(600_000, "NS");
  const expectedFed = 500_000 * 0.09 + 100_000 * 0.15;
  const expectedProv = 600_000 * 0.015;

  assert.equal(r.breakdown.federal.sbdLimit, 500_000);
  assert.equal(r.breakdown.provincial.sbdLimit, 700_000);
  assert.equal(r.federalTax, expectedFed);
  assert.equal(r.provincialTax, expectedProv);
  assert.equal(r.totalCorporateTax, expectedFed + expectedProv);
});

test("QC 2026: SBD rate follows the corporate taxation-year start date", () => {
  loadCorporateYear(2026);

  const beforeChange = calculateCorporateTax(100_000, "QC", {
    taxationYearStartDate: "2026-04-29",
  });
  const afterChange = calculateCorporateTax(100_000, "QC", {
    taxationYearStartDate: "2026-04-30",
  });

  assert.equal(beforeChange.provincialTax, 100_000 * 0.032);
  assert.equal(afterChange.provincialTax, 100_000 * 0.022);
  assert.equal(afterChange.federalTax, 100_000 * 0.09);
});

test("public calculateCorporateTax boundary clamps negative or non-finite income to $0", () => {
  const zero = calculateCorporateTax(0, "ON");
  const negative = calculateCorporateTax(-50_000, "ON");
  const nan = calculateCorporateTax(Number.NaN, "ON");
  assert.equal(negative.taxableIncome, 0);
  assert.equal(nan.taxableIncome, 0);
  assert.equal(negative.totalCorporateTax, zero.totalCorporateTax);
  assert.equal(nan.totalCorporateTax, zero.totalCorporateTax);
  assert.equal(zero.totalCorporateTax, 0);
});
