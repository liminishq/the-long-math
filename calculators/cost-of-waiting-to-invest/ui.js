import { computeCostOfWaiting } from "./engine.js";

(function () {
  "use strict";

  if (window.TLM && window.TLM.calculatorInDevelopment) {
    return;
  }

  const $ = (id) => document.getElementById(id);
  const IS_FR = (document.documentElement.lang || "").toLowerCase().startsWith("fr");
  const LOCALE = IS_FR ? "fr-CA" : "en-CA";

  const TEXT = IS_FR
    ? {
        startedEarlier: "A commencé plus tôt",
        startedLater: "A commencé plus tard",
        portfolioAtRetirement: "Portefeuille à la retraite",
        totalContributed: "Total cotisé",
        investmentGrowth: "Croissance des placements",
        yearsContributing: "Période de cotisation",
        yearsCoasting: "Années de capitalisation après l'arrêt des cotisations",
        years: (n) => (n === 1 ? "1 an" : `${n} ans`),
        months: (n) => (n === 1 ? "1 mois" : `${n} mois`),
        yearsMonths: (y, m) => `${y} et ${m}`,
        comparison: {
          early_ahead_contributed_less: (x, y) =>
            `Commencer plus tôt donne ${x} de plus à la retraite, malgré ${y} de moins en cotisations.`,
          early_ahead_contributed_more: (x, y) =>
            `Commencer plus tôt donne ${x} de plus à la retraite, tout en cotisant ${y} de plus.`,
          early_ahead_same_contributions: (x) =>
            `Commencer plus tôt donne ${x} de plus à la retraite, avec les mêmes cotisations totales.`,
          later_ahead_contributed_more: (x, y) =>
            `La personne qui commence plus tard cotise ${y} de plus et termine ${x} en avance selon ces hypothèses.`,
          later_ahead_contributed_less: (x, y) =>
            `La personne qui commence plus tard cotise ${y} de moins et termine ${x} en avance selon ces hypothèses.`,
          later_ahead_same_contributions: (x) =>
            `La personne qui commence plus tard termine ${x} en avance selon ces hypothèses, avec les mêmes cotisations totales.`,
          approximately_equal:
            "Les deux stratégies aboutissent à peu près à la même valeur selon ces hypothèses."
        },
        catchupAlreadyAhead:
          "Selon ces hypothèses, la personne qui commence plus tard atteint déjà ou dépasse la valeur de retraite de la personne qui commence plus tôt. Les chiffres ci-dessous indiquent le rendement et la cotisation qui égaleraient exactement ce montant.",
        requiredReturnHeadline: (rate) => `${rate} par année`,
        requiredReturnHigher: (pts, assumed) =>
          `${pts} point${pts === "1,00" ? "" : "s"} de pourcentage de plus que ${assumed}`,
        requiredReturnLower: (pts, assumed) =>
          `${pts} point${pts === "1,00" ? "" : "s"} de pourcentage de moins que ${assumed}`,
        requiredReturnSame: (assumed) => `Le même rendement que le rendement assumé de ${assumed}`,
        requiredReturnUnavailable: "Aucun rendement requis n'a pu être calculé dans la plage prise en charge.",
        requiredContributionHeadline: (amount) => `${amount}/mois`,
        requiredContributionSupport: (exact, increase, pct, lifetime) =>
          `${exact} par mois, soit ${increase} (${pct} de plus par mois). Cotisations à vie à ce rythme : ${lifetime}.`,
        requiredContributionLower: (exact, decrease, pct, lifetime) =>
          `${exact} par mois, soit ${decrease} (${pct} de moins par mois). Cotisations à vie à ce rythme : ${lifetime}.`,
        requiredContributionUnavailable: "Aucune cotisation requise n'a pu être calculée.",
        breakEvenHeadline: (rate) => `Rendement d'équilibre : ${rate}`,
        breakEvenEarlyAbove: (rate) =>
          `À des rendements supérieurs à environ ${rate}, la personne qui commence plus tôt termine en avance selon ces hypothèses. À des rendements plus bas, la personne qui commence plus tard termine en avance.`,
        breakEvenLaterAbove: (rate) =>
          `À des rendements supérieurs à environ ${rate}, la personne qui commence plus tard termine en avance selon ces hypothèses. À des rendements plus bas, la personne qui commence plus tôt termine en avance.`,
        breakEvenNone:
          "Aucun rendement d'équilibre n'existe dans la plage prise en charge pour cette configuration.",
        breakEvenNoneEarly:
          "Aucun rendement d'équilibre n'existe dans la plage prise en charge pour cette configuration. La stratégie d'arrêt anticipé des cotisations termine en avance sur toute la plage examinée.",
        breakEvenNoneLater:
          "Aucun rendement d'équilibre n'existe dans la plage prise en charge pour cette configuration. La stratégie de départ plus tardif termine en avance sur toute la plage examinée.",
        breakEvenAlwaysEqual:
          "Les deux stratégies produisent la même valeur à la retraite à tous les rendements selon cette configuration.",
        continuedSupport: (exact, vsEarly, vsLater) =>
          `${exact} à la retraite. ${vsEarly} de plus que le scénario d'arrêt des cotisations, et ${vsLater} de plus que le départ plus tardif.`,
        chartEarly: "Départ plus tôt",
        chartLater: "Départ plus tard",
        chartFallback: (early, later) =>
          `Graphique du portefeuille selon l'âge. À la retraite, le départ plus tôt atteint ${early} et le départ plus tard atteint ${later}.`,
        chartEmpty: "Entrez des âges et des hypothèses valides pour afficher le graphique.",
        share: {
          title: "Calculateur du coût de retarder ses investissements",
          headlineEarly: "Commencer plus tôt vaut",
          headlineLater: "Commencer plus tard avance de",
          headlineEven: "À peu près égal",
          mainEven: "Égal",
          sublineEarly: "de plus à la retraite selon ces hypothèses",
          sublineLater: "à la retraite selon ces hypothèses",
          sublineEven: "selon ces hypothèses",
          investorLine: (label, start, stop, monthly, fv) =>
            `${label} : ${start}–${stop} ans, ${monthly}/mois → ${fv}`,
          assumptions: (age, rate) => `Retraite à ${age} ans · rendement assumé de ${rate}`,
          catchUpContribution: (amount) => `Cotisation de rattrapage : ${amount}/mois`,
          catchUpReturn: (rate) => `Rendement de rattrapage : ${rate}/an`,
          breakEven: (rate) => `Rendement d'équilibre : ${rate}`,
          shareTextEarly: (gap) =>
            `Commencer plus tôt vaut ${gap} de plus à la retraite selon ces hypothèses.`,
          shareTextLater: (gap) =>
            `Commencer plus tard termine ${gap} en avance à la retraite selon ces hypothèses.`,
          shareTextEven: "Les deux stratégies aboutissent à peu près à la même valeur selon ces hypothèses."
        },
        errors: {
          age_not_integer: "Les âges doivent être des années entières.",
          age_out_of_range: "Les âges doivent se situer entre 1 et 120 ans.",
          invalid_age: "Entrez un âge valide.",
          early_start_not_before_stop:
            "L'âge de début de la personne qui commence plus tôt doit précéder l'âge où les cotisations cessent.",
          early_stop_after_retirement:
            "L'âge de fin des cotisations ne peut pas dépasser l'âge de la retraite.",
          later_start_not_before_retirement:
            "L'âge de début de la personne qui commence plus tard doit précéder l'âge de la retraite.",
          later_start_not_before_stop:
            "L'âge de début de la personne qui commence plus tard doit précéder l'âge où les cotisations cessent.",
          later_stop_after_retirement:
            "L'âge de fin des cotisations de la personne qui commence plus tard ne peut pas dépasser l'âge de la retraite.",
          retirement_not_after_early_start:
            "L'âge de la retraite doit dépasser les deux âges de début.",
          retirement_not_after_later_start:
            "L'âge de la retraite doit dépasser les deux âges de début.",
          invalid_contribution: "Entrez une cotisation mensuelle valide.",
          contribution_not_positive: "La cotisation mensuelle doit être supérieure à zéro.",
          contribution_too_large: "La cotisation mensuelle dépasse la plage prise en charge.",
          invalid_return: "Entrez un rendement annuel effectif valide.",
          return_at_or_below_minus_100:
            "Le rendement annuel effectif doit être supérieur à −100 %."
        }
      }
    : {
        startedEarlier: "Started earlier",
        startedLater: "Started later",
        portfolioAtRetirement: "Portfolio at retirement",
        totalContributed: "Total contributed",
        investmentGrowth: "Investment growth",
        yearsContributing: "Time contributing",
        yearsCoasting: "Time compounding after contributions stopped",
        years: (n) => (n === 1 ? "1 year" : `${n} years`),
        months: (n) => (n === 1 ? "1 month" : `${n} months`),
        yearsMonths: (y, m) => `${y} and ${m}`,
        comparison: {
          early_ahead_contributed_less: (x, y) =>
            `Starting earlier results in ${x} more at retirement despite contributing ${y} less.`,
          early_ahead_contributed_more: (x, y) =>
            `Starting earlier results in ${x} more at retirement, while also contributing ${y} more.`,
          early_ahead_same_contributions: (x) =>
            `Starting earlier results in ${x} more at retirement with the same total contributions.`,
          later_ahead_contributed_more: (x, y) =>
            `The later starter contributes ${y} more and finishes ${x} ahead under these assumptions.`,
          later_ahead_contributed_less: (x, y) =>
            `The later starter contributes ${y} less and finishes ${x} ahead under these assumptions.`,
          later_ahead_same_contributions: (x) =>
            `The later starter finishes ${x} ahead under these assumptions with the same total contributions.`,
          approximately_equal:
            "The two strategies finish at approximately the same value under these assumptions."
        },
        catchupAlreadyAhead:
          "Under these assumptions the later starter already reaches or exceeds the early starter's retirement value. The figures below show the return and contribution that would match it exactly.",
        requiredReturnHeadline: (rate) => `${rate} per year`,
        requiredReturnHigher: (pts, assumed) =>
          `${pts} percentage points higher than ${assumed}`,
        requiredReturnLower: (pts, assumed) =>
          `${pts} percentage points lower than ${assumed}`,
        requiredReturnSame: (assumed) => `The same as the assumed return of ${assumed}`,
        requiredReturnUnavailable: "No required return could be calculated in the supported range.",
        requiredContributionHeadline: (amount) => `${amount}/month`,
        requiredContributionSupport: (exact, increase, pct, lifetime) =>
          `${exact} per month, or ${increase} (${pct} more per month). Lifetime contributions at that catch-up amount: ${lifetime}.`,
        requiredContributionLower: (exact, decrease, pct, lifetime) =>
          `${exact} per month, or ${decrease} (${pct} less per month). Lifetime contributions at that amount: ${lifetime}.`,
        requiredContributionUnavailable: "No required contribution could be calculated.",
        breakEvenHeadline: (rate) => `Break-even return: ${rate}`,
        breakEvenEarlyAbove: (rate) =>
          `At returns above about ${rate}, the early starter finishes ahead under these assumptions. At lower returns, the later starter finishes ahead.`,
        breakEvenLaterAbove: (rate) =>
          `At returns above about ${rate}, the later starter finishes ahead under these assumptions. At lower returns, the early starter finishes ahead.`,
        breakEvenNone:
          "No break-even return exists within the supported range for this configuration.",
        breakEvenNoneEarly:
          "No break-even return exists within the supported range for this configuration. The early-stop strategy finishes ahead across the returns examined.",
        breakEvenNoneLater:
          "No break-even return exists within the supported range for this configuration. The later-start strategy finishes ahead across the returns examined.",
        breakEvenAlwaysEqual:
          "The two strategies produce the same retirement value at every return under this configuration.",
        continuedSupport: (exact, vsEarly, vsLater) =>
          `${exact} at retirement. ${vsEarly} more than the early-stop scenario, and ${vsLater} more than the later-start scenario.`,
        chartEarly: "Started earlier",
        chartLater: "Started later",
        chartFallback: (early, later) =>
          `Chart of portfolio value by age. At retirement, the earlier starter reaches ${early} and the later starter reaches ${later}.`,
        chartEmpty: "Enter valid ages and assumptions to see the chart.",
        share: {
          title: "Cost of Waiting to Invest Calculator",
          headlineEarly: "Starting earlier is worth",
          headlineLater: "Starting later finishes ahead by",
          headlineEven: "About even",
          mainEven: "Even",
          sublineEarly: "more at retirement under these assumptions",
          sublineLater: "at retirement under these assumptions",
          sublineEven: "under these assumptions",
          investorLine: (label, start, stop, monthly, fv) =>
            `${label}: ${start}–${stop}, ${monthly}/mo → ${fv}`,
          assumptions: (age, rate) => `Retirement age ${age} · ${rate} assumed return`,
          catchUpContribution: (amount) => `Catch-up contribution: ${amount}/mo`,
          catchUpReturn: (rate) => `Catch-up return: ${rate}/year`,
          breakEven: (rate) => `Break-even return: ${rate}`,
          shareTextEarly: (gap) =>
            `Starting earlier is worth ${gap} more at retirement under these assumptions.`,
          shareTextLater: (gap) =>
            `Starting later finishes ${gap} ahead at retirement under these assumptions.`,
          shareTextEven: "The two strategies finish about even at retirement under these assumptions."
        },
        errors: {
          age_not_integer: "Ages must be whole years.",
          age_out_of_range: "Ages must be between 1 and 120.",
          invalid_age: "Enter a valid age.",
          early_start_not_before_stop:
            "The early investor's start age must be less than the age when contributions stop.",
          early_stop_after_retirement:
            "The early contribution-end age cannot exceed retirement age.",
          later_start_not_before_retirement:
            "The later investor's start age must be less than retirement age.",
          later_start_not_before_stop:
            "The later investor's start age must be less than the age when contributions stop.",
          later_stop_after_retirement:
            "The later contribution-end age cannot exceed retirement age.",
          retirement_not_after_early_start:
            "Retirement age must exceed both starting ages.",
          retirement_not_after_later_start:
            "Retirement age must exceed both starting ages.",
          invalid_contribution: "Enter a valid monthly contribution.",
          contribution_not_positive: "Monthly contribution must be greater than zero.",
          contribution_too_large: "Monthly contribution is larger than the supported range.",
          invalid_return: "Enter a valid effective annual return.",
          return_at_or_below_minus_100:
            "The effective annual return must be greater than −100%."
        }
      };

  function parseRawNumber(raw) {
    if (raw == null) return NaN;
    const cleaned = String(raw).trim().replace(/[$\s]/g, "").replace(/,/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return NaN;
    return Number(cleaned);
  }

  function fmtMoney(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return IS_FR ? "– $" : "$–";
    return n.toLocaleString(LOCALE, {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function fmtPercent(decimalRate, digits = 2) {
    const n = Number(decimalRate);
    if (!Number.isFinite(n)) return "–";
    const pct = (n * 100).toFixed(digits);
    return IS_FR ? pct.replace(".", ",") + " %" : pct + "%";
  }

  function fmtCompactMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fmtMoney(value);
    const abs = Math.abs(n);
    if (abs >= 1e6) {
      const millions = (n / 1e6).toFixed(2);
      return IS_FR
        ? `${millions.replace(".", ",")} million $`
        : `$${millions} million`;
    }
    return fmtMoney(n);
  }

  function fmtDuration(months) {
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y > 0 && m > 0) return TEXT.yearsMonths(TEXT.years(y), TEXT.months(m));
    if (y > 0) return TEXT.years(y);
    return TEXT.months(m);
  }

  function fmtPctPoints(decimalDelta) {
    const n = Math.abs(Number(decimalDelta) * 100).toFixed(2);
    return IS_FR ? n.replace(".", ",") : n;
  }

  function aboutPercent(fraction) {
    const pct = Math.round(Math.abs(fraction) * 100);
    return IS_FR ? `environ ${pct} %` : `about ${pct}%`;
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function laterContributionLocked() {
    const box = $("laterMatchEarlyContribution");
    return !box || box.checked;
  }

  function syncLaterContributionFromEarly() {
    if (!laterContributionLocked()) return;
    const later = $("laterMonthlyContribution");
    const early = $("earlyMonthlyContribution");
    if (later && early) later.value = early.value;
  }

  function applyLaterContributionLock() {
    const later = $("laterMonthlyContribution");
    const locked = laterContributionLocked();
    if (!later) return;
    later.readOnly = locked;
    later.setAttribute("aria-readonly", locked ? "true" : "false");
    later.classList.toggle("is-locked", locked);
    if (locked) syncLaterContributionFromEarly();
  }

  function readInputs() {
    syncLaterContributionFromEarly();
    return {
      earlyStartAge: parseRawNumber($("earlyStartAge").value),
      earlyStopAge: parseRawNumber($("earlyStopAge").value),
      laterStartAge: parseRawNumber($("laterStartAge").value),
      laterStopAge: parseRawNumber($("laterStopAge").value),
      retirementAge: parseRawNumber($("retirementAge").value),
      earlyMonthlyContribution: parseRawNumber($("earlyMonthlyContribution").value),
      laterMonthlyContribution: parseRawNumber($("laterMonthlyContribution").value),
      annualReturn: parseRawNumber($("annualReturn").value) / 100
    };
  }

  let latestResult = null;

  const SCENARIO_FIELDS = [
    ["esa", "earlyStartAge"],
    ["eso", "earlyStopAge"],
    ["lsa", "laterStartAge"],
    ["lso", "laterStopAge"],
    ["ra", "retirementAge"],
    ["emc", "earlyMonthlyContribution"],
    ["lmc", "laterMonthlyContribution"],
    ["ar", "annualReturn"]
  ];

  function fieldValue(id) {
    const node = $(id);
    return node ? String(node.value || "").trim() : "";
  }

  function setFieldValue(id, value) {
    const node = $(id);
    if (!node || value == null || value === "") return;
    node.value = value;
  }

  function scenarioFromInputs() {
    const scenario = {};
    SCENARIO_FIELDS.forEach(([shortKey, id]) => {
      const value = fieldValue(id);
      if (value !== "") scenario[shortKey] = value;
    });
    scenario.lock = laterContributionLocked() ? "1" : "0";
    return scenario;
  }

  function applyScenarioFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const known = SCENARIO_FIELDS.flatMap(([shortKey, id]) => [shortKey, id]).concat([
        "lock",
        "laterMatchEarlyContribution"
      ]);
      if (!known.some((key) => params.has(key))) return;

      SCENARIO_FIELDS.forEach(([shortKey, id]) => {
        const value = params.has(shortKey) ? params.get(shortKey) : params.get(id);
        if (value != null && value !== "") setFieldValue(id, value);
      });

      const lock = $("laterMatchEarlyContribution");
      if (lock) {
        const raw = params.has("lock")
          ? params.get("lock")
          : params.get("laterMatchEarlyContribution");
        if (raw != null) lock.checked = raw === "1" || raw === "true";
      }
      applyLaterContributionLock();
      if (!laterContributionLocked()) {
        const laterAmount = params.has("lmc")
          ? params.get("lmc")
          : params.get("laterMonthlyContribution");
        if (laterAmount != null && laterAmount !== "") {
          setFieldValue("laterMonthlyContribution", laterAmount);
        }
      }

      if (window.TLM && window.TLM.shareCard && window.TLM.shareCard.track) {
        window.TLM.shareCard.track("calculator_shared_scenario_loaded", {
          calculator_name: "cost-of-waiting-to-invest"
        });
      }
    } catch (_err) {
      /* ignore malformed query */
    }
  }

  function fmtShareMainMoney(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e7) return fmtCompactMoney(n);
    const grouped = Math.abs(n).toLocaleString(LOCALE, { maximumFractionDigits: 0 });
    if (IS_FR) return (n < 0 ? "−" : "") + grouped + " $";
    return (n < 0 ? "−" : "") + "$" + grouped;
  }

  function setShareReady(ready) {
    const block = document.querySelector(".result-share-block");
    if (block) block.classList.toggle("is-ready-to-share", Boolean(ready));
  }

  function buildShareCard(result) {
    const gap = Math.abs(result.comparison.retirementDifference);
    const gapText = fmtShareMainMoney(gap);
    let headline = TEXT.share.headlineEven;
    let mainValue = TEXT.share.mainEven;
    let subline = TEXT.share.sublineEven;
    let shareText = TEXT.share.shareTextEven;
    if (result.comparison.earlyAhead) {
      headline = TEXT.share.headlineEarly;
      mainValue = gapText;
      subline = TEXT.share.sublineEarly;
      shareText = TEXT.share.shareTextEarly(gapText);
    } else if (result.comparison.laterAhead) {
      headline = TEXT.share.headlineLater;
      mainValue = gapText;
      subline = TEXT.share.sublineLater;
      shareText = TEXT.share.shareTextLater(gapText);
    }

    const inputs = result.inputs;
    const contextLines = [
      TEXT.share.investorLine(
        TEXT.startedEarlier,
        inputs.earlyStartAge,
        inputs.earlyStopAge,
        fmtMoney(inputs.earlyMonthlyContribution),
        fmtMoney(result.early.valueAtRetirement)
      ),
      TEXT.share.investorLine(
        TEXT.startedLater,
        inputs.laterStartAge,
        inputs.laterStopAge,
        fmtMoney(inputs.laterMonthlyContribution),
        fmtMoney(result.later.valueAtRetirement)
      ),
      TEXT.share.assumptions(inputs.retirementAge, fmtPercent(inputs.annualReturn))
    ];
    if (result.catchUpContribution && result.catchUpContribution.found) {
      contextLines.push(
        TEXT.share.catchUpContribution(fmtMoney(result.catchUpContribution.monthlyContribution))
      );
    }
    if (result.catchUpReturn && result.catchUpReturn.found) {
      contextLines.push(TEXT.share.catchUpReturn(fmtPercent(result.catchUpReturn.annualReturn)));
    }
    if (result.breakEven && result.breakEven.found) {
      contextLines.push(TEXT.share.breakEven(fmtPercent(result.breakEven.annualReturn)));
    }

    return {
      title: TEXT.share.title,
      headline,
      mainValue,
      subline,
      contextLines,
      shareText
    };
  }

  function getShareBundle() {
    if (!latestResult || !latestResult.ok) return null;
    return {
      scenario: scenarioFromInputs(),
      card: buildShareCard(latestResult)
    };
  }

  function wireShareButtons() {
    if (!window.TLM || !window.TLM.shareCard || !window.TLM.shareCard.wireCalculatorShare) return;
    window.TLM.shareCard.wireCalculatorShare("cost-of-waiting-to-invest", getShareBundle);
  }

  function uniqueErrorMessages(errors) {
    const seen = new Set();
    const messages = [];
    for (const error of errors) {
      const message = TEXT.errors[error.code] || error.code;
      if (!seen.has(message)) {
        seen.add(message);
        messages.push(message);
      }
    }
    return messages;
  }

  function comparisonSentence(result) {
    const kind = result.comparison.kind;
    const x = fmtMoney(Math.abs(result.comparison.retirementDifference));
    const y = fmtMoney(Math.abs(result.comparison.contributionDifference));
    const fn = TEXT.comparison[kind];
    if (typeof fn === "function") return fn(x, y);
    return TEXT.comparison.approximately_equal;
  }

  function renderCatchUp(result) {
    const note = $("catchupNote");
    if (result.comparison.laterAhead || result.comparison.kind === "approximately_equal") {
      note.hidden = false;
      note.textContent = TEXT.catchupAlreadyAhead;
    } else {
      note.hidden = true;
      note.textContent = "";
    }

    if (result.catchUpReturn.found) {
      setText("requiredReturn", TEXT.requiredReturnHeadline(fmtPercent(result.catchUpReturn.annualReturn)));
      const delta = result.catchUpReturn.delta;
      if (Math.abs(delta) < 0.00005) {
        setText("requiredReturnSupport", TEXT.requiredReturnSame(fmtPercent(result.inputs.annualReturn)));
      } else if (delta > 0) {
        setText(
          "requiredReturnSupport",
          TEXT.requiredReturnHigher(fmtPctPoints(delta), fmtPercent(result.inputs.annualReturn))
        );
      } else {
        setText(
          "requiredReturnSupport",
          TEXT.requiredReturnLower(fmtPctPoints(delta), fmtPercent(result.inputs.annualReturn))
        );
      }
    } else {
      setText("requiredReturn", TEXT.requiredReturnUnavailable);
      setText("requiredReturnSupport", "");
    }

    if (result.catchUpContribution.found) {
      setText(
        "requiredContribution",
        TEXT.requiredContributionHeadline(fmtMoney(result.catchUpContribution.monthlyContribution))
      );
      const exact = fmtMoney(result.catchUpContribution.monthlyContribution, 2);
      const lifetime = fmtMoney(result.catchUpContribution.lifetimeContributions);
      const pct = aboutPercent(result.catchUpContribution.increasePct);
      if (result.catchUpContribution.increase >= 0) {
        setText(
          "requiredContributionSupport",
          TEXT.requiredContributionSupport(
            exact,
            fmtMoney(result.catchUpContribution.increase),
            pct,
            lifetime
          )
        );
      } else {
        setText(
          "requiredContributionSupport",
          TEXT.requiredContributionLower(
            exact,
            fmtMoney(Math.abs(result.catchUpContribution.increase)),
            pct,
            lifetime
          )
        );
      }
    } else {
      setText("requiredContribution", TEXT.requiredContributionUnavailable);
      setText("requiredContributionSupport", "");
    }
  }

  function renderBreakEven(result) {
    if (result.breakEven.found) {
      const rate = fmtPercent(result.breakEven.annualReturn);
      setText("breakEvenValue", TEXT.breakEvenHeadline(rate));
      setText(
        "breakEvenSupport",
        result.breakEven.earlyAheadAbove ? TEXT.breakEvenEarlyAbove(rate) : TEXT.breakEvenLaterAbove(rate)
      );
      return;
    }
    setText("breakEvenValue", TEXT.breakEvenNone);
    if (result.breakEven.reason === "always_equal") {
      setText("breakEvenSupport", TEXT.breakEvenAlwaysEqual);
    } else if (result.breakEven.direction === "early_always_ahead") {
      setText("breakEvenSupport", TEXT.breakEvenNoneEarly);
    } else if (result.breakEven.direction === "later_always_ahead") {
      setText("breakEvenSupport", TEXT.breakEvenNoneLater);
    } else {
      setText("breakEvenSupport", TEXT.breakEvenNone);
    }
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function drawChart(result) {
    const canvas = $("cowChart");
    const fallback = $("chartFallback");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, rect.width || canvas.clientWidth || 640);
    const height = Math.max(220, rect.height || 280);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!result || !result.ok || !result.projection.length) {
      ctx.fillStyle = cssVar("--muted", "#888");
      ctx.font = "14px sans-serif";
      ctx.fillText(TEXT.chartEmpty, 16, 28);
      if (fallback) fallback.textContent = TEXT.chartEmpty;
      return;
    }

    const points = result.projection;
    const pad = { top: 16, right: 16, bottom: 36, left: 64 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const xMin = points[0].age;
    const xMax = points[points.length - 1].age;
    let yMax = 0;
    for (const point of points) {
      yMax = Math.max(yMax, point.early, point.later);
    }
    yMax = yMax <= 0 ? 1 : yMax * 1.1;

    const mapX = (age) => pad.left + ((age - xMin) / Math.max(1, xMax - xMin)) * plotW;
    const mapY = (value) => pad.top + plotH - (value / yMax) * plotH;

    ctx.strokeStyle = cssVar("--border", "rgba(255,255,255,0.14)");
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = cssVar("--muted", "#aaa");
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const value = yMax * (1 - i / 4);
      ctx.fillText(fmtCompactMoney(value), pad.left - 8, pad.top + (plotH * i) / 4);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ageStep = xMax - xMin > 30 ? 10 : 5;
    for (let age = xMin; age <= xMax; age += 1) {
      if ((age - xMin) % ageStep !== 0 && age !== xMax) continue;
      ctx.fillText(String(age), mapX(age), height - pad.bottom + 8);
    }

    function strokeSeries(key, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.25;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = mapX(point.age);
        const y = mapY(point[key]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    strokeSeries("early", cssVar("--accent", "#d9b46a"));
    strokeSeries("later", "#8fa8c4");

    if (fallback) {
      fallback.textContent = TEXT.chartFallback(
        fmtMoney(result.early.valueAtRetirement),
        fmtMoney(result.later.valueAtRetirement)
      );
    }
  }

  function renderInvestor(prefix, investor, extraRows) {
    setText(`${prefix}Portfolio`, fmtMoney(investor.valueAtRetirement));
    setText(`${prefix}Contributed`, fmtMoney(investor.totalContributed));
    setText(`${prefix}Growth`, fmtMoney(investor.investmentGrowth));
    setText(`${prefix}Contributing`, fmtDuration(investor.contributeMonths));
    extraRows.forEach(([id, value]) => setText(id, value));
  }

  function render(result) {
    const validation = $("validationBox");
    const results = $("resultsStack");
    if (!result.ok) {
      latestResult = null;
      setShareReady(false);
      validation.hidden = false;
      validation.innerHTML =
        "<ul>" + uniqueErrorMessages(result.errors).map((msg) => `<li>${msg}</li>`).join("") + "</ul>";
      results.hidden = true;
      drawChart(null);
      return;
    }

    latestResult = result;
    setShareReady(true);
    validation.hidden = true;
    validation.innerHTML = "";
    results.hidden = false;

    renderInvestor("early", result.early, [["earlyCoast", fmtDuration(result.early.coastMonths)]]);
    renderInvestor("later", result.later, [["laterCoast", fmtDuration(result.later.coastMonths)]]);
    setText("comparisonStatement", comparisonSentence(result));
    renderCatchUp(result);
    renderBreakEven(result);
    setText("continuedPortfolio", fmtCompactMoney(result.continued.valueAtRetirement));
    setText("continuedContributed", fmtMoney(result.continued.totalContributed));
    setText("continuedGrowth", fmtMoney(result.continued.investmentGrowth));
    setText(
      "continuedSupport",
      TEXT.continuedSupport(
        fmtMoney(result.continued.valueAtRetirement),
        fmtMoney(result.continued.versusEarlyStop),
        fmtMoney(result.continued.versusLater)
      )
    );
    drawChart(result);
  }

  function recalculate() {
    render(computeCostOfWaiting(readInputs()));
  }

  function init() {
    const fields = [
      "earlyStartAge",
      "earlyStopAge",
      "laterStartAge",
      "laterStopAge",
      "retirementAge",
      "earlyMonthlyContribution",
      "laterMonthlyContribution",
      "annualReturn"
    ];
    fields.forEach((id) => {
      const node = $(id);
      if (!node) return;
      node.addEventListener("input", recalculate);
      node.addEventListener("change", recalculate);
    });
    const lock = $("laterMatchEarlyContribution");
    if (lock) {
      lock.addEventListener("change", () => {
        applyLaterContributionLock();
        recalculate();
      });
    }
    applyLaterContributionLock();
    applyScenarioFromUrl();
    wireShareButtons();
    window.addEventListener("resize", recalculate);
    recalculate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
