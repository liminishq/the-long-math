import { SUPPORTED_TAX_YEARS, computeDeductionTiming, parseMoney } from "./engine.js";

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

  const $ = (id) => document.getElementById(id);
  const IS_FR = (document.documentElement.lang || "").toLowerCase().startsWith("fr");
  const TEXT = IS_FR ? {
    close: "Mathématiquement proche",
    defer: "Le report est en avance",
    claim: "Réclamer maintenant est en avance",
    closeSentence: "L'écart modélisé est faible. La réponse pratique peut dépendre de la certitude du revenu futur, des besoins de trésorerie et de l'utilisation réelle du remboursement.",
    deferSentence: "Avec ces entrées, l'économie d'impôt future dépasse la valeur capitalisée du remboursement reçu aujourd'hui.",
    claimInvestSentence: "Avec ces entrées, investir le remboursement aujourd'hui dépasse l'attente de l'année à revenu plus élevé.",
    claimDebtSentence: "Avec ces entrées, utiliser le remboursement aujourd'hui au taux de remboursement de dette dépasse l'attente de l'année à revenu plus élevé.",
    year: "an",
    years: "ans",
    notAvailable: "Non disponible",
    debtUse: (rate) => `Le remboursement d'aujourd'hui est supposé éviter des intérêts de dette à ${rate} par année.`,
    investUse: (rate) => `Le remboursement d'aujourd'hui est supposé être investi à ${rate} par année.`,
    currentNoDeduction: "Revenu actuel, sans déduction REER",
    currentWithDeduction: "Revenu actuel, déduction réclamée maintenant",
    futureNoDeduction: "Revenu futur, sans déduction REER",
    futureWithDeduction: "Revenu futur, déduction réclamée plus tard",
    formulaUseInvest: "rendement du placement",
    formulaUseDebt: "taux de remboursement de dette",
    formulaCurrent: "Économie d'impôt actuelle",
    formulaFuture: "Économie d'impôt future",
    formulaNow: "Valeur de la réclamation maintenant",
    formulaAdvantage: "Avantage du report",
    formulaBreakEven: "Taux mixte futur de seuil de rentabilité",
    warningDeduction: "Entrez un montant de déduction REER supérieur à zéro.",
    warningProvince: "Sélectionnez une province ou un territoire.",
    warningIncome: "Le revenu d'emploi futur n'est pas supérieur au revenu actuel. Le report est plus difficile à justifier sauf si une autre interaction fiscale s'applique.",
    warningNoTax: "La déduction de l'année actuelle ne produit aucune économie d'impôt dans ce modèle. Cela peut arriver lorsque le revenu est déjà trop faible après les déductions et crédits.",
    warningLargeDeduction: "La déduction est supérieure au revenu net d'au moins une des années modélisées. Une portion supplémentaire de la déduction peut ne produire aucune valeur cette année-là.",
    calcUnavailable: "Calcul indisponible",
    calcUnavailableSentence: "Les données fiscales n'ont pas pu être chargées. Essayez d'actualiser la page ou de tester depuis un serveur local plutôt qu'en ouvrant le fichier directement."
  } : {
    close: "Mathematically close",
    defer: "Saving the deduction is ahead",
    claim: "Claiming now is ahead",
    closeSentence: "The modeled difference is small. The cleaner answer may depend on certainty, cash-flow needs, and whether the refund would actually be used productively.",
    deferSentence: "Under these inputs, the future tax saving is larger than the compounded value of using the refund now.",
    claimInvestSentence: "Under these inputs, investing the refund now beats waiting for the higher-income year.",
    claimDebtSentence: "Under these inputs, using the refund now at the debt payoff rate beats waiting for the higher-income year.",
    year: "year",
    years: "years",
    notAvailable: "Not available",
    debtUse: (rate) => `Today’s refund is assumed to avoid debt interest at ${rate} per year.`,
    investUse: (rate) => `Today’s refund is assumed to be invested at ${rate} per year.`,
    currentNoDeduction: "Current income, no RRSP deduction",
    currentWithDeduction: "Current income, deduction claimed now",
    futureNoDeduction: "Future income, no RRSP deduction",
    futureWithDeduction: "Future income, deduction claimed later",
    formulaUseInvest: "investment return",
    formulaUseDebt: "debt payoff rate",
    formulaCurrent: "Current tax saving",
    formulaFuture: "Future tax saving",
    formulaNow: "Value of claiming now",
    formulaAdvantage: "Deferral advantage",
    formulaBreakEven: "Break-even future blended deduction rate",
    warningDeduction: "Enter an RRSP deduction amount greater than zero.",
    warningProvince: "Select a province or territory.",
    warningIncome: "Future employment income is not higher than current employment income. Deferring is harder to justify unless another tax interaction applies.",
    warningNoTax: "The current-year deduction produces no income tax saving in this model. That can happen when income is already too low after deductions and credits.",
    warningLargeDeduction: "The deduction is larger than at least one modeled year's net income. Extra deduction room may not produce value in that year.",
    calcUnavailable: "Calculation unavailable",
    calcUnavailableSentence: "The tax data could not be loaded. Try refreshing the page or testing from a local server rather than opening the file directly."
  };

  const fields = [
    "tax_year",
    "province",
    "deduction_amount",
    "current_income",
    "future_income",
    "years_to_wait",
    "refund_use",
    "annual_rate"
  ];

  function fmtMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "$–";
    return n.toLocaleString(IS_FR ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0
    });
  }

  function fmtPercent(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "–";
    const out = (n * 100).toFixed(digits).replace(/\.0$/, "");
    return IS_FR ? out.replace(".", ",") + " %" : out + "%";
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function populateControls() {
    const yearSelect = $("tax_year");
    if (yearSelect && yearSelect.options.length === 0) {
      SUPPORTED_TAX_YEARS.slice().reverse().forEach((year) => {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
      });
      yearSelect.value = String(Math.max(...SUPPORTED_TAX_YEARS));
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

  function readInputs() {
    return {
      taxYear: $("tax_year")?.value || "2026",
      province: $("province")?.value || "ON",
      deductionAmount: $("deduction_amount")?.value || "15000",
      currentIncome: $("current_income")?.value || "80000",
      futureIncome: $("future_income")?.value || "140000",
      yearsToWait: $("years_to_wait")?.value || "2",
      refundUse: $("refund_use")?.value || "invest",
      annualRate: $("annual_rate")?.value || "6"
    };
  }

  function renderTaxTable(result) {
    const rows = [
      [TEXT.currentNoDeduction, result.current.before.totals.taxableIncome, result.current.before.totals.totalIncomeTax],
      [TEXT.currentWithDeduction, result.current.after.totals.taxableIncome, result.current.after.totals.totalIncomeTax],
      [TEXT.futureNoDeduction, result.future.before.totals.taxableIncome, result.future.before.totals.totalIncomeTax],
      [TEXT.futureWithDeduction, result.future.after.totals.taxableIncome, result.future.after.totals.totalIncomeTax]
    ];

    const tbody = $("tax_table_body");
    if (!tbody) return;
    tbody.innerHTML = "";
    rows.forEach(([label, taxableIncome, incomeTax]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${label}</td><td>${fmtMoney(taxableIncome)}</td><td>${fmtMoney(incomeTax)}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderWarnings(warnings) {
    const box = $("warning_box");
    const list = $("warning_list");
    if (!box || !list) return;

    list.innerHTML = "";
    if (!warnings.length) {
      box.hidden = true;
      return;
    }

    const warningText = {
      deduction: TEXT.warningDeduction,
      province: TEXT.warningProvince,
      income: TEXT.warningIncome,
      noTax: TEXT.warningNoTax,
      largeDeduction: TEXT.warningLargeDeduction
    };

    warnings.forEach((warning) => {
      const li = document.createElement("li");
      li.textContent = warningText[warning] || warning;
      list.appendChild(li);
    });
    box.hidden = false;
  }

  function renderChart(result) {
    const now = Math.max(0, result.comparison.claimNowFutureValue);
    const later = Math.max(0, result.comparison.deferValue);
    const max = Math.max(now, later, 1);
    const nowBar = $("bar_claim_now");
    const laterBar = $("bar_defer");
    if (nowBar) nowBar.style.width = `${Math.max(2, (now / max) * 100)}%`;
    if (laterBar) laterBar.style.width = `${Math.max(2, (later / max) * 100)}%`;
  }

  function renderFormula(result) {
    const { current, future, comparison, inputs } = result;
    const useLabel = inputs.refundUse === "debt" ? TEXT.formulaUseDebt : TEXT.formulaUseInvest;
    const lines = [
      `${TEXT.formulaCurrent} = ${fmtMoney(current.before.totals.totalIncomeTax)} − ${fmtMoney(current.after.totals.totalIncomeTax)} = ${fmtMoney(current.taxSaved)}`,
      `${TEXT.formulaFuture} = ${fmtMoney(future.before.totals.totalIncomeTax)} − ${fmtMoney(future.after.totals.totalIncomeTax)} = ${fmtMoney(future.taxSaved)}`,
      `${TEXT.formulaNow} = ${fmtMoney(current.taxSaved)} × (1 + ${fmtPercent(inputs.annualRate)})^${inputs.yearsToWait} = ${fmtMoney(comparison.claimNowFutureValue)}`,
      `${TEXT.formulaAdvantage} = ${fmtMoney(comparison.deferValue)} − ${fmtMoney(comparison.claimNowFutureValue)} = ${fmtMoney(comparison.deferAdvantage)}`,
      `${TEXT.formulaBreakEven} = ${fmtMoney(comparison.requiredFutureTaxSaving)} ÷ ${fmtMoney(inputs.deductionAmount)} = ${fmtPercent(comparison.requiredFutureBlendedRate)}`
    ];
    setText("formula_use_label", useLabel);
    setText("formula_output", lines.join("\n"));
  }

  function renderResult(result) {
    const { current, future, comparison, inputs } = result;
    const rec = comparison.recommendation;
    const label = rec.tone === "defer" ? TEXT.defer : rec.tone === "claim" ? TEXT.claim : TEXT.close;
    const sentence = rec.tone === "defer"
      ? TEXT.deferSentence
      : rec.tone === "claim"
        ? (inputs.refundUse === "debt" ? TEXT.claimDebtSentence : TEXT.claimInvestSentence)
        : TEXT.closeSentence;
    const verdict = $("verdict_card");

    if (verdict) {
      verdict.classList.remove("claim", "defer", "neutral");
      verdict.classList.add(rec.tone);
    }

    setText("verdict_label", label);
    setText("verdict_sentence", sentence);
    setText("out_advantage", fmtMoney(comparison.deferAdvantage));
    setText("out_claim_now_tax_saved", fmtMoney(current.taxSaved));
    setText("out_claim_now_future_value", fmtMoney(comparison.claimNowFutureValue));
    setText("out_defer_tax_saved", fmtMoney(future.taxSaved));
    setText("out_current_blended_rate", fmtPercent(current.blendedRate));
    setText("out_future_blended_rate", fmtPercent(future.blendedRate));
    setText("out_raw_tax_difference", fmtMoney(comparison.rawTaxDifference));
    setText("out_required_future_tax_saving", fmtMoney(comparison.requiredFutureTaxSaving));
    setText("out_required_future_rate", fmtPercent(comparison.requiredFutureBlendedRate));
    setText("out_break_even_return", comparison.breakEvenAnnualRate == null ? TEXT.notAvailable : fmtPercent(comparison.breakEvenAnnualRate));
    setText("out_tax_year", String(inputs.taxYear));
    setText("out_deduction", fmtMoney(inputs.deductionAmount));
    setText("out_wait", `${inputs.yearsToWait} ${inputs.yearsToWait === 1 ? TEXT.year : TEXT.years}`);

    const useCopy = inputs.refundUse === "debt"
      ? TEXT.debtUse(fmtPercent(inputs.annualRate))
      : TEXT.investUse(fmtPercent(inputs.annualRate));
    setText("out_refund_use", useCopy);

    renderTaxTable(result);
    renderWarnings(result.warnings);
    renderChart(result);
    renderFormula(result);
  }

  let timer = null;
  function scheduleCalculate() {
    clearTimeout(timer);
    timer = setTimeout(calculate, 150);
  }

  async function calculate() {
    const button = $("calculate_btn");
    if (button) button.disabled = true;

    try {
      const result = await computeDeductionTiming(readInputs());
      renderResult(result);
    } catch (error) {
      console.error(error);
      setText("verdict_label", TEXT.calcUnavailable);
      setText("verdict_sentence", TEXT.calcUnavailableSentence);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setExample(kind) {
    if (kind === "defer") {
      $("current_income").value = "60000";
      $("future_income").value = "170000";
      $("deduction_amount").value = "15000";
      $("years_to_wait").value = "2";
      $("annual_rate").value = "6";
    } else if (kind === "claim") {
      $("current_income").value = "75000";
      $("future_income").value = "105000";
      $("deduction_amount").value = "15000";
      $("years_to_wait").value = "2";
      $("annual_rate").value = "6";
    } else {
      $("current_income").value = "80000";
      $("future_income").value = "140000";
      $("deduction_amount").value = "15000";
      $("years_to_wait").value = "2";
      $("annual_rate").value = "6";
    }
    scheduleCalculate();
  }

  function attachEvents() {
    fields.forEach((id) => {
      const node = $(id);
      if (!node) return;
      node.addEventListener("input", scheduleCalculate);
      node.addEventListener("change", scheduleCalculate);
    });

    const button = $("calculate_btn");
    if (button) button.addEventListener("click", calculate);

    document.querySelectorAll("[data-example]").forEach((button) => {
      button.addEventListener("click", () => setExample(button.getAttribute("data-example")));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    populateControls();
    attachEvents();
    if ($("deduction_amount") && parseMoney($("deduction_amount").value) === 0) {
      $("deduction_amount").value = "15000";
    }
    calculate();
  });
})();
