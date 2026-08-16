import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  findArticleCalloutInsertIndex,
  injectCalculatorCallout,
  normalizeCallout,
} = require("../build/lib/article-calc-callout.js");

const t = (key) =>
  ({
    "common.calculatorCallout.heading": "Ready to run your own numbers?",
    "common.calculatorCallout.lead": "Try the {name}.",
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
