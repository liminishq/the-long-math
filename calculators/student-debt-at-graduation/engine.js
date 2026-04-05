/**
 * Student Debt at Graduation — pure arithmetic (no DOM).
 * Projected debt = max(0, sum(program costs) − sum(program non-debt funding)).
 */
(function (global) {
  "use strict";

  /**
   * @param {*} val
   * @returns {number} Non-negative finite number; blank/invalid → 0.
   */
  function parseNonNegativeNumber(val) {
    if (val == null) return 0;
    const s = String(val).trim().replace(/,/g, "");
    if (s === "") return 0;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  /**
   * @param {object} raw
   * @param {string} [raw.name]
   * @param {*} raw.years
   * @param {*} raw.tuition
   * @param {*} raw.books
   * @param {*} raw.living
   * @param {*} raw.other
   * @param {*} raw.funding
   * @param {number} index 0-based for default label
   */
  function computeProgramRow(raw, index) {
    const years = parseNonNegativeNumber(raw.years);
    const tuition = parseNonNegativeNumber(raw.tuition);
    const books = parseNonNegativeNumber(raw.books);
    const living = parseNonNegativeNumber(raw.living);
    const other = parseNonNegativeNumber(raw.other);
    const funding = parseNonNegativeNumber(raw.funding);

    const annualCost = tuition + books + living + other;
    const totalCost = annualCost * years;
    const totalFunding = funding * years;
    const balance = totalCost - totalFunding;

    const nameTrim = raw.name != null ? String(raw.name).trim() : "";
    const label = nameTrim ? nameTrim : "Program " + (index + 1);

    return {
      label,
      years,
      tuition,
      books,
      living,
      other,
      funding,
      annualCost,
      totalCost,
      totalFunding,
      balance,
    };
  }

  /**
   * @param {object[]} programRows
   * @returns {object}
   */
  function computeStudentDebtScenario(programRows) {
    const list = Array.isArray(programRows) ? programRows : [];
    const programs = list.map(function (row, i) {
      return computeProgramRow(row || {}, i);
    });

    let totalEducationCost = 0;
    let totalFunded = 0;
    let compTuition = 0;
    let compBooks = 0;
    let compLiving = 0;
    let compOther = 0;

    programs.forEach(function (p) {
      totalEducationCost += p.totalCost;
      totalFunded += p.totalFunding;
      compTuition += p.tuition * p.years;
      compBooks += p.books * p.years;
      compLiving += p.living * p.years;
      compOther += p.other * p.years;
    });

    const projectedDebt = Math.max(0, totalEducationCost - totalFunded);

    return {
      programs,
      totalEducationCost,
      totalFunded,
      projectedDebt,
      composition: {
        tuition: compTuition,
        books: compBooks,
        living: compLiving,
        other: compOther,
      },
    };
  }

  global.parseNonNegativeNumber = parseNonNegativeNumber;
  global.computeStudentDebtScenario = computeStudentDebtScenario;
})(typeof window !== "undefined" ? window : globalThis);
