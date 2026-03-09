# CRA alignment tools

This folder holds **prompts** you (or an AI agent) can use to keep the Canada income tax calculator aligned with CRA without manually retyping forms.

- **prompt-extract-federal-params.md** — Extract federal brackets, BPA, and credit amounts from CRA pages into our `federal.json` shape.
- **prompt-extract-provincial-params.md** — Extract one province/territory’s brackets and BPA from TaxTips.ca or CRA into our `provinces.json` shape.
- **prompt-compute-federal-tax.md** — Have AI compute federal (and optionally provincial) tax step-by-step from form logic to generate known-answer test vectors.

See **calculators/canada-income-tax/docs/CRA-ALIGNMENT.md** for the overall strategy and workflow.

## How to use

1. Get source content: CRA (federal/indexation) or TaxTips.ca (provincial) in a browser or via fetch; copy the relevant tables.
2. In a new chat (or agent), paste the prompt from the `.md` file and then paste the source content (or attach the file).
3. Use the AI output: merge into `calculators/canada-income-tax/data/2025/federal.json` or `provinces.json`, or add a new known-answer test.

For **provincial/territorial** data, use **prompt-extract-provincial-params.md** with the TaxTips.ca (or CRA) page for that province and year; paste the result into the correct province key in `provinces.json`.
