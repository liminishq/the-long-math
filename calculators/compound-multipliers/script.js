(() => {
  // Fixed grid configuration (edit here if you ever want a different static range)
  const RATE_MIN = 1; // percent
  const RATE_MAX = 15; // percent
  const YEAR_MIN = 0;
  const YEAR_MAX = 50;

  let compoundPick = { ratePct: 7, years: 30 };
  let lastHighlighted = null;

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
    s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  function multiplierAt(ratePct, years) {
    const r = ratePct / 100;
    return Math.pow(1 + r, years);
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
    el.textContent = `Rates ${RATE_MIN}%–${RATE_MAX}%, Years ${YEAR_MIN}–${YEAR_MAX}. Multiplier = (1 + r)^t. Tap a cell to choose the row shown when sharing.`;
  }

  function clearHighlight() {
    if (lastHighlighted) {
      lastHighlighted.classList.remove("compound-cell-highlight");
      lastHighlighted = null;
    }
  }

  function highlightCell(ratePct, years) {
    clearHighlight();
    const tbody = document.getElementById("multBody");
    if (!tbody) return;
    const trs = tbody.querySelectorAll("tr");
    const tr = trs[ratePct - RATE_MIN];
    if (!tr) return;
    const tds = tr.querySelectorAll("td");
    const td = tds[1 + (years - YEAR_MIN)];
    if (!td) return;
    td.classList.add("compound-cell-highlight");
    lastHighlighted = td;
    td.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  function bindTablePick() {
    const tbody = document.getElementById("multBody");
    if (!tbody) return;
    tbody.addEventListener("click", function (e) {
      const td = e.target.closest("td");
      if (!td || td.classList.contains("sticky-col")) return;
      const tr = td.parentNode;
      const rowIdx = Array.prototype.indexOf.call(tr.parentNode.children, tr);
      const colIdx = Array.prototype.indexOf.call(tr.children, td);
      const ratePct = RATE_MIN + rowIdx;
      const years = YEAR_MIN + (colIdx - 1);
      if (
        ratePct < RATE_MIN ||
        ratePct > RATE_MAX ||
        years < YEAR_MIN ||
        years > YEAR_MAX
      ) {
        return;
      }
      compoundPick = { ratePct: ratePct, years: years };
      highlightCell(ratePct, years);
    });
  }

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function applyCompoundScenarioFromQuery() {
    const ps = new URLSearchParams(window.location.search || "");
    if (!ps.toString()) return false;
    const rateRaw = Number(ps.get("rate"));
    const yearsRaw = Number(ps.get("years"));
    if (!Number.isFinite(rateRaw) || !Number.isFinite(yearsRaw)) return false;
    const ratePct = Math.round(clamp(rateRaw, RATE_MIN, RATE_MAX));
    const years = Math.round(clamp(yearsRaw, YEAR_MIN, YEAR_MAX));
    compoundPick = { ratePct: ratePct, years: years };
    highlightCell(ratePct, years);
    const b = document.getElementById("shared_scenario_banner");
    if (b) b.hidden = false;
    if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
      window.TLM.shareCard.track("calculator_shared_scenario_loaded", {
        calculator_name: "compound-multipliers",
      });
    }
    return true;
  }

  function wireCompoundShare() {
    if (!window.TLM || !window.TLM.shareCard || !window.TLM.shareCard.wireCalculatorShare) return;
    if (!document.getElementById("share_result_btn")) return;
    window.TLM.shareCard.wireCalculatorShare("compound-multipliers", function () {
      const m = multiplierAt(compoundPick.ratePct, compoundPick.years);
      const mv = formatMultiplier(m) + "x";
      const rp = compoundPick.ratePct;
      const yr = compoundPick.years;
      return {
        scenario: { rate: rp, years: yr },
        card: {
          headline: "Compound interest multiplier",
          mainValue: mv,
          subline: "At " + rp + "% over " + yr + " years (annual compounding)",
          contextLine: "Multiplier = (1 + r)^t. Based on user-selected table cell.",
          shareText:
            "Compound multiplier at " +
            rp +
            "% over " +
            yr +
            " years: " +
            mv +
            ". Run your own numbers:",
        },
      };
    });
  }

  function init() {
    buildHeader();
    buildBody();
    setSummary();
    bindTablePick();
    applyCompoundScenarioFromQuery();
    highlightCell(compoundPick.ratePct, compoundPick.years);
    wireCompoundShare();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
