# CRA alignment: replicating CRA results

**Goal:** This calculator should replicate (or match very closely) the tax that CRA would compute for the same inputs, as determined by the official T1, Schedule 1, and provincial forms.

**Ground truth:** CRA does not publish a general income-tax calculator. The legal result is whatever the **official forms and instructions** produce. We align by:

1. **Using CRA as the single source for numbers** — brackets, BPA, credit amounts, indexation.
2. **Implementing form logic in code** — Schedule 1 and provincial forms (e.g. T428) step-by-step, with comments that reference form lines.
3. **Validating with known-answer tests** — scenarios whose “correct” tax is derived from the same form logic (by hand or by AI).

---

## How we use AI (so you don’t have to do it manually)

### 1. Extracting CRA parameters into our JSON

- **Federal:** CRA publishes [tax rates and brackets](https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html) and [indexation (BPA, credits, etc.)](https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html).
- **Process:** Use the prompts in `tools/cra/`:
  - Paste the relevant CRA page content (or fetch it) into a chat.
  - Run **prompt-extract-federal-params.md**: AI outputs a `federal.json`-shaped object for the chosen year. You (or a script) replace or merge into `data/2025/federal.json`.
  - For provinces: same idea with the provincial form or CRA provincial rate table; AI outputs the province’s bracket/BPA/credit structure for our `provinces.json` and any province-specific dividend rules.

This gives you **one source of truth (CRA)** and **AI doing the tedious extraction** instead of retyping tables by hand.

### 2. Generating “correct” tax for test scenarios

- **Process:** Use **prompt-compute-federal-tax.md** (and the provincial equivalent once added).
  - You provide: tax year, province, inputs (e.g. employment $160k, no dividends, no RRSP).
  - You provide: the official form instructions or a link to Schedule 1 / provincial form.
  - AI computes **step by step** (e.g. Schedule 1 line by line) and outputs: federal tax, provincial tax, total, and optionally bracket breakdown.
  - You store that as a **known-answer test** (e.g. in `known-answer-vectors` or in the regression baselines). The calculator must match these to be considered “CRA-aligned.”

You can run this for as many scenarios as you need (per province, per income type); AI does the form-filling, you just curate the inputs and paste the outputs into tests.

### 3. Tracing discrepancies

- When our calculator disagrees with an external comparator tax tool (or with an AI-computed form result):
  - **Form-line mapping:** Our engine comments reference Schedule 1 and, where applicable, provincial form lines. So you can see which code line corresponds to which form line.
  - **Prompt:** “Given our code [paste relevant part] and the CRA Schedule 1 instructions [paste], for input X we get tax Y but the form says Z. Which step (form line or code line) is wrong?” AI can narrow it down to a specific bracket, credit, or rounding step.

---

## Form-line mapping in this codebase

- **Federal:** `tax.engine.js` → `calculateFederalTax()` mirrors **Schedule 1** order: bracket tax on TI (after line 22215 enhanced CPP deduction) → non-refundable credits (BPA, Canada Employment Amount, **base CPP** line 30800, EI) → dividend tax credit. Enhanced CPP is **not** included in the CPP credit base.
- **CPP split:** `calculateCPP()` returns `cppBaseCreditable`, `cppFirstAdditionalDeductible`, `cpp2Deductible`, and `cppDeductible` (sum of enhanced portions). See `payroll.json` `baseRate` / `firstAdditionalRate`.
- **Provincial:** `calculateProvincialTaxGeneric()` and `calculateOntarioTax()` follow the same idea: brackets → credits → surtax → dividend credit → premiums. Provincial forms (e.g. ON428, T428 for other provinces) are the reference; we add comments as we align each province.

Adding a short comment like `// Schedule 1 line 13` next to the corresponding line in the engine makes discrepancy-tracing and AI-assisted debugging much easier.

---

## Data sources (what we use today)

- **Federal 2025:**  
  - Brackets and BPA from CRA indexation page and tax-rates page (see URLs above).  
  - First bracket 14.5% for 2025 (blended 15% / 14% after July 1).  
  - Canada employment amount: CRA indexation table 2025 = **$1,471** (max).  
- **Provincial/Territorial 2025:** `provinces.json` — brackets and basic personal amounts from **TaxTips.ca** 2024 & 2025 rates (taxtips.ca/priortaxrates/tax-rates-2024-2025/), CRA-confirmed where noted. Use **tools/cra/prompt-extract-provincial-params.md** to refresh a province from a new TaxTips or CRA page.
- **Dividends:** `dividends.json` — gross-up and credit rates from CRA (federal) and provincial tax guides; provincial dividend credit logic can differ from our simple “rate × grossed-up amount” and may need form-specific rules.

---

## Suggested workflow each year

1. **Update federal:** Run the extract prompt on the new CRA indexation and tax-rates pages → update `federal.json` (and payroll/dividends if needed).
2. **Update provincial:** For each province you support, run the same style of prompt on the new provincial form or rate table → update `provinces.json` and any province-specific logic.
3. **Regenerate known-answer tests:** Run the “compute tax step-by-step” prompt for a few key scenarios (e.g. $160k employment in ON, AB, BC; $160k eligible dividends in ON) and update the test vectors.
4. **Run regression:** `node tools/tests/run-tax-regression.js` and `compare-with-external-baseline.js`. Fix any failure by tracing to the form line (using the engine’s form-line comments and the “trace discrepancy” prompt).

That way, **CRA is the source**, **AI does extraction and form-filling**, and **you only supervise and plug the results into the repo**.
