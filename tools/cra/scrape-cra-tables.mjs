import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------
// CONFIGURATION
// ------------------------------

// Years and jurisdictions you want to scrape.
// Start with a single combination for debugging; expand once confirmed.
const YEARS = [2025];

// The visible option labels in the CRA jurisdiction dropdown.
// Key is an arbitrary code; label must match what CRA shows beside each "Apply" group.
const JURISDICTIONS = [
  { code: 'FED', label: 'Federal' }
  // Once this works and files appear, we can re-add provinces/territories.
];

// CRA source URL for individual tax rates.
const CRA_URL =
  'https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html';

// Output directory for raw table captures (relative to this script file).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, 'raw-cra-tables');

// ------------------------------
// MAIN
// ------------------------------

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log(`Navigating to CRA page: ${CRA_URL}`);
  await page.goto(CRA_URL, { waitUntil: 'domcontentloaded' });

  for (const year of YEARS) {
    for (const juris of JURISDICTIONS) {
      try {
        console.log(`\nScraping ${year} – ${juris.label}...`);
        await scrapeYearJurisdiction(page, year, juris);
      } catch (err) {
        console.error(`Error scraping ${year} – ${juris.label}:`, err);
      }
    }
  }

  await browser.close();
  console.log('\nDone. Raw CRA tables written to:', OUTPUT_DIR);
}

async function scrapeYearJurisdiction(page, year, juris) {
  // Ensure we are on the main CRA page (defensive).
  if (!page.url().startsWith('https://www.canada.ca/')) {
    await page.goto(CRA_URL, { waitUntil: 'domcontentloaded' });
  }

  // NOTE: The controls on the CRA page may change over time.
  // The selectors below are written to be as generic as possible, but if they break:
  // - Open the CRA page in a normal browser
  // - Inspect the year and province/federal selects
  // - Adjust the locators here (by label text or by CSS id/class)

  // 1) Select the year.
  // This assumes the first <select> on the page is "Select the tax year".
  const yearSelect = page.locator('select').first();
  await yearSelect.waitFor({ state: 'visible' });
  await yearSelect.selectOption({ label: String(year) });

  // 2) Select the federal / province / territory.
  // This assumes the second <select> is the jurisdiction dropdown.
  const jurisSelect = page.locator('select').nth(1);
  await jurisSelect.waitFor({ state: 'visible' });
  await jurisSelect.selectOption({ label: juris.label });

  // 3) Click the "Apply" button.
  const applyButton = page.getByRole('button', { name: /Apply/i }).first();
  await applyButton.click();

  // 4) Wait for the table for this combination to appear.
  const table = page.locator('table').first();
  await table.waitFor({ state: 'visible' });

  // 5) Extract headers and rows as plain text.
  const tableData = await table.evaluate((tbl) => {
    const headers = Array.from(tbl.querySelectorAll('thead tr th')).map((th) =>
      th.textContent?.trim() || ''
    );

    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      return Array.from(tr.querySelectorAll('th, td')).map(
        (cell) => cell.textContent?.trim() || ''
      );
    });

    return { headers, rows, html: tbl.outerHTML };
  });

  const out = {
    sourceUrl: CRA_URL,
    scrapedAt: new Date().toISOString(),
    year,
    jurisdiction: juris,
    table: tableData
  };

  const filename = `${year}-${juris.code}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`Saved ${filename} (${tableData.rows.length} rows).`);
}

main().catch((err) => {
  console.error('Fatal error in CRA scraper:', err);
  process.exit(1);
});

