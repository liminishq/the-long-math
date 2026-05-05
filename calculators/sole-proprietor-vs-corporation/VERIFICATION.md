# Sole Proprietor vs Corporation Calculator — verification notes

Manual QA in a browser (local or deployed): open `/calculators/sole-proprietor-vs-corporation/` with devtools closed (no console errors after inputs).

## Automated / reasoning checks

### Corporate tax blend

For Ontario 2025, federal SBD 9% + Ontario SBD 3.2% = **12.2%** on income in the small-business pool (`$500,000` federal limit). Income above that uses general federal + Ontario rates in `spvc-engine.js`.

### Ledger (no double-count)

- RRSP refund = `personalTaxWithoutRRSP − personalTaxWithRRSP` (income tax only).
- Wallet after RRSP uses `takeHomeAfterPayroll − rrspContribution` where take-home reflects the RRSP deduction (refund **not** in take-home).
- Non-registered surplus = max(0, wallet − spending); refund reinvestment is separate when toggled on.

## Scenario expectations (directional)

1. **Ontario, income $90,000, spending $70,000, RRSP room $10,000**, dividend withdrawal, defaults on: personal path typically shows **more** first-year invested capital than retained corporate surplus (RRSP deduction + refund vs small retained pool).
2. **Ontario, income $450,000, spending $240,000, RRSP room ~$31,000–32,490**, defaults: **corporation** often shows **more** retained investable capital (RRSP room capped; high marginal rates on personal surplus).
3. **Income equals spending need** (e.g. $100k income, $100k spending, minimal RRSP): both sides show **little** surplus beyond RRSP mechanics / thin corporate retention.
4. **RRSP room = 0**: personal path loses RRSP refund advantage; corporation path unchanged by RRSP.

## Corp infeasibility

If after-tax corporate cash cannot fund the stated after-tax spending via the chosen withdrawal mode, the UI shows a **corporate shortfall** warning and may show `$0` retained capital.

## Files

- Engine: `spvc-engine.js` (imports `computePersonalTax`, `loadTaxData`; corporate JSON from `/calculators/ccpc-tax/data/`)
- UI: `spvc-ui.js`, `spvc-calculator.css`, `index.html`
- Methodology: `inspect-the-arithmetic/index.html`
