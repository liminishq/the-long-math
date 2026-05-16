/**
 * Pay off mortgage vs invest — mortgage-rate conversion checks.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
require(join(__dirname, "..", "calculators", "pay-off-mortgage-vs-invest", "engine.js"));

const engine = globalThis.PayOffMortgageVsInvestEngine;
assert.ok(engine, "PayOffMortgageVsInvestEngine should be exported on globalThis");

function assertApprox(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("monthly mortgage rate uses Canadian semi-annual conversion", () => {
  const monthlyRate = engine.canadianMortgagePeriodicRate(6, 12);
  assertApprox(monthlyRate, Math.pow(1 + 0.06 / 2, 1 / 6) - 1);
  assertApprox(monthlyRate, 0.004938622031196827, 1e-15);
  assert.ok(Math.abs(monthlyRate - 0.005) > 0.00001, "monthly rate should not be simple APR / 12");
});

test("computed mortgage payment uses Canadian monthly rate", () => {
  const payment = engine.calculateMortgagePayment(400_000, 6, 25, 12);
  const monthlyRate = Math.pow(1 + 0.06 / 2, 1 / 6) - 1;
  const expected = 400_000 * monthlyRate / (1 - Math.pow(1 + monthlyRate, -25 * 12));
  assertApprox(payment, expected);
});

test("zero-interest mortgage payment remains linear", () => {
  const payment = engine.calculateMortgagePayment(120_000, 0, 25, 12);
  assert.equal(payment, 400);
});

test("payoff search uses the same Canadian monthly rate as payment calculation", () => {
  const payment = engine.calculateMortgagePayment(400_000, 6, 25, 12);
  const payoffMonth = engine.findMortgagePayoffMonth({
    initialMortgageBalance: 400_000,
    mortgagePaymentPerPeriod: payment,
    extraCashPerPeriod: 0,
    allocationPercent: 100,
    annualRate: 6,
  });
  assert.equal(payoffMonth, 300);
});
