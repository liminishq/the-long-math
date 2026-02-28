# Canada Income Tax Calculator — Tests

## How to run tests

### Known-answer regression tests (Node)

From the calculator directory (`calculators/canada-income-tax/`):

```bash
node tests/known-answer-vectors.test.js
```

Requires Node 18+ (ES modules). The test file loads `data/2025/*.json` and calls the engine with `dataOverride`, so no browser or `loadTaxData()` is needed.

**Vectors:**

| Scenario | Assertions |
|----------|------------|
| **2025 ON, $160,000 eligible dividends only** | `taxableIncome` ≈ 220,800; federal ≈ 13,570; Ontario ≈ 6,898; total tax ≈ 20,470; take-home ≈ 139,530 |
| **2025 ON, $160,000 employment only** | `totalIncome` = 160,000; `taxableIncome` = 160,000; positive federal/provincial tax; take-home in (0, 160,000) |
| **2025 AB, $100,000 eligible dividends only** | `taxableIncome` ≈ 138,000; positive federal and provincial tax |

If any assertion fails, the script exits with code 1 and prints the failure. Update the expected values only when the official form logic or rates change.

The ON eligible-dividends vector uses a tolerance band until CRA-exact methodology is locked; tighten the constants in `known-answer-vectors.test.js` when official values are confirmed.

### Browser tests

Open `tests/test.html` in a browser (after serving the site so that `loadTaxData(2025)` can fetch `data/2025/*.json`). The existing engine tests in `engine.test.js` run in that environment.
