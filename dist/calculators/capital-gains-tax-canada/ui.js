// Capital Gains Tax Canada — UI only: DOM, formatting, events. Engine does math.

(function () {
  "use strict";

  const E = window.CapitalGainsTaxCanada;
  if (!E) throw new Error("CapitalGainsTaxCanada engine not loaded");
  let latestInputs = null;
  let latestResult = null;

  function $(id) {
    const el = document.getElementById(id);
    return el || null;
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

  function readInputs() {
    const proceedsEl = $("proceeds");
    const acbEl = $("acb");
    const inclusionRateEl = $("inclusion_rate");
    const marginalTaxRateEl = $("marginal_tax_rate");
    const exemptionEl = $("primary_residence_exemption");

    const proceeds = parseNum(proceedsEl ? proceedsEl.value : "");
    const acb = parseNum(acbEl ? acbEl.value : "");
    const inclusionRate = parseNum(inclusionRateEl ? inclusionRateEl.value : "");
    const marginalTaxRate = parseNum(marginalTaxRateEl ? marginalTaxRateEl.value : "");

    return {
      proceeds: Number.isFinite(proceeds) ? proceeds : 0,
      acb: Number.isFinite(acb) ? acb : 0,
      inclusionRate: Number.isFinite(inclusionRate) ? inclusionRate : 50,
      marginalTaxRate: Number.isFinite(marginalTaxRate) ? marginalTaxRate : 0,
      primaryResidenceExemption: exemptionEl ? exemptionEl.checked : false
    };
  }

  function renderResults(result) {
    const gainEl = $("out_gain");
    const taxableGainEl = $("out_taxable_gain");
    const taxOwingEl = $("out_tax_owing");
    const afterTaxEl = $("out_after_tax");
    const lossMsgEl = $("out_capital_loss_message");
    const exemptionMsgEl = $("out_exemption_message");

    if (result.isLoss) {
      if (gainEl) gainEl.textContent = fmtCAD(result.gain) + " (Capital loss)";
    } else {
      if (gainEl) gainEl.textContent = fmtCAD(result.gain);
    }

    if (taxableGainEl) taxableGainEl.textContent = fmtCAD(result.taxableGain);
    if (taxOwingEl) taxOwingEl.textContent = fmtCAD(result.taxOwing);
    if (afterTaxEl) afterTaxEl.textContent = fmtCAD(result.afterTaxProceeds);

    if (lossMsgEl) {
      if (result.isLoss) {
        lossMsgEl.style.display = "block";
        lossMsgEl.textContent = "Capital loss. Taxable gain = $0, tax owing = $0. You keep the full proceeds.";
      } else {
        lossMsgEl.style.display = "none";
        lossMsgEl.textContent = "";
      }
    }

    if (exemptionMsgEl) {
      if (result.mathSteps.primaryResidenceExemption && !result.isLoss) {
        exemptionMsgEl.style.display = "block";
        exemptionMsgEl.textContent = "Primary residence exemption applied (educational only). Raw gain shown above; taxable gain and tax owing set to $0.";
      } else {
        exemptionMsgEl.style.display = "none";
        exemptionMsgEl.textContent = "";
      }
    }
  }

  function renderShowMath(inputs, result) {
    const container = $("show_math_content");
    if (!container) return;

    const s = result.mathSteps;
    const p = fmtCAD(s.proceeds);
    const a = fmtCAD(s.acb);
    const ir = s.inclusionRate;
    const mtr = s.marginalTaxRate;
    const g = fmtCAD(s.gain);

    let html = "<div class=\"show-math-block\">";
    html += "<p><strong>Gain = Proceeds − ACB</strong></p>";
    html += "<p>Gain = " + p + " − " + a + " = " + g + "</p>";

    if (s.isLoss) {
      html += "<p>Gain ≤ 0 → <strong>Capital loss</strong>. Taxable gain = 0, tax owing = 0.</p>";
    } else if (s.primaryResidenceExemption) {
      html += "<p>Primary residence exemption (educational only) enabled → taxable gain = 0, tax owing = 0.</p>";
    } else {
      html += "<p><strong>Taxable gain = Gain × (inclusion rate ÷ 100)</strong></p>";
      html += "<p>Taxable gain = " + g + " × (" + ir + " ÷ 100) = " + fmtCAD(s.taxableGain) + "</p>";
      html += "<p><strong>Tax owing = Taxable gain × (marginal tax rate ÷ 100)</strong></p>";
      html += "<p>Tax owing = " + fmtCAD(s.taxableGain) + " × (" + mtr + " ÷ 100) = " + fmtCAD(s.taxOwing) + "</p>";
    }

    html += "<p><strong>After-tax proceeds = Proceeds − Tax owing</strong></p>";
    html += "<p>After-tax proceeds = " + p + " − " + fmtCAD(s.taxOwing) + " = " + fmtCAD(s.afterTaxProceeds) + "</p>";
    html += "</div>";

    container.innerHTML = html;
  }

  function update() {
    const inputs = readInputs();
    const result = E.calculate(inputs);
    latestInputs = inputs;
    latestResult = result;
    renderResults(result);
    renderShowMath(inputs, result);
  }

  function setShareStatus(msg, isError) {
    const el = $("cg_result_share_status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--error)" : "";
  }

  function buildSharePayload() {
    if (!latestInputs || !latestResult || !window.TLM || !window.TLM.shareCard) return null;
    return {
      calculatorName: "capital-gains-tax-canada",
      title: "Canada Capital Gains Tax Calculator | The Long Math",
      brand: "The Long Math",
      headline: "Canada Capital Gains Tax Estimate",
      mainValue: fmtCAD(latestResult.taxOwing),
      subline: "Estimated tax owing",
      contextLines: [
        "Capital gain/loss: " + fmtCAD(latestResult.gain),
        "Taxable capital gain: " + fmtCAD(latestResult.taxableGain),
        "After-tax proceeds: " + fmtCAD(latestResult.afterTaxProceeds),
        "Inclusion rate: " + latestInputs.inclusionRate + "%"
      ],
      footer: "Run your own numbers at TheLongMath.com",
      shareText: "Canada capital gains estimate: tax owing " + fmtCAD(latestResult.taxOwing),
      url: window.location.href
    };
  }

  function exportCsv() {
    if (!latestInputs || !latestResult) return;
    const rows = [
      "Canada Capital Gains Tax Calculator (export)",
      "Generated," + new Date().toISOString(),
      "",
      "Input,Value",
      "Proceeds," + latestInputs.proceeds,
      "Adjusted Cost Base (ACB)," + latestInputs.acb,
      "Inclusion rate," + latestInputs.inclusionRate + "%",
      "Marginal tax rate," + latestInputs.marginalTaxRate + "%",
      "Primary residence exemption," + (latestInputs.primaryResidenceExemption ? "Yes" : "No"),
      "",
      "Output,Value",
      "Capital gain/loss," + latestResult.gain,
      "Taxable capital gain," + latestResult.taxableGain,
      "Estimated tax owing," + latestResult.taxOwing,
      "After-tax proceeds," + latestResult.afterTaxProceeds
    ];
    const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "thelongmath-capital-gains-tax-results.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function wireShareActions() {
    const csvBtn = $("cg_export_csv_btn");
    const shareBtn = $("cg_share_result_btn");
    const pngBtn = $("cg_download_result_btn");
    const copyBtn = $("cg_copy_result_link_btn");

    if (csvBtn) {
      csvBtn.addEventListener("click", function () {
        exportCsv();
        setShareStatus("CSV downloaded.", false);
      });
    }

    if (!window.TLM || !window.TLM.shareCard) return;

    if (shareBtn) {
      shareBtn.addEventListener("click", async function () {
        const payload = buildSharePayload();
        if (!payload) return;
        setShareStatus("Preparing image...", false);
        try {
          const res = await window.TLM.shareCard.shareResultCard(payload);
          if (res && res.mode === "download-and-copy-fallback") {
            setShareStatus(res.copied ? "PNG downloaded and link copied." : "PNG downloaded.", false);
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
        const payload = buildSharePayload();
        if (!payload) return;
        setShareStatus("Generating PNG...", false);
        try {
          await window.TLM.shareCard.downloadResultCard(payload);
          setShareStatus("PNG downloaded.", false);
        } catch (_err) {
          setShareStatus("Could not generate PNG.", true);
        }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", async function () {
        try {
          await window.TLM.shareCard.copyResultLink({ url: window.location.href, calculatorName: "capital-gains-tax-canada" });
          setShareStatus("Result link copied.", false);
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
    if (Number.isFinite(n) && n >= 0) {
      el.value = n.toLocaleString("en-CA");
    }
  }

  function reset() {
    const proceedsEl = $("proceeds");
    const acbEl = $("acb");
    const inclusionRateEl = $("inclusion_rate");
    const marginalTaxRateEl = $("marginal_tax_rate");
    const provinceEl = $("province");
    const exemptionEl = $("primary_residence_exemption");

    if (proceedsEl) proceedsEl.value = "150000";
    if (acbEl) acbEl.value = "100000";
    if (inclusionRateEl) inclusionRateEl.value = "50";
    if (marginalTaxRateEl) marginalTaxRateEl.value = "40";
    if (provinceEl) provinceEl.value = "";
    if (exemptionEl) exemptionEl.checked = false;

    update();
  }

  function wire() {
    const ids = ["proceeds", "acb", "inclusion_rate", "marginal_tax_rate", "province", "primary_residence_exemption"];
    ids.forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", update);
      el.addEventListener("change", update);
    });

    const resetBtn = $("reset_button");
    if (resetBtn) resetBtn.addEventListener("click", reset);

    ["proceeds", "acb"].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener("blur", function () { formatNumberInput(el); });
      }
    });

    wireShareActions();
    update();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
