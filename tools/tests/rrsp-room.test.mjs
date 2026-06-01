import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const rrspRoomUrl = pathToFileURL(
  join(root, "calculators", "canada-income-tax", "js", "rrsp-room.js")
).href;

const {
  computeRrspNewAnnualRoom,
  computeRrspContributionRoom,
  getRrspDollarCap
} = await import(rrspRoomUrl);

test("computeRrspNewAnnualRoom uses 18% of income capped by dollar max", () => {
  assert.ok(Math.abs(computeRrspNewAnnualRoom(120000, 33810) - 21600) < 1e-6);
  assert.ok(Math.abs(computeRrspNewAnnualRoom(250000, 33810) - 33810) < 1e-6);
  assert.ok(Math.abs(computeRrspNewAnnualRoom(100000, 33810) - 18000) < 1e-6);
});

test("computeRrspContributionRoom adds carry-forward to new room from income", () => {
  const room = computeRrspContributionRoom({
    taxYear: 2026,
    priorEarnedIncome: 120000,
    unusedRoom: 5000,
    rrspDollarMax: 33810
  });
  assert.ok(Math.abs(room.newRoom - 21600) < 1e-6);
  assert.ok(Math.abs(room.estimatedAvailableRoom - 26600) < 1e-6);
});

test("120k income should not default to the statutory dollar cap alone", () => {
  const room = computeRrspContributionRoom({
    taxYear: 2026,
    priorEarnedIncome: 120000,
    unusedRoom: 0,
    rrspDollarMax: 33810
  });
  assert.ok(room.estimatedAvailableRoom < 33810);
  assert.ok(Math.abs(room.estimatedAvailableRoom - 21600) < 1e-6);
});

test("getRrspDollarCap prefers loaded federal data over year table", () => {
  assert.equal(getRrspDollarCap({ rrspDollarMax: 32490, taxYear: 2026 }), 32490);
  assert.equal(getRrspDollarCap({ taxYear: 2026 }), 33810);
});
