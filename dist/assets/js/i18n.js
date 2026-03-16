/**
 * The Long Math — i18n (internationalization)
 * Language-agnostic translation helper and locale-aware formatting.
 * Client-side; designed so pre-rendered/SSR can reuse the same dictionaries.
 */
(function () {
  "use strict";

  const NAMESPACES = ["common", "calculators", "meta"];
  const BASE = "/assets/i18n";
  const cache = { en: null, fr: null };

  /**
   * Current UI language. Prefer document lang (set by page), then path (/fr/ → fr), else en.
   */
  function getLang() {
    const html = document.documentElement;
    const langAttr = (html && html.getAttribute("lang")) || "";
    const path = (window.location && window.location.pathname) || "";
    if (path.indexOf("/fr") === 0) return "fr";
    const code = (langAttr && langAttr.toLowerCase().split("-")[0]) || "";
    if (code === "fr") return "fr";
    return "en";
  }

  /**
   * Load one namespace for a language. Returns promise of parsed JSON.
   */
  function loadNamespace(lang, ns) {
    const url = BASE + "/" + lang + "/" + ns + ".json";
    return fetch(url).then(function (r) {
      if (!r.ok) return {};
      return r.json();
    }).catch(function () { return {}; });
  }

  /**
   * Load all namespaces for a language and merge into a single object.
   */
  function loadLang(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    return Promise.all(NAMESPACES.map(function (ns) {
      return loadNamespace(lang, ns);
    })).then(function (parts) {
      const out = {};
      NAMESPACES.forEach(function (ns, i) {
        out[ns] = parts[i] || {};
      });
      cache[lang] = out;
      return out;
    });
  }

  /**
   * Get nested value by dot key, e.g. "common.nav.home".
   */
  function getValue(obj, key) {
    if (!obj || !key) return undefined;
    const parts = key.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length && cur != null; i++) {
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * Translate key for given language. Falls back to English if missing.
   */
  function t(key, lang) {
    const L = lang || getLang();
    const dict = cache[L];
    const enDict = cache.en;
    if (dict) {
      const v = getValue(dict, key);
      if (v != null && typeof v === "string") return v;
    }
    if (L !== "en" && enDict) {
      const v = getValue(enDict, key);
      if (v != null && typeof v === "string") return v;
    }
    return key;
  }

  /**
   * Locale code for formatting (en-CA, fr-CA).
   */
  function formatLocale(lang) {
    return (lang || getLang()) === "fr" ? "fr-CA" : "en-CA";
  }

  function formatCurrency(n, lang) {
    if (n != null && !Number.isFinite(n)) return "–";
    const loc = formatLocale(lang);
    return Number.isFinite(n)
      ? Math.round(n).toLocaleString(loc, {
          style: "currency",
          currency: "CAD",
          maximumFractionDigits: 0
        })
      : "–";
  }

  function formatNumber(n, options, lang) {
    if (n != null && !Number.isFinite(n)) return "–";
    const loc = formatLocale(lang);
    const opts = options && typeof options === "object" ? options : { maximumFractionDigits: 2 };
    return Number.isFinite(n) ? n.toLocaleString(loc, opts) : "–";
  }

  /**
   * Format a decimal as percent (e.g. 0.0712 → "7.12%").
   * options can be { decimals: 2 } or similar.
   */
  function formatPercent(dec, options, lang) {
    if (dec != null && !Number.isFinite(dec)) return "–";
    const decimals = (options && options.decimals != null) ? options.decimals : 2;
    const loc = formatLocale(lang);
    const pct = Number.isFinite(dec) ? dec * 100 : NaN;
    if (!Number.isFinite(pct)) return "–";
    return pct.toFixed(decimals) + "%";
  }

  /**
   * Apply translations to the document (or a given element).
   * Static page content is now pre-rendered at build time; this is kept only for
   * runtime-only strings (e.g. calculator dynamic messages) and backwards compatibility.
   */
  function applyToDocument(root) {
    const el = root || document.body;
    if (!el) return;
    el.querySelectorAll("[data-i18n]").forEach(function (node) {
      const key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    });
    el.querySelectorAll("[data-i18n-attr]").forEach(function (node) {
      const spec = node.getAttribute("data-i18n-attr");
      if (!spec) return;
      const [attr, key] = spec.split(":").map(function (s) { return s.trim(); });
      if (attr && key) node.setAttribute(attr, t(key));
    });
  }

  /**
   * Set language switcher link hrefs from current path.
   * Expects elements with id="lang-link-en" and id="lang-link-fr".
   * Also updates any [data-locale-path] hrefs with the current locale prefix.
   */
  function setLanguageSwitcherLinks() {
    const path = (window.location && window.location.pathname) || "/";
    const lang = getLang();
    const prefix = lang === "fr" ? "/fr" : "";

    const enLink = document.getElementById("lang-link-en");
    const frLink = document.getElementById("lang-link-fr");
    if (enLink) {
      enLink.href = path.indexOf("/fr") === 0 ? path.replace(/^\/fr\/?/, "/") || "/" : path;
    }
    if (frLink) {
      frLink.href = path.indexOf("/fr") === 0 ? path : "/fr" + (path === "/" ? "" : path);
    }

    document.querySelectorAll("[data-locale-path]").forEach(function (node) {
      const localePath = node.getAttribute("data-locale-path");
      if (localePath) {
        const href = prefix + (localePath === "/" ? "" : localePath) || "/";
        node.setAttribute("href", href);
      }
    });
  }

  /**
   * Promise that resolves when current language and English are loaded.
   */
  const ready = (function () {
    const lang = getLang();
    const load = lang === "en" ? loadLang("en") : Promise.all([loadLang("en"), loadLang("fr")]).then(function () { return cache[lang]; });
    return load;
  })();

  // Public API
  window.TLM = window.TLM || {};
  window.TLM.i18n = {
    getLang: getLang,
    t: t,
    applyToDocument: applyToDocument,
    setLanguageSwitcherLinks: setLanguageSwitcherLinks,
    ready: ready
  };
  window.TLM.format = {
    currency: formatCurrency,
    number: formatNumber,
    percent: formatPercent,
    locale: formatLocale
  };
})();
