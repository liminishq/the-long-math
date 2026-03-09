#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const enginePath = pathToFileURL(join(root, 'calculators/canada-income-tax/js/tax.engine.js')).href;
const dataDir = join(root, 'calculators/canada-income-tax/data/2025');

const federal = JSON.parse(readFileSync(join(dataDir, 'federal.json'), 'utf8'));
const provinces = JSON.parse(readFileSync(join(dataDir, 'provinces.json'), 'utf8'));
const payroll = JSON.parse(readFileSync(join(dataDir, 'payroll.json'), 'utf8'));
const dividends = JSON.parse(readFileSync(join(dataDir, 'dividends.json'), 'utf8'));

const { computePersonalTax } = await import(enginePath);
const result = computePersonalTax({
  year: 2025, province: 'ON', employmentIncome: 160000, selfEmploymentIncome: 0, otherIncome: 0,
  eligibleDividends: 0, nonEligibleDividends: 0, capitalGains: 0, rrspDeduction: 0, fhsaDeduction: 0, estimatedDeductions: 0, taxPaid: 0
}, { dataOverride: { federal, provinces, payroll, dividends } });

console.log(JSON.stringify({ federalTax: result.totals.federalTax, provTax: result.totals.provTax, totalIncomeTax: result.totals.totalIncomeTax }, null, 2));
