// fee-math.js
// Pure math helpers for fee/return calculators. No DOM access.

(function () {
  "use strict";

  function isFiniteNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  // Future value with annual compounding, optional annual contribution at end of year.
  // FV = P*(1+r)^t + c * [((1+r)^t - 1)/r]  (if r != 0)
  function fvAnnual({ P, r, years, contrib = 0 }) {
    if (!isFiniteNumber(P) || !isFiniteNumber(r) || !isFiniteNumber(years) || !isFiniteNumber(contrib)) return NaN;
    if (years < 0) return NaN;

    const t = Math.round(years);
    if (t === 0) return P;

    if (r === 0) return P + contrib * t;

    const g = Math.pow(1 + r, t);
    return P * g + contrib * ((g - 1) / r);
  }

  // Ending value under gross return and fee using the simple model:
  // net = gross - fee
  function endingValueWithFee({ P, gross, fee, years, contrib = 0 }) {
    const net = gross - fee;
    return fvAnnual({ P, r: net, years, contrib });
  }

  // Under this model, to offset a fee of "fee", required excess return is exactly "fee".
  function requiredAlphaToOffsetFeeSimple({ fee }) {
    return fee;
  }

  // Extra annual contribution required so that:
  // FV_no_fee(P, rGross, years, contrib) == FV_with_fee(P, rGross-fee, years, contrib + extra)
  // Solve analytically for extra.
  function extraAnnualContributionToOffsetFee({
    P,
    years,
    rGross,
    fee,
    contrib = 0
  }) {
    if (![P, years, rGross, fee, contrib].every(isFiniteNumber)) return NaN;

    const t = Math.round(years);
    if (t <= 0) return 0;

    const targetNoFee = fvAnnual({ P, r: rGross, years: t, contrib });
    const rNet = rGross - fee;

    if (!isFiniteNumber(targetNoFee)) return NaN;

    // We want:
    // targetNoFee = P*(1+rNet)^t + (contrib + extra)*A
    // where A = ((1+rNet)^t - 1)/rNet  (or t if rNet==0)
    if (rNet === 0) {
      const base = P; // P*(1+0)^t
      const neededTotalContrib = (targetNoFee - base) / t;
      const extra = neededTotalContrib - contrib;
      return extra;
    }

    const g = Math.pow(1 + rNet, t);
    const A = (g - 1) / rNet;

    const base = P * g; // FV from principal only at net return
    const neededTotalContrib = (targetNoFee - base) / A;
    const extra = neededTotalContrib - contrib;
    return extra;
  }

  window.TLM_FeeMath = {
    fvAnnual,
    endingValueWithFee,
    requiredAlphaToOffsetFeeSimple,
    extraAnnualContributionToOffsetFee
  };
})();
