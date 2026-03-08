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
  // Load i18n if not present, then load header/footer and apply translations
  // -------------------------
  function loadI18nThenRun() {
    return new Promise(function (resolve) {
      if (window.TLM && window.TLM.i18n) {
        resolve(window.TLM.i18n.ready);
        return;
      }
      var s = document.createElement("script");
      s.src = "/assets/js/i18n.js";
      s.onload = function () {
        resolve(window.TLM.i18n.ready);
      };
      s.onerror = function () { resolve(Promise.resolve()); };
      document.head.appendChild(s);
    });
  }

  function runAfterHeaderFooter() {
    const headerMount = document.getElementById("site-header");
    const footerMount = document.getElementById("footerMount");

    const headerPromise = headerMount
      ? fetch("/assets/partials/header.html").then(function (r) { return r.text(); }).catch(function () { return ""; })
      : Promise.resolve("");
    const footerPromise = footerMount
      ? fetch("/assets/partials/footer.html").then(function (r) { return r.text(); }).catch(function () { return ""; })
      : Promise.resolve("");

    loadI18nThenRun().then(function (readyPromise) {
      return Promise.all([readyPromise, headerPromise, footerPromise]);
    }).then(function (results) {
      const ready = results[0];
      const headerHtml = results[1];
      const footerHtml = results[2];

      if (headerMount && headerHtml) {
        const wrap = document.querySelector(".wrap");
        if (wrap) {
          const temp = document.createElement("div");
          temp.innerHTML = headerHtml;
          while (temp.firstChild) {
            wrap.insertBefore(temp.firstChild, wrap.firstChild);
          }
          if (headerMount.parentNode) headerMount.parentNode.removeChild(headerMount);
        } else {
          headerMount.innerHTML = headerHtml;
        }
      }

      if (footerMount && footerHtml) footerMount.innerHTML = footerHtml;

      if (window.TLM && window.TLM.i18n) {
        window.TLM.i18n.applyToDocument();
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
  }

  if (document.getElementById("site-header") || document.getElementById("footerMount")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runAfterHeaderFooter);
    } else {
      runAfterHeaderFooter();
    }
  }

  // -------------------------
  // Article reading time (one-liner at start of article)
  // -------------------------
  function initReadingTime() {
    var article = document.querySelector("article.article-content");
    if (!article) return;

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

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initMenu();
    initReadingTime();
  });
})();
