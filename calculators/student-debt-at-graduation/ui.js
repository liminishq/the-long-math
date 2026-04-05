(function () {
  "use strict";

  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function fmtCurrency(n) {
    if (!Number.isFinite(n)) return "$—";
    return n.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function defaultProgram() {
    return {
      name: "",
      years: "",
      tuition: "",
      books: "",
      living: "",
      other: "0",
      funding: "",
    };
  }

  function readProgramsFromMount(mount) {
    const cards = mount.querySelectorAll(".sd-program-card");
    return Array.prototype.map.call(cards, function (card) {
      function val(sel) {
        const el = card.querySelector(sel);
        return el ? el.value : "";
      }
      return {
        name: val('[data-field="name"]'),
        years: val('[data-field="years"]'),
        tuition: val('[data-field="tuition"]'),
        books: val('[data-field="books"]'),
        living: val('[data-field="living"]'),
        other: val('[data-field="other"]'),
        funding: val('[data-field="funding"]'),
      };
    });
  }

  function buildCardHtml(scenario, index, p) {
    const idBase = "sd-prog-" + scenario + "-" + index;
    const title = "Program " + (index + 1);
    return (
      '<article class="sd-program-card" data-index="' +
      index +
      '">' +
      '<div class="sd-program-card-header">' +
      '<h3>' +
      title +
      "</h3>" +
      '<button type="button" class="sd-remove-prog" aria-label="Remove this program">Remove</button>' +
      "</div>" +
      '<div class="loan-field sd-field-full">' +
      '<label for="' +
      idBase +
      '-name">Program name or label (optional)</label>' +
      '<input id="' +
      idBase +
      '-name" type="text" data-field="name" autocomplete="off" value="' +
      escapeAttr(p.name) +
      '" />' +
      "</div>" +
      '<div class="sd-field-grid">' +
      '<div class="loan-field">' +
      '<label for="' +
      idBase +
      '-years">Years of study</label>' +
      '<input id="' +
      idBase +
      '-years" type="number" inputmode="decimal" min="0" step="any" data-field="years" value="' +
      escapeAttr(p.years) +
      '" />' +
      "</div>" +
      '<div class="loan-field">' +
      '<label for="' +
      idBase +
      '-tuition">Annual tuition</label>' +
      '<input id="' +
      idBase +
      '-tuition" type="number" inputmode="decimal" min="0" step="100" data-field="tuition" value="' +
      escapeAttr(p.tuition) +
      '" />' +
      "</div>" +
      '<div class="loan-field">' +
      '<label for="' +
      idBase +
      '-books">Annual books, supplies, and ancillary fees</label>' +
      '<input id="' +
      idBase +
      '-books" type="number" inputmode="decimal" min="0" step="50" data-field="books" value="' +
      escapeAttr(p.books) +
      '" />' +
      "</div>" +
      '<div class="loan-field">' +
      '<label for="' +
      idBase +
      '-living">Annual living expenses</label>' +
      '<input id="' +
      idBase +
      '-living" type="number" inputmode="decimal" min="0" step="100" data-field="living" value="' +
      escapeAttr(p.living) +
      '" />' +
      "</div>" +
      '<div class="loan-field">' +
      '<label for="' +
      idBase +
      '-other">Annual other education costs (optional)</label>' +
      '<input id="' +
      idBase +
      '-other" type="number" inputmode="decimal" min="0" step="50" data-field="other" value="' +
      escapeAttr(p.other) +
      '" />' +
      "</div>" +
      '<div class="loan-field sd-field-full">' +
      '<label for="' +
      idBase +
      '-funding">Annual amount you can fund without borrowing</label>' +
      '<input id="' +
      idBase +
      '-funding" type="number" inputmode="decimal" min="0" step="100" data-field="funding" value="' +
      escapeAttr(p.funding) +
      '" />' +
      '<p class="sd-funding-help">Include earnings, savings, family support, scholarships, bursaries, grants, or any other non-debt funding. Do not include student loans.</p>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function renderProgramsMount(mount, scenario, programs) {
    const list = programs.length ? programs : [defaultProgram()];
    mount.innerHTML = list.map(function (p, i) {
      return buildCardHtml(scenario, i, p);
    }).join("");

    const n = mount.querySelectorAll(".sd-program-card").length;
    mount.querySelectorAll(".sd-remove-prog").forEach(function (btn) {
      btn.disabled = n <= 1;
    });
  }

  function clampNegativeNumberInput(el) {
    if (!el || el.type !== "number") return;
    const v = el.valueAsNumber;
    if (Number.isFinite(v) && v < 0) el.value = "0";
  }

  let chartComposition = null;
  let chartFunding = null;
  let chartDebtCompare = null;
  let chartBreakdownCompare = null;

  function destroyChart(ref) {
    if (ref) {
      ref.destroy();
    }
    return null;
  }

  function updateChartsSingle(res) {
    const comp = res.composition;
    const labels = ["Tuition", "Books & fees", "Living", "Other"];
    const dataRaw = [comp.tuition, comp.books, comp.living, comp.other];
    const colors = [
      cssVar("--sd-chart-tuition") || "#9cb3cb",
      cssVar("--sd-chart-books") || "#d3c3b1",
      cssVar("--sd-chart-living") || "#8fa89a",
      cssVar("--sd-chart-other") || "#a896b8",
    ];

    const filtered = labels
      .map(function (lab, i) {
        return { lab: lab, v: dataRaw[i], c: colors[i] };
      })
      .filter(function (x) {
        return x.v > 0;
      });

    const ctx1 = document.getElementById("sd-chart-composition");
    const ctx2 = document.getElementById("sd-chart-funding");
    if (typeof Chart === "undefined" || !ctx1 || !ctx2) return;

    chartComposition = destroyChart(chartComposition);
    chartFunding = destroyChart(chartFunding);

    const axis = cssVar("--chart-axis") || "rgba(255,255,255,0.72)";

    if (filtered.length === 0) {
      chartComposition = new Chart(ctx1.getContext("2d"), {
        type: "doughnut",
        data: { labels: ["No cost entered"], datasets: [{ data: [1], backgroundColor: ["rgba(128,128,128,0.25)"] }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
        },
      });
    } else {
      chartComposition = new Chart(ctx1.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: filtered.map(function (x) {
            return x.lab;
          }),
          datasets: [
            {
              data: filtered.map(function (x) {
                return x.v;
              }),
              backgroundColor: filtered.map(function (x) {
                return x.c;
              }),
              borderWidth: 1,
              borderColor: cssVar("--border") || "rgba(0,0,0,0.12)",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: axis, boxWidth: 10, font: { size: 10 } },
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  const v = ctx.parsed;
                  return (ctx.label || "") + ": " + fmtCurrency(v);
                },
              },
            },
          },
        },
      });
    }

    const funded = res.totalFunded;
    const debt = res.projectedDebt;
    const fColor = cssVar("--sd-chart-funded") || "#7b9e8c";
    const dColor = cssVar("--sd-chart-debt") || "#c49a6c";

    chartFunding = new Chart(ctx2.getContext("2d"), {
      type: "bar",
      data: {
        labels: ["Funded without debt", "Projected debt"],
        datasets: [
          {
            label: "Amount",
            data: [funded, debt],
            backgroundColor: [fColor, dColor],
            borderWidth: 1,
            borderColor: cssVar("--border"),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return (ctx.label || "") + ": " + fmtCurrency(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: axis, font: { size: 10 }, maxRotation: 45, minRotation: 0 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: axis,
              font: { size: 9 },
              callback: function (v) {
                if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
                return v;
              },
            },
            grid: { color: cssVar("--chart-grid") || "rgba(255,255,255,0.08)" },
          },
        },
      },
    });

    $("sd-chart-sr-comp").textContent =
      filtered.length === 0
        ? "Cost composition: no annual costs entered yet."
        : "Cost composition: tuition " +
          fmtCurrency(comp.tuition) +
          ", books and fees " +
          fmtCurrency(comp.books) +
          ", living " +
          fmtCurrency(comp.living) +
          ", other " +
          fmtCurrency(comp.other) +
          ".";

    $("sd-chart-sr-fund").textContent =
      "Funding versus shortfall: funded without debt " + fmtCurrency(funded) + ", projected debt " + fmtCurrency(debt) + ".";
  }

  function updateChartsCompare(resA, resB, nameA, nameB) {
    const ctx1 = document.getElementById("sd-chart-debt-compare");
    const ctx2 = document.getElementById("sd-chart-breakdown-compare");
    if (typeof Chart === "undefined" || !ctx1 || !ctx2) return;

    chartDebtCompare = destroyChart(chartDebtCompare);
    chartBreakdownCompare = destroyChart(chartBreakdownCompare);

    const axis = cssVar("--chart-axis") || "rgba(255,255,255,0.72)";
    const cA = cssVar("--sd-chart-scen-a") || "#9cb3cb";
    const cB = cssVar("--sd-chart-scen-b") || "#c49a6c";

    chartDebtCompare = new Chart(ctx1.getContext("2d"), {
      type: "bar",
      data: {
        labels: [nameA, nameB],
        datasets: [
          {
            label: "Projected debt at graduation",
            data: [resA.projectedDebt, resB.projectedDebt],
            backgroundColor: [cA, cB],
            borderWidth: 1,
            borderColor: cssVar("--border"),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return fmtCurrency(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: axis, font: { size: 10 } }, grid: { display: false } },
          y: {
            ticks: {
              color: axis,
              font: { size: 9 },
              callback: function (v) {
                if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
                return v;
              },
            },
            grid: { color: cssVar("--chart-grid") || "rgba(255,255,255,0.08)" },
          },
        },
      },
    });

    const costColor = cssVar("--sd-chart-tuition") || "#9cb3cb";
    const fundColor = cssVar("--sd-chart-funded") || "#7b9e8c";
    const debtColor = cssVar("--sd-chart-debt") || "#c49a6c";

    chartBreakdownCompare = new Chart(ctx2.getContext("2d"), {
      type: "bar",
      data: {
        labels: [nameA, nameB],
        datasets: [
          {
            label: "Total education cost",
            data: [resA.totalEducationCost, resB.totalEducationCost],
            backgroundColor: costColor,
            borderWidth: 1,
            borderColor: cssVar("--border"),
          },
          {
            label: "Funded without debt",
            data: [resA.totalFunded, resB.totalFunded],
            backgroundColor: fundColor,
            borderWidth: 1,
            borderColor: cssVar("--border"),
          },
          {
            label: "Projected debt",
            data: [resA.projectedDebt, resB.projectedDebt],
            backgroundColor: debtColor,
            borderWidth: 1,
            borderColor: cssVar("--border"),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: axis, boxWidth: 10, font: { size: 10 } },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ": " + fmtCurrency(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: axis, font: { size: 10 } }, grid: { display: false } },
          y: {
            ticks: {
              color: axis,
              font: { size: 9 },
              callback: function (v) {
                if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
                return v;
              },
            },
            grid: { color: cssVar("--chart-grid") || "rgba(255,255,255,0.08)" },
          },
        },
      },
    });

    $("sd-chart-sr-debtcmp").textContent =
      "Projected debt: " + nameA + " " + fmtCurrency(resA.projectedDebt) + ", " + nameB + " " + fmtCurrency(resB.projectedDebt) + ".";

    $("sd-chart-sr-break").textContent =
      nameA +
      ": cost " +
      fmtCurrency(resA.totalEducationCost) +
      ", funded " +
      fmtCurrency(resA.totalFunded) +
      ", debt " +
      fmtCurrency(resA.projectedDebt) +
      ". " +
      nameB +
      ": cost " +
      fmtCurrency(resB.totalEducationCost) +
      ", funded " +
      fmtCurrency(resB.totalFunded) +
      ", debt " +
      fmtCurrency(resB.projectedDebt) +
      ".";
  }

  function isCompareMode() {
    return $("sd-mode-compare").getAttribute("aria-pressed") === "true";
  }

  function activeScenarioTab() {
    return $("sd-tab-a").getAttribute("aria-selected") === "true" ? "a" : "b";
  }

  function scenarioDisplayName(letter) {
    const raw =
      letter === "a"
        ? $("sd-scenario-name-a").value.trim() || "Baseline"
        : $("sd-scenario-name-b").value.trim() || "Alternative";
    return raw;
  }

  function refreshComputations() {
    if (typeof window.computeStudentDebtScenario !== "function") return;

    const compare = isCompareMode();
    const mountA = $("sd-mount-a");
    const mountB = $("sd-mount-b");

    const resA = window.computeStudentDebtScenario(readProgramsFromMount(mountA));
    const resB = window.computeStudentDebtScenario(readProgramsFromMount(mountB));

    const nameA = scenarioDisplayName("a");
    const nameB = scenarioDisplayName("b");

    if (!compare) {
      $("sd-results-single").classList.remove("hidden");
      $("sd-results-compare").classList.add("hidden");
      $("sd-charts-single").classList.remove("hidden");
      $("sd-charts-compare").classList.add("hidden");

      $("sd-out-cost").textContent = fmtCurrency(resA.totalEducationCost);
      $("sd-out-funded").textContent = fmtCurrency(resA.totalFunded);
      $("sd-out-debt").textContent = fmtCurrency(resA.projectedDebt);

      const tbody = $("sd-breakdown-body");
      tbody.innerHTML = "";
      resA.programs.forEach(function (p) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<th scope=\"row\">" +
          escapeHtml(p.label) +
          "</th><td>" +
          fmtCurrency(p.totalCost) +
          "</td><td>" +
          fmtCurrency(p.totalFunding) +
          "</td><td>" +
          fmtCurrency(p.balance) +
          "</td>";
        tbody.appendChild(tr);
      });

      chartDebtCompare = destroyChart(chartDebtCompare);
      chartBreakdownCompare = destroyChart(chartBreakdownCompare);
      updateChartsSingle(resA);

      $("sd-sr-summary").textContent =
        "Total education cost " +
        fmtCurrency(resA.totalEducationCost) +
        ". Total funded without debt " +
        fmtCurrency(resA.totalFunded) +
        ". Projected debt at graduation " +
        fmtCurrency(resA.projectedDebt) +
        ".";

      setRepayCta(resA.projectedDebt, null);
    } else {
      $("sd-results-single").classList.add("hidden");
      $("sd-results-compare").classList.remove("hidden");
      $("sd-charts-single").classList.add("hidden");
      $("sd-charts-compare").classList.remove("hidden");

      $("sd-compare-label-debt-a").textContent = nameA + " — projected debt";
      $("sd-compare-label-debt-b").textContent = nameB + " — projected debt";
      $("sd-compare-label-cost-a").textContent = nameA + " — total education cost";
      $("sd-compare-label-cost-b").textContent = nameB + " — total education cost";
      $("sd-compare-label-funded-a").textContent = nameA + " — funded without debt";
      $("sd-compare-label-funded-b").textContent = nameB + " — funded without debt";

      $("sd-out-debt-a").textContent = fmtCurrency(resA.projectedDebt);
      $("sd-out-debt-b").textContent = fmtCurrency(resB.projectedDebt);
      $("sd-out-cost-a").textContent = fmtCurrency(resA.totalEducationCost);
      $("sd-out-cost-b").textContent = fmtCurrency(resB.totalEducationCost);
      $("sd-out-funded-a").textContent = fmtCurrency(resA.totalFunded);
      $("sd-out-funded-b").textContent = fmtCurrency(resB.totalFunded);

      const diff = resB.projectedDebt - resA.projectedDebt;
      const lineEl = $("sd-compare-line");
      const pctEl = $("sd-compare-pct-note");

      if (diff === 0) {
        lineEl.textContent = "Both scenarios show the same projected debt at graduation.";
        if (resA.projectedDebt > 0) {
          pctEl.textContent =
            "Percentage change in projected debt (" + nameB + " vs " + nameA + "): 0%.";
        } else {
          pctEl.textContent = "";
        }
      } else if (diff > 0) {
        lineEl.textContent =
          nameB + " results in " + fmtCurrency(diff) + " more debt at graduation than " + nameA + ".";
      } else {
        lineEl.textContent =
          nameB + " results in " + fmtCurrency(-diff) + " less debt at graduation than " + nameA + ".";
      }

      if (resA.projectedDebt > 0) {
        const pct = (diff / resA.projectedDebt) * 100;
        pctEl.textContent =
          "Percentage change in projected debt (" + nameB + " vs " + nameA + "): " +
          (Number.isFinite(pct) ? pct.toFixed(1) : "—") +
          "%.";
      } else {
        pctEl.textContent =
          "Percentage change vs " +
          nameA +
          " is not shown when " +
          nameA +
          " projected debt is zero (the baseline has no debt to scale against).";
      }

      chartComposition = destroyChart(chartComposition);
      chartFunding = destroyChart(chartFunding);
      updateChartsCompare(resA, resB, nameA, nameB);

      $("sd-sr-summary").textContent =
        nameA +
        " projected debt " +
        fmtCurrency(resA.projectedDebt) +
        ". " +
        nameB +
        " projected debt " +
        fmtCurrency(resB.projectedDebt) +
        ".";

      setRepayCta(resA.projectedDebt, nameA);
    }
  }

  function setRepayCta(debt, baselineName) {
    const a = $("sd-repay-cta");
    if (!Number.isFinite(debt) || debt <= 0) {
      a.href = "/calculators/loan-repayment/";
      $("sd-repay-hint").textContent =
        "Enter a projected debt above zero to prefill the loan amount in the repayment calculator, or enter the amount manually there.";
    } else {
      const q = "?principal=" + encodeURIComponent(String(Math.round(debt * 100) / 100));
      a.href = "/calculators/loan-repayment/" + q;
      if (baselineName) {
        $("sd-repay-hint").textContent =
          "Opens the loan repayment calculator with principal prefilled from " +
          baselineName +
          "’s projected debt (" +
          fmtCurrency(debt) +
          "). Adjust there if you want to model " +
          "the other scenario.";
      } else {
        $("sd-repay-hint").textContent =
          "Opens the loan repayment calculator with principal prefilled to your projected debt (" + fmtCurrency(debt) + ").";
      }
    }
  }

  function updateModeUi() {
    const compare = isCompareMode();
    $("sd-compare-only").classList.toggle("hidden", !compare);
    $("sd-mode-single").setAttribute("aria-pressed", compare ? "false" : "true");
    $("sd-mode-compare").setAttribute("aria-pressed", compare ? "true" : "false");

    $("sd-panel-b").classList.toggle("hidden", !compare);

    if (!compare) {
      $("sd-panel-a").classList.remove("hidden");
    } else {
      syncTabs();
    }
  }

  function syncTabs() {
    const tab = activeScenarioTab();
    $("sd-tab-a").setAttribute("aria-selected", tab === "a" ? "true" : "false");
    $("sd-tab-b").setAttribute("aria-selected", tab === "b" ? "true" : "false");
    $("sd-panel-a").classList.toggle("hidden", tab !== "a");
    $("sd-panel-b").classList.toggle("hidden", tab !== "b");
  }

  function wireMount(mount, scenario) {
    mount.addEventListener("input", function (e) {
      const t = e.target;
      if (t && t.matches && t.matches('input[type="number"]')) {
        clampNegativeNumberInput(t);
      }
      refreshComputations();
    });

    mount.addEventListener("change", function (e) {
      const t = e.target;
      if (t && t.matches && t.matches('input[type="number"]')) {
        clampNegativeNumberInput(t);
      }
      refreshComputations();
    });

    mount.addEventListener("click", function (e) {
      const btn = e.target.closest(".sd-remove-prog");
      if (!btn || btn.disabled) return;
      const card = btn.closest(".sd-program-card");
      if (!card) return;
      const programs = readProgramsFromMount(mount);
      const idx = Number(card.getAttribute("data-index"));
      if (!Number.isFinite(idx) || programs.length <= 1) return;
      programs.splice(idx, 1);
      renderProgramsMount(mount, scenario, programs);
      refreshComputations();
    });
  }

  function wire() {
    const mountA = $("sd-mount-a");
    const mountB = $("sd-mount-b");

    renderProgramsMount(mountA, "a", [defaultProgram()]);
    renderProgramsMount(mountB, "b", [defaultProgram()]);
    wireMount(mountA, "a");
    wireMount(mountB, "b");

    $("sd-mode-single").addEventListener("click", function () {
      $("sd-mode-single").setAttribute("aria-pressed", "true");
      $("sd-mode-compare").setAttribute("aria-pressed", "false");
      updateModeUi();
      refreshComputations();
    });

    $("sd-mode-compare").addEventListener("click", function () {
      $("sd-mode-single").setAttribute("aria-pressed", "false");
      $("sd-mode-compare").setAttribute("aria-pressed", "true");
      updateModeUi();
      refreshComputations();
    });

    $("sd-tab-a").addEventListener("click", function () {
      $("sd-tab-a").setAttribute("aria-selected", "true");
      $("sd-tab-b").setAttribute("aria-selected", "false");
      syncTabs();
    });

    $("sd-tab-b").addEventListener("click", function () {
      $("sd-tab-b").setAttribute("aria-selected", "true");
      $("sd-tab-a").setAttribute("aria-selected", "false");
      syncTabs();
    });

    $("sd-copy-a-to-b").addEventListener("click", function () {
      const pa = readProgramsFromMount(mountA);
      const copy = pa.map(function (p) {
        return {
          name: p.name,
          years: p.years,
          tuition: p.tuition,
          books: p.books,
          living: p.living,
          other: p.other,
          funding: p.funding,
        };
      });
      renderProgramsMount(mountB, "b", copy.length ? copy : [defaultProgram()]);
      refreshComputations();
    });

    $("sd-add-a").addEventListener("click", function () {
      const programs = readProgramsFromMount(mountA);
      programs.push(defaultProgram());
      renderProgramsMount(mountA, "a", programs);
      refreshComputations();
    });

    $("sd-add-b").addEventListener("click", function () {
      const programs = readProgramsFromMount(mountB);
      programs.push(defaultProgram());
      renderProgramsMount(mountB, "b", programs);
      refreshComputations();
    });

    ["sd-scenario-name-a", "sd-scenario-name-b"].forEach(function (id) {
      $(id).addEventListener("input", refreshComputations);
    });

    updateModeUi();

    const rootEl = document.documentElement;
    const obs = new MutationObserver(function () {
      refreshComputations();
    });
    obs.observe(rootEl, { attributes: true, attributeFilter: ["data-theme"] });

    refreshComputations();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
