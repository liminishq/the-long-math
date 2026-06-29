#!/usr/bin/env node
"use strict";

/**
 * Convert what-is-a-rrif-final.md / what-is-a-rrif-fr.md → article JSON (en + fr).
 * Run from repo root: node tools/build-what-is-a-rrif-json.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const PAGE_STYLES = `<style>
    .article-content { max-width: 980px; margin: 0 auto; line-height: 1.7; }
    .article-content h2 { margin: 0 0 0.75em; }
    .article-content h3 { margin: 1.25em 0 0.5em; }
    .article-content ul, .article-content ol { margin: 1em 0; padding-left: 2em; }
    .article-content li { margin: 0.5em 0; }
    .article-content p { margin: 0.9em 0; }
    .article-content table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
    .article-content th, .article-content td { border: 1px solid var(--border); padding: 10px 12px; text-align: left; }
    .article-content th { background: var(--card-bg, rgba(0, 0, 0, 0.03)); font-weight: 600; }
    .section-card {
      border: 1px solid var(--border); border-radius: 18px; padding: 18px; margin: 18px 0;
      background: var(--card-bg, var(--surface, #fff)); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.04);
    }
    .section-card.intro-card { margin-top: 14px; }
    .related-articles h2, .related-articles h3 { font-size: 18px; margin: 0 0 10px; }
    .related-articles ul { list-style: none; padding-left: 0; margin: 0; }
    .related-articles li { margin: 12px 0; }
    .related-articles a { color: var(--accent); text-decoration: none; }
    .related-articles a:hover { text-decoration: underline; }
    .highlight-table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
    .highlight-table th, .highlight-table td { border: 1px solid var(--border); padding: 10px 12px; text-align: left; }
    .highlight-table th { background: var(--card-bg, rgba(0, 0, 0, 0.03)); font-weight: 600; }
    .article-math-block { margin: 0.9em 0; padding: 14px 16px; border-left: 3px solid var(--accent); background: rgba(0, 0, 0, 0.02); border-radius: 8px; }
    .article-math-block p { margin: 0.35em 0; }
  </style>`;

function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function inlineMd(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function parseTable(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    rows.push(lines[i].trim());
    i++;
  }
  const bodyRows = rows.filter((r) => !/^\|[\s\-:|]+\|$/.test(r));
  const cells = bodyRows.map((r) =>
    r
      .split("|")
      .slice(1, -1)
      .map((c) => inlineMd(c.trim()))
  );
  const thead =
    cells.length > 0
      ? `<thead><tr>${cells[0].map((c) => `<th>${c}</th>`).join("")}</tr></thead>`
      : "";
  const tbody =
    cells.length > 1
      ? `<tbody>${cells
          .slice(1)
          .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
          .join("")}</tbody>`
      : "";
  return {
    html: `<table class="highlight-table">${thead}${tbody}</table>`,
    nextIdx: i,
  };
}

function blockToHtml(lines, startIdx) {
  const out = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "---") {
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) break;

    if (trimmed.startsWith("### ")) {
      out.push(`<h3>${inlineMd(trimmed.slice(4))}</h3>`);
      i++;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const t = parseTable(lines, i);
      out.push(t.html);
      i = t.nextIdx;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote class="article-math-block"><p>${inlineMd(quoteLines.join(" "))}</p></blockquote>`
      );
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t.startsWith("- ") && !t.startsWith("* ")) break;
        items.push(`<li>${inlineMd(t.replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (trimmed === "") {
      i++;
      continue;
    }

    out.push(`<p>${inlineMd(trimmed)}</p>`);
    i++;
  }
  return { html: out.join("\n"), nextIdx: i };
}

function convert(md, locale) {
  const quickHeadings = locale === "fr" ? ["En bref"] : ["Quick Answer"];
  const relatedHeadings =
    locale === "fr"
      ? ["Articles et calculateurs connexes"]
      : ["Related Articles and Calculators"];

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  if (!lines[i].startsWith("# ")) throw new Error("Expected H1");
  const title = lines[i].slice(2).trim();
  i++;

  while (i < lines.length && lines[i].trim() === "") i++;

  const sections = [];
  const intro = blockToHtml(lines, i);
  i = intro.nextIdx;
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trim() === "---")) i++;

  sections.push({ kind: "intro", html: intro.html });

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line.startsWith("## ")) {
      i++;
      continue;
    }
    const heading = line.slice(3).trim();
    i++;
    while (i < lines.length && lines[i].trim() === "") i++;

    const body = blockToHtml(lines, i);
    i = body.nextIdx;

    let kind = "section";
    if (quickHeadings.includes(heading)) kind = "quick";
    if (relatedHeadings.includes(heading)) kind = "related";

    sections.push({ kind, heading, html: body.html, id: slugify(heading) });
    while (i < lines.length && (lines[i].trim() === "" || lines[i].trim() === "---")) i++;
  }

  const readingTime =
    locale === "fr" ? "Lecture d'environ 16 minutes" : "16-minute read";
  const lastUpdated =
    locale === "fr" ? "Mis à jour en mai 2026" : "Last updated May 2026";

  const parts = [];
  parts.push(`<article class="article-content">`);
  parts.push(`<header>`);
  parts.push(`<h1>${title}</h1>`);
  parts.push(`<p class="reading-time">${readingTime}</p>`);
  parts.push(`<p class="last-updated">${lastUpdated}</p>`);
  parts.push(`</header>`);

  for (const sec of sections) {
    if (sec.kind === "intro") {
      parts.push(`<section class="section-card intro-card">${sec.html}</section>`);
    } else if (sec.kind === "quick") {
      parts.push(
        `<section class="section-card intro-card"><h2 id="${sec.id}">${sec.heading}</h2>${sec.html}</section>`
      );
    } else if (sec.kind === "related") {
      parts.push(
        `<section class="section-card related-articles"><h2 id="${sec.id}">${sec.heading}</h2>${sec.html}</section>`
      );
    } else {
      parts.push(
        `<section class="section-card"><h2 id="${sec.id}">${sec.heading}</h2>${sec.html}</section>`
      );
    }
  }
  parts.push(`</article>`);

  return { title, wrapMainHtml: parts.join("\n") };
}

const EN_MD = path.join(ROOT, "what-is-a-rrif-final.md");
const FR_MD = path.join(ROOT, "what-is-a-rrif-fr.md");
const EN_OUT = path.join(ROOT, "assets", "i18n", "en", "articles", "what-is-a-rrif.json");
const FR_OUT = path.join(ROOT, "assets", "i18n", "fr", "articles", "what-is-a-rrif.json");

const enConverted = convert(fs.readFileSync(EN_MD, "utf8"), "en");
const frConverted = convert(fs.readFileSync(FR_MD, "utf8"), "fr");

const enDescription =
  "What is a RRIF in Canada? How Registered Retirement Income Funds work: minimum withdrawals, tax treatment, spouse age election, OAS clawback, and withdrawal strategy — with explicit arithmetic.";

const frDescription =
  "Qu'est-ce qu'un FERR au Canada? Retraits minimums, traitement fiscal, élection d'âge du conjoint, récupération de la PSV et stratégie de retrait — avec arithmétique explicite.";

const enHeadline = enConverted.title;
const frHeadline = frConverted.title;

const enArticle = {
  meta: {
    title: `${enHeadline} – The Long Math`,
    description: enDescription,
    canonicalSiteOrigin: "https://www.thelongmath.com",
    articleModified: "May 2026",
    datePublished: "2026-05-31",
    dateModified: "2026-05-31",
    ogTitle: `${enHeadline} – The Long Math`,
    ogDescription: enDescription,
    twitterTitle: `${enHeadline} – The Long Math`,
    twitterDescription: enDescription,
    headline: enHeadline,
  },
  breadcrumbItems: [
    { name: "Home", path: "/" },
    {
      name: "Investment and Financial Literacy",
      path: "/articles/investing-and-financial-literacy/",
    },
    {
      name: enHeadline,
      path: "/articles/investing-and-financial-literacy/what-is-a-rrif/",
    },
  ],
  pageStyles: PAGE_STYLES,
  wrapMainHtml: enConverted.wrapMainHtml,
  disclaimerHtml:
    '<p><strong>Disclaimer:</strong> All content on The Long Math — including articles, essays, calculators, tools, or any other material — is provided solely for educational and informational purposes and does not constitute financial, tax, legal, or investment advice. Any results or projections are based on simplified models, assumptions, and user-supplied inputs and may not reflect real-world outcomes. You are responsible for evaluating the accuracy and applicability of the information provided and for conducting your own due diligence. Before making financial decisions, consult a qualified professional.</p>',
};

const frArticle = {
  meta: {
    title: `${frHeadline} | The Long Math`,
    description: frDescription,
    canonicalSiteOrigin: "https://www.thelongmath.com",
    articleModified: "mai 2026",
    datePublished: "2026-05-31",
    dateModified: "2026-05-31",
    ogTitle: `${frHeadline} | The Long Math`,
    ogDescription: frDescription,
    twitterTitle: `${frHeadline} | The Long Math`,
    twitterDescription: frDescription,
    headline: frHeadline,
  },
  breadcrumbItems: [
    { name: "Accueil", path: "/" },
    {
      name: "Investissement et culture financière",
      path: "/articles/investing-and-financial-literacy/",
    },
    {
      name: frHeadline,
      path: "/articles/investing-and-financial-literacy/what-is-a-rrif/",
    },
  ],
  pageStyles: PAGE_STYLES,
  wrapMainHtml: frConverted.wrapMainHtml,
  disclaimerHtml:
    "<p><strong>Avertissement :</strong> tout le contenu de The Long Math (articles, textes, calculateurs, outils ou autre matériel) est fourni à des fins éducatives et d'information uniquement et ne constitue pas un conseil financier, fiscal, juridique ou en placement. Les résultats reposent sur des modèles simplifiés et des données utilisateur ; vous devez faire votre propre diligence. Consultez un professionnel qualifié avant toute décision.</p>",
};

fs.writeFileSync(EN_OUT, JSON.stringify(enArticle, null, 2) + "\n", "utf8");
fs.writeFileSync(FR_OUT, JSON.stringify(frArticle, null, 2) + "\n", "utf8");
console.log("Wrote", EN_OUT);
console.log("Wrote", FR_OUT);
