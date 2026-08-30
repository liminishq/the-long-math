/**
 * Advisor fee AUM engine (assets/js/calculator.engine.js) — golden scenarios via VM.
 */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import nunjucks from "nunjucks";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCalculateLongMath() {
  const code = readFileSync(join(__dirname, "..", "assets", "js", "calculator.engine.js"), "utf8");
  const sandbox = { window: {} };
  runInNewContext(code, sandbox);
  const fn = sandbox.window.calculateLongMath;
  assert.equal(typeof fn, "function");
  return fn;
}

const calculateLongMath = loadCalculateLongMath();

function loadAdvisorUi(lang, search = "") {
  const code = readFileSync(join(__dirname, "..", "assets", "js", "calculator.ui.js"), "utf8");
  const ids = [
    "starting_balance",
    "monthly_contribution",
    "horizon_years",
    "annual_return",
    "annual_return_slider",
    "annual_return_label",
    "use_default_fee",
    "custom_advisor_fee",
    "include_mer",
    "mer_pct",
    "preset-starting",
    "preset-mid",
    "preset-retire",
    "advisor_calc_engine_error",
    "shared_scenario_banner",
    "out_with",
    "out_without",
    "out_fees",
    "out_lost",
    "out_total_cost",
    "out_breakeven",
    "share_result_btn",
    "download_result_btn",
    "copy_result_link_btn",
    "result_share_status",
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id,
        value: "",
        checked: id === "use_default_fee" || id === "include_mer",
        disabled: false,
        hidden: false,
        textContent: "",
        style: {},
        listeners: {},
        classList: { add() {} },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },
      },
    ])
  );
  elements.starting_balance.value = "1000000";
  elements.monthly_contribution.value = "5000";
  elements.horizon_years.value = "15";
  elements.annual_return.value = "7";
  const shareBlock = { classList: { add() {} } };
  const renderedInputs = [];
  let shareWiring = null;
  const document = {
    documentElement: {
      lang,
      getAttribute(name) {
        return name === "lang" ? lang : null;
      },
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      return selector === ".result-share-block" ? shareBlock : null;
    },
  };
  const sandbox = {
    URLSearchParams,
    document,
    window: {
      document,
      location: {
        search,
        href: `https://thelongmath.com/${lang === "fr" ? "fr/" : ""}calculators/advisor-fee/${search}`,
        pathname: `/${lang === "fr" ? "fr/" : ""}calculators/advisor-fee/`,
      },
      TLM: {
        i18n: { getLang: () => lang },
        shareCard: {
          wireCalculatorShare(slug, getBundle) {
            shareWiring = { slug, getBundle };
          },
          track() {},
        },
      },
      calculateLongMath(inputs) {
        renderedInputs.push({ ...inputs });
        return {
          ending_with_advisor: 1,
          ending_without_advisor: 2,
          fees_paid: 3,
          lost_compounding: 4,
          total_calculated_cost: 7,
          break_even_return: 0.08,
        };
      },
    },
  };

  runInNewContext(code, sandbox);

  return {
    elements,
    latestInputs() {
      return renderedInputs.at(-1);
    },
    renderRates({ annualReturn, advisorFee, mer }) {
      elements.annual_return.value = annualReturn;
      elements.custom_advisor_fee.value = advisorFee;
      elements.mer_pct.value = mer;
      elements.use_default_fee.checked = false;
      elements.include_mer.checked = true;
      elements.annual_return.listeners.input();
      return renderedInputs.at(-1);
    },
    shareWiring() {
      return shareWiring;
    },
  };
}

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

test("default tiered schedule uses blended marginal fees (not single rate on full balance)", () => {
  const marginalAnnualIfHeldConstant =
    250_000 * 0.02 + 250_000 * 0.0175 + 250_000 * 0.015;
  const wrongFlatOnEntireBalanceAtTopMarginalRate = 750_000 * 0.015;

  const r = calculateLongMath({
    starting_balance: 750_000,
    monthly_contribution: 0,
    horizon_years: 1,
    annual_return: 0,
    use_default_fee: true,
    custom_advisor_fee_pct: 1,
    include_mer: false,
    mer_pct: 0,
  });
  // Monthly fee drag reduces AUM slightly each month, so twelve months sum < one year at the initial blended rate.
  assert.ok(r.fees_paid < marginalAnnualIfHeldConstant);
  assert.ok(r.fees_paid > wrongFlatOnEntireBalanceAtTopMarginalRate);
});

test("advisor UI parses decimal rates using the active locale", () => {
  const fr = loadAdvisorUi("fr");
  const frInputs = fr.renderRates({ annualReturn: "4,5", advisorFee: "1,0", mer: "0,75" });
  assert.equal(frInputs.annual_return, 0.045);
  assert.equal(frInputs.custom_advisor_fee_pct, 1);
  assert.equal(frInputs.mer_pct, 0.75);

  const en = loadAdvisorUi("en");
  const enInputs = en.renderRates({ annualReturn: "4.5", advisorFee: "1.0", mer: "0.75" });
  assert.equal(enInputs.annual_return, 0.045);
  assert.equal(enInputs.custom_advisor_fee_pct, 1);
  assert.equal(enInputs.mer_pct, 0.75);
});

test("advisor UI rejects ambiguous thousands separators", () => {
  const en = loadAdvisorUi("en");
  const enInputs = en.renderRates({ annualReturn: "4,500", advisorFee: "2,500", mer: "0,750" });
  assert.equal(enInputs.annual_return, 0);
  assert.equal(enInputs.custom_advisor_fee_pct, 1);
  assert.equal(enInputs.mer_pct, 2);

  const fr = loadAdvisorUi("fr");
  const frInputs = fr.renderRates({ annualReturn: "4.500", advisorFee: "2.500", mer: "0.750" });
  assert.equal(frInputs.annual_return, 0);
  assert.equal(frInputs.custom_advisor_fee_pct, 1);
  assert.equal(frInputs.mer_pct, 2);
});

test("French advisor UI keeps shared URL numbers canonical and displays comma decimals", () => {
  const ui = loadAdvisorUi(
    "fr",
    "?return=4.5&fee=1.0&mer=0.75&useDefaultFee=0&includeMer=1"
  );
  assert.equal(ui.elements.annual_return.value, "4,5");
  assert.equal(ui.elements.custom_advisor_fee.value, "1");
  assert.equal(ui.elements.mer_pct.value, "0,75");
  assert.equal(ui.latestInputs().annual_return, 0.045);
  assert.equal(ui.latestInputs().custom_advisor_fee_pct, 1);
  assert.equal(ui.latestInputs().mer_pct, 0.75);
  assert.equal(ui.shareWiring().slug, "advisor-fee");
  assert.deepEqual(
    { ...ui.shareWiring().getBundle().scenario },
    {
      initial: 1_000_000,
      monthly: 5_000,
      annual: 60_000,
      years: 15,
      return: 4.5,
      useDefaultFee: 0,
      fee: 1,
      includeMer: 1,
      mer: 0.75,
    }
  );
});

test("generated EN and FR advisor pages load shared controls before advisor UI", () => {
  const templates = nunjucks.configure(join(__dirname, "..", "build", "templates"), {
    autoescape: true,
    noCache: true,
  });

  for (const lang of ["en", "fr"]) {
    const html = templates.render("pages/advisor-fee.njk", {
      htmlLang: lang,
      title: "Advisor fee calculator",
      description: "Test",
      canonical: "https://example.test/",
      hreflangLinks: [],
      lang,
      t: (key) => key,
      localizeRootHref: (href) => (lang === "fr" ? "/fr" : "") + href,
      dataFeeCalcLayout: true,
    });
    const scripts = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (match) => match[1]);
    assert.equal(scripts.filter((src) => src === "/assets/js/calculator-share.js").length, 1);
    assert.ok(
      scripts.indexOf("/assets/js/calculator-share.js") <
        scripts.indexOf("/assets/js/calculator.ui.js")
    );
  }

  const uiSource = readFileSync(
    join(__dirname, "..", "assets", "js", "calculator.ui.js"),
    "utf8"
  );
  assert.match(uiSource, /wireCalculatorShare\("advisor-fee"/);
  assert.doesNotMatch(uiSource, /\.shareResultCard\(|\.downloadResultCard\(|\.copyResultLink\(/);
});
