# Build-time i18n (The Long Math)

Static HTML is generated at build time so language-specific content is in the HTML, not translated in the browser.

## Run the build

From the project root:

```bash
npm install
npm run build
```

Deploy the **`dist/`** directory (e.g. Cloudflare Pages: set build output to `dist`).

## What the build does

1. Loads translation dictionaries from `assets/i18n/{en,fr}/` (common, calculators, meta).
2. Generates pre-rendered HTML for index and advisor-fee in en and fr.
3. Generates header/footer partials per language (`header.html`, `header-fr.html`, `footer.html`, `footer-fr.html`) for pages that inject them.
4. Copies the rest of the project into `dist/` (other HTML, assets), excluding `build/`, `fr/`, `node_modules/`, `.git/`.

## Adding a language

1. Add `assets/i18n/{code}/` with `common.json`, `calculators.json`, `meta.json`.
2. In `build/build.js`, add `{ code: "xx", pathPrefix: "/xx" }` to the `LANGS` array.
3. Run `npm run build`.

## Adding a page

1. Add keys to `assets/i18n/en/` (and other languages).
2. Add a template under `build/templates/pages/{pageId}.njk` that extends `layout.njk` and uses `{{ t('...') }}`.
3. In `build/build.js`, add `{ id, logicalPath, metaKey, template }` to the `PAGES` array.
4. Run `npm run build`.
