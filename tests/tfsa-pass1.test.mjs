import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadBrowserEngine(relativePath) {
  const code = readFileSync(join(__dirname, "..", relativePath), "utf8");
  const sandbox = { window: {} };
  runInNewContext(code, sandbox);
  return sandbox.window;
}

const tfsaRoom = loadBrowserEngine("calculators/tfsa-room/engine.js");
const tfsaPenalty = loadBrowserEngine(
  "calculators/tfsa-over-contribution-penalty-calculator/engine.js"
);

test("TFSA room subtracts current-total contributions exactly once", () => {
  const priorYearContributions = 43_000;
  const currentYearContributions = 7_000;
  const result = tfsaRoom.calculateTFSARoom({
    limitsData: {
      limits: [
        { year: 2026, limit: 109_000 },
        { year: 2027, limit: 7_000 }
      ]
    },
    eligibilityStartYear: 2026,
    asOfYear: 2026,
    totalContributionsThroughAsOfDate:
      priorYearContributions + currentYearContributions,
    withdrawalsPriorYearsTotal: 0,
    withdrawalsThisYear: 10_000
  });

  assert.equal(result.availableRoomThisYear, 59_000);
  assert.equal(
    result.projectedRoomNextYear,
    76_000,
    "current-year withdrawals must still add back next year"
  );
});

test("Advanced penalty mode restores December withdrawals before January contributions", () => {
  const result = tfsaPenalty.runTfsaOverContributionPenaltyEstimate({
    startDate: "2025-12-01",
    endDate: "2026-01-31",
    startingRoom: 0,
    annualJan1Room: 7_000,
    transactions: [
      { date: "2025-12-15", type: "withdrawal", amount: 10_000 },
      { date: "2026-01-01", type: "contribution", amount: 15_000 }
    ]
  });

  assert.equal(result.totalPenalty, 0);
  assert.equal(result.endingExcess, 0);
  assert.equal(result.endingRoom, 2_000);
  assert.equal(result.monthlyBreakdown[1].highestExcess, 0);
  assert.deepEqual(
    Array.from(
      result.normalizedTimeline
        .filter((event) => event.date === "2026-01-01")
        .map((event) => event.type)
    ),
    ["room_adjustment", "withdrawal_addback", "contribution"]
  );
});

test("Jan 1 room and withdrawal restoration clear carried excess before January peak", () => {
  const result = tfsaPenalty.runTfsaOverContributionPenaltyEstimate({
    startDate: "2025-12-01",
    endDate: "2026-01-31",
    startingRoom: 0,
    annualJan1Room: 7_000,
    transactions: [
      { date: "2025-12-01", type: "contribution", amount: 10_000 },
      { date: "2025-12-15", type: "withdrawal", amount: 10_000 },
      { date: "2026-01-01", type: "contribution", amount: 15_000 }
    ]
  });

  assert.equal(result.monthlyBreakdown[0].highestExcess, 10_000);
  assert.equal(result.monthlyBreakdown[1].highestExcess, 0);
  assert.equal(result.totalPenalty, 100);
  assert.equal(result.endingExcess, 0);
  assert.equal(result.endingRoom, 2_000);
});
