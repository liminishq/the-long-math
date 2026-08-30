# Canada Personal Income Tax Calculator — v1 accuracy charter

**Status:** Approved scope (May 2026). Implementation follows signed form traces, not comparator sites.

## Goal

For in-scope inputs, unrounded arithmetic matches **hand-traced CRA federal and provincial form lines**. Display rounds **federal** and **provincial** net income tax to the nearest dollar separately; **total income tax shown** = sum of those rounded parts.

## In scope (v1)

| Area | Coverage |
|------|----------|
| Tax years | 2025, 2026 (as supported by data files) |
| Provinces | All provinces/territories in `provinces.json` (provincial logic signed off per wave) |
| Golden-trace focus | **BC** and **ON** first; then all provinces |
| Income types | Employment, self-employment (income tax only), other income, eligible/non-eligible dividends, capital gains (50% inclusion), RRSP/FHSA/estimated deductions |
| Federal | Schedule 8 (employment CPP path), net income / taxable income, Schedule 1 brackets and non-refundable credits including **enhanced BPA phase-out**, federal dividend gross-up/DTC per `dividends.json` |
| Ontario extras | Surtax, Ontario Tax Reduction (basic amount), Ontario Health Premium |
| Provincial income-driven reductions | B.C. tax reduction; NL/NB/NS low-income tax reduction (**single-filer** path only) |
| Payroll | CRA annual maximums; employment base CPP → line 30800 credit; first additional + CPP2 → line 22215 deduction; EI → credit only. Outside Quebec, self-employed CPP pays both halves and splits the base/enhanced amounts between lines 31000 and 22200. |

## Out of scope (v1) — document on methodology and UI

- Quebec QPP, QPIP, TP-1 form tracing, and federal Quebec abatement (QC brackets/BPA from Finances Québec are in data; employment path still uses federal Schedule 8 CPP/EI, not QC-native)
- Quebec self-employment **QPP/QPIP**; non-Quebec self-employed CPP is modeled
- Multiple employers, T4 aggregation, Schedule 8 overpayment (line 44800)
- Working beneficiaries, CPT20/CPT30, partial-year Schedule 8 proration
- AMT, most secondary credits (caregiver, medical, tuition, etc.)
- OAS clawback, age amount, and pension income amount unless the caller supplies `oasBenefits`, `age`, and/or `eligiblePensionIncome` (optional retirement path used by the RRSP Withdrawal Calculator)
- Ontario Tax Reduction dependant amounts (engine models the basic personal amount only)
- Spouse / eligible-dependant / child add-ons on Atlantic low-income tax reductions
- Alberta supplemental tax credit

## Rounding

1. **Engine / tests:** Full precision unless a traced form line specifies an intermediate rounding step.
2. **Golden tests:** Assert exact match to hand-traced unrounded amounts (tolerance $0).
3. **Display:** `displayFederal = round(netFederal)`, `displayProv = round(netProv)`, `displayTotal = displayFederal + displayProv`.

## Verification

- Primary: form trace sheets under `docs/form-traces/`
- Secondary: none for tax data; use official CRA and provincial/territorial government sources only

## Provincial rollout

| Wave | Provinces | Status |
|------|-----------|--------|
| A | BC, ON | Employment + key dividend traces; tests locked |
| B | AB, SK, MB, NB, NS, NL, PE | `cppEiCredit` added to data; employment traces pending |
| C | NT, NU, YT | `cppEiCredit` added to data; traces pending |

Each province: at least one signed employment trace before “verified” label. **QC excluded** from provincial CPP/EI credit script.

## Self-employment income (v1 behaviour)

**Option A (locked):** Self-employment dollars are included in income for bracket tax and dividends/capital gains logic where applicable. **No** employee CPP or EI is calculated. Methodology and calculator UI state this explicitly.
