/**
 * Pass 3 medium-severity tax calculator fixes — engine-level assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getTaxDataBundle } from "../calculators/canada-income-tax/js/tax.data.js";
import { computePersonalTax } from "../calculators/canada-income-tax/js/tax.engine.js";
import { computeRrspContributionRoom } from "../calculators/canada-income-tax/js/rrsp-room.js";
import { calculateManualMarginalRateEstimate } from "../calculators/capital-gains-tax-canada/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAX_DATA_ROOT = join(ROOT, "calculators", "canada-income-tax", "data");

const taxData2025 = await getTaxDataBundle(2025, { fsDataRoot: TAX_DATA_ROOT });

test("Canada Employment Amount base is capped by employment income ($500 → base 500)", () => {
  const ceaMax = taxData2025.federal.credits.canadaEmploymentAmount.amount;
  assert.ok(ceaMax > 500, `expected CEA max > 500, got ${ceaMax}`);

  const result = computePersonalTax(
    {
      year: 2025,
      province: "ON",
      employmentIncome: 500,
      selfEmploymentIncome: 0,
      otherIncome: 0,
      eligibleDividends: 0,
      nonEligibleDividends: 0,
      capitalGains: 0,
      rrspDeduction: 0,
      fhsaDeduction: 0,
      estimatedDeductions: 0,
      taxPaid: 0
    },
    { taxData: taxData2025, skipMarginalRateCalculation: true }
  );

  const cea = result.breakdown.federal.creditBases.find(
    (c) => c.name === "Canada Employment Amount"
  );
  assert.ok(cea, "expected Canada Employment Amount credit base");
  assert.equal(cea.base, 500);
  assert.ok(cea.base < ceaMax);
});

test("RRSP usable room floors negative available room for excess math", () => {
  const room = computeRrspContributionRoom({
    taxYear: 2026,
    priorEarnedIncome: 0,
    unusedRoom: -2000,
    pa: 0,
    par: 0,
    pspa: 0
  });

  assert.ok(room.estimatedAvailableRoom < 0);
  assert.equal(room.usableRoomForContribution, 0);

  const plannedContribution = 1000;
  const usable = room.usableRoomForContribution;
  const excess = Math.max(0, plannedContribution - usable);
  assert.equal(excess, 1000, "excess must not be planned + |negative room|");
  assert.notEqual(excess, plannedContribution - room.availableRoomForDeduction);
});

test("Capital gains manual mode rejects marginal rate above 100%", () => {
  assert.throws(
    () =>
      calculateManualMarginalRateEstimate({
        capitalGain: 10_000,
        inclusionRate: 50,
        marginalTaxRate: 120
      }),
    /0% and 100%/
  );
});

test("Capital gains manual mode rejects negative marginal rate", () => {
  assert.throws(
    () =>
      calculateManualMarginalRateEstimate({
        capitalGain: 10_000,
        inclusionRate: 50,
        marginalTaxRate: -5
      }),
    /0% and 100%/
  );
});
