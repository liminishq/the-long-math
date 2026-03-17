/* ============================================================
   The Long Math — TFSA Over-Contribution Penalty Calculator Engine
   ============================================================

   PURPOSE
   -------
   Estimate CRA TFSA over-contribution tax (penalty) based on
   calendar-month excess amounts. Penalty = 1% per month on the
   *highest* excess in each month (not excess × months).

   KEY RULES MODELED:
   - Contribution: uses available room first; overflow becomes excess.
   - Withdrawal: reduces current excess only (does not create room).
   - Room adjustment: increases room; can reduce excess.
   - Jan 1 room: optional annual room added each January 1 in range.
   - Each month: monthly penalty = 1% × highest excess reached in that month.

   ASSUMPTIONS (document in assumptions array in result):
   - All amounts in CAD; dates in YYYY-MM-DD.
   - Transactions outside [startDate, endDate] are ignored.
   - Withdrawals do not add back to contribution room in this model.
   - This is an educational estimate; CRA rules may vary.
*/

(function (global) {
  "use strict";

  const PENALTY_RATE = 0.01; // 1% per month

  /* ============================================================
     Simple mode: one lump-sum excess over a fixed number of months
     penalty = excessAmount × 1% × months (constant excess only)
     ============================================================ */
  function calculateSimpleTfsaPenalty(excessAmount, monthsAtExcess) {
    const excess = Number(excessAmount);
    const months = Number(monthsAtExcess);
    if (!Number.isFinite(excess) || excess < 0) {
      return { error: "Excess amount must be a non-negative number." };
    }
    if (!Number.isFinite(months) || months < 0) {
      return { error: "Number of months must be a non-negative number." };
    }
    const monthsWhole = Math.floor(months);
    if (monthsWhole !== months) {
      return { error: "Enter a whole number of months." };
    }
    const penalty = excess * PENALTY_RATE * monthsWhole;
    return { penalty };
  }

  /* ============================================================
     Date helpers (no mutation of inputs)
     ============================================================ */

  /**
   * Parse "YYYY-MM-DD" to Date. Returns null if invalid.
   */
  function parseDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + "T12:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Format Date to "YYYY-MM".
   */
  function toMonthKey(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return y + "-" + String(m).padStart(2, "0");
  }

  /**
   * Format Date to "YYYY-MM-DD".
   */
  function toDateKey(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  /**
   * Compare two dates (returns -1, 0, or 1).
   */
  function compareDates(a, b) {
    const ta = a.getTime();
    const tb = b.getTime();
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  }

  /**
   * Is date d within [start, end] (inclusive)?
   */
  function dateInRange(d, start, end) {
    const t = d.getTime();
    return t >= start.getTime() && t <= end.getTime();
  }

  /**
   * List all calendar months (YYYY-MM) between start and end inclusive.
   */
  function listMonthsInRange(startDate, endDate) {
    const months = [];
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end || start.getTime() > end.getTime()) return months;
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endFirst = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur.getTime() <= endFirst.getTime()) {
      months.push(toMonthKey(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }

  /* ============================================================
     Normalized event: { date, dateObj, type, amount }
     ============================================================ */

  function normalizeTransaction(t, startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) return null;
    const dateObj = parseDate(t.date);
    if (!dateObj || !dateInRange(dateObj, start, end)) return null;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const type = String(t.type).toLowerCase();
    if (type !== "contribution" && type !== "withdrawal" && type !== "room_adjustment") return null;
    return { date: t.date, dateObj, type, amount };
  }

  /**
   * Same-date event priority (lower = processed first).
   * Ensures e.g. Jan 1 room is applied before a same-day contribution,
   * so room is available and no phantom excess appears.
   * 1. room_adjustment  2. withdrawal  3. contribution
   */
  const EVENT_PRIORITY = { room_adjustment: 0, withdrawal: 1, contribution: 2 };

  /**
   * Build sorted list of events in range: user transactions (in range) plus
   * Jan 1 room_adjustment for each year crossed if annualJan1Room > 0.
   * Sorted by date, then by explicit priority so same-day events are deterministic:
   * room_adjustment first, then withdrawal, then contribution.
   */
  function buildEventTimeline(inputs) {
    const { startDate, endDate, startingRoom, annualJan1Room, transactions } = inputs;
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end || start.getTime() > end.getTime()) return [];

    const events = [];

    // User transactions in range
    for (let i = 0; i < (transactions || []).length; i++) {
      const t = transactions[i];
      const norm = normalizeTransaction(t, startDate, endDate);
      if (norm) events.push(norm);
    }

    // Jan 1 room additions for each year in range (if annualJan1Room > 0)
    if (Number.isFinite(annualJan1Room) && annualJan1Room > 0) {
      const startYear = start.getFullYear();
      const endYear = end.getFullYear();
      for (let y = startYear; y <= endYear; y++) {
        const jan1 = toDateKey(new Date(y, 0, 1));
        const jan1Obj = parseDate(jan1);
        if (dateInRange(jan1Obj, start, end)) {
          events.push({
            date: jan1,
            dateObj: jan1Obj,
            type: "room_adjustment",
            amount: annualJan1Room
          });
        }
      }
    }

    events.sort((a, b) => {
      const cmp = compareDates(a.dateObj, b.dateObj);
      if (cmp !== 0) return cmp;
      const pa = EVENT_PRIORITY[a.type] ?? 3;
      const pb = EVENT_PRIORITY[b.type] ?? 3;
      return pa - pb;
    });
    return events;
  }

  /**
   * Apply one event to state. State is { room, excess }.
   * Returns new state (no mutation).
   *
   * room_adjustment semantics (single application, no double-counting):
   * The adjustment is applied once. It first absorbs current excess (reduces excess).
   * Only the remainder after absorbing excess is added to available room.
   * So: absorbed = min(excess, amount); excess -= absorbed; room += (amount - absorbed).
   */
  function applyEvent(state, event) {
    let { room, excess } = state;
    const amount = event.amount;

    switch (event.type) {
      case "contribution": {
        const useFromRoom = Math.min(amount, Math.max(0, room));
        room = room - useFromRoom;
        excess = excess + (amount - useFromRoom);
        break;
      }
      case "withdrawal":
        excess = Math.max(0, excess - amount);
        break;
      case "room_adjustment": {
        let remainingAdjustment = amount;
        const absorbed = Math.min(excess, remainingAdjustment);
        excess = excess - absorbed;
        remainingAdjustment = remainingAdjustment - absorbed;
        room = room + remainingAdjustment;
        break;
      }
      default:
        break;
    }
    return { room, excess };
  }

  /**
   * Run the penalty estimate: process events by month, track highest excess per month.
   */
  function runTfsaOverContributionPenaltyEstimate(inputs) {
    const { startDate, endDate, startingRoom, annualJan1Room, transactions } = inputs;

    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) {
      return { error: "Invalid start or end date (use YYYY-MM-DD)." };
    }
    if (start.getTime() > end.getTime()) {
      return { error: "End date must be on or after start date." };
    }

    const room0 = Number(startingRoom);
    if (!Number.isFinite(room0) || room0 < 0) {
      return { error: "Starting room must be a non-negative number." };
    }

    const annualRoom = Number(annualJan1Room);
    if (!Number.isFinite(annualRoom) || annualRoom < 0) {
      return { error: "Annual Jan 1 room must be a non-negative number." };
    }

    const eventTimeline = buildEventTimeline(inputs);
    const monthsInRange = listMonthsInRange(startDate, endDate);
    if (monthsInRange.length === 0) {
      return { error: "Date range has no calendar months." };
    }

    // Group events by month (YYYY-MM)
    const eventsByMonth = {};
    for (const m of monthsInRange) eventsByMonth[m] = [];
    for (const e of eventTimeline) {
      const key = toMonthKey(e.dateObj);
      if (eventsByMonth[key]) eventsByMonth[key].push(e);
    }

    let room = room0;
    let excess = 0;
    let totalPenalty = 0;
    let monthsWithPenalty = 0;
    let peakExcess = 0;
    const monthlyBreakdown = [];
    const normalizedTimeline = [];

    for (const monthKey of monthsInRange) {
      const roomAtStartOfMonth = room;
      let highestExcessInMonth = excess;
      const monthEvents = eventsByMonth[monthKey] || [];

      for (const ev of monthEvents) {
        const stateBefore = { room, excess };
        const stateAfter = applyEvent(stateBefore, ev);
        room = stateAfter.room;
        excess = stateAfter.excess;
        if (excess > highestExcessInMonth) highestExcessInMonth = excess;
        normalizedTimeline.push({
          date: ev.date,
          type: ev.type,
          amount: ev.amount,
          roomAfter: room,
          excessAfter: excess
        });
      }

      const monthlyPenalty = highestExcessInMonth * PENALTY_RATE;
      totalPenalty += monthlyPenalty;
      if (highestExcessInMonth > 0) monthsWithPenalty += 1;
      if (highestExcessInMonth > peakExcess) peakExcess = highestExcessInMonth;

      monthlyBreakdown.push({
        month: monthKey,
        highestExcess: highestExcessInMonth,
        monthlyPenalty,
        events: monthEvents.map(e => ({ date: e.date, type: e.type, amount: e.amount })),
        roomAtStartOfMonth,
        roomAtEndOfMonth: room,
        excessAtEndOfMonth: excess
      });
    }

    const assumptions = [
      "Penalty is 1% per month on the highest excess amount in each calendar month.",
      "Transactions outside the selected date range are ignored.",
      "Withdrawals reduce excess only; they do not add to contribution room in this model.",
      "Jan 1 room is added only when 'annual new TFSA room (Jan 1)' is greater than zero.",
      "This is an educational estimate; CRA rules and your specific situation may differ."
    ];

    return {
      totalPenalty,
      monthsWithPenalty,
      peakExcess,
      endingExcess: excess,
      endingRoom: room,
      monthlyBreakdown,
      normalizedTimeline,
      assumptions
    };
  }

  /* Export for UI and tests */
  global.calculateSimpleTfsaPenalty = calculateSimpleTfsaPenalty;
  global.runTfsaOverContributionPenaltyEstimate = runTfsaOverContributionPenaltyEstimate;
  global.TfsaOverContributionEngine = {
    calculateSimpleTfsaPenalty,
    parseDate,
    toMonthKey,
    toDateKey,
    listMonthsInRange,
    buildEventTimeline,
    applyEvent,
    PENALTY_RATE
  };

  /* ============================================================
     Regression test cases (run in Node or browser)
     Usage: TfsaOverContributionEngine.runRegressionTests()
     ============================================================ */
  function runRegressionTests() {
    const run = runTfsaOverContributionPenaltyEstimate;
    const tests = [
      {
        name: "1. No excess ever",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          startingRoom: 10000,
          annualJan1Room: 0,
          transactions: [
            { date: "2026-01-15", type: "contribution", amount: 5000 }
          ]
        },
        expect: { totalPenalty: 0, peakExcess: 0 }
      },
      {
        name: "2. Single excess lasting multiple months",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          startingRoom: 0,
          annualJan1Room: 0,
          transactions: [{ date: "2026-01-10", type: "contribution", amount: 1000 }]
        },
        expect: { totalPenalty: 30, peakExcess: 1000 } // 1% × 1000 × 3 months
      },
      {
        name: "3. Excess corrected mid-month",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          startingRoom: 0,
          annualJan1Room: 0,
          transactions: [
            { date: "2026-01-05", type: "contribution", amount: 5000 },
            { date: "2026-01-20", type: "withdrawal", amount: 5000 }
          ]
        },
        expect: { totalPenalty: 50, peakExcess: 5000 } // month still assessed on 5000
      },
      {
        name: "4. Multiple contributions same month, different peak",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          startingRoom: 2000,
          annualJan1Room: 0,
          transactions: [
            { date: "2026-01-10", type: "contribution", amount: 2000 },
            { date: "2026-01-15", type: "contribution", amount: 3000 }
          ]
        },
        expect: { totalPenalty: 30, peakExcess: 3000 } // 0 then 3000 excess
      },
      {
        name: "5. Jan 1 new room reducing excess",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-02-28",
          startingRoom: 0,
          annualJan1Room: 7000,
          transactions: [{ date: "2026-01-10", type: "contribution", amount: 5000 }]
        },
        expect: { totalPenalty: 0, peakExcess: 0 } // Jan 1 adds 7000, then 5000 fits
      },
      {
        name: "6. Withdrawal after excess",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-02-28",
          startingRoom: 0,
          annualJan1Room: 0,
          transactions: [
            { date: "2026-01-10", type: "contribution", amount: 2000 },
            { date: "2026-02-01", type: "withdrawal", amount: 2000 }
          ]
        },
        expect: { totalPenalty: 40, peakExcess: 2000 } // Jan 20, Feb 20 (Feb starts with 2000, then withdrawal)
      },
      {
        name: "7. Room adjustment reducing excess",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          startingRoom: 0,
          annualJan1Room: 0,
          transactions: [
            { date: "2026-01-05", type: "contribution", amount: 3000 },
            { date: "2026-01-15", type: "room_adjustment", amount: 3000 }
          ]
        },
        expect: { totalPenalty: 30, peakExcess: 3000 } // highest in month 3000
      },
      {
        name: "8. Same-date Jan 1 room and contribution",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          startingRoom: 0,
          annualJan1Room: 7000,
          transactions: [{ date: "2026-01-01", type: "contribution", amount: 5000 }]
        },
        expect: { totalPenalty: 0, peakExcess: 0 } // room_adjustment first, then contribution fits
      },
      {
        name: "9. room_adjustment with existing excess (absorb first, remainder to room)",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          startingRoom: 0,
          annualJan1Room: 0,
          transactions: [
            { date: "2026-01-05", type: "contribution", amount: 1000 },
            { date: "2026-01-15", type: "room_adjustment", amount: 3000 }
          ]
        },
        expect: { totalPenalty: 10, peakExcess: 1000 } // excess 0 after adj, room 2000
      },
      {
        name: "10. room_adjustment when no excess (all to room)",
        inputs: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          startingRoom: 500,
          annualJan1Room: 0,
          transactions: [{ date: "2026-01-10", type: "room_adjustment", amount: 1000 }]
        },
        expect: { totalPenalty: 0, peakExcess: 0 } // room becomes 1500
      }
    ];
    let passed = 0;
    for (const t of tests) {
      const result = run(t.inputs);
      if (result.error) {
        console.log("FAIL", t.name, result.error);
        continue;
      }
      const okPenalty = result.totalPenalty === t.expect.totalPenalty;
      const okPeak = result.peakExcess === t.expect.peakExcess;
      if (okPenalty && okPeak) {
        passed++;
        console.log("OK  ", t.name);
      } else {
        console.log("FAIL", t.name, "got", result.totalPenalty, result.peakExcess, "expected", t.expect.totalPenalty, t.expect.peakExcess);
      }
    }
    console.log(passed + "/" + tests.length + " passed");
    return { passed, total: tests.length };
  }
  global.TfsaOverContributionEngine.runRegressionTests = runRegressionTests;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
