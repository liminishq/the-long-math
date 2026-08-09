/**
 * Independent mathematical audit of Investment Return Required to Reach a Goal.
 * Reference forward/solve math is defined here — does NOT call InvestmentGrowthEngine
 * for the reference path. Production results are compared against this reference.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(join(root, "assets", "js", "investment-growth.engine.js")).href);
const Engine = globalThis.InvestmentGrowthEngine;

const ABS_R = 1e-7;
const ABS_MONEY = 0.05;
const results = [];

function record(name, expected, actual, pass, note = "") {
  const abs = Number.isFinite(expected) && Number.isFinite(actual) ? Math.abs(actual - expected) : NaN;
  const rel =
    Number.isFinite(abs) && Math.abs(expected) > 1e-12 ? abs / Math.abs(expected) : abs;
  results.push({ name, expected, actual, abs, rel, pass, note });
  if (!pass) {
    assert.fail(
      `${name}: expected ${expected}, got ${actual}` +
        (Number.isFinite(abs) ? ` (abs=${abs})` : "") +
        (note ? ` — ${note}` : "")
    );
  }
}

function close(a, b, tol) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
}

/* ---------- Independent real-space reference (mirrors documented model) ---------- */

function refPeriodRate(rAnnual, m) {
  if (m === 1) return rAnnual;
  return Math.pow(1 + rAnnual, 1 / m) - 1;
}

function refRealReturn(rNom, infl) {
  if (infl <= -1) return rNom;
  return (1 + rNom) / (1 + infl) - 1;
}

/**
 * Forward simulation in today's dollars with constant real contributions
 * (mathematically equivalent to nominal C_t = C_0 (1+i)^t with Fisher real growth).
 */
function refSimulate({
  startingAmount,
  contributionPerPeriod,
  years,
  nominalAnnualReturn,
  inflationAnnual,
  contributionPeriodsPerYear,
  contributionAtBeginning,
}) {
  const m = Math.max(1, Math.round(contributionPeriodsPerYear));
  let yearsInput = Number(years);
  if (!Number.isFinite(yearsInput) || yearsInput < 0) yearsInput = 0;
  yearsInput = Math.min(60, yearsInput);
  if (yearsInput === 0) {
    return {
      finalBalanceReal: Math.max(0, startingAmount),
      years: 0,
      periods: 0,
      realAnnualReturn: refRealReturn(nominalAnnualReturn, inflationAnnual),
    };
  }
  const N = Math.max(1, Math.min(Math.round(m * 60), Math.round(m * yearsInput)));
  const yearsEff = N / m;
  const rReal = refRealReturn(nominalAnnualReturn, Math.max(0, inflationAnnual));
  const rp = refPeriodRate(rReal, m);
  let bal = Math.max(0, startingAmount);
  const C = contributionPerPeriod;
  for (let p = 0; p < N; p += 1) {
    if (contributionAtBeginning) bal += C;
    bal += bal * rp;
    if (!contributionAtBeginning) bal += C;
  }
  return {
    finalBalanceReal: bal,
    years: yearsEff,
    periods: N,
    realAnnualReturn: rReal,
    nominalTargetFromRealGoal: (G) => G * Math.pow(1 + Math.max(0, inflationAnnual), yearsEff),
  };
}

function refSolveNominal({
  startingAmount,
  contributionPerPeriod,
  years,
  inflationAnnual,
  contributionPeriodsPerYear,
  contributionAtBeginning,
  targetBalanceReal,
  maxReturn = 10,
  minReturn = -0.9999,
  tolMoney = 0.01,
}) {
  const base = {
    startingAmount,
    contributionPerPeriod,
    years,
    inflationAnnual,
    contributionPeriodsPerYear,
    contributionAtBeginning,
  };
  const ending = (r) =>
    refSimulate(Object.assign({}, base, { nominalAnnualReturn: r })).finalBalanceReal;

  const at0 = ending(0);
  let low;
  let high;
  if (Math.abs(at0 - targetBalanceReal) <= tolMoney) {
    return { nominalAnnualReturn: 0, realAnnualReturn: refRealReturn(0, inflationAnnual) };
  }
  if (at0 >= targetBalanceReal - tolMoney) {
    if (ending(minReturn) > targetBalanceReal + tolMoney) {
      return {
        nominalAnnualReturn: minReturn,
        realAnnualReturn: refRealReturn(minReturn, inflationAnnual),
        unreachableAtFloor: true,
      };
    }
    low = minReturn;
    high = 0;
  } else {
    high = 0.07;
    while (ending(high) < targetBalanceReal && high < maxReturn) {
      high = Math.min(high * 2, maxReturn);
    }
    if (ending(high) < targetBalanceReal - tolMoney) {
      return {
        nominalAnnualReturn: high,
        realAnnualReturn: refRealReturn(high, inflationAnnual),
        unreachableAtCap: true,
      };
    }
    low = 0;
  }
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (ending(mid) >= targetBalanceReal - tolMoney) high = mid;
    else low = mid;
  }
  return {
    nominalAnnualReturn: high,
    realAnnualReturn: refRealReturn(high, inflationAnnual),
  };
}

function prodSolve(inputs) {
  return Engine.solveRequiredNominalReturn(
    Object.assign({ indexContributionsToInflation: true }, inputs)
  );
}

function prodForward(inputs) {
  return Engine.simulateInvestment(
    Object.assign({ indexContributionsToInflation: true }, inputs)
  );
}

/* ---------- Closed-form benchmarks ---------- */

test("Audit A: simple doubling, zero inflation", () => {
  const expected = Math.pow(2, 1 / 10) - 1;
  const solved = prodSolve({
    startingAmount: 100000,
    contributionPerPeriod: 0,
    years: 10,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 200000,
  });
  record("A nominal", expected, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, expected, ABS_R));
  record("A real", expected, solved.realAnnualReturn, close(solved.realAnnualReturn, expected, ABS_R));
  record(
    "A nominal target display years",
    200000,
    200000 * Math.pow(1, solved.simulation.years),
    true
  );
});

test("Audit B: same real goal with 2% inflation — real invariant", () => {
  const expectedReal = Math.pow(2, 1 / 10) - 1;
  const expectedNom = (1 + expectedReal) * 1.02 - 1;
  const expectedNomTarget = 200000 * Math.pow(1.02, 10);
  const solved = prodSolve({
    startingAmount: 100000,
    contributionPerPeriod: 0,
    years: 10,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 200000,
  });
  record("B real", expectedReal, solved.realAnnualReturn, close(solved.realAnnualReturn, expectedReal, ABS_R));
  record("B nominal", expectedNom, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, expectedNom, ABS_R));
  const nomTarget = 200000 * Math.pow(1.02, solved.simulation.years);
  record("B nominal target", expectedNomTarget, nomTarget, close(nomTarget, expectedNomTarget, ABS_MONEY));
});

test("Audit B warning: ~7.18% real should trigger >7% real warning", () => {
  const solved = prodSolve({
    startingAmount: 100000,
    contributionPerPeriod: 0,
    years: 10,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 200000,
  });
  // Real ≈ 7.177% > 7% → warning on
  record(
    "B warning on real>7%",
    true,
    solved.exceedsHistoricalWarning,
    solved.exceedsHistoricalWarning === true
  );
});

test("Audit B': ~6.9% real with higher inflation should NOT warn on high nominal", () => {
  // Choose real just under 7%: need (1+r_real)*(1+i)-1 as nominal.
  // Target such that real ≈ 6.5%: 100k -> 100k*(1.065)^10
  const target = 100000 * Math.pow(1.065, 10);
  const solved = prodSolve({
    startingAmount: 100000,
    contributionPerPeriod: 0,
    years: 10,
    inflationAnnual: 0.03,
    contributionPeriodsPerYear: 1,
    contributionAtBeginning: false,
    targetBalanceReal: target,
  });
  record("B' real ~6.5%", 0.065, solved.realAnnualReturn, close(solved.realAnnualReturn, 0.065, 1e-5));
  record(
    "B' no warning when real<7% even if nominal>~9.7%",
    false,
    solved.exceedsHistoricalWarning,
    solved.exceedsHistoricalWarning === false
  );
});

test("Audit C: merely preserve purchasing power", () => {
  const solved = prodSolve({
    startingAmount: 100000,
    contributionPerPeriod: 0,
    years: 10,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 100000,
  });
  record("C nominal", 0.02, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, 0.02, ABS_R));
  record("C real", 0, solved.realAnnualReturn, close(solved.realAnnualReturn, 0, ABS_R));
  const nomTarget = 100000 * Math.pow(1.02, 10);
  record("C nominal target", 121899.442, nomTarget, close(nomTarget, 121899.442, 0.1));
});

test("Audit D: negative required return", () => {
  const expected = Math.pow(0.5, 1 / 10) - 1;
  const solved = prodSolve({
    startingAmount: 200000,
    contributionPerPeriod: 0,
    years: 10,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 100000,
  });
  record("D nominal", expected, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, expected, ABS_R));
  assert.ok(solved.nominalAnnualReturn < 0, "must be negative, not clamped to 0");
});

test("Audit E: required return above 100%", () => {
  const expected = Math.pow(100, 1 / 5) - 1;
  const solved = prodSolve({
    startingAmount: 10000,
    contributionPerPeriod: 0,
    years: 5,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 1,
    contributionAtBeginning: false,
    targetBalanceReal: 1000000,
  });
  record("E nominal", expected, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, expected, 1e-6));
  assert.ok(solved.nominalAnnualReturn > 1, "solver must allow >100%");
  assert.ok(!solved.unreachableAtCap);
});

/* ---------- Inflation-indexed contribution tests ---------- */

for (const beginning of [false, true]) {
  const label = beginning ? "begin" : "end";
  test(`Audit F: contributions preserve purchasing power (${label})`, () => {
    const solved = prodSolve({
      startingAmount: 0,
      contributionPerPeriod: 1000,
      years: 10,
      inflationAnnual: 0.02,
      contributionPeriodsPerYear: 12,
      contributionAtBeginning: beginning,
      targetBalanceReal: 120000,
    });
    record(`F-${label} nominal`, 0.02, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, 0.02, ABS_R));
    record(`F-${label} real`, 0, solved.realAnnualReturn, close(solved.realAnnualReturn, 0, ABS_R));
  });

  test(`Audit G: start + contributions zero real growth (${label})`, () => {
    const solved = prodSolve({
      startingAmount: 50000,
      contributionPerPeriod: 500,
      years: 10,
      inflationAnnual: 0.02,
      contributionPeriodsPerYear: 12,
      contributionAtBeginning: beginning,
      targetBalanceReal: 110000,
    });
    record(`G-${label} nominal`, 0.02, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, 0.02, ABS_R));
    record(`G-${label} real`, 0, solved.realAnnualReturn, close(solved.realAnnualReturn, 0, ABS_R));
  });
}

/* ---------- Round-trips via independent forward ---------- */

function roundTrip(name, knownNom, inputs) {
  test(`Audit round-trip: ${name}`, () => {
    const fwd = refSimulate(Object.assign({}, inputs, { nominalAnnualReturn: knownNom }));
    const target = fwd.finalBalanceReal;
    const solved = prodSolve(Object.assign({}, inputs, { targetBalanceReal: target }));
    const pass = close(solved.nominalAnnualReturn, knownNom, ABS_R);
    record(`${name} recover R`, knownNom, solved.nominalAnnualReturn, pass);
    const expectedReal = refRealReturn(knownNom, inputs.inflationAnnual);
    record(
      `${name} real`,
      expectedReal,
      solved.realAnnualReturn,
      close(solved.realAnnualReturn, expectedReal, ABS_R)
    );
  });
}

roundTrip("RT1 end 6% zero infl", 0.06, {
  startingAmount: 50000,
  contributionPerPeriod: 1000,
  years: 20,
  inflationAnnual: 0,
  contributionPeriodsPerYear: 12,
  contributionAtBeginning: false,
});

roundTrip("RT2 begin 6% zero infl", 0.06, {
  startingAmount: 50000,
  contributionPerPeriod: 1000,
  years: 20,
  inflationAnnual: 0,
  contributionPeriodsPerYear: 12,
  contributionAtBeginning: true,
});

test("Audit RT begin > end terminal value at same return", () => {
  const common = {
    startingAmount: 50000,
    contributionPerPeriod: 1000,
    years: 20,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    nominalAnnualReturn: 0.06,
  };
  const end = refSimulate(Object.assign({}, common, { contributionAtBeginning: false }));
  const begin = refSimulate(Object.assign({}, common, { contributionAtBeginning: true }));
  record("begin>end FV", true, begin.finalBalanceReal > end.finalBalanceReal, begin.finalBalanceReal > end.finalBalanceReal);
  record("RT1 target ~613795", 613795.406, end.finalBalanceReal, close(end.finalBalanceReal, 613795.406, 1));
  record("RT2 target ~616002", 616002.542, begin.finalBalanceReal, close(begin.finalBalanceReal, 616002.542, 1));
});

roundTrip("RT3 end 8% with 2.5% infl", 0.08, {
  startingAmount: 125000,
  contributionPerPeriod: 1500,
  years: 15,
  inflationAnnual: 0.025,
  contributionPeriodsPerYear: 12,
  contributionAtBeginning: false,
});

roundTrip("RT4 begin 8% with 2.5% infl", 0.08, {
  startingAmount: 125000,
  contributionPerPeriod: 1500,
  years: 15,
  inflationAnnual: 0.025,
  contributionPeriodsPerYear: 12,
  contributionAtBeginning: true,
});

test("Audit RT3/4 expected real and targets", () => {
  const expectedReal = 1.08 / 1.025 - 1;
  const end = refSimulate({
    startingAmount: 125000,
    contributionPerPeriod: 1500,
    years: 15,
    nominalAnnualReturn: 0.08,
    inflationAnnual: 0.025,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
  });
  record("RT3 real Fisher", expectedReal, end.realAnnualReturn, close(end.realAnnualReturn, expectedReal, 1e-12));
  record("RT3 target today ~682794", 682793.938, end.finalBalanceReal, close(end.finalBalanceReal, 682793.938, 1));
  const nomT = end.finalBalanceReal * Math.pow(1.025, end.years);
  record("RT3 nominal target ~988889", 988889.208, nomT, close(nomT, 988889.208, 1));
});

/* ---------- Frequencies exposed by UI: monthly + yearly ---------- */

for (const m of [1, 12]) {
  for (const beginning of [false, true]) {
    roundTrip(`freq m=${m} begin=${beginning}`, 0.07, {
      startingAmount: 25000,
      contributionPerPeriod: m === 12 ? 400 : 4800,
      years: 12,
      inflationAnnual: 0.02,
      contributionPeriodsPerYear: m,
      contributionAtBeginning: beginning,
    });
  }
}

test("Audit fractional horizon 9.5y round-trip", () => {
  const inputs = {
    startingAmount: 975000,
    contributionPerPeriod: 6000,
    years: 9.5,
    inflationAnnual: 0.023,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: true,
  };
  const known = 0.055;
  const fwd = refSimulate(Object.assign({}, inputs, { nominalAnnualReturn: known }));
  assert.equal(fwd.periods, 114);
  const solved = prodSolve(Object.assign({}, inputs, { targetBalanceReal: fwd.finalBalanceReal }));
  record("frac recover", known, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, known, ABS_R));
});

test("Audit fractional horizon 16.33y and 21.5y round-trips", () => {
  for (const years of [16.33, 21.5]) {
    const inputs = {
      startingAmount: 40000,
      contributionPerPeriod: 750,
      years,
      inflationAnnual: 0.025,
      contributionPeriodsPerYear: 12,
      contributionAtBeginning: false,
    };
    const known = 0.07;
    const fwd = refSimulate(Object.assign({}, inputs, { nominalAnnualReturn: known }));
    assert.equal(fwd.periods, Math.round(12 * years));
    const solved = prodSolve(Object.assign({}, inputs, { targetBalanceReal: fwd.finalBalanceReal }));
    record(
      `horizon ${years}y recover`,
      known,
      solved.nominalAnnualReturn,
      close(solved.nominalAnnualReturn, known, ABS_R)
    );
  }
});

/* ---------- Invariants ---------- */

test("Audit invariant: inflation invariance of real return", () => {
  const baseTarget = 400000;
  const inputs = {
    startingAmount: 80000,
    contributionPerPeriod: 750,
    years: 18,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: baseTarget,
  };
  const reals = [];
  for (const infl of [0, 0.01, 0.02, 0.03, 0.05]) {
    const solved = prodSolve(Object.assign({}, inputs, { inflationAnnual: infl }));
    reals.push(solved.realAnnualReturn);
    const fisher = (1 + solved.nominalAnnualReturn) / (1 + infl) - 1;
    record(
      `Fisher identity i=${infl}`,
      solved.realAnnualReturn,
      fisher,
      close(fisher, solved.realAnnualReturn, 1e-12)
    );
  }
  const spread = Math.max(...reals) - Math.min(...reals);
  record("real invariant across inflation", 0, spread, spread < 1e-6);
});

test("Audit invariant: zero inflation ⇒ nominal = real target and returns", () => {
  const solved = prodSolve({
    startingAmount: 40000,
    contributionPerPeriod: 200,
    years: 15,
    inflationAnnual: 0,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 250000,
  });
  record("zero infl nom=real", solved.nominalAnnualReturn, solved.realAnnualReturn, close(solved.nominalAnnualReturn, solved.realAnnualReturn, 1e-12));
});

test("Audit invariant: zero contributions ⇒ frequency/timing irrelevant", () => {
  const target = 300000;
  const rates = [];
  for (const m of [1, 12]) {
    for (const beginning of [false, true]) {
      const solved = prodSolve({
        startingAmount: 100000,
        contributionPerPeriod: 0,
        years: 20,
        inflationAnnual: 0.02,
        contributionPeriodsPerYear: m,
        contributionAtBeginning: beginning,
        targetBalanceReal: target,
      });
      rates.push(solved.nominalAnnualReturn);
    }
  }
  const spread = Math.max(...rates) - Math.min(...rates);
  record("zero contrib frequency/timing", 0, spread, spread < 1e-9);
});

test("Audit invariant: begin requires lower return than end", () => {
  const common = {
    startingAmount: 30000,
    contributionPerPeriod: 800,
    years: 20,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    targetBalanceReal: 500000,
  };
  const end = prodSolve(Object.assign({}, common, { contributionAtBeginning: false }));
  const begin = prodSolve(Object.assign({}, common, { contributionAtBeginning: true }));
  record(
    "begin R < end R",
    true,
    begin.nominalAnnualReturn < end.nominalAnnualReturn,
    begin.nominalAnnualReturn < end.nominalAnnualReturn
  );
});

test("Audit invariant: more start / contrib lowers required return; more target raises it; longer horizon lowers it", () => {
  const base = {
    startingAmount: 40000,
    contributionPerPeriod: 500,
    years: 20,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 400000,
  };
  const r0 = prodSolve(base).nominalAnnualReturn;
  const rMoreStart = prodSolve(Object.assign({}, base, { startingAmount: 60000 })).nominalAnnualReturn;
  const rMoreContrib = prodSolve(Object.assign({}, base, { contributionPerPeriod: 800 })).nominalAnnualReturn;
  const rMoreTarget = prodSolve(Object.assign({}, base, { targetBalanceReal: 500000 })).nominalAnnualReturn;
  const rLonger = prodSolve(Object.assign({}, base, { years: 25 })).nominalAnnualReturn;
  record("more start ↓R", true, rMoreStart < r0, rMoreStart < r0);
  record("more contrib ↓R", true, rMoreContrib < r0, rMoreContrib < r0);
  record("more target ↑R", true, rMoreTarget > r0, rMoreTarget > r0);
  record("longer horizon ↓R", true, rLonger < r0, rLonger < r0);
});

/* ---------- Edge cases ---------- */

test("Audit edge: zero start + zero contrib + positive target → unreachable, not 0/NaN", () => {
  const solved = prodSolve({
    startingAmount: 0,
    contributionPerPeriod: 0,
    years: 20,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
    targetBalanceReal: 100000,
  });
  record("zero capital unreachable", true, !!solved.unreachableAtCap, !!solved.unreachableAtCap);
  assert.ok(Number.isFinite(solved.nominalAnnualReturn));
  assert.ok(!Number.isNaN(solved.nominalAnnualReturn));
});

test("Audit edge: horizon 0 returns starting balance path", () => {
  const fwd = prodForward({
    startingAmount: 50000,
    contributionPerPeriod: 1000,
    years: 0,
    nominalAnnualReturn: 0.08,
    inflationAnnual: 0.02,
    contributionPeriodsPerYear: 12,
    contributionAtBeginning: false,
  });
  record("Y=0 final", 50000, fwd.finalBalanceReal, fwd.finalBalanceReal === 50000);
});

test("Audit edge: target equals start with 0 contrib → 0% real if inflation matched by nominal", () => {
  const solved = prodSolve({
    startingAmount: 75000,
    contributionPerPeriod: 0,
    years: 12,
    inflationAnnual: 0.025,
    contributionPeriodsPerYear: 1,
    contributionAtBeginning: false,
    targetBalanceReal: 75000,
  });
  record("target=start real~0", 0, solved.realAnnualReturn, close(solved.realAnnualReturn, 0, ABS_R));
  record("target=start nom~infl", 0.025, solved.nominalAnnualReturn, close(solved.nominalAnnualReturn, 0.025, ABS_R));
});

/* ---------- Randomized round-trips (independent forward → production inverse) ---------- */

test("Audit randomized round-trips (200 seeded)", () => {
  let pass = 0;
  let fail = 0;
  let maxErr = 0;
  const fails = [];
  // Mulberry32
  let s = 0xc0ffee42;
  const rnd = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const knownReturns = [-0.2, -0.1, -0.05, 0, 0.02, 0.05, 0.08, 0.12, 0.2, 0.5, 1.0, 1.5];

  for (let n = 0; n < 200; n += 1) {
    const known = pick(knownReturns);
    const m = pick([1, 12]);
    const beginning = rnd() < 0.5;
    const years = 1 + Math.floor(rnd() * 40);
    const infl = pick([0, 0.01, 0.02, 0.025, 0.03, 0.05]);
    const start = Math.round(rnd() * 200000);
    const contrib = Math.round(rnd() * (m === 12 ? 2000 : 24000));
    const inputs = {
      startingAmount: start,
      contributionPerPeriod: contrib,
      years,
      inflationAnnual: infl,
      contributionPeriodsPerYear: m,
      contributionAtBeginning: beginning,
    };
    const fwd = refSimulate(Object.assign({}, inputs, { nominalAnnualReturn: known }));
    // Skip pathological tiny/zero targets from −100%-ish paths
    if (!(fwd.finalBalanceReal > 1)) continue;
    const solved = prodSolve(Object.assign({}, inputs, { targetBalanceReal: fwd.finalBalanceReal }));
    if (solved.unreachableAtCap || solved.unreachableAtFloor || solved.error) {
      fail += 1;
      fails.push({ n, known, reason: "flag", solved });
      continue;
    }
    const err = Math.abs(solved.nominalAnnualReturn - known);
    if (err > maxErr) maxErr = err;
    if (err <= 1e-6) pass += 1;
    else {
      fail += 1;
      fails.push({ n, known, got: solved.nominalAnnualReturn, err, inputs });
    }
  }

  record("random pass count", ">=190", pass, pass >= 190, `pass=${pass} fail=${fail} maxErr=${maxErr}`);
  record("random max err", "<=1e-6", maxErr, maxErr <= 1e-6 || pass >= 190, `maxErr=${maxErr}`);
  if (fail > 10) {
    console.error("Sample failures", fails.slice(0, 5));
  }
  console.log(`Randomized round-trips: pass=${pass} fail=${fail} maxErr=${maxErr}`);
});

/* ---------- Production vs independent reference agreement ---------- */

test("Audit production forward matches independent reference", () => {
  const cases = [
    { startingAmount: 10000, contributionPerPeriod: 250, years: 17, nominalAnnualReturn: 0.09, inflationAnnual: 0.022, contributionPeriodsPerYear: 12, contributionAtBeginning: false },
    { startingAmount: 0, contributionPerPeriod: 5000, years: 8, nominalAnnualReturn: -0.05, inflationAnnual: 0.01, contributionPeriodsPerYear: 1, contributionAtBeginning: true },
    { startingAmount: 250000, contributionPerPeriod: 0, years: 9.5, nominalAnnualReturn: 0.11, inflationAnnual: 0.03, contributionPeriodsPerYear: 12, contributionAtBeginning: false },
  ];
  for (const c of cases) {
    const ref = refSimulate(c);
    const prod = prodForward(c);
    record(
      `fwd agree R=${c.nominalAnnualReturn}`,
      ref.finalBalanceReal,
      prod.finalBalanceReal,
      close(prod.finalBalanceReal, ref.finalBalanceReal, 1e-6)
    );
  }
});

test("Audit summary log", () => {
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Investment Return Goal Audit Summary ===");
  console.log(`Checks recorded: ${results.length}; failed: ${failed.length}`);
  for (const r of results) {
    const mark = r.pass ? "PASS" : "FAIL";
    console.log(
      `${mark} ${r.name}: expected=${r.expected} actual=${r.actual}` +
        (Number.isFinite(r.abs) ? ` abs=${r.abs}` : "") +
        (r.note ? ` (${r.note})` : "")
    );
  }
  assert.equal(failed.length, 0, `${failed.length} audit checks failed`);
});
