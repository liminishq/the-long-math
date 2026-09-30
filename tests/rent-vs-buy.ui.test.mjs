import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const uiCode = readFileSync(
  join(root, "calculators", "rent-vs-buy", "ui.js"),
  "utf8"
);
const html = readFileSync(
  join(root, "calculators", "rent-vs-buy", "index.html"),
  "utf8"
);

function loadUiHelpers(docOverrides) {
  const sandbox = {
    window: {},
    document: Object.assign(
      {
        readyState: "complete",
        addEventListener: function () {},
        getElementById: function () {
          return null;
        },
        querySelector: function () {
          return null;
        },
        querySelectorAll: function () {
          return [];
        },
      },
      docOverrides || {}
    ),
    console,
    URLSearchParams,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    parseInt,
    parseFloat,
    isFinite,
    Infinity,
    NaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  runInNewContext(uiCode, sandbox);
  return sandbox.window.RentVsBuyUi;
}

function loadEngine() {
  const ctx = {
    console,
    Math,
    Number,
    Array,
    Object,
    JSON,
    Date,
    String,
    isFinite,
    parseInt,
    parseFloat,
    Infinity,
    NaN,
  };
  ctx.globalThis = ctx;
  runInNewContext(
    readFileSync(join(root, "assets/js/investment-growth.engine.js"), "utf8"),
    ctx
  );
  runInNewContext(
    readFileSync(
      join(root, "calculators/mortgage-calculator/mortgage-engine.js"),
      "utf8"
    ),
    ctx
  );
  runInNewContext(
    readFileSync(
      join(root, "assets/js/mortgage-loan-insurance.canada.js"),
      "utf8"
    ),
    ctx
  );
  runInNewContext(
    readFileSync(join(root, "calculators/rent-vs-buy/engine.js"), "utf8"),
    ctx
  );
  return ctx;
}

const defaultInputs = {
  purchasePrice: 500000,
  downPayment: 100000,
  startingCapital: 120000,
  closingCosts: 5000,
  mortgageRatePct: 5,
  amortizationYears: 25,
  mortgageInsuranceMode: "automatic_canadian",
  insuranceProvince: "none",
  financeInsurancePremium: true,
  thirtyYearEligibility: "neither",
  sellingCostPercent: 0.05,
  sellingCostFixed: 0,
  propertyTaxAnnual: 4000,
  propertyTaxUseInflation: true,
  maintenanceAnnual: 5000,
  homeInsuranceAnnual: 1500,
  condoFeesMonthly: 0,
  ownerUtilitiesMonthly: 250,
  ownerUtilitiesUseInflation: true,
  ownerOtherExpenses: [],
  monthlyRent: 2200,
  rentGrowthAnnual: 0.02,
  tenantInsuranceAnnual: 300,
  renterUtilitiesMonthly: 100,
  renterUtilitiesUseInflation: true,
  renterOtherExpenses: [],
  investmentReturnAnnual: 0.06,
  investCashFlowDifference: true,
  inflationAnnual: 0.02,
  homeAppreciationMode: "nominal",
  homeAppreciationAnnual: 0.03,
  comparisonYear: 10,
};

test("insuranceVisibility: 20%+ down hides CMHC controls in Automatic Canadian", () => {
  const ui = loadUiHelpers();
  const vis = ui.insuranceVisibility({
    mode: "automatic_canadian",
    downPaymentPercent: 20,
    amortizationYears: 25,
    premiumExists: false,
  });
  assert.equal(vis.showNotRequired, true);
  assert.equal(vis.showCanadianBlock, false);
  assert.equal(vis.showProvince, false);
  assert.equal(vis.showThirtyYear, false);
  assert.equal(vis.showFinance, false);
  assert.equal(vis.showCustom, false);
});

test("insuranceVisibility: below 20% reveals CMHC; 30y only when amort > 25", () => {
  const ui = loadUiHelpers();
  const vis25 = ui.insuranceVisibility({
    mode: "automatic_canadian",
    downPaymentPercent: 5,
    amortizationYears: 25,
    premiumExists: true,
  });
  assert.equal(vis25.showCanadianBlock, true);
  assert.equal(vis25.showProvince, true);
  assert.equal(vis25.showThirtyYear, false);
  assert.equal(vis25.showFinance, true);

  const vis30 = ui.insuranceVisibility({
    mode: "automatic_canadian",
    downPaymentPercent: 5,
    amortizationYears: 30,
    premiumExists: true,
  });
  assert.equal(vis30.showThirtyYear, true);
});

test("insuranceVisibility: custom mode shows only custom fields", () => {
  const ui = loadUiHelpers();
  const vis = ui.insuranceVisibility({
    mode: "custom",
    downPaymentPercent: 5,
    amortizationYears: 30,
    premiumExists: true,
  });
  assert.equal(vis.showCustom, true);
  assert.equal(vis.showCanadianBlock, false);
  assert.equal(vis.showNotRequired, false);
  assert.equal(vis.showFinance, false);
});

test("insuranceVisibility: none mode hides insurance specialty controls", () => {
  const ui = loadUiHelpers();
  const vis = ui.insuranceVisibility({
    mode: "none",
    downPaymentPercent: 5,
    amortizationYears: 30,
  });
  assert.equal(vis.showCustom, false);
  assert.equal(vis.showCanadianBlock, false);
  assert.equal(vis.showNotRequired, false);
});

test("defaultChartHorizonYears follows comparison-year rule", () => {
  const ui = loadUiHelpers();
  assert.equal(ui.defaultChartHorizonYears(10), 10);
  assert.equal(ui.defaultChartHorizonYears(25), 25);
  assert.equal(ui.defaultChartHorizonYears(30), 60);
  assert.equal(ui.defaultChartHorizonYears(40), 60);
  assert.equal(ui.MAX_OTHER_EXPENSES >= 3, true);
});

test("breakEvenHomeTitle reflects appreciation mode", () => {
  const ui = loadUiHelpers();
  assert.equal(
    ui.breakEvenHomeTitle("nominal"),
    "Break-even nominal home appreciation"
  );
  assert.equal(
    ui.breakEvenHomeTitle("real_linked"),
    "Break-even real home appreciation above inflation"
  );
});

test("sortSnapshotsChronologically places mortgage payoff before later years", () => {
  const ui = loadUiHelpers();
  const sorted = ui.sortSnapshotsChronologically([
    { label: "Year 5", month: 60, year: 5 },
    { label: "Year 10", month: 120, year: 10 },
    { label: "Year 20", month: 240, year: 20 },
    { label: "Year 30", month: 360, year: 30 },
    {
      label: "Mortgage payoff — final payment",
      month: 300,
      year: 25,
      isPayoff: true,
    },
  ]);
  assert.deepEqual(
    sorted.map((s) => s.label),
    [
      "Year 5",
      "Year 10",
      "Year 20",
      "Mortgage payoff — final payment",
      "Year 30",
    ]
  );
});

test("ensureComparisonSnapshot inserts selected year chronologically", () => {
  const ui = loadUiHelpers();
  const series = [];
  for (let m = 0; m <= 360; m += 1) {
    series[m] = {
      month: m,
      buyerNetWorth: m,
      renterNetWorth: m + 1,
      difference: -1,
    };
  }
  const snaps = ui.ensureComparisonSnapshot({
    comparisonYear: 15,
    series,
    snapshots: [
      { label: "Year 5", month: 60, year: 5 },
      { label: "Year 10", month: 120, year: 10 },
      { label: "Year 20", month: 240, year: 20 },
      { label: "Year 30", month: 360, year: 30 },
      {
        label: "Mortgage payoff — final payment",
        month: 300,
        year: 25,
        isPayoff: true,
      },
    ],
  });
  assert.equal(snaps[2].year, 15);
  assert.equal(snaps[2].isComparison, true);
  assert.equal(snaps[3].year, 20);
  assert.equal(snaps[4].isPayoff, true);
});

test("renderInvestmentBreakEven shows Recalculating while pending", () => {
  const els = {
    be_invest_value: {
      textContent: "6.0% / year",
      classList: {
        add: function () {
          this._pending = true;
        },
        remove: function () {
          this._pending = false;
        },
      },
    },
    be_invest_line: { textContent: "old" },
    be_invest_title: { textContent: "Break-even investment return" },
  };
  const ui = loadUiHelpers({
    getElementById: function (id) {
      return els[id] || null;
    },
  });
  ui.renderInvestmentBreakEven({ pending: true }, 10);
  assert.equal(els.be_invest_value.textContent, "Recalculating…");
  assert.match(els.be_invest_line.textContent, /Updating|Recalculating|current/i);
});

test("markup: comparison year and real/nominal live in summary controls", () => {
  const coreIdx = html.indexOf('id="core_heading"');
  const summaryIdx = html.indexOf('id="summary_controls"');
  const cmpIdx = html.indexOf('id="comparison_year"');
  const realIdx = html.indexOf('id="display_real"');
  const nominalIdx = html.indexOf('id="display_nominal"');
  assert.ok(summaryIdx > coreIdx);
  assert.ok(cmpIdx > summaryIdx);
  assert.ok(realIdx > summaryIdx);
  assert.ok(nominalIdx > summaryIdx);
  // Comparison year must not remain in the core input column.
  const coreEnd = html.indexOf("</article>", coreIdx);
  assert.ok(cmpIdx > coreEnd);
});

test("markup: current monthly cash precedes compare-at; net-worth follows", () => {
  const cashIdx = html.indexOf('id="card_cash"');
  const summaryIdx = html.indexOf('id="summary_controls"');
  const nwIdx = html.indexOf('id="card_nw"');
  assert.ok(cashIdx > 0 && summaryIdx > cashIdx && nwIdx > summaryIdx);
  assert.match(html, /Monthly cash required today/);
  assert.match(html, /Projected monthly cash at year/);
  assert.doesNotMatch(html, /<h3 class="summary-card-title">Monthly cash required<\/h3>/);
});

test("markup: refinement details start collapsed; no duplicate snapshot composition", () => {
  assert.match(html, /id="refine_ownership"/);
  assert.doesNotMatch(html, /id="refine_ownership"[^>]*\sopen\b/);
  assert.doesNotMatch(html, /id="refine_rental"[^>]*\sopen\b/);
  assert.doesNotMatch(html, /id="refine_advanced"[^>]*\sopen\b/);
  assert.doesNotMatch(html, /snapshot_inspect/);
  assert.doesNotMatch(html, /Inspect selected comparison-year composition/);
  assert.match(html, /Difference/);
  assert.doesNotMatch(html, /Buyer − renter/);
});

test("markup: dynamic break-even home title element exists", () => {
  assert.match(html, /id="be_home_title"/);
  assert.match(html, /Break-even nominal home appreciation/);
});

test("markup: nominal investment history is expandable and lead title updated", () => {
  assert.match(html, /Nominal investment-account history/);
  assert.match(html, /id="buyer_invest_history_dl"/);
  assert.match(html, /id="renter_invest_history_dl"/);
  assert.match(html, /Net-worth lead over time/);
  assert.doesNotMatch(html, /Net-worth lead changes/);
  assert.match(html, /id="ownership_summary"/);
  assert.match(html, /id="rental_summary"/);
});

test("refinement active-value summaries use current field values", () => {
  const fields = {
    property_tax: { value: "4500" },
    maintenance: { value: "6000" },
    home_insurance: { value: "1600" },
    owner_utilities: { value: "275" },
    selling_cost_pct: { value: "4.5" },
    tenant_insurance: { value: "350" },
    renter_utilities: { value: "120" },
    renter_upfront: { value: "1500" },
  };
  const ui = loadUiHelpers({
    getElementById: function (id) {
      return fields[id] || null;
    },
  });
  assert.match(ui.ownershipActiveSummary(), /Tax/);
  assert.match(ui.ownershipActiveSummary(), /4,?500/);
  assert.match(ui.ownershipActiveSummary(), /Upkeep/);
  assert.match(ui.ownershipActiveSummary(), /Sale 4\.5%/);
  assert.match(ui.rentalActiveSummary(), /Insurance/);
  assert.match(ui.rentalActiveSummary(), /Upfront/);
  assert.match(ui.rentalActiveSummary(), /1,?500/);
});

test("applySharedScenarioFromQuery restores core financial fields from query string", () => {
  const fields = {
    starting_capital: { value: "120000", type: "number", tagName: "INPUT" },
    purchase_price: { value: "500000", type: "number", tagName: "INPUT" },
    mortgage_rate: { value: "5", type: "number", tagName: "INPUT" },
    monthly_rent: { value: "2200", type: "number", tagName: "INPUT" },
    renter_upfront: { value: "0", type: "number", tagName: "INPUT" },
    comparison_year: { value: "10", type: "number", tagName: "INPUT" },
    investment_return: { value: "6", type: "number", tagName: "INPUT" },
    invest_cf_diff: { checked: true, type: "checkbox", tagName: "INPUT" },
    appr_nominal: { checked: true, type: "radio", tagName: "INPUT", name: "appr_mode" },
    appr_real: { checked: false, type: "radio", tagName: "INPUT", name: "appr_mode" },
    display_nominal: { checked: true, type: "radio", tagName: "INPUT", name: "display_basis" },
    display_real: { checked: false, type: "radio", tagName: "INPUT", name: "display_basis" },
    maintenance: { value: "5000", type: "number", tagName: "INPUT" },
    down_use_pct: { checked: false, type: "checkbox", tagName: "INPUT" },
    down_payment: { value: "100000", type: "number", tagName: "INPUT" },
    down_pct: { value: "20", type: "number", tagName: "INPUT" },
    down_amount_wrap: { classList: { toggle: function () {}, add: function () {}, remove: function () {} } },
    down_pct_wrap: { classList: { toggle: function () {}, add: function () {}, remove: function () {} } },
    home_appr_nominal_wrap: { classList: { toggle: function () {} } },
    home_appr_real_wrap: { classList: { toggle: function () {} } },
    property_tax_growth_wrap: { classList: { toggle: function () {} } },
    owner_util_growth_wrap: { classList: { toggle: function () {} } },
    renter_util_growth_wrap: { classList: { toggle: function () {} } },
    property_tax_use_inf: { checked: true, type: "checkbox" },
    owner_util_use_inf: { checked: true, type: "checkbox" },
    renter_util_use_inf: { checked: true, type: "checkbox" },
  };
  const ui = loadUiHelpers({
    getElementById: function (id) {
      return fields[id] || null;
    },
    querySelector: function () {
      return fields.appr_nominal;
    },
  });
  const qs =
    "starting_capital=155000&purchase_price=620000&mortgage_rate=4.25&monthly_rent=2650&renter_upfront=2000&comparison_year=28&investment_return=7.5&invest_cf_diff=0&appr_nominal=0&appr_real=1&display_nominal=0&display_real=1&maintenance=7000";
  const res = ui.applySharedScenarioFromQuery(qs);
  assert.equal(res.applied, true);
  assert.equal(fields.starting_capital.value, "155000");
  assert.equal(fields.purchase_price.value, "620000");
  assert.equal(fields.mortgage_rate.value, "4.25");
  assert.equal(fields.monthly_rent.value, "2650");
  assert.equal(fields.renter_upfront.value, "2000");
  assert.equal(fields.comparison_year.value, "28");
  assert.equal(fields.investment_return.value, "7.5");
  assert.equal(fields.invest_cf_diff.checked, false);
  assert.equal(fields.appr_real.checked, true);
  assert.equal(fields.display_real.checked, true);
  assert.equal(fields.maintenance.value, "7000");
});

test("chartRangeMode fixed choice is preserved across comparison-year auto path", () => {
  const ui = loadUiHelpers();
  ui.setChartRangeModeForTests("fixed");
  assert.equal(ui.getChartRangeMode(), "fixed");
  ui.setChartRangeModeForTests("comparison");
  assert.equal(ui.getChartRangeMode(), "comparison");
  ui.setChartRangeModeForTests("auto");
  assert.equal(ui.getChartRangeMode(), "auto");
});

test("Today's-dollars balance sheet reconciles at selected year (display rounding)", () => {
  const ctx = loadEngine();
  const ui = loadUiHelpers();
  const r = ctx.RentVsBuyEngine.calculate(defaultInputs);
  assert.ok(!r.error, r.error);

  const sheet = ui.selectedYearBalanceSheet(r, true);
  assert.equal(sheet.isReal, true);

  // Full-precision identities from the engine's real conversion.
  assert.ok(
    Math.abs(
      sheet.buyer.netRealizableEquity +
        sheet.buyer.investmentAccount -
        sheet.buyer.totalNetWorth
    ) < 1e-6
  );
  assert.ok(
    Math.abs(sheet.renter.investmentAccount - sheet.renter.totalNetWorth) < 1e-6
  );

  const rounded = ui.realBalanceSheetReconciles(sheet, Math.round);
  assert.equal(
    rounded.buyerOk,
    true,
    `buyer ${rounded.buyerEquity} + ${rounded.buyerInvestments} !== ${rounded.buyerNetWorth}`
  );
  assert.equal(
    rounded.renterOk,
    true,
    `renter ${rounded.renterInvestments} !== ${rounded.renterNetWorth}`
  );

  // Nominal history remains nominal cash-accounting and is separate.
  assert.equal(
    sheet.nominalHistory.buyer.investmentAccount,
    r.comparisonPoint.buyerInvestments
  );
  assert.ok(
    Math.abs(sheet.buyer.investmentAccount) <
      Math.abs(r.comparisonPoint.buyerInvestments) ||
      r.inflationAnnual === 0
  );
});

test("nominal balance sheet uses nominal equity, investments, NW, and difference", () => {
  const ctx = loadEngine();
  const ui = loadUiHelpers();
  const r = ctx.RentVsBuyEngine.calculate(defaultInputs);
  const sheet = ui.selectedYearBalanceSheet(r, false);
  assert.equal(sheet.buyer.netRealizableEquity, r.comparisonPoint.netRealizableEquity);
  assert.equal(sheet.buyer.investmentAccount, r.comparisonPoint.buyerInvestments);
  assert.equal(sheet.buyer.totalNetWorth, r.comparisonPoint.buyerNetWorth);
  assert.equal(sheet.renter.investmentAccount, r.comparisonPoint.renterInvestments);
  assert.equal(sheet.renter.totalNetWorth, r.comparisonPoint.renterNetWorth);
  assert.equal(sheet.difference, r.comparisonPoint.difference);
  assert.equal(sheet.ownerCash, r.comparisonPoint.ownerCash);
});

test("ensureComparisonSnapshot merges same-month payoff and selected year", () => {
  const ui = loadUiHelpers();
  const series = [];
  for (let m = 0; m <= 360; m += 1) {
    series[m] = {
      month: m,
      buyerNetWorth: m,
      renterNetWorth: m + 1,
      difference: -1,
    };
  }
  const snaps = ui.ensureComparisonSnapshot({
    comparisonYear: 25,
    series,
    snapshots: [
      { label: "Year 5", month: 60, year: 5 },
      { label: "Year 10", month: 120, year: 10 },
      { label: "Year 20", month: 240, year: 20 },
      { label: "Year 30", month: 360, year: 30 },
      {
        label: "Mortgage payoff — final payment",
        month: 300,
        year: 25,
        isPayoff: true,
      },
    ],
  });
  const at25 = snaps.filter((s) => s.month === 300);
  assert.equal(at25.length, 1);
  assert.equal(at25[0].isPayoff, true);
  assert.equal(at25[0].isComparison, true);
  assert.match(at25[0].label, /Mortgage payoff/);
  assert.match(at25[0].label, /selected|Year 25/i);
});

test("before/after UX refactor: default scenario financial outputs unchanged", () => {
  const ctx = loadEngine();
  const r = ctx.RentVsBuyEngine.calculate(defaultInputs);

  assert.ok(!r.error, r.error);
  assert.ok(Math.abs(r.month0Cash.owner - 3451.4199401480623) < 1e-6);
  assert.equal(r.month0Cash.renter, 2325);
  assert.ok(Math.abs(r.comparisonPoint.buyerNetWorth - 370038.4164879321) < 1e-4);
  assert.ok(Math.abs(r.comparisonPoint.renterNetWorth - 379150.6375427458) < 1e-4);
  assert.equal(r.crossover.kind, "renter_always");
  assert.ok(Number.isFinite(r.breakEvenHomeAppreciation.rate));
  assert.ok(Math.abs(r.breakEvenHomeAppreciation.rate - 0.03146104812622069) < 1e-9);
  assert.ok(Number.isFinite(r.breakEvenInvestmentReturn.rate));
  assert.ok(r.breakEvenInvestmentReturn.roots.length >= 1);

  const atBe = ctx.RentVsBuyEngine.simulate(
    Object.assign({}, defaultInputs, {
      investmentReturnAnnual: r.breakEvenInvestmentReturn.rate,
    })
  );
  assert.ok(Math.abs(atBe.series[120].difference) <= 1);

  const realBuy = r.toRealPoint(r.comparisonPoint).buyerNetWorth;
  const realRent = r.toRealPoint(r.comparisonPoint).renterNetWorth;
  assert.ok(Number.isFinite(realBuy) && Number.isFinite(realRent));
  assert.ok(realBuy < r.comparisonPoint.buyerNetWorth);
});
