#!/usr/bin/env node
/**
 * Compare the-long-math results vs TurboTax baseline for $160k × provinces × income types.
 * Run from repo root:
 *   1. node tools/tests/run-160k-comparison.js --out=our-results.2025.160k.json
 *   2. Fill turbotax-baseline.2025.160k.json with TurboTax values (see format below)
 *   3. node tools/tests/compare-with-turbotax.js
 *
 * TurboTax baseline format: same as our results, with rows[].totalTax, federalTax, provTax
 * from TurboTax. Rows must have province + incomeType matching (e.g. "ON", "salary").
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUR_FILE = join(__dirname, 'our-results.2025.160k.json');
const TURBOTAX_FILE = join(__dirname, 'turbotax-baseline.2025.160k.json');
const TOLERANCE = 5; // allow $5 difference before reporting error

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return null;
  }
}

function run() {
  const ours = loadJson(OUR_FILE);
  const turbo = loadJson(TURBOTAX_FILE);

  if (!ours || !ours.rows || !ours.rows.length) {
    console.error('Run first: node tools/tests/run-160k-comparison.js --out=our-results.2025.160k.json');
    process.exit(1);
  }
  if (!turbo || !turbo.rows || !turbo.rows.length) {
    console.error('TurboTax baseline is empty. Copy our-results.2025.160k.json to turbotax-baseline.2025.160k.json and replace totalTax, federalTax, provTax with TurboTax values for each row.');
    process.exit(1);
  }

  const turboByKey = {};
  turbo.rows.forEach((r) => {
    const key = `${r.province}|${r.incomeType}`;
    turboByKey[key] = r;
  });

  const errors = [];
  const ok = [];
  let missing = 0;

  ours.rows.forEach((our) => {
    if (our.error) return;
    const key = `${our.province}|${our.incomeType}`;
    const tt = turboByKey[key];
    if (!tt || tt.totalTax == null) {
      missing++;
      return;
    }
    const dTotal = Math.abs((our.totalTax || 0) - tt.totalTax);
    const dFed = Math.abs((our.federalTax || 0) - (tt.federalTax ?? 0));
    const dProv = Math.abs((our.provTax || 0) - (tt.provTax ?? 0));
    if (dTotal > TOLERANCE || dFed > TOLERANCE || dProv > TOLERANCE) {
      errors.push({
        province: our.province,
        incomeType: our.incomeTypeLabel || our.incomeType,
        our: { totalTax: our.totalTax, federalTax: our.federalTax, provTax: our.provTax },
        turbotax: { totalTax: tt.totalTax, federalTax: tt.federalTax, provTax: tt.provTax },
        diff: { total: (our.totalTax || 0) - tt.totalTax, federal: (our.federalTax || 0) - (tt.federalTax ?? 0), prov: (our.provTax || 0) - (tt.provTax ?? 0) },
      });
    } else {
      ok.push({ province: our.province, incomeType: our.incomeType });
    }
  });

  console.log('\nComparison: the-long-math vs TurboTax ($160k, 2025)\n');
  if (missing > 0) console.log(`Missing TurboTax values for ${missing} row(s).\n`);
  if (errors.length === 0) {
    console.log('All compared rows within $' + TOLERANCE + ' tolerance. No errors.\n');
    process.exit(0);
  }
  console.log('Differences (our value - TurboTax) beyond $' + TOLERANCE + ':\n');
  errors.forEach((e) => {
    console.log(`${e.province}  ${e.incomeType}:`);
    console.log(`  Total tax:  ours ${e.our.totalTax}  TurboTax ${e.turbotax.totalTax}  diff ${e.diff.total.toFixed(2)}`);
    console.log(`  Federal:   ours ${e.our.federalTax}  TurboTax ${e.turbotax.federalTax}  diff ${e.diff.federal.toFixed(2)}`);
    console.log(`  Provincial: ours ${e.our.provTax}  TurboTax ${e.turbotax.provTax}  diff ${e.diff.prov.toFixed(2)}`);
    console.log('');
  });
  console.log('Total rows with differences: ' + errors.length + '\n');
  process.exit(1);
}

run();
