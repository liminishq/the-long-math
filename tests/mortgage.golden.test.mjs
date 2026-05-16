/**
 * Mortgage calculator — golden cases on shared mortgage-engine.js
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require(join(__dirname, "..", "calculators", "mortgage-calculator", "mortgage-engine.js"));

const ME = globalThis.MortgageEngine;
assert.ok(ME, "MortgageEngine should be on globalThis after load");

function assertApprox(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("monthly payment: 0% amortizes principal linearly", () => {
  const pmt = ME.calculateMonthlyPayment(120_000, 0, 25);
  assert.equal(pmt, 400);
});

test("monthly periodic rate uses Canadian semi-annual conversion", () => {
  const monthlyRate = ME.calculatePeriodicRate(6, 12);
  assertApprox(monthlyRate, Math.pow(1 + 0.06 / 2, 1 / 6) - 1);
  assertApprox(monthlyRate, 0.004938622031196827, 1e-15);
  assert.ok(Math.abs(monthlyRate - 0.005) > 0.00001, "monthly rate should not be simple APR / 12");
});

test("biweekly periodic rate uses Canadian semi-annual conversion", () => {
  const biweeklyRate = ME.calculatePeriodicRate(6, 26);
  assertApprox(biweeklyRate, Math.pow(1 + 0.06 / 2, 2 / 26) - 1);
});

test("monthly payment: 6% $400k over 25y (spot-check)", () => {
  const pmt = ME.calculateMonthlyPayment(400_000, 6, 25);
  assert.ok(pmt > 2500 && pmt < 2600, `unexpected payment ${pmt}`);
});

test("accelerated biweekly uses the same periodic rate as standard biweekly", () => {
  const standard = ME.computeSchedule(400_000, 6, 25, "biweekly");
  const accelerated = ME.computeSchedule(400_000, 6, 25, "accelerated_biweekly");

  assert.equal(standard.isValid, true);
  assert.equal(accelerated.isValid, true);
  assertApprox(standard.schedule[0].interestPortion / 400_000, ME.calculatePeriodicRate(6, 26));
  assertApprox(accelerated.schedule[0].interestPortion / 400_000, ME.calculatePeriodicRate(6, 26));
  assert.equal(ME.getPaymentsPerYear("accelerated_biweekly"), ME.getPaymentsPerYear("biweekly"));
  assert.ok(accelerated.schedule[0].paymentAmount > standard.schedule[0].paymentAmount);
});

test("accelerated weekly uses the same periodic rate as standard weekly", () => {
  const standard = ME.computeSchedule(400_000, 6, 25, "weekly");
  const accelerated = ME.computeSchedule(400_000, 6, 25, "accelerated_weekly");

  assert.equal(standard.isValid, true);
  assert.equal(accelerated.isValid, true);
  assertApprox(standard.schedule[0].interestPortion / 400_000, ME.calculatePeriodicRate(6, 52));
  assertApprox(accelerated.schedule[0].interestPortion / 400_000, ME.calculatePeriodicRate(6, 52));
  assert.equal(ME.getPaymentsPerYear("accelerated_weekly"), ME.getPaymentsPerYear("weekly"));
  assert.ok(accelerated.schedule[0].paymentAmount > standard.schedule[0].paymentAmount);
});

test("zero-interest schedule remains unchanged", () => {
  const r = ME.computeSchedule(120_000, 0, 25, "monthly");
  assert.equal(r.isValid, true);
  assert.equal(r.schedule.length, 300);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.totalPaid, 120_000);
  assert.equal(r.payoffYears, 25);
});

test("full schedule: principal + interest ≈ totalPaid; balance ends ~0", () => {
  const r = ME.computeSchedule(400_000, 5.5, 25, "monthly");
  assert.equal(r.isValid, true);
  assert.ok(r.schedule.length > 0);
  assert.ok(Math.abs(r.totalPaid - 400_000 - r.totalInterest) < 1);
  const lastBal = r.schedule[r.schedule.length - 1].balance;
  assert.ok(lastBal < 1, `final balance should be ~0, got ${lastBal}`);
});
