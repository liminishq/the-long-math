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

test("monthly payment: 0% amortizes principal linearly", () => {
  const pmt = ME.calculateMonthlyPayment(120_000, 0, 25);
  assert.equal(pmt, 400);
});

test("monthly payment: 6% $400k over 25y (spot-check)", () => {
  const pmt = ME.calculateMonthlyPayment(400_000, 6, 25);
  assert.ok(pmt > 2500 && pmt < 2600, `unexpected payment ${pmt}`);
});

test("full schedule: principal + interest ≈ totalPaid; balance ends ~0", () => {
  const r = ME.computeSchedule(400_000, 5.5, 25, "monthly");
  assert.equal(r.isValid, true);
  assert.ok(r.schedule.length > 0);
  assert.ok(Math.abs(r.totalPaid - 400_000 - r.totalInterest) < 1);
  const lastBal = r.schedule[r.schedule.length - 1].balance;
  assert.ok(lastBal < 1, `final balance should be ~0, got ${lastBal}`);
});
