// assets/js/site.js
(function () {
  "use strict";

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

  function initThemeToggle() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return; // page may not have toggle

    // Sync UI with current theme
    toggle.checked = getTheme() === "light";

    toggle.addEventListener("change", function () {
      setTheme(toggle.checked ? "light" : "dark");
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

(function () {
  const mount = document.getElementById("footerMount");
  if (!mount) return;

  fetch("/assets/partials/footer.html")
    .then(res => res.text())
    .then(html => {
      mount.innerHTML = html;
    })
    .catch(err => {
      console.warn("Footer failed to load:", err);
    });
})();


  // -------------------------
  // Boot
  // -------------------------
  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initMenu();
  });
})();
