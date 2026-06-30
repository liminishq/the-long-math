# Prompt: Extract provincial/territorial tax parameters for our calculator

**Use this when:** You have the current official CRA, provincial, territorial, finance, tax-package, or open-data source for a given year and want to produce or update that province’s entry in `provinces.json`.

---

**Instructions to the AI:**

You are helping maintain a Canadian provincial/territorial income tax calculator. The calculator reads parameters from a JSON object per province with this shape:

```json
{
  "name": "Alberta",
  "brackets": [
    { "threshold": 0, "rate": 0.08 },
    { "threshold": 60000, "rate": 0.10 }
  ],
  "credits": {
    "basicPersonalAmount": { "amount": 22323, "rate": 0.08 }
  },
  "surtaxes": [],
  "premiums": []
}
```

- **brackets:** Array of `{ threshold, rate }`. Thresholds are the taxable income **above which** the next rate applies. Use **decimal** rates (e.g. 0.08 not 8%).
- **credits.basicPersonalAmount:** The province’s basic personal amount and the rate at which it is applied (usually the lowest bracket rate).
- **surtaxes:** If the province has a surtax (e.g. Ontario), array of `{ name, threshold, rate }` and optionally `threshold2`, `rate2` for a second tier. Otherwise `[]`.
- **premiums:** If the province has a health or other premium (e.g. Ontario Health Premium), include `{ name, formula: "ontarioHealthPremium" }` or similar. Otherwise `[]`.

Below I will paste the official source content for **[PROVINCE]** for **[YEAR]** (tax brackets and basic personal amount table). From that content:

1. Output a single JSON object that matches the shape above for that province/territory.
2. Use only values explicitly stated or unambiguously derived from the source. Use the **province’s** bracket thresholds and BPA (not federal).
3. Add a brief `_note` if the source mentions indexation, surtax, or premium details.

---

**Paste source content below (or attach):**

[PASTE HERE: official provincial/territorial or CRA rate table for the province and year]
