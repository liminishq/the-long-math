import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const calculatorDir = join(__dirname, "..", "calculators", "flat-fee-or-hourly");
const engineCode = readFileSync(join(calculatorDir, "engine.js"), "utf8");
const uiCode = readFileSync(join(calculatorDir, "ui.js"), "utf8");

const ELEMENT_IDS = [
  "starting_balance",
  "monthly_contribution",
  "horizon_years",
  "annual_return",
  "annual_return_slider",
  "annual_return_label",
  "model_flat",
  "model_hourly",
  "model_aum",
  "fields_flat",
  "fields_hourly",
  "fields_aum",
  "flat_fee",
  "hourly_rate",
  "hours_per_year",
  "aum_fee_pct",
  "fee_inflation_on",
  "fee_inflation_on_hourly",
  "fields_fee_increase",
  "fields_fee_increase_hourly",
  "fee_increase_pct",
  "fee_increase_pct_hourly",
  "shared_scenario_banner",
  "flat_fee_calc_notice",
  "out_with",
  "out_without",
  "out_fees",
  "out_lost",
  "out_total_cost",
  "out_aum_equiv",
  "share_result_btn",
];

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.style = { display: "" };
    this.textContent = "";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, type });
    }
  }
}

function loadCalculator(search = "") {
  const elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new FakeElement(id)]));
  elements.model_flat.value = "flat";
  elements.model_hourly.value = "hourly";
  elements.model_aum.value = "aum";
  const radios = [elements.model_flat, elements.model_hourly, elements.model_aum];
  const calls = [];
  let shareScenarioFactory = null;

  const document = {
    readyState: "complete",
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      if (selector === 'input[name="fee_model"]:checked') {
        return radios.find((radio) => radio.checked) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'input[name="fee_model"]' ? radios : [];
    },
    addEventListener() {},
  };

  const window = {
    location: {
      pathname: "/calculators/flat-fee-or-hourly/",
      search,
    },
    TLM: {
      shareCard: {
        track() {},
        wireCalculatorShare(_slug, factory) {
          shareScenarioFactory = factory;
        },
      },
    },
  };

  const sandbox = {
    console,
    document,
    Intl,
    Number,
    URLSearchParams,
    window,
  };

  runInNewContext(engineCode, sandbox, { filename: "engine.js" });
  const calculate = window.calculateFlatFeeOrHourlyCost;
  window.calculateFlatFeeOrHourlyCost = (inputs) => {
    const result = calculate(inputs);
    calls.push({ inputs: { ...inputs }, result: { ...result } });
    return result;
  };
  runInNewContext(uiCode, sandbox, { filename: "ui.js" });

  function selectFeeModel(model) {
    for (const radio of radios) {
      radio.checked = radio.value === model;
    }
    elements[`model_${model}`].dispatch("change");
  }

  return {
    elements,
    calls,
    lastCall: () => calls.at(-1),
    selectFeeModel,
    shareScenario: () => shareScenarioFactory(),
  };
}

test("flat model reads only the flat escalation controls", () => {
  const calc = loadCalculator();
  const { elements } = calc;

  elements.fee_inflation_on.checked = true;
  elements.fee_increase_pct.value = "2.5";
  elements.fee_inflation_on_hourly.checked = false;
  elements.fee_increase_pct_hourly.value = "11";
  elements.fee_increase_pct.dispatch("input");

  assert.equal(calc.lastCall().inputs.feeModel, "flat");
  assert.equal(calc.lastCall().inputs.feeInflationOn, true);
  assert.equal(calc.lastCall().inputs.feeIncreasePct, 2.5);
});

test("hourly model reads only the hourly escalation controls", () => {
  const calc = loadCalculator();
  const { elements } = calc;

  elements.fee_inflation_on.checked = true;
  elements.fee_increase_pct.value = "9";
  elements.fee_inflation_on_hourly.checked = false;
  elements.fee_increase_pct_hourly.value = "3";
  calc.selectFeeModel("hourly");

  assert.equal(calc.lastCall().inputs.feeModel, "hourly");
  assert.equal(calc.lastCall().inputs.feeInflationOn, false);
  assert.equal(calc.lastCall().inputs.feeIncreasePct, 3);
});

test("repeated model switching preserves each model's escalation settings", () => {
  const calc = loadCalculator();
  const { elements } = calc;

  elements.fee_inflation_on.checked = true;
  elements.fee_increase_pct.value = "2";
  elements.fee_inflation_on_hourly.checked = false;
  elements.fee_increase_pct_hourly.value = "8";

  calc.selectFeeModel("hourly");
  assert.equal(calc.lastCall().inputs.feeInflationOn, false);
  assert.equal(calc.lastCall().inputs.feeIncreasePct, 8);

  calc.selectFeeModel("flat");
  assert.equal(calc.lastCall().inputs.feeInflationOn, true);
  assert.equal(calc.lastCall().inputs.feeIncreasePct, 2);

  calc.selectFeeModel("hourly");
  assert.equal(calc.lastCall().inputs.feeInflationOn, false);
  assert.equal(calc.lastCall().inputs.feeIncreasePct, 8);
});

test("hidden escalation controls do not affect the active calculation", () => {
  const calc = loadCalculator();
  const { elements } = calc;

  elements.fee_inflation_on.checked = false;
  elements.fee_increase_pct.value = "2";
  elements.fee_inflation_on.dispatch("change");
  const before = calc.lastCall();

  elements.fee_inflation_on_hourly.checked = true;
  elements.fee_increase_pct_hourly.value = "20";
  elements.fee_inflation_on_hourly.dispatch("change");
  const after = calc.lastCall();

  assert.equal(after.inputs.feeModel, "flat");
  assert.equal(after.inputs.feeInflationOn, false);
  assert.equal(after.inputs.feeIncreasePct, 2);
  assert.equal(after.result.totalCost, before.result.totalCost);
});

test("query restoration and sharing use the selected model's escalation settings", () => {
  const calc = loadCalculator(
    "?feeModel=hourly&starting_balance=100000&monthly_contribution=500&horizon_years=10" +
      "&annual_return=6&hourly_rate=300&hours_per_year=8&fee_inflation=1&fee_increase_pct=7.5"
  );
  const { elements } = calc;

  assert.equal(calc.lastCall().inputs.feeModel, "hourly");
  assert.equal(calc.lastCall().inputs.feeInflationOn, true);
  assert.equal(calc.lastCall().inputs.feeIncreasePct, 7.5);

  elements.fee_increase_pct.value = "19";
  elements.fee_inflation_on.checked = false;
  elements.fee_increase_pct_hourly.value = "4.25";
  elements.fee_increase_pct_hourly.dispatch("input");

  const shared = calc.shareScenario();
  assert.equal(shared.scenario.feeModel, "hourly");
  assert.equal(shared.scenario.fee_inflation, 1);
  assert.equal(shared.scenario.fee_increase_pct, 4.25);
});
