# Prompt: Extract federal tax parameters for our calculator

**Use this when:** You have the current CRA pages for tax rates and indexation and want to produce or update `federal.json` for a given year so the calculator matches CRA.

---

**Instructions to the AI:**

You are helping maintain a Canadian federal income tax calculator. The calculator reads parameters from a JSON file with this shape:

```json
{
  "year": 2025,
  "brackets": [
    { "threshold": 0, "rate": 0.145 },
    { "threshold": 57375, "rate": 0.205 },
    { "threshold": 114750, "rate": 0.26 },
    { "threshold": 177882, "rate": 0.29 },
    { "threshold": 253414, "rate": 0.33 }
  ],
  "credits": {
    "basicPersonalAmount": { "amount": 16129 },
    "canadaEmploymentAmount": { "amount": 1471 },
    "cppEiCredit": { "rate": 0.15 }
  },
  "rrspRoomRate": 0.18,
  "rrspDollarMax": 32490
}
```

- `brackets`: array of `{ threshold, rate }`. Thresholds are the taxable income **above which** the next rate applies. Rate for the first bracket can be the **effective full-year rate** if the law has a mid-year change (e.g. 2025: 15% Jan–Jun, 14% Jul–Dec → 14.5% effective). Use **decimal** rates (e.g. 0.205 not 20.5).
- `credits.basicPersonalAmount.amount`: maximum BPA for that year from CRA indexation (e.g. for net income ≤ 29% bracket threshold).
- `credits.canadaEmploymentAmount.amount`: maximum Canada employment amount from CRA indexation table.
- `credits.cppEiCredit.rate`: federal credit rate on CPP/EI (typically 0.15).
- `rrspRoomRate` and `rrspDollarMax`: 18% and the dollar cap for that year if you have them.

Below I will paste the official CRA content for **[YEAR]** (tax rates and brackets, and the indexation table for amounts relating to non-refundable credits). From that content:

1. Output a single JSON object that matches the shape above for **[YEAR]**.
2. Use only values explicitly stated or unambiguously derived from the CRA content. If the first bracket rate has a mid-year change, use the **effective full-year rate** and add a brief `_note` on that bracket.
3. Add a `_note` at the root listing the CRA URLs or document names you used.

---

**Paste CRA content below (or attach):**

[PASTE HERE: Tax rates and brackets page + Indexation table for non-refundable credits]
