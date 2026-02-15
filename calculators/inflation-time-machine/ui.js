// Inflation Time Machine — UI only: DOM events, render. Uses engine for math and data.

(function () {
  "use strict";

  const E = window.InflationTimeMachine;
  if (!E) throw new Error("InflationTimeMachine engine not loaded");

  function $(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    return el;
  }

  function num(x) {
    if (x == null) return NaN;
    const s = String(x).trim().replace(/,/g, "");
    if (s === "") return NaN;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
  }

  let manifest = null;

  function getGlobalYearRange() {
    if (!manifest || !manifest.countries || !manifest.countries.length) return { min: 1913, max: 2025 };
    let min = Infinity, max = -Infinity;
    manifest.countries.forEach(function (c) {
      if (c.startYear < min) min = c.startYear;
      if (c.endYear > max) max = c.endYear;
    });
    return { min, max };
  }

  function getAvailableCountries(startYear, endYear) {
    if (!manifest || !manifest.countries) return [];
    return manifest.countries.filter(function (c) {
      return E.availability(c, startYear, endYear);
    });
  }

  function getDefaultCountry() {
    const can = manifest && manifest.countries
      ? manifest.countries.find(function (c) { return c.code === "CAN"; })
      : null;
    return can || (manifest && manifest.countries && manifest.countries[0]) || null;
  }

  function renderCountrySelect(selectedCode, startYear, endYear) {
    const sel = $("country_select");
    if (!sel) return;
    const available = getAvailableCountries(startYear, endYear);
    const all = manifest.countries.slice();
    const byStart = function (a, b) { return (a.startYear || 0) - (b.startYear || 0); };
    const enabled = all.filter(function (c) { return E.availability(c, startYear, endYear); }).sort(byStart);
    const disabled = all.filter(function (c) { return !E.availability(c, startYear, endYear); }).sort(byStart);

    sel.innerHTML = "";
    enabled.forEach(function (c) {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.flag + " " + c.name + " (" + c.startYear + "–" + c.endYear + ")";
      opt.disabled = false;
      if (c.code === selectedCode) opt.selected = true;
      sel.appendChild(opt);
    });
    if (disabled.length) {
      const divider = document.createElement("option");
      divider.disabled = true;
      divider.textContent = "— Not available for selected years —";
      divider.value = "";
      sel.appendChild(divider);
      disabled.forEach(function (c) {
        const opt = document.createElement("option");
        opt.value = c.code;
        opt.textContent = c.flag + " " + c.name + " (" + c.startYear + "–" + c.endYear + ")";
        opt.disabled = true;
        sel.appendChild(opt);
      });
    }

    if (!enabled.length) return;
    const stillSelected = enabled.some(function (c) { return c.code === selectedCode; });
    if (!stillSelected && enabled[0]) sel.value = enabled[0].code;
  }

  function populateYearDropdowns(country, startYear, endYear) {
    const startSel = $("start_year");
    const endSel = $("end_year");
    if (!startSel || !endSel) return;
    const range = getGlobalYearRange();
    const minY = country ? country.startYear : range.min;
    const maxY = country ? country.endYear : range.max;

    startSel.innerHTML = "";
    endSel.innerHTML = "";
    for (let y = range.min; y <= range.max; y++) {
      const sOpt = document.createElement("option");
      sOpt.value = y;
      sOpt.textContent = y;
      if (y === startYear) sOpt.selected = true;
      startSel.appendChild(sOpt);
      const eOpt = document.createElement("option");
      eOpt.value = y;
      eOpt.textContent = y;
      if (y === endYear) eOpt.selected = true;
      endSel.appendChild(eOpt);
    }
  }

  function getSelectedCountry() {
    const sel = $("country_select");
    const code = sel ? sel.value : null;
    if (!manifest || !manifest.countries) return null;
    return manifest.countries.find(function (c) { return c.code === code; }) || null;
  }

  function getSelectedYears() {
    const startSel = $("start_year");
    const endSel = $("end_year");
    const start = startSel ? parseInt(startSel.value, 10) : NaN;
    const end = endSel ? parseInt(endSel.value, 10) : NaN;
    return { startYear: Number.isFinite(start) ? start : null, endYear: Number.isFinite(end) ? end : null };
  }

  function ensureCountryData(code) {
    return E.loadCountryData(code);
  }

  function renderPrimaryAndStats(country, startYear, endYear, amount, data) {
    const primaryEl = $("primary_result");
    const totalChangeEl = $("total_change_magnitude");
    const annualRateEl = $("annualized_rate");
    const noDataEl = $("no_data_message");
    const statsRow = $("stats_row");

    if (!data || !data.cpi) {
      if (noDataEl) noDataEl.style.display = "block";
      if (primaryEl) primaryEl.textContent = "";
      if (statsRow) statsRow.style.display = "none";
      return;
    }

    if (noDataEl) noDataEl.style.display = "none";
    if (statsRow) statsRow.style.display = "";

    const ratio = E.computeRatio(data.cpi, startYear, endYear);
    if (ratio == null) {
      if (primaryEl) primaryEl.textContent = "Data missing for selected year.";
      if (totalChangeEl) totalChangeEl.textContent = "";
      if (annualRateEl) annualRateEl.textContent = "";
      return;
    }

    const converted = E.computeConverted(amount, ratio);
    const flag = (country && country.flag) ? country.flag + " " : "";
    const fmt = E.formatMoneyInt;
    const fromY = startYear;
    const toY = endYear;
    if (primaryEl) {
      primaryEl.textContent = flag + "$" + fmt(amount) + " in " + fromY + " → $" + fmt(converted) + " in " + toY;
    }

    const pctMag = E.computePercentChangeMagnitude(ratio);
    if (totalChangeEl) totalChangeEl.textContent = (pctMag != null ? pctMag.toFixed(1) : "–") + "%";
    const annRate = E.computeAnnualizedRate(ratio, startYear, endYear);
    if (annualRateEl) annualRateEl.textContent = "+" + (annRate != null ? Math.abs(annRate * 100).toFixed(2) : "0.00") + "% annualized inflation";
  }

  function renderComparisonList(selectedCountry, startYear, endYear, amount, availableCountries) {
    const container = $("comparison_list");
    if (!container) return;
    container.innerHTML = "";

    if (!availableCountries.length) {
      container.appendChild(document.createTextNode("No datasets available for the selected years."));
      return;
    }

    const selectedCode = selectedCountry ? selectedCountry.code : null;
    const rows = [];
    const loadPromises = [];

    availableCountries.forEach(function (c) {
      loadPromises.push(
        ensureCountryData(c.code).then(function (data) {
          if (!data || !data.cpi) return null;
          const ratio = E.computeRatio(data.cpi, startYear, endYear);
          if (ratio == null) return null;
          const converted = E.computeConverted(amount, ratio);
          return { country: c, converted: converted };
        })
      );
    });

    Promise.all(loadPromises).then(function (results) {
      const valid = results.filter(function (r) { return r != null; });
      valid.sort(function (a, b) {
        if (a.country.code === selectedCode) return -1;
        if (b.country.code === selectedCode) return 1;
        return (b.converted || 0) - (a.converted || 0);
      });
      valid.forEach(function (item) {
        const c = item.country;
        const conv = item.converted;
        const line = document.createElement("div");
        line.className = "comparison-row" + (c.code === selectedCode ? " comparison-row-selected" : "");
        line.textContent = c.flag + " " + c.name + " — $" + E.formatMoneyInt(amount) + " → $" + E.formatMoneyInt(conv);
        container.appendChild(line);
      });
    });
  }

  function updateUI() {
    const years = getSelectedYears();
    const startYear = years.startYear;
    const endYear = years.endYear;
    const available = getAvailableCountries(startYear, endYear);
    const currentCode = ($("country_select") && $("country_select").value) || null;
    renderCountrySelect(currentCode, startYear, endYear);

    const country = getSelectedCountry();
    const amountEl = $("amount_input");
    const amount = Number.isFinite(num(amountEl ? amountEl.value : "")) ? num(amountEl.value) : 100;

    if (!country || !available.length) {
      if ($("primary_result")) $("primary_result").textContent = "";
      if ($("stats_row")) $("stats_row").style.display = "none";
      if ($("loading_primary")) $("loading_primary").style.display = "none";
      if ($("no_data_message")) {
        $("no_data_message").style.display = "block";
        $("no_data_message").textContent = "No datasets available for the selected years.";
      }
      if ($("comparison_list")) $("comparison_list").innerHTML = "";
      return;
    }

    if ($("no_data_message")) $("no_data_message").style.display = "none";

    const primaryEl = $("primary_result");
    const loadingEl = $("loading_primary");
    if (loadingEl) loadingEl.style.display = "inline";
    ensureCountryData(country.code).then(function (data) {
      if (loadingEl) loadingEl.style.display = "none";
      renderPrimaryAndStats(country, startYear, endYear, amount, data);
    }).catch(function () {
      if (loadingEl) loadingEl.style.display = "none";
      primaryEl.textContent = "Data missing for selected year.";
    });

    renderComparisonList(country, startYear, endYear, amount, available);
  }

  function setDefaults() {
    manifest = null;
    E.loadManifest().then(function (m) {
      manifest = m;
      const country = getDefaultCountry();
      const endYear = country ? country.endYear : 2025;
      const startYear = country && country.startYear <= 1914 ? 1914 : (country ? country.startYear : 1914);
      renderCountrySelect(country ? country.code : "", startYear, endYear);
      populateYearDropdowns(country, startYear, endYear);
      const startSel = $("start_year");
      const endSel = $("end_year");
      if (startSel) startSel.value = startYear;
      if (endSel) endSel.value = endYear;
      const amountEl = $("amount_input");
      if (amountEl) amountEl.value = "100";
      updateUI();
    }).catch(function (err) {
      console.error("Failed to load manifest", err);
      if ($("loading_primary")) $("loading_primary").style.display = "none";
      if ($("no_data_message")) {
        $("no_data_message").style.display = "block";
        $("no_data_message").textContent = "Could not load country list.";
      }
    });
  }

  function swapYears() {
    const startSel = $("start_year");
    const endSel = $("end_year");
    if (!startSel || !endSel) return;
    const s = startSel.value;
    const e = endSel.value;
    startSel.value = e;
    endSel.value = s;
    updateUI();
  }

  function init() {
    const countrySel = $("country_select");
    const startSel = $("start_year");
    const endSel = $("end_year");
    const amountEl = $("amount_input");
    const swapBtn = $("swap_years_btn");

    if (amountEl) {
      amountEl.addEventListener("input", updateUI);
      amountEl.addEventListener("change", updateUI);
    }
    if (countrySel) countrySel.addEventListener("change", updateUI);
    if (startSel) startSel.addEventListener("change", updateUI);
    if (endSel) endSel.addEventListener("change", updateUI);
    if (swapBtn) swapBtn.addEventListener("click", swapYears);

    setDefaults();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
