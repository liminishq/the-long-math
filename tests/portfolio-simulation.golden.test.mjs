/**
 * Shared portfolio simulation engine — cross-calculator consistency.
 */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPortfolioEngine() {
  const code = readFileSync(
    join(__dirname, "..", "assets", "js", "engines", "portfolioSimulationEngine.js"),
    "utf8"
  );
  const sandbox = { window: {} };
  runInNewContext(code, sandbox);
  const PS = sandbox.window.TLM_PortfolioSimulation;
  assert.ok(PS && typeof PS.simulatePortfolioScenario === "function");
  return PS;
}

function loadCalculateLongMath() {
  const engine = readFileSync(
    join(__dirname, "..", "assets", "js", "engines", "portfolioSimulationEngine.js"),
    "utf8"
  );
  const calc = readFileSync(join(__dirname, "..", "assets", "js", "calculator.engine.js"), "utf8");
  const sandbox = { window: {} };
  runInNewContext(engine + "\n" + calc, sandbox);
  return sandbox.window.calculateLongMath;
}

const PS = loadPortfolioEngine();
const calculateLongMath = loadCalculateLongMath();

function simpleFeeScenario(P, years, gross, feeAnnual, annualContrib) {
  const monthly = annualContrib / 12;
  const fees =
    feeAnnual > 0
      ? [{ type: "aumFlat", annualRate: feeAnnual, frequency: "monthly", timing: "end" }]
      : [];
  return {
    initialBalance: P,
    years,
    annualGrossReturn: gross,
    contribution:
      monthly > 0 ? { amount: monthly, frequency: "monthly", timing: "start" } : undefined,
    fees,
  };
}

function approx(a, b, eps = 1e-6) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b), `expected finite, got ${a}, ${b}`);
  assert.ok(Math.abs(a - b) <= eps, `expected ~${b}, got ${a}`);
}

test("advisor MER-only 0.5% matches standalone fee scenario", () => {
  const P = 500_000;
  const years = 30;
  const gross = 0.06;
  const annualContrib = 0;

  const adv = calculateLongMath({
    starting_balance: P,
    monthly_contribution: 0,
    horizon_years: years,
    annual_return: gross,
    use_default_fee: false,
    custom_advisor_fee_pct: 0,
    include_mer: true,
    mer_pct: 0.5,
  });

  const flat = PS.simulatePortfolioScenario(simpleFeeScenario(P, years, gross, 0.005, annualContrib));

  approx(adv.ending_with_advisor, flat.endingBalance, 1e-3);
});

test("advisor MER-only 1% matches standalone fee scenario", () => {
  const P = 100_000;
  const years = 20;
  const gross = 0.07;
  const annualContrib = 12_000;

  const adv = calculateLongMath({
    starting_balance: P,
    monthly_contribution: 1000,
    horizon_years: years,
    annual_return: gross,
    use_default_fee: false,
    custom_advisor_fee_pct: 0,
    include_mer: true,
    mer_pct: 1.0,
  });

  const flat = PS.simulatePortfolioScenario(simpleFeeScenario(P, years, gross, 0.01, annualContrib));

  approx(adv.ending_with_advisor, flat.endingBalance, 1e-2);
});

test("zero-fee path: no MER equals flat no-fee scenario", () => {
  const r = calculateLongMath({
    starting_balance: 50_000,
    monthly_contribution: 250,
    horizon_years: 15,
    annual_return: 0.05,
    use_default_fee: false,
    custom_advisor_fee_pct: 0,
    include_mer: false,
    mer_pct: 0,
  });

  const flat = PS.simulatePortfolioScenario(
    simpleFeeScenario(50_000, 15, 0.05, 0, 250 * 12)
  );

  approx(r.ending_without_advisor, flat.endingBalance, 1e-3);
});
