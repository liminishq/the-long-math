/**
 * Rebuilds scenario1/scenario2 monthly debt CSVs from existing templates:
 * - Keeps Month, Stage, tuition/fees, summer offset, stipend, electives, CaRMS, exam, college fee, repayment.
 * - Living: Scenario 1 — UG $2,000/mo, NOSM MD $3,500/mo, residency $0.
 *            Scenario 2 — UG / MSc / MD $2,500/mo, Jul/Aug PGY1 $2,500, then residency $0.
 * - Interest (4.45% APR, monthly): matches prior spreadsheet-style rules:
 *   - Tuition month: intSeg(open, open + tuition + living); stipend/summer/etc. added after (not in average).
 *   - Living-only month: intSeg(open, open + living).
 *   - Living + summer offset same month: interest = open * r (no average on draws).
 *   - No tuition and no living: interest = open * r (residency and similar).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const R = 0.0445 / 12;
const HEADERS = [
  "Month",
  "Stage",
  "Opening Balance",
  "Tuition & Fees",
  "Living Expenses",
  "Summer Earnings Offset",
  "Stipend / Reimbursement",
  "Electives / Travel",
  "CaRMS Fees",
  "Exam / Licensing Fee",
  "Residency / College Fee",
  "Residency Repayment",
  "Interest Added",
  "Closing Balance",
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function intSeg(a, b) {
  return round2(((Number(a) + Number(b)) / 2) * R);
}

function parseCsvLine(line) {
  const row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (!q && ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  return row;
}

function livingForScenario1(stage) {
  if (/^Undergrad Year/i.test(stage)) return 2000;
  if (/^MD Year/i.test(stage)) return 3500;
  if (/^Residency/i.test(stage)) return 0;
  return 0;
}

function livingForScenario2(stage, month) {
  if (/^Undergrad Year/i.test(stage)) return 2500;
  if (/^MSc Year/i.test(stage)) return 2500;
  if (/^MD Year/i.test(stage)) return 2500;
  if (/^Residency PGY1/i.test(stage) && /^(Jul|Aug)-/i.test(String(month))) return 2500;
  if (/^Residency/i.test(stage)) return 0;
  return 0;
}

function scenario2Tuition(month, stage, currentTuition) {
  if (/^MD Year/i.test(stage) && /^Sep-/i.test(String(month))) return 27300.2;
  return currentTuition;
}

function scenario2Exam(month, stage, currentExam) {
  if (/^Residency PGY5/i.test(stage) && /^Jun-41$/i.test(String(month))) return 273.88;
  return currentExam;
}

function interestAndClose(open, tuition, living, summer, stipend, electives, carms, exam, college, repayment) {
  const post = round2(summer + stipend + electives + carms + exam + college + repayment);
  let intr;
  if (tuition !== 0) {
    intr = intSeg(open, open + tuition + living);
  } else if (living !== 0 && summer !== 0) {
    intr = round2(open * R);
  } else if (living !== 0) {
    intr = intSeg(open, open + living);
  } else {
    intr = round2(open * R);
  }
  const closing = round2(open + tuition + living + post + intr);
  return { intr, closing };
}

function rebuild(text, options) {
  const livingFn = options.livingFn;
  const tuitionFn = options.tuitionFn || ((month, stage, tuition) => tuition);
  const examFn = options.examFn || ((month, stage, exam) => exam);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.length);
  const out = [HEADERS.join(",")];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length < 14) continue;
    const month = c[0];
    const stage = c[1];
    const tuition = round2(tuitionFn(month, stage, round2(c[3])));
    const living = round2(livingFn(stage, month));
    const summer = round2(c[5]);
    const stipend = round2(c[6]);
    const electives = round2(c[7]);
    const carms = round2(c[8]);
    const exam = round2(examFn(month, stage, round2(c[9])));
    const college = round2(c[10]);
    const repayment = round2(c[11]);

    const prevClose = out.length > 1 ? round2(parseCsvLine(out[out.length - 1])[13]) : 0;
    const openBal = prevClose;

    const { intr, closing } = interestAndClose(
      openBal,
      tuition,
      living,
      summer,
      stipend,
      electives,
      carms,
      exam,
      college,
      repayment
    );

    out.push(
      [
        month,
        stage,
        openBal.toFixed(2),
        tuition.toFixed(2),
        living.toFixed(2),
        summer.toFixed(2),
        stipend.toFixed(2),
        electives.toFixed(2),
        carms.toFixed(2),
        exam.toFixed(2),
        college.toFixed(2),
        repayment.toFixed(2),
        intr.toFixed(2),
        closing.toFixed(2),
      ].join(",")
    );
  }
  return out.join("\n") + "\n";
}

const dataDir = path.join(__dirname, "..", "assets", "data");
const s1Path = path.join(dataDir, "scenario1_monthly_debt_schedule.csv");
const s2Path = path.join(dataDir, "scenario2_monthly_debt_schedule.csv");

const s1New = rebuild(fs.readFileSync(s1Path, "utf8"), {
  livingFn: livingForScenario1,
});
const s2New = rebuild(fs.readFileSync(s2Path, "utf8"), {
  livingFn: livingForScenario2,
  tuitionFn: scenario2Tuition,
  examFn: scenario2Exam,
});

fs.writeFileSync(s1Path, s1New);
fs.writeFileSync(s2Path, s2New);

function lastMdRow(csv, sub) {
  const lines = csv.split("\n");
  let last = null;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c[1] && c[1].includes(sub)) last = c;
  }
  return last;
}

function lastRow(csv) {
  const lines = csv.trim().split("\n");
  return parseCsvLine(lines[lines.length - 1]);
}

console.log("Scenario 1 last MD month closing:", lastMdRow(s1New, "MD Year")[13]);
console.log("Scenario 1 end practice closing:", lastRow(s1New)[13]);
console.log("Scenario 2 last MD month closing:", lastMdRow(s2New, "MD Year")[13]);
console.log("Scenario 2 end practice closing:", lastRow(s2New)[13]);
