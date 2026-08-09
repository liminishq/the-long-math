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
    split: "Meilleur calendrier: réclamation partielle",
    closeSentence: "L'écart modélisé est faible. La réponse pratique peut dépendre de la certitude du revenu futur, des besoins de trésorerie et de l'utilisation réelle du remboursement.",
    deferSentence: "Avec ces entrées, l'économie d'impôt future dépasse la valeur capitalisée du remboursement reçu aujourd'hui.",
    claimInvestSentence: "Avec ces entrées, investir le remboursement aujourd'hui dépasse l'attente de l'année à revenu plus élevé.",
    claimDebtSentence: "Avec ces entrées, utiliser le remboursement aujourd'hui au taux de remboursement de dette dépasse l'attente de l'année à revenu plus élevé.",
    splitSentence: "Avec ces entrées, réclamer une partie de la déduction maintenant et reporter le reste produit une valeur plus élevée, à la date future, que de tout réclamer maintenant ou plus tard.",
    year: "an",
    years: "ans",
    notAvailable: "Non disponible",
    debtUse: (rate) => `Le remboursement d'aujourd'hui est supposé éviter des intérêts de dette à ${rate} par année (taux effectivement retenu).`,
    investUse: (rate) => `Le remboursement d'aujourd'hui est supposé être investi à ${rate} par année (rendement retenu après frais et impôts de placement applicables).`,
    currentNoDeduction: "Revenu actuel, sans déduction REER",
    currentWithDeduction: "Revenu actuel, déduction réclamée maintenant",
    futureNoDeduction: "Revenu futur, sans déduction REER",
    futureWithDeduction: "Revenu futur, déduction réclamée plus tard",
    formulaUseInvest: "rendement retenu / intérêt évité",
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
    warningBadRate: "Le taux annuel doit être supérieur à −100 %. Un taux de −100 % ou moins rend la capitalisation indéfinie dans ce modèle.",
    warningFractionalYears: "Les années d'attente doivent être un nombre entier d'années d'imposition. Les valeurs fractionnaires ne sont pas acceptées.",
    warningYearsRange: "Les années d'attente doivent être un entier entre 1 et 40.",
    warningYearsRequired: "Entrez un nombre entier d'années d'attente (1 à 40).",
    warningYearsInvalid: "Les années d'attente doivent être un nombre entier valide.",
    warningSameYear: "Un délai de 0 an n'est pas une décision de calendrier de déduction REER: les deux réclamations appartiendraient à la même année d'imposition.",
    validationTitle: "Entrée non valide",
    validationSentence: "Corrigez les années d'attente pour comparer la réclamation maintenant avec le report de la déduction.",
    calcUnavailable: "Calcul indisponible",
    calcUnavailableSentence: "Les données fiscales n'ont pas pu être chargées. Essayez d'actualiser la page ou de tester depuis un serveur local plutôt qu'en ouvrant le fichier directement.",
    projectionWarning: (year, inflation) =>
      `Calcul fiscal projeté: les tables fiscales officielles ne sont pas encore disponibles pour ${year}. Les seuils indexés ont été projetés avec une inflation annuelle de ${inflation}, en supposant que les taux et règles fiscales actuels restent inchangés. Les règles fiscales futures réelles peuvent différer.`,
    benefitsWarning:
      "Comparaison fiscale seulement: ce résultat n'inclut pas les prestations ou récupérations fondées sur le revenu net, comme l'ACE, les crédits de TPS/TVH, la récupération de la SV, le SRG ou d'autres programmes dont la valeur peut changer lorsque le revenu net change.",
    bestClaimNow: "Réclamer maintenant",
    bestCarryForward: "Reporter",
    advantageVsAllNow: "Avantage estimé par rapport à tout réclamer maintenant",
    scenarioAllNow: "Tout maintenant",
    scenarioAllLater: "Tout plus tard",
    scenarioSplit: "Répartition optimisée",
    officialTable: "Table officielle",
    projectedTable: "Table projetée"
  } : {
    close: "Mathematically close",
    defer: "Saving the deduction is ahead",
    claim: "Claiming now is ahead",
    split: "Best deduction timing: partial claim",
    closeSentence: "The modeled difference is small. The cleaner answer may depend on certainty, cash-flow needs, and whether the refund would actually be used productively.",
    deferSentence: "Under these inputs, the future tax saving is larger than the compounded value of using the refund now.",
    claimInvestSentence: "Under these inputs, investing the refund now beats waiting for the higher-income year.",
    claimDebtSentence: "Under these inputs, using the refund now at the debt payoff rate beats waiting for the higher-income year.",
    splitSentence: "Under these inputs, claiming part of the deduction now and carrying the rest forward produces a higher future-dated value than claiming the full amount all now or all later.",
    year: "year",
    years: "years",
    notAvailable: "Not available",
    debtUse: (rate) => `Today’s refund is assumed to avoid debt interest at ${rate} per year (effective rate retained).`,
    investUse: (rate) => `Today’s refund is assumed to be invested at ${rate} per year (return retained after applicable fees and investment taxes).`,
    currentNoDeduction: "Current income, no RRSP deduction",
    currentWithDeduction: "Current income, deduction claimed now",
    futureNoDeduction: "Future income, no RRSP deduction",
    futureWithDeduction: "Future income, deduction claimed later",
    formulaUseInvest: "retained return / avoided interest",
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
    warningBadRate: "The annual rate must be greater than -100%. A rate of -100% or lower makes compounding undefined in this model.",
    warningFractionalYears: "Years to wait must be a whole number of tax years. Fractional values are not accepted.",
    warningYearsRange: "Years to wait must be an integer between 1 and 40.",
    warningYearsRequired: "Enter a whole number of years to wait (1 to 40).",
    warningYearsInvalid: "Years to wait must be a valid whole number.",
    warningSameYear: "A 0-year delay is not an RRSP deduction-timing decision: both claims would belong to the same tax year.",
    validationTitle: "Invalid input",
    validationSentence: "Correct the years-to-wait field to compare claiming now with saving the deduction.",
    calcUnavailable: "Calculation unavailable",
    calcUnavailableSentence: "The tax data could not be loaded. Try refreshing the page or testing from a local server rather than opening the file directly.",
    projectionWarning: (year, inflation) =>
      `Projected tax calculation: official tax tables are not yet available for ${year}. Indexed tax thresholds have been projected using ${inflation} annual inflation while current tax rates and tax rules are assumed to remain unchanged. Actual future tax rules may differ.`,
    benefitsWarning:
      "Tax-only comparison: This result does not include income-tested benefits or clawbacks such as CCB, GST/HST credits, OAS recovery tax, GIS, or other programs whose value may change when net income changes.",
    bestClaimNow: "Claim now",
    bestCarryForward: "Carry forward",
    advantageVsAllNow: "Estimated advantage versus claiming the full deduction now",
    scenarioAllNow: "All now",
    scenarioAllLater: "All later",
    scenarioSplit: "Optimized split",
    officialTable: "Official table",
    projectedTable: "Projected table"
  };

  const fields = [
    "tax_year",
    "province",
    "deduction_amount",
    "current_income",
    "future_income",
    "years_to_wait",
    "inflation_rate",
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

  function setHidden(id, hidden) {
    const node = $(id);
    if (node) node.hidden = Boolean(hidden);
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
      inflationRate: $("inflation_rate")?.value || "2",
      refundUse: $("refund_use")?.value || "invest",
      annualRate: $("annual_rate")?.value || "6"
    };
  }

  function renderTaxTable(result) {
    const sameYear = result.sameYearComparison || result.inputs?.yearsToWait === 0;
    const secondWithDeduction = sameYear
      ? (IS_FR
          ? "Second profil de revenu, déduction appliquée"
          : "Second income profile, deduction applied")
      : TEXT.futureWithDeduction;
    const secondNoDeduction = sameYear
      ? (IS_FR
          ? "Second profil de revenu, sans déduction REER"
          : "Second income profile, no RRSP deduction")
      : TEXT.futureNoDeduction;
    const rows = [
      [TEXT.currentNoDeduction, result.current.before.totals.taxableIncome, result.current.before.totals.totalIncomeTax],
      [TEXT.currentWithDeduction, result.current.after.totals.taxableIncome, result.current.after.totals.totalIncomeTax],
      [secondNoDeduction, result.future.before.totals.taxableIncome, result.future.before.totals.totalIncomeTax],
      [secondWithDeduction, result.future.after.totals.taxableIncome, result.future.after.totals.totalIncomeTax]
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
      largeDeduction: TEXT.warningLargeDeduction,
      badRate: TEXT.warningBadRate,
      fractionalYears: TEXT.warningFractionalYears,
      yearsRange: TEXT.warningYearsRange,
      yearsRequired: TEXT.warningYearsRequired,
      yearsInvalid: TEXT.warningYearsInvalid,
      sameYear: TEXT.warningSameYear
    };

    warnings.forEach((warning) => {
      const li = document.createElement("li");
      li.textContent = warningText[warning] || warning;
      list.appendChild(li);
    });
    box.hidden = false;
  }

  function renderChart(result) {
    const opt = result.optimization;
    const sameYear = result.sameYearComparison || result.inputs?.yearsToWait === 0;
    const now = Math.max(0, opt?.allNow?.totalFutureValue ?? result.comparison.claimNowFutureValue ?? 0);
    const later = Math.max(0, opt?.allLater?.totalFutureValue ?? result.comparison.deferValue ?? 0);
    const split = Math.max(0, opt?.optimal?.totalFutureValue ?? 0);
    const max = Math.max(now, later, split, 1);
    const nowBar = $("bar_claim_now");
    const laterBar = $("bar_defer");
    const splitBar = $("bar_split");
    const deferLabel = $("label_bar_defer");
    if (deferLabel) {
      deferLabel.textContent = sameYear
        ? (IS_FR ? "Second profil de revenu" : "Second income profile")
        : (IS_FR ? "Réclamer plus tard" : "Claim later");
    }
    if (nowBar) nowBar.style.width = `${Math.max(2, (now / max) * 100)}%`;
    if (laterBar) laterBar.style.width = `${Math.max(2, (later / max) * 100)}%`;
    if (splitBar) {
      splitBar.style.width = `${Math.max(2, (split / max) * 100)}%`;
      const row = $("bar_split_row");
      if (row) row.hidden = opt?.strategyKind !== "split";
    }
  }

  function renderFormula(result) {
    const { current, future, comparison, inputs } = result;
    const useLabel = inputs.refundUse === "debt" ? TEXT.formulaUseDebt : TEXT.formulaUseInvest;
    const claimFv = comparison.claimNowFutureValue;
    const advantage = comparison.deferAdvantage;
    const lines = [
      `${TEXT.formulaCurrent} = ${fmtMoney(current.before.totals.totalIncomeTax)} − ${fmtMoney(current.after.totals.totalIncomeTax)} = ${fmtMoney(current.taxSaved)}`,
      `${TEXT.formulaFuture} = ${fmtMoney(future.before.totals.totalIncomeTax)} − ${fmtMoney(future.after.totals.totalIncomeTax)} = ${fmtMoney(future.taxSaved)}`,
      claimFv == null
        ? `${TEXT.formulaNow} = ${TEXT.notAvailable}`
        : `${TEXT.formulaNow} = ${fmtMoney(current.taxSaved)} × (1 + ${fmtPercent(inputs.annualRate)})^${inputs.yearsToWait} = ${fmtMoney(claimFv)}`,
      advantage == null
        ? `${TEXT.formulaAdvantage} = ${TEXT.notAvailable}`
        : `${TEXT.formulaAdvantage} = ${fmtMoney(comparison.deferValue)} − ${fmtMoney(claimFv)} = ${fmtMoney(advantage)}`,
      `${TEXT.formulaBreakEven} = ${fmtMoney(comparison.requiredFutureTaxSaving)} ÷ ${fmtMoney(inputs.deductionAmount)} = ${fmtPercent(comparison.requiredFutureBlendedRate)}`
    ];
    setText("formula_use_label", useLabel);
    setText("formula_output", lines.join("\n"));
  }

  function renderOptimization(result) {
    const opt = result.optimization;
    if (!opt) return;

    const isSplit = opt.strategyKind === "split";
    const sameYear = result.sameYearComparison || result.inputs?.yearsToWait === 0;
    setHidden("split_result_block", !isSplit || sameYear);

    if (isSplit && !sameYear) {
      setText("out_split_claim_now", fmtMoney(opt.optimal.claimNow));
      setText("out_split_carry_forward", fmtMoney(opt.optimal.carryForward));
      setText("out_split_advantage_vs_now", fmtMoney(opt.advantageVersusAllNow));
    }

    setText("out_scenario_all_now_value", fmtMoney(opt.allNow.totalFutureValue));
    setText("out_scenario_all_later_value", fmtMoney(opt.allLater.totalFutureValue));
    setText("out_scenario_optimal_value", fmtMoney(opt.optimal.totalFutureValue));
    setText("out_scenario_all_now_tax", fmtMoney(opt.allNow.nowSaving));
    setText("out_scenario_all_later_tax", fmtMoney(opt.allLater.laterSaving));
    setText(
      "out_scenario_optimal_detail",
      `${fmtMoney(opt.optimal.claimNow)} / ${fmtMoney(opt.optimal.carryForward)}`
    );

    const nowLabel = $("label_scenario_all_now");
    const laterLabel = $("label_scenario_all_later");
    const splitLabel = $("label_scenario_optimal");
    if (sameYear) {
      if (nowLabel) {
        nowLabel.textContent = IS_FR
          ? "Contre le premier profil de revenu"
          : "Against first income profile";
      }
      if (laterLabel) {
        laterLabel.textContent = IS_FR
          ? "Contre le second profil de revenu"
          : "Against second income profile";
      }
      if (splitLabel) {
        splitLabel.textContent = IS_FR
          ? "Répartition entre les deux profils"
          : "Split across both income profiles";
      }
    } else {
      if (nowLabel) {
        nowLabel.textContent = IS_FR
          ? "Tout maintenant (valeur à la date future)"
          : "All now (future-dated value)";
      }
      if (laterLabel) {
        laterLabel.textContent = IS_FR
          ? "Tout plus tard (valeur à la date future)"
          : "All later (future-dated value)";
      }
      if (splitLabel) {
        splitLabel.textContent = IS_FR
          ? "Répartition optimisée (valeur à la date future)"
          : "Optimized split (future-dated value)";
      }
    }
  }

  function renderProjectionAndBenefits(result) {
    const futureMeta = result.taxTables?.future;
    const projectionBox = $("projection_warning");
    if (projectionBox) {
      if (futureMeta?.projected) {
        projectionBox.hidden = false;
        setText(
          "projection_warning_text",
          TEXT.projectionWarning(futureMeta.year, fmtPercent(futureMeta.inflationRate ?? result.inputs.inflationRate))
        );
      } else {
        projectionBox.hidden = true;
      }
    }

    setText("benefits_warning_text", TEXT.benefitsWarning);
    setHidden("benefits_warning", false);

    setText(
      "out_future_table_source",
      futureMeta?.projected ? TEXT.projectedTable : TEXT.officialTable
    );
    setText("out_future_tax_year", String(result.inputs.futureTaxYear));
  }

  function renderValidationError(result) {
    const verdict = $("verdict_card");
    if (verdict) {
      verdict.classList.remove("claim", "defer", "neutral", "split");
      verdict.classList.add("neutral");
    }
    setText("verdict_label", TEXT.validationTitle);
    setText("verdict_sentence", result.error?.message || TEXT.validationSentence);
    setHidden("split_result_block", true);
    setHidden("projection_warning", true);
    setText("benefits_warning_text", TEXT.benefitsWarning);
    setHidden("benefits_warning", false);
    renderWarnings(result.warnings || []);
    setText("out_advantage", TEXT.notAvailable);
    setText("out_claim_now_tax_saved", TEXT.notAvailable);
    setText("out_claim_now_future_value", TEXT.notAvailable);
    setText("out_defer_tax_saved", TEXT.notAvailable);
    setText("out_current_blended_rate", TEXT.notAvailable);
    setText("out_future_blended_rate", TEXT.notAvailable);
    setText("out_raw_tax_difference", TEXT.notAvailable);
    setText("out_required_future_tax_saving", TEXT.notAvailable);
    setText("out_required_future_rate", TEXT.notAvailable);
    setText("out_break_even_return", TEXT.notAvailable);
    setText("out_scenario_all_now_value", TEXT.notAvailable);
    setText("out_scenario_all_later_value", TEXT.notAvailable);
    setText("out_scenario_optimal_value", TEXT.notAvailable);
    setText("formula_output", "");
    const tbody = $("tax_table_body");
    if (tbody) tbody.innerHTML = "";
  }

  function isUserFacingYearsInvalid(rawYears) {
    if (rawYears == null || String(rawYears).trim() === "") return "yearsRequired";
    const n = typeof rawYears === "number" ? rawYears : Number(String(rawYears).trim());
    if (!Number.isFinite(n)) return "yearsInvalid";
    if (!Number.isInteger(n)) return "fractionalYears";
    if (n < 1 || n > 40) return "yearsRange";
    return null;
  }

  function renderResult(result) {
    if (result.error) {
      renderValidationError(result);
      return;
    }

    const { current, future, comparison, inputs, optimization } = result;
    const rec = comparison.recommendation;
    let label = TEXT.close;
    let sentence = TEXT.closeSentence;
    // Prefer engine copy for same-year edge cases so UI never frames n=0 as "later".
    if (result.sameYearComparison || inputs.yearsToWait === 0) {
      label = rec.label || TEXT.close;
      sentence = rec.sentence || TEXT.closeSentence;
    } else if (rec.tone === "split" || optimization?.strategyKind === "split") {
      label = TEXT.split;
      sentence = TEXT.splitSentence;
    } else if (rec.tone === "defer") {
      label = TEXT.defer;
      sentence = TEXT.deferSentence;
    } else if (rec.tone === "claim") {
      label = TEXT.claim;
      sentence = inputs.refundUse === "debt" ? TEXT.claimDebtSentence : TEXT.claimInvestSentence;
    }

    const verdict = $("verdict_card");
    if (verdict) {
      verdict.classList.remove("claim", "defer", "neutral", "split");
      verdict.classList.add(
        optimization?.strategyKind === "split" ? "split" : rec.tone === "defer" ? "defer" : rec.tone === "claim" ? "claim" : "neutral"
      );
    }

    setText("verdict_label", label);
    setText("verdict_sentence", sentence);
    setText(
      "out_advantage",
      comparison.deferAdvantage == null ? TEXT.notAvailable : fmtMoney(comparison.deferAdvantage)
    );
    setText("out_claim_now_tax_saved", fmtMoney(current.taxSaved));
    setText(
      "out_claim_now_future_value",
      comparison.claimNowFutureValue == null ? TEXT.notAvailable : fmtMoney(comparison.claimNowFutureValue)
    );
    setText("out_defer_tax_saved", fmtMoney(future.taxSaved));
    setText("out_current_blended_rate", fmtPercent(current.blendedRate));
    setText("out_future_blended_rate", fmtPercent(future.blendedRate));
    setText("out_raw_tax_difference", fmtMoney(comparison.rawTaxDifference));
    setText(
      "out_required_future_tax_saving",
      comparison.requiredFutureTaxSaving == null ? TEXT.notAvailable : fmtMoney(comparison.requiredFutureTaxSaving)
    );
    setText("out_required_future_rate", fmtPercent(comparison.requiredFutureBlendedRate));
    setText(
      "out_break_even_return",
      comparison.breakEvenAnnualRate == null ? TEXT.notAvailable : fmtPercent(comparison.breakEvenAnnualRate)
    );
    setText("out_tax_year", String(inputs.taxYear));
    setText("out_deduction", fmtMoney(inputs.deductionAmount));
    setText("out_wait", `${inputs.yearsToWait} ${inputs.yearsToWait === 1 ? TEXT.year : TEXT.years}`);

    const useCopy = inputs.refundUse === "debt"
      ? TEXT.debtUse(fmtPercent(inputs.annualRate))
      : TEXT.investUse(fmtPercent(inputs.annualRate));
    setText("out_refund_use", useCopy);

    renderOptimization(result);
    renderProjectionAndBenefits(result);
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
      const inputs = readInputs();
      const yearsError = isUserFacingYearsInvalid(inputs.yearsToWait);
      if (yearsError) {
        renderValidationError({
          error: {
            code: yearsError,
            field: "yearsToWait",
            raw: inputs.yearsToWait,
            message:
              yearsError === "fractionalYears"
                ? TEXT.warningFractionalYears
                : yearsError === "yearsRequired"
                  ? TEXT.warningYearsRequired
                  : yearsError === "yearsInvalid"
                    ? TEXT.warningYearsInvalid
                    : TEXT.warningYearsRange
          },
          warnings: [yearsError]
        });
        return;
      }
      const result = await computeDeductionTiming(inputs);
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
    } else if (kind === "split") {
      $("current_income").value = "100000";
      $("future_income").value = "100000";
      $("deduction_amount").value = "80000";
      $("years_to_wait").value = "1";
      $("annual_rate").value = "0";
      if ($("inflation_rate")) $("inflation_rate").value = "0";
    } else {
      $("current_income").value = "80000";
      $("future_income").value = "140000";
      $("deduction_amount").value = "15000";
      $("years_to_wait").value = "2";
      $("annual_rate").value = "6";
    }
    if ($("inflation_rate") && !$("inflation_rate").value) $("inflation_rate").value = "2";
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
