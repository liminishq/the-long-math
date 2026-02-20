(() => {
  // Fixed grid configuration (edit here if you ever want a different static range)
  const RATE_MIN = 1;   // percent
  const RATE_MAX = 15;  // percent
  const YEAR_MIN = 0;
  const YEAR_MAX = 50;

  // Display formatting:
  // - Keep more precision early; avoid huge strings later.
  // - This mirrors your sample (varies), but keeps it readable.
  function formatMultiplier(x) {
    // Exact integers (e.g., year 0) show as "1"
    if (Number.isInteger(x)) return String(x);

    // For very large numbers, keep 6 sig figs to avoid massive cells.
    if (x >= 1000) return x.toPrecision(6);

    // For moderate numbers, trim trailing zeros.
    // Use up to 9 decimals (enough to match typical compound tables).
    let s = x.toFixed(9);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function buildHeader() {
    const thead = document.getElementById("multHead");
    const tr1 = document.createElement("tr");

    // Corner cell
    const thCorner = document.createElement("th");
    thCorner.className = "sticky-col corner";
    thCorner.textContent = "Annual Rate \\ Year";
    tr1.appendChild(thCorner);

    for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
      const th = document.createElement("th");
      th.textContent = String(y);
      tr1.appendChild(th);
    }

    thead.appendChild(tr1);
  }

  function buildBody() {
    const tbody = document.getElementById("multBody");

    for (let p = RATE_MIN; p <= RATE_MAX; p++) {
      const r = p / 100;
      const tr = document.createElement("tr");

      // Rate label
      const tdRate = document.createElement("td");
      tdRate.className = "sticky-col";
      tdRate.textContent = `${p}%`;
      tr.appendChild(tdRate);

      for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
        const td = document.createElement("td");
        const mult = Math.pow(1 + r, y);
        td.textContent = formatMultiplier(mult);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
  }

  function setSummary() {
    const el = document.getElementById("tableSummary");
    el.textContent = `Rates ${RATE_MIN}%–${RATE_MAX}%, Years ${YEAR_MIN}–${YEAR_MAX}. Multiplier = (1 + r)^t.`;
  }

  function init() {
    buildHeader();
    buildBody();
    setSummary();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
