# Prompt: Compute federal tax step-by-step (for known-answer tests)

**Use this when:** You need the “correct” federal (and optionally provincial) tax for a specific scenario so you can add a known-answer test or validate the calculator. AI plays the role of someone filling Schedule 1 (and the provincial form) by hand.

---

**Instructions to the AI:**

You are filling the Canadian T1 federal Schedule 1 (and, if requested, the provincial form) for the scenario below. Your job is to compute the tax **step by step** as the form does, so the result can be used as the authoritative “correct” value for a test.

**Rules:**
- Use only the official form logic: Schedule 1 line order (bracket tax, then non-refundable credits, then dividend tax credit). For provinces, follow the relevant provincial form (e.g. T428 for the province).
- Use the **exact** brackets, BPA, Canada employment amount, and credit rates from the CRA indexation and tax-rate tables for the **specified year**. If the user pastes those tables, use them; otherwise use the official 2025 (or specified year) values you know.
- **Rounding:** Schedule 1 typically rounds each bracket’s tax to the nearest dollar before summing. Do the same unless the user specifies otherwise.
- Output:
  1. A short step-by-step calculation (e.g. “Line 11: bracket tax = …”, “Line 13: BPA credit = …”).
  2. **Federal tax** (after credits and dividend tax credit).
  3. If provincial is requested: **Provincial tax** and the steps you used (e.g. which form, which lines).
  4. **Total income tax** (federal + provincial).

---

**Scenario:**

- **Tax year:** [e.g. 2025]
- **Province:** [e.g. Ontario]
- **Employment income:** [e.g. 160000]
- **Self-employment income:** [e.g. 0]
- **Other income:** [e.g. 0]
- **Capital gains:** [e.g. 0]
- **Eligible dividends:** [e.g. 0]
- **Non-eligible dividends:** [e.g. 0]
- **RRSP contributions:** [e.g. 0]
- **CPP and EI** (if employment > 0, assume standard CPP/EI on employment for the year): [e.g. use 2025 YMPE and rates to compute, or state “use CRA payroll amounts”]

Optional: **Paste the CRA indexation table and federal tax bracket table** for the year so the calculation uses exact CRA numbers.

---

**Output format:**

```
Step-by-step:
  [numbered steps matching form lines]

Federal tax: $X
Provincial tax: $Y   (if requested)
Total income tax: $Z
```

Then I can add a test case: for these inputs, the calculator must output federal tax = X, provincial = Y, total = Z (within a small tolerance, e.g. $1–2 for rounding).
