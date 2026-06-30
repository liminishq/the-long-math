"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const jsonPath = path.join(ROOT, "assets", "i18n", "en", "articles", "rrsp-meltdown.json");
const htmlPath = path.join(
  ROOT,
  "articles",
  "investing-and-financial-literacy",
  "rrsp-meltdown",
  "index.html",
);

const CRA_DEFINITIONS =
  "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/definitions-rrsps.html";
const CRA_RATES =
  "https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html";
const BRACKETS_TOOL = "/tools/income-tax-brackets-canada/";

function extractArticleMainHtml(html) {
  const open = html.indexOf('<article class="article-content">');
  const close = html.lastIndexOf("</article>");
  if (open === -1 || close === -1) throw new Error("article bounds not found");
  let body = html.slice(open, close + "</article>".length);
  body = body.replace(
    /\s*<section class="newsletter-signup card"[\s\S]*?<\/section>\s*(?=<\/article>)/,
    "\r\n",
  );
  return body.replace(/\r?\n/g, "\r\n");
}

function patchWrapMainHtml(html) {
  let out = html;

  out = out.replace(
    /The Canada Revenue Agency defines an annuitant of an RRSP or a RRIF as "the person for whom the plan or fund provides a retirement income"\./,
    `The <a href="${CRA_DEFINITIONS}">Canada Revenue Agency</a> defines an annuitant of an RRSP or a RRIF as &ldquo;the person for whom the plan or fund provides a retirement income&rdquo;.`,
  );

  const clawbackLine =
    "RRIF withdrawals arriving on top of CPP and OAS can push the top portion of a year&apos;s income into high brackets &mdash; and potentially into OAS clawback territory.";
  if (!out.includes(BRACKETS_TOOL)) {
    out = out.replace(
      clawbackLine,
      `${clawbackLine}</p>\r\n        <p>See current provincial, territorial, and federal income tax brackets <a href="${BRACKETS_TOOL}">here</a>.`,
    );
  }

  out = out.replace(
    /Note: These are simplified approximations using combined marginal rates from a third-party Ontario 2026 table\./,
    `Note: These are simplified approximations using combined federal and provincial marginal rates for Ontario in 2026, based on <a href="${CRA_RATES}">CRA &mdash; Canadian income tax rates for individuals (current and previous years)</a>.`,
  );

  out = out.replace(
    /<li>It helps if and only if the early marginal rate was materially lower than the rate on the displaced future RRIF income\.<\/li>/,
    "<li><strong>It helps if and only if</strong> the early marginal rate from all income sources combined was materially lower than the rate on the displaced future RRIF income.</li>",
  );

  return out;
}

const pageHtml = fs.readFileSync(htmlPath, "utf8");
let wrapMainHtml = patchWrapMainHtml(extractArticleMainHtml(pageHtml));

const article = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
article.wrapMainHtml = wrapMainHtml;
fs.writeFileSync(jsonPath, `${JSON.stringify(article, null, 2)}\n`, "utf8");
console.error("Updated", jsonPath);
