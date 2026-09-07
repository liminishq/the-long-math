import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { computeCostOfWaiting, monthlyRateFromEffectiveAnnual } from "../calculators/cost-of-waiting-to-invest/engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EN_JSON = path.join(ROOT, "assets/i18n/en/articles/why-start-investing-early.json");
const FR_JSON = path.join(ROOT, "assets/i18n/fr/articles/why-start-investing-early.json");

function assertApprox(actual, expected, tol, label) {
  assert.ok(Number.isFinite(actual), `${label}: expected finite, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected}, got ${actual} (tol ${tol})`
  );
}

const DEFAULTS = {
  earlyStartAge: 25,
  earlyStopAge: 35,
  laterStartAge: 35,
  retirementAge: 65,
  monthlyContribution: 400,
  annualReturn: 0.08
};

test("article numbers lock to cost-of-waiting engine (effective annual → monthly, not /12)", () => {
  const rm = monthlyRateFromEffectiveAnnual(0.08);
  assert.notEqual(rm, 0.08 / 12);
  assertApprox(rm, Math.pow(1.08, 1 / 12) - 1, 1e-15, "monthly rate");

  const result = computeCostOfWaiting(DEFAULTS);
  assert.equal(result.ok, true);

  assert.equal(result.early.totalContributed, 48000);
  assert.equal(result.later.totalContributed, 144000);
  assert.equal(result.later.totalContributed - result.early.totalContributed, 96000);
  assert.equal(result.continued.totalContributed, 192000);

  assertApprox(result.early.valueAtStop, 72049.70927760625, 1e-6, "A at 35");
  assertApprox(result.early.valueAtRetirement, 725011.5034180358, 1e-6, "A at 65");
  assertApprox(result.later.valueAtRetirement, 563420.2348529891, 1e-6, "B at 65");
  assertApprox(
    result.early.valueAtRetirement - result.later.valueAtRetirement,
    161591.26856504672,
    1e-6,
    "difference at 65"
  );
  assertApprox(result.catchUpReturn.annualReturn, 0.09328564686796209, 1e-12, "catch-up return");
  assertApprox(result.catchUpReturn.delta, 0.01328564686796209, 1e-12, "catch-up delta");
  assertApprox(result.catchUpContribution.monthlyContribution, 514.7216649804635, 1e-9, "catch-up monthly");
  assertApprox(result.catchUpContribution.monthlyContribution * 12 * 30, 185299.79939296686, 1e-6, "catch-up total contributed");
  assertApprox(result.early.valueAtRetirement - 48000, 677011.5034180358, 1e-6, "A growth");
  assertApprox(result.continued.valueAtRetirement, 1288431.738271025, 1e-6, "continued");

  const pctFv = result.early.valueAtRetirement / result.later.valueAtRetirement - 1;
  const pctPay = result.catchUpContribution.monthlyContribution / 400 - 1;
  assertApprox(pctFv, 0.2868041624511588, 1e-12, "29% portfolio");
  assertApprox(pctPay, pctFv, 1e-12, "29% contribution matches 29% portfolio");
  assert.equal(Math.round(pctFv * 100), 29);
  assert.equal(Math.round(result.catchUpContribution.monthlyContribution), 515);
  assertApprox(result.catchUpReturn.annualReturn * 100, 9.33, 0.005, "9.33% display");
});

test("6% caveat: later investor finishes slightly ahead", () => {
  const result = computeCostOfWaiting({ ...DEFAULTS, annualReturn: 0.06 });
  assert.equal(result.ok, true);
  assert.ok(result.later.valueAtRetirement > result.early.valueAtRetirement);
  assertApprox(result.early.valueAtRetirement, 373265.912966849, 1e-6, "A at 6%");
  assertApprox(result.later.valueAtRetirement, 389805.1892207897, 1e-6, "B at 6%");
});

test("EN/FR article copy contains the displayed rounded figures and rejects annual/12", () => {
  const en = JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
  const fr = JSON.parse(fs.readFileSync(FR_JSON, "utf8"));
  const enHtml = en.wrapMainHtml;
  const frHtml = fr.wrapMainHtml;

  for (const needle of ["$72,050", "$725,000", "$563,000", "$162,000", "9.33%", "$515", "29%", "$1.29 million", "$192,000", "$185,000", "$677,000"]) {
    assert.ok(enHtml.includes(needle), `EN missing ${needle}`);
  }
  for (const needle of ["72 050 $", "725 000 $", "563 000 $", "162 000 $", "9,33 %", "515 $", "29 %", "1,29 million", "192 000 $", "185 000 $", "677 000 $"]) {
    assert.ok(frHtml.includes(needle), `FR missing ${needle}`);
  }

  assert.match(enHtml, /not 8% divided by 12|not 8% \/ 12/);
  assert.match(frHtml, /pas 8 % divisé par 12|non 8 % \/ 12/);
  assert.equal(enHtml.includes("0.08 / 12"), false);
  assert.equal(en.meta.robots, undefined);
  assert.equal(fr.meta.robots, undefined);
  assert.equal(en.meta.datePublished, "2026-09-07");
  assert.equal(en.meta.dateModified, "2026-09-07");
  assert.equal(en.meta.articleModified, "September 2026");
  assert.ok(enHtml.includes("Last updated September 2026"));
  assert.ok(frHtml.includes("Mis à jour en septembre 2026"));
  assert.equal(enHtml.includes("Draft — not yet published"), false);
  assert.equal(en.meta.ogTitle, "What Is a 10-Year Investing Head Start Worth?");
  assert.equal(en.faq.length, 5);
  assert.equal(fr.faq.length, 5);
  assert.equal(en.faq[0].question, "Why is starting to invest early so important?");
  assert.ok(enHtml.includes(en.faq[0].question));
  assert.ok(frHtml.includes(fr.faq[0].question));
  assert.equal(enHtml.includes("TODO"), false);
  assert.equal(enHtml.includes("needs confirmation"), false);
});

test("published article is on live discovery surfaces", () => {
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const search = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/search-index.json"), "utf8"));
  const hubEn = fs.readFileSync(
    path.join(ROOT, "assets/i18n/en/articles/investing-and-financial-literacy-index.json"),
    "utf8"
  );
  const hubFr = fs.readFileSync(
    path.join(ROOT, "assets/i18n/fr/articles/investing-and-financial-literacy-index.json"),
    "utf8"
  );
  const needle = "why-start-investing-early";
  assert.ok(sitemap.includes(`https://www.thelongmath.com/articles/investing-and-financial-literacy/${needle}/`));
  assert.ok(sitemap.includes(`https://www.thelongmath.com/fr/articles/investing-and-financial-literacy/${needle}/`));
  assert.ok(search.some((entry) => entry.url === `/articles/investing-and-financial-literacy/${needle}/`));
  assert.ok(hubEn.includes(`/articles/investing-and-financial-literacy/${needle}/`));
  assert.ok(hubFr.includes(`/articles/investing-and-financial-literacy/${needle}/`));
});
