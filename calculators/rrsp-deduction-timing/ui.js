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

  const PROVINCES_FR = [
    ["AB", "Alberta"],
    ["BC", "Colombie-Britannique"],
    ["MB", "Manitoba"],
    ["NB", "Nouveau-Brunswick"],
    ["NL", "Terre-Neuve-et-Labrador"],
    ["NS", "Nouvelle-Écosse"],
    ["NT", "Territoires du Nord-Ouest"],
    ["NU", "Nunavut"],
    ["ON", "Ontario"],
    ["PE", "Île-du-Prince-Édouard"],
    ["QC", "Québec"],
    ["SK", "Saskatchewan"],
    ["YT", "Yukon"]
  ];

  const $ = (id) => document.getElementById(id);
  const IS_FR = (document.documentElement.lang || "").toLowerCase().startsWith("fr");

  const TEXT = IS_FR
    ? {
        incomeThisYear: (y) => `Revenu d'emploi en ${y}`,
        expectedIncomeIn: (y) => `Revenu d'emploi prévu en ${y}`,
        returnLabel: "Rendement annuel prévu (%)",
        debtLabel: "Taux d'intérêt de la dette (%)",
        returnHelp:
          "Utilisez le rendement annuel que vous prévoyez conserver après frais et impôts de placement applicables.",
        debtHelp:
          "Utilisez le taux d'intérêt annuel effectif évité en remboursant la dette.",
        claimTitle: "Réclamez la déduction complète maintenant",
        deferTitle: "Reportez la déduction complète",
        splitTitle: "Répartissez la déduction",
        closeTitle: "Écart modélisé faible",
        estimatedAdvantage: (m) => `Avantage estimé : ${m}`,
        claimNowLine: (y, m) => `Réclamer en ${y} : ${m}`,
        carryForwardLine: (y, m) => `Reporter vers ${y} : ${m}`,
        carryForwardZero: "Reporter : 0 $",
        claimSentence: (deduction, nowYear, nowFv, laterYear, laterValue) =>
          `Réclamer la déduction de ${deduction} en ${nowYear} a une valeur estimée de ${nowFv} en ${laterYear}, contre ${laterValue} si la déduction complète est reportée.`,
        deferSentence: (laterYear) =>
          `Réclamer la déduction en ${laterYear} produit assez d'économie d'impôt supplémentaire pour compenser la valeur de recevoir le remboursement plus tôt.`,
        splitSentence:
          "Une partie de la déduction est utile à votre taux actuel, tandis que le reste vaut davantage s'il est gardé pour l'année à revenu plus élevé.",
        closeSentence:
          "L'écart modélisé est faible. La réponse pratique peut dépendre de la certitude du revenu futur, des besoins de trésorerie et de l'utilisation réelle du remboursement.",
        whySimilarRates: (rate, years) =>
          `Votre déduction économise environ ${rate} chaque année. Comme l'avantage fiscal est semblable, recevoir et utiliser l'économie d'impôt ${years === 1 ? "un an" : `${years} ans`} plus tôt l'emporte.`,
        whyHigherFuture: (nowRate, laterRate) =>
          `Le taux effectif de déduction passe d'environ ${nowRate} à ${laterRate}, ce qui compense le coût d'attendre.`,
        whyClaimDespiteRates: (years) =>
          `Même avec un taux futur plus élevé, la valeur de recevoir l'économie d'impôt ${years === 1 ? "un an" : `${years} ans`} plus tôt l'emporte encore.`,
        strategyClaimNow: "Réclamer maintenant",
        strategyClaimLater: "Réclamer plus tard",
        strategySplit: "Répartir",
        strategyBracketExit: "Sortir de la tranche actuelle",
        bracketExitNote: (now, later, year) =>
          `Illustration : réclamez ${now} en ${year} pour atteindre le seuil de la tranche inférieure suivante, et reportez ${later}.`,
        bracketExitInsufficientNote: (needed, threshold, available) =>
          `Aucune répartition partielle ici : sortir de la tranche actuelle exigerait de réclamer environ ${needed} maintenant (pour atteindre ${threshold}). Avec seulement ${available} disponibles, cela équivaut à tout réclamer maintenant.`,
        resultSuffix: " · Résultat",
        compareLaterHeading: (y) => `Déduction en ${y}`,
        compareValueHeading: (y) => `Valeur en ${y}`,
        whyTaxNow: (y) => `Impôt économisé si réclamé en ${y}`,
        whyTaxLater: (y) => `Impôt économisé si réclamé en ${y}`,
        whyFv: (y) => `Valeur en ${y} de l'économie d'aujourd'hui`,
        whyAdvClaim: "Avantage de réclamer maintenant",
        whyAdvDefer: "Avantage d'attendre",
        whyAdvSplit: "Avantage de la répartition",
        rateNow: (y) => `Taux effectif de déduction, ${y}`,
        rateLater: (y) => `Taux effectif de déduction, ${y}`,
        optimalAllNow: (m) => `Répartition optimale : réclamez les ${m} complets maintenant.`,
        optimalAllLater: (m) => `Répartition optimale : reportez les ${m} complets.`,
        projectionNotice: (year, inflation) =>
          `Les taux de ${year} sont projetés avec une inflation de ${inflation} et la législation fiscale actuelle. Les règles futures réelles peuvent différer.`,
        notAvailable: "Non disponible",
        year: "an",
        years: "ans",
        formulaUseInvest: "rendement retenu / intérêt évité",
        formulaUseDebt: "taux de remboursement de dette",
        formulaCurrent: "Économie d'impôt actuelle",
        formulaFuture: "Économie d'impôt future",
        formulaNow: "Valeur de la réclamation maintenant",
        formulaAdvantage: "Avantage du report (tout plus tard − tout maintenant)",
        formulaBreakEven: "Taux effectif futur de seuil",
        currentNoDeduction: "Revenu actuel, sans déduction REER",
        currentWithDeduction: "Revenu actuel, déduction réclamée maintenant",
        futureNoDeduction: "Revenu futur, sans déduction REER",
        futureWithDeduction: "Revenu futur, déduction réclamée plus tard",
        warningDeduction: "Entrez un montant de déduction REER supérieur à zéro.",
        warningProvince: "Sélectionnez une province ou un territoire.",
        warningIncome:
          "Le revenu futur n'est pas supérieur au revenu actuel. Le report est plus difficile à justifier sauf si une autre interaction fiscale s'applique.",
        warningNoTax:
          "La déduction de l'année actuelle ne produit aucune économie d'impôt dans ce modèle.",
        warningLargeDeduction:
          "La déduction est supérieure au revenu net d'au moins une des années modélisées.",
        warningBadRate:
          "Le taux annuel doit être supérieur à −100 %. Un taux de −100 % ou moins rend la capitalisation indéfinie dans ce modèle.",
        warningFractionalYears:
          "Les années d'attente doivent être un nombre entier d'années d'imposition. Les valeurs fractionnaires ne sont pas acceptées.",
        warningYearsRange: "Les années d'attente doivent être un entier entre 1 et 40.",
        warningYearsRequired: "Entrez un nombre entier d'années d'attente (1 à 40).",
        warningYearsInvalid: "Les années d'attente doivent être un nombre entier valide.",
        warningSameYear:
          "Un délai de 0 an n'est pas une décision de calendrier de déduction REER.",
        validationTitle: "Entrée non valide",
        validationSentence:
          "Corrigez les années d'attente pour comparer la réclamation maintenant avec le report de la déduction.",
        calcUnavailable: "Calcul indisponible",
        calcUnavailableSentence:
          "Les données fiscales n'ont pas pu être chargées. Essayez d'actualiser la page.",
        officialTable: "Table officielle",
        projectedTable: "Table projetée"
      }
    : {
        incomeThisYear: (y) => `Employment income this year (${y})`,
        expectedIncomeIn: (y) => `Expected employment income in ${y}`,
        returnLabel: "Expected annual return (%)",
        debtLabel: "Interest rate on debt (%)",
        returnHelp:
          "Use the annual return you expect to retain after fees and applicable investment taxes.",
        debtHelp: "Use the effective annual interest rate avoided by paying down the debt.",
        claimTitle: "Claim the full deduction now",
        deferTitle: "Carry the full deduction forward",
        splitTitle: "Split the deduction",
        closeTitle: "Mathematically close",
        estimatedAdvantage: (m) => `Estimated advantage: ${m}`,
        claimNowLine: (y, m) => `Claim in ${y}: ${m}`,
        carryForwardLine: (y, m) => `Carry forward to ${y}: ${m}`,
        carryForwardZero: "Carry forward: $0",
        claimSentence: (deduction, nowYear, nowFv, laterYear, laterValue) =>
          `Claiming the ${deduction} deduction in ${nowYear} has an estimated value of ${nowFv} by ${laterYear}, compared with ${laterValue} if the full deduction is deferred.`,
        deferSentence: (laterYear) =>
          `Claiming the deduction in ${laterYear} produces enough additional tax savings to outweigh the value of receiving the refund earlier.`,
        splitSentence:
          "Part of the deduction is valuable at your current tax rate, while the remainder is worth more if saved for the higher-income year.",
        closeSentence:
          "The modeled difference is small. The cleaner answer may depend on certainty, cash-flow needs, and whether the refund would actually be used productively.",
        whySimilarRates: (rate, years) =>
          `Your deduction saves about ${rate} in either year. Because the tax benefit is similar, receiving and using the tax savings ${years === 1 ? "one year" : `${years} years`} earlier comes out ahead.`,
        whyHigherFuture: (nowRate, laterRate) =>
          `The effective deduction rate rises from about ${nowRate} to ${laterRate}, which more than offsets the cost of waiting.`,
        whyClaimDespiteRates: (years) =>
          `Even with a higher future rate, the value of receiving the tax savings ${years === 1 ? "one year" : `${years} years`} earlier still comes out ahead.`,
        strategyClaimNow: "Claim now",
        strategyClaimLater: "Claim later",
        strategySplit: "Split",
        strategyBracketExit: "Exit current bracket",
        bracketExitNote: (now, later, year) =>
          `Illustration: claim ${now} in ${year} to reach the next lower tax-bracket threshold, and carry ${later} forward.`,
        bracketExitInsufficientNote: (needed, threshold, available) =>
          `No partial split row here: exiting the current tax bracket would require claiming about ${needed} now (to reach ${threshold}). With only ${available} available, that path matches claiming all now.`,
        resultSuffix: " · Result",
        compareLaterHeading: (y) => `Deduction in ${y}`,
        compareValueHeading: (y) => `Value in ${y}`,
        whyTaxNow: (y) => `Tax saved if claimed in ${y}`,
        whyTaxLater: (y) => `Tax saved if claimed in ${y}`,
        whyFv: (y) => `Value of today’s tax savings in ${y}`,
        whyAdvClaim: "Advantage of claiming now",
        whyAdvDefer: "Advantage of waiting",
        whyAdvSplit: "Advantage of optimized split",
        rateNow: (y) => `Effective deduction rate, ${y}`,
        rateLater: (y) => `Effective deduction rate, ${y}`,
        optimalAllNow: (m) => `Optimal allocation: claim the full ${m} now.`,
        optimalAllLater: (m) => `Optimal allocation: carry forward the full ${m}.`,
        projectionNotice: (year, inflation) =>
          `${year} tax rates are projected using ${inflation} inflation and current tax law. Actual future tax rules may differ.`,
        notAvailable: "Not available",
        year: "year",
        years: "years",
        formulaUseInvest: "retained return / avoided interest",
        formulaUseDebt: "debt payoff rate",
        formulaCurrent: "Current tax saving",
        formulaFuture: "Future tax saving",
        formulaNow: "Value of claiming now",
        formulaAdvantage: "Deferral advantage (all later − all now)",
        formulaBreakEven: "Break-even future effective deduction rate",
        currentNoDeduction: "Current income, no RRSP deduction",
        currentWithDeduction: "Current income, deduction claimed now",
        futureNoDeduction: "Future income, no RRSP deduction",
        futureWithDeduction: "Future income, deduction claimed later",
        warningDeduction: "Enter an RRSP deduction amount greater than zero.",
        warningProvince: "Select a province or territory.",
        warningIncome:
          "Future employment income is not higher than current employment income. Deferring is harder to justify unless another tax interaction applies.",
        warningNoTax:
          "The current-year deduction produces no income tax saving in this model.",
        warningLargeDeduction:
          "The deduction is larger than at least one modeled year's net income.",
        warningBadRate:
          "The annual rate must be greater than -100%. A rate of -100% or lower makes compounding undefined in this model.",
        warningFractionalYears:
          "Years to wait must be a whole number of tax years. Fractional values are not accepted.",
        warningYearsRange: "Years to wait must be an integer between 1 and 40.",
        warningYearsRequired: "Enter a whole number of years to wait (1 to 40).",
        warningYearsInvalid: "Years to wait must be a valid whole number.",
        warningSameYear:
          "A 0-year delay is not an RRSP deduction-timing decision: both claims would belong to the same tax year.",
        validationTitle: "Invalid input",
        validationSentence:
          "Correct the years-to-wait field to compare claiming now with saving the deduction.",
        calcUnavailable: "Calculation unavailable",
        calcUnavailableSentence:
          "The tax data could not be loaded. Try refreshing the page.",
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

  function fmtSignedMoneyClean(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return TEXT.notAvailable;
    const abs = fmtMoney(Math.abs(n));
    if (Math.abs(n) < 0.5) return abs;
    return (n > 0 ? "+" : "−") + abs;
  }

  function fmtPercent(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "–";
    const rounded = Number((n * 100).toFixed(digits));
    const out = String(rounded).replace(/\.0$/, "");
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

  function clearStaleOutputs() {
    [
      "out_claim_now_tax_saved",
      "out_defer_tax_saved",
      "out_claim_now_future_value",
      "out_advantage",
      "out_current_blended_rate",
      "out_future_blended_rate",
      "out_break_even_return",
      "out_future_table_source",
      "out_future_tax_year",
      "formula_output"
    ].forEach((id) => {
      if (id === "formula_output") setText(id, "");
      else setText(id, TEXT.notAvailable);
    });
    const tbody = $("compare_table_body");
    if (tbody) tbody.innerHTML = "";
    const taxBody = $("tax_table_body");
    if (taxBody) taxBody.innerHTML = "";
    setHidden("verdict_advantage", true);
    setHidden("verdict_allocation", true);
    setHidden("verdict_why", true);
    setHidden("optimal_note", true);
    setHidden("projection_warning", true);
    setHidden("quebec_notice", true);
  }

  function populateControls() {
    const yearSelect = $("tax_year");
    if (yearSelect && yearSelect.options.length === 0) {
      SUPPORTED_TAX_YEARS.slice()
        .reverse()
        .forEach((year) => {
          const option = document.createElement("option");
          option.value = String(year);
          option.textContent = String(year);
          yearSelect.appendChild(option);
        });
      yearSelect.value = String(Math.max(...SUPPORTED_TAX_YEARS));
    }

    const provinceSelect = $("province");
    if (provinceSelect && provinceSelect.options.length === 0) {
      (IS_FR ? PROVINCES_FR : PROVINCES).forEach(([code, name]) => {
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
      deductionAmount: $("deduction_amount")?.value || "8500",
      currentIncome: $("current_income")?.value || "84000",
      futureIncome: $("future_income")?.value || "96000",
      yearsToWait: $("years_to_wait")?.value || "1",
      inflationRate: $("inflation_rate")?.value || "2.3",
      refundUse: $("refund_use")?.value || "invest",
      annualRate: $("annual_rate")?.value || "7.5"
    };
  }

  function updateDynamicLabels() {
    const taxYear = Number($("tax_year")?.value) || 2026;
    const yearsRaw = $("years_to_wait")?.value;
    const years = Number(yearsRaw);
    const futureYear =
      Number.isInteger(years) && years >= 1 ? taxYear + years : taxYear + 1;

    const currentLabel = $("label_current_income");
    const futureLabel = $("label_future_income");
    if (currentLabel) currentLabel.textContent = TEXT.incomeThisYear(taxYear);
    if (futureLabel) futureLabel.textContent = TEXT.expectedIncomeIn(futureYear);

    const refundUse = $("refund_use")?.value || "invest";
    const rateLabel = $("label_annual_rate");
    const rateHelp = $("help_annual_rate");
    if (rateLabel) {
      rateLabel.textContent = refundUse === "debt" ? TEXT.debtLabel : TEXT.returnLabel;
    }
    if (rateHelp) {
      rateHelp.textContent = refundUse === "debt" ? TEXT.debtHelp : TEXT.returnHelp;
    }

    setText("compare_later_heading", TEXT.compareLaterHeading(futureYear));
    setText("compare_value_heading", TEXT.compareValueHeading(futureYear));
  }

  function buildWhyCopy(result, kind) {
    const { current, future, inputs } = result;
    const nowRate = current.blendedRate;
    const laterRate = future.blendedRate;
    const years = inputs.yearsToWait;
    const similar = Math.abs(nowRate - laterRate) < 0.005;

    if (kind === "split") return TEXT.splitSentence;
    if (kind === "close") return TEXT.closeSentence;
    if (kind === "defer") {
      return similar
        ? TEXT.deferSentence(inputs.futureTaxYear)
        : TEXT.whyHigherFuture(fmtPercent(nowRate), fmtPercent(laterRate));
    }
    if (similar) return TEXT.whySimilarRates(fmtPercent(nowRate), years);
    if (laterRate > nowRate + 0.005) return TEXT.whyClaimDespiteRates(years);
    return TEXT.whySimilarRates(fmtPercent(nowRate), years);
  }

  function renderTaxTable(result) {
    const rows = [
      [
        TEXT.currentNoDeduction,
        result.current.before.totals.taxableIncome,
        result.current.before.totals.totalIncomeTax
      ],
      [
        TEXT.currentWithDeduction,
        result.current.after.totals.taxableIncome,
        result.current.after.totals.totalIncomeTax
      ],
      [
        TEXT.futureNoDeduction,
        result.future.before.totals.taxableIncome,
        result.future.before.totals.totalIncomeTax
      ],
      [
        TEXT.futureWithDeduction,
        result.future.after.totals.taxableIncome,
        result.future.after.totals.totalIncomeTax
      ]
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

  function renderComparison(result, kind) {
    const opt = result.optimization;
    const inputs = result.inputs;
    const tbody = $("compare_table_body");
    if (!tbody || !opt) return;

    const laterYear = inputs.futureTaxYear;
    const rows = [
      {
        key: "all_now",
        label: TEXT.strategyClaimNow,
        now: opt.allNow.claimNow,
        later: opt.allNow.carryForward,
        value: opt.allNow.totalFutureValue,
        isResult: kind === "all_now" || kind === "claim"
      },
      {
        key: "all_later",
        label: TEXT.strategyClaimLater,
        now: opt.allLater.claimNow,
        later: opt.allLater.carryForward,
        value: opt.allLater.totalFutureValue,
        isResult: kind === "all_later" || kind === "defer"
      }
    ];

    if (kind === "split") {
      rows.push({
        key: "split",
        label: TEXT.strategySplit,
        now: opt.optimal.claimNow,
        later: opt.optimal.carryForward,
        value: opt.optimal.totalFutureValue,
        isResult: true
      });
    } else if (opt.bracketExitSplit) {
      // When the result is a corner, show an illustrative bracket-exit split:
      // claim just enough to leave the current top federal/provincial bracket.
      rows.push({
        key: "bracket_exit",
        label: TEXT.strategyBracketExit,
        now: opt.bracketExitSplit.claimNow,
        later: opt.bracketExitSplit.carryForward,
        value: opt.bracketExitSplit.totalFutureValue,
        isResult: false
      });
    }

    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.isResult) tr.classList.add("is-result");
      const label = row.isResult ? `${row.label}${TEXT.resultSuffix}` : row.label;
      tr.innerHTML = `
        <td>${label}</td>
        <td>${fmtMoney(row.now)}</td>
        <td>${fmtMoney(row.later)}</td>
        <td>${fmtMoney(row.value)}</td>
      `;
      tbody.appendChild(tr);
    });

    setText("compare_later_heading", TEXT.compareLaterHeading(laterYear));
    setText("compare_value_heading", TEXT.compareValueHeading(laterYear));

    const note = $("optimal_note");
    if (!note) return;
    const info = opt.bracketExitInfo;
    const insufficientForExit =
      info &&
      info.targetThreshold != null &&
      Number(info.neededClaim) > Number(info.availableDeduction) + 1;
    if (kind === "all_now" || kind === "claim") {
      note.hidden = false;
      if (opt.bracketExitSplit) {
        note.textContent =
          TEXT.optimalAllNow(fmtMoney(inputs.deductionAmount)) +
          " " +
          TEXT.bracketExitNote(
            fmtMoney(opt.bracketExitSplit.claimNow),
            fmtMoney(opt.bracketExitSplit.carryForward),
            inputs.taxYear
          );
      } else if (insufficientForExit) {
        note.textContent =
          TEXT.optimalAllNow(fmtMoney(inputs.deductionAmount)) +
          " " +
          TEXT.bracketExitInsufficientNote(
            fmtMoney(info.neededClaim),
            fmtMoney(info.targetThreshold),
            fmtMoney(info.availableDeduction)
          );
      } else {
        note.textContent = TEXT.optimalAllNow(fmtMoney(inputs.deductionAmount));
      }
    } else if (kind === "all_later" || kind === "defer") {
      note.hidden = false;
      if (opt.bracketExitSplit) {
        note.textContent =
          TEXT.optimalAllLater(fmtMoney(inputs.deductionAmount)) +
          " " +
          TEXT.bracketExitNote(
            fmtMoney(opt.bracketExitSplit.claimNow),
            fmtMoney(opt.bracketExitSplit.carryForward),
            inputs.taxYear
          );
      } else if (insufficientForExit) {
        note.textContent =
          TEXT.optimalAllLater(fmtMoney(inputs.deductionAmount)) +
          " " +
          TEXT.bracketExitInsufficientNote(
            fmtMoney(info.neededClaim),
            fmtMoney(info.targetThreshold),
            fmtMoney(info.availableDeduction)
          );
      } else {
        note.textContent = TEXT.optimalAllLater(fmtMoney(inputs.deductionAmount));
      }
    } else {
      note.hidden = true;
      note.textContent = "";
    }
  }

  function renderHero(result, kind) {
    const { current, future, comparison, inputs, optimization } = result;
    const verdict = $("verdict_card");
    if (verdict) {
      verdict.classList.remove("claim", "defer", "neutral", "split");
      verdict.classList.add(
        kind === "split" ? "split" : kind === "defer" || kind === "all_later" ? "defer" : kind === "close" ? "neutral" : "claim"
      );
    }

    const nowYear = inputs.taxYear;
    const laterYear = inputs.futureTaxYear;
    const deduction = fmtMoney(inputs.deductionAmount);
    const claimFv = comparison.claimNowFutureValue;
    const laterValue = optimization?.allLater?.totalFutureValue ?? comparison.deferValue;
    const allNowValue = optimization?.allNow?.totalFutureValue ?? claimFv;

    let title = TEXT.closeTitle;
    let advantageAbs = 0;
    let advantageLabel = TEXT.estimatedAdvantage(TEXT.notAvailable);

    if (kind === "split") {
      title = TEXT.splitTitle;
      advantageAbs = Math.max(
        0,
        Number(optimization?.advantageVersusAllNow) || 0,
        Number(optimization?.advantageVersusAllLater) || 0
      );
      // Prefer vs next-best corner
      const vsNow = Number(optimization?.advantageVersusAllNow) || 0;
      const vsLater = Number(optimization?.advantageVersusAllLater) || 0;
      advantageAbs = Math.max(vsNow, vsLater, 0);
      advantageLabel = TEXT.estimatedAdvantage(fmtMoney(advantageAbs));
    } else if (kind === "defer" || kind === "all_later") {
      title = TEXT.deferTitle;
      advantageAbs = Math.max(0, Number(laterValue) - Number(allNowValue) || 0);
      if (!Number.isFinite(advantageAbs)) advantageAbs = Math.max(0, Number(comparison.deferAdvantage) || 0);
      advantageLabel = TEXT.estimatedAdvantage(fmtMoney(advantageAbs));
    } else if (kind === "claim" || kind === "all_now") {
      title = TEXT.claimTitle;
      advantageAbs = Math.max(0, Number(allNowValue) - Number(laterValue) || 0);
      if (!Number.isFinite(advantageAbs) && comparison.deferAdvantage != null) {
        advantageAbs = Math.max(0, -Number(comparison.deferAdvantage));
      }
      advantageLabel = TEXT.estimatedAdvantage(fmtMoney(advantageAbs));
    }

    setText("verdict_label", title);

    const advNode = $("verdict_advantage");
    if (advNode) {
      if (kind === "close" || !Number.isFinite(advantageAbs)) {
        advNode.hidden = true;
      } else {
        advNode.hidden = false;
        advNode.textContent = advantageLabel;
      }
    }

    let sentence = TEXT.closeSentence;
    if (kind === "split") {
      // Keep the brief explanation under the allocation (verdict_why), not twice.
      sentence = "";
    } else if (kind === "defer" || kind === "all_later") {
      sentence = TEXT.deferSentence(laterYear);
    } else if (kind === "claim" || kind === "all_now") {
      sentence = TEXT.claimSentence(
        deduction,
        nowYear,
        claimFv == null ? TEXT.notAvailable : fmtMoney(claimFv),
        laterYear,
        fmtMoney(laterValue)
      );
    }
    const sentenceNode = $("verdict_sentence");
    if (sentenceNode) {
      sentenceNode.hidden = !sentence;
      sentenceNode.textContent = sentence;
    }

    const alloc = $("verdict_allocation");
    if (alloc) {
      alloc.hidden = false;
      const claimAmt =
        kind === "split"
          ? optimization.optimal.claimNow
          : kind === "defer" || kind === "all_later"
            ? 0
            : inputs.deductionAmount;
      const carryAmt =
        kind === "split"
          ? optimization.optimal.carryForward
          : kind === "defer" || kind === "all_later"
            ? inputs.deductionAmount
            : 0;
      const claimLabel = IS_FR ? `Réclamer en ${nowYear}` : `Claim in ${nowYear}`;
      const carryLabel =
        carryAmt === 0
          ? IS_FR
            ? "Reporter"
            : "Carry forward"
          : IS_FR
            ? `Reporter vers ${laterYear}`
            : `Carry forward to ${laterYear}`;
      alloc.innerHTML = `
        <li><span>${claimLabel}</span><span>${fmtMoney(claimAmt)}</span></li>
        <li><span>${carryLabel}</span><span>${fmtMoney(carryAmt)}</span></li>
      `;
    }

    const why = $("verdict_why");
    if (why) {
      why.hidden = false;
      why.textContent = buildWhyCopy(
        result,
        kind === "all_now" ? "claim" : kind === "all_later" ? "defer" : kind
      );
    }
  }

  function renderWhyNumbers(result, kind) {
    const { current, future, comparison, inputs, optimization } = result;
    const nowYear = inputs.taxYear;
    const laterYear = inputs.futureTaxYear;

    setText("why_tax_now_label", TEXT.whyTaxNow(nowYear));
    setText("why_tax_later_label", TEXT.whyTaxLater(laterYear));
    setText("why_fv_label", TEXT.whyFv(laterYear));
    setText("rate_now_label", TEXT.rateNow(nowYear));
    setText("rate_later_label", TEXT.rateLater(laterYear));

    setText("out_claim_now_tax_saved", fmtMoney(current.taxSaved));
    setText("out_defer_tax_saved", fmtMoney(future.taxSaved));
    setText(
      "out_claim_now_future_value",
      comparison.claimNowFutureValue == null
        ? TEXT.notAvailable
        : fmtMoney(comparison.claimNowFutureValue)
    );
    setText("out_current_blended_rate", fmtPercent(current.blendedRate));
    setText("out_future_blended_rate", fmtPercent(future.blendedRate));
    setText(
      "out_break_even_return",
      comparison.breakEvenAnnualRate == null
        ? TEXT.notAvailable
        : fmtPercent(comparison.breakEvenAnnualRate)
    );

    const allNow = optimization?.allNow?.totalFutureValue ?? comparison.claimNowFutureValue;
    const allLater = optimization?.allLater?.totalFutureValue ?? comparison.deferValue;
    let adv = 0;
    let advLabel = TEXT.whyAdvClaim;
    if (kind === "split") {
      adv = Math.max(
        Number(optimization?.advantageVersusAllNow) || 0,
        Number(optimization?.advantageVersusAllLater) || 0,
        0
      );
      advLabel = TEXT.whyAdvSplit;
    } else if (kind === "defer" || kind === "all_later") {
      adv = Math.max(0, Number(allLater) - Number(allNow) || 0);
      advLabel = TEXT.whyAdvDefer;
    } else {
      adv = Math.max(0, Number(allNow) - Number(allLater) || 0);
      advLabel = TEXT.whyAdvClaim;
    }
    setText("why_advantage_label", advLabel);
    setText("out_advantage", fmtSignedMoneyClean(adv));
  }

  function renderNotices(result) {
    const futureMeta = result.taxTables?.future;
    const projection = $("projection_warning");
    if (projection) {
      if (futureMeta?.projected) {
        projection.hidden = false;
        projection.textContent = TEXT.projectionNotice(
          futureMeta.year,
          fmtPercent(futureMeta.inflationRate ?? result.inputs.inflationRate)
        );
      } else {
        projection.hidden = true;
        projection.textContent = "";
      }
    }

    const isQc = String(result.inputs.province || "").toUpperCase() === "QC";
    setHidden("quebec_notice", !isQc);

    setText(
      "out_future_table_source",
      futureMeta?.projected ? TEXT.projectedTable : TEXT.officialTable
    );
    setText("out_future_tax_year", String(result.inputs.futureTaxYear));
  }

  function resolveKind(result) {
    const opt = result.optimization;
    const rec = result.comparison?.recommendation;
    if (result.sameYearComparison || result.inputs?.yearsToWait === 0) {
      if (opt?.strategyKind === "split") return "split";
      if (rec?.tone === "defer") return "defer";
      if (rec?.tone === "claim") return "claim";
      return "close";
    }
    if (opt?.strategyKind === "split") return "split";
    if (opt?.strategyKind === "all_later") return "all_later";
    if (opt?.strategyKind === "all_now") return "all_now";
    if (rec?.tone === "defer") return "defer";
    if (rec?.tone === "claim") return "claim";
    if (rec?.tone === "neutral") return "close";
    return "all_now";
  }

  function renderValidationError(result) {
    const verdict = $("verdict_card");
    if (verdict) {
      verdict.classList.remove("claim", "defer", "neutral", "split");
      verdict.classList.add("neutral");
    }
    setText("verdict_label", TEXT.validationTitle);
    setText("verdict_sentence", result.error?.message || TEXT.validationSentence);
    clearStaleOutputs();
    renderWarnings(result.warnings || []);
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

    updateDynamicLabels();
    const kind = resolveKind(result);
    renderHero(result, kind);
    renderComparison(result, kind);
    renderWhyNumbers(result, kind);
    renderNotices(result);
    renderTaxTable(result);
    renderWarnings(result.warnings);
    renderFormula(result);
  }

  let timer = null;
  function scheduleCalculate() {
    updateDynamicLabels();
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
      clearStaleOutputs();
    } finally {
      if (button) button.disabled = false;
    }
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
  }

  document.addEventListener("DOMContentLoaded", () => {
    populateControls();
    attachEvents();
    updateDynamicLabels();
    if ($("deduction_amount") && parseMoney($("deduction_amount").value) === 0) {
      $("deduction_amount").value = "8500";
    }
    calculate();
  });
})();
