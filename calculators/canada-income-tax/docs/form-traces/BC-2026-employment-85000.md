# Form trace: BC 2026 — $85,000 employment only

**Purpose:** Golden reference for engine and tests. Unrounded amounts unless a form line requires rounding.  
**Status:** **Superseded** — use `BC-employment-85000-2025-vs-2026.md` (corrects 2026 BC 5.60% bracket/credits). This file kept for history.  
**Sources:** CRA CPP rates/maximums 2026; federal indexation 2026; BC 2026 brackets/BPA in `data/2026/` (to be cross-checked against BC428 / T4127 when published for 2026).

## Inputs

| Input | Value |
|-------|------:|
| Province | British Columbia |
| Tax year | 2026 |
| Employment income | $85,000 |
| Self-employment | $0 |
| Other income | $0 |
| Dividends / capital gains | $0 |
| RRSP, FHSA, other deductions | $0 |

## Constants (2026)

| Item | Value | Source |
|------|------:|--------|
| YMPE | $74,600 | CRA CPP contribution rates and maximums |
| YAMPE | $85,000 | YMPE + $10,400 additional maximum |
| CPP basic exemption | $3,500 | CRA |
| CPP base employee rate | 4.95% | Line 30800 / Schedule 8 base portion |
| CPP first additional rate | 1.00% | Line 22215 first additional |
| CPP2 rate | 4.00% | Earnings YMPE–YAMPE |
| Max insurable earnings (EI) | $68,900 | CRA EI maximums (non-QC) |
| EI employee rate | 1.63% | CRA |
| Federal BPA | $16,452 | CRA indexation |
| Federal CEA (max) | $1,501 | CRA indexation |
| Federal credit rate | 14% | Lowest federal bracket 2026 |
| BC BPA | $13,216 | `provinces.json` 2026 BC |
| BC credit rate | 5.06% | Lowest BC bracket |

---

## Part 1 — Schedule 8 (employment CPP), simplified v1 case

*Single employer, full year, not Quebec, not working beneficiary.*

| Step | Form / line | Calculation | Unrounded $ |
|------|-------------|-------------|------------:|
| 1 | Pensionable earnings | min($85,000, YMPE) − $3,500 = $71,100 | 71,100.00 |
| 2 | Base CPP (→ line **30800** credit base) | $71,100 × 4.95% | **3,519.45** |
| 3 | First additional CPP (→ line **22215**) | $71,100 × 1.00% | **711.00** |
| 4 | Additional earnings (CPP2) | min($85,000, YAMPE) − YMPE = $10,400 | 10,400.00 |
| 5 | CPP2 (→ line **22215**) | $10,400 × 4.00% | **416.00** |
| 6 | Total employee CPP | 3,519.45 + 711.00 + 416.00 | **4,646.45** |
| 7 | **Line 22215** deduction | 711.00 + 416.00 | **1,127.00** |
| 8 | **Line 30800** credit base | Step 2 | **3,519.45** |

## Part 2 — EI (employee, non-Quebec)

| Step | Item | Calculation | Unrounded $ |
|------|------|-------------|------------:|
| 9 | Insurable earnings | min($85,000, $68,900) | 68,900.00 |
| 10 | EI premium | $68,900 × 1.63% | **1,123.07** |

*EI is not deducted from net income; it feeds the non-refundable credit only.*

---

## Part 3 — Net income and taxable income (T1)

| Step | Line / concept | Calculation | Unrounded $ |
|------|----------------|-------------|------------:|
| 11 | Total income (employment) | | 85,000.00 |
| 12 | Deduction: enhanced CPP | Line 22215 | (1,127.00) |
| 13 | **Net income** | 85,000 − 1,127 | **83,873.00** |
| 14 | **Taxable income** | No further adjustments modeled | **83,873.00** |

---

## Part 4 — Federal tax (Schedule 1)

### Part I — Tax on taxable income

Bracket tax (Schedule 1 style: tax each bracket, **round each bracket to nearest dollar**, then sum):

| Bracket | Income in bracket | Rate | Tax (unrounded) | Rounded $ |
|---------|------------------:|-----:|----------------:|----------:|
| 1 | $58,523 | 14% | 8,193.22 | **8,193** |
| 2 | $25,350 ($83,873 − $58,523) | 20.5% | 5,196.75 | **5,197** |
| | | **Base tax (Part I)** | | **13,390** |

### Part B — Non-refundable credits (lowest rate 14%)

| Credit | Base | × 14% | Credit $ |
|--------|-----:|------:|---------:|
| Basic personal amount | 16,452.00 | 0.14 | 2,303.28 |
| Canada employment amount | 1,501.00 | 0.14 | 210.14 |
| CPP (base only) | 3,519.45 | 0.14 | 492.723 |
| EI | 1,123.07 | 0.14 | 157.230 |
| **Total credits** | | | **3,163.373** |

| Step | | Unrounded $ |
|------|--|------------:|
| 15 | Net federal tax before rounding | 13,390 − 3,163.373 = **10,226.627** |
| 16 | **Display federal income tax** | round(10,226.627) = **10,227** |

---

## Part 5 — British Columbia tax (BC428)

### Provincial tax on taxable income

| Bracket | Income in bracket | Rate | Tax (unrounded) | Rounded $ |
|---------|------------------:|-----:|----------------:|----------:|
| 1 | $50,363 | 5.06% | 2,548.37 | **2,548** |
| 2 | $33,510 ($83,873 − $50,363) | 7.7% | 2,580.27 | **2,580** |
| | **Base provincial tax** | | | **5,128** |

### Non-refundable credits (lowest rate 5.06%)

| Credit | Base | × 5.06% | Credit $ |
|--------|-----:|--------:|---------:|
| BC basic personal amount | 13,216.00 | 0.0506 | 668.730 |
| CPP (base only) — line **58240** | 3,519.45 | 0.0506 | 178.084 |
| EI — line **58240** | 1,123.07 | 0.0506 | 56.827 |
| **Total provincial credits** | | | **903.641** |

| Step | | Unrounded $ |
|------|--|------------:|
| 17 | Net BC tax before rounding | 5,128 − 903.641 = **4,224.359** |
| 18 | **Display BC income tax** | round(4,224.359) = **4,224** |

---

## Part 6 — Summary (this scenario)

| Output | Unrounded | Display ($) |
|--------|----------:|--------------:|
| Taxable income | 83,873.00 | 83,873 |
| Federal income tax | 10,226.627 | **10,227** |
| BC income tax | 4,224.359 | **4,224** |
| **Total income tax** | 14,451.986 | **14,451** (= 10,227 + 4,224) |
| Employee CPP (cash) | 4,646.45 | 4,646 |
| EI (cash) | 1,123.07 | 1,123 |
| Total burden (tax + CPP + EI) | 20,221.46 | **20,221** (if each component rounded for display: define in UI spec) |

### Credit / deduction bases (audit)

| Item | Amount |
|------|-------:|
| CPP creditable (30800) | 3,519.45 |
| CPP deductible (22215) | 1,127.00 |
| CPP2 portion of 22215 | 416.00 |
| EI credit base | 1,123.07 |

---

## Reviewer comparison (~$10,227 federal, ~$4,400 BC)

| Item | This trace | External ~$4,400 BC |
|------|------------|----------------------|
| Federal | **10,227** display | ~10,227 — match |
| BC | **4,224** display (includes 58240 CPP/EI) | ~4,400 — likely BPA-only or different rounding |

---

## Engine acceptance criteria (after your approval)

When this trace is signed off, automated tests for this scenario must assert:

- `taxableIncome === 83873`
- `cppCreditable === 3519.45`, `cppDeductible === 1127`, `cpp2 === 416`, `cpp === 4646.45`, `ei === 1123.07`
- Unrounded federal net tax ≈ **10226.627** (tolerance 0)
- Unrounded provincial net tax ≈ **4224.359** (tolerance 0)
- Display: federal **10227**, prov **4224**, total **14451**

---

## Author sign-off

- [ ] Constants verified against 2026 CRA / BC publications  
- [ ] Bracket rounding matches Schedule 1 / BC428 instructions for this year  
- [ ] Approved to implement / lock tests  

**Reviewer:** _______________ **Date:** _______________
