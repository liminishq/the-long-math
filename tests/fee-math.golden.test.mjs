/**
 * Golden / regression tests for assets/js/fee-math.js (TLM_FeeMath).
 * Loads the browser IIFE in an isolated VM with a minimal window shim.
 *
 * Run from repo root: npm test
 * Or: node --test tests/fee-math.golden.test.mjs
 */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEE_MATH_PATH = join(__dirname, "..", "assets", "js", "fee-math.js");

function loadFeeMath() {
  const code = readFileSync(FEE_MATH_PATH, "utf8");
  const sandbox = { window: {} };
  runInNewContext(code, sandbox);
  const api = sandbox.window.TLM_FeeMath;
  assert.ok(api && typeof api.fvAnnual === "function", "TLM_FeeMath not attached");
  return api;
}

const M = loadFeeMath();
const { fvAnnual, fvPeriodicContributions, endingValueWithFee, requiredAlphaToOffsetFeeSimple, extraAnnualContributionToOffsetFee } = M;

function approx(a, b, eps = 1e-9) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b), `expected finite, got ${a}, ${b}`);
  assert.ok(Math.abs(a - b) <= eps, `expected ~${b}, got ${a} (tol ${eps})`);
}

test("fvAnnual: zero rate uses linear contribution accumulation", () => {
  const v = fvAnnual({ P: 1000, r: 0, years: 5, contrib: 100 });
  assert.equal(v, 1500);
});

test("fvAnnual: compound growth without contributions (hand-checked)", () => {
  const v = fvAnnual({ P: 1000, r: 0.1, years: 2, contrib: 0 });
  approx(v, 1210);
});

test("fvAnnual: fractional years are preserved", () => {
  const v = fvAnnual({ P: 1000, r: 0.1, years: 2.5, contrib: 0 });
  approx(v, 1000 * Math.pow(1.1, 2.5));
});

test("fvAnnual: negative years → NaN", () => {
  assert.ok(Number.isNaN(fvAnnual({ P: 1, r: 0.05, years: -1, contrib: 0 })));
});

test("fvAnnual: t=0 returns principal (contributions ignored)", () => {
  assert.equal(fvAnnual({ P: 500, r: 0.07, years: 0, contrib: 999 }), 500);
});

test("endingValueWithFee: matches fvAnnual at gross − fee", () => {
  const gross = 0.07;
  const fee = 0.01;
  const args = { P: 50_000, years: 12, contrib: 6000 };
  const a = endingValueWithFee({ ...args, gross, fee });
  const b = fvAnnual({ P: args.P, r: gross - fee, years: args.years, contrib: args.contrib });
  approx(a, b);
});

test("fvPeriodicContributions: matches fvAnnual when periodsPerYear is 1", () => {
  const r = 0.06;
  const years = 10;
  const contrib = 500;
  const a = fvAnnual({ P: 1000, r, years, contrib });
  const b = fvPeriodicContributions({
    P: 1000,
    rAnnual: r,
    years,
    contribPerPeriod: contrib,
    periodsPerYear: 1
  });
  approx(a, b);
});

test("endingValueWithFee: monthly contributions match period-compounded FV", () => {
  const gross = 0.06;
  const fee = 0;
  const years = 1;
  const contrib = 100;
  const v = endingValueWithFee({
    P: 0,
    gross,
    fee,
    years,
    contrib,
    contribFreq: "monthly"
  });
  const i = Math.pow(1 + gross, 1 / 12) - 1;
  const n = 12;
  const g = Math.pow(1 + i, n);
  const expect = contrib * ((g - 1) / i);
  approx(v, expect);
});

test("endingValueWithFee: monthly fractional years use nearest contribution period", () => {
  const gross = 0.06;
  const years = 1.5;
  const contrib = 100;
  const v = endingValueWithFee({
    P: 0,
    gross,
    fee: 0,
    years,
    contrib,
    contribFreq: "monthly"
  });
  const i = Math.pow(1 + gross, 1 / 12) - 1;
  const n = 18;
  const g = Math.pow(1 + i, n);
  const expect = contrib * ((g - 1) / i);
  approx(v, expect);
});

test("golden: endingValueWithFee round figures (6% gross, 1% fee, 30y, no contrib)", () => {
  const v = endingValueWithFee({
    P: 100_000,
    gross: 0.06,
    fee: 0.01,
    years: 30,
    contrib: 0
  });
  // 100000 * 1.05^30
  approx(v, 100_000 * Math.pow(1.05, 30));
});

test("requiredAlphaToOffsetFeeSimple: identity alpha = fee (decimals)", () => {
  approx(requiredAlphaToOffsetFeeSimple({ fee: 0.0125 }), 0.0125);
});

test("golden: extraAnnualContributionToOffsetFee (1y horizon, closed)", () => {
  const extra = extraAnnualContributionToOffsetFee({
    P: 10_000,
    years: 1,
    rGross: 0.05,
    fee: 0.01,
    contrib: 0
  });
  approx(extra, 100);
});

test("golden: extraAnnualContributionToOffsetFee when rNet = 0", () => {
  const P = 10_000;
  const years = 3;
  const rGross = 0.01;
  const fee = 0.01;
  const target = fvAnnual({ P, r: rGross, years, contrib: 0 });
  const extra = extraAnnualContributionToOffsetFee({
    P,
    years,
    rGross,
    fee,
    contrib: 0
  });
  const rNet = rGross - fee;
  assert.equal(rNet, 0);
  const withExtra = P + extra * years;
  approx(withExtra, target);
});
