# Build-time i18n (The Long Math)

Static HTML is generated at build time so language-specific content is in the HTML, not translated in the browser.

## Run the build

From the project root:

```bash
npm install
npm run build
```

Deploy the **`dist/`** directory (e.g. Cloudflare Pages: set build output to `dist`).

**Fingerprinted bundles in `dist`:** HTML under `dist/` references hashed names such as `/assets/css/styles.<hash>.css`. If Pages (or any host) publishes a **prebuilt** `dist/` from git without running `npm run build` on deploy, those hashed files must exist in the repo under `dist/assets/css/` and `dist/assets/js/` (use `git add -f` because `dist/` is mostly gitignored). Otherwise `/assets/css/...` can 404 or fall back to HTML, and pages load with no styling. After `npm run build`, add any **new** hashed pairs that `dist/**/*.html` references.

### Local preview

- **Recommended:** `npm run build`, then serve **`dist/`** (e.g. `cd dist` and `python -m http.server 8000`). English and French article URLs both work there.
- **Repo root:** After `npm run build`, the build mirrors generated article HTML into **`articles/investing-and-financial-literacy/`** (English) and **`fr/articles/investing-and-financial-literacy/`** (French) so a server on the project root can serve `/articles/...` and **`/fr/articles/...`** (e.g. the Français link) without 404s. **Commit both mirrors** after changing article JSON so production (or any host that serves the repo root) always has French HTML, not only `dist/` on CI. **Cloudflare Pages:** set **Build output directory** to **`dist`** (recommended); if output were the repo root without committing `fr/articles/...`, `/fr/articles/...` could be missing and fall back to the wrong page.
- **French nav (repo root):** The header rewrites nav links to **`/fr/...`** when you are under a French URL. The build also emits French copies of **`/about/`**, **`/essays/`**, **`/contact/`**, the **calculators hub** (`/calculators/`), and mirrors them into **`fr/about/`**, **`fr/essays/`**, **`fr/contact/`**, **`fr/calculators/`**, plus **`fr/index.html`**, so **`/fr/about/`**, **`/fr/calculators/`**, etc. resolve instead of 404ing. (Body copy is still English until those pages are fully translated in the build.)

Remove any **stale** subfolders under `articles/investing-and-financial-literacy/` left from older layouts; only slugs matching `ARTICLE_SLUGS` in `build/build.js` are updated each build.

## What the build does

1. Loads translation dictionaries from `assets/i18n/{en,fr}/` (`common`, `calculators`, `meta`) plus **per-article JSON** under `assets/i18n/{en,fr}/articles/*.json`.
2. Generates pre-rendered HTML for index and advisor-fee in en and fr.
3. Generates the **Investment and Financial Literacy** hub and **all articles** under `/articles/investing-and-financial-literacy/` for en and `/fr/articles/...` for fr (templates: `build/templates/pages/article.njk`, `articles-hub.njk`). Root-relative links in article bodies are prefixed with `/fr` on French builds.
4. Generates header/footer partials per language (`header.html`, `header-fr.html`, `footer.html`, `footer-fr.html`) for pages that inject them.
5. Copies the rest of the project into `dist/` (other HTML, assets), excluding `build/`, `fr/`, `node_modules/`, `.git/`, and the old static paths for generated articles (see `shouldCopyToDist` in `build/build.js`).
6. Writes French copies of the static pages in step 5 (`about`, `essays`, `contact`, calculators hub) into `dist/fr/...` with `lang="fr-CA"`, `i18n.js` included, and in-page links adjusted where a French URL exists (e.g. `/fr/articles/…`, `/fr/calculators/advisor-fee/`). Mirrors those plus `dist/fr/index.html` into the repo’s `fr/` tree for root-based local servers (`emitFrenchStaticMirrors`, `syncFrenchStaticHtmlToSource` in `build/build.js`).

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
