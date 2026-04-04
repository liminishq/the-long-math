#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const idxPath = path.join(ROOT, "assets", "data", "search-index.json");
const artDir = path.join(ROOT, "assets", "i18n", "fr", "articles");

const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));

function jsonFileForFrArticleUrl(u) {
  if (!u || !u.includes("/investing-and-financial-literacy")) return null;
  if (/\/investing-and-financial-literacy\/?$/.test(u)) {
    return path.join(artDir, "investing-and-financial-literacy-index.json");
  }
  const re = /\/investing-and-financial-literacy\/([^/]+)\/?$/;
  const m = u.match(re);
  if (!m) return null;
  return path.join(artDir, m[1] + ".json");
}

for (let i = 0; i < idx.length; i++) {
  const e = idx[i];
  if (!e.url || !e.url.startsWith("/fr/articles/investing-and-financial-literacy")) continue;
  const jf = jsonFileForFrArticleUrl(e.url);
  if (!jf || !fs.existsSync(jf)) continue;
  const data = JSON.parse(fs.readFileSync(jf, "utf8"));
  const m = data.meta || {};
  e.title = m.title || e.title;
  e.desc = m.description || e.desc;
  const blob = ((m.title || "") + " " + (m.description || "")).toLowerCase();
  const words = blob
    .replace(/[^a-zàâäéèêëïîôùûüç0-9\s-]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const kw = new Set([...(e.keywords || []), ...words]);
  e.keywords = [...kw].slice(0, 45);
}

fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n", "utf8");
console.log("Updated FR article entries in search-index.json");
