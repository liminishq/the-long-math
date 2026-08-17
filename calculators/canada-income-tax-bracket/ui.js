import { loadTaxData } from "../canada-income-tax/js/tax.data.js";
import { formatCurrency, formatPercent, parseInput } from "../canada-income-tax/js/format.js";
import {
  SUPPORTED_TAX_YEARS,
  TAX_DATA_BASE_PATH,
  analyzeOrdinaryTaxPosition
} from "../canada-income-tax/js/tax-thresholds.js";

(function () {
  "use strict";

  if (window.TLM && window.TLM.calculatorInDevelopment) {
    return;
  }

  const PROVINCES = [
    ["AB", "Alberta"],
    ["BC", "British Columbia"],
    ["MB", "Manitoba"],
    ["NB", "New Brunswick"],
    ["NL", "Newfoundland and Labrador"],
    ["NS", "Nova Scotia"],
    ["NT", "Northwest Territories"],
    ["NU", "Nunavut"],
    ["ON", "Ontario"],
    ["PE", "Prince Edward Island"],
    ["QC", "Quebec"],
    ["SK", "Saskatchewan"],
    ["YT", "Yukon"]
  ];

  const QC_WARNING =
    "Quebec personal tax (QPP, QPIP, TP-1, federal Quebec abatement) is not form-verified in the shared engine. Figures follow the engine’s current Quebec parameters and may not match a Quebec return.";

  const $ = (id) => document.getElementById(id);

  /** @type {Map<number, object>} */
  const yearData = new Map();
  /** @type {Map<string, object>} */
  const analysisCache = new Map();

  let lastEventKey = "";

  function moneyWhole(value) {
    if (value == null || Number.isNaN(value)) return "$–";
    try {
      return new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(Math.round(value));
    } catch {
      return formatCurrency(value);
    }
  }

  function pct(value) {
    return formatPercent(value, 1);
  }

  function defaultYear() {
    return Math.max(...SUPPORTED_TAX_YEARS);
  }

  function populateControls() {
    const yearSelect = $("tax_year");
    if (yearSelect && yearSelect.options.length === 0) {
      SUPPORTED_TAX_YEARS.slice()
        .sort((a, b) => b - a)
        .forEach((year) => {
          const option = document.createElement("option");
          option.value = String(year);
          option.textContent = String(year);
          yearSelect.appendChild(option);
        });
      yearSelect.value = String(defaultYear());
    }

    const provinceSelect = $("province");
    if (provinceSelect && provinceSelect.options.length === 0) {
      PROVINCES.forEach(([code, name]) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = name;
        provinceSelect.appendChild(option);
      });
      provinceSelect.value = "ON";
    }
  }

  async function ensureYear(year) {
    if (!yearData.has(year)) {
      const data = await loadTaxData(year, { basePath: TAX_DATA_BASE_PATH });
      yearData.set(year, data);
    }
    return yearData.get(year);
  }

  function readInputs() {
    const year = Number($("tax_year")?.value) || defaultYear();
    const province = $("province")?.value || "ON";
    const taxableIncome = parseInput($("taxable_income")?.value || "0");
    return { year, province, taxableIncome };
  }

  function track(eventName, params) {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, {
      calculator_name: "canada-income-tax-bracket",
      ...params
    });
  }

  function fillCompareBox(box, title, rows) {
    box.innerHTML = "";
    const h4 = document.createElement("h4");
    h4.textContent = title;
    box.appendChild(h4);
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "compare-row";
      const l = document.createElement("span");
      l.textContent = label;
      const v = document.createElement("span");
      v.textContent = value;
      row.append(l, v);
      box.appendChild(row);
    });
  }

  function renderPrimary(analysis) {
    $("marginal_rate").textContent = pct(analysis.marginalRate);
    $("average_rate").textContent = pct(analysis.averageRate);
    $("federal_tax").textContent = moneyWhole(analysis.federalTax);
    $("provincial_tax").textContent = moneyWhole(analysis.provincialTax);
    $("total_tax").textContent = moneyWhole(analysis.totalIncomeTax);
    $("after_tax").textContent = moneyWhole(analysis.afterTaxIncome);
  }

  function renderNext(analysis) {
    const card = $("next_threshold_card");
    const next = analysis.next;
    if (!next) {
      card.innerHTML = `
        <h3>Next tax-rate threshold</h3>
        <p class="threshold-lead">Highest marginal-rate band</p>
        <p class="threshold-distance">You are already in the highest marginal-rate band represented by this tax system for the selected year and province.</p>
      `;
      return;
    }

    const reason = next.reason ? ` <span class="help-text">(${next.reason})</span>` : "";
    card.innerHTML = `
      <h3>Next tax-rate threshold</h3>
      <p class="threshold-lead">Next threshold: ${moneyWhole(next.threshold)}${reason}</p>
      <p class="threshold-distance">You are ${moneyWhole(next.distanceBelow)} below it.</p>
      <div class="compare-grid">
        <div class="compare-box" id="next_current_box"></div>
        <div class="compare-box" id="next_above_box"></div>
      </div>
      <ul class="delta-list">
        <li><span>Additional tax to reach threshold income</span><strong>${moneyWhole(next.additionalTax)}</strong></li>
        <li><span>Additional after-tax income</span><strong>${moneyWhole(next.additionalAfterTax)}</strong></li>
      </ul>
    `;
    fillCompareBox($("next_current_box"), "Current", [
      ["Taxable income", moneyWhole(next.current.taxableIncome)],
      ["Marginal rate", pct(next.current.marginalRate)],
      ["Average rate", pct(next.current.averageRate)]
    ]);
    fillCompareBox($("next_above_box"), "At threshold", [
      ["Taxable income", moneyWhole(next.above.taxableIncome)],
      ["Marginal rate", pct(next.above.marginalRate)],
      ["Average rate", pct(next.above.averageRate)]
    ]);
  }

  function renderPrevious(analysis) {
    const card = $("previous_threshold_card");
    const prev = analysis.previous;
    if (prev?.none) {
      card.innerHTML = `
        <h3>Previous tax-rate threshold</h3>
        <p class="threshold-lead">No lower tax-rate threshold</p>
        <p class="threshold-distance">Your taxable income is already at or below the first income level where the combined marginal tax treatment changes for this year and province.</p>
      `;
      return;
    }

    const reason = prev.reason ? ` <span class="help-text">(${prev.reason})</span>` : "";
    const distanceText = prev.atExactThreshold
      ? "Your taxable income is at this threshold. Income immediately below it is in the preceding marginal-rate band."
      : `Your taxable income would need to be ${moneyWhole(prev.distanceToFallBelow)} lower to fall below it.`;

    card.innerHTML = `
      <h3>Previous tax-rate threshold</h3>
      <p class="threshold-lead">Previous threshold: ${moneyWhole(prev.threshold)}${reason}</p>
      <p class="threshold-distance">${distanceText}</p>
      <div class="compare-grid">
        <div class="compare-box" id="prev_current_box"></div>
        <div class="compare-box" id="prev_below_box"></div>
      </div>
      <ul class="delta-list">
        <li><span>Reduction in taxable income</span><strong>${moneyWhole(prev.reductionInTaxableIncome)}</strong></li>
        <li><span>Reduction in income tax</span><strong>${moneyWhole(prev.reductionInIncomeTax)}</strong></li>
        <li><span>Reduction in after-tax income</span><strong>${moneyWhole(prev.reductionInAfterTaxIncome)}</strong></li>
      </ul>
    `;

    fillCompareBox($("prev_current_box"), "Current", [
      ["Taxable income", moneyWhole(prev.current.taxableIncome)],
      ["Marginal rate", pct(prev.current.marginalRate)],
      ["Average rate", pct(prev.current.averageRate)]
    ]);
    fillCompareBox($("prev_below_box"), "Immediately below threshold", [
      ["Taxable income", moneyWhole(prev.below.taxableIncome)],
      ["Marginal rate", pct(prev.below.marginalRate)],
      ["Average rate", pct(prev.below.averageRate)]
    ]);
  }

  function formatRange(from, to) {
    if (to == null) return `${moneyWhole(from)} and above`;
    return `${moneyWhole(from)} to under ${moneyWhole(to)}`;
  }

  /**
   * Statutory bracket thermometer: scale ends at the start of the top bracket.
   * Income at or above that threshold fills the chart and shows an above-top marker.
   */
  function statutoryBracketPosition(brackets, income) {
    const list = Array.isArray(brackets) ? brackets.filter((b) => Number.isFinite(b.threshold)) : [];
    if (!list.length) {
      return {
        scaleMax: 1,
        fillPct: 0,
        aboveTop: false,
        currentRate: 0,
        ticks: [],
        bands: []
      };
    }
    const sorted = [...list].sort((a, b) => a.threshold - b.threshold);
    const topStart = sorted[sorted.length - 1].threshold;
    const scaleMax = Math.max(topStart, 1);
    const aboveTop = income >= scaleMax - 0.005;
    const fillPct = aboveTop ? 100 : Math.max(0, Math.min(100, (income / scaleMax) * 100));

    let currentRate = sorted[0].rate;
    for (const b of sorted) {
      if (income > b.threshold) currentRate = b.rate;
    }

    const ticks = sorted.map((b) => ({
      threshold: b.threshold,
      rate: b.rate,
      pct: Math.max(0, Math.min(100, (b.threshold / scaleMax) * 100))
    }));

    // Visible bands inside [0, scaleMax]: each uses the rate of that segment.
    // The top statutory rate applies only above scaleMax (shown via badge / caption).
    const bands = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i].threshold;
      const hi = sorted[i + 1].threshold;
      const loPct = (lo / scaleMax) * 100;
      const hiPct = (hi / scaleMax) * 100;
      bands.push({
        rate: sorted[i].rate,
        loPct,
        hiPct,
        midPct: (loPct + hiPct) / 2,
        heightPct: hiPct - loPct
      });
    }

    return { scaleMax, fillPct, aboveTop, currentRate, ticks, bands, topRate: sorted[sorted.length - 1].rate };
  }

  function renderOneBracketChart(container, title, jurisdictionWord, brackets, income) {
    if (!container) return;
    const pos = statutoryBracketPosition(brackets, income);
    const place = jurisdictionWord || "statutory";
    const caption = pos.aboveTop
      ? `Taxable income is at or above the top ${place} bracket (${pct(pos.currentRate)}).`
      : `Taxable income is in the ${pct(pos.currentRate)} ${place} bracket.`;

    container.innerHTML = "";
    const heading = document.createElement("h4");
    heading.className = "bracket-chart-title";
    heading.textContent = title;

    const plot = document.createElement("div");
    plot.className = "bracket-chart-plot";
    plot.setAttribute("role", "img");
    plot.setAttribute(
      "aria-label",
      `${title}: ${caption} Scale from $0 to ${moneyWhole(pos.scaleMax)} (start of top bracket).`
    );

    const labels = document.createElement("div");
    labels.className = "bracket-chart-labels";

    // Dollar thresholds only on the y-axis; skip crowded labels.
    const MIN_LABEL_GAP_PCT = 7;
    let lastShownPct = -Infinity;
    const dollarTicks = [
      { threshold: 0, pct: 0 },
      ...pos.ticks.filter((t) => t.threshold > 0)
    ];
    dollarTicks.forEach((tick) => {
      if (tick.pct - lastShownPct < MIN_LABEL_GAP_PCT && tick.threshold !== 0) return;
      // Prefer keeping top threshold even if crowded with previous.
      if (tick.pct >= 97 && lastShownPct > 90) {
        // drop previous crowded mid label by not blocking top
      }
      const lab = document.createElement("div");
      lab.className = "bracket-chart-label";
      if (tick.threshold === 0) lab.classList.add("is-baseline");
      else if (tick.pct >= 97) lab.classList.add("is-top");
      lab.style.bottom = `${tick.pct}%`;
      lab.innerHTML = `<strong>${moneyWhole(tick.threshold)}</strong>`;
      labels.appendChild(lab);
      lastShownPct = tick.pct;
    });

    const trackWrap = document.createElement("div");
    trackWrap.className = "bracket-chart-track-wrap";

    pos.ticks.forEach((tick) => {
      if (tick.threshold <= 0) return;
      const tickEl = document.createElement("div");
      tickEl.className = "bracket-chart-tick";
      tickEl.style.bottom = `${tick.pct}%`;
      trackWrap.appendChild(tickEl);
    });

    // Rate labels centered inside each visible band.
    const MIN_BAND_LABEL_PCT = 5.5;
    pos.bands.forEach((band) => {
      if (band.heightPct < MIN_BAND_LABEL_PCT) return;
      const rateLab = document.createElement("div");
      rateLab.className = "bracket-band-rate";
      rateLab.style.bottom = `${band.midPct}%`;
      rateLab.textContent = pct(band.rate);
      trackWrap.appendChild(rateLab);
    });

    const fill = document.createElement("div");
    fill.className = "bracket-chart-fill";
    fill.style.height = `${pos.fillPct}%`;
    trackWrap.appendChild(fill);

    const line = document.createElement("div");
    line.className = "bracket-chart-income-line";
    line.style.bottom = `${pos.fillPct}%`;
    trackWrap.appendChild(line);

    if (pos.aboveTop) {
      const badge = document.createElement("div");
      badge.className = "bracket-chart-above";
      badge.textContent =
        income > pos.scaleMax + 0.005
          ? `Above top · ${pct(pos.topRate)}`
          : `Top bracket · ${pct(pos.topRate)}`;
      trackWrap.appendChild(badge);
    }

    plot.append(labels, trackWrap);

    const cap = document.createElement("p");
    cap.className = "bracket-chart-caption";
    cap.innerHTML = `<strong>${moneyWhole(income)}</strong> · ${caption}`;

    container.append(heading, plot, cap);
  }

  function renderBracketCharts(taxData, province, income) {
    const fed = taxData?.federal?.brackets || [];
    const prov = taxData?.provinces?.[province];
    renderOneBracketChart($("federal_bracket_chart"), "Federal brackets", "federal", fed, income);
    renderOneBracketChart(
      $("provincial_bracket_chart"),
      `${prov?.name || province} brackets`,
      (prov?.name || province).toLowerCase(),
      prov?.brackets || [],
      income
    );
  }

  function renderSchedule(analysis) {
    const tbody = $("schedule_body");
    const ohpNote = $("schedule_ohp_note");
    tbody.innerHTML = "";

    const hasOhp = analysis.bands.some((band) =>
      String(band.changeReason || "").includes("Ontario Health Premium")
    );
    if (ohpNote) ohpNote.hidden = !hasOhp;

    analysis.bands.forEach((band) => {
      const tr = document.createElement("tr");
      const reason = band.changeReason || (band.from === 0 ? "Starting band" : "—");
      const inBand =
        analysis.taxableIncome >= band.from - 0.005 &&
        (band.to == null || analysis.taxableIncome < band.to - 0.005);
      const classes = [];
      if (inBand) {
        classes.push("is-current");
        tr.setAttribute("aria-current", "true");
      }
      if (String(reason).includes("phase-in begins")) {
        classes.push("is-ohp-phase-in");
      } else if (String(reason).includes("becomes flat")) {
        classes.push("is-ohp-flat");
      }
      if (classes.length) tr.className = classes.join(" ");

      const tdRange = document.createElement("td");
      tdRange.textContent = formatRange(band.from, band.to);
      const tdRate = document.createElement("td");
      tdRate.textContent = pct(band.marginalRate);
      const tdChange = document.createElement("td");
      tdChange.textContent = reason;
      tr.append(tdRange, tdRate, tdChange);
      tbody.appendChild(tr);
    });
  }

  function updateProvinceWarning(province) {
    const el = $("province_warning");
    if (!el) return;
    if (province === "QC") {
      el.hidden = false;
      el.textContent = QC_WARNING;
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  async function recalculate(source) {
    const status = $("calc_status");
    try {
      const { year, province, taxableIncome } = readInputs();
      updateProvinceWarning(province);
      if (status) status.textContent = "Calculating…";

      const taxData = await ensureYear(year);
      const cacheKey = `${year}|${province}|${taxableIncome}`;
      let analysis = analysisCache.get(cacheKey);
      if (!analysis) {
        // Drop old cache entries to bound memory when income is typed.
        if (analysisCache.size > 40) analysisCache.clear();
        analysis = analyzeOrdinaryTaxPosition(year, province, taxableIncome, {
          taxData,
          dataOverride: taxData
        });
        analysisCache.set(cacheKey, analysis);
      }

      renderPrimary(analysis);
      renderBracketCharts(taxData, province, taxableIncome);
      renderNext(analysis);
      renderPrevious(analysis);
      renderSchedule(analysis);

      if (status) {
        status.textContent = `Results for ${year} · ${province} · ordinary taxable income`;
      }

      const eventKey = `${year}|${province}|${Math.round(taxableIncome)}`;
      if (source === "init") {
        track("calculator_view", { tax_year: year, province });
      } else if (source === "year") {
        track("tax_year_change", { tax_year: year, province });
      } else if (source === "province") {
        track("province_change", { tax_year: year, province });
      }
      if (source !== "init" && eventKey !== lastEventKey) {
        track("calculation_completed", {
          tax_year: year,
          province,
          taxable_income_bucket: Math.round(taxableIncome / 10000) * 10000
        });
        lastEventKey = eventKey;
      }
    } catch (err) {
      console.error(err);
      if (status) {
        status.textContent =
          "Calculation unavailable. Tax data could not be loaded. Try refreshing, or open the page from a local server.";
      }
    }
  }

  function wireShare() {
    if (!window.TLM?.shareCard?.wireCalculatorShare) return;
    if (document.body?.dataset?.tlmBracketShareWired === "1") return;
    window.TLM.shareCard.wireCalculatorShare("canada-income-tax-bracket", () => {
      const { year, province, taxableIncome } = readInputs();
      const provinceName =
        PROVINCES.find(([code]) => code === province)?.[1] || province;
      return {
        scenario: {
          tax_year: String(year),
          province,
          taxable_income: String(taxableIncome)
        },
        card: {
          headline: "Canadian Income Tax Bracket Calculator",
          mainValue: $("marginal_rate")?.textContent || "–%",
          subline: `Combined marginal rate · ${year} · ${provinceName}`,
          contextLines: [
            `Taxable income: ${moneyWhole(taxableIncome)}`,
            `Average rate: ${$("average_rate")?.textContent || "–%"}`,
            `Total income tax: ${$("total_tax")?.textContent || "$–"}`,
            `After-tax income: ${$("after_tax")?.textContent || "$–"}`
          ],
          shareText:
            "Canadian income tax bracket snapshot from The Long Math. Run your own numbers:",
          title: "The Long Math — income tax bracket result"
        }
      };
    });
    if (document.body?.dataset) document.body.dataset.tlmBracketShareWired = "1";
  }

  function bind() {
    populateControls();
    $("tax_year")?.addEventListener("change", () => {
      analysisCache.clear();
      recalculate("year");
    });
    $("province")?.addEventListener("change", () => {
      analysisCache.clear();
      recalculate("province");
    });

    let incomeTimer = null;
    $("taxable_income")?.addEventListener("input", () => {
      clearTimeout(incomeTimer);
      incomeTimer = setTimeout(() => recalculate("income"), 120);
    });
    $("taxable_income")?.addEventListener("change", () => recalculate("income"));

    wireShare();
    // Share script may load after this module.
    window.addEventListener("load", wireShare);
    recalculate("init");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
