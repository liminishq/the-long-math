// theme.js — site-wide theme toggle (default: dark) + persistence
(function () {
  const STORAGE_KEY = "tlm_theme";
  const root = document.documentElement;

  function getSavedTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return (v === "light" || v === "dark") ? v : null;
    } catch (e) {
      return null;
    }
  }

  function setSavedTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      // ignore
    }
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
  }

  // Default is dark if nothing saved.
  const initial = getSavedTheme() || "dark";
  applyTheme(initial);

  // If this page has a toggle, wire it.
  const toggle = document.getElementById("theme_toggle");
  const label = document.getElementById("theme_label");

  if (!toggle) return;

  // Toggle checked means LIGHT (so user flips to light explicitly)
  // But your UI label shows current theme; keep it literal.
  toggle.checked = (initial === "light");
  if (label) label.textContent = (initial === "dark") ? "Dark" : "Light";

  toggle.addEventListener("change", () => {
    const next = toggle.checked ? "light" : "dark";
    applyTheme(next);
    setSavedTheme(next);
    if (label) label.textContent = (next === "dark") ? "Dark" : "Light";
  });
})();
