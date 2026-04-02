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
const DATA = join(__dirname, "..", "calculators", "ccpc-tax", "data", "2025");

before(() => {
  const federal = JSON.parse(readFileSync(join(DATA, "federal-corporate.json"), "utf8"));
  const provinces = JSON.parse(readFileSync(join(DATA, "provinces-corporate.json"), "utf8"));
  applyCorporateTaxDataSnapshot({ federal, provinces });
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
