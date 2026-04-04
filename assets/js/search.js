// assets/js/search.js — site search (vanilla)
(function () {
  "use strict";

  var STOP = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "is",
    "it",
    "its",
    "do",
    "does",
    "did",
    "get",
    "got",
    "should",
    "can",
    "could",
    "would",
    "will",
    "have",
    "has",
    "had",
    "what",
    "how",
    "why",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "yours",
    "they",
    "them",
    "their",
    "this",
    "that",
    "these",
    "those",
    "to",
    "of",
    "in",
    "on",
    "for",
    "at",
    "by",
    "from",
    "with",
    "as",
    "be",
    "been",
    "being",
    "am",
    "are",
    "was",
    "were",
    "not",
    "no",
    "so",
    "if",
    "than",
    "then",
    "into",
    "out",
    "up",
    "down",
    "over",
    "also",
    "just",
    "only",
    "about",
    "there",
    "here",
    "may",
    "might",
    "must",
    "shall",
  ]);

  var indexCache = null;
  var indexPromise = null;
  var overlay;
  var input;
  var resultsEl;
  var debugEl;
  var chips;
  var currentFilter = "all";
  var selectedIndex = -1;
  var flatResults = [];
  var searchInited = false;

  function isLocalDev() {
    var h = (window.location && window.location.hostname) || "";
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function getLocalePrefix() {
    if (window.TLM && window.TLM.i18n && window.TLM.i18n.getLang) {
      return window.TLM.i18n.getLang() === "fr" ? "/fr" : "";
    }
    var p = (window.location && window.location.pathname) || "";
    return p.indexOf("/fr") === 0 ? "/fr" : "";
  }

  function resolveUrl(url) {
    if (!url || /^https?:\/\//i.test(url)) return url;
    var pre = getLocalePrefix();
    if (!pre) return url;
    if (url === "/") return pre + "/";
    return pre + url;
  }

  function indexUrl() {
    var path = (window.location && window.location.pathname) || "/";
    var parts = path.replace(/\/$/, "").split("/").filter(Boolean);
    var depth = parts.length;
    var prefix = depth ? new Array(depth + 1).join("../") : "";
    return prefix + "assets/data/search-index.json";
  }

  function tokenize(q) {
    return (q || "")
      .toLowerCase()
      .trim()
      .split(/[^a-z0-9%]+/)
      .filter(function (t) {
        return t && !STOP.has(t);
      });
  }

  function loadIndex() {
    if (indexCache) return Promise.resolve(indexCache);
    if (indexPromise) return indexPromise;
    indexPromise = fetch(indexUrl())
      .then(function (r) {
        if (!r.ok) throw new Error("search index");
        return r.json();
      })
      .then(function (data) {
        indexCache = Array.isArray(data) ? data : [];
        return indexCache;
      })
      .catch(function () {
        indexCache = [];
        return indexCache;
      });
    return indexPromise;
  }

  function scoreEntry(entry, tokens, phrase) {
    var titleLower = (entry.title || "").toLowerCase();
    var descLower = (entry.desc || "").toLowerCase();
    var kwList = (entry.keywords || []).map(function (k) {
      return String(k).toLowerCase();
    });
    var score = 0;
    var i;
    var t;
    var k;
    var matched = 0;

    if (!tokens.length && phrase) {
      tokens = [phrase];
    }

    if (phrase.length > 1) {
      for (i = 0; i < kwList.length; i++) {
        if (kwList[i].indexOf(phrase) !== -1) {
          score += 6;
          break;
        }
      }
    }

    for (i = 0; i < kwList.length; i++) {
      if (kwList[i] === phrase) {
        score += 5;
        break;
      }
    }

    for (t = 0; t < tokens.length; t++) {
      if (titleLower.indexOf(tokens[t]) !== -1) score += 4;
    }

    for (t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      if (tok.length < 2) continue;
      for (k = 0; k < kwList.length; k++) {
        if (kwList[k].indexOf(tok) !== -1) {
          score += 3;
          break;
        }
      }
    }

    var anyDesc = false;
    for (t = 0; t < tokens.length; t++) {
      if (descLower.indexOf(tokens[t]) !== -1) {
        anyDesc = true;
        break;
      }
    }
    if (anyDesc) score += 1;

    for (t = 0; t < tokens.length; t++) {
      var tok2 = tokens[t];
      if (
        titleLower.indexOf(tok2) !== -1 ||
        descLower.indexOf(tok2) !== -1 ||
        kwList.some(function (kw) {
          return kw.indexOf(tok2) !== -1;
        })
      ) {
        matched++;
      }
    }
    if (tokens.length) {
      score += 8 * (matched / tokens.length);
    }

    return score;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightTitle(title, tokens) {
    if (!tokens.length) return escapeHtml(title);
    var sorted = tokens.slice().filter(function (t) {
      return t.length > 0;
    });
    sorted.sort(function (a, b) {
      return b.length - a.length;
    });
    var remaining = title;
    var parts = [];
    var guard = 0;
    while (remaining.length && guard++ < 500) {
      var bestPos = -1;
      var bestLen = 0;
      var bestTok = "";
      for (var i = 0; i < sorted.length; i++) {
        var tok = sorted[i];
        if (!tok) continue;
        var low = remaining.toLowerCase();
        var idx = low.indexOf(tok.toLowerCase());
        if (idx !== -1 && tok.length > bestLen) {
          bestLen = tok.length;
          bestPos = idx;
          bestTok = remaining.slice(idx, idx + tok.length);
        }
      }
      if (bestPos === -1) {
        parts.push(escapeHtml(remaining));
        break;
      }
      if (bestPos > 0) parts.push(escapeHtml(remaining.slice(0, bestPos)));
      parts.push("<mark>" + escapeHtml(bestTok) + "</mark>");
      remaining = remaining.slice(bestPos + bestLen);
    }
    return parts.join("");
  }

  function iconSvg(type) {
    if (type === "calculator") {
      return (
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
        '<path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
        "</svg>"
      );
    }
    if (type === "essay") {
      return (
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M7 4h10v16l-3-2-3 2-3-2-3 2V4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M9 8h6M9 11h6M9 14h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        "</svg>"
      );
    }
    return (
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M14 4v4h4M8 12h8M8 15h8M8 18h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      "</svg>"
    );
  }

  function isMethodologyEntry(entry) {
    var u = (entry && entry.url) || "";
    return u.indexOf("/methodology/") !== -1;
  }

  function sectionLabel(bucket) {
    if (bucket === "article") return "Articles";
    if (bucket === "calculator") return "Calculators";
    if (bucket === "essay") return "Essays";
    if (bucket === "methodology") return "Inspect the arithmetic";
    return bucket;
  }

  function runSearch() {
    if (!input || !resultsEl) return;
    var raw = input.value || "";
    var tokens = tokenize(raw);
    var phrase = tokens.join(" ");
    if (debugEl) {
      debugEl.textContent =
        "tokens: " + (tokens.length ? tokens.join(", ") : "(none)") + " · phrase: " + (phrase || "(empty)");
    }

    if (!indexCache || !indexCache.length) {
      resultsEl.innerHTML =
        '<p class="search-empty">Search index is loading or unavailable.</p>';
      flatResults = [];
      selectedIndex = -1;
      return;
    }

    if (!phrase) {
      if (currentFilter === "all") {
        resultsEl.innerHTML =
          '<p class="search-empty">Type a query, or pick a filter below to browse that section.</p>';
        flatResults = [];
        selectedIndex = -1;
        return;
      }
      renderBrowse(tokens);
      return;
    }

    var scored = [];
    var j;
    for (j = 0; j < indexCache.length; j++) {
      var e = indexCache[j];
      if (currentFilter !== "all" && e.type !== currentFilter) continue;
      var s = scoreEntry(e, tokens, phrase);
      if (s > 0) scored.push({ entry: e, score: s });
    }
    scored.sort(function (a, b) {
      return b.score - a.score || (a.entry.title || "").localeCompare(b.entry.title || "");
    });

    if (!scored.length) {
      resultsEl.innerHTML = '<p class="search-empty">No results for that query.</p>';
      flatResults = [];
      selectedIndex = -1;
      return;
    }

    var groups = {
      article: [],
      calculator: [],
      essay: [],
      methodology: [],
    };
    for (j = 0; j < scored.length; j++) {
      var en = scored[j].entry;
      if (en.type === "article") groups.article.push(en);
      else if (en.type === "essay") groups.essay.push(en);
      else if (en.type === "calculator") {
        if (isMethodologyEntry(en)) groups.methodology.push(en);
        else groups.calculator.push(en);
      }
    }

    renderGrouped(groups, tokens);
  }

  function renderBrowse(tokens) {
    var list = indexCache.filter(function (e) {
      return e.type === currentFilter;
    });
    if (!list.length) {
      resultsEl.innerHTML = '<p class="search-empty">Nothing in this category.</p>';
      flatResults = [];
      selectedIndex = -1;
      return;
    }

    var titleSort = function (a, b) {
      return (a.title || "").localeCompare(b.title || "");
    };

    if (currentFilter === "calculator") {
      var main = [];
      var meth = [];
      for (var i = 0; i < list.length; i++) {
        if (isMethodologyEntry(list[i])) meth.push(list[i]);
        else main.push(list[i]);
      }
      main.sort(titleSort);
      meth.sort(titleSort);
      renderGrouped(
        {
          article: [],
          essay: [],
          calculator: main,
          methodology: meth,
        },
        tokens
      );
      return;
    }

    list.sort(titleSort);
    var groups = {
      article: [],
      calculator: [],
      essay: [],
      methodology: [],
    };
    groups[currentFilter] = list.slice();
    renderGrouped(groups, tokens);
  }

  function renderGrouped(groups, tokens) {
    var order = ["article", "calculator", "essay", "methodology"];
    var html = "";
    var orderedFlat = [];
    var g;
    for (g = 0; g < order.length; g++) {
      var typ = order[g];
      var list = groups[typ];
      if (!list || !list.length) continue;
      html += '<div class="search-section-label">' + sectionLabel(typ) + "</div>";
      for (var r = 0; r < list.length; r++) {
        var item = list[r];
        var idx = orderedFlat.length;
        orderedFlat.push(item);
        var href = resolveUrl(item.url);
        var hi = highlightTitle(item.title || "", tokens);
        html +=
          '<a role="option" class="search-result" data-search-idx="' +
          idx +
          '" href="' +
          escapeHtml(href) +
          '">' +
          '<span class="search-result-icon search-result-icon--' +
          escapeHtml(item.type) +
          '">' +
          iconSvg(item.type) +
          "</span>" +
          '<span class="search-result-body">' +
          '<p class="search-result-title">' +
          hi +
          "</p>" +
          (item.desc
            ? '<p class="search-result-desc">' + escapeHtml(item.desc) + "</p>"
            : "") +
          "</span></a>";
      }
    }
    flatResults = orderedFlat;
    resultsEl.innerHTML = html;
    selectedIndex = flatResults.length ? 0 : -1;
    updateSelection();
  }

  function updateSelection() {
    var nodes = resultsEl.querySelectorAll(".search-result");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle("is-selected", i === selectedIndex);
    }
    if (selectedIndex >= 0 && nodes[selectedIndex]) {
      nodes[selectedIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function closeMenuIfOpen() {
    var panel = document.getElementById("menuPanel");
    var overlay = document.getElementById("menuOverlay");
    var btn = document.getElementById("menuBtn");
    if (panel && panel.classList.contains("open")) {
      panel.classList.remove("open");
      if (overlay) overlay.classList.remove("open");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }

  function openModal() {
    if (!overlay) return;
    closeMenuIfOpen();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("tlm-search-open");
    if (isLocalDev()) document.body.classList.add("tlm-search-dev");
    loadIndex().then(function () {
      runSearch();
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("tlm-search-open");
    document.body.classList.remove("tlm-search-dev");
    selectedIndex = -1;
    if (document.activeElement && overlay.contains(document.activeElement)) {
      try {
        document.activeElement.blur();
      } catch (e) {}
    }
  }

  function activateSelected() {
    if (selectedIndex < 0 || !flatResults[selectedIndex]) return;
    var url = resolveUrl(flatResults[selectedIndex].url);
    window.location.href = url;
  }

  function onDocumentKeydown(e) {
    var modalOpen = overlay && overlay.classList.contains("is-open");
    if (!modalOpen) {
      if (
        (e.key === "k" || e.key === "K") &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey
      ) {
        e.preventDefault();
        openModal();
      }
      return;
    }

    if (
      (e.key === "k" || e.key === "K") &&
      (e.metaKey || e.ctrlKey) &&
      !e.altKey
    ) {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatResults.length) {
        selectedIndex = Math.min(flatResults.length - 1, selectedIndex + 1);
        if (selectedIndex < 0) selectedIndex = 0;
        updateSelection();
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatResults.length) {
        selectedIndex = Math.max(0, selectedIndex - 1);
        updateSelection();
      }
      return;
    }

    if (e.key === "Enter") {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" && e.target.id === "searchInput") {
        if (selectedIndex >= 0) {
          e.preventDefault();
          activateSelected();
        }
      }
    }
  }

  function onResultsClick(e) {
    var a = e.target.closest && e.target.closest(".search-result");
    if (a && a.getAttribute("href")) {
      closeModal();
    }
  }

  function onResultsMouse(e) {
    var a = e.target.closest && e.target.closest(".search-result");
    if (!a) return;
    var idx = parseInt(a.getAttribute("data-search-idx"), 10);
    if (!isNaN(idx)) {
      selectedIndex = idx;
      updateSelection();
    }
  }

  function wireChips() {
    chips = overlay.querySelectorAll("[data-search-filter]");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function () {
        var f = this.getAttribute("data-search-filter") || "all";
        currentFilter = f;
        for (var j = 0; j < chips.length; j++) {
          chips[j].classList.toggle("is-active", chips[j] === this);
        }
        runSearch();
      });
    }
  }

  function bindOpeners() {
    var btn = document.getElementById("searchBtn");
    if (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        openModal();
      });
    }
  }

  function init() {
    overlay = document.getElementById("searchOverlay");
    if (!overlay) return;
    input = document.getElementById("searchInput");
    resultsEl = document.getElementById("searchResults");
    debugEl = document.getElementById("searchDebugTokens");

    if (!searchInited) {
      searchInited = true;
      wireChips();

      overlay.querySelectorAll("[data-search-close]").forEach(function (el) {
        el.addEventListener("click", function () {
          closeModal();
        });
      });

      if (input) {
        input.addEventListener("input", function () {
          runSearch();
        });
      }

      resultsEl.addEventListener("mousemove", onResultsMouse);
      resultsEl.addEventListener("click", onResultsClick);

      document.addEventListener("keydown", onDocumentKeydown, true);
    }

    bindOpeners();
  }

  window.TLM = window.TLM || {};
  window.TLM.search = {
    init: init,
    open: openModal,
    close: closeModal,
    rebindOpeners: bindOpeners,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
