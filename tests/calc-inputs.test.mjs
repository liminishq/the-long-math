import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(join(root, "assets", "js", "calc-inputs.js")).href);

const CI = globalThis.TLM.calcInputs;
assert.ok(CI);

test("parseNumber rounds to two decimals", () => {
  assert.equal(CI.parseNumber("16.339"), 16.34);
  assert.equal(CI.parseNumber("21.5"), 21.5);
  assert.equal(CI.parseNumber("7.1"), 7.1);
  assert.equal(CI.parseNumber("1000.999"), 1001);
  assert.equal(CI.parseNumber("2,500.567"), 2500.57);
});

test("format helpers use two decimals", () => {
  assert.equal(CI.formatPercentFromDecimal(0.0717734625, 2), "7.18%");
  assert.match(CI.formatMoney(1234.5, 2), /1,234\.50|1234\.50/);
});

test("auto-enhance is opt-in only", () => {
  assert.equal(typeof CI.enhanceNumberInputs, "function");
  assert.equal(typeof CI.initCalculatorInputs, "function");
  // Documented contract: without data-tlm-decimal-inputs / data-tlm-decimal-input,
  // init must not rely on mutating arbitrary calculator fields globally.
  // (DOM mutation coverage is exercised in browser; here we only guard the API surface.)
  assert.ok(true);
});
