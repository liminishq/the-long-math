#!/usr/bin/env node
/**
 * Run the-long-math calculator for $160,000 in each income type, for every province/territory.
 * Use as baseline to compare with an external comparator tax tool (manual or via external-baseline.2025.160k.json).
 *
 * Usage (from repo root):
 *   node tools/tests/run-160k-comparison.js [--year=2025] [--out=results.json]
 *
 * Income types: salary (employment), capitalGains, eligibleDividends, nonEligibleDividends, otherIncome.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computePersonalTax } from '../../calculators/canada-income-tax/js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DATA_DIR = join(ROOT, 'calculators/canada-income-tax/data/2025');

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

const INCOME_TYPES = [
  { id: 'salary', label: 'Salary (employment income)', field: 'employmentIncome' },
  { id: 'capitalGains', label: 'Capital gains', field: 'capitalGains' },
  { id: 'eligibleDividends', label: 'Eligible dividends', field: 'eligibleDividends' },
  { id: 'nonEligibleDividends', label: 'Non-eligible dividends', field: 'nonEligibleDividends' },
  { id: 'otherIncome', label: 'Other income', field: 'otherIncome' },
];

const REFERENCE_INCOME = 160000;

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getDataOverride() {
  return {
    federal: loadJson(join(DATA_DIR, 'federal.json')),
    provinces: loadJson(join(DATA_DIR, 'provinces.json')),
    payroll: loadJson(join(DATA_DIR, 'payroll.json')),
    dividends: loadJson(join(DATA_DIR, 'dividends.json')),
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let year = 2025;
  let outPath = null;
  for (const arg of args) {
    if (arg.startsWith('--year=')) year = parseInt(arg.slice(7), 10);
    if (arg.startsWith('--out=')) outPath = arg.slice(6).trim();
  }
  return { year, outPath };
}

function buildInput(province, incomeType) {
  const input = {
    year: 2025,
    province,
    employmentIncome: 0,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    capitalGains: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    estimatedDeductions: 0,
    taxPaid: 0,
  };
  const type = INCOME_TYPES.find((t) => t.id === incomeType);
  if (type) input[type.field] = REFERENCE_INCOME;
  return input;
}

function run() {
  const { year, outPath } = parseArgs();
  const dataOverride = getDataOverride();
  const results = { year, referenceIncome: REFERENCE_INCOME, source: 'the-long-math', rows: [] };

  const tableRows = [];
  const col = (v, w) => String(v).padStart(w);
  const header = [
    'Prov',
    'Income type'.padEnd(18),
    'TotalTax'.padStart(10),
    'Federal'.padStart(10),
    'Prov'.padStart(10),
    'TaxableInc'.padStart(11),
    'Marg%'.padStart(6),
  ].join('  ');

  for (const province of PROVINCES) {
    for (const it of INCOME_TYPES) {
      const input = buildInput(province, it.id);
      let row;
      try {
        const r = computePersonalTax(input, { dataOverride });
        const t = r.totals;
        const marginalPct = t.marginalRate != null ? (t.marginalRate * 100).toFixed(1) : '–';
        const avgRatePct = t.avgRate != null ? Math.round(t.avgRate * 10000) / 100 : null;
        row = {
          province,
          incomeType: it.id,
          incomeTypeLabel: it.label,
          totalTax: Math.round(t.totalIncomeTax * 100) / 100,
          federalTax: Math.round(t.federalTax * 100) / 100,
          provTax: Math.round(t.provTax * 100) / 100,
          taxableIncome: Math.round(t.taxableIncome * 100) / 100,
          marginalRatePct: t.marginalRate != null ? Math.round(t.marginalRate * 10000) / 100 : null,
          avgRatePct: avgRatePct,
        };
        results.rows.push(row);
        tableRows.push([
          province,
          it.label.padEnd(18),
          col(row.totalTax.toFixed(0), 10),
          col(row.federalTax.toFixed(0), 10),
          col(row.provTax.toFixed(0), 10),
          col(row.taxableIncome.toFixed(0), 11),
          col(marginalPct, 6),
        ].join('  '));
      } catch (err) {
        results.rows.push({
          province,
          incomeType: it.id,
          incomeTypeLabel: it.label,
          error: err.message,
        });
        tableRows.push(`${province}  ${it.label.padEnd(18)}  ERROR: ${err.message}`);
      }
    }
  }

  console.log('\nThe-Long-Math  —  $160,000 by income type, by province/territory (year ' + year + ')\n');
  console.log(header);
  console.log('-'.repeat(header.length));
  tableRows.forEach((r) => console.log(r));
  console.log('');

  if (outPath) {
    const fullPath = join(__dirname, outPath);
    writeFileSync(fullPath, JSON.stringify(results, null, 2), 'utf8');
    console.log('Wrote: ' + fullPath);
    console.log('To compare with an external comparator tax tool, create external-baseline.2025.160k.json with the same structure and run: node tools/tests/compare-with-external-baseline.js');
  }
}

run();
