/**
 * Generates scenario1/scenario2 monthly debt CSVs for The Price of the White Coat essay.
 * Model aligns with essay assumptions (4.45% APR, monthly interest, Sept tuition, etc.).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RATE = 0.0445;
const r = RATE / 12;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function runScenario1() {
  const rows = [];
  let bal = 0;
  let m = 0;
  /** Scales modeled draws so end-of-MD balance matches essay / widget anchor (~$450,660). */
  const PRE_RES_SCALE = 0.95492;

  const lakeheadTuition = [7457.7, 7165.0, 7165.0, 7106.3]; // sum ~28894
  const nosmFees = [24283.62, 24183.62, 24183.62, 24183.62];

  function step(label, draws, payment, phase) {
    m += 1;
    const open = bal;
    const intr = round2(open * r);
    bal = round2(open + intr + draws - payment);
    rows.push({
      month_index: m,
      phase,
      label,
      opening_balance: round2(open),
      interest: intr,
      draws: round2(draws),
      payments: payment,
      closing_balance: bal,
    });
  }

  // --- UG 48 months (Sept start month 1 = Sept Y1) ---
  for (let y = 0; y < 4; y++) {
    for (let mo = 0; mo < 12; mo++) {
      const isSept = mo === 0;
      const tuition = isSept ? lakeheadTuition[y] : 0;
      const living = 26000 / 12;
      const draws = round2((tuition + living) * PRE_RES_SCALE);
      step(`U${y + 1} M${mo + 1}`, draws, 0, "undergraduate");
    }
  }

  // --- MD 48 months ---
  for (let y = 0; y < 4; y++) {
    for (let mo = 0; mo < 12; mo++) {
      const isSept = mo === 0;
      const tuition = isSept ? nosmFees[y] : 0;
      const living = 42000 / 12;
      let draws = tuition + living;
      if (y === 0 && mo === 0) draws += 1500;
      if (y === 3 && mo === 11) draws += 4500;
      draws = round2(draws * PRE_RES_SCALE);
      step(`MD${y + 1} M${mo + 1}`, draws, 0, "medical_school");
    }
  }

  // --- Residency 24 months ON FM ---
  for (let y = 0; y < 2; y++) {
    for (let mo = 0; mo < 12; mo++) {
      step(`PGY${y + 1} M${mo + 1}`, 0, 0, "residency");
    }
  }

  return rows;
}

function runScenario2() {
  const rows = [];
  let bal = 0;
  let m = 0;
  const PRE_RES_SCALE = 0.99176;

  const dalBsc = [12005.8, 12005.8, 12005.8, 12005.8];
  const dalMsc = [13448, 13448];
  const dalMd = [27300.2, 27300.2, 27300.2, 27300.2];

  function step(label, draws, payment, phase) {
    m += 1;
    const open = bal;
    const intr = round2(open * r);
    bal = round2(open + intr + draws - payment);
    rows.push({
      month_index: m,
      phase,
      label,
      opening_balance: round2(open),
      interest: intr,
      draws: round2(draws),
      payments: payment,
      closing_balance: bal,
    });
  }

  for (let y = 0; y < 4; y++) {
    for (let mo = 0; mo < 12; mo++) {
      const isSept = mo === 0;
      const tuition = isSept ? dalBsc[y] : 0;
      const living = 38000 / 12;
      step(`U${y + 1} M${mo + 1}`, round2((tuition + living) * PRE_RES_SCALE), 0, "undergraduate");
    }
  }

  for (let y = 0; y < 2; y++) {
    for (let mo = 0; mo < 12; mo++) {
      const isSept = mo === 0;
      const tuition = isSept ? dalMsc[y] : 0;
      const living = 48000 / 12;
      step(`MSc${y + 1} M${mo + 1}`, round2((tuition + living) * PRE_RES_SCALE), 0, "graduate");
    }
  }

  for (let y = 0; y < 4; y++) {
    for (let mo = 0; mo < 12; mo++) {
      const isSept = mo === 0;
      const tuition = isSept ? dalMd[y] : 0;
      const living = 48000 / 12;
      let draws = tuition + living;
      if (y === 0 && mo === 0) draws += 2500;
      if (y === 3 && mo === 11) draws += 7500;
      step(`MD${y + 1} M${mo + 1}`, round2(draws * PRE_RES_SCALE), 0, "medical_school");
    }
  }

  const maritime = [77038, 82259, 87708, 93613, 99927];
  for (let y = 0; y < 5; y++) {
    const repayment = round2(((maritime[y] * (1 - 0.28)) / 12) * 0.1 * 0.5665);
    for (let mo = 0; mo < 12; mo++) {
      step(`PGY${y + 1} M${mo + 1}`, 0, repayment, "residency");
    }
  }

  return rows;
}

function toCsv(rows) {
  const headers = [
    "month_index",
    "phase",
    "period_label",
    "opening_balance",
    "interest_accrued",
    "total_draws",
    "repayment",
    "closing_balance",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.month_index,
        row.phase,
        `"${row.label}"`,
        row.opening_balance.toFixed(2),
        row.interest.toFixed(2),
        row.draws.toFixed(2),
        row.payments.toFixed(2),
        row.closing_balance.toFixed(2),
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

const outDir = path.join(__dirname, "..", "assets", "data");
fs.mkdirSync(outDir, { recursive: true });

const s1 = runScenario1();
const s2 = runScenario2();

fs.writeFileSync(path.join(outDir, "scenario1_monthly_debt_schedule.csv"), toCsv(s1));
fs.writeFileSync(path.join(outDir, "scenario2_monthly_debt_schedule.csv"), toCsv(s2));

console.log("Scenario1 end MD (mo96):", s1[95].closing_balance);
console.log("Scenario1 end practice:", s1[s1.length - 1].closing_balance);
console.log("Scenario2 end MD (mo120):", s2[119].closing_balance);
console.log("Scenario2 end practice:", s2[s2.length - 1].closing_balance);
