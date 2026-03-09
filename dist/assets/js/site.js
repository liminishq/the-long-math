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
  // Load pre-rendered header/footer by language (path-based), or run post-load for generated pages
  // -------------------------
  function getPartialLang() {
    var p = (window.location && window.location.pathname) || "";
    return p.indexOf("/fr") === 0 ? "fr" : "en";
  }

  function runAfterHeaderFooter() {
    var headerMount = document.getElementById("site-header");
    var footerMount = document.getElementById("footerMount");

    if (headerMount && footerMount) {
      var lang = getPartialLang();
      var headerUrl = lang === "fr" ? "/assets/partials/header-fr.html" : "/assets/partials/header.html";
      var footerUrl = lang === "fr" ? "/assets/partials/footer-fr.html" : "/assets/partials/footer.html";
      Promise.all([
        fetch(headerUrl).then(function (r) { return r.text(); }).catch(function () { return ""; }),
        fetch(footerUrl).then(function (r) { return r.text(); }).catch(function () { return ""; })
      ]).then(function (results) {
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
        if (window.TLM && window.TLM.i18n && window.TLM.i18n.setLanguageSwitcherLinks) {
          window.TLM.i18n.setLanguageSwitcherLinks();
        }
        setTimeout(function () {
          initThemeToggle();
          initMenu();
        }, 0);
      }).catch(function (err) {
        console.warn("Header/footer load failed:", err);
        initThemeToggle();
        initMenu();
      });
      return;
    }

    if (window.TLM && window.TLM.i18n && window.TLM.i18n.setLanguageSwitcherLinks) {
      window.TLM.i18n.setLanguageSwitcherLinks();
    }
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
    if (header && (header.querySelector(".read-time") || header.querySelector(".reading-time"))) return;

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

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initMenu();
    initReadingTime();
    initLastUpdated();
  });
})();
