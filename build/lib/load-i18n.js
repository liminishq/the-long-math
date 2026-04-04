"use strict";

const fs = require("fs");
const path = require("path");
const { loadArticleDict } = require("./article-helpers.js");

const NAMESPACES = ["common", "calculators", "meta"];

/**
 * Load one namespace JSON for a language.
 * @param {string} root - Project root (where assets/i18n lives)
 * @param {string} lang - Language code (en, fr)
 * @param {string} ns - Namespace (common, calculators, meta)
 * @returns {object}
 */
function loadNamespace(root, lang, ns) {
  const file = path.join(root, "assets", "i18n", lang, ns + ".json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

/**
 * Load all namespaces for a language and merge into one object
 * with top-level keys: common, calculators, meta.
 * @param {string} root - Project root
 * @param {string} lang - Language code
 * @returns {{ common: object, calculators: object, meta: object }}
 */
function loadLang(root, lang) {
  const out = {};
  NAMESPACES.forEach((ns) => {
    out[ns] = loadNamespace(root, lang, ns);
  });
  return out;
}

/**
 * Get nested value by dot key (e.g. "common.nav.home").
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
 * Build merged dict for a language: all namespaces merged so that
 * key "common.nav.home" is dict.common.nav.home.
 * Fallback to English for missing keys.
 */
function getMergedDict(root, lang, dictEn) {
  const dict = loadLang(root, lang);
  return {
    common: dict.common,
    calculators: dict.calculators,
    meta: dict.meta,
    articles: loadArticleDict(root, lang),
    _fallback: dictEn,
  };
}

/**
 * Resolve t(key) from merged dict with English fallback.
 */
function t(merged, key) {
  const parts = key.split(".");
  let v = getValue(merged, key);
  if (v != null && typeof v === "string") return v;
  if (merged._fallback) {
    v = getValue(merged._fallback, key);
    if (v != null && typeof v === "string") return v;
  }
  return key;
}

module.exports = {
  loadLang,
  getMergedDict,
  getValue,
  t,
  NAMESPACES,
};
