#!/usr/bin/env node
"use strict";

/**
 * Regenerate assets/data/search-index.json from local HTML.
 * Run from repo root: node scripts/build-search-index.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets", "data", "search-index.json");

const KW_STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "is",
  "it",
  "its",
  "to",
  "of",
  "in",
  "on",
  "for",
  "at",
  "by",
  "from",
  "with",
  "as",
  "be",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "get",
  "got",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "this",
  "that",
  "these",
  "those",
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "i",
  "we",
  "you",
  "your",
  "my",
  "our",
  "their",
  "they",
  "them",
  "me",
  "us",
  "he",
  "she",
  "his",
  "her",
  "into",
  "over",
  "also",
  "just",
  "only",
  "about",
  "there",
  "here",
  "not",
  "no",
  "so",
  "if",
  "than",
  "then",
  "out",
  "up",
  "down",
  "all",
  "any",
  "some",
  "such",
  "more",
  "most",
  "other",
  "one",
  "two",
  "first",
  "new",
  "make",
  "made",
  "like",
  "learn",
  "includes",
  "including",
  "based",
  "long",
  "clear",
  "key",
  "use",
  "using",
  "used",
  "help",
  "helps",
  "need",
  "way",
  "many",
  "much",
  "very",
  "well",
  "through",
  "between",
  "both",
  "each",
  "few",
  "while",
  "during",
  "before",
  "after",
  "above",
  "below",
  "again",
  "once",
]);

function walk(dir, acc, skipDirs) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue;
      if (p.includes(`${path.sep}fr${path.sep}`)) continue;
      walk(p, acc, skipDirs);
    } else if (ent.name === "index.html") acc.push(p);
  }
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extract(html) {
  const titleM = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const metaM = html.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i
  );
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return {
    title: titleM ? stripTags(titleM[1]) : "",
    desc: metaM ? metaM[1].trim() : "",
    h1: h1M ? stripTags(h1M[1]) : "",
  };
}

function toUrl(filePath) {
  let rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  rel = rel.replace(/\/index\.html$/, "/");
  if (!rel.startsWith("/")) rel = "/" + rel;
  if (!rel.endsWith("/")) rel += "/";
  return rel;
}

function typeFor(p) {
  const rel = path.relative(ROOT, p).replace(/\\/g, "/");
  if (rel.startsWith("calculators/")) return "calculator";
  if (rel.startsWith("articles/")) return "article";
  if (rel.startsWith("beyond-the-numbers/") || rel.startsWith("essays/"))
    return "essay";
  return "article";
}

function cleanTitle(t) {
  return t
    .replace(/\s*[–—-]\s*The Long Math\s*$/i, "")
    .replace(/\s*\|\s*The Long Math\s*$/i, "")
    .trim();
}

function slugPhrase(url) {
  const slug = url.split("/").filter(Boolean).pop();
  if (!slug) return "";
  return slug.replace(/-/g, " ");
}

function keywordsFrom(meta, url) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const x = String(s || "").trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };

  add(cleanTitle(meta.title));
  const h = stripTags(meta.h1);
  if (h && cleanTitle(h) !== cleanTitle(meta.title)) add(cleanTitle(h));
  add(slugPhrase(url));

  const words = (meta.desc || "")
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 2 && !KW_STOP.has(w));
  const uniq = [...new Set(words)].slice(0, 14);
  uniq.forEach(add);

  return out.slice(0, 22);
}

const skip = new Set(["node_modules", ".git", "dist", "build"]);
const all = [];
walk(path.join(ROOT, "calculators"), all, skip);
walk(path.join(ROOT, "articles"), all, skip);
walk(path.join(ROOT, "beyond-the-numbers"), all, skip);
const essaysIdx = path.join(ROOT, "essays", "index.html");
if (fs.existsSync(essaysIdx)) all.push(essaysIdx);

const rows = [];
for (const fp of all.sort()) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
  if (rel.includes("/data/")) continue;
  if (rel.includes("/tests/")) continue;
  const html = fs.readFileSync(fp, "utf8");
  const meta = extract(html);
  const url = toUrl(fp);
  const title =
    stripTags(meta.h1) ||
    cleanTitle(meta.title) ||
    stripTags(meta.title);
  const desc = meta.desc || "";
  rows.push({
    type: typeFor(fp),
    title,
    url,
    desc,
    keywords: keywordsFrom({ ...meta, title: meta.title }, url),
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + "\n", "utf8");
console.log("Wrote", rows.length, "entries to", path.relative(ROOT, OUT));
