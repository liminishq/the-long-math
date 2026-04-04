#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");
const { loadLang, getMergedDict, t } = require("./lib/load-i18n.js");
const {
  kebabToCamel,
  loadArticleDict,
  mergeArticlePayload,
  prefixRootRelativeLinks,
  buildFaqPageSchema,
  buildBreadcrumbSchema,
  buildArticleSchema,
} = require("./lib/article-helpers.js");

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

/** Slugs under /articles/investing-and-financial-literacy/{slug}/ (kebab-case). */
const ARTICLE_SLUGS = [
  "asset-classes-for-investing",
  "compound-interest",
  "dollar-cost-averaging",
  "inflation",
  "investing-vs-trading",
  "norberts-gambit",
  "rrsp-vs-tfsa-vs-fhsa",
  "the-true-cost-of-financial-advisor-fees",
  "tfsa-withdrawal-rules-over-contribution-penalties",
  "what-is-a-stock",
  "what-is-a-tfsa",
  "what-is-an-fhsa",
  "what-is-an-rrsp",
  "what-is-investing",
  "what-is-the-stock-market",
  "xeqt-and-chill-low-cost-etf-investing",
];

const HUB_KEY = "investingAndFinancialLiteracyIndex";
const HUB_LOGICAL_PATH = "/articles/investing-and-financial-literacy/";

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

/**
 * Skip static HTML for sections we generate from i18n JSON.
 */
function shouldCopyToDist(srcPath) {
  const rel = path.relative(ROOT, srcPath).split(path.sep).join("/");
  if (rel === "articles/investing-and-financial-literacy/index.html") return false;
  if (/^articles\/investing-and-financial-literacy\/[^/]+\/index\.html$/.test(rel)) return false;
  return true;
}

function buildLdJsonBlocks(article, canonical, pathPrefix) {
  const blocks = [];
  if (article.breadcrumbItems && article.breadcrumbItems.length) {
    blocks.push(JSON.stringify(buildBreadcrumbSchema(article.breadcrumbItems, BASE_URL, pathPrefix)));
  }
  blocks.push(JSON.stringify(buildArticleSchema(article, canonical)));
  const faqLd = buildFaqPageSchema(article.faq);
  if (faqLd) blocks.push(JSON.stringify(faqLd));
  return blocks;
}

function build() {
  console.log("Loading i18n...");
  const baseEn = loadLang(ROOT, "en");
  const dictEn = {
    common: baseEn.common,
    calculators: baseEn.calculators,
    meta: baseEn.meta,
    articles: loadArticleDict(ROOT, "en"),
  };

  const env = nunjucks.configure(TEMPLATES_DIR, {
    autoescape: true,
    noCache: true,
  });

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
    return shouldCopyToDist(src);
  });

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

  const htmlLang = (code) => (code === "fr" ? "fr-CA" : "en-CA");

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
        htmlLang: htmlLang(code),
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

  console.log("Generating articles hub + article pages...");
  for (const { code, pathPrefix } of LANGS) {
    const merged = getMergedDict(ROOT, code, dictEn);
    const tFn = (key) => t(merged, key);

    const enHub = dictEn.articles[HUB_KEY];
    const locHub = merged.articles[HUB_KEY];
    const hub = mergeArticlePayload(enHub, locHub);
    const hubLogicalPath = HUB_LOGICAL_PATH;
    const hubCurrentPath = pathPrefix === "" ? hubLogicalPath : pathPrefix + hubLogicalPath;
    const hubCanonical = BASE_URL + hubCurrentPath.replace(/\/+$/, "") + "/";
    const hubHref = getHreflangUrls(hubLogicalPath);
    const hubCtx = {
      lang: code,
      htmlLang: htmlLang(code),
      pathPrefix,
      path: hubCurrentPath,
      canonical: hubCanonical,
      hreflangLinks: [
        { hreflang: "en", url: hubHref.en },
        { hreflang: "fr", url: hubHref.fr },
        { hreflang: "x-default", url: hubHref.xDefault },
      ],
      title: hub.meta.title,
      description: hub.meta.description,
      t: tFn,
      pageId: "articles-hub",
      hub,
      hubMainHtml: prefixRootRelativeLinks(hub.hubMainHtml || "", pathPrefix),
      disclaimerHtml: prefixRootRelativeLinks(hub.disclaimerHtml || "", pathPrefix),
    };
    const hubOut = path.join(
      DIST,
      pathPrefix === "" ? "." : pathPrefix.slice(1),
      "articles",
      "investing-and-financial-literacy",
      "index.html"
    );
    ensureDir(path.dirname(hubOut));
    fs.writeFileSync(hubOut, nunjucks.render("pages/articles-hub.njk", hubCtx), "utf8");
    console.log("  " + hubOut);

    for (const slug of ARTICLE_SLUGS) {
      const articleKey = kebabToCamel(slug);
      const enArt = dictEn.articles[articleKey];
      if (!enArt) {
        console.warn("Missing article JSON for slug:", slug);
        continue;
      }
      const locArt = merged.articles[articleKey];
      const article = mergeArticlePayload(enArt, locArt);
      const logicalPath = `/articles/investing-and-financial-literacy/${slug}/`;
      const currentPath = pathPrefix === "" ? logicalPath : pathPrefix + logicalPath;
      const canonical = BASE_URL + currentPath.replace(/\/+$/, "") + "/";
      const ah = getHreflangUrls(logicalPath);
      const ldJsonBlocks = buildLdJsonBlocks(article, canonical, pathPrefix);
      const artCtx = {
        lang: code,
        htmlLang: htmlLang(code),
        pathPrefix,
        path: currentPath,
        canonical,
        hreflangLinks: [
          { hreflang: "en", url: ah.en },
          { hreflang: "fr", url: ah.fr },
          { hreflang: "x-default", url: ah.xDefault },
        ],
        title: article.meta.title,
        description: article.meta.description,
        t: tFn,
        pageId: "article-" + slug,
        article,
        wrapMainHtml: prefixRootRelativeLinks(article.wrapMainHtml || "", pathPrefix),
        disclaimerHtml: prefixRootRelativeLinks(article.disclaimerHtml || "", pathPrefix),
        ldJsonBlocks,
      };
      const artOut = path.join(
        DIST,
        pathPrefix === "" ? "." : pathPrefix.slice(1),
        "articles",
        "investing-and-financial-literacy",
        slug,
        "index.html"
      );
      ensureDir(path.dirname(artOut));
      fs.writeFileSync(artOut, nunjucks.render("pages/article.njk", artCtx), "utf8");
      console.log("  " + artOut);
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
