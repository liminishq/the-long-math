# Build-time i18n (The Long Math)

Static HTML is generated at build time so language-specific content is in the HTML, not translated in the browser.

## Run the build

From the project root:

```bash
npm install
npm run build
```

Deploy the **`dist/`** directory (e.g. Cloudflare Pages: set build output to `dist`).

### Local preview

- **Recommended:** `npm run build`, then serve **`dist/`** (e.g. `cd dist` and `python -m http.server 8000`). French lives under `/fr/...` there.
- **Repo root:** After `npm run build`, the build also copies English article HTML into `articles/investing-and-financial-literacy/` so paths like `/articles/investing-and-financial-literacy/` work if your static server uses the project root. Those files are gitignored mirrors, not the source of truth.

Remove any **stale** subfolders under `articles/investing-and-financial-literacy/` left from older layouts; only slugs matching `ARTICLE_SLUGS` in `build/build.js` are updated each build.

## What the build does

1. Loads translation dictionaries from `assets/i18n/{en,fr}/` (`common`, `calculators`, `meta`) plus **per-article JSON** under `assets/i18n/{en,fr}/articles/*.json`.
2. Generates pre-rendered HTML for index and advisor-fee in en and fr.
3. Generates the **Investment and Financial Literacy** hub and **all articles** under `/articles/investing-and-financial-literacy/` for en and `/fr/articles/...` for fr (templates: `build/templates/pages/article.njk`, `articles-hub.njk`). Root-relative links in article bodies are prefixed with `/fr` on French builds.
4. Generates header/footer partials per language (`header.html`, `header-fr.html`, `footer.html`, `footer-fr.html`) for pages that inject them.
5. Copies the rest of the project into `dist/` (other HTML, assets), excluding `build/`, `fr/`, `node_modules/`, `.git/`, and the old static paths for generated articles (see `shouldCopyToDist` in `build/build.js`).

## Articles (per-article JSON)

- **English source:** `assets/i18n/en/articles/{slug}.json` (one file per slug, kebab-case filename).
- **French:** `assets/i18n/fr/articles/{slug}.json` — same shape; missing or empty fields fall back to English at build time.
- **Hub listing:** `investing-and-financial-literacy-index.json` (camelCase key `investingAndFinancialLiteracyIndex` in the merged loader).
- **Slugs** emitted by the build are listed in `ARTICLE_SLUGS` in `build/build.js` (keep in sync when adding an article).
- **Regenerating from legacy HTML** (if you restore old files under `articles/investing-and-financial-literacy/`): `node tools/extract-articles-to-json.cjs` — prefer editing JSON directly once migrated.

## Adding a language

1. Add `assets/i18n/{code}/` with `common.json`, `calculators.json`, `meta.json`.
2. In `build/build.js`, add `{ code: "xx", pathPrefix: "/xx" }` to the `LANGS` array.
3. Run `npm run build`.

## Adding a page

1. Add keys to `assets/i18n/en/` (and other languages).
2. Add a template under `build/templates/pages/{pageId}.njk` that extends `layout.njk` and uses `{{ t('...') }}`.
3. In `build/build.js`, add `{ id, logicalPath, metaKey, template }` to the `PAGES` array.
4. Run `npm run build`.

## Adding an article under Investing and Financial Literacy

1. Add `assets/i18n/en/articles/{slug}.json` and `assets/i18n/fr/articles/{slug}.json` (copy EN to FR first, then translate).
2. Add `{slug}` to `ARTICLE_SLUGS` in `build/build.js`.
3. Add the English search entry in `assets/data/search-index.json` and a duplicate with `"url": "/fr/articles/investing-and-financial-literacy/{slug}/"` (or extend the index generator if you add one).
4. After changing French titles/descriptions, run `node tools/sync-fr-search-index.cjs` to refresh FR search rows from `assets/i18n/fr/articles/*.json`.
5. Run `npm run build`.
