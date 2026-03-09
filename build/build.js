#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");
const { loadLang, getMergedDict, t } = require("./lib/load-i18n.js");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TEMPLATES_DIR = path.join(__dirname, "templates");
const BASE_URL = "https://thelongmath.com";

const LANGS = [
  { code: "en", pathPrefix: "" },
  { code: "fr", pathPrefix: "/fr" },
];

const PAGES = [
  { id: "index", logicalPath: "/", metaKey: "home", template: "pages/index.njk" },
  {
    id: "advisor-fee",
    logicalPath: "/calculators/advisor-fee/",
    metaKey: "advisorFee",
    template: "pages/advisor-fee.njk",
  },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getHreflangUrls(logicalPath) {
  return {
    en: BASE_URL + (logicalPath === "/" ? "" : logicalPath),
    fr: BASE_URL + "/fr" + (logicalPath === "/" ? "" : logicalPath),
    xDefault: BASE_URL + (logicalPath === "/" ? "" : logicalPath),
  };
}

function build() {
  console.log("Loading i18n...");
  const dictEn = loadLang(ROOT, "en");

  const env = nunjucks.configure(TEMPLATES_DIR, {
    autoescape: true,
    noCache: true,
  });

  // Copy entire project to dist, then overwrite with generated files
  console.log("Copying project to dist...");
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  copyRecursive(ROOT, DIST, (src) => {
    const rel = path.relative(ROOT, src);
    if (rel === "dist" || rel.startsWith("dist" + path.sep)) return false;
    if (rel === "node_modules" || rel.startsWith("node_modules" + path.sep)) return false;
    if (rel === ".git" || rel.startsWith(".git" + path.sep)) return false;
    if (rel === "build" || rel.startsWith("build" + path.sep)) return false;
    if (rel === "fr" || rel.startsWith("fr" + path.sep)) return false;
    return true;
  });

  // Generate header and footer partials (en + fr) for non-generated pages that inject them
  console.log("Generating header/footer partials...");
  for (const { code, pathPrefix } of LANGS) {
    const merged = getMergedDict(ROOT, code, dictEn);
    const tFn = (key) => t(merged, key);
    const partialsDir = path.join(DIST, "assets", "partials");
    ensureDir(partialsDir);

    const headerHtml = nunjucks.render("partials/header.njk", { lang: code, pathPrefix, t: tFn, hreflangUrls: null });
    const footerHtml = nunjucks.render("partials/footer.njk", { lang: code, t: tFn });
    const headerName = code === "en" ? "header.html" : "header-fr.html";
    const footerName = code === "en" ? "footer.html" : "footer-fr.html";
    fs.writeFileSync(path.join(partialsDir, headerName), headerHtml, "utf8");
    fs.writeFileSync(path.join(partialsDir, footerName), footerHtml, "utf8");
  }

  // Generate each page for each language
  console.log("Generating pages...");
  for (const page of PAGES) {
    for (const { code, pathPrefix } of LANGS) {
      const merged = getMergedDict(ROOT, code, dictEn);
      const tFn = (key) => t(merged, key);
      const logicalPath = page.logicalPath;
      const currentPath = pathPrefix + (logicalPath === "/" ? "" : logicalPath);
      const canonical = BASE_URL + currentPath;
      const hreflangUrlsObj = getHreflangUrls(logicalPath);
      const hreflangLinks = [
        { hreflang: "en", url: hreflangUrlsObj.en },
        { hreflang: "fr", url: hreflangUrlsObj.fr },
        { hreflang: "x-default", url: hreflangUrlsObj.xDefault },
      ];

      const meta = merged.meta && merged.meta[page.metaKey];
      const title = (meta && meta.title) || page.id;
      const description = (meta && meta.description) || "";

      const ctx = {
        lang: code,
        pathPrefix,
        path: currentPath,
        canonical,
        hreflangLinks,
        title,
        description,
        t: tFn,
        pageId: page.id,
      };

      const html = nunjucks.render(page.template, ctx);
      const pathSegment = logicalPath === "/" ? "" : logicalPath.replace(/^\//, "").replace(/\/$/, "");
      const outPath = path.join(DIST, pathPrefix === "" ? "." : pathPrefix.slice(1), pathSegment, "index.html");
      ensureDir(path.dirname(outPath));
      fs.writeFileSync(outPath, html, "utf8");
      console.log("  " + outPath);
    }
  }

  console.log("Build complete. Output: " + DIST);
}

function copyRecursive(src, dest, filter) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const name of fs.readdirSync(src)) {
      const srcChild = path.join(src, name);
      const destChild = path.join(dest, name);
      if (filter(srcChild)) copyRecursive(srcChild, destChild, filter);
    }
  } else if (filter(src)) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

build();
