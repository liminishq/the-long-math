// theme.js — sitewide theme toggle (dark default)
(function(){
  const root = document.documentElement;
  const toggle = document.getElementById("theme_toggle");
  const label = document.getElementById("theme_label");

  function getTheme() {
    try {
      const saved = localStorage.getItem("tlm_theme");
      return (saved === "light" || saved === "dark") ? saved : "dark";
    } catch {
      return "dark";
    }
  }

  function setTheme(next) {
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("tlm_theme", next); } catch {}
    if (label) label.textContent = (next === "dark") ? "Dark" : "Light";
    if (toggle) toggle.checked = (next === "dark");
  }

  setTheme(getTheme());

  if (toggle) {
    toggle.addEventListener("change", () => {
      setTheme(toggle.checked ? "dark" : "light");
    });
  }
})();
