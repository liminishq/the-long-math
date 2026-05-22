# Form trace: BC — $85,000 employment only — 2025 vs 2026

**Status:** Corrected reference (May 2026). Supersedes incorrect 5.06% BC bracket math for **2026**.  
**Sources:** [BC personal tax rates](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/tax-rates); [BC basic credits](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/credits/basic); CRA CPP/EI maximums; CRA federal rates/indexation; CRA lines 30800 / 22215.

**v1 exclusions:** Quebec; self-employment CPP; multi-employer; BC tax reduction only when net income below threshold (not applicable at $85k).

---

## Executive summary — what was wrong

| Issue | Our draft / `provinces.json` 2026 BC | Correct 2026 |
|--------|--------------------------------------|--------------|
| BC 1st bracket **rate** | 5.06% | **5.60%** (Budget 2026) |
| BC non-refundable **credit rate** | 5.06% | **5.60%** (lowest provincial rate) |
| BC bracket **thresholds** 2026 | $50,363 / … | Same — thresholds were already right |
| Line 22215 deduction | $1,127 (1st add + CPP2) | **Correct** — do not use “CPP2 only $416” |
| Federal 2026 credits | 14% on BPA/CEA/base CPP/EI | **Correct** if first bracket 14% |
| `payroll.json` 2025 `cpp2.maxAdditionalEarnings` | 73,000 (wrong band) | **9,900** (= YAMPE $81,200 − YMPE $71,300) |

**Display rule (locked):** Round federal and provincial net tax separately; displayed total = sum of rounded parts.

---

## Side-by-side constants

| Constant | 2025 | 2026 |
|----------|-----:|-----:|
| Employment income | $85,000 | $85,000 |
| CPP YMPE | $71,300 | $74,600 |
| CPP YAMPE | $81,200 | $85,000 |
| CPP basic exemption | $3,500 | $3,500 |
| Max pensionable (YMPE − exempt) | $67,800 | $71,100 |
| CPP base rate (credit, line 30800) | 4.95% | 4.95% |
| CPP first additional (deduct, line 22215) | 1.00% | 1.00% |
| CPP combined rate on YMPE band | 5.95% | 5.95% |
| Max employee CPP1 | $4,034.10 | $4,230.45 |
| CPP2 rate | 4.00% | 4.00% |
| CPP2 earnings band width | $9,900 | $10,400 |
| Max CPP2 | $396.00 | $416.00 |
| EI max insurable | $65,700 | $68,900 |
| EI employee rate | 1.64% | 1.63% |
| Max EI premium | $1,077.48 | $1,123.07 |
| Federal 1st bracket / credit rate | 14.5% bracket / **15%** credits | **14%** bracket / **14%** credits |
| Federal BPA | $16,129 | $16,452 |
| Federal CEA max | $1,471 | $1,501 |
| BC 1st bracket rate | **5.06%** | **5.60%** |
| BC 1st bracket ceiling | $49,279 | $50,363 |
| BC 2nd bracket ceiling | $98,560 | $100,728 |
| BC BPA | $12,932 | $13,216 |
| BC credit rate (= lowest rate) | 5.06% | **5.60%** |

---

## Part A — CPP / EI (both years)

### 2025

| Line | Calculation | $ |
|------|-------------|---:|
| Pensionable to YMPE | $71,300 − $3,500 | 67,800.00 |
| Base CPP (30800 credit) | $67,800 × 4.95% | **3,356.10** |
| First additional (22215) | $67,800 × 1.00% | **678.00** |
| CPP1 total | | **4,034.10** |
| CPP2 earnings | min($85,000, $81,200) − $71,300 = $9,900 | 9,900.00 |
| CPP2 (22215) | $9,900 × 4.00% | **396.00** |
| **Total employee CPP** | $4,034.10 + $396.00 | **4,430.10** |
| **Line 22215 deduction** | $678.00 + $396.00 | **1,074.00** |
| EI | $65,700 × 1.64% | **1,077.48** |

### 2026

| Line | Calculation | $ |
|------|-------------|---:|
| Pensionable to YMPE | $74,600 − $3,500 | 71,100.00 |
| Base CPP (30800 credit) | $71,100 × 4.95% | **3,519.45** |
| First additional (22215) | $71,100 × 1.00% | **711.00** |
| CPP1 total | | **4,230.45** |
| CPP2 earnings | $85,000 − $74,600 | 10,400.00 |
| CPP2 (22215) | $10,400 × 4.00% | **416.00** |
| **Total employee CPP** | $4,230.45 + $416.00 | **4,646.45** |
| **Line 22215 deduction** | $711.00 + $416.00 | **1,127.00** |
| EI | $68,900 × 1.63% | **1,123.07** |

**Note on “first additional”:** It is not extra cash on top of $4,230.45 — it is the **deductible portion inside** the $4,230.45 CPP1 package. Total cash = $4,230.45 + CPP2.

---

## Part B — Net / taxable income

| | 2025 | 2026 |
|--|-----:|-----:|
| Employment income | 85,000.00 | 85,000.00 |
| Less line 22215 | (1,074.00) | (1,127.00) |
| **Net income / taxable income** | **83,926.00** | **83,873.00** |

---

## Part C — Federal tax (Schedule 1)

Bracket tax: compute each bracket, **round each bracket to $1**, then sum.

### 2025 — TI $83,926

| Bracket | Income | Rate | Unrounded | Rounded |
|---------|-------:|-----:|----------:|--------:|
| 1 | $57,375 | 14.5% | 8,319.375 | **8,319** |
| 2 | $26,551 | 20.5% | 5,442.955 | **5,443** |
| **Base tax** | | | | **13,762** |

Non-refundable credits at **15%** (2025 statutory credit rate):

| Credit | Base | × 15% | Credit |
|--------|-----:|------:|-------:|
| BPA | 16,129.00 | 0.15 | 2,419.35 |
| CEA | 1,471.00 | 0.15 | 220.65 |
| CPP (base) | 3,356.10 | 0.15 | 503.415 |
| EI | 1,077.48 | 0.15 | 161.622 |
| **Total** | | | **3,305.037** |

| | $ |
|--|---:|
| Net federal (unrounded) | 13,762 − 3,305.037 = **10,456.963** |
| **Display federal** | **10,457** |

### 2026 — TI $83,873

| Bracket | Income | Rate | Unrounded | Rounded |
|---------|-------:|-----:|----------:|--------:|
| 1 | $58,523 | 14.0% | 8,193.22 | **8,193** |
| 2 | $25,350 | 20.5% | 5,196.75 | **5,197** |
| **Base tax** | | | | **13,390** |

Credits at **14%**:

| Credit | Base | × 14% | Credit |
|--------|-----:|------:|-------:|
| BPA | 16,452.00 | 0.14 | 2,303.28 |
| CEA | 1,501.00 | 0.14 | 210.14 |
| CPP (base) | 3,519.45 | 0.14 | 492.723 |
| EI | 1,123.07 | 0.14 | 157.230 |
| **Total** | | | **3,163.373** |

| | $ |
|--|---:|
| Net federal (unrounded) | 13,390 − 3,163.373 = **10,226.627** |
| **Display federal** | **10,227** |

---

## Part D — BC tax (BC428)

### 2025 — TI $83,926 — rate **5.06%** / **7.70%**

| Bracket | Income | Rate | Unrounded | Rounded |
|---------|-------:|-----:|----------:|--------:|
| 1 | $49,279 | 5.06% | 2,493.517 | **2,494** |
| 2 | $34,647 | 7.70% | 2,667.819 | **2,668** |
| **Base BC tax** | | | | **5,162** |

Credits at **5.06%** (2025 lowest rate):

| Credit | Base | × 5.06% | Credit |
|--------|-----:|--------:|-------:|
| BPA | 12,932.00 | 0.0506 | 654.359 |
| CPP (base) | 3,356.10 | 0.0506 | 169.819 |
| EI | 1,077.48 | 0.0506 | 54.520 |
| **Total** | | | **878.698** |

| | $ |
|--|---:|
| Net BC (unrounded) | 5,162 − 878.698 = **4,283.302** |
| **Display BC** | **4,283** |

BC tax reduction 2025: net income $83,926 ≫ threshold — **$0**.

### 2026 — TI $83,873 — rate **5.60%** / **7.70%** (corrected)

| Bracket | Income | Rate | Unrounded | Rounded |
|---------|-------:|-----:|----------:|--------:|
| 1 | $50,363 | **5.60%** | 2,820.328 | **2,820** |
| 2 | $33,510 | 7.70% | 2,580.270 | **2,580** |
| **Base BC tax** | | | | **5,400** |

Credits at **5.60%** (2026 lowest rate):

| Credit | Base | × 5.60% | Credit |
|--------|-----:|--------:|-------:|
| BPA | 13,216.00 | 0.0560 | 740.096 |
| CPP (base) | 3,519.45 | 0.0560 | 197.089 |
| EI | 1,123.07 | 0.0560 | 62.892 |
| **Total** | | | **1,000.077** |

| | $ |
|--|---:|
| Net BC (unrounded) | 5,400 − 1,000.077 = **4,399.923** |
| **Display BC** | **4,400** |

BC tax reduction 2026: net income $83,873 ≫ $44,952 max — **$0**.

---

## Part E — Totals (display)

| Output | 2025 | 2026 |
|--------|-----:|-----:|
| Taxable income | 83,926 | 83,873 |
| Federal income tax (display) | **10,457** | **10,227** |
| BC income tax (display) | **4,283** | **4,400** |
| **Total income tax (display)** | **14,740** | **14,627** |
| Employee CPP | 4,430.10 | 4,646.45 |
| EI | 1,077.48 | 1,123.07 |
| Total burden (tax + CPP + EI, unrounded sum) | 20,247.58 | 20,396.52 |

---

## Reconciling external feedback

| Claim | Verdict |
|-------|---------|
| 2026 BC first bracket is 5.60%, not 5.06% | **Correct** — [BC tax rates](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/personal/tax-rates) |
| 2026 BC tax ~$4,400 at this income | **Correct** with 5.60% brackets + credits |
| Our trace BC $4,224 used wrong 5.06% | **Correct criticism** |
| Deduct only CPP2 ($416), not $1,127 | **Incorrect** — CRA line 22215 max = first additional + second additional |
| 2025 deductible only $396 | **Incorrect** — 2025 line 22215 = $678 + $396 = **$1,074** at this income |
| Federal 14% for 2026 | **Correct** for brackets and credits in this scenario |
| Federal 2025 credits at 15% | **Correct** (statutory credit rate; bracket 14.5% is separate) |
| BC “tax reduction” changes 2026 result at $85k | **No** — income too high for reduction credit |

---

## Engine / data fixes required (when coding resumes)

1. **`data/2026/provinces.json` BC:** Change first bracket rate `0.0506` → `0.056`; set `basicPersonalAmount.rate` and `cppEiCredit.rate` to `0.056`.
2. **`data/2025/payroll.json`:** Fix `cpp2.maxAdditionalEarnings` to **9900** (not 73000).
3. **Tests:** Lock 2026 BC display **4400**, total tax **14627**; 2025 BC **4283**, total **14740**.
4. **Optional v2:** BC tax reduction credit (not material at $85k employment-only).

---

## Sign-off

- [ ] Author confirms BC 5.60% / 2025 5.06% against BC.gov pages  
- [ ] Author confirms line 22215 = first additional + CPP2  
- [ ] Approved as golden reference for tests  
