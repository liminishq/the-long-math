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
    // Support both "themeToggle" and "theme_toggle" IDs
    const toggle = document.getElementById("themeToggle") || document.getElementById("theme_toggle");
    if (!toggle) return; // page may not have toggle

    const label = document.getElementById("theme_label");
    
    // Sync UI with current theme
    const currentTheme = getTheme();
    toggle.checked = currentTheme === "light";
    if (label) {
      label.textContent = currentTheme === "light" ? "Light" : "Dark";
    }

    toggle.addEventListener("change", function () {
      const nextTheme = toggle.checked ? "light" : "dark";
      setTheme(nextTheme);
      if (label) {
        label.textContent = nextTheme === "light" ? "Light" : "Dark";
      }
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

// Load header
(function () {
  const headerMount = document.getElementById("site-header");
  if (headerMount) {
    fetch("/assets/partials/header.html")
      .then(res => res.text())
      .then(html => {
        // Find the wrap div and inject header at the beginning
        const wrap = document.querySelector(".wrap");
        if (wrap) {
          // Create a temporary container to parse the HTML
          const temp = document.createElement("div");
          temp.innerHTML = html;
          // Insert all children at the beginning of wrap
          while (temp.firstChild) {
            wrap.insertBefore(temp.firstChild, wrap.firstChild);
          }
          // Remove the empty headerMount div
          if (headerMount.parentNode) {
            headerMount.parentNode.removeChild(headerMount);
          }
        } else {
          // Fallback: inject into headerMount if no wrap found
          headerMount.innerHTML = html;
        }
        // Re-initialize menu after header loads
        setTimeout(function() {
          initMenu();
          initThemeToggle();
        }, 0);
      })
      .catch(err => {
        console.warn("Header failed to load:", err);
      });
  }
})();

// Load footer
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
    // Only init if elements exist (may be loaded via header partial)
    initThemeToggle();
    initMenu();
  });
})();
