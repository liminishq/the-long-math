import { chromium } from 'playwright';

const CRA_URL =
  'https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log(`Navigating to CRA page: ${CRA_URL}`);
  await page.goto(CRA_URL, { waitUntil: 'domcontentloaded' });

  const selects = await page.locator('select').all();
  console.log(`Found ${selects.length} <select> elements on the page.\n`);

  for (let i = 0; i < selects.length; i++) {
    console.log(`--- select index ${i} ---`);
    const data = await selects[i].evaluate((sel) => {
      const options = Array.from(sel.querySelectorAll('option')).map((opt) => ({
        value: opt.value,
        label: (opt.textContent || '').trim()
      }));
      return {
        id: sel.id || null,
        name: sel.name || null,
        className: sel.className || null,
        options
      };
    });
    console.dir(data, { depth: null });
    console.log('\n');
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Error inspecting CRA selects:', err);
  process.exit(1);
});

