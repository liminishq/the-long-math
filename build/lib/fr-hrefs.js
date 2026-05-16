"use strict";

function splitPathQueryHash(rel) {
  let path = rel;
  let rest = "";
  const q = path.indexOf("?");
  const h = path.indexOf("#");
  let cut = path.length;
  if (q !== -1) cut = Math.min(cut, q);
  if (h !== -1) cut = Math.min(cut, h);
  if (cut < path.length) {
    rest = path.slice(cut);
    path = path.slice(0, cut);
  }
  if (!path.startsWith("/")) path = "/" + path;
  return { path, suffix: rest };
}

/**
 * Canonical root-relative URL for bilingual shell.
 *
 * English-only in this repo:
 * - Individual calculator pages (except advisor-fee shell in French)
 * - /fees/ hub
 * - /tools/ data pages
 *
 * @param {string} code "en" | "fr"
 * @param {string} pathPrefix "" or "/fr"
 * @param {string} rel root-relative URL
 * @returns {string}
 */
function localizeRootHref(code, pathPrefix, rel) {
  if (!rel) return rel;
  const { path, suffix } = splitPathQueryHash(rel);

  if (code !== "fr" || pathPrefix !== "/fr") {
    return path + suffix;
  }

  if (path === "/fees" || path.startsWith("/fees/")) {
    return path + suffix;
  }
  if (path === "/tools" || path.startsWith("/tools/")) {
    return path + suffix;
  }

  if (path === "/calculators" || path === "/calculators/") {
    if (!suffix) return "/fr/calculators/";
    return `/fr/calculators${suffix}`;
  }
  if (path === "/calculators/advisor-fee" || path === "/calculators/advisor-fee/") {
    if (!suffix) return "/fr/calculators/advisor-fee/";
    return `/fr/calculators/advisor-fee${suffix}`;
  }
  if (path.startsWith("/calculators/advisor-fee/")) {
    return path + suffix;
  }
  if (path.startsWith("/calculators/")) {
    return path + suffix;
  }

  if (path === "/") {
    if (!suffix) return "/fr/";
    return `/fr/${suffix}`;
  }

  return pathPrefix + path + suffix;
}

/**
 * After prefixRootRelativeLinks adds /fr to every root-relative href/src, undo it for
 * calculator, tool, and fee routes that exist only under English paths, except the
 * French calculators hub and advisor-fee landing page.
 *
 * @param {string} html
 * @returns {string}
 */
function fixPrefixedFrenchInternalLinks(html) {
  if (!html) return "";

  return html.replace(/href="(\/fr\/[^"#]*)"/g, (m, url) => {
    let end = url.length;
    const q = url.indexOf("?");
    const h = url.indexOf("#");
    if (q !== -1) end = Math.min(end, q);
    if (h !== -1) end = Math.min(end, h);
    const path = url.slice(0, end);
    const suf = url.slice(end);

    if (path === "/fr/tools" || path.startsWith("/fr/tools/")) {
      return `href="${path.slice(3)}${suf}"`;
    }
    if (path === "/fr/fees" || path.startsWith("/fr/fees/")) {
      return `href="${path.slice(3)}${suf}"`;
    }

    const hubPrefix = "/fr/calculators";
    if (!path.startsWith(hubPrefix)) {
      return m;
    }

    const afterHub = path.slice(hubPrefix.length);
    if (afterHub === "" || afterHub === "/") {
      if (!suf) return 'href="/fr/calculators/"';
      return `href="/fr/calculators${suf}"`;
    }

    const slugPath = afterHub.startsWith("/") ? afterHub.slice(1) : afterHub;
    const segments = slugPath.split("/").filter(Boolean);
    const first = segments[0] || "";

    if (first === "advisor-fee" && segments.length === 1) {
      if (!suf) return 'href="/fr/calculators/advisor-fee/"';
      return `href="/fr/calculators/advisor-fee${suf}"`;
    }

    return `href="/calculators/${slugPath}${suf}"`;
  });
}

module.exports = { localizeRootHref, fixPrefixedFrenchInternalLinks };
