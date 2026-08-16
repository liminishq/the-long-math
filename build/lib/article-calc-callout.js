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

function applyLeadTemplate(template, name) {
  const lead = template && template.includes("{name}") ? template : "Try the {name}.";
  return lead.replace(/\{name\}/g, name);
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
  const lead = applyLeadTemplate(leadTemplate, name);
  const nameIdx = lead.indexOf(name);

  let actionInner;
  if (nameIdx === -1) {
    actionInner = `${escapeHtml(lead)} <a href="${escapeHtml(href)}">${escapeHtml(name)}</a>`;
  } else {
    const before = lead.slice(0, nameIdx);
    const after = lead.slice(nameIdx + name.length);
    actionInner = `${escapeHtml(before)}<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>${escapeHtml(after)}`;
  }

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

module.exports = {
  escapeHtml,
  normalizeCallout,
  findArticleCalloutInsertIndex,
  renderCalculatorCalloutHtml,
  injectCalculatorCallout,
};
