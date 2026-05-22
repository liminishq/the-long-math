/**
 * Add cppEiCredit to each province using basicPersonalAmount.rate (Form 428 line 58240).
 * Skips QC (not form-verified in v1). Run: node tools/add-provincial-cpp-ei-credits.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'data');

for (const year of ['2025', '2026']) {
  const file = path.join(root, year, 'provinces.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [code, prov] of Object.entries(data)) {
    if (code.startsWith('_') || code === 'QC') continue;
    if (!prov.credits?.basicPersonalAmount) continue;
    const rate = prov.credits.basicPersonalAmount.rate;
    prov.credits.cppEiCredit = {
      rate,
      _note: `Provincial credit on base CPP and EI (lowest rate ${(rate * 100).toFixed(4)}% for ${year}).`,
    };
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('Updated', file);
}
