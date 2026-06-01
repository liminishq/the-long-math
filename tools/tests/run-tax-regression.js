#!/usr/bin/env node
/**
 * Regression harness for Canada income tax calculator.
 * Run from repo root: node tools/tests/run-tax-regression.js [--year=2025] [--provinces=ON,AB] [--scenarios=employmentOnly,eligibleDivOnly]
 * Also supports singular: --province=AB --scenario=eligibleDivOnly
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computePersonalTax } from '../../calculators/canada-income-tax/js/tax.engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DATA_DIR = join(ROOT, 'calculators/canada-income-tax/data/2025');
const SCENARIOS_FILE = join(__dirname, 'scenarios.tax2025.json');
const BASELINES_FILE = join(__dirname, 'baselines.2025.ON.json');

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
  let provinces = null;
  let scenarios = null;
  for (const arg of args) {
    if (arg.startsWith('--year=')) year = parseInt(arg.slice(7), 10);
    if (arg.startsWith('--provinces=')) provinces = arg.slice(11).split(',').map(s => s.trim()).filter(Boolean);
    if (arg.startsWith('--province=')) provinces = [arg.slice(11).trim()];
    if (arg.startsWith('--scenarios=')) scenarios = arg.slice(11).split(',').map(s => s.trim()).filter(Boolean);
    if (arg.startsWith('--scenario=')) scenarios = [arg.slice(11).trim()];
  }
  return { year, provinces, scenarios };
}

function run() {
  const { year, provinces: filterProvinces, scenarios: filterScenarios } = parseArgs();
  const scenarioConfig = loadJson(SCENARIOS_FILE);
  if (scenarioConfig.year !== year) {
    console.error(`Scenarios file is for year ${scenarioConfig.year}; requested ${year}. Only 2025 is supported.`);
    process.exit(1);
  }
  const baselinesByYear = {};
  try {
    const baselines = loadJson(BASELINES_FILE);
    baselinesByYear[2025] = baselines;
  } catch (_) {
    // optional
  }
  const dataOverride = getDataOverride();
  const { scenarios: scenarioDefs, provinceScenarios } = scenarioConfig;
  const provinces = filterProvinces || Object.keys(provinceScenarios);
  const scenarioIds = filterScenarios || null;

  const rows = [];
  const failures = [];

  for (const province of provinces) {
    const list = provinceScenarios[province];
    if (!list) {
      console.warn(`Unknown province: ${province}, skipping.`);
      continue;
    }
    const toRun = scenarioIds ? list.filter(s => scenarioIds.includes(s)) : list;
    for (const scenarioId of toRun) {
      const def = scenarioDefs[scenarioId];
      if (!def) {
        console.warn(`Unknown scenario: ${scenarioId}, skipping.`);
        continue;
      }
      const input = {
        year,
        province,
        employmentIncome: def.employmentIncome ?? 0,
        selfEmploymentIncome: 0,
        otherIncome: 0,
        eligibleDividends: def.eligibleDividends ?? 0,
        nonEligibleDividends: def.nonEligibleDividends ?? 0,
        capitalGains: def.capitalGains ?? 0,
        rrspDeduction: 0,
        fhsaDeduction: 0,
        estimatedDeductions: 0,
        taxPaid: 0,
      };
      let result;
      try {
        result = computePersonalTax(input, { dataOverride });
      } catch (err) {
        failures.push({ province, scenario: scenarioId, error: err.message });
        rows.push({
          province,
          scenario: scenarioId,
          totalTax: NaN,
          fed: NaN,
          prov: NaN,
          taxableInc: NaN,
          mEmp: NaN,
          mDiv: NaN,
          mCG: NaN,
        });
        continue;
      }
      const t = result.totals;
      const mr = result.breakdown?.marginalRates ?? {};
      rows.push({
        province,
        scenario: scenarioId,
        totalTax: t.totalIncomeTax,
        fed: t.federalTax,
        prov: t.provTax,
        taxableInc: t.taxableIncome,
        mEmp: mr.employment,
        mDiv: mr.eligibleDividends,
        mCG: mr.capitalGains,
      });
      // Baseline assertion for ON eligibleDiv160k
      if (province === 'ON' && scenarioId === 'eligibleDiv160k' && baselinesByYear[year]) {
        const bl = baselinesByYear[year].eligibleDiv160k;
        const tolTax = bl.toleranceTax ?? 2700;
        const tolInc = bl.toleranceIncome ?? 2;
        if (Math.abs(t.totalIncomeTax - bl.totalTax) > tolTax) {
          failures.push({ province, scenario: scenarioId, error: `totalTax expected ~${bl.totalTax}, got ${t.totalIncomeTax}` });
        }
        if (Math.abs(t.federalTax - bl.federal) > tolTax) {
          failures.push({ province, scenario: scenarioId, error: `federal expected ~${bl.federal}, got ${t.federalTax}` });
        }
        if (Math.abs(t.provTax - bl.provincial) > tolTax) {
          failures.push({ province, scenario: scenarioId, error: `provincial expected ~${bl.provincial}, got ${t.provTax}` });
        }
        if (Math.abs(t.taxableIncome - bl.taxableIncome) > tolInc) {
          failures.push({ province, scenario: scenarioId, error: `taxableIncome expected ~${bl.taxableIncome}, got ${t.taxableIncome}` });
        }
      }
      // When scenario has employment income, marginal employment should be > 0
      if ((def.employmentIncome ?? 0) > 0) {
        if ((mr.employment ?? 0) <= 0) {
          failures.push({ province, scenario: scenarioId, error: `marginalEmployment must be > 0 when employmentIncome > 0` });
        }
      }
      // No negative marginals on any computed field
      for (const [key, val] of Object.entries(mr)) {
        if (val != null && val < 0) {
          failures.push({ province, scenario: scenarioId, error: `marginal ${key} must not be negative (got ${val})` });
        }
      }
      if ((t.marginalRate ?? 0) < 0 || (t.marginalRate ?? 0) > 1) {
        failures.push({ province, scenario: scenarioId, error: `combined marginalRate must be in [0,1] (got ${t.marginalRate})` });
      }
    }
  }

  // Print table
  const fmt = (n) => (Number.isNaN(n) ? '—' : typeof n === 'number' ? n.toFixed(2) : String(n));
  console.log('Province  Scenario           TotalTax  Fed      Prov    TaxableInc  M_Emp  M_Div  M_CG');
  console.log('─'.repeat(85));
  for (const r of rows) {
    console.log(
      `${r.province.padEnd(9)} ${r.scenario.padEnd(18)} ${fmt(r.totalTax).padStart(8)}  ${fmt(r.fed).padStart(8)}  ${fmt(r.prov).padStart(8)}  ${fmt(r.taxableInc).padStart(10)}  ${fmt(r.mEmp).padStart(5)}  ${fmt(r.mDiv).padStart(5)}  ${fmt(r.mCG).padStart(5)}`
    );
  }
  if (failures.length > 0) {
    console.error('\n✖ Assertion(s) failed:');
    failures.forEach((f) => console.error(`  ${f.province} ${f.scenario}: ${f.error}`));
    process.exit(1);
  }
  console.log('\n✔ All tests passed.');
}

run();
