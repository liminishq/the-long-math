#!/usr/bin/env node
"use strict";

/**
 * One-off migration: static article HTML → assets/i18n/{en,fr}/articles/*.json
 * Run from repo root: node tools/extract-articles-to-json.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ARTICLES_ROOT = path.join(ROOT, "articles", "investing-and-financial-literacy");
const HUB_FILE = path.join(ARTICLES_ROOT, "index.html");
const OUT_EN = path.join(ROOT, "assets", "i18n", "en", "articles");
const OUT_FR = path.join(ROOT, "assets", "i18n", "fr", "articles");

const HUB_PATH = "/articles/investing-and-financial-literacy/";

const SLUGS = [
  "asset-classes-for-investing",
  "compound-interest",
  "dollar-cost-averaging",
  "fixed-vs-variable-mortgage-in-canada",
  "how-does-a-mortgage-work-in-canada",
  "inflation",
  "investing-vs-trading",
  "leveraged-investing",
  "norberts-gambit",
  "pay-off-your-mortgage-faster-or-invest",
  "what-is-a-non-registered-account",
  "rrsp-vs-tfsa-vs-fhsa",
  "sequence-of-returns-risk",
  "should-you-break-your-mortgage-for-a-lower-rate",
  "the-true-cost-of-financial-advisor-fees",
  "tfsa-withdrawal-rules-over-contribution-penalties",
  "what-is-a-stock",
  "what-is-a-tfsa",
  "what-is-an-fhsa",
  "what-is-an-resp",
  "what-is-an-rrsp",
  "what-is-investing",
  "what-is-the-stock-market",
  "xeqt-and-chill-low-cost-etf-investing",
];

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function metaContent(html, name) {
  const re = new RegExp('<meta\\s+name="' + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s+content="([^"]*)"', "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

function metaProperty(html, prop) {
  const re = new RegExp('<meta\\s+property="' + prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s+content="([^"]*)"', "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

function titleTag(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "";
}

function extractStyles(html) {
  const styles = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    styles.push(m[0]);
  }
  return styles.join("\n");
}

function extractWrapInner(html, isHub) {
  const open = isHub ? /<main[^>]*class="[^"]*wrap[^"]*"[^>]*>/i : /<div[^>]*class="[^"]*wrap[^"]*"[^>]*>/i;
  const mo = html.match(open);
  if (!mo) throw new Error("Could not find wrap opening");
  const start = mo.index + mo[0].length;
  const disc = html.indexOf('<div class="disclaimer">', start);
  if (disc === -1) throw new Error("Could not find disclaimer");
  return html.slice(start, disc).trim();
}

function extractDisclaimerInner(html) {
  const m = html.match(/<div class="disclaimer">\s*([\s\S]*?)<\/div>/i);
  if (!m) return "";
  return m[1].trim();
}

function extractArticleLdArticle(html) {
  const m = html.match(/"@type"\s*:\s*"Article"[\s\S]*?"dateModified"\s*:\s*"([^"]*)"/);
  const dateModified = m ? m[1] : "";
  const m2 = html.match(/"datePublished"\s*:\s*"([^"]*)"/);
  const datePublished = m2 ? m2[1] : dateModified;
  return { datePublished, dateModified };
}

function extractFaq(html) {
  const items = [];
  const re = /<details>\s*<summary>([^<]*)<\/summary>\s*<div class="faq-answer">\s*([\s\S]*?)<\/div>\s*<\/details>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({
      question: m[1].trim(),
      answerHtml: m[2].trim(),
    });
  }
  return items;
}

function extractHeadline(html) {
  const m = html.match(/<article[^>]*class="[^"]*article-content[^"]*"[^>]*>[\s\S]*?<header>\s*<h1>([^<]*)<\/h1>/i);
  return m ? m[1].trim() : "";
}

function processArticle(slug) {
  const file = path.join(ARTICLES_ROOT, slug, "index.html");
  const html = fs.readFileSync(file, "utf8");
  const title = titleTag(html);
  const description = metaContent(html, "description");
  const articleModified = metaContent(html, "article:modified");
  const ogTitle = metaProperty(html, "og:title") || title;
  const ogDescription = metaProperty(html, "og:description") || description;
  const twitterTitle = metaContent(html, "twitter:title") || titleTag(html);
  const twitterDescription = metaContent(html, "twitter:description") || description;
  const { datePublished, dateModified } = extractArticleLdArticle(html);
  const headline = extractHeadline(html) || title.replace(/\s*[–-]\s*The Long Math\s*$/i, "").trim();
  const pageStyles = extractStyles(html);
  const wrapMainHtml = extractWrapInner(html, false);
  const disclaimerHtml = extractDisclaimerInner(html);
  const faq = extractFaq(html);

  const articlePath = `${HUB_PATH}${slug}/`.replace(/\/+/g, "/");
  const breadcrumbItems = [
    { name: "Home", path: "/" },
    { name: "Investment and Financial Literacy", path: HUB_PATH },
    { name: headline, path: articlePath },
  ];

  return {
    meta: {
      title,
      description,
      articleModified: articleModified || "",
      datePublished: datePublished || "",
      dateModified: dateModified || datePublished || "",
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
      headline,
    },
    breadcrumbItems,
    pageStyles,
    wrapMainHtml,
    disclaimerHtml,
    faq,
  };
}

function processHub() {
  const html = fs.readFileSync(HUB_FILE, "utf8");
  const title = titleTag(html);
  const description = metaContent(html, "description");
  const pageStyles = extractStyles(html);
  const hubMainHtml = extractWrapInner(html, true);
  const disclaimerHtml = extractDisclaimerInner(html);

  return {
    meta: {
      title,
      description,
      ogTitle: title,
      ogDescription: description,
    },
    pageStyles,
    hubMainHtml,
    disclaimerHtml,
  };
}

function writeJson(dir, name, obj) {
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function main() {
  ensureDir(OUT_EN);
  ensureDir(OUT_FR);

  const hub = processHub();
  writeJson(OUT_EN, "investing-and-financial-literacy-index.json", hub);
  writeJson(OUT_FR, "investing-and-financial-literacy-index.json", JSON.parse(JSON.stringify(hub)));

  for (const slug of SLUGS) {
    const data = processArticle(slug);
    const fname = `${slug}.json`;
    writeJson(OUT_EN, fname, data);
    writeJson(OUT_FR, fname, JSON.parse(JSON.stringify(data)));
  }

  console.log("Wrote", SLUGS.length + 1, "article JSON files to en/articles and fr/articles (FR copies EN; translate FR when ready).");
}

main();
