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
const BASE_URL = "https://www.thelongmath.com";

const LANGS = [
  { code: "en", pathPrefix: "" },
  { code: "fr", pathPrefix: "/fr" },
];

const PAGES = [
  { id: "index", logicalPath: "/", metaKey: "home", template: "pages/index.njk" },
  {
    id: "calculators-hub",
    logicalPath: "/calculators/",
    template: "pages/calculators-hub.njk",
  },
  {
    id: "essays-hub",
    logicalPath: "/essays/",
    template: "pages/essays-hub.njk",
  },
  {
    id: "about-page",
    logicalPath: "/about/",
    template: "pages/about-page.njk",
  },
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
  "how-does-a-mortgage-work-in-canada",
  "inflation",
  "investing-vs-trading",
  "leveraged-investing",
  "norberts-gambit",
  "pay-off-your-mortgage-faster-or-invest",
  "what-is-a-non-registered-account",
  "rrsp-vs-tfsa-vs-fhsa",
  "sequence-of-returns-risk",
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
  if (logicalPath === "/") {
    return {
      en: BASE_URL + "/",
      fr: BASE_URL + "/fr/",
      xDefault: BASE_URL + "/",
    };
  }
  return {
    en: BASE_URL + logicalPath,
    fr: BASE_URL + "/fr" + logicalPath,
    xDefault: BASE_URL + logicalPath,
  };
}

/**
 * Calculators landing page copy (EN/FR JSON under assets/i18n/{lang}/calculators-hub.json).
 */
function loadCalculatorsHubPage(root, lang) {
  const p = path.join(root, "assets", "i18n", lang, "calculators-hub.json");
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    raw = null;
  }
  if (!raw) {
    if (lang === "en") {
      throw new Error("Missing assets/i18n/en/calculators-hub.json");
    }
    return loadCalculatorsHubPage(root, "en");
  }
  return JSON.parse(raw);
}

/**
 * Beyond the Numbers — essays landing (assets/i18n/{lang}/essays-hub.json).
 */
function loadEssaysHubPage(root, lang) {
  const p = path.join(root, "assets", "i18n", lang, "essays-hub.json");
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    raw = null;
  }
  if (!raw) {
    if (lang === "en") {
      throw new Error("Missing assets/i18n/en/essays-hub.json");
    }
    return loadEssaysHubPage(root, "en");
  }
  return JSON.parse(raw);
}

/**
 * About page copy (assets/i18n/{lang}/about-page.json).
 */
function loadAboutPage(root, lang) {
  const p = path.join(root, "assets", "i18n", lang, "about-page.json");
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    raw = null;
  }
  if (!raw) {
    if (lang === "en") {
      throw new Error("Missing assets/i18n/en/about-page.json");
    }
    return loadAboutPage(root, "en");
  }
  return JSON.parse(raw);
}

/**
 * Skip static HTML for sections we generate from i18n JSON.
 */
function shouldCopyToDist(srcPath) {
  const rel = path.relative(ROOT, srcPath).split(path.sep).join("/");
  if (rel === "index.html") return false;
  if (rel === "calculators/index.html") return false;
  if (rel === "essays/index.html") return false;
  if (rel === "about/index.html") return false;
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

/**
 * Newsletter signup block before FAQ section, or before related-articles,
 * or before closing </article> if neither marker exists.
 */
function injectNewsletterBeforeFaq(html, env) {
  const block = env.render("partials/newsletter-article-block.njk", {
    newsletterHeadingId: "newsletter-article-heading",
  });

  const faqMarkers = [
    '<h2 id="faq">',
    "Frequently Asked Questions",
    "Frequently asked questions",
    'class="faq-accordion"',
  ];

  for (const marker of faqMarkers) {
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) continue;
    const sectionStart = html.lastIndexOf("<section", markerIdx);
    if (sectionStart !== -1) {
      return html.slice(0, sectionStart) + block + "\n" + html.slice(sectionStart);
    }
  }

  const relatedNeedle = '<section class="section-card related-articles">';
  if (html.includes(relatedNeedle)) {
    return html.replace(relatedNeedle, block + "\n" + relatedNeedle);
  }

  const close = "</article>";
  const idx = html.lastIndexOf(close);
  if (idx === -1) return html;
  return html.slice(0, idx) + block + "\n" + html.slice(idx);
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
  env.addFilter("jsonstr", function (str) {
    var out = JSON.stringify(str == null ? "" : String(str));
    return new nunjucks.runtime.SafeString(out);
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
      const currentPath =
        logicalPath === "/" ? (pathPrefix ? pathPrefix + "/" : "/") : pathPrefix + logicalPath;
      const canonical = BASE_URL + currentPath;
      const hreflangUrlsObj = getHreflangUrls(logicalPath);
      const hreflangLinks = [
        { hreflang: "en", url: hreflangUrlsObj.en },
        { hreflang: "fr", url: hreflangUrlsObj.fr },
        { hreflang: "x-default", url: hreflangUrlsObj.xDefault },
      ];

      let title;
      let description;
      let calculatorsHub = null;
      let essaysHub = null;
      let aboutPage = null;
      if (page.id === "calculators-hub") {
        calculatorsHub = loadCalculatorsHubPage(ROOT, code);
        title = calculatorsHub.title;
        description = calculatorsHub.description;
      } else if (page.id === "essays-hub") {
        essaysHub = loadEssaysHubPage(ROOT, code);
        title = essaysHub.title;
        description = essaysHub.description;
      } else if (page.id === "about-page") {
        aboutPage = loadAboutPage(ROOT, code);
        title = aboutPage.title;
        description = aboutPage.description;
      } else {
        const meta = merged.meta && page.metaKey && merged.meta[page.metaKey];
        title = (meta && meta.title) || page.id;
        description = (meta && meta.description) || "";
      }

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
        bodyClass:
          page.id === "index" ? "home" : page.id === "essays-hub" ? "page-essays" : "",
        calculatorsHub,
        essaysHub,
        aboutPage,
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
        wrapMainHtml: injectNewsletterBeforeFaq(
          prefixRootRelativeLinks(article.wrapMainHtml || "", pathPrefix),
          env
        ),
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

  emitFrenchStaticMirrors();

  syncEnglishArticlesHtmlToSource();
  syncFrenchArticlesHtmlToSource();
  syncFrenchStaticHtmlToSource();
  syncEnglishHomeHtmlToSource();
  syncEnglishCalculatorsHubToSource();
  syncEnglishEssaysHubToSource();
  syncEnglishAboutPageToSource();

  console.log("Build complete. Output: " + DIST);
}

/**
 * English-only static pages (contact) are copied to dist/,
 * but nav + language switcher target /fr/... for those paths. Emit French copies with
 * safe href rewrites so /fr/about/, /fr/essays/, /fr/contact/, /fr/calculators/ resolve.
 */
function rewriteHtmlForFrStaticMirror(html) {
  let s = html;
  s = s.replace(/<html\s+lang="[^"]*"/i, '<html lang="fr-CA"');
  if (!s.includes("i18n.js")) {
    s = s.replace(
      '<script defer src="/assets/js/site.js"></script>',
      '<script src="/assets/js/i18n.js"></script>\n  <script defer src="/assets/js/site.js"></script>'
    );
  }
  s = s.replace(
    /https:\/\/www\.thelongmath\.com\/(about|essays|contact)\//g,
    "https://www.thelongmath.com/fr/$1/"
  );
  const hrefPairs = [
    ['href="/calculators/advisor-fee/', 'href="/fr/calculators/advisor-fee/'],
    ['href="/articles/', 'href="/fr/articles/'],
    ['href="/about/', 'href="/fr/about/'],
    ['href="/essays/', 'href="/fr/essays/'],
  ];
  for (const [from, to] of hrefPairs) {
    s = s.split(from).join(to);
  }
  s = s.replace(/href="\/contact\/"/g, 'href="/fr/contact/"');
  return s;
}

function emitFrenchStaticMirrors() {
  const rels = [
    "contact/index.html",
  ];
  for (const rel of rels) {
    const src = path.join(DIST, rel);
    if (!fs.existsSync(src)) {
      console.warn("emitFrenchStaticMirrors: missing " + src);
      continue;
    }
    const raw = fs.readFileSync(src, "utf8");
    const out = rewriteHtmlForFrStaticMirror(raw);
    const outPath = path.join(DIST, "fr", rel);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, out, "utf8");
    console.log("  " + outPath);
  }
}

/**
 * Mirror generated French landing + static pages into fr/ so a static server at repo root
 * serves /fr/, /fr/about/, etc. (same idea as article mirrors).
 */
function syncFrenchStaticHtmlToSource() {
  const files = [
    path.join("fr", "index.html"),
    path.join("fr", "about", "index.html"),
    path.join("fr", "essays", "index.html"),
    path.join("fr", "contact", "index.html"),
    path.join("fr", "calculators", "index.html"),
  ];
  for (const rel of files) {
    const src = path.join(DIST, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(ROOT, rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
  console.log("Mirrored French landing + static pages to fr/ (for local static server from repo root).");
}

/**
 * Mirror generated English homepage from dist/index.html to repo root so serving
 * the project root matches the same template-driven home as dist/ and Cloudflare.
 */
function syncEnglishHomeHtmlToSource() {
  const src = path.join(DIST, "index.html");
  const dest = path.join(ROOT, "index.html");
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
  console.log("Mirrored English homepage to index.html (for local static server from repo root).");
}

/**
 * Mirror generated English calculators hub from dist/ to repo root calculators/index.html.
 */
function syncEnglishCalculatorsHubToSource() {
  const src = path.join(DIST, "calculators", "index.html");
  const dest = path.join(ROOT, "calculators", "index.html");
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log("Mirrored English calculators hub to calculators/index.html (for local static server from repo root).");
}

/**
 * Mirror generated English essays hub (Beyond the Numbers) to essays/index.html at repo root.
 */
function syncEnglishEssaysHubToSource() {
  const src = path.join(DIST, "essays", "index.html");
  const dest = path.join(ROOT, "essays", "index.html");
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log("Mirrored English essays hub to essays/index.html (for local static server from repo root).");
}

/**
 * Mirror generated English About page to about/index.html at repo root.
 */
function syncEnglishAboutPageToSource() {
  const src = path.join(DIST, "about", "index.html");
  const dest = path.join(ROOT, "about", "index.html");
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log("Mirrored English About page to about/index.html (for local static server from repo root).");
}

/**
 * Copy generated English article HTML from dist/ into articles/ so a simple static
 * server run from the repo root (e.g. python -m http.server) can serve /articles/...
 * without pointing at dist/. Not used for deploy; dist/ remains the deploy target.
 */
function syncEnglishArticlesHtmlToSource() {
  const srcBase = path.join(DIST, "articles", "investing-and-financial-literacy");
  const destBase = path.join(ROOT, "articles", "investing-and-financial-literacy");
  if (!fs.existsSync(srcBase)) return;

  const hubSrc = path.join(srcBase, "index.html");
  if (fs.existsSync(hubSrc)) {
    ensureDir(destBase);
    fs.copyFileSync(hubSrc, path.join(destBase, "index.html"));
  }

  for (const slug of ARTICLE_SLUGS) {
    const from = path.join(srcBase, slug, "index.html");
    if (!fs.existsSync(from)) continue;
    const toDir = path.join(destBase, slug);
    ensureDir(toDir);
    fs.copyFileSync(from, path.join(toDir, "index.html"));
  }

  console.log("Mirrored English article pages to articles/investing-and-financial-literacy/ (for local static server from repo root).");
}

/**
 * Same as syncEnglishArticlesHtmlToSource, but for French so /fr/articles/... works
 * when the static server uses the repo root (language switcher targets /fr/...).
 */
function syncFrenchArticlesHtmlToSource() {
  const srcBase = path.join(DIST, "fr", "articles", "investing-and-financial-literacy");
  const destBase = path.join(ROOT, "fr", "articles", "investing-and-financial-literacy");
  if (!fs.existsSync(srcBase)) return;

  const hubSrc = path.join(srcBase, "index.html");
  if (fs.existsSync(hubSrc)) {
    ensureDir(destBase);
    fs.copyFileSync(hubSrc, path.join(destBase, "index.html"));
  }

  for (const slug of ARTICLE_SLUGS) {
    const from = path.join(srcBase, slug, "index.html");
    if (!fs.existsSync(from)) continue;
    const toDir = path.join(destBase, slug);
    ensureDir(toDir);
    fs.copyFileSync(from, path.join(toDir, "index.html"));
  }

  console.log("Mirrored French article pages to fr/articles/investing-and-financial-literacy/ (for local static server from repo root).");
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
