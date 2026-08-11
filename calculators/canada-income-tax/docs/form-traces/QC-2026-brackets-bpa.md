# Quebec 2026 — brackets and BPA substantiation

**Scope of this note:** Confirm that engine JSON matches Finances Québec published 2026 parameters.  
**Not claimed:** Full TP-1 line tracing, QPP/QPIP, or federal Quebec abatement.

## Source

- Finances Québec, *Parameters of the Personal Income Tax System for 2026*  
  https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTEN_IncomeTax2026.pdf
- Indexation rate for 2026: **2.05%** (Québec CPI formula excluding alcohol, tobacco, recreational cannabis)

## Parameters in engine (`data/2026/provinces.json` → `QC`)

| Parameter | Official 2026 | Engine |
| --------- | ------------- | ------ |
| First bracket max | $54,345 | `54345` |
| Second bracket max | $108,680 | `108680` |
| Third bracket max | $132,245 | `132245` |
| Rates | 14% / 19% / 24% / 25.75% | `0.14` / `0.19` / `0.24` / `0.2575` |
| Basic personal amount | $18,952 | `18952` |
| Credit rate | 14% | `0.14` |

## Deliberate engine limitations for QC

1. Employment CPP/EI still follow the federal Schedule 8 path (not QPP/QPIP).
2. Federal abatement for Quebec residents is not applied.
3. No TP-1–specific credits beyond BPA in the provincial block.

These limitations mean Quebec is **LIMITED** in the verification matrix, not a soft PASS\* based only on “JSON contains values.”
