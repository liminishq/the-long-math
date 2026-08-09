# 2026 Canada-wide tax-data verification matrix

**Audit date:** 2026-08-09  
**Primary sources:** CRA T4032 payroll tables (Jan/July 2026 as applicable); CRA indexation table; BC Budget / gov.bc.ca personal tax rates; NL T4008-NL July 2026; PE T4032-PE July 2026.

A **PASS** means brackets, rates, BPA (and special mechanisms listed) were checked against those official sources for the annual tax return, not merely that automated tests pass.

Payroll mid-year **proration** rates (e.g. BC July 6.14%, PE July 21%) are withholding artifacts and are **not** used in annual return calculations. The engine stores the legislated annual rates.

| Jurisdiction | Brackets | Rates | BPA | Indexation | Special mechanisms | Result |
| ------------ | -------- | ----- | --- | ---------- | ------------------ | ------ |
| Federal | Verified ($58,523 / $117,045 / $181,440 / $258,482) | Verified (14 / 20.5 / 26 / 29 / 33) | Verified max $16,452 / min $14,829; phase-out 29%→33% starts | Verified 2.0% (2026) | Enhanced BPA phase-out; CEA $1,501 | **PASS** |
| AB | Verified | Verified | Verified $22,769 | Indexed 2.0% | AB supplemental credit **not modeled** | **PASS*** |
| BC | Verified | Verified (lowest **5.60%** annual; Jan T4032 showed 5.06% pre-Budget) | Verified $13,216 | Indexed 2.2% in 2026; Budget pause 2027–2030 in projection | BC tax reduction **not modeled** | **PASS*** |
| MB | Verified ($47k / $100k) | Verified | Verified $15,780 | Frozen (T4032-MB: not indexed for 2025+) | — | **PASS** |
| NB | Verified | Verified | Verified $13,664 | Indexed | — | **PASS** |
| NL | Verified | Verified | Verified **$13,094** (was $11,188; see note) | Indexed 1.1% then BPA increased | July withholding BPA $15,000 is proration only | **PASS** |
| NS | Verified | Verified | Verified $11,932 | Indexed | — | **PASS** |
| NT | Verified | Verified | Verified $18,198 | Indexed | — | **PASS** |
| NU | Verified | Verified | Verified $19,659 | Indexed | — | **PASS** |
| ON | Verified | Verified | Verified $12,989 | Indexed **1.9%** (not federal 2.0%) | Surtax $5,818 / $7,446; OTR basic $300; OHP statutory | **PASS** |
| PE | Verified (incl. $142,520 / $200,000) | Verified (top annual **20%**; July payroll 21% prorated) | Verified $15,000 floor | BPA fixed at $15k in projection | New $200k bracket (2026) | **PASS** |
| QC | Verified Revenu Québec parameters in JSON | Verified | Verified $18,952 | Indexed (RQ) | QPP/QPIP path limited; not form-traced to federal Schedule 8 | **PASS*** |
| SK | Verified | Verified | Verified $20,381 | Indexed + Affordability Act | — | **PASS** |
| YT | Verified (aligned to federal thresholds) | Verified | Verified enhanced max/min mirrors federal | Indexed | Territorial enhanced BPA phase-out modeled | **PASS** |

\*PASS with documented engine limitations (see Remaining limitations in the audit report).

## Newfoundland and Labrador BPA correction

| Field | Value |
| ----- | ----- |
| Tax year | 2026 |
| Previous engine value | $11,188 (January T4032-NL pre-announcement) |
| Correct annual credit | **$13,094** |
| Authoritative source | CRA T4008-NL July 2026: NL announced increase from $11,188 to $13,094 effective 1 Jan 2026 |
| Not used | Mid-year withholding proration $15,000 |
| Tests affected | Provincial data asserts; any NL golden/employment vectors using BPA |

## Ontario surtax correction (earlier pass)

| Field | Value |
| ----- | ----- |
| Previous incorrect values | Federal-indexed surtax thresholds |
| Correct 2026 values | $5,818 (20%) and $7,446 (+36%) |
| Source | CRA T4032-ON 2026 |

## Source links (official)

- [CRA indexation table](https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html)
- [CRA T4032 tables hub](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables.html)
- [BC personal tax rates](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/tax-rates)
- [BC Budget tax updates](https://www2.gov.bc.ca/gov/content/taxes/tax-updates/budget-changes)
