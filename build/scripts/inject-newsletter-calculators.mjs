/**
 * One-off / repeatable: keep calculator newsletter directly under the calculator
 * card area and before report issue / FAQ / assumptions / methods sections.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CALC = path.join(ROOT, "calculators");

const SNIPPET = `    <section class="newsletter-signup card" aria-labelledby="newsletter-calc-heading">
      <h2 id="newsletter-calc-heading" class="newsletter-signup-heading">Want new calculators like this when they go live?</h2>
      <p class="newsletter-signup-copy">Get one concise monthly email when The Long Math publishes new calculators, articles, and essays.</p>
      <div class="newsletter-embed-wrap">
        <iframe
          src="https://subscribe-forms.beehiiv.com/bfdc64a5-2697-4bb0-bec5-5a557c9f274b"
          class="beehiiv-embed"
          data-test-id="beehiiv-embed"
          frameborder="0"
          scrolling="no"
          style="width: 330px; height: 53px; margin: 0; border-radius: 0; background-color: transparent; box-shadow: 0 0 #0000; max-width: 100%;"
          title="Newsletter signup"
        ></iframe>
      </div>
    </section>

`;

const ANCHORS = [
  '<div class="report-issue-wrap">',
  '<details class="assumptions-block"',
  '<section class="assumptions-block"',
  '<section class="faq-section"',
  '<section class="faq"',
  "<h2>Frequently Asked Questions</h2>",
  "<h2>Frequently asked questions</h2>",
  '<section class="methods"',
  '<section class="loan-methods"',
  '<div class="disclaimer">',
];

function removeExistingNewsletter(html) {
  return html.replace(
    /\s*<section class="newsletter-signup card" aria-labelledby="newsletter-calc-heading">[\s\S]*?<\/section>\s*/g,
    "\n\n"
  );
}

function inject(html, filePath) {
  let cleaned = removeExistingNewsletter(html);

  for (const anchor of ANCHORS) {
    const idx = cleaned.indexOf(anchor);
    if (idx !== -1) {
      return cleaned.slice(0, idx) + SNIPPET + cleaned.slice(idx);
    }
  }

  const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  console.warn("NO ANCHOR:", rel);
  return cleaned;
}

function main() {
  const entries = fs.readdirSync(CALC, { withFileTypes: true });
  let n = 0;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === "tools") continue;
    const idx = path.join(CALC, ent.name, "index.html");
    if (!fs.existsSync(idx)) continue;
    if (ent.name === "index") continue;
    let html = fs.readFileSync(idx, "utf8");
    const next = inject(html, idx);
    if (next !== html) {
      fs.writeFileSync(idx, next, "utf8");
      n++;
      console.log("updated:", path.relative(ROOT, idx));
    }
  }
  console.log("done, updated", n, "calculator pages");
}

main();
