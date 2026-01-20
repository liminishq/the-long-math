(function () {
  const KEY = "tlm_theme";

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function getSaved() {
    try {
      const v = localStorage.getItem(KEY);
      return (v === "dark" || v === "light") ? v : null;
    } catch {
      return null;
    }
  }

  function save(theme) {
    try { localStorage.setItem(KEY, theme); } catch {}
  }

  // Apply early (prevents flash)
  const initial = getSaved() || "light";
  apply(initial);

  // Expose a tiny API for pages
  window.TLM_THEME = {
    get: () => document.documentElement.getAttribute("data-theme") || "light",
    set: (t) => { apply(t); save(t); },
    toggle: () => {
      const next = (window.TLM_THEME.get() === "dark") ? "light" : "dark";
      window.TLM_THEME.set(next);
      return next;
    }
  };
})();
