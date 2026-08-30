// TFSA Over-Contribution Penalty Calculator — UI only: reads inputs, calls engine, writes outputs.
// Supports Simple mode (default) and Advanced mode.

(function () {
  "use strict";

  const DEFAULT_MODE = "simple";

  let currentMode = DEFAULT_MODE;

  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function num(x) {
    if (x == null) return NaN;
    const s = String(x).trim().replace(/,/g, "");
    if (s === "") return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmtCAD(n) {
    if (!Number.isFinite(n)) return "$–";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0
    });
  }

  function fmtCADCents(n) {
    if (!Number.isFinite(n)) return "$–";
    return Number(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    });
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function defaultTransactions() {
    return [
      { date: "2026-01-10", type: "contribution", amount: 9000 },
      { date: "2026-02-15", type: "withdrawal", amount: 1000 },
      { date: "2026-03-03", type: "contribution", amount: 500 }
    ];
  }

  function readTransactions() {
    const rows = $("txn_body").querySelectorAll("tr[data-txn]");
    const out = [];
    for (const row of rows) {
      const dateInput = row.querySelector('input[type="date"]');
      const typeSelect = row.querySelector("select");
      const amountInput = row.querySelector('input[type="number"]');
      if (!dateInput || !typeSelect || !amountInput) continue;
      const date = dateInput.value;
      const type = typeSelect.value;
      const amount = num(amountInput.value);
      if (!date || !type) continue;
      if (!Number.isFinite(amount) || amount < 0) continue;
      out.push({ date, type, amount });
    }
    return out;
  }

  function readInputs() {
    const startDate = $("start_date").value || "";
    const endDate = $("end_date").value || "";
    const startingRoom = num($("starting_room").value);
    const startingExcess = num($("starting_excess").value);
    const annualJan1Room = num($("annual_jan1_room").value);
    const transactions = readTransactions();
    return {
      startDate,
      endDate,
      startingRoom: Number.isFinite(startingRoom) && startingRoom >= 0 ? startingRoom : 0,
      startingExcess: Number.isFinite(startingExcess) && startingExcess >= 0 ? startingExcess : 0,
      annualJan1Room: Number.isFinite(annualJan1Room) && annualJan1Room >= 0 ? annualJan1Room : 0,
      transactions
    };
  }

  function validateInputs(inp) {
    if (!inp.startDate || !inp.endDate) return { ok: false, message: "Please set both start and end date." };
    const start = new Date(inp.startDate + "T12:00:00");
    const end = new Date(inp.endDate + "T12:00:00");
    if (isNaN(start.getTime())) return { ok: false, message: "Invalid start date." };
    if (isNaN(end.getTime())) return { ok: false, message: "Invalid end date." };
    if (end.getTime() < start.getTime()) return { ok: false, message: "End date must be on or after start date." };
    return { ok: true };
  }

  function addTransactionRow(data) {
    const tbody = $("txn_body");
    const tr = document.createElement("tr");
    tr.setAttribute("data-txn", "1");
    const date = data && data.date ? data.date : "";
    const type = (data && data.type) ? data.type : "contribution";
    const amount = (data && data.amount != null) ? String(data.amount) : "";
    tr.innerHTML =
      '<td><input type="date" value="' +
      date +
      '" aria-label="Transaction date" /></td>' +
      '<td><select aria-label="Transaction type">' +
      '<option value="contribution"' +
      (type === "contribution" ? " selected" : "") +
      ">Contribution</option>" +
      '<option value="withdrawal"' +
      (type === "withdrawal" ? " selected" : "") +
      ">Withdrawal</option>" +
      '<option value="room_adjustment"' +
      (type === "room_adjustment" ? " selected" : "") +
      ">Room adjustment</option>" +
      "</select></td>" +
      '<td><input type="number" inputmode="decimal" min="0" step="any" value="' +
      amount +
      '" placeholder="0" aria-label="Amount" /></td>' +
      '<td><button type="button" class="txn-remove" aria-label="Remove row">Remove</button></td>';
    tbody.appendChild(tr);

    const removeBtn = tr.querySelector(".txn-remove");
    removeBtn.addEventListener("click", function () {
      tr.remove();
      renderAdvanced();
    });
    tr.querySelectorAll("input, select").forEach(function (el) {
      el.addEventListener("input", renderAdvanced);
      el.addEventListener("change", renderAdvanced);
    });
  }

  function setMode(mode) {
    currentMode = mode;
    const simpleSection = $("simple_section");
    const advancedSection = $("advanced_section");
    const btnSimple = $("mode_btn_simple");
    const btnAdvanced = $("mode_btn_advanced");
    const helperSimple = document.getElementById("mode_helper_simple");
    const helperAdvanced = document.getElementById("mode_helper_advanced");

    if (mode === "simple") {
      simpleSection.classList.remove("hidden");
      advancedSection.classList.add("hidden");
      btnSimple.classList.add("active");
      btnSimple.setAttribute("aria-selected", "true");
      btnAdvanced.classList.remove("active");
      btnAdvanced.setAttribute("aria-selected", "false");
      if (helperSimple) helperSimple.classList.remove("hidden");
      if (helperAdvanced) helperAdvanced.classList.add("hidden");
      renderSimple();
    } else {
      simpleSection.classList.add("hidden");
      advancedSection.classList.remove("hidden");
      btnSimple.classList.remove("active");
      btnSimple.setAttribute("aria-selected", "false");
      btnAdvanced.classList.add("active");
      btnAdvanced.setAttribute("aria-selected", "true");
      if (helperSimple) helperSimple.classList.add("hidden");
      if (helperAdvanced) helperAdvanced.classList.remove("hidden");
      renderAdvanced();
    }
  }

  function renderSimple() {
    const excessEl = $("simple_excess_amount");
    const monthsEl = $("simple_months");
    const excessErr = $("simple_excess_error");
    const monthsErr = $("simple_months_error");
    excessErr.textContent = "";
    monthsErr.textContent = "";

    const excessAmount = num(excessEl.value);
    const monthsAtExcess = num(monthsEl.value);

    const outPenalty = $("out_simple_penalty");
    const simpleEcho = $("simple_echo");

    if (excessEl.value.trim() === "" && monthsEl.value.trim() === "") {
      outPenalty.textContent = "$–";
      simpleEcho.style.display = "none";
      return;
    }

    if (!Number.isFinite(excessAmount) || excessAmount < 0) {
      if (excessEl.value.trim() !== "") excessErr.textContent = "Enter a non-negative amount.";
      outPenalty.textContent = "$–";
      simpleEcho.style.display = "none";
      return;
    }
    if (!Number.isFinite(monthsAtExcess) || monthsAtExcess < 0) {
      if (monthsEl.value.trim() !== "") monthsErr.textContent = "Enter a non-negative number of months.";
      outPenalty.textContent = "$–";
      simpleEcho.style.display = "none";
      return;
    }
    if (monthsAtExcess !== Math.floor(monthsAtExcess)) {
      monthsErr.textContent = "Enter a whole number of months.";
      outPenalty.textContent = "$–";
      simpleEcho.style.display = "none";
      return;
    }

    if (typeof window.calculateSimpleTfsaPenalty !== "function") {
      outPenalty.textContent = "Error: engine not loaded.";
      simpleEcho.style.display = "none";
      return;
    }

    const result = window.calculateSimpleTfsaPenalty(excessAmount, monthsAtExcess);
    if (result.error) {
      if (result.error.indexOf("months") !== -1) monthsErr.textContent = result.error;
      else excessErr.textContent = result.error;
      outPenalty.textContent = "$–";
      simpleEcho.style.display = "none";
      return;
    }

    outPenalty.textContent = fmtCADCents(result.penalty);
    simpleEcho.style.display = "block";
    simpleEcho.textContent = "Excess " + fmtCAD(excessAmount) + " × " + String(Math.floor(monthsAtExcess)) + " month(s) × 1% = " + fmtCADCents(result.penalty) + " estimated penalty.";
  }

  function renderAdvanced() {
    const inp = readInputs();

    const endErr = $("end_date_error");
    endErr.textContent = "";
    $("results_error").textContent = "";

    const validation = validateInputs(inp);
    if (!validation.ok) {
      if (inp.endDate && inp.startDate) {
        const end = new Date(inp.endDate + "T12:00:00");
        const start = new Date(inp.startDate + "T12:00:00");
        if (end.getTime() < start.getTime()) endErr.textContent = "End date must be on or after start date.";
      }
      $("results_content").style.display = "none";
      $("results_empty").style.display = "block";
      $("results_empty").textContent = validation.message;
      return;
    }

    if (typeof window.runTfsaOverContributionPenaltyEstimate !== "function") {
      $("results_content").style.display = "block";
      $("results_empty").style.display = "none";
      $("out_total_penalty").textContent = "Error: engine not loaded.";
      return;
    }

    const result = window.runTfsaOverContributionPenaltyEstimate(inp);

    if (result.error) {
      $("results_content").style.display = "block";
      $("results_empty").style.display = "none";
      $("results_error").textContent = result.error;
      $("out_total_penalty").textContent = "–";
      $("out_months_penalty").textContent = "–";
      $("out_peak_excess").textContent = "–";
      $("out_ending_excess").textContent = "–";
      $("monthly_body").innerHTML = "";
      return;
    }

    $("results_error").textContent = "";
    $("results_content").style.display = "block";
    $("results_empty").style.display = "none";

    $("out_total_penalty").textContent = fmtCADCents(result.totalPenalty);
    $("out_months_penalty").textContent = String(result.monthsWithPenalty);
    $("out_peak_excess").textContent = fmtCAD(result.peakExcess);
    $("out_ending_excess").textContent = fmtCAD(result.endingExcess);

    const monthlyBody = $("monthly_body");
    monthlyBody.innerHTML = "";
    for (const row of result.monthlyBreakdown || []) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        row.month +
        "</td>" +
        '<td class="numeric">' +
        fmtCAD(row.highestExcess) +
        "</td>" +
        '<td class="numeric">' +
        fmtCADCents(row.monthlyPenalty) +
        "</td>" +
        '<td class="numeric">' +
        fmtCAD(row.excessAtEndOfMonth) +
        "</td>";
      monthlyBody.appendChild(tr);
    }
  }

  function initAdvanced() {
    const startInput = $("start_date");
    const endInput = $("end_date");
    if (!startInput.value) startInput.value = "2026-01-01";
    if (!endInput.value) endInput.value = "2026-04-30";

    const tbody = $("txn_body");
    if (tbody.querySelectorAll("tr[data-txn]").length === 0) {
      defaultTransactions().forEach(function (t) {
        addTransactionRow(t);
      });
    }

    $("add_txn_btn").addEventListener("click", function () {
      addTransactionRow({});
      renderAdvanced();
    });

    ["start_date", "end_date", "starting_room", "starting_excess", "annual_jan1_room"].forEach(function (id) {
      const el = $(id);
      el.addEventListener("input", renderAdvanced);
      el.addEventListener("change", renderAdvanced);
    });
  }

  function init() {
    try {
      initAdvanced();

      $("mode_btn_simple").addEventListener("click", function () {
        setMode("simple");
      });
      $("mode_btn_advanced").addEventListener("click", function () {
        setMode("advanced");
      });

      $("simple_excess_amount").addEventListener("input", renderSimple);
      $("simple_excess_amount").addEventListener("change", renderSimple);
      $("simple_months").addEventListener("input", renderSimple);
      $("simple_months").addEventListener("change", renderSimple);

      setMode(DEFAULT_MODE);
    } catch (err) {
      console.error("TFSA Over-Contribution Calculator init failed:", err);
      var card = document.getElementById("calc_card");
      var errEl = document.getElementById("calc_init_error");
      if (card && errEl) {
        errEl.textContent = "Calculator failed to load. Check the console for details.";
        errEl.classList.remove("hidden");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
