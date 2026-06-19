#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LINK = "/articles/investing-and-financial-literacy/rrsp-deduction-timing/";

const LI = {
  en: `<li><a href="${LINK}">RRSP Deduction Timing: Claim Now or Save It for Later?</a></li>`,
  fr: `<li><a href="${LINK}">Calendrier de la déduction REER : réclamer maintenant ou plus tard?</a></li>`,
};

const TARGETS = [
  { file: "what-is-an-rrsp", after: "/articles/investing-and-financial-literacy/rrsp-vs-tfsa-vs-fhsa/" },
  { file: "rrsp-vs-tfsa-vs-fhsa", after: "/calculators/canada-income-tax/" },
  { file: "what-is-a-rrif", after: "/articles/investing-and-financial-literacy/what-is-an-rrsp/" },
];

function insertAfterLi(html, anchor, li) {
  const idx = html.indexOf(anchor);
  if (idx === -1) return { html, ok: false };
  const close = html.indexOf("</a></li>", idx);
  if (close === -1) return { html, ok: false };
  const insertAt = close + "</a></li>".length;
  return {
    html: html.slice(0, insertAt) + li + html.slice(insertAt),
    ok: true,
  };
}

for (const lang of ["en", "fr"]) {
  for (const { file, after } of TARGETS) {
    const fp = path.join(ROOT, "assets/i18n", lang, "articles", `${file}.json`);
    const j = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (j.wrapMainHtml.includes("rrsp-deduction-timing")) {
      console.log("skip (already linked):", lang, file);
      continue;
    }
    const { html, ok } = insertAfterLi(j.wrapMainHtml, after, LI[lang]);
    if (!ok) {
      console.error("MISSING anchor:", lang, file, after);
      process.exitCode = 1;
      continue;
    }
    j.wrapMainHtml = html;
    fs.writeFileSync(fp, JSON.stringify(j, null, 2) + "\n");
    console.log("patched:", lang, file);
  }
}
