# Form trace: Ontario 2025 — $160,000 eligible dividends only

**Inputs:** Eligible dividends (cash) $160,000; no employment; no CPP/EI.

## Income

| Item | Amount |
|------|-------:|
| Gross-up rate | 1.38 |
| Taxable income (grossed-up) | 220,800 |
| Total cash income | 160,000 |

## Federal (Schedule 1 + DTC)

| Step | Display $ |
|------|----------:|
| Bracket tax on $220,800 | (see engine bracket lines) |
| Less: BPA credit @ 15% (enhanced BPA phased at NI $220,800 → base ≈ $15,225) | ≈ 2,283.75 |
| Net after credits | ~49,706 |
| Less: federal eligible DTC (15.0198% × grossed-up) | 33,164 |
| **Federal tax** | **13,494** |

## Ontario (ON428)

| Step | Display $ |
|------|----------:|
| ON bracket tax | 21,063 |
| BPA credit @ 5.05% | 644 |
| After credits | 20,419 |
| Surtax | 7,662 |
| After surtax | 28,082 |
| Less: ON eligible DTC (10% × grossed-up) | 22,080 |
| After DTC | 6,002 |
| OHP (TI &gt; $200k) | 900 |
| **Ontario tax** | **6,902** |

## Totals

| | $ |
|--|--:|
| Total income tax | **20,396** |

**Note:** Federal DTC rate from `dividends.json` / Income Tax Act; provincial ON rate 10% on grossed-up amount per `dividends.json` provincial.ON. Federal BPA uses the CRA enhanced phase-out between the 29% and 33% bracket thresholds (not the maximum BPA). Confirm DTC rates against T4040 / ON428 before treating as form-final.

## Sign-off

- [x] Test: `test_ON_2025_eligible_dividends_160k`
