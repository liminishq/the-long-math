// RRSP Contribution Room & Tax Refund Calculator - arithmetic engine
// Keeps pure calculation logic separate from the UI.

import {
  RRSP_LIMITS,
  parseRrspNumber as parseNumber,
  computeRrspContributionRoom as computeContributionRoom
} from "../canada-income-tax/js/rrsp-room.js";
import { computeTaxFromBrackets } from "../canada-income-tax/js/marginal-tax.js";

const TAX_DATA_CACHE = {};

async function loadTaxDataForYear(year) {
  const key = year;
  if (TAX_DATA_CACHE[key]) return TAX_DATA_CACHE[key];

  const basePath = "/calculators/canada-income-tax/data";
  const [federal, provinces] = await Promise.all([
    fetch(`${basePath}/${key}/federal.json`).then((r) => r.json()),
    fetch(`${basePath}/${key}/provinces.json`).then((r) => r.json())
  ]);

  TAX_DATA_CACHE[key] = { federal, provinces };
  return TAX_DATA_CACHE[key];
}

async function computeProgressiveTax(year, provinceCode, taxableIncome) {
  const yearNum = typeof year === "string" ? parseInt(year, 10) || 2025 : year;
  const { federal, provinces } = await loadTaxDataForYear(yearNum);

  const provKey = provinceCode && provinces[provinceCode] ? provinceCode : null;
  if (!provKey) {
    return {
      totalTax: 0,
      marginalRate: 0
    };
  }

  const fedRes = computeTaxFromBrackets(taxableIncome, federal.brackets || []);
  const provRes = computeTaxFromBrackets(taxableIncome, provinces[provKey].brackets || []);

  return {
    totalTax: fedRes.tax + provRes.tax,
    marginalRate: fedRes.marginalRate + provRes.marginalRate
  };
}

async function computeScenario(rawInputs) {
  const taxYear = rawInputs.taxYear || 2025;
  const province = rawInputs.province || "";
  const plannedContribution = parseNumber(rawInputs.plannedContribution);
  const taxableBefore = parseNumber(rawInputs.taxableBefore);
  const refundMethod = rawInputs.refundMethod === "marginal" ? "marginal" : "progressive";

  const room = computeContributionRoom({
    taxYear,
    priorEarnedIncome: rawInputs.priorEarnedIncome,
    unusedRoom: rawInputs.unusedRoom,
    pa: rawInputs.pa,
    par: rawInputs.par,
    pspa: rawInputs.pspa,
    craOverrideEnabled: rawInputs.craOverrideEnabled,
    craLimitOverride: rawInputs.craLimit
  });

  const availableRoom = room.availableRoomForDeduction;
  // Usable room for deduction/excess: never invent room when the estimate is negative.
  const usableRoom =
    room.usableRoomForContribution != null
      ? room.usableRoomForContribution
      : Math.max(0, availableRoom);
  const deductibleContribution = Math.max(0, Math.min(plannedContribution, usableRoom));

  const newTaxable = Math.max(0, taxableBefore - deductibleContribution);

  const taxBefore = await computeProgressiveTax(taxYear, province, taxableBefore);
  const taxAfter = await computeProgressiveTax(taxYear, province, newTaxable);

  const progressiveRefund = Math.max(0, taxBefore.totalTax - taxAfter.totalTax);
  const marginalRate = taxBefore.marginalRate || 0;

  const simpleRefund = deductibleContribution * marginalRate;
  const chosenRefund = refundMethod === "marginal" ? simpleRefund : progressiveRefund;

  const afterTaxCost = plannedContribution - chosenRefund;
  const remainingRoom = Math.max(0, usableRoom - deductibleContribution);
  const excessContribution = Math.max(0, plannedContribution - usableRoom);

  const effectiveRefundRate = plannedContribution > 0 ? chosenRefund / plannedContribution : 0;

  return {
    taxYear: room.year,
    rrspLimits: RRSP_LIMITS,
    inputs: {
      plannedContribution,
      taxableBefore,
      province,
      refundMethod
    },
    room: {
      newRoom: room.newRoom,
      estimatedAvailableRoom: room.estimatedAvailableRoom,
      availableRoomForDeduction: availableRoom
    },
    deduction: {
      deductibleContribution,
      newTaxableIncome: newTaxable
    },
    tax: {
      progressiveRefund,
      simpleRefund,
      marginalRate
    },
    outputs: {
      chosenRefund,
      afterTaxCost,
      remainingRoom,
      excessContribution,
      effectiveRefundRate
    }
  };
}

export { RRSP_LIMITS, parseNumber, computeContributionRoom, computeScenario };
