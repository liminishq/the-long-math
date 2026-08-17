import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  findArticleCalloutInsertIndex,
  findCalculatorArticleCalloutInsertIndex,
  injectCalculatorCallout,
  injectArticleCalloutOnCalculator,
  normalizeCallout,
  normalizeArticleCallout,
  articleDisplayName,
} = require("../build/lib/article-calc-callout.js");

const t = (key) =>
  ({
    "common.calculatorCallout.heading": "Ready to run your own numbers?",
    "common.calculatorCallout.lead": "Try the {name}.",
    "common.articleCallout.heading": "Want the walkthrough?",
    "common.articleCallout.lead": "Read {name}.",
  })[key] || key;

test("rejects incomplete or off-site callouts", () => {
  assert.equal(normalizeCallout(null), null);
  assert.equal(normalizeCallout({ href: "/articles/x/", calculatorName: "X" }), null);
  assert.equal(normalizeCallout({ href: "https://example.com/calculators/x/", calculatorName: "X" }), null);
  assert.ok(normalizeCallout({ href: "/calculators/tfsa-room/", calculatorName: "TFSA Room" }));
});

test("inserts before FAQ, not after it", () => {
  const html = `<article>
<section class="copy"><p>Last sentence.</p></section>
<section class="section-card" id="faq"><h2>Frequently Asked Questions</h2></section>
</article>`;
  const out = injectCalculatorCallout(
    html,
    { href: "/calculators/tfsa-room/", calculatorName: "TFSA Contribution Room Calculator" },
    { t }
  );
  const calloutAt = out.indexOf("article-calc-callout");
  const faqAt = out.indexOf('id="faq"');
  assert.ok(calloutAt > 0 && calloutAt < faqAt);
  assert.match(out, /Ready to run your own numbers\?/);
  assert.match(out, /href="\/calculators\/tfsa-room\/"/);
});

test("inserts before related reading when there is no FAQ", () => {
  const html = `<article>
<p>End of copy.</p>
<section class="section-card related-articles"><h2>Related</h2></section>
</article>`;
  const idx = findArticleCalloutInsertIndex(html);
  assert.ok(html.slice(idx).startsWith("<section class=\"section-card related-articles\""));
});

test("does not inject twice", () => {
  const html = `<article><aside class="article-calc-callout"></aside><section id="faq"></section></article>`;
  const out = injectCalculatorCallout(
    html,
    { href: "/calculators/tfsa-room/", calculatorName: "TFSA Room" },
    { t }
  );
  assert.equal(out, html);
});

test("rejects incomplete or off-site article callouts", () => {
  assert.equal(normalizeArticleCallout(null), null);
  assert.equal(normalizeArticleCallout({ href: "/calculators/x/", articleName: "X" }), null);
  assert.equal(
    normalizeArticleCallout({ href: "https://example.com/articles/x/", articleName: "X" }),
    null
  );
  assert.ok(
    normalizeArticleCallout({
      href: "/articles/investing-and-financial-literacy/compound-interest/",
      articleName: "Compound Interest",
    })
  );
});

test("calculator insert prefers related or FAQ, not a mid-page newsletter", () => {
  const html = `<div class="wrap">
<section class="newsletter-signup card"><h2>Want new calculators</h2></section>
<section class="card"><h2>Important note</h2><p>Just arithmetic.</p></section>
<section class="faq-section"><h2>FAQ</h2></section>
<section class="card calc-related-bottom"><h2>Related</h2></section>
<div class="disclaimer"></div>
</div>`;
  const idx = findCalculatorArticleCalloutInsertIndex(html);
  assert.ok(html.slice(idx).startsWith('<section class="faq-section"'));
});

test("calculator insert lands before related when related is first", () => {
  const html = `<div class="wrap">
<div class="card calc-related"><h2>Related</h2></div>
<section class="newsletter-signup card"></section>
</div>`;
  const idx = findCalculatorArticleCalloutInsertIndex(html);
  assert.ok(html.slice(idx).startsWith('<div class="card calc-related"'));
});

test("injects article callout before calculator FAQ", () => {
  const html = `<div class="wrap">
<p>Results.</p>
<section class="faq-section"><h2>FAQ</h2></section>
</div>`;
  const out = injectArticleCalloutOnCalculator(
    html,
    {
      href: "/articles/investing-and-financial-literacy/pay-off-your-mortgage-faster-or-invest/",
      articleName: "Pay Off Your Mortgage Faster or Invest?",
    },
    { t }
  );
  const calloutAt = out.indexOf("calc-article-callout");
  const faqAt = out.indexOf("faq-section");
  assert.ok(calloutAt > 0 && calloutAt < faqAt);
  assert.match(out, /Want the walkthrough\?/);
  assert.match(out, /href="\/articles\/investing-and-financial-literacy\/pay-off-your-mortgage-faster-or-invest\/"/);
});

test("articleDisplayName prefers headline", () => {
  assert.equal(
    articleDisplayName({ meta: { headline: "Safe Withdrawal Rate", title: "Safe Withdrawal Rate | The Long Math" } }),
    "Safe Withdrawal Rate"
  );
});
