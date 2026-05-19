"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FRAG_DIR = path.join(__dirname, "fragments");

const partFiles = [
  "fr-rrsp-meltdown.part1.html",
  "fr-rrsp-meltdown.part2.html",
  "fr-rrsp-meltdown.part3.html",
  "fr-rrsp-meltdown.part4.html",
  "fr-rrsp-meltdown.part5.html",
];

function readPartsUtf8() {
  return partFiles.map((name) => fs.readFileSync(path.join(FRAG_DIR, name), "utf8"));
}

function normalizeArticleHtml(parts) {
  return parts.join("\r\n\r\n").replace(/\r?\n/g, "\r\n");
}

const wrapMainHtml = normalizeArticleHtml(readPartsUtf8());

const enPath = path.join(ROOT, "assets", "i18n", "en", "articles", "rrsp-meltdown.json");
const frPath = path.join(ROOT, "assets", "i18n", "fr", "articles", "rrsp-meltdown.json");

const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
const frBase = JSON.parse(fs.readFileSync(frPath, "utf8"));

const faq = [
  {
    question: "Qu’est-ce qu’un RRSP meltdown?",
    answerHtml:
      "<p>Stratégie délibérée visant à retirer des actifs REER ou FERR avant l’obligation réglementaire — souvent lors d’années où le revenu est moindre, avant convergence du RPC, de la PSV et des minimums obligatoires — pour diminuer les retraits forcés futurs, limiter les effets des tranches d’imposition élevées et gérer la récupération de la PSV. Le nom accentue le spectacle&nbsp;; en substance c’est du lissage marginal.</p>",
  },
  {
    question: "Dois-je retirer de mon REER avant 71 ans?",
    answerHtml:
      "<p>Seulement si votre taux marginal sur ces retraits précoces est nettement plus bas que celui sur les montants forcés futurs auxquels ils se substituent. Le résultat dépend du revenu actuel, du revenu attendu plus tard, de la province ou du territoire, de votre espace au <a href=\"/articles/investing-and-financial-literacy/what-is-a-tfsa/\">CELI</a> et d’un éventuel report conjugal successorale. Réponse nécessitant vos données réelles — pas une règle unique.</p>",
  },
  {
    question: "Comment la récupération de la PSV interagit-elle avec le FERR?",
    answerHtml:
      "<p>La PSV diminue lorsque votre revenu net dépasse le seuil (95&nbsp;323&nbsp;$ pour l’année de revenu 2026, selon canada.ca au moment du texte). Les montants inclus d’un FERR comptent, donc un minimum élevé sur le RPC ou d’autres revenus peut glisser beaucoup de dollars dans une zone effectivement augmentée ~15&nbsp;points de pourcentage. Les retraits de <a href=\"/articles/investing-and-financial-literacy/what-is-a-tfsa/\">CELI</a> sont exclus.</p>",
  },
  {
    question: "Dois-je utiliser mon CELI avant le REER à la retraite?",
    answerHtml:
      "<p>Pas automatiquement. Une utilisation quasi exclusive du CELI lors d’années creuses peut laisser un REER très gros pour plus tard alors que les obligations FERR grimperont. Une planification coordonnée puisera aux deux registres&nbsp;: suffisamment de REER pour occuper sans gaspillage les premières tranches, et le CELI pour amortir lorsque vous devez faire face à des minimums réglementaires volumineux.</p>",
  },
  {
    question: "Que se passe-t-il pour un REER ou un FERR au décès de l’annuitant?",
    answerHtml:
      "<p>La valeur équitable peut entrer tout entière dans le revenu de la dernière déclaration — possiblement très haut marginalement — sauf désignations successorales permises (conjoint désigné titulaire du FERR, transferts directs admissibles, etc.). Consultez vos documents et vos professionnels avant de supposer tout report automatique hors conjoint commun.</p>",
  },
  {
    question: "Peut-on diminuer juridiquement les retraits minimaux du FERR après ouverture?",
    answerHtml:
      "<p>Non&nbsp;: le montant réglementaire minimum doit sortir à chaque année. Vous pouvez élire, avant tout premier paiement, de calculer le minimum avec l’âge d’un conjoint plus jeune, ce qui abaisse le facteur réglementaire année après année. Retirer plus que le prescrit est permis&nbsp;; retirer moins&nbsp;: non, ce n’est pas permis réglementairement.</p>",
  },
  {
    question: "Un gros REER signifie-t-il une erreur?",
    answerHtml:
      "<p>Généralement pas. Ça représente habituellement de longues périodes de cotisation à forte marge alors que le véhicule faisait exactement déduire et capitaliser hors impôt courant. L’étape suivante est de disperser rationnellement l’impôt différé restant sur la vie restante comme sur la désignation successorale.</p>",
  },
];

const out = {
  ...frBase,
  pageStyles: en.pageStyles,
  wrapMainHtml,
  faq,
};

fs.writeFileSync(frPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.error("Updated", frPath, `(${wrapMainHtml.length} chars wrapMainHtml)`);
