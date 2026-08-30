/**
 * Canada Capital Gains Tax Calculator — UI (ES module).
 * Progressive incremental tax by default; optional manual marginal-rate sensitivity.
 */

import {
  calculateProgressiveCapitalGainsTax,
  calculateManualMarginalRateEstimate,
  CAPITAL_GAINS_INCLUSION_RATE,
  CALC_MODES,
  buildShareScenario,
  parseShareQuery,
  buildCsvRows
} from "./engine.js";
import { getTaxDataBundle } from "../canada-income-tax/js/tax.data.js";

const TAX_DATA_BASE_PATH = "/calculators/canada-income-tax/data";
const CALC_SLUG = "capital-gains-tax-canada";

const DEFAULTS = Object.freeze({
  mode: CALC_MODES.PROGRESSIVE,
  year: 2025,
  province: "ON",
  incomeBeforeGain: 50000,
  capitalGain: 200000,
  inclusionRate: 50,
  marginalTaxRate: 40,
  proceeds: "",
  acb: "",
  primaryResidenceExemption: false
});

/** @type {Map<number, object>} */
const taxBundleByYear = new Map();

let latestInputs = null;
let latestResult = null;
let updatingFromProceeds = false;
let shareWired = false;

function $(id) {
  return document.getElementById(id);
}

function parseNum(x) {
  if (x == null) return NaN;
  const s = String(x).trim().replace(/,/g, "").replace(/\s/g, "");
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function fmtCAD(n) {
  if (n == null || !Number.isFinite(n)) return "$–";
  return Math.round(n).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  });
}

function fmtPct(rate, digits = 1) {
  if (rate == null || !Number.isFinite(rate)) return "–";
  return (rate * 100).toFixed(digits) + "%";
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setVisible(id, visible) {
  const el = $(id);
  if (!el) return;
  el.hidden = !visible;
  el.style.display = visible ? "" : "none";
}

function getMode() {
  const checked = document.querySelector('input[name="calc_mode"]:checked');
  return checked && checked.value === CALC_MODES.MANUAL
    ? CALC_MODES.MANUAL
    : CALC_MODES.PROGRESSIVE;
}

function setMode(mode) {
  const value = mode === CALC_MODES.MANUAL ? CALC_MODES.MANUAL : CALC_MODES.PROGRESSIVE;
  const radio = document.querySelector(`input[name="calc_mode"][value="${value}"]`);
  if (radio) radio.checked = true;
  syncModePanels();
}

function syncModePanels() {
  const manual = getMode() === CALC_MODES.MANUAL;
  document.querySelectorAll("[data-mode-panel='progressive']").forEach((el) => {
    el.hidden = manual;
  });
  document.querySelectorAll("[data-mode-panel='manual']").forEach((el) => {
    el.hidden = !manual;
  });
  document.querySelectorAll("[data-results-panel='progressive']").forEach((el) => {
    el.hidden = manual;
  });
  document.querySelectorAll("[data-results-panel='manual']").forEach((el) => {
    el.hidden = !manual;
  });
}

async function ensureTaxBundle(year) {
  const y = Number(year);
  if (taxBundleByYear.has(y)) return taxBundleByYear.get(y);
  const bundle = await getTaxDataBundle(y, { basePath: TAX_DATA_BASE_PATH });
  taxBundleByYear.set(y, bundle);
  return bundle;
}

function readInputs() {
  const mode = getMode();
  const year = Number.parseInt(($("tax_year") && $("tax_year").value) || DEFAULTS.year, 10);
  const province = (($("province") && $("province").value) || "").trim().toUpperCase();
  const incomeRaw = parseNum($("income_before_gain") && $("income_before_gain").value);
  const gainRaw = parseNum($("capital_gain") && $("capital_gain").value);
  const proceedsRaw = parseNum($("proceeds") && $("proceeds").value);
  const acbRaw = parseNum($("acb") && $("acb").value);
  const inclusionRaw = parseNum($("inclusion_rate") && $("inclusion_rate").value);
  const mtrRaw = parseNum($("marginal_tax_rate") && $("marginal_tax_rate").value);
  const exemptionEl = $("primary_residence_exemption");

  return {
    mode,
    year: Number.isFinite(year) ? year : DEFAULTS.year,
    province,
    incomeBeforeGain: Number.isFinite(incomeRaw) ? incomeRaw : 0,
    capitalGain: Number.isFinite(gainRaw) ? gainRaw : 0,
    proceeds: Number.isFinite(proceedsRaw) ? proceedsRaw : null,
    acb: Number.isFinite(acbRaw) ? acbRaw : null,
    inclusionRate: Number.isFinite(inclusionRaw) ? inclusionRaw : DEFAULTS.inclusionRate,
    marginalTaxRate: Number.isFinite(mtrRaw) ? mtrRaw : 0,
    primaryResidenceExemption: exemptionEl ? exemptionEl.checked : false
  };
}

function scenarioFromInputs(inputs) {
  return buildShareScenario(inputs);
}

function applyScenarioFromUrl() {
  try {
    const parsed = parseShareQuery(new URLSearchParams(window.location.search));
    if (!parsed) return;

    if (parsed.mode) setMode(parsed.mode);
    if (parsed.year != null && $("tax_year")) $("tax_year").value = String(parsed.year);
    if (parsed.province && $("province")) $("province").value = parsed.province;
    if (parsed.incomeBeforeGain != null && $("income_before_gain")) {
      $("income_before_gain").value = String(parsed.incomeBeforeGain);
    }
    if (parsed.capitalGain != null && $("capital_gain")) {
      $("capital_gain").value = String(parsed.capitalGain);
    }
    if (parsed.proceeds != null && $("proceeds")) $("proceeds").value = String(parsed.proceeds);
    if (parsed.acb != null && $("acb")) $("acb").value = String(parsed.acb);
    if (parsed.inclusionRate != null && $("inclusion_rate")) {
      $("inclusion_rate").value = String(parsed.inclusionRate);
    }
    if (parsed.marginalTaxRate != null && $("marginal_tax_rate")) {
      $("marginal_tax_rate").value = String(parsed.marginalTaxRate);
    }
    if ($("primary_residence_exemption")) {
      $("primary_residence_exemption").checked = !!parsed.primaryResidenceExemption;
    }
    if (parsed.proceeds != null && parsed.acb != null && parsed.capitalGain == null) {
      fillGainFromProceedsAcb();
    }

    if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
      window.TLM.shareCard.track("calculator_shared_scenario_loaded", {
        calculator_name: CALC_SLUG
      });
    }
  } catch (_err) {
    /* ignore malformed query */
  }
}

function fillGainFromProceedsAcb() {
  const proceedsEl = $("proceeds");
  const acbEl = $("acb");
  const gainEl = $("capital_gain");
  if (!proceedsEl || !acbEl || !gainEl) return;

  const proceeds = parseNum(proceedsEl.value);
  const acb = parseNum(acbEl.value);
  if (!Number.isFinite(proceeds) || !Number.isFinite(acb)) return;

  updatingFromProceeds = true;
  gainEl.value = String(Math.round(proceeds - acb));
  updatingFromProceeds = false;
}

function renderProgressive(result) {
  setText("out_taxable_income_before", fmtCAD(result.taxableIncomeBefore));
  setText("out_tax_before", fmtCAD(result.taxBefore));
  setText(
    "out_gross_gain",
    result.isLoss ? fmtCAD(result.capitalGain) + " (Capital loss)" : fmtCAD(result.capitalGain)
  );
  setText("out_taxable_included", fmtCAD(result.taxableIncluded));
  setText("out_taxable_income_after", fmtCAD(result.taxableIncomeAfter));
  setText("out_tax_after", fmtCAD(result.taxAfter));
  setText("out_additional_tax", fmtCAD(result.additionalTax));
  setText("out_effective_rate", fmtPct(result.effectiveRateOnGross, 2));

  const mtrNote = $("out_marginal_after_note");
  if (mtrNote) {
    if (result.marginalRateAfter != null && Number.isFinite(result.marginalRateAfter) && !result.isLoss) {
      mtrNote.hidden = false;
      mtrNote.textContent =
        "Marginal rate after the gain: " +
        fmtPct(result.marginalRateAfter, 2) +
        ". That is the rate on the next dollar of taxable income — not a single rate applied to the whole gain.";
    } else {
      mtrNote.hidden = true;
      mtrNote.textContent = "";
    }
  }
}

function renderManual(result) {
  setText(
    "out_manual_gain",
    result.isLoss ? fmtCAD(result.capitalGain) + " (Capital loss)" : fmtCAD(result.capitalGain)
  );
  setText("out_manual_taxable", fmtCAD(result.taxableGain));
  setText("out_manual_tax", fmtCAD(result.taxOwing));
  setText("out_manual_effective", fmtPct(result.effectiveRateOnGross, 2));
}

function renderMessages(result) {
  const lossMsgEl = $("out_capital_loss_message");
  const exemptionMsgEl = $("out_exemption_message");

  if (lossMsgEl) {
    if (result.isLoss) {
      lossMsgEl.style.display = "block";
      lossMsgEl.textContent =
        "Capital loss (gain ≤ 0). Included taxable amount and incremental tax are set to $0 in this calculator. Loss carryovers are not modelled.";
    } else {
      lossMsgEl.style.display = "none";
      lossMsgEl.textContent = "";
    }
  }

  if (exemptionMsgEl) {
    if (result.primaryResidenceExemption && !result.isLoss) {
      exemptionMsgEl.style.display = "block";
      exemptionMsgEl.textContent =
        "Primary residence exemption applied (educational only). Gross gain still shown; included amount and incremental tax set to $0.";
    } else {
      exemptionMsgEl.style.display = "none";
      exemptionMsgEl.textContent = "";
    }
  }
}

function renderShowMath(inputs, result) {
  const container = $("show_math_content");
  if (!container) return;

  let html = '<div class="show-math-block">';

  if (result.mode === CALC_MODES.PROGRESSIVE) {
    html += "<p><strong>Progressive incremental tax</strong></p>";
    html +=
      "<p>Taxable income before the gain is modelled as source-neutral other income in the shared personal-tax engine (no CPP, EI, or Canada Employment Amount from that amount). Inclusion rate is fixed at " +
      Math.round(CAPITAL_GAINS_INCLUSION_RATE * 100) +
      "%.</p>";
    html +=
      "<p>Gross capital gain = " +
      fmtCAD(result.capitalGain) +
      (result.isLoss ? " (loss → included = $0)" : "") +
      "</p>";
    if (result.primaryResidenceExemption && !result.isLoss) {
      html += "<p>Primary residence exemption (educational) → included taxable gain = $0.</p>";
    } else if (!result.isLoss) {
      html +=
        "<p>Included taxable gain = " +
        fmtCAD(result.capitalGain) +
        " × " +
        Math.round(result.inclusionRate * 100) +
        "% = " +
        fmtCAD(result.taxableIncluded) +
        "</p>";
    }
    html +=
      "<p>Tax before gain = " +
      fmtCAD(result.taxBefore) +
      " (taxable income " +
      fmtCAD(result.taxableIncomeBefore) +
      ")</p>";
    html +=
      "<p>Tax after gain = " +
      fmtCAD(result.taxAfter) +
      " (taxable income " +
      fmtCAD(result.taxableIncomeAfter) +
      ")</p>";
    html +=
      "<p><strong>Additional tax = tax after − tax before</strong> = " +
      fmtCAD(result.taxAfter) +
      " − " +
      fmtCAD(result.taxBefore) +
      " = " +
      fmtCAD(result.additionalTax) +
      "</p>";
    if (!result.isLoss && result.capitalGain > 0) {
      html +=
        "<p>Effective tax rate on gross gain = " +
        fmtCAD(result.additionalTax) +
        " ÷ " +
        fmtCAD(result.capitalGain) +
        " = " +
        fmtPct(result.effectiveRateOnGross, 2) +
        "</p>";
    }
    html +=
      "<p>This is not “one marginal rate × the whole gain.” Brackets and credits can change as taxable income rises.</p>";
  } else {
    html += "<p><strong>Manual marginal-rate estimate (sensitivity)</strong></p>";
    html += "<p>Gross capital gain = " + fmtCAD(result.capitalGain) + "</p>";
    if (result.isLoss) {
      html += "<p>Gain ≤ 0 → taxable gain = 0, tax owing = 0.</p>";
    } else if (result.primaryResidenceExemption) {
      html += "<p>Primary residence exemption (educational) → taxable gain = 0, tax owing = 0.</p>";
    } else {
      html +=
        "<p>Taxable gain = " +
        fmtCAD(result.capitalGain) +
        " × (" +
        result.inclusionRatePct +
        " ÷ 100) = " +
        fmtCAD(result.taxableGain) +
        "</p>";
      html +=
        "<p><strong>Tax owing = taxable gain × (marginal rate ÷ 100)</strong> = " +
        fmtCAD(result.taxableGain) +
        " × (" +
        result.marginalTaxRatePct +
        " ÷ 100) = " +
        fmtCAD(result.taxOwing) +
        "</p>";
    }
    html +=
      "<p>This mode applies one combined rate to the entire taxable gain. It does not walk brackets.</p>";
  }

  html += "</div>";
  container.innerHTML = html;
}

function setShareStatus(msg, isError) {
  const el = $("cg_result_share_status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--error)" : "";
}

function buildShareBundle() {
  if (!latestInputs || !latestResult) return null;
  const scenario = scenarioFromInputs(latestInputs);
  const progressive = latestResult.mode === CALC_MODES.PROGRESSIVE;
  const mainValue = progressive
    ? fmtCAD(latestResult.additionalTax)
    : fmtCAD(latestResult.taxOwing);

  return {
    scenario,
    card: {
      title: "Canada Capital Gains Tax Calculator | The Long Math",
      brand: "The Long Math",
      headline: progressive
        ? "Additional tax from capital gain"
        : "Manual capital gains tax estimate",
      mainValue,
      subline: progressive
        ? "Progressive incremental tax (" + latestInputs.year + ", " + (latestInputs.province || "—") + ")"
        : "Taxable gain × entered marginal rate",
      contextLines: progressive
        ? [
            "Taxable income before capital gain: " + fmtCAD(latestInputs.incomeBeforeGain),
            "Gross capital gain: " + fmtCAD(latestResult.capitalGain),
            "Included taxable gain: " + fmtCAD(latestResult.taxableIncluded),
            "Effective rate on gross: " + fmtPct(latestResult.effectiveRateOnGross, 2)
          ]
        : [
            "Gross capital gain: " + fmtCAD(latestResult.capitalGain),
            "Taxable capital gain: " + fmtCAD(latestResult.taxableGain),
            "Inclusion: " + latestInputs.inclusionRate + "%",
            "Marginal rate: " + latestInputs.marginalTaxRate + "%"
          ],
      shareText: progressive
        ? "Additional tax from this capital gain: " + mainValue
        : "Manual capital gains tax estimate: " + mainValue
    }
  };
}

function exportCsv() {
  if (!latestInputs || !latestResult) return;
  const rows = [
    "Canada Capital Gains Tax Calculator (export)",
    "Generated," + new Date().toISOString(),
    ...buildCsvRows(latestInputs, latestResult).slice(1)
  ];
  const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "thelongmath-capital-gains-tax-results.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1500);
}

function wireShareActions() {
  if (shareWired) return;
  shareWired = true;

  const csvBtn = $("cg_export_csv_btn");
  if (csvBtn) {
    csvBtn.addEventListener("click", function () {
      exportCsv();
      setShareStatus("CSV downloaded.", false);
    });
  }

  if (window.TLM && window.TLM.shareCard && typeof window.TLM.shareCard.wireCalculatorShare === "function") {
    window.TLM.shareCard.wireCalculatorShare(CALC_SLUG, buildShareBundle, {
      statusElementId: "cg_result_share_status",
      shareBtnId: "cg_share_result_btn",
      downloadBtnId: "cg_download_result_btn",
      copyBtnId: "cg_copy_result_link_btn"
    });
    return;
  }

  if (!window.TLM || !window.TLM.shareCard) return;

  const shareBtn = $("cg_share_result_btn");
  const pngBtn = $("cg_download_result_btn");
  const copyBtn = $("cg_copy_result_link_btn");

  function buildPayload() {
    const bundle = buildShareBundle();
    if (!bundle) return null;
    const url = window.TLM.shareCard.buildResultUrl(window.location.href, bundle.scenario);
    return {
      calculatorName: CALC_SLUG,
      brand: bundle.card.brand,
      title: bundle.card.title,
      headline: bundle.card.headline,
      mainValue: bundle.card.mainValue,
      subline: bundle.card.subline,
      contextLines: bundle.card.contextLines,
      footer: "Run your own numbers at TheLongMath.com",
      shareText: bundle.card.shareText,
      url
    };
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", async function () {
      const payload = buildPayload();
      if (!payload) return;
      setShareStatus("Preparing image...", false);
      try {
        const res = await window.TLM.shareCard.shareResultCard(payload);
        if (res && res.mode === "download-and-copy-fallback") {
          setShareStatus(
            res.copied
              ? "Calculation image saved and shareable link copied."
              : "Calculation image saved.",
            false
          );
        } else {
          setShareStatus("Share dialog opened.", false);
        }
      } catch (_err) {
        setShareStatus("Share cancelled or unavailable.", true);
      }
    });
  }

  if (pngBtn) {
    pngBtn.addEventListener("click", async function () {
      const payload = buildPayload();
      if (!payload) return;
      setShareStatus("Preparing image...", false);
      try {
        await window.TLM.shareCard.downloadResultCard(payload);
        setShareStatus("Calculation image saved.", false);
      } catch (_err) {
        setShareStatus("Could not prepare image.", true);
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async function () {
      const payload = buildPayload();
      if (!payload) return;
      try {
        await window.TLM.shareCard.copyResultLink({
          url: payload.url,
          calculatorName: CALC_SLUG
        });
        setShareStatus("Shareable link copied.", false);
      } catch (_err) {
        setShareStatus("Could not copy link.", true);
      }
    });
  }
}

function formatNumberInput(el) {
  if (!el) return;
  const raw = el.value.replace(/,/g, "").replace(/\s/g, "");
  if (raw === "" || raw === "-") return;
  const n = Number(raw);
  if (Number.isFinite(n)) {
    el.value = n.toLocaleString("en-CA");
  }
}

function reset() {
  setMode(DEFAULTS.mode);
  if ($("tax_year")) $("tax_year").value = String(DEFAULTS.year);
  if ($("province")) $("province").value = DEFAULTS.province;
  if ($("income_before_gain")) $("income_before_gain").value = String(DEFAULTS.incomeBeforeGain);
  if ($("capital_gain")) $("capital_gain").value = String(DEFAULTS.capitalGain);
  if ($("proceeds")) $("proceeds").value = "";
  if ($("acb")) $("acb").value = "";
  if ($("inclusion_rate")) $("inclusion_rate").value = String(DEFAULTS.inclusionRate);
  if ($("marginal_tax_rate")) $("marginal_tax_rate").value = String(DEFAULTS.marginalTaxRate);
  if ($("primary_residence_exemption")) $("primary_residence_exemption").checked = false;
  update().catch(function () {});
}

async function update() {
  const inputs = readInputs();
  syncModePanels();

  const errEl = $("calc_error");
  if (errEl) {
    errEl.style.display = "none";
    errEl.textContent = "";
  }

  try {
    let result;
    if (inputs.mode === CALC_MODES.MANUAL) {
      result = calculateManualMarginalRateEstimate({
        capitalGain: inputs.capitalGain,
        inclusionRate: inputs.inclusionRate,
        marginalTaxRate: inputs.marginalTaxRate,
        primaryResidenceExemption: inputs.primaryResidenceExemption
      });
    } else {
      if (!inputs.province) {
        throw new Error("Select a province or territory for the progressive calculation.");
      }
      const taxData = await ensureTaxBundle(inputs.year);
      result = calculateProgressiveCapitalGainsTax(
        {
          year: inputs.year,
          province: inputs.province,
          incomeBeforeGain: inputs.incomeBeforeGain,
          capitalGain: inputs.capitalGain,
          primaryResidenceExemption: inputs.primaryResidenceExemption
        },
        { taxData }
      );
    }

    latestInputs = inputs;
    latestResult = result;

    if (result.mode === CALC_MODES.PROGRESSIVE) {
      renderProgressive(result);
    } else {
      renderManual(result);
    }
    renderMessages(result);
    renderShowMath(inputs, result);

    if (typeof window.refreshBracketReference === "function") {
      window.refreshBracketReference();
    }
  } catch (err) {
    latestInputs = inputs;
    latestResult = null;
    if (errEl) {
      errEl.style.display = "block";
      errEl.textContent = err && err.message ? err.message : "Could not calculate.";
    }
  }
}

function wire() {
  applyScenarioFromUrl();
  syncModePanels();

  const ids = [
    "tax_year",
    "province",
    "income_before_gain",
    "capital_gain",
    "proceeds",
    "acb",
    "inclusion_rate",
    "marginal_tax_rate",
    "primary_residence_exemption"
  ];

  ids.forEach(function (id) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", function () {
      if (id === "proceeds" || id === "acb") {
        fillGainFromProceedsAcb();
      }
      update().catch(function () {});
    });
    el.addEventListener("change", function () {
      update().catch(function () {});
    });
  });

  document.querySelectorAll('input[name="calc_mode"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      syncModePanels();
      update().catch(function () {});
    });
  });

  const resetBtn = $("reset_button");
  if (resetBtn) resetBtn.addEventListener("click", reset);

  ["income_before_gain", "capital_gain", "proceeds", "acb"].forEach(function (id) {
    const el = $(id);
    if (el) {
      el.addEventListener("blur", function () {
        if (!updatingFromProceeds) formatNumberInput(el);
      });
    }
  });

  wireShareActions();
  update().catch(function () {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}

// Expose resolve helper for optional inline helpers / tests
export {
  calculateProgressiveCapitalGainsTax,
  calculateManualMarginalRateEstimate,
  CAPITAL_GAINS_INCLUSION_RATE,
  CALC_MODES
};
