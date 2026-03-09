/* ============================================================
   The Long Math — Canada Capital Gains Tax Calculator — Engine
   ============================================================
   Pure math only. No DOM.

   Formulas:
   Gain = Proceeds - ACB
   If Gain <= 0: taxableGain = 0, taxOwing = 0 (capital loss)
   Else if primaryResidenceExemption: taxableGain = 0, taxOwing = 0
   Else:
     taxableGain = Gain * (inclusionRate / 100)
     taxOwing = taxableGain * (marginalTaxRate / 100)
   AfterTaxProceeds = Proceeds - taxOwing
*/

(function (global) {
  "use strict";

  function parseNum(x) {
    if (x == null) return NaN;
    const s = String(x).trim().replace(/,/g, "").replace(/\s/g, "");
    if (s === "") return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function safeNum(x, fallback) {
    const n = parseNum(x);
    return Number.isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
  }

  /**
   * @param {Object} inputs
   * @param {number} inputs.proceeds - Proceeds of disposition (CAD)
   * @param {number} inputs.acb - Adjusted Cost Base (CAD)
   * @param {number} inputs.inclusionRate - Inclusion rate (0–100), default 50
   * @param {number} inputs.marginalTaxRate - Marginal tax rate (0–100)
   * @param {boolean} inputs.primaryResidenceExemption - If true, taxable gain = 0, tax owing = 0
   * @returns {Object} Result with gain, isLoss, taxableGain, taxOwing, afterTaxProceeds, and mathSteps for "Show the math"
   */
  function calculate(inputs) {
    const proceeds = safeNum(inputs.proceeds, 0);
    const acb = safeNum(inputs.acb, 0);
    const inclusionRate = safeNum(inputs.inclusionRate, 50);
    const marginalTaxRate = safeNum(inputs.marginalTaxRate, 0);
    const primaryResidenceExemption = !!inputs.primaryResidenceExemption;

    const gain = proceeds - acb;
    const isLoss = gain <= 0;

    let taxableGain = 0;
    let taxOwing = 0;

    if (isLoss) {
      taxableGain = 0;
      taxOwing = 0;
    } else if (primaryResidenceExemption) {
      taxableGain = 0;
      taxOwing = 0;
    } else {
      taxableGain = gain * (inclusionRate / 100);
      taxOwing = taxableGain * (marginalTaxRate / 100);
    }

    const afterTaxProceeds = proceeds - taxOwing;

    return {
      gain,
      isLoss,
      taxableGain,
      taxOwing,
      afterTaxProceeds,
      mathSteps: {
        proceeds,
        acb,
        inclusionRate,
        marginalTaxRate,
        primaryResidenceExemption,
        gain,
        isLoss,
        taxableGain,
        taxOwing,
        afterTaxProceeds
      }
    };
  }

  global.CapitalGainsTaxCanada = global.CapitalGainsTaxCanada || {};
  global.CapitalGainsTaxCanada.calculate = calculate;
  global.CapitalGainsTaxCanada.parseNum = parseNum;
  global.CapitalGainsTaxCanada.safeNum = safeNum;
})(typeof window !== "undefined" ? window : this);
