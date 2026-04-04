#!/usr/bin/env node
"use strict";

// Legacy: article HTML under articles/ was migrated to assets/i18n/{en,fr}/articles/*.json
// and built via build/build.js. This script only updates on-disk index.html files; it is a no-op
// until/unless static article HTML is restored.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ARTICLES_DIR = path.join(ROOT, "articles");

// Keep consistent with the runtime fallback in `assets/js/site.js`.
const WPM = 200;

function ensureArray(x) {
  return Array.isArray(x) ? x : [x];
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkDir(p));
    else files.push(p);
  }
  return files;
}

function extractMetaModified(html) {
  const m = html.match(/<meta\s+name=["']article:modified["']\s+content=["']([^"']+)["']\s*\/?>/i);
  return m ? m[1].trim() : null;
}

function stripTagsBasic(html) {
  // Minimal, deterministic decoding for word counting.
  const decoded = html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&middot;/gi, "·")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&hellip;/gi, "...")
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'");

  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function computeReadMinutesFromArticleHtml(articleHtml) {
  // Remove existing read-time/updated lines so they don't affect the count.
  const cleaned = articleHtml
    .replace(/<p[^>]*>[\s\S]*?minute(s)?\s*-?\s*read[\s\S]*?<\/p>/gi, " ")
    .replace(/<p[^>]*>[\s\S]*?Last updated[\s\S]*?<\/p>/gi, " ")
    .replace(/<p[^>]*>[\s\S]*?\bUpdated\s+\d{4}[\s\S]*?<\/p>/gi, " ");

  const text = stripTagsBasic(cleaned);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const minutes = Math.max(1, Math.round(words.length / WPM));
  return minutes;
}

function removeHeaderReadTimeAndUpdated(headerHtml) {
  let out = headerHtml;

  // Remove known paragraph classes first.
  out = out.replace(
    /<p[^>]*class=["'][^"']*(read-time|reading-time|reading-meta|last-updated)[^"']*["'][^>]*>[\s\S]*?<\/p>/gi,
    ""
  );

  // Remove paragraphs mentioning "minute read" (covers `<p><em>9 minute read</em></p>` too).
  out = out.replace(/<p[\s\S]*?minute(s)?\s*-?\s*read[\s\S]*?<\/p>/gi, "");

  // Remove paragraphs mentioning last-updated.
  out = out.replace(/<p[\s\S]*?Last updated[\s\S]*?<\/p>/gi, "");

  // Remove paragraphs mentioning `Updated 2026` style.
  out = out.replace(/<p[\s\S]*?\bUpdated\s+\d{4}[\s\S]*?<\/p>/gi, "");

  return out;
}

function updateHeaderInArticle(html) {
  const articleMatch = html.match(/<article\s+class=["']article-content["']([\s\S]*?)<\/article>/i);
  if (!articleMatch) return null;

  const articleHtml = articleMatch[0];

  const headerMatch = articleHtml.match(/<header>([\s\S]*?)<\/header>/i);
  if (!headerMatch) return null;

  const fullHeader = headerMatch[0];
  let headerInner = headerMatch[1];

  const modified = extractMetaModified(html) || "March 2026";
  const minutes = computeReadMinutesFromArticleHtml(articleHtml);
  const readLine = `${minutes}-minute read`;
  const updatedLine = `Last updated ${modified}`;

  headerInner = removeHeaderReadTimeAndUpdated(headerInner);

  // Determine indentation from the h1 line (fallback to 8 spaces).
  const indentMatch = headerInner.match(/^(\s*)<h1/m);
  const indent = indentMatch ? indentMatch[1] : "        ";

  // Insert after the last remaining <p> inside the header (usually subtitle); otherwise after h1.
  const pMatches = ensureArray([...headerInner.matchAll(/<p[\s\S]*?<\/p>/gi)]);

  let insertionPoint;
  if (pMatches.length > 0 && typeof pMatches[pMatches.length - 1].index === "number") {
    const lastP = pMatches[pMatches.length - 1];
    insertionPoint = lastP.index + lastP[0].length;
  } else {
    const h1End = headerInner.indexOf("</h1>");
    insertionPoint = h1End >= 0 ? h1End + "</h1>".length : headerInner.length;
  }

  const insertion = `\n${indent}<p class="reading-time">${readLine}</p>\n${indent}<p class="last-updated">${updatedLine}</p>\n`;

  const updatedHeaderInner = headerInner.slice(0, insertionPoint) + insertion + headerInner.slice(insertionPoint);
  // Replace header by constructing the full `<header>...</header>` string explicitly.
  const newFullHeader = `<header>${updatedHeaderInner}</header>`;
  const updatedArticleHtml = articleHtml.replace(fullHeader, newFullHeader);
  const updatedHtml = html.replace(articleHtml, updatedArticleHtml);

  return { updatedHtml, minutes, modified, readLine, updatedLine };
}

function main() {
  const files = walkDir(ARTICLES_DIR).filter((p) => p.endsWith(`${path.sep}index.html`) || p.endsWith(`${path.posix.sep}index.html`));

  let changedCount = 0;
  for (const filePath of files) {
    const html = fs.readFileSync(filePath, "utf8");
    const res = updateHeaderInArticle(html);
    if (!res) continue;
    if (res.updatedHtml === html) continue;

    fs.writeFileSync(filePath, res.updatedHtml, "utf8");
    changedCount += 1;
    console.log(`Updated: ${path.relative(ROOT, filePath)} -> ${res.readLine} / ${res.updatedLine}`);
  }

  console.log(`Done. Updated ${changedCount} article(s).`);
}

main();

