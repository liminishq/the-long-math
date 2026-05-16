"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @param {string} kebab
 * @returns {string}
 */
function kebabToCamel(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Load per-article JSON from assets/i18n/{lang}/articles/*.json into { camelKey: object }.
 * @param {string} root
 * @param {string} lang
 * @returns {Record<string, object>}
 */
function loadArticleDict(root, lang) {
  const dir = path.join(root, "assets", "i18n", lang, "articles");
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const base = name.slice(0, -5);
    const key = kebabToCamel(base);
    try {
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      out[key] = JSON.parse(raw);
    } catch (e) {
      console.warn("Skipping invalid article JSON:", path.join(dir, name), e.message);
    }
  }
  return out;
}

/**
 * Deep-merge localized article over English; keep English when local value is empty / missing.
 * @param {object|null|undefined} enA
 * @param {object|null|undefined} locA
 * @returns {object}
 */
function mergeArticlePayload(enA, locA) {
  if (!enA && !locA) return {};
  if (!locA) return { ...enA };
  if (!enA) return { ...locA };
  const out = { ...enA };
  for (const k of Object.keys(locA)) {
    const v = locA[k];
    if (v == null) continue;
    if (typeof v === "string") {
      if (v.trim() !== "") out[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length > 0) out[k] = v;
      continue;
    }
    if (typeof v === "object") {
      out[k] = mergeArticlePayload(enA[k] || {}, locA[k]);
      continue;
    }
    out[k] = v;
  }
  return out;
}

const { fixPrefixedFrenchInternalLinks } = require("./fr-hrefs");

/**
 * Prefix root-relative links for localized builds (French mirrors).
 * Calculator, /fees/, and /tools/ hrefs resolve to English routes except the hub
 * and advisor-fee shell; logic lives in ../fr-hrefs.js.
 * @param {string} html
 * @param {string} pathPrefix
 * @returns {string}
 */
function prefixRootRelativeLinks(html, pathPrefix) {
  if (!html || !pathPrefix) return html || "";
  let out = html.replace(/href="\//g, `href="${pathPrefix}/`);
  out = fixPrefixedFrenchInternalLinks(out);
  out = out.replace(/src="\//g, `src="${pathPrefix}/`);
  return out;
}

/**
 * Strip HTML tags for plain-text JSON-LD fields.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{ question: string, answerHtml: string }[]} items
 * @returns {object}
 */
function buildFaqPageSchema(items) {
  if (!items || !items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: stripHtml(item.answerHtml),
      },
    })),
  };
}

/**
 * @param {{ name: string, path: string }[]} items
 * @param {string} baseUrl
 * @param {string} pathPrefix
 */
function buildBreadcrumbSchema(items, baseUrl, pathPrefix) {
  const prefix = pathPrefix || "";
  function fullUrl(p) {
    if (p === "/") {
      return baseUrl + prefix + "/";
    }
    const pathPart = p.startsWith("/") ? p : "/" + p;
    const normalized = pathPart.endsWith("/") ? pathPart : pathPart + "/";
    return baseUrl + prefix + normalized;
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: fullUrl(it.path),
    })),
  };
}

/**
 * @param {object} article merged payload
 * @param {string} canonical full URL
 */
function buildArticleSchema(article, canonical) {
  const m = article.meta || {};
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: m.headline || m.ogTitle || "",
    description: m.description || "",
    author: { "@type": "Person", name: "Phil Evans" },
    publisher: {
      "@type": "Organization",
      name: "The Long Math",
      logo: { "@type": "ImageObject", url: "https://www.thelongmath.com/assets/logo.png" },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };
  const pub = (m.datePublished && String(m.datePublished).trim()) || "";
  const mod = (m.dateModified && String(m.dateModified).trim()) || "";
  if (pub) schema.datePublished = pub;
  if (mod) schema.dateModified = mod;
  else if (pub) schema.dateModified = pub;
  return schema;
}

module.exports = {
  kebabToCamel,
  loadArticleDict,
  mergeArticlePayload,
  prefixRootRelativeLinks,
  stripHtml,
  buildFaqPageSchema,
  buildBreadcrumbSchema,
  buildArticleSchema,
};
