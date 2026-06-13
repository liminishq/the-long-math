(function (global) {
  'use strict';

  function computeFutureBuyingPower(inputs) {
    const amountToday = Number(inputs && inputs.amountToday);
    const inflationRatePct = Number(inputs && inputs.inflationRatePct);
    const years = Number(inputs && inputs.years);

    if (!Number.isFinite(amountToday) || amountToday < 0) {
      return null;
    }
    if (!Number.isFinite(inflationRatePct) || inflationRatePct < 0) {
      return null;
    }
    if (!Number.isFinite(years) || years < 0) {
      return null;
    }

    const inflationMultiplier = Math.pow(1 + inflationRatePct / 100, years);
    const futureDollarsNeeded = amountToday * inflationMultiplier;
    const futureBuyingPowerTodayDollars = amountToday / inflationMultiplier;
    const purchasingPowerRetained = 1 / inflationMultiplier;
    const purchasingPowerLost = 1 - purchasingPowerRetained;
    const additionalDollarsNeeded = futureDollarsNeeded - amountToday;

    return {
      amountToday,
      inflationRatePct,
      years,
      inflationMultiplier,
      futureDollarsNeeded,
      futureBuyingPowerTodayDollars,
      purchasingPowerRetained,
      purchasingPowerLost,
      additionalDollarsNeeded,
    };
  }

  global.FutureBuyingPowerEngine = {
    computeFutureBuyingPower,
  };
})(typeof window !== 'undefined' ? window : globalThis);
