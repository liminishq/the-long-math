/**
 * Advisor fee AUM engine (assets/js/calculator.engine.js) — golden scenarios via VM.
 */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCalculateLongMath() {
  const engine = readFileSync(
    join(__dirname, "..", "assets", "js", "engines", "portfolioSimulationEngine.js"),
    "utf8"
  );
  const code = readFileSync(join(__dirname, "..", "assets", "js", "calculator.engine.js"), "utf8");
  const sandbox = { window: {} };
  runInNewContext(engine + "\n" + code, sandbox);
  const fn = sandbox.window.calculateLongMath;
  assert.equal(typeof fn, "function");
  return fn;
}

const calculateLongMath = loadCalculateLongMath();

test("no advisor + no MER: with and without paths match flat compound", () => {
  const r = calculateLongMath({
    starting_balance: 100_000,
    monthly_contribution: 0,
    horizon_years: 10,
    annual_return: 0.07,
    use_default_fee: false,
    custom_advisor_fee_pct: 0,
    include_mer: false,
    mer_pct: 0,
  });
  assert.ok(r.ending_without_advisor > 100_000);
  assert.equal(r.ending_with_advisor, r.ending_without_advisor);
  assert.equal(r.fees_paid, 0);
  assert.equal(r.total_calculated_cost, 0);
  assert.equal(r.break_even_capped, false);
});

test("custom 1% advisor fee lowers ending balance; break-even return > 7%", () => {
  const r = calculateLongMath({
    starting_balance: 200_000,
    monthly_contribution: 500,
    horizon_years: 20,
    annual_return: 0.07,
    use_default_fee: false,
    custom_advisor_fee_pct: 1,
    include_mer: false,
    mer_pct: 0,
  });
  assert.ok(r.ending_with_advisor < r.ending_without_advisor);
  assert.ok(r.fees_paid > 0);
  assert.ok(r.break_even_return > 0.07);
  assert.equal(r.break_even_capped, false);
});

test("invalid starting balance throws", () => {
  assert.throws(
    () =>
      calculateLongMath({
        starting_balance: -1,
        monthly_contribution: 0,
        horizon_years: 10,
        annual_return: 0.05,
        use_default_fee: true,
        custom_advisor_fee_pct: 1,
        include_mer: false,
        mer_pct: 0,
      }),
    /Invalid starting balance/
  );
});
