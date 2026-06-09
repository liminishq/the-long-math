#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const buildSrc = fs.readFileSync(path.join(ROOT, "build", "build.js"), "utf8");
const slugs = [...buildSrc.matchAll(/"([a-z0-9-]+)"/g)]
  .map((m) => m[1])
  .filter((s) => s.includes("-") && !s.startsWith("article-") && s !== "investing-and-financial-literacy")
  .filter((s, i, arr) => arr.indexOf(s) === i);
const articleSlugs = slugs.filter((s) =>
  fs.existsSync(path.join(ROOT, "assets", "i18n", "en", "articles", `${s}.json`))
);

const frDir = path.join(ROOT, "assets", "i18n", "fr", "articles");
const enDir = path.join(ROOT, "assets", "i18n", "en", "articles");

function h1(html) {
  const m = (html || "").match(/<h1[^>]*>([^<]+)</);
  return m ? m[1].trim() : "";
}

const noFrJson = [];
const emptyFrBody = [];
const englishBody = [];

for (const slug of articleSlugs) {
  const frPath = path.join(frDir, `${slug}.json`);
  const en = JSON.parse(fs.readFileSync(path.join(enDir, `${slug}.json`), "utf8"));
  const enH1 = h1(en.wrapMainHtml);

  if (!fs.existsSync(frPath)) {
    noFrJson.push({ slug, enH1 });
    continue;
  }

  const fr = JSON.parse(fs.readFileSync(frPath, "utf8"));
  const frHtml = (fr.wrapMainHtml || "").trim();
  const frH1 = h1(frHtml);

  if (!frHtml) {
    emptyFrBody.push({ slug, enH1 });
    continue;
  }

  if (frH1 && enH1 && frH1 === enH1) {
    englishBody.push({ slug, h1: frH1 });
  }
}

console.log(`Published article slugs: ${articleSlugs.length}`);
console.log(`No FR JSON (EN fallback on /fr/ URL): ${noFrJson.length}`);
noFrJson.forEach((x) => console.log(`  - ${x.slug}`));
console.log(`FR JSON with empty body (EN fallback): ${emptyFrBody.length}`);
emptyFrBody.forEach((x) => console.log(`  - ${x.slug}`));
console.log(`FR JSON with identical EN H1 (likely English body): ${englishBody.length}`);
englishBody.forEach((x) => console.log(`  - ${x.slug}: ${x.h1}`));
console.log(
  `Total with FR hub card but English article text: ${noFrJson.length + emptyFrBody.length + englishBody.length}`
);
