// assets/js/site.js
(function () {
  "use strict";

  // -------------------------
  // Google Analytics (site-wide; skip if already in page)
  // -------------------------
  (function injectGA() {
    if (document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) return;
    var id = "G-4KPJPTHY30";
    var s1 = document.createElement("script");
    s1.async = true;
    s1.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
    document.head.appendChild(s1);
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", id, { anonymize_ip: true });
  })();

  // -------------------------
  // Theme toggle
  // -------------------------
  function getTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    return t === "light" ? "light" : "dark";
  }

  function setTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("tlm_theme", t); } catch (e) {}
  }

  function themeLabel(theme) {
    if (window.TLM && window.TLM.i18n && window.TLM.i18n.t) {
      return theme === "light" ? window.TLM.i18n.t("common.theme.light") : window.TLM.i18n.t("common.theme.dark");
    }
    return theme === "light" ? "Light" : "Dark";
  }

  function initThemeToggle() {
    const toggle = document.getElementById("themeToggle") || document.getElementById("theme_toggle");
    if (!toggle) return;

    const label = document.getElementById("theme_label");
    const currentTheme = getTheme();
    toggle.checked = currentTheme === "light";
    if (label) label.textContent = themeLabel(currentTheme);

    toggle.addEventListener("change", function () {
      const next = toggle.checked ? "light" : "dark";
      setTheme(next);
      if (label) label.textContent = themeLabel(next);
    });
  }

  // -------------------------
  // Hamburger / drawer nav
  // -------------------------
  function initMenu() {
    const btn = document.getElementById("menuBtn");
    const panel = document.getElementById("menuPanel");
    const overlay = document.getElementById("menuOverlay");
    const closeBtn = document.getElementById("menuClose");

    if (!btn || !panel || !overlay) return;

    function openMenu() {
      panel.classList.add("open");
      overlay.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      panel.classList.remove("open");
      overlay.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", function () {
      const isOpen = panel.classList.contains("open");
      if (isOpen) closeMenu();
      else openMenu();
    });

    overlay.addEventListener("click", closeMenu);
    if (closeBtn) closeBtn.addEventListener("click", closeMenu);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  // -------------------------
  // Site search (modal + index) — injected after header so #searchBtn exists
  // -------------------------
  var searchUiPromise = null;

  function ensureSearchUi() {
    if (document.getElementById("searchOverlay")) {
      if (window.TLM && window.TLM.search && window.TLM.search.rebindOpeners) {
        window.TLM.search.rebindOpeners();
      }
      return Promise.resolve();
    }
    if (searchUiPromise) return searchUiPromise;

    searchUiPromise = fetch("/assets/partials/search-modal.html")
      .then(function (r) {
        if (!r.ok) throw new Error("search-modal HTTP " + r.status);
        return r.text();
      })
      .then(function (html) {
        var trimmed = (html || "").trim();
        // Hosts that map unknown paths to index.html return a full document; never append that to body.
        if (!/id\s*=\s*["']searchOverlay["']/.test(trimmed)) {
          console.warn("Search UI: unexpected partial HTML; skipping inject (avoid duplicating page content).");
          searchUiPromise = null;
          return Promise.resolve();
        }
        var holder = document.createElement("div");
        holder.innerHTML = trimmed;
        while (holder.firstChild) {
          document.body.appendChild(holder.firstChild);
        }

        if (!document.getElementById("tlm-search-css")) {
          var lk = document.createElement("link");
          lk.id = "tlm-search-css";
          lk.rel = "stylesheet";
          lk.href = "/assets/css/search.css";
          document.head.appendChild(lk);
        }

        return new Promise(function (resolve, reject) {
          if (window.TLM && window.TLM.search && window.TLM.search.init) {
            window.TLM.search.init();
            window.TLM.search.rebindOpeners();
            resolve();
            return;
          }
          if (document.getElementById("tlm-search-js")) {
            resolve();
            return;
          }
          var s = document.createElement("script");
          s.id = "tlm-search-js";
          s.async = false;
          s.src = "/assets/js/search.js";
          s.onload = function () {
            if (window.TLM && window.TLM.search) {
              window.TLM.search.init();
              window.TLM.search.rebindOpeners();
            }
            resolve();
          };
          s.onerror = function () {
            reject(new Error("search.js failed to load"));
          };
          document.body.appendChild(s);
        });
      })
      .catch(function (err) {
        searchUiPromise = null;
        console.warn("Search UI load failed:", err);
      });

    return searchUiPromise;
  }

  // -------------------------
  // Load pre-rendered header/footer by language (path-based), or run post-load for generated pages
  // -------------------------
  function normalizedPathname() {
    var p = (window.location && window.location.pathname) || "/";
    if (p.charAt(0) !== "/") p = "/" + p;
    return p;
  }

  /** Match i18n.js: only /fr or /fr/..., not /fragment/ etc. */
  function pathIsFrenchLocale(p) {
    return p === "/fr" || p.indexOf("/fr/") === 0;
  }

  function getPartialLang() {
    return pathIsFrenchLocale(normalizedPathname()) ? "fr" : "en";
  }

  /**
   * Same href rules as i18n.setLanguageSwitcherLinks when i18n.js is not on the page.
   */
  function patchLanguageSwitcherAndLocaleNav() {
    var path = normalizedPathname();
    var onFr = pathIsFrenchLocale(path);
    var prefix = onFr ? "/fr" : "";
    var enLink = document.getElementById("lang-link-en");
    var frLink = document.getElementById("lang-link-fr");
    if (enLink) {
      if (onFr) {
        enLink.href = path === "/fr" || path === "/fr/" ? "/" : path.slice(3);
      } else {
        enLink.href = path;
      }
    }
    if (frLink) {
      frLink.href = onFr ? path : "/fr" + (path === "/" ? "" : path);
    }
    document.querySelectorAll("[data-locale-path]").forEach(function (node) {
      var localePath = node.getAttribute("data-locale-path");
      if (localePath) {
        var href = prefix + (localePath === "/" ? "" : localePath) || "/";
        node.setAttribute("href", href);
      }
    });
  }

  function applyLanguageSwitcherAndNavHrefs() {
    if (window.TLM && window.TLM.i18n && window.TLM.i18n.setLanguageSwitcherLinks) {
      window.TLM.i18n.setLanguageSwitcherLinks();
    } else {
      patchLanguageSwitcherAndLocaleNav();
    }
  }

  function runAfterHeaderFooter() {
    var headerMount = document.getElementById("site-header");
    var footerMount = document.getElementById("footerMount");

    if (headerMount && footerMount) {
      var lang = getPartialLang();
      var headerUrl = lang === "fr" ? "/assets/partials/header-fr.html" : "/assets/partials/header.html";
      var footerUrl = lang === "fr" ? "/assets/partials/footer-fr.html" : "/assets/partials/footer.html";
      function loadPartialText(url, kind) {
        return fetch(url)
          .then(function (r) {
            if (!r.ok) return "";
            return r.text();
          })
          .then(function (text) {
            var t = (text || "").trim();
            if (!t) return "";
            if (kind === "header" && (!/<header[\s>]/.test(t) || t.indexOf("sitehead") === -1)) {
              console.warn("Header partial missing or invalid:", url);
              return "";
            }
            if (kind === "footer" && (!/<footer[\s>]/.test(t) || t.indexOf("site-footer") === -1)) {
              console.warn("Footer partial missing or invalid:", url);
              return "";
            }
            return t;
          })
          .catch(function () {
            return "";
          });
      }

      Promise.all([loadPartialText(headerUrl, "header"), loadPartialText(footerUrl, "footer")]).then(function (results) {
        var headerHtml = results[0];
        var footerHtml = results[1];
        var wrap = document.querySelector(".wrap");
        if (wrap && headerHtml) {
          var temp = document.createElement("div");
          temp.innerHTML = headerHtml;
          while (temp.firstChild) {
            wrap.insertBefore(temp.firstChild, wrap.firstChild);
          }
          if (headerMount.parentNode) headerMount.parentNode.removeChild(headerMount);
        } else if (headerHtml) {
          headerMount.innerHTML = headerHtml;
        }
        if (footerMount && footerHtml) footerMount.innerHTML = footerHtml;
        applyLanguageSwitcherAndNavHrefs();
        setTimeout(function () {
          initThemeToggle();
          initMenu();
        }, 0);
        ensureSearchUi();
      }).catch(function (err) {
        console.warn("Header/footer load failed:", err);
        initThemeToggle();
        initMenu();
      });
      return;
    }

    applyLanguageSwitcherAndNavHrefs();
    setTimeout(function () {
      initThemeToggle();
      initMenu();
    }, 0);
  }

  if (document.getElementById("site-header") || document.getElementById("footerMount")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runAfterHeaderFooter);
    } else {
      runAfterHeaderFooter();
    }
  } else {
    document.addEventListener("DOMContentLoaded", runAfterHeaderFooter);
  }

  // -------------------------
  // Article reading time (one-liner at start of article)
  // -------------------------
  function initReadingTime() {
    var article = document.querySelector("article.article-content");
    if (!article) return;

    var header = article.querySelector("header");
    if (header) {
      // Some articles hardcode the read-time using different markup (e.g. `.reading-meta` or no class).
      // Detect those cases to avoid inserting a duplicate "x minute read".
      if (
        header.querySelector(".read-time") ||
        header.querySelector(".reading-time") ||
        header.querySelector(".reading-meta")
      ) {
        return;
      }

      var headerText = header.textContent || "";
      // Match "8-minute read" even when the hyphen is a Unicode hyphen-minus variant.
      var readTimeRegex = /\b\d+\s*[\-\u2010\u2011\u2012\u2013\u2014]?\s*minute(s)?\s*[\-\u2010\u2011\u2012\u2013\u2014]?\s*read\b/i;
      if (readTimeRegex.test(headerText)) return;
    }

    var text = article.innerText || article.textContent || "";
    var words = text.trim().split(/\s+/).filter(Boolean);
    var wpm = 200;
    var minutes = Math.max(1, Math.round(words.length / wpm));
    var label = minutes === 1 ? "1 minute read" : minutes + " minute read";

    var el = document.createElement("p");
    el.className = "reading-time";
    el.setAttribute("aria-hidden", "true");
    el.textContent = label;

    var header = article.querySelector("header");
    if (header) {
      header.appendChild(el);
    } else {
      article.insertBefore(el, article.firstChild);
    }
  }

  // -------------------------
  // Last updated (educational articles only; under read time)
  // -------------------------
  function initLastUpdated() {
    var path = window.location.pathname || "";
    if (path.indexOf("/articles/") === -1 || path.indexOf("/calculators/") !== -1) return;

    var article = document.querySelector("article.article-content");
    if (!article) return;

    var meta = document.querySelector('meta[name="article:modified"]');
    var content = meta && meta.getAttribute("content");
    if (!content || !content.trim()) return;

    var header = article.querySelector("header");
    if (!header) return;

    // Avoid duplicating the "Last updated ..." line when an article already provides it.
    if (header.querySelector(".last-updated")) return;
    var headerText = header.textContent || "";
    if (/\bLast updated\b/i.test(headerText)) return;

    var after = header.querySelector(".reading-time") || header.querySelector(".read-time");
    var p = document.createElement("p");
    p.className = "last-updated";
    p.setAttribute("aria-hidden", "true");
    p.textContent = "Last updated " + content.trim();

    if (after) {
      after.parentNode.insertBefore(p, after.nextSibling);
    } else {
      header.appendChild(p);
    }
  }

  // -------------------------
  // Article FAQ accordion buttons (custom .faq-question blocks)
  // -------------------------
  function initFaqQuestionAccordions() {
    var buttons = document.querySelectorAll(".faq-question");
    if (!buttons || !buttons.length) return;

    buttons.forEach(function (btn) {
      if (btn.dataset.tlmFaqBound === "1") return;
      btn.dataset.tlmFaqBound = "1";
      btn.setAttribute("type", "button");

      btn.addEventListener("click", function () {
        var item = btn.closest(".faq-item");
        if (!item) return;
        var isOpen = item.classList.contains("open");
        item.classList.toggle("open", !isOpen);
        btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      });
    });
  }

  function isFrenchLocale() {
    var lang = (document.documentElement && document.documentElement.getAttribute("lang")) || "";
    return /^fr/i.test(lang);
  }

  function initNewsletterDoubleOptInNote() {
    var iframes = document.querySelectorAll("iframe.beehiiv-embed");
    if (!iframes || !iframes.length) return;

    var fr = isFrenchLocale();
    var htmlEn =
      "You are almost done. To reduce spam and bot signups, this list uses <strong>double opt-in</strong>: please check your <strong>inbox and junk mail folder</strong> for our email, then click <strong>Confirm Subscription</strong> to finish.";
    var htmlFr =
      "Vous y &ecirc;tes presque. Pour limiter le pourriel et les inscriptions automatis&eacute;es, cette liste utilise la <strong>double confirmation</strong> : ouvrez le courriel que nous envoyons (bo&icirc;te de r&eacute;ception <strong>et</strong> courrier ind&eacute;sirable), puis cliquez sur <strong>Confirmer l'abonnement</strong>.";
    var titleEn = "Almost done — check your email";
    var titleFr = "Presque termine — verifiez votre courriel";
    var closeLabel = fr ? "Fermer" : "Close";

    var popup = null;
    var shownOnce = false;
    var lastFocusedEl = null;

    function buildPopup() {
      if (popup) return popup;
      popup = document.createElement("div");
      popup.className = "newsletter-double-opt-in-popup";
      popup.setAttribute("role", "dialog");
      popup.setAttribute("aria-modal", "true");
      popup.setAttribute("aria-labelledby", "tlm-doi-title");
      popup.setAttribute("hidden", "");

      var card = document.createElement("div");
      card.className = "newsletter-double-opt-in-popup-card";

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "newsletter-double-opt-in-popup-close";
      closeBtn.setAttribute("aria-label", closeLabel);
      closeBtn.innerHTML = "&times;";
      closeBtn.addEventListener("click", hidePopup);

      var heading = document.createElement("h2");
      heading.id = "tlm-doi-title";
      heading.className = "newsletter-double-opt-in-popup-title";
      heading.textContent = fr ? titleFr : titleEn;

      var note = document.createElement("p");
      note.className = "newsletter-double-opt-in-note";
      note.setAttribute("data-tlm-double-opt-in-note", "1");
      note.innerHTML = fr ? htmlFr : htmlEn;

      card.appendChild(closeBtn);
      card.appendChild(heading);
      card.appendChild(note);
      popup.appendChild(card);

      popup.addEventListener("click", function (e) {
        if (e.target === popup) hidePopup();
      });

      document.body.appendChild(popup);
      return popup;
    }

    function showPopup() {
      if (shownOnce) return;
      shownOnce = true;
      var p = buildPopup();
      try { lastFocusedEl = document.activeElement; } catch (e) { lastFocusedEl = null; }
      p.removeAttribute("hidden");
      document.documentElement.classList.add("tlm-doi-open");
      var btn = p.querySelector(".newsletter-double-opt-in-popup-close");
      if (btn) { try { btn.focus(); } catch (e) {} }
    }

    function hidePopup() {
      if (!popup) return;
      popup.setAttribute("hidden", "");
      document.documentElement.classList.remove("tlm-doi-open");
      if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
        try { lastFocusedEl.focus(); } catch (e) {}
      }
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && popup && !popup.hasAttribute("hidden")) hidePopup();
    });

    var pageLoadAt = Date.now();
    var iframeInteracted = false;
    var beehiivMessageCount = 0;

    function isBeehiivOrigin(origin) {
      if (!origin) return false;
      return origin.indexOf("beehiiv.com") !== -1;
    }

    function isBeehiivIframeFocused() {
      var ae = document.activeElement;
      return !!(ae && ae.tagName === "IFRAME" && ae.classList && ae.classList.contains("beehiiv-embed"));
    }

    window.addEventListener("blur", function () {
      setTimeout(function () {
        if (isBeehiivIframeFocused()) iframeInteracted = true;
      }, 0);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && isBeehiivIframeFocused()) {
        iframeInteracted = true;
      }
    });

    window.addEventListener("message", function (e) {
      if (!e || !isBeehiivOrigin(e.origin)) return;
      beehiivMessageCount++;
      var elapsed = Date.now() - pageLoadAt;
      if (!iframeInteracted) return;
      if (elapsed < 1200) return;
      if (beehiivMessageCount < 2) return;
      showPopup();
    });
  }

  function injectBeehiivEmbedScript() {
    if (!document.querySelector(".beehiiv-embed")) return;
    if (document.querySelector('script[src*="subscribe-forms.beehiiv.com/embed.js"]')) return;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://subscribe-forms.beehiiv.com/embed.js";
    document.head.appendChild(s);
  }

  function loadCalculatorExportScript() {
    var path = (window.location && window.location.pathname) || "";
    if (path.indexOf("/calculators/") === -1) return;
    if (/^(\/fr)?\/calculators\/?$/.test(path)) return;
    if (/\/calculators\/[^/]+\/(methodology|data)(\/|$)/.test(path)) return;
    if (document.getElementById("tlm-export-results-js")) return;
    var s = document.createElement("script");
    s.id = "tlm-export-results-js";
    s.src = "/assets/js/export-results.js";
    s.async = true;
    document.head.appendChild(s);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initMenu();
    initReadingTime();
    initLastUpdated();
    initFaqQuestionAccordions();
    injectBeehiivEmbedScript();
    initNewsletterDoubleOptInNote();
    loadCalculatorExportScript();
  });
})();
