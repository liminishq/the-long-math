"use strict";

const fs = require("fs");
const path = require("path");

function crlf(s) {
  return s.replace(/\r?\n/g, "\r\n");
}

function writeArticle({ enRel, wrapFrRel, outRel, meta, breadcrumbItems, disclaimerHtml, faq }) {
  const root = path.join(__dirname, "..");
  const en = JSON.parse(fs.readFileSync(path.join(root, enRel), "utf8"));
  const wrap = crlf(fs.readFileSync(path.join(root, wrapFrRel), "utf8"));
  en.meta = meta;
  en.breadcrumbItems = breadcrumbItems;
  en.wrapMainHtml = wrap;
  en.disclaimerHtml = disclaimerHtml;
  en.faq = faq;
  fs.writeFileSync(path.join(root, outRel), JSON.stringify(en, null, 2) + "\n", "utf8");
}

const disclaimerHtml =
  "<p>\r\n        <strong>Avis de non-responsabilité :</strong> L'ensemble du contenu de The Long Math — articles, textes, calculateurs, outils ou tout autre matériel — est fourni à des fins éducatives et d'information uniquement et ne constitue pas un conseil financier, fiscal, juridique ou en placement. Les résultats ou projections reposent sur des modèles simplifiés, des hypothèses et des données fournies par l'utilisateur et peuvent ne pas refléter la réalité. Il vous appartient d'évaluer l'exactitude et la pertinence des renseignements et de faire votre propre diligence raisonnable. Avant de prendre des décisions financières, consultez un professionnel qualifié.\r\n      </p>";

const hub = "Investissement et littératie financière";
const home = "Accueil";

// compound-interest — run: node tools/assemble-fr-article-json.cjs compound
const compoundMeta = {
  title: "L'intérêt composé : le levier ultime du patrimoine – The Long Math",
  description:
    "Découvrez ce qu'est l'intérêt composé, comment il fonctionne, la formule de l'intérêt composé et pourquoi la capitalisation s'accélère avec le temps, avec des exemples simples.",
  articleModified: "mars 2026",
  datePublished: "2026-02-20",
  dateModified: "2026-02-20",
  ogTitle: "L'intérêt composé : le levier ultime du patrimoine – The Long Math",
  ogDescription:
    "Découvrez ce qu'est l'intérêt composé, comment il fonctionne, la formule de l'intérêt composé et pourquoi la capitalisation s'accélère avec le temps, avec des exemples simples.",
  twitterTitle: "L'intérêt composé : le levier ultime du patrimoine – The Long Math",
  twitterDescription:
    "Découvrez ce qu'est l'intérêt composé, comment il fonctionne, la formule de l'intérêt composé et pourquoi la capitalisation s'accélère avec le temps, avec des exemples simples.",
  headline: "L'intérêt composé : le levier ultime du patrimoine",
};

const compoundBreadcrumb = [
  { name: home, path: "/" },
  { name: hub, path: "/articles/investing-and-financial-literacy/" },
  {
    name: "L'intérêt composé : le levier ultime du patrimoine",
    path: "/articles/investing-and-financial-literacy/compound-interest/",
  },
];

const compoundFaq = [
  {
    question: "Qu'est-ce que l'intérêt composé?",
    answerHtml:
      "<p>L'intérêt composé est l'intérêt calculé sur le capital initial et sur tous les intérêts déjà accumulés. Au lieu de ne gagner des rendements que sur votre mise de départ, vous les gagnez sur une base qui grossit à chaque période de capitalisation. Avec le temps, la croissance s'accélère plutôt que de progresser à un rythme régulier.</p>",
  },
  {
    question: "Comment fonctionne l'intérêt composé?",
    answerHtml:
      "<p>Les intérêts de chaque période s'ajoutent au capital, de sorte que la période suivante rapporte des intérêts sur une base plus grande. Cette base plus grande produit un gain plus important, qui élargit encore la base. Le phénomène se capitalise — le gain d'une année devient le point de départ de la suivante, et la base ne cesse de croître.</p>",
  },
  {
    question: "Quelle est la différence entre l'intérêt simple et l'intérêt composé?",
    answerHtml:
      "<p>L'intérêt simple est calculé uniquement sur le capital d'origine à chaque période. L'intérêt composé est calculé sur le capital plus tous les intérêts déjà gagnés. Un même taux et une même durée peuvent donner des résultats très différents — à 8 % sur 30 ans, 10 000 $ atteignent 34 000 $ avec l'intérêt simple et environ 100 600 $ avec l'intérêt composé.</p>",
  },
  {
    question: "Quelle est la formule de l'intérêt composé?",
    answerHtml:
      "<p>A = P(1 + r/n)^(nt), où A est le montant final, P le capital, r le taux d'intérêt annuel en décimal, n le nombre de périodes de capitalisation par an et t la durée en années. Cette formule régit l'investissement, l'inflation et la dette — toute situation où la croissance ou l'érosion se capitalise dans le temps.</p>",
  },
  {
    question: "Pourquoi l'intérêt composé est-il si puissant?",
    answerHtml:
      "<p>Parce que la base ne cesse de s'élargir. Les rendements de chaque période sont calculés sur un montant supérieur à celui de la période précédente, donc la croissance s'accélère plutôt que d'avancer en ligne droite. La croissance de fin de période peut dépasser de beaucoup celle du début. Le temps et le taux se combinent de façon multiplicative — de petits gains tenus sur l'un ou l'autre produisent des résultats qui semblent disproportionnés tant qu'on n'a pas saisi les mathématiques.</p>",
  },
  {
    question: "À quelle fréquence les intérêts se capitalisent-ils?",
    answerHtml:
      "<p>Cela dépend du compte ou du produit : annuellement, semestriellement, trimestriellement, mensuellement ou quotidiennement. Une capitalisation plus fréquente donne un rendement légèrement plus élevé pour un même taux nominal. La formule utilise n pour refléter le nombre de périodes par an — un compte à capitalisation quotidienne utilise n = 365.</p>",
  },
  {
    question: "L'intérêt composé peut-il aussi jouer contre moi?",
    answerHtml:
      "<p>Oui — avec la dette et l'inflation, le même mécanisme s'inverse. Les soldes de cartes de crédit et les prêts se capitalisent au détriment de l'emprunteur. L'inflation capitalise l'érosion du pouvoir d'achat dans le temps. La formule est neutre. Qu'elle joue pour vous ou contre vous dépend entièrement du côté où vous vous situez.</p>",
  },
];

const cmd = process.argv[2];
if (cmd === "compound") {
  writeArticle({
    enRel: "assets/i18n/en/articles/compound-interest.json",
    wrapFrRel: "tmp-compound-fr.html",
    outRel: "assets/i18n/fr/articles/compound-interest.json",
    meta: compoundMeta,
    breadcrumbItems: compoundBreadcrumb,
    disclaimerHtml,
    faq: compoundFaq,
  });
  console.log("Wrote compound-interest.json");
  process.exit(0);
}

console.error("Usage: node tools/assemble-fr-article-json.cjs compound");
process.exit(1);
