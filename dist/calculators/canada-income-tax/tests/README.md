# Canada Income Tax Calculator — Tests

## Run all golden tests

From `calculators/canada-income-tax/`:

```bash
node tests/form-trace-vectors.test.js
node tests/cra-cpp-vectors.test.js
node tests/known-answer-vectors.test.js
```

## Test suites

| File | Purpose |
|------|---------|
| `form-trace-vectors.test.js` | Primary golden tests tied to `docs/form-traces/*.md` (BC/ON employment, dividends, cap gains, OHP) |
| `cra-cpp-vectors.test.js` | CPP bands, RRSP, bracket edges, BC employment |
| `known-answer-vectors.test.js` | Legacy suite + `data/2025/cra-expected.2025.json` |

Tolerance is **$2** on display-rounded tax amounts unless noted.

## Form traces

| Trace | Scenario |
|-------|----------|
| `BC-employment-85000-2025-vs-2026.md` | BC $85k employment |
| `ON-employment-160000-2025-vs-2026.md` | ON $160k employment |
| `ON-eligible-dividends-160000-2025.md` | ON $160k eligible dividends |

## Browser tests

Open `tests/test.html` after serving the site (loads `data/{year}/*.json` via `loadTaxData`).
