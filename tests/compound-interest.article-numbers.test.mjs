import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = 10000;
const r = 0.08;

function compound(t, rate = r, n = 1) {
  return P * Math.pow(1 + rate / n, n * t);
}

function simple(t) {
  return P * (1 + r * t);
}

function round$(n) {
  return Math.round(n);
}

test("compound interest reference values match the article's rounding", () => {
  const table = { 0: 10000, 1: 10800, 2: 11664, 5: 14693, 10: 21589, 20: 46610, 25: 68485, 30: 100627, 40: 217245 };
  for (const [year, expected] of Object.entries(table)) {
    assert.equal(round$(compound(Number(year))), expected);
  }
  assert.equal(round$(simple(10)), 18000);
  assert.equal(round$(simple(20)), 26000);
  assert.equal(round$(simple(30)), 34000);
  assert.equal(round$(compound(29) * r), 7454);
  assert.equal(round$(compound(20)) - 10000, 36610);
  assert.equal(round$(compound(30)) - round$(compound(20)), 54017);
  assert.equal(round$(compound(40)) - round$(compound(30)), 116618);
  assert.equal(round$(compound(30)) - round$(compound(25)), 32142);
  assert.equal(round$(compound(30, 0.07)), 76123);
  assert.equal(round$(compound(30)) - round$(compound(30, 0.07)), 24504);
  assert.equal(round$(compound(1, r, 12)), 10830);
  assert.equal(round$(compound(30, r, 2)), 105196);
  assert.equal(round$(compound(30, r, 12)), 109357);
  assert.equal(round$(compound(30, r, 12)) - round$(compound(30)), 8730);
  assert.equal(Number(((Math.pow(1 + r / 12, 12) - 1) * 100).toFixed(2)), 8.3);
  assert.equal(Number((Math.log(2) / Math.log(1.08)).toFixed(3)), 9.006);
  assert.equal(round$(compound(9)), 19990);
  assert.equal(round$(100 * Math.pow(1.03, 30)), 243);
  assert.equal(round$(100 / Math.pow(1.03, 30)), 41);
  assert.equal(100 * 1.2 * 0.8, 96);
  assert.equal(Math.round(11664 * 108) / 100, 12597.12);
  assert.equal(Math.round(11664 * 8) / 100, 933.12);
  assert.equal(Math.round((11.8 / 0.95) * 10) / 10, 12.4);
  assert.ok(Math.abs(0.124 * Math.pow(1.03, 100) - 2.4) < 0.03);
  assert.ok(Math.abs(6.99 / 4 - 1.75) < 0.01);
  assert.ok(Math.abs(5.49 / 2 - 2.75) < 0.01);
});

test("published article text and chart use the 8% / $10,000 series", () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/i18n/en/articles/compound-interest.json"), "utf8"));
  const fr = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/i18n/fr/articles/compound-interest.json"), "utf8"));
  const html = en.wrapMainHtml;
  const frHtml = fr.wrapMainHtml;

  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.equal((frHtml.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /Compound Interest Explained: How Money Grows Over Time/);
  assert.match(frHtml, /L'intérêt composé expliqué : comment l'argent croît avec le temps/);

  for (const amount of ["$10,800", "$11,664", "$12,597.12", "$933.12", "$14,693", "$21,589", "$46,610", "$68,485", "$100,627", "$217,245", "$34,000", "$18,000", "$26,000", "$7,454", "$36,610", "$116,618", "$54,017", "$32,142", "$76,123", "$24,504", "$10,830", "$105,196", "$109,357", "$8,730", "$19,990", "$243", "$1.75", "$2.75", "11.8 cents"]) {
    assert.ok(html.includes(amount), amount);
  }
  assert.match(html, /8\.30%/);
  assert.match(html, /9\.006 years/);
  assert.doesNotMatch(html, /Rebuild the existing|\$1,000|9% annual|\[Link:/);

  const left = 88;
  const right = 424;
  const top = 14;
  const bottom = 228;
  const yMax = 110000;
  const yOf = (v) => (bottom - (v / yMax) * (bottom - top)).toFixed(1);
  assert.ok(html.includes(`L${right.toFixed(1)} ${yOf(compound(30))}`));
  assert.ok(html.includes(`L${right.toFixed(1)} ${yOf(simple(30))}`));
  assert.ok(html.includes(`M${left.toFixed(1)} ${yOf(P)}`));
  assert.match(frHtml, /100 627 \$/);
  assert.match(frHtml, /34 000 \$/);
  assert.ok(frHtml.includes(`L${right.toFixed(1)} ${yOf(compound(30))}`));

  const links = [
    "articles/investing-and-financial-literacy/why-start-investing-early/index.html",
    "articles/investing-and-financial-literacy/what-is-a-tfsa/index.html",
    "articles/investing-and-financial-literacy/what-is-an-rrsp/index.html",
    "articles/investing-and-financial-literacy/capital-gains-vs-dividends-vs-interest-tax-canada/index.html",
    "articles/investing-and-financial-literacy/what-is-investing/index.html",
    "articles/investing-and-financial-literacy/inflation/index.html",
    "calculators/cost-of-waiting-to-invest/index.html",
    "calculators/fee-cost-1percent/index.html",
    "calculators/investment-simple/index.html",
    "calculators/compound-multipliers/index.html",
    "calculators/inflation-time-machine/index.html",
    "articles/investing-and-financial-literacy/sequence-of-returns-risk/index.html",
    "fr/articles/investing-and-financial-literacy/gains-en-capital-dividendes-interets-impot-canada/index.html",
    "fr/calculators/cost-of-waiting-to-invest/index.html",
  ];
  for (const rel of links) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
  }
  assert.match(html, /sequence-of-returns-risk\//);
  assert.match(frHtml, /12 597,12/);
  assert.match(frHtml, /1,75 \$/);
  assert.match(html, /capital-gains-vs-dividends-vs-interest-tax-canada\//);
  assert.match(frHtml, /gains-en-capital-dividendes-interets-impot-canada\//);
  assert.equal(en.faq.length, 7);
  assert.equal(fr.faq.length, 7);
  for (const item of en.faq) {
    assert.ok(html.includes(item.question), item.question);
  }
});
