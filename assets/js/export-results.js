/**
 * Calculator results export (CSV + PDF) — mounted automatically on interactive calculator pages.
 */
(function () {
  "use strict";

  function getPath() {
    return (window.location && window.location.pathname) || "";
  }

  function isCalculatorToolPage() {
    var p = getPath();
    if (p.indexOf("/calculators/") === -1) return false;
    if (/^(\/fr)?\/calculators\/?$/.test(p)) return false;
    if (/\/calculators\/[^/]+\/(methodology|data)(\/|$)/.test(p)) return false;
    return true;
  }

  var I18N_FALLBACK = {
    "common.export.csv": "CSV",
    "common.export.pdf": "PDF",
    "common.export.ariaGroup": "Export results",
    "common.export.noData": "Nothing to export yet. Run the calculator first.",
    "common.export.pdfError": "Could not create the PDF. Check your connection and try again.",
    "common.export.primaryResultLabel": "Adjusted amount",
    "common.export.rankingRow": "Ranking",
    "common.export.comparisonRow": "Comparison",
    "common.export.compoundTableSection": "Compound multipliers (full table)",
    "common.export.milestonesSection": "Balance at milestones",
    "common.export.scheduleSection": "Year-by-year schedule",
    "common.export.monthlySection": "Monthly breakdown",
    "common.export.csvTitle": "Title",
    "common.export.csvLabelCol": "Label",
    "common.export.csvValueCol": "Value",
    "common.export.pdfTruncated": "truncated in PDF; use CSV for the full table"
  };

  function t(key) {
    if (window.TLM && window.TLM.i18n && window.TLM.i18n.t) {
      var s = window.TLM.i18n.t(key);
      if (s !== key) return s;
    }
    return I18N_FALLBACK[key] != null ? I18N_FALLBACK[key] : key;
  }

  function normText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function isPlaceholder(val) {
    var v = normText(val);
    if (!v) return true;
    if (/^loading/i.test(v)) return true;
    if (v === "–" || v === "—" || v === "-" || v === "$–" || v === "$—") return true;
    if (v === "–%" || v === "—%") return true;
    if (/^[\$€£]?\s*[–—\-]+\s*$/.test(v)) return true;
    return false;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest(".hidden")) return false;
    var st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    return true;
  }

  function csvEscape(field) {
    var s = String(field == null ? "" : field);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2500);
  }

  function loadJsPdf() {
    return new Promise(function (resolve, reject) {
      if (window.jspdf && window.jspdf.jsPDF) {
        resolve(window.jspdf.jsPDF);
        return;
      }
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
      s.crossOrigin = "anonymous";
      s.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("jsPDF not available"));
      };
      s.onerror = function () {
        reject(new Error("Failed to load jsPDF"));
      };
      document.head.appendChild(s);
    });
  }

  function slugFromPath() {
    var p = getPath().replace(/\/$/, "");
    var m = p.match(/\/calculators\/([^/]+)/);
    return (m && m[1]) ? m[1].replace(/[^\w\-]+/g, "-") : "calculator";
  }

  function baseFilename() {
    var slug = slugFromPath();
    var d = new Date();
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return "thelongmath-" + slug + "-results-" + y + "-" + mo + "-" + day;
  }

  function rowKey(label, value) {
    return normText(label) + "\0" + normText(value);
  }

  function addPair(rows, seen, label, value) {
    var L = normText(label);
    var V = normText(value);
    if (!L && !V) return;
    if (isPlaceholder(V)) return;
    var k = rowKey(L, V);
    if (seen.has(k)) return;
    seen.add(k);
    rows.push({ label: L || "Value", value: V });
  }

  function getCcpcActiveBlock(panel) {
    var single = panel.querySelector("#singleResultBlock");
    var split = panel.querySelector("#splitResultBlock");
    if (single && split) {
      return isVisible(split) && split.offsetParent !== null ? split : single;
    }
    return null;
  }

  function collectKeyValueFromScope(scope, rows, seen) {
    if (!scope || !isVisible(scope)) return;

    scope.querySelectorAll(".result, .result-tile").forEach(function (block) {
      if (!isVisible(block)) return;
      var k = block.querySelector(".k");
      var v = block.querySelector(".v");
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    scope.querySelectorAll(".result-row").forEach(function (block) {
      if (!isVisible(block)) return;
      if (block.closest(".result-tile")) return;
      var k = null;
      var v = null;
      for (var i = 0; i < block.children.length; i++) {
        var c = block.children[i];
        if (c.classList && c.classList.contains("label")) k = c;
        if (c.classList && c.classList.contains("value")) v = c;
      }
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    scope.querySelectorAll(".kv").forEach(function (block) {
      if (!isVisible(block)) return;
      var k = block.querySelector(".k");
      var v = block.querySelector(".v");
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    scope.querySelectorAll(".result-card").forEach(function (block) {
      if (!isVisible(block)) return;
      var k = block.querySelector(".result-label");
      var v = block.querySelector(".result-value");
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    scope.querySelectorAll(".results-grid .result-card").forEach(function (block) {
      if (!isVisible(block)) return;
      var k = block.querySelector(".result-title");
      var v = block.querySelector(".result-value");
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    scope.querySelectorAll(".loan-result-tile").forEach(function (block) {
      if (!isVisible(block)) return;
      var k = block.querySelector(".loan-result-label");
      var v = block.querySelector(".loan-result-value");
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    scope.querySelectorAll(".secondary-row").forEach(function (block) {
      if (!isVisible(block)) return;
      var k = block.querySelector(".label");
      var v = block.querySelector(".value");
      if (k && v) addPair(rows, seen, normText(k.textContent), normText(v.textContent));
    });

    var primary = scope.querySelector("#primary_result");
    if (primary && isVisible(primary) && normText(primary.textContent) && !isPlaceholder(primary.textContent)) {
      addPair(rows, seen, t("common.export.primaryResultLabel"), normText(primary.textContent));
    }

    var wTitle = scope.querySelector(".winner-block h2");
    var wn = scope.querySelector("#winnerName");
    var wv = scope.querySelector("#winnerValue");
    if (wn && wv && isVisible(wn) && isVisible(wv)) {
      var title = wTitle ? normText(wTitle.textContent) : "Top strategy";
      addPair(rows, seen, title, normText(wn.textContent) + " — " + normText(wv.textContent));
    }

    scope.querySelectorAll("#rankingList li").forEach(function (li, i) {
      if (!isVisible(li)) return;
      var line = normText(li.textContent);
      if (line && !isPlaceholder(line)) addPair(rows, seen, t("common.export.rankingRow") + " " + (i + 1), line);
    });

    scope.querySelectorAll(".comparison-row").forEach(function (row, i) {
      if (!isVisible(row)) return;
      var line = normText(row.textContent);
      if (line && !isPlaceholder(line)) {
        addPair(rows, seen, t("common.export.comparisonRow") + " " + (i + 1), line);
      }
    });
  }

  function tableToCsv(table) {
    if (!table) return "";
    var lines = [];
    table.querySelectorAll("tr").forEach(function (tr) {
      if (!isVisible(tr)) return;
      var cells = [];
      tr.querySelectorAll("th, td").forEach(function (cell) {
        cells.push(csvEscape(normText(cell.textContent)));
      });
      if (cells.length) lines.push(cells.join(","));
    });
    return lines.join("\r\n");
  }

  function collectFromPanel(panel, anchor) {
    var rows = [];
    var seen = new Set();
    var extraSections = [];

    if (anchor && anchor.id === "multTable") {
      var csv = tableToCsv(anchor);
      if (csv) extraSections.push(t("common.export.compoundTableSection") + "\r\n" + csv);
      return { rows: rows, extraSections: extraSections };
    }

    var scope = panel;
    var ccpc = getCcpcActiveBlock(panel);
    if (ccpc) scope = ccpc;

    collectKeyValueFromScope(scope, rows, seen);

    var milestones = panel.querySelector(".milestones-table");
    if (milestones && isVisible(milestones)) {
      var mcsv = tableToCsv(milestones);
      if (mcsv) extraSections.push(t("common.export.milestonesSection") + "\r\n" + mcsv);
    }

    var monthly = panel.querySelector("#monthly_table");
    if (monthly && isVisible(monthly)) {
      var pcsv = tableToCsv(monthly);
      if (pcsv) extraSections.push(t("common.export.monthlySection") + "\r\n" + pcsv);
    }

    var schedule = panel.querySelector("#scheduleTable, table.schedule-table");
    if (schedule && isVisible(schedule)) {
      var scsv = tableToCsv(schedule);
      if (scsv) extraSections.push(t("common.export.scheduleSection") + "\r\n" + scsv);
    }

    return { rows: rows, extraSections: extraSections };
  }

  function buildCsv(title, data) {
    var lines = [];
    if (title) lines.push(csvEscape(t("common.export.csvTitle")) + "," + csvEscape(title));
    lines.push(csvEscape(t("common.export.csvLabelCol")) + "," + csvEscape(t("common.export.csvValueCol")));
    data.rows.forEach(function (r) {
      lines.push(csvEscape(r.label) + "," + csvEscape(r.value));
    });
    var body = lines.join("\r\n");
    if (data.extraSections.length) {
      body += "\r\n\r\n" + data.extraSections.join("\r\n\r\n");
    }
    return "\uFEFF" + body;
  }

  function buildPdfLines(title, data) {
    var out = [];
    out.push(title || "The Long Math");
    out.push("");
    data.rows.forEach(function (r) {
      out.push(r.label + ": " + r.value);
    });
    data.extraSections.forEach(function (sec) {
      out.push("");
      out.push("---");
      var parts = sec.split("\r\n");
      var max = 80;
      for (var i = 0; i < Math.min(parts.length, max); i++) {
        out.push(parts[i]);
      }
      if (parts.length > max) {
        out.push("… (" + t("common.export.pdfTruncated") + ")");
      }
    });
    return out;
  }

  function downloadPdf(title, data) {
    loadJsPdf()
      .then(function (jsPDF) {
        var doc = new jsPDF({ unit: "mm", format: "a4" });
        var lines = buildPdfLines(title, data);
        var y = 16;
        var margin = 14;
        var maxW = 182;
        doc.setFontSize(11);
        lines.forEach(function (line) {
          var wrapped = doc.splitTextToSize(line, maxW);
          wrapped.forEach(function (wline) {
            if (y > 285) {
              doc.addPage();
              y = 16;
            }
            doc.text(wline, margin, y);
            y += 5.2;
          });
        });
        doc.save(baseFilename() + ".pdf");
      })
      .catch(function (err) {
        console.warn(err);
        window.alert(t("common.export.pdfError"));
      });
  }

  function buildExportGroup(pageTitle, collect) {
    var wrap = document.createElement("div");
    wrap.className = "tlm-export-group";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", t("common.export.ariaGroup"));

    function runCsv() {
      var data = collect();
      if (!data.rows.length && !data.extraSections.length) {
        window.alert(t("common.export.noData"));
        return;
      }
      downloadText(baseFilename() + ".csv", buildCsv(pageTitle, data), "text/csv;charset=utf-8");
    }

    function runPdf() {
      var data = collect();
      if (!data.rows.length && !data.extraSections.length) {
        window.alert(t("common.export.noData"));
        return;
      }
      downloadPdf(pageTitle, data);
    }

    var b1 = document.createElement("button");
    b1.type = "button";
    b1.className = "tlm-export-btn";
    b1.textContent = t("common.export.csv");
    b1.addEventListener("click", runCsv);

    var b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "tlm-export-btn";
    b2.textContent = t("common.export.pdf");
    b2.addEventListener("click", runPdf);

    wrap.appendChild(b1);
    wrap.appendChild(b2);
    return wrap;
  }

  function enhanceResultsPanelHeader(headerEl, pageTitle, collect) {
    if (headerEl.querySelector(".tlm-export-group")) return;
    var h2 = headerEl.querySelector("h2.section-title, h2.tool-card__title");
    var rest = Array.prototype.slice.call(headerEl.children).filter(function (c) {
      return c !== h2;
    });
    var actions = headerEl.querySelector(".results-panel-header-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "results-panel-header-actions";
      rest.forEach(function (c) {
        actions.appendChild(c);
      });
      headerEl.appendChild(actions);
    }
    actions.insertBefore(buildExportGroup(pageTitle, collect), actions.firstChild);
  }

  function mountBeforeAnchor(anchor, pageTitle, collect) {
    var wrap = document.createElement("div");
    wrap.className = "tlm-export-wrap";
    wrap.appendChild(buildExportGroup(pageTitle, collect));
    anchor.parentNode.insertBefore(wrap, anchor);
  }

  function findAnchors() {
    var sel =
      ".wrap .results, .wrap .results-grid, .wrap .loan-results-grid, .wrap #multTable, .wrap .result-tiles";
    var list = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(isVisible);
    document.querySelectorAll(".wrap .out").forEach(function (out) {
      if (!isVisible(out)) return;
      if (!out.querySelector(".kv .k")) return;
      list.push(out);
    });
    return list;
  }

  function mountForAnchor(anchor, mountedPanels) {
    var panel = anchor.closest("article.panel, section.card, section.panel, .loan-panel, .tool-card");
    if (!panel || !isVisible(panel)) return;
    if (mountedPanels.has(panel)) return;
    mountedPanels.add(panel);

    var pageTitle = normText(document.title) || "The Long Math";

    function collect() {
      return collectFromPanel(panel, anchor);
    }

    var header = panel.querySelector(".results-panel-header");
    if (header && isVisible(header)) {
      enhanceResultsPanelHeader(header, pageTitle, collect);
      return;
    }

    var top = panel.querySelector(".tool-card__top");
    if (top && anchor.id === "multTable" && isVisible(top)) {
      if (!top.querySelector(".tlm-export-group")) {
        top.appendChild(buildExportGroup(pageTitle, collect));
      }
      return;
    }

    mountBeforeAnchor(anchor, pageTitle, collect);
  }

  function init() {
    if (!isCalculatorToolPage()) return;
    var mountedPanels = new WeakSet();
    findAnchors().forEach(function (a) {
      mountForAnchor(a, mountedPanels);
    });
  }

  window.TLM = window.TLM || {};
  window.TLM.exportResults = {
    init: init,
    isCalculatorToolPage: isCalculatorToolPage
  };

  function runInit() {
    try {
      init();
    } catch (e) {
      console.warn("export-results init:", e);
    }
  }

  function scheduleInit() {
    function afterDom() {
      if (window.TLM && window.TLM.i18n && window.TLM.i18n.ready) {
        window.TLM.i18n.ready.then(runInit).catch(runInit);
      } else {
        runInit();
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", afterDom);
    } else {
      afterDom();
    }
  }

  scheduleInit();
})();
