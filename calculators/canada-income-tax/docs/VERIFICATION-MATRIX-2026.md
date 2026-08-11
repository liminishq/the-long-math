# 2026 Canada-wide tax-data verification matrix

**Audit date:** 2026-08-11  
**Primary sources:** CRA T4032 payroll tables (Jan/July 2026 as applicable); CRA indexation table; CRA Forms NL428 / NB428 / NS428 (2025 package, with noted 2026 indexation); BC Budget / gov.bc.ca personal tax rates and basic credits; NL Finance LITR page; Finances Québec *Parameters of the Personal Income Tax System for 2026*; NL T4008-NL July 2026; PE T4032-PE July 2026.

A **PASS** means brackets, rates, BPA (and special mechanisms listed) were checked against those official sources for the annual tax return path this engine models, not merely that automated tests pass.

Payroll mid-year **proration** rates (e.g. BC July 6.14%, PE July 21%) are withholding artifacts and are **not** used in annual return calculations. The engine stores the legislated annual rates.

| Jurisdiction | Brackets | Rates | BPA | Indexation | Special mechanisms | Result |
| ------------ | -------- | ----- | --- | ---------- | ------------------ | ------ |
| Federal | Verified ($58,523 / $117,045 / $181,440 / $258,482) | Verified (14 / 20.5 / 26 / 29 / 33) | Verified max $16,452 / min $14,829; phase-out 29%→33% starts | Verified 2.0% (2026) | Enhanced BPA phase-out; CEA $1,501 | **PASS** |
| AB | Verified | Verified | Verified $22,769 | Indexed 2.0% | AB supplemental credit **not modeled** (needs facts outside basic employment path) | **PASS** |
| BC | Verified | Verified (lowest **5.60%** annual; Jan T4032 showed 5.06% pre-Budget) | Verified $13,216 | Indexed 2.2% in 2026; Budget pause **brackets + basic personal tax credits + tax reduction params** 2027–2030 in projection | **B.C. tax reduction modeled** ($690 / $25,570 / 3.56% → $44,952) | **PASS** |
| MB | Verified ($47k / $100k) | Verified | Verified $15,780 | Frozen (T4032-MB: not indexed for 2025+) | — | **PASS** |
| NB | Verified | Verified | Verified $13,664 | Indexed | **LITR modeled** (single-filer; 2026 params indexed from Form NB428 2025) | **PASS** |
| NL | Verified | Verified | Verified **$13,094** (was $11,188; see note) | Indexed 1.1% then BPA increased | **LITR modeled** (single-filer; 2026 params indexed from Form NL428 2025 / gov.nl.ca) | **PASS** |
| NS | Verified | Verified | Verified $11,932 | Indexed 1.6% | **LITR modeled** (single-filer; Form NS428 2025 $300 / $15,000 / 5% carried for 2026 pending Form NS428 2026) | **PASS** |
| NT | Verified | Verified | Verified $18,198 | Indexed | — | **PASS** |
| NU | Verified | Verified | Verified $19,659 | Indexed | — | **PASS** |
| ON | Verified | Verified | Verified $12,989 | Indexed **1.9%** (not federal 2.0%) | Surtax $5,818 / $7,446; OTR basic $300; OHP statutory | **PASS** |
| PE | Verified (incl. $142,520 / $200,000) | Verified (top annual **20%**; July payroll 21% prorated) | Verified $15,000 floor | BPA fixed at $15k in projection | New $200k bracket (2026) | **PASS** |
| QC | Verified Finances Québec 2026 parameters (brackets + BPA $18,952) | Verified (14 / 19 / 24 / 25.75) | Verified $18,952 | Indexed 2.05% (RQ / Finances Québec) | **Not a full TP-1 annual-return audit:** no QPP/QPIP path, no federal QC abatement, employment still uses federal Schedule 8 | **LIMITED** |
| SK | Verified | Verified | Verified $20,381 | Indexed + Affordability Act | SLITC is refundable benefit (out of scope) | **PASS** |
| YT | Verified (aligned to federal thresholds) | Verified | Verified enhanced max/min mirrors federal | Indexed | Territorial enhanced BPA phase-out modeled | **PASS** |

## Income-driven provincial tax reductions (employment-path audit)

Mechanisms that require **no extra user facts** beyond income/deductions under single-filer assumptions are modeled. Family add-ons stay out of scope.

| Province | Mechanism | Modeled? | Source / note |
| -------- | --------- | -------- | ------------- |
| BC | Tax reduction credit | Yes | [gov.bc.ca basic credits](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/credits/basic) 2026 |
| ON | Ontario Tax Reduction (basic) | Yes | CRA T4032-ON / ON428 |
| NL | Low Income Tax Reduction | Yes (single-filer) | Form NL428 2025; [gov.nl.ca LITR](https://www.gov.nl.ca/fin/tax-programs-incentives/personal/lowincometaxreduction/); indexed annually |
| NB | Low-income tax reduction | Yes (single-filer) | Form NB428 2025 |
| NS | Low-income tax reduction | Yes (single-filer) | Form NS428 2025 |
| AB | Supplemental amount | No | Cannot activate under basic employment-only assumptions without extra credits/facts |
| SK | Low-Income Tax Credit (SLITC) | No | Refundable benefit, not a Form 428 tax reduction |
| MB | Personal / affordability credits (MB479) | No | Refundable / housing facts required |
| Others | — | No standard income-only Form 428 reduction identified beyond brackets/BPA | — |

## B.C. projection freeze (confirmed)

| Field | 2027–2030 projection behaviour | Source |
| ----- | ------------------------------ | ------ |
| Bracket thresholds | Frozen at 2026 levels | [gov.bc.ca tax rates](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/tax-rates) — Budget 2026 pause |
| Basic personal amount (and other indexed basic personal tax credits in engine) | Frozen at 2026 levels | [gov.bc.ca basic credits](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/credits/basic) — Budget 2026 pause |
| Tax reduction base / net-income threshold / maximum net income | Frozen at 2026 levels | Same page: credit indexed, but pause for 2027–2030; base held $690 for 2026–2030 |

## Newfoundland and Labrador BPA correction

| Field | Value |
| ----- | ----- |
| Tax year | 2026 |
| Previous engine value | $11,188 (January T4032-NL pre-announcement) |
| Correct annual credit | **$13,094** |
| Authoritative source | CRA T4008-NL July 2026: NL announced increase from $11,188 to $13,094 effective 1 Jan 2026 |
| Not used | Mid-year withholding proration $15,000 |

## Ontario surtax correction (earlier pass)

| Field | Value |
| ----- | ----- |
| Previous incorrect values | Federal-indexed surtax thresholds |
| Correct 2026 values | $5,818 (20%) and $7,446 (+36%) |
| Source | CRA T4032-ON 2026 |

## Quebec substantiation (not PASS\* on “JSON has values”)

| Check | Status | Source |
| ----- | ------ | ------ |
| 2026 brackets $54,345 / $108,680 / $132,245 | In engine; matches Finances Québec parameters | [Parameters of the Personal Income Tax System for 2026](https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTEN_IncomeTax2026.pdf) |
| BPA $18,952 at 14% | In engine | Same |
| Indexation 2.05% | Documented | Québec.ca indexation announcement |
| Full TP-1 / QPP / QPIP / federal abatement tracing | **Not claimed** | Out of scope for v1; UI warns QC is not form-verified |

## Source links (official)

- [CRA indexation table](https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html)
- [CRA T4032 tables hub](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables.html)
- [BC personal tax rates](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/tax-rates)
- [BC basic personal tax credits / tax reduction](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/credits/basic)
- [BC Budget tax updates](https://www2.gov.bc.ca/gov/content/taxes/tax-updates/budget-changes)
- [NL Low Income Tax Reduction](https://www.gov.nl.ca/fin/tax-programs-incentives/personal/lowincometaxreduction/)
- [Finances Québec 2026 tax parameters](https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTEN_IncomeTax2026.pdf)
