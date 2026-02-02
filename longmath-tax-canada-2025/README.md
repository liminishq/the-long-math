# Canada Personal Income Tax Calculator 2025

A static, client-side calculator for estimating Canadian personal income tax. Built for "The Long Math" website.

## Overview

This calculator provides educational arithmetic for estimating personal income tax in Canada. It is **not tax advice** - it is a tool for understanding how tax calculations work.

## Features

- **All provinces and territories**: Supports all 13 Canadian jurisdictions
- **Comprehensive income types**: Employment, self-employment, dividends (eligible/non-eligible), capital gains, other income
- **Deductions**: RRSP and FHSA deductions
- **Payroll taxes**: CPP and EI calculations
- **Transparent breakdown**: "Show the math" sections reveal all calculations
- **Pure architecture**: Separated engine (no DOM) and UI modules
- **No dependencies**: Vanilla JavaScript only

## Project Structure

```
longmath-tax-canada-2025/
├── index.html              # Main calculator page
├── styles.css              # Dark theme styling
├── README.md               # This file
├── js/
│   ├── tax.engine.js      # Pure calculation engine (no DOM)
│   ├── tax.data.js        # Data loading and normalization
│   ├── tax.ui.js          # UI module (DOM interactions)
│   └── format.js          # Currency and percent formatting
├── data/
│   └── 2025/
│       ├── federal.json   # Federal tax brackets and credits
│       ├── provinces.json # Provincial/territorial tax data
│       ├── payroll.json   # CPP/EI parameters
│       └── dividends.json # Dividend gross-up and DTC rates
└── tests/
    ├── engine.test.js     # Test suite
    └── test.html          # Test harness page
```

## Usage

### Running Locally

1. Open `index.html` in a modern web browser
2. Select your province/territory
3. Enter your income and deduction values
4. Results update automatically as you type

### Input Fields

- **Tax Year**: Currently only 2025 (designed to support future years)
- **Province/Territory**: Select your province or territory of residence (alphabetical order)
- **Employment Income**: Income from employment (subject to CPP/EI)
- **Self-Employment Income**: Income from self-employment
- **Other Income**: Other taxable income
- **Eligible Dividends**: Eligible Canadian dividends
- **Non-Eligible Dividends**: Non-eligible Canadian dividends
- **Capital Gains**: Capital gains (50% inclusion rate)
- **RRSP Deduction**: RRSP contribution deduction
- **FHSA Deduction**: First Home Savings Account deduction
- **Income Tax Already Paid**: Tax withheld at source

### Outputs

- **Total Income**: Sum of all income before deductions
- **Taxable Income**: Total income + dividend gross-up + taxable capital gains - deductions
- **Federal Tax**: Federal income tax after credits
- **Provincial/Territorial Tax**: Provincial tax after credits, surtaxes, and premiums
- **CPP (Employee)**: Canada Pension Plan contribution
- **EI (Employee)**: Employment Insurance premium
- **Total Burden**: Income tax + CPP + EI
- **After-Tax Income**: Income - income tax only
- **Take-Home After Payroll**: Income - income tax - CPP - EI
- **Average Tax Rate**: Total income tax / total income
- **Marginal Tax Rate**: Combined federal + provincial marginal rate
- **Refund / Balance Owing**: Tax paid - total income tax (positive = refund, negative = owing)

### Show the Math

Expandable sections provide detailed breakdowns:

- **Federal Tax Calculation**: Brackets, base tax, credits applied, net tax
- **Provincial/Territorial Tax Calculation**: Brackets, base tax, credits, surtaxes, premiums, net tax
- **Dividend Gross-Up and Tax Credits**: Gross-up amounts and DTC calculations
- **Capital Gains Inclusion**: Inclusion rate and taxable amount
- **CPP and EI Calculations**: Pensionable/insurable earnings and contribution calculations

## Architecture

### Engine Module (`tax.engine.js`)

Pure calculation logic with no DOM dependencies. Exports `computePersonalTax(input, data)` which returns a complete result object.

**Input object:**
```javascript
{
  year: 2025,
  province: 'ON',
  employmentIncome: 75000,
  selfEmploymentIncome: 0,
  otherIncome: 0,
  eligibleDividends: 0,
  nonEligibleDividends: 0,
  capitalGains: 0,
  rrspDeduction: 0,
  fhsaDeduction: 0,
  taxPaid: 0
}
```

**Result object:**
```javascript
{
  totals: {
    totalIncome, taxableIncome, federalTax, provTax,
    cpp, ei, totalIncomeTax, totalBurden,
    afterTaxIncome, takeHomeAfterPayroll,
    avgRate, marginalRate, refundOrOwing
  },
  breakdown: {
    federal: { bracketLines, baseTax, credits, netTax },
    provincial: { bracketLines, baseTax, credits, surtaxes, premiums, netTax },
    dividends: { ... },
    capitalGains: { ... },
    payroll: { ... }
  }
}
```

### UI Module (`tax.ui.js`)

Handles DOM interactions, input validation, calls the engine, and renders results. Exports `initUI()` to initialize the calculator.

### Data Module (`tax.data.js`)

Loads and normalizes JSON tax data files. Provides accessor functions for federal, provincial, payroll, and dividend data.

## Data Files

### Federal Data (`data/2025/federal.json`)

Contains:
- Tax brackets (threshold, rate)
- Credits (basic personal amount, Canada employment amount, CPP/EI credit)

### Provincial Data (`data/2025/provinces.json`)

Contains for each province/territory:
- Tax brackets
- Credits (basic personal amount)
- Surtaxes (e.g., Ontario surtax)
- Premiums (e.g., Ontario health premium)

### Payroll Data (`data/2025/payroll.json`)

Contains:
- CPP: rate, basic exemption, max pensionable earnings, max contribution
- EI: rate, max insurable earnings, max premium

### Dividends Data (`data/2025/dividends.json`)

Contains:
- Eligible dividends: gross-up rate, federal DTC, provincial DTC rates
- Non-eligible dividends: gross-up rate, federal DTC, provincial DTC rates

## Important Notes

### Data Accuracy

⚠️ **IMPORTANT: Verify all tax data against official sources.**

**Preferred Data Sources:**
- **Canada Revenue Agency (CRA)**: https://www.canada.ca/en/revenue-agency
- Official CRA tax tables and rate schedules for 2025
- Provincial/territorial tax authority websites

**Calculation Precision:**
- All calculations maintain **full precision** throughout (no upstream rounding)
- Final display is rounded to 2 decimal places for currency
- This ensures accuracy and prevents rounding errors from accumulating

**Key Calculation Notes:**
- **Basic Personal Amount (BPA) credit** = BPA amount × lowest tax rate (15% federal, varies by province)
- **Canada Employment Amount credit** = $1,500 × lowest tax rate (15% federal)
- **Dividend Tax Credits** are applied as non-refundable credits against tax payable
- **CPP/EI** calculated with exact rates and maximums (no rounding until final display)

**Data Verification Checklist:**
1. Federal tax brackets (indexed for 2025)
2. Provincial/territorial tax brackets (indexed for 2025)
3. Basic Personal Amounts (federal and provincial, indexed for 2025)
4. CPP/EI rates and maximums for 2025
5. Dividend gross-up rates and DTC percentages for 2025
6. Provincial surtaxes and premiums (e.g., Ontario surtax and health premium)

The calculator structure is correct, but **you must verify all numeric values** against official 2025 sources before using for any purpose beyond education.

### What's Included

- Federal and provincial income tax brackets
- Basic personal amount credits
- Canada employment amount credit
- CPP/EI credit
- Dividend gross-up and tax credits
- Capital gains inclusion (50%)
- Ontario surtax and health premium (as examples)
- CPP and EI on employment income

### What's NOT Included (v1)

- Medical expenses credit
- Tuition and education credits
- Charitable donation credits
- Spousal/common-law partner credits
- Age amount credit
- Disability tax credit
- Other specialized credits
- Self-employment CPP (employee CPP only)
- Quebec-specific calculations (simplified)
- Tax reduction for low-income individuals
- Alternative minimum tax
- **BPA phase-down at high incomes**: Federal BPA phases down for incomes above $173,205 (2025). This calculator uses a fixed BPA amount, which may cause divergence at very high income levels.

## Testing

Run tests by opening `tests/test.html` in a browser. The test suite includes:

- Taxable income floor at 0
- Basic tax calculations
- Marginal rate finite difference verification
- Dividend gross-up calculations
- Capital gains inclusion
- Refund/owing sign convention
- CPP/EI calculations
- Ontario surtax and premium calculations

## Adding a New Tax Year

To add support for a new tax year (e.g., 2026):

1. Copy the `data/2025/` directory to `data/2026/`
2. Update all JSON files with 2026 tax parameters
3. Add the year option to the year dropdown in `index.html`
4. Update the default year in `tax.ui.js` if needed

The engine is designed to work with any year's data as long as the JSON schema remains consistent.

## Browser Compatibility

Requires a modern browser with ES6 module support:
- Chrome 61+
- Firefox 60+
- Safari 11+
- Edge 16+

## License

This calculator is provided for educational purposes only. Not tax advice.

## Disclaimer

**Educational arithmetic. Not tax advice.**

This calculator is a tool for understanding how Canadian income tax calculations work. It does not account for all tax credits, deductions, or special circumstances. Always consult a qualified tax professional or the Canada Revenue Agency for actual tax filing.
