/**
 * Run after `node build/build.js` (see npm `build` script).
 * (1) Every slug in build/build.js ARTICLE_SLUGS must appear as a featured-card or journey-item-link in EN and FR hub JSON.
 * (2) Every /assets/css or /assets/js file referenced from dist HTML must exist under dist/assets/.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const BUILD_JS = path.join(ROOT, "build", "build.js");
const HUB_EN = path.join(ROOT, "assets", "i18n", "en", "articles", "investing-and-financial-literacy-index.json");
const HUB_FR = path.join(ROOT, "assets", "i18n", "fr", "articles", "investing-and-financial-literacy-index.json");

const ASSET_RE = /(?:href|src)="(\/assets\/(?:css|js)\/[^"?]+\.(?:css|js))(?:\?[^"]*)?"/g;

function parseArticleSlugs() {
  const src = fs.readFileSync(BUILD_JS, "utf8");
  const start = src.indexOf("const ARTICLE_SLUGS = [");
  if (start === -1) throw new Error("ARTICLE_SLUGS not found in build/build.js");
  const end = src.indexOf("];", start);
  if (end === -1) throw new Error("ARTICLE_SLUGS array not closed");
  const slice = src.slice(start, end);
  const slugs = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(slice)) !== null) slugs.push(m[1]);
  return slugs;
}

function parseArticleLangSlugs() {
  const src = fs.readFileSync(BUILD_JS, "utf8");
  const start = src.indexOf("const ARTICLE_LANG_SLUGS = {");
  if (start === -1) return {};
  const end = src.indexOf("};", start);
  if (end === -1) return {};
  const slice = src.slice(start, end);
  const map = {};
  const re = /"([^"]+)"\s*:\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(slice)) !== null) {
    const slug = m[1];
    const body = m[2];
    const fr = body.match(/fr\s*:\s*"([^"]+)"/);
    if (fr) map[slug] = { fr: fr[1] };
  }
  return map;
}

function hubMainHtml(p) {
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return j.hubMainHtml || "";
}

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkHtmlFiles(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

function main() {
  const errors = [];

  const slugs = parseArticleSlugs();
  const langSlugs = parseArticleLangSlugs();
  const enHub = hubMainHtml(HUB_EN);
  const frHub = hubMainHtml(HUB_FR);

  for (const slug of slugs) {
    const enNeedle = `/articles/investing-and-financial-literacy/${slug}/`;
    const frSlug = (langSlugs[slug] && langSlugs[slug].fr) || slug;
    const frNeedle = `/articles/investing-and-financial-literacy/${frSlug}/`;
    const enFeaturedCard = `class="featured-card" href="${enNeedle}"`;
    const enJourneyItem = `href="${enNeedle}" class="journey-item-link"`;
    const frFeaturedCard = `class="featured-card" href="${frNeedle}"`;
    const frJourneyItem = `href="${frNeedle}" class="journey-item-link"`;
    const enHasCard = enHub.includes(enFeaturedCard) || enHub.includes(enJourneyItem);
    const frHasCard = frHub.includes(frFeaturedCard) || frHub.includes(frJourneyItem);
    if (!enHasCard) {
      errors.push(
        `EN hub missing featured-card or journey-item-link for slug "${slug}" (${path.relative(ROOT, HUB_EN)})`
      );
    }
    if (!frHasCard) {
      errors.push(
        `FR hub missing featured-card or journey-item-link for slug "${slug}" (${path.relative(ROOT, HUB_FR)})`
      );
    }
  }

  if (!fs.existsSync(DIST)) {
    errors.push("dist/ missing; run build first.");
  } else {
    const htmlFiles = walkHtmlFiles(DIST);
    for (const file of htmlFiles) {
      const body = fs.readFileSync(file, "utf8");
      let m;
      ASSET_RE.lastIndex = 0;
      while ((m = ASSET_RE.exec(body)) !== null) {
        const urlPath = m[1];
        const rel = urlPath.replace(/^\//, "").split("/").join(path.sep);
        const abs = path.join(DIST, rel);
        if (!fs.existsSync(abs)) {
          errors.push(`Missing ${urlPath} (referenced from ${path.relative(ROOT, file)})`);
        }
      }
    }
  }

  if (errors.length) {
    console.error("verify-article-hub-and-dist-assets:\n");
    for (const e of errors) console.error("  - " + e);
    console.error(
      "\nFix hub: add a featured-card or journey-item-link in hubMainHtml for each slug in both EN and FR investing-and-financial-literacy-index.json."
    );
    console.error(
      "Fix dist assets: run npm run build, then git add -f the new files under dist/assets/css/ and dist/assets/js/ if you publish prebuilt dist/ from git.\n"
    );
    process.exit(1);
  }

  console.log(
    "verify-article-hub-and-dist-assets: OK (all ARTICLE_SLUGS linked on EN+FR hub; all /assets refs from dist/**/*.html exist)."
  );
}

main();
