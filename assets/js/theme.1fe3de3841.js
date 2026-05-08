/* =========================================================
   The Long Math — Theme Controller
   Dark-first, persisted, pre-paint safe
   ========================================================= */

(function () {
  const STORAGE_KEY = "tlm_theme";
  const root = document.documentElement;

  /* ---------- Determine initial theme ---------- */
  let theme = "dark"; // default

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      theme = saved;
    }
  } catch (e) {
    // ignore storage errors
  }

  // Apply immediately (prevents flash)
  root.setAttribute("data-theme", theme);

  /* ---------- After DOM ready, wire toggle ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("theme_toggle");
    const label = document.getElementById("theme_label");

    if (!toggle) return;

    toggle.checked = theme === "light";
    if (label) label.textContent = theme === "light" ? "Light" : "Dark";

    toggle.addEventListener("change", () => {
      theme = toggle.checked ? "light" : "dark";
      root.setAttribute("data-theme", theme);

      if (label) label.textContent = toggle.checked ? "Light" : "Dark";

      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (e) {
        // ignore storage errors
      }
    });
  });
})();
