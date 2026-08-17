"use strict";

const FAQ_HEADING_RE =
  /<h2\b[^>]*>\s*(Frequently Asked Questions|Foire aux questions|Questions fr[eé]quentes|FAQ)\s*<\/h2>/i;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeCallout(raw) {
  if (!raw || typeof raw !== "object") return null;
  const href = String(raw.href || "").trim();
  const calculatorName = String(raw.calculatorName || "").trim();
  if (!href || !calculatorName) return null;
  if (!href.startsWith("/calculators/") || href.includes("://")) return null;
  return {
    href,
    calculatorName,
    heading: raw.heading != null ? String(raw.heading).trim() : "",
    lead: raw.lead != null ? String(raw.lead).trim() : "",
    note: raw.note != null ? String(raw.note).trim() : "",
  };
}

/**
 * Insert immediately after the last prose section: before FAQ, related reading,
 * or the article close — whichever comes first.
 * @param {string} html
 * @returns {number}
 */
function findArticleCalloutInsertIndex(html) {
  if (!html) return -1;

  const faqSection = html.search(/<section\b[^>]*\bid=["']faq["'][^>]*>/i);
  if (faqSection !== -1) return faqSection;

  const faqH2Id = html.search(/<h2\b[^>]*\bid=["']faq["'][^>]*>/i);
  if (faqH2Id !== -1) {
    const sectionStart = html.lastIndexOf("<section", faqH2Id);
    if (sectionStart !== -1) return sectionStart;
    return faqH2Id;
  }

  const faqHeading = html.search(FAQ_HEADING_RE);
  if (faqHeading !== -1) {
    const sectionStart = html.lastIndexOf("<section", faqHeading);
    if (sectionStart !== -1) return sectionStart;
    return faqHeading;
  }

  const related = html.search(/<section\b[^>]*\brelated-articles/i);
  if (related !== -1) return related;

  return html.lastIndexOf("</article>");
}

function applyLeadTemplate(template, name, fallback) {
  const lead = template && template.includes("{name}") ? template : fallback;
  return lead.replace(/\{name\}/g, name);
}

/**
 * One primary article per live calculator — the reciprocal of article
 * `calculatorCallout`. When several articles point at the same tool, this is
 * the article that answers the calculator's actual question.
 */
const CALCULATOR_PRIMARY_ARTICLE = {
  "active-vs-passive-break-even": "xeqt-and-chill-low-cost-etf-investing",
  "advisor-fee": "the-true-cost-of-financial-advisor-fees",
  "canada-income-tax": "capital-gains-vs-dividends-vs-interest-tax-canada",
  "future-buying-power": "inflation",
  "investment-calculator-inflation-adjusted": "real-returns-vs-nominal-returns",
  "investment-simple": "compound-interest",
  "mortgage-calculator": "how-does-a-mortgage-work-in-canada",
  "pay-off-mortgage-vs-invest": "pay-off-your-mortgage-faster-or-invest",
  "retirement-withdrawal-calculator": "safe-withdrawal-rate",
  "rrsp-contribution-room-tax-refund": "what-is-an-rrsp",
  "rrsp-deduction-timing": "rrsp-deduction-timing",
  "tfsa-over-contribution-penalty-calculator": "tfsa-withdrawal-rules-over-contribution-penalties",
  "tfsa-room": "what-is-a-tfsa",
  "tfsa-rrsp-fhsa": "rrsp-vs-tfsa-vs-fhsa",
};

function normalizeArticleCallout(raw) {
  if (!raw || typeof raw !== "object") return null;
  const href = String(raw.href || "").trim();
  const articleName = String(raw.articleName || "").trim();
  if (!href || !articleName) return null;
  if (!href.startsWith("/articles/") || href.includes("://")) return null;
  return {
    href,
    articleName,
    heading: raw.heading != null ? String(raw.heading).trim() : "",
    lead: raw.lead != null ? String(raw.lead).trim() : "",
    note: raw.note != null ? String(raw.note).trim() : "",
  };
}

function sectionStartBefore(html, idx) {
  const sectionStart = html.lastIndexOf("<section", idx);
  if (sectionStart !== -1) return rewindOverComments(html, sectionStart);
  const divStart = html.lastIndexOf("<div", idx);
  if (divStart !== -1 && idx - divStart < 400) return rewindOverComments(html, divStart);
  return rewindOverComments(html, idx);
}

function rewindOverComments(html, idx) {
  let i = idx;
  while (i > 0) {
    let end = i;
    while (end > 0 && /\s/.test(html[end - 1])) end--;
    const before = html.slice(0, end);
    const commentStart = before.lastIndexOf("<!--");
    if (commentStart === -1 || !/<!--[\s\S]*-->$/.test(before.slice(commentStart))) break;
    i = commentStart;
  }
  return i;
}

/**
 * After the tool and any remaining explanation: before related, FAQ, or
 * disclaimer — whichever comes first. Mid-page newsletter blocks are ignored.
 * @param {string} html
 * @returns {number}
 */
function findCalculatorArticleCalloutInsertIndex(html) {
  if (!html) return -1;
  const markers = [];

  const related = html.search(/<(?:section|div)\b[^>]*\b(?:calc-related-bottom|calc-related)\b/i);
  if (related !== -1) markers.push(rewindOverComments(html, related));

  const faqSection = html.search(/<section\b[^>]*\bfaq-section\b/i);
  if (faqSection !== -1) markers.push(rewindOverComments(html, faqSection));

  const faqId = html.search(/<(?:section|h2)\b[^>]*\bid=["']faq(?:-heading)?["'][^>]*>/i);
  if (faqId !== -1) markers.push(sectionStartBefore(html, faqId));

  const faqHeading = html.search(FAQ_HEADING_RE);
  if (faqHeading !== -1) markers.push(sectionStartBefore(html, faqHeading));

  if (markers.length) return Math.min(...markers);

  const disclaimer = html.search(/<div\b[^>]*\bdisclaimer\b/i);
  if (disclaimer !== -1) return disclaimer;

  return -1;
}

function renderLinkedLead(lead, name, href) {
  const nameIdx = lead.indexOf(name);
  if (nameIdx === -1) {
    return `${escapeHtml(lead)} <a href="${escapeHtml(href)}">${escapeHtml(name)}</a>`;
  }
  const before = lead.slice(0, nameIdx);
  const after = lead.slice(nameIdx + name.length);
  return `${escapeHtml(before)}<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>${escapeHtml(after)}`;
}

function articleDisplayName(article) {
  if (!article || typeof article !== "object") return "";
  const headline = article.meta && String(article.meta.headline || "").trim();
  if (headline) return headline;
  const html = article.wrapMainHtml != null ? String(article.wrapMainHtml) : "";
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]+>/g, "").trim();
  const title = article.meta && String(article.meta.title || "");
  return title.replace(/\s*[–—|-]\s*The Long Math.*$/i, "").trim();
}

/**
 * @param {object|null|undefined} rawCallout
 * @param {{ t: (key: string) => string, localizeRootHref?: (href: string) => string }} opts
 * @returns {string}
 */
function renderCalculatorCalloutHtml(rawCallout, opts) {
  const callout = normalizeCallout(rawCallout);
  if (!callout) return "";
  const t = opts && typeof opts.t === "function" ? opts.t : (key) => key;
  const localize = opts && typeof opts.localizeRootHref === "function" ? opts.localizeRootHref : (href) => href;

  const heading = callout.heading || t("common.calculatorCallout.heading");
  const leadTemplate = callout.lead || t("common.calculatorCallout.lead");
  const href = localize(callout.href);
  const name = callout.calculatorName;
  const lead = applyLeadTemplate(leadTemplate, name, "Try the {name}.");
  const actionInner = renderLinkedLead(lead, name, href);

  const noteHtml = callout.note
    ? `\n  <p class="article-calc-callout__note">${escapeHtml(callout.note)}</p>`
    : "";

  return `<aside class="article-calc-callout" aria-labelledby="article-calc-callout-heading">
  <h2 id="article-calc-callout-heading" class="article-calc-callout__heading">${escapeHtml(heading)}</h2>
  <p class="article-calc-callout__action">${actionInner}</p>${noteHtml}
</aside>`;
}

/**
 * @param {string} html
 * @param {object|null|undefined} rawCallout
 * @param {{ t: (key: string) => string, localizeRootHref?: (href: string) => string }} opts
 * @returns {string}
 */
function injectCalculatorCallout(html, rawCallout, opts) {
  if (!html || html.includes("article-calc-callout")) return html || "";
  const block = renderCalculatorCalloutHtml(rawCallout, opts);
  if (!block) return html;

  const idx = findArticleCalloutInsertIndex(html);
  if (idx === -1) return html;
  return html.slice(0, idx) + block + "\n\n      " + html.slice(idx);
}

function renderArticleCalloutHtml(rawCallout, opts) {
  const callout = normalizeArticleCallout(rawCallout);
  if (!callout) return "";
  const t = opts && typeof opts.t === "function" ? opts.t : (key) => key;
  const localize = opts && typeof opts.localizeRootHref === "function" ? opts.localizeRootHref : (href) => href;

  const heading = callout.heading || t("common.articleCallout.heading");
  const leadTemplate = callout.lead || t("common.articleCallout.lead");
  const href = localize(callout.href);
  const name = callout.articleName;
  const lead = applyLeadTemplate(leadTemplate, name, "Read {name}.");
  const actionInner = renderLinkedLead(lead, name, href);
  const noteHtml = callout.note
    ? `\n  <p class="article-calc-callout__note">${escapeHtml(callout.note)}</p>`
    : "";

  return `<aside class="article-calc-callout calc-article-callout" aria-labelledby="calc-article-callout-heading">
  <h2 id="calc-article-callout-heading" class="article-calc-callout__heading">${escapeHtml(heading)}</h2>
  <p class="article-calc-callout__action">${actionInner}</p>${noteHtml}
</aside>`;
}

/**
 * @param {string} html
 * @param {object|null|undefined} rawCallout
 * @param {{ t: (key: string) => string, localizeRootHref?: (href: string) => string }} opts
 * @returns {string}
 */
function injectArticleCalloutOnCalculator(html, rawCallout, opts) {
  if (!html || html.includes("calc-article-callout")) return html || "";
  const block = renderArticleCalloutHtml(rawCallout, opts);
  if (!block) return html;

  const idx = findCalculatorArticleCalloutInsertIndex(html);
  if (idx === -1) return html;
  return html.slice(0, idx) + block + "\n\n      " + html.slice(idx);
}

/**
 * @param {string} calculatorsDir directory that contains `{slug}/index.html`
 * @param {Record<string, { href: string, articleName: string }>} calloutsBySlug
 * @param {{ t: (key: string) => string, localizeRootHref?: (href: string) => string }} opts
 * @returns {string[]} written file paths
 */
function injectArticleCalloutsIntoCalculatorsDir(calculatorsDir, calloutsBySlug, opts) {
  const fs = require("fs");
  const path = require("path");
  const written = [];
  if (!calculatorsDir || !calloutsBySlug) return written;
  for (const [slug, raw] of Object.entries(calloutsBySlug)) {
    const file = path.join(calculatorsDir, slug, "index.html");
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    const next = injectArticleCalloutOnCalculator(html, raw, opts);
    if (next !== html) {
      fs.writeFileSync(file, next, "utf8");
      written.push(file);
    }
  }
  return written;
}

module.exports = {
  escapeHtml,
  normalizeCallout,
  normalizeArticleCallout,
  findArticleCalloutInsertIndex,
  findCalculatorArticleCalloutInsertIndex,
  renderCalculatorCalloutHtml,
  renderArticleCalloutHtml,
  injectCalculatorCallout,
  injectArticleCalloutOnCalculator,
  injectArticleCalloutsIntoCalculatorsDir,
  articleDisplayName,
  CALCULATOR_PRIMARY_ARTICLE,
};
