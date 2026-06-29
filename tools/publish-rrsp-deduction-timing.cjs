#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "rrsp-deduction-timing";

const pageStyles = `<style>
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
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      margin: 18px 0;
      background: var(--card-bg, var(--surface, #fff));
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.04);
    }
    .section-card.intro-card { margin-top: 14px; }
    .related-articles h2, .related-articles h3 { font-size: 18px; margin: 0 0 10px; }
    .related-articles ul { list-style: none; padding-left: 0; margin: 0; }
    .related-articles li { margin: 12px 0; }
    .related-articles a { color: var(--accent); text-decoration: none; }
    .related-articles a:hover { text-decoration: underline; }
    .faq-accordion { margin: 0; }
    .faq-accordion details { border: 1px solid var(--border); border-radius: 10px; margin: 10px 0; overflow: hidden; }
    .faq-accordion details[open] { border-color: var(--accent, #d6b36a); }
    .faq-accordion summary { padding: 14px 18px; font-weight: 700; cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .faq-accordion summary::-webkit-details-marker { display: none; }
    .faq-accordion summary::after { content: "+"; font-size: 1.2em; color: var(--accent); flex-shrink: 0; }
    .faq-accordion details[open] summary::after { content: "\\2212"; }
    .faq-accordion .faq-answer { padding: 0 18px 16px; }
    .faq-accordion .faq-answer p { margin: 0 0 0.9em 0; }
    .faq-accordion .faq-answer p:last-child { margin-bottom: 0; }
    .highlight-table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
    .highlight-table th, .highlight-table td { border: 1px solid var(--border); padding: 10px 12px; text-align: left; }
    .highlight-table th { background: var(--card-bg, rgba(0, 0, 0, 0.03)); font-weight: 600; }
  </style>`;

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function mdInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      if (href.startsWith("#")) {
        return `<a href="${href}">${label}</a>`;
      }
      return `<a href="${href}">${label}</a>`;
    })
    .replace(/ⁿ/g, "<sup>n</sup>")
    .replace(/×/g, "&times;")
    .replace(/−/g, "&minus;")
    .replace(/"/g, "&quot;");
}

function parseTable(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    rows.push(lines[i].trim());
    i++;
  }
  if (rows.length < 2) return { html: "", next: startIdx };

  const parseRow = (row) =>
    row
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

  const header = parseRow(rows[0]);
  const bodyRows = rows.slice(2).map(parseRow);
  const cls = "highlight-table";
  let html = `<table class="${cls}"><thead><tr>`;
  for (const h of header) html += `<th>${mdInline(h)}</th>`;
  html += "</tr></thead><tbody>";
  for (const row of bodyRows) {
    html += "<tr>";
    for (const cell of row) html += `<td>${mdInline(cell)}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return { html, next: i };
}

function parseMarkdownBody(body) {
  const lines = body.split(/\r?\n/);
  let i = 0;
  let h1 = "";
  let readingTime = "";
  let lastUpdated = "";
  const sections = [];

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      h1 = line.slice(2).trim();
      i++;
      continue;
    }
    if (line.match(/^<p class="reading-time">/)) {
      readingTime = line.trim();
      i++;
      continue;
    }
    if (line.match(/^<p class="last-updated">/)) {
      lastUpdated = line.trim();
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      const title = line.slice(3).trim();
      i++;
      const contentLines = [];
      while (i < lines.length && !lines[i].startsWith("## ")) {
        contentLines.push(lines[i]);
        i++;
      }
      sections.push({ title, contentLines });
      continue;
    }
    i++;
  }

  return { h1, readingTime, lastUpdated, sections };
}

function renderBlockLines(contentLines) {
  const parts = [];
  let i = 0;
  while (i < contentLines.length) {
    const line = contentLines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      parts.push(`<h3>${mdInline(line.slice(4).trim())}</h3>`);
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const { html, next } = parseTable(contentLines, i);
      parts.push(html);
      i = next;
      continue;
    }
    if (line.trim().startsWith("- ")) {
      parts.push("<ul>");
      while (i < contentLines.length && contentLines[i].trim().startsWith("- ")) {
        parts.push(`<li>${mdInline(contentLines[i].trim().slice(2))}</li>`);
        i++;
      }
      parts.push("</ul>");
      continue;
    }
    parts.push(`<p>${mdInline(line.trim())}</p>`);
    i++;
  }
  return parts.join("\n");
}

function sectionId(title) {
  const map = {
    "Quick Answer": "quick-answer",
    "En bref": "quick-answer",
    "A Note on Effective Marginal Tax Rate": "a-note-on-effective-marginal-tax-rate",
    "Note sur le taux marginal d'imposition effectif": "a-note-on-effective-marginal-tax-rate",
  };
  return map[title] || slugifyHeading(title);
}

function buildFaqSection(section) {
  const content = section.contentLines.join("\n");
  const blocks = content.split(/\n(?=### )/).filter(Boolean);
  let html = '<div class="faq-accordion">';
  const faq = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines[0].startsWith("### ")) continue;
    const question = lines[0].slice(4).trim();
    const answer = lines.slice(1).join(" ").trim();
    html += `<details><summary>${mdInline(question)}</summary><div class="faq-answer"><p>${mdInline(answer)}</p></div></details>`;
    faq.push({ question, answerHtml: `<p>${mdInline(answer)}</p>` });
  }
  html += "</div>";
  return { html, faq };
}

function buildRelatedSection(sections) {
  let html = "";
  for (const sec of sections) {
    html += `<h3>${mdInline(sec.title.replace(/^Related /, ""))}</h3><ul>`;
    for (const line of sec.contentLines) {
      const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\)/);
      if (m) html += `<li><a href="${m[2]}">${mdInline(m[1])}</a></li>`;
    }
    html += "</ul>";
  }
  return html;
}

function buildWrapMainHtml(parsed) {
  const { h1, readingTime, lastUpdated, sections } = parsed;
  let html = `<article class="article-content">\n<header>\n<h1>${mdInline(h1)}</h1>\n${readingTime}\n${lastUpdated}\n</header>\n`;

  let faqItems = [];
  let i = 0;
  while (i < sections.length) {
    const sec = sections[i];
    const title = sec.title;

    if (title === "Frequently Asked Questions" || title === "Foire aux questions") {
      const { html: faqHtml, faq } = buildFaqSection(sec);
      faqItems = faq;
      html += `<section class="section-card"><h2 id="faq">${mdInline(title)}</h2>${faqHtml}</section>\n`;
      i++;
      continue;
    }

    if (title === "Related Articles" || title === "Related Calculators" || title === "Articles connexes" || title === "Calculateurs connexes") {
      const relatedSecs = [];
      while (
        i < sections.length &&
        ["Related Articles", "Related Calculators", "Articles connexes", "Calculateurs connexes"].includes(
          sections[i].title
        )
      ) {
        relatedSecs.push(sections[i]);
        i++;
      }
      const relTitle =
        title.startsWith("Related") || title.startsWith("Articles")
          ? title.includes("Articles") || title.includes("Articles connexes")
            ? "Related Articles"
            : "Related Calculators"
          : "Articles connexes";
      const heading =
        relatedSecs[0].title === "Articles connexes" ? "Articles et calculateurs connexes" : "Related Articles";
      html += `<section class="section-card related-articles"><h2>${heading}</h2>${buildRelatedSection(relatedSecs)}</section>\n`;
      continue;
    }

    const id = sectionId(title);
    const intro = title === "Quick Answer" || title === "En bref" ? " intro-card" : "";
    const body = renderBlockLines(sec.contentLines);
    html += `<section class="section-card${intro}" id="${id}"><h2>${mdInline(title)}</h2>${body}</section>\n`;
    i++;
  }

  html += "</article>";
  return { wrapMainHtml: html, faq: faqItems };
}

function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("Missing YAML frontmatter");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s{2}(\w+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[kv[1]] = val;
  }
  return { meta, body: m[2] };
}

function buildArticleJson(lang, mdPath, options) {
  const raw = fs.readFileSync(mdPath, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const parsed = parseMarkdownBody(body);
  const { wrapMainHtml, faq } = buildWrapMainHtml(parsed);

  const headline = meta.headline || parsed.h1;
  const breadcrumbName = headline;
  const hubLabel = options.hubLabel || headline;

  const payload = {
    meta: {
      title: meta.title,
      description: meta.description,
      canonicalSiteOrigin: "https://www.thelongmath.com",
      articleModified: meta.articleModified,
      datePublished: "2026-06-18",
      dateModified: "2026-06-18",
      ogTitle: meta.ogTitle || meta.title,
      ogDescription: meta.ogDescription || meta.description,
      twitterTitle: meta.twitterTitle || meta.title,
      twitterDescription: meta.twitterDescription || meta.description,
      headline,
    },
    breadcrumbItems: [
      { name: options.homeLabel, path: "/" },
      { name: options.hubBreadcrumb, path: "/articles/investing-and-financial-literacy/" },
      {
        name: breadcrumbName,
        path: `/articles/investing-and-financial-literacy/${SLUG}/`,
      },
    ],
    pageStyles,
    wrapMainHtml,
    disclaimerHtml:
      lang === "fr"
        ? '<p><strong>Avis de non-responsabilité :</strong> L\'ensemble du contenu de The Long Math — articles, textes, calculateurs, outils ou tout autre matériel — est fourni à des fins éducatives et d\'information uniquement et ne constitue pas un conseil financier, fiscal, juridique ou en placement. Les résultats ou projections reposent sur des modèles simplifiés, des hypothèses et des données fournies par l\'utilisateur et peuvent ne pas refléter la réalité. Il vous appartient d\'évaluer l\'exactitude et la pertinence des renseignements et de faire votre propre diligence raisonnable. Avant de prendre des décisions financières, consultez un professionnel qualifié.</p>'
        : '<p><strong>Disclaimer:</strong> All content on The Long Math — including articles, essays, calculators, tools, or any other material — is provided solely for educational and informational purposes and does not constitute financial, tax, legal, or investment advice. Any results or projections are based on simplified models, assumptions, and user-supplied inputs and may not reflect real-world outcomes. You are responsible for evaluating the accuracy and applicability of the information provided and for conducting your own due diligence. Before making financial decisions, consult a qualified professional.</p>',
    faq,
    _hubLabel: hubLabel,
  };

  return payload;
}

function writeJson(lang, payload) {
  const out = path.join(ROOT, "assets", "i18n", lang, "articles", `${SLUG}.json`);
  const { _hubLabel, ...clean } = payload;
  fs.writeFileSync(out, JSON.stringify(clean, null, 2) + "\n", "utf8");
  console.log("Wrote", out);
  return { hubLabel: _hubLabel, hubDesc: payload.meta.description };
}

function addHubCard(lang, hubInfo) {
  const hubPath = path.join(ROOT, "assets", "i18n", lang, "articles", "investing-and-financial-literacy-index.json");
  const hub = JSON.parse(fs.readFileSync(hubPath, "utf8"));
  if (hub.hubMainHtml.includes(`/articles/investing-and-financial-literacy/${SLUG}/`)) {
    console.log("Hub already contains", SLUG, lang);
    return;
  }
  const anchor =
    lang === "fr"
      ? 'href="/articles/investing-and-financial-literacy/what-is-an-rrsp/"'
      : 'href="/articles/investing-and-financial-literacy/what-is-an-rrsp/"';
  const card =
    lang === "fr"
      ? `\n          <li><a href="/articles/investing-and-financial-literacy/${SLUG}/" class="journey-item-link"><h3 class="journey-item-title">${hubInfo.hubLabel}</h3><p class="journey-item-desc">Quand réclamer la déduction REER ou la reporter à une année à revenu plus élevé.</p></a></li>`
      : `\n          <li><a href="/articles/investing-and-financial-literacy/${SLUG}/" class="journey-item-link"><h3 class="journey-item-title">${hubInfo.hubLabel}</h3><p class="journey-item-desc">When to claim the RRSP deduction versus saving it for a higher-income year.</p></a></li>`;

  const idx = hub.hubMainHtml.indexOf(anchor);
  if (idx === -1) throw new Error("Hub anchor not found for " + lang);
  const insertAt = hub.hubMainHtml.indexOf("</a></li>", idx) + "</a></li>".length;
  hub.hubMainHtml = hub.hubMainHtml.slice(0, insertAt) + card + hub.hubMainHtml.slice(insertAt);
  fs.writeFileSync(hubPath, JSON.stringify(hub, null, 2) + "\n", "utf8");
  console.log("Updated hub", lang);
}

function addSearchIndex(enMeta) {
  const idxPath = path.join(ROOT, "assets", "data", "search-index.json");
  const index = JSON.parse(fs.readFileSync(idxPath, "utf8"));
  const url = `/articles/investing-and-financial-literacy/${SLUG}/`;
  if (index.some((e) => e.url === url)) {
    console.log("Search index already has EN entry");
  } else {
    index.push({
      type: "article",
      title: enMeta.headline,
      url,
      desc: enMeta.description,
      keywords: [
        "RRSP deduction timing",
        "rrsp deduction",
        "claim rrsp deduction",
        "defer rrsp deduction",
        "undeducted rrsp contribution",
        "rrsp refund",
        "canada",
        "reer",
      ],
    });
    fs.writeFileSync(idxPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    console.log("Added EN search index entry");
  }
}

// Main
const enPayload = buildArticleJson("en", path.join(ROOT, "v3-rrsp-deduction-timing.md"), {
  homeLabel: "Home",
  hubBreadcrumb: "Investment and Financial Literacy",
});
const frPath = path.join(ROOT, "v3-rrsp-deduction-timing-fr.md");
if (!fs.existsSync(frPath)) {
  console.error("Missing French markdown:", frPath);
  process.exit(1);
}
const frPayload = buildArticleJson("fr", frPath, {
  homeLabel: "Accueil",
  hubBreadcrumb: "Investissement et culture financière",
  hubLabel: "Calendrier de la déduction REER : réclamer maintenant ou plus tard?",
});

const enHub = writeJson("en", enPayload);
const frHub = writeJson("fr", frPayload);
addHubCard("en", enHub);
addHubCard("fr", frHub);
addSearchIndex(enPayload.meta);

console.log("Done. Run npm run build next.");
