/**
 * Calculator export (CSV + PDF): inputs and outputs in screen/DOM order, printer-friendly PDF “cards”.
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
    "common.export.csvSectionCol": "Section",
    "common.export.csvKindCol": "Kind",
    "common.export.csvLabelCol": "Label",
    "common.export.csvValueCol": "Value",
    "common.export.pdfTruncated": "truncated in PDF; use CSV for the full table",
    "common.export.sectionCalculator": "Calculator",
    "common.export.kindInput": "Input",
    "common.export.kindOutput": "Output",
    "common.export.generatedAt": "Generated",
    "common.export.yes": "Yes",
    "common.export.no": "No",
    "common.export.additionalTables": "Additional tables (detail)",
    "common.export.exportResults": "Export results",
    "common.export.mortgageSchedule12": "Mortgage — first 12 months (monthly)",
    "common.export.mortgageScheduleAnnual": "Mortgage — annual summary",
    "common.export.loanAmortizationSection": "Loan amortization schedule",
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

  function loadHtml2Canvas() {
    return new Promise(function (resolve, reject) {
      if (typeof window.html2canvas === "function") {
        resolve(window.html2canvas);
        return;
      }
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      s.crossOrigin = "anonymous";
      s.onload = function () {
        if (typeof window.html2canvas === "function") resolve(window.html2canvas);
        else reject(new Error("html2canvas not available"));
      };
      s.onerror = function () {
        reject(new Error("Failed to load html2canvas"));
      };
      document.head.appendChild(s);
    });
  }

  function canvasToGrayscale(canvas) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    var w = canvas.width;
    var h = canvas.height;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i];
      var g = d[i + 1];
      var b = d[i + 2];
      var v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * Region to rasterize: outer card when present (inspect bar + grid), else the main grid/tool card.
   */
  function findPdfCaptureRoot() {
    var wrap = getCalculatorWrap();
    if (!wrap) return null;

    var mt = findMultTableAnchor();
    if (mt) {
      var tc = mt.closest(".tool-card");
      if (tc) return tc;
      return mt;
    }

    var inner = findPrimaryCalcRoot();
    if (!inner) return null;

    if (inner.classList && inner.classList.contains("tool-card")) return inner;

    var p = inner.parentElement;
    if (!p) return inner;

    if (p.classList && p.classList.contains("card")) {
      if (p.querySelector(".inspect-bar") || p.querySelector(".mortgage-grid, .calc-grid")) {
        return p;
      }
    }

    if (p.classList && (p.classList.contains("loan-card") || p.id === "calc_card")) {
      return p;
    }

    return inner;
  }

  function setExportUiHidden(hidden) {
    document.querySelectorAll(".tlm-export-dropdown").forEach(function (el) {
      el.style.visibility = hidden ? "hidden" : "";
    });
  }

  function addGrayscaleCanvasToPdf(doc, canvas) {
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 10;
    var headerBand = 14;
    var contentW = pageW - 2 * margin;
    var imgH_mm = (canvas.height * contentW) / canvas.width;

    var yPx = 0;
    var pageIndex = 0;

    while (yPx < canvas.height) {
      if (pageIndex > 0) doc.addPage();

      var topMm = pageIndex === 0 ? headerBand : margin;
      var maxHmm =
        pageIndex === 0 ? pageH - headerBand - margin : pageH - 2 * margin;

      var remainingMm = ((canvas.height - yPx) / canvas.height) * imgH_mm;
      var thisHmm = Math.min(maxHmm, remainingMm);
      var slicePx = Math.round((thisHmm / imgH_mm) * canvas.height);
      slicePx = Math.min(slicePx, canvas.height - yPx);
      if (slicePx <= 0) break;

      var slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = slicePx;
      var sctx = slice.getContext("2d");
      sctx.drawImage(canvas, 0, yPx, canvas.width, slicePx, 0, 0, canvas.width, slicePx);

      var drawHmm = (slicePx / canvas.height) * imgH_mm;
      var dataUrl = slice.toDataURL("image/jpeg", 0.9);
      doc.addImage(dataUrl, "JPEG", margin, topMm, contentW, drawHmm);

      yPx += slicePx;
      pageIndex += 1;
    }
  }

  function renderPdfHeaderBand(doc, data) {
    var pageW = doc.internal.pageSize.getWidth();
    var margin = 10;
    doc.setFillColor(252);
    doc.rect(0, 0, pageW, 12, "F");
    doc.setDrawColor(210);
    doc.line(0, 12, pageW, 12);
    doc.setTextColor(55);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(normText(document.title) || data.pageTitle, margin, 8);
    doc.setFontSize(7);
    doc.setTextColor(100);
    var ts = t("common.export.generatedAt") + ": " + data.generatedAt.toLocaleString();
    doc.text(ts, pageW - margin, 8, { align: "right" });
  }

  function renderScreenshotPdf(JsPdf, html2canvas, data) {
    var target = findPdfCaptureRoot();
    if (!target || target.offsetWidth < 8 || target.offsetHeight < 8) {
      renderStructuredPdf(JsPdf, data);
      return Promise.resolve();
    }

    var scale = Math.min(2, (window.devicePixelRatio || 1) * 1.25);

    setExportUiHidden(true);

    return html2canvas(target, {
      scale: scale,
      useCORS: true,
      logging: false,
      backgroundColor: null,
      scrollX: 0,
      scrollY: 0,
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
      onclone: function (clonedDoc) {
        clonedDoc.querySelectorAll(".tlm-export-dropdown").forEach(function (n) {
          n.remove();
        });
      }
    })
      .then(function (canvas) {
        setExportUiHidden(false);
        if (!canvas || canvas.width < 4) {
          renderStructuredPdf(JsPdf, data);
          return;
        }
        canvasToGrayscale(canvas);
        var doc = new JsPdf({ unit: "mm", format: "a4" });
        renderPdfHeaderBand(doc, data);
        addGrayscaleCanvasToPdf(doc, canvas);
        doc.save(baseFilename() + ".pdf");
      })
      .catch(function (err) {
        setExportUiHidden(false);
        console.warn("export-results visual PDF:", err);
        try {
          renderStructuredPdf(JsPdf, data);
        } catch (e2) {
          console.warn(e2);
        }
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
    return "thelongmath-" + slug + "-export-" + y + "-" + mo + "-" + day;
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

    var wn = scope.querySelector("#winnerName");
    var wv = scope.querySelector("#winnerValue");
    var wvl = scope.querySelector("#winnerValueLabel");
    if (wn && wv && isVisible(wn) && isVisible(wv)) {
      addPair(rows, seen, "Top strategy", normText(wn.textContent));
      var cap = wvl && isVisible(wvl) ? normText(wvl.textContent) : "After-tax future value";
      addPair(rows, seen, cap, normText(wv.textContent));
    }

    scope.querySelectorAll("#priorityRankingBody tr").forEach(function (tr, i) {
      if (!isVisible(tr)) return;
      var cells = tr.querySelectorAll("td");
      if (cells.length < 3) return;
      var line =
        normText(cells[0].textContent) +
        ". " +
        normText(cells[1].textContent) +
        " — " +
        normText(cells[2].textContent);
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

  function formatInputValue(ctrl) {
    if (!ctrl || !isVisible(ctrl)) return null;
    var tag = ctrl.tagName;
    var type = (ctrl.type || "").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button") return null;
    if (tag === "SELECT") {
      var opt = ctrl.options[ctrl.selectedIndex];
      return opt ? normText(opt.textContent) || normText(ctrl.value) : normText(ctrl.value);
    }
    if (type === "checkbox") return ctrl.checked ? t("common.export.yes") : t("common.export.no");
    if (type === "radio") {
      if (!ctrl.checked) return null;
      var rl = ctrl.closest("label");
      if (rl) return normText(rl.textContent);
      return normText(ctrl.value);
    }
    return normText(ctrl.value);
  }

  function collectInputRowsFromSection(sectionEl, seenControls) {
    var rows = [];
    if (!sectionEl || !isVisible(sectionEl)) return rows;
    seenControls = seenControls || new WeakSet();

    function mark(ctrl) {
      if (ctrl) seenControls.add(ctrl);
    }

    sectionEl.querySelectorAll(".field").forEach(function (field) {
      if (!isVisible(field)) return;
      var lab = field.querySelector(":scope > label, label:first-of-type");
      var inputs = field.querySelectorAll("input, select, textarea");
      var cbOnly =
        inputs.length === 1 &&
        inputs[0].type === "checkbox" &&
        lab &&
        lab.contains(inputs[0]);
      if (cbOnly) {
        mark(inputs[0]);
        rows.push({
          label: normText(lab.textContent),
          value: inputs[0].checked ? t("common.export.yes") : t("common.export.no")
        });
        return;
      }
      var inp = field.querySelector("input:not([type=hidden]):not([type=button]):not([type=submit]), select, textarea");
      if (inp && isVisible(inp)) {
        var v = formatInputValue(inp);
        if (v !== null) {
          mark(inp);
          rows.push({ label: lab ? normText(lab.textContent) : "", value: v });
        }
        return;
      }
      if (lab) {
        var disp = field.querySelector(".calculated-payment, .val");
        if (disp && isVisible(disp)) {
          var txt = normText(disp.textContent);
          if (txt) rows.push({ label: normText(lab.textContent), value: txt });
        }
      }
    });

    sectionEl.querySelectorAll(".loan-field").forEach(function (field) {
      if (!isVisible(field)) return;
      var lab = field.querySelector("label");
      var inp = field.querySelector("input:not([type=hidden]), select, textarea");
      if (lab && inp && isVisible(inp)) {
        var v = formatInputValue(inp);
        if (v !== null) {
          mark(inp);
          rows.push({ label: normText(lab.textContent), value: v });
        }
      }
    });

    sectionEl.querySelectorAll(".slider-block").forEach(function (sb) {
      if (!isVisible(sb)) return;
      var lbl = sb.querySelector(".lbl");
      var valEl = sb.querySelector(".val");
      var range = sb.querySelector('input[type="range"]');
      if (lbl && valEl && isVisible(valEl)) {
        if (range) mark(range);
        rows.push({ label: normText(lbl.textContent), value: normText(valEl.textContent) });
      } else if (range && isVisible(range) && !seenControls.has(range)) {
        mark(range);
        rows.push({
          label: lbl ? normText(lbl.textContent) : "Slider",
          value: String(range.value)
        });
      }
    });

    sectionEl.querySelectorAll(".toggle").forEach(function (tog) {
      if (!isVisible(tog)) return;
      var inp = tog.querySelector('input[type="checkbox"]');
      var lab = tog.querySelector("label[for], label");
      if (inp && lab && isVisible(inp)) {
        mark(inp);
        rows.push({
          label: normText(lab.textContent),
          value: inp.checked ? t("common.export.yes") : t("common.export.no")
        });
      }
    });

    sectionEl.querySelectorAll(".row").forEach(function (row) {
      if (!isVisible(row)) return;
      var directLab = null;
      var directInp = null;
      for (var i = 0; i < row.children.length; i++) {
        var c = row.children[i];
        if (c.tagName === "LABEL") directLab = c;
        if (c.matches && c.matches("input,select,textarea")) directInp = c;
      }
      if (directLab && directInp && isVisible(directInp)) {
        var v1 = formatInputValue(directInp);
        if (v1 !== null && !seenControls.has(directInp)) {
          mark(directInp);
          rows.push({ label: normText(directLab.textContent), value: v1 });
        }
        return;
      }
      row.querySelectorAll(":scope > div").forEach(function (div) {
        if (!isVisible(div)) return;
        var l = div.querySelector(":scope > label");
        var inp2 = div.querySelector("input, select, textarea");
        if (l && inp2 && isVisible(inp2) && !seenControls.has(inp2)) {
          var v2 = formatInputValue(inp2);
          if (v2 !== null) {
            mark(inp2);
            rows.push({ label: normText(l.textContent), value: v2 });
          }
        }
      });
    });

    sectionEl.querySelectorAll("input[type=radio]:checked").forEach(function (rad) {
      if (!isVisible(rad) || seenControls.has(rad)) return;
      var labR = rad.closest("label");
      var groupLabel = "";
      var rowEl = rad.closest(".row");
      if (rowEl) {
        var topLab = rowEl.querySelector(":scope > label");
        if (topLab && !topLab.contains(rad)) groupLabel = normText(topLab.textContent);
      }
      var choice = labR ? normText(labR.textContent) : normText(rad.value);
      mark(rad);
      rows.push({
        label: groupLabel || t("common.export.sectionCalculator"),
        value: choice
      });
    });

    return rows;
  }

  function collectOutputRowsFromSection(sectionEl) {
    var rows = [];
    var seen = new Set();
    if (!sectionEl || !isVisible(sectionEl)) return rows;
    var scope = sectionEl;
    var ccpc = getCcpcActiveBlock(sectionEl);
    if (ccpc) scope = ccpc;
    collectKeyValueFromScope(scope, rows, seen);
    return rows;
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

  /** All rows (e.g. accordion / schedule tables even when panels are collapsed). */
  function tableToCsvDeep(table) {
    if (!table) return "";
    var lines = [];
    table.querySelectorAll("tr").forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll("th, td").forEach(function (cell) {
        cells.push(csvEscape(normText(cell.textContent)));
      });
      if (cells.length) lines.push(cells.join(","));
    });
    return lines.join("\r\n");
  }

  function getCalculatorWrap() {
    return document.querySelector(".loan-wrap.wrap, .wrap");
  }

  function findPrimaryCalcRoot() {
    var wrap = getCalculatorWrap();
    if (!wrap) return null;
    var sel =
      ".mortgage-grid, .calc-grid, .loan-calc-grid, .account-grid, .grid, #calc_card, .tool-card";
    var nodes = wrap.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) return nodes[i];
    }
    return null;
  }

  function findMultTableAnchor() {
    var wrap = getCalculatorWrap();
    if (!wrap) return null;
    var t = wrap.querySelector("#multTable");
    return t && isVisible(t) ? t : null;
  }

  function getSectionHeading(ch) {
    var h2 = ch.querySelector("h2.section-title, h2.loan-section-title, h2.tool-card__title");
    if (h2) return normText(h2.textContent);
    h2 = ch.querySelector("h2");
    return h2 ? normText(h2.textContent) : "";
  }

  function matchesSectionChild(ch) {
    if (ch.tagName === "ARTICLE" && ch.classList.contains("panel")) return true;
    if (ch.tagName === "SECTION" && (ch.classList.contains("panel") || ch.classList.contains("card"))) {
      return true;
    }
    return !!(ch.classList && ch.classList.contains("loan-panel"));
  }

  function getSectionBlocks(calcRoot) {
    var root = calcRoot;
    if (calcRoot.id === "calc_card") {
      var simple = calcRoot.querySelector("#simple_section");
      var adv = calcRoot.querySelector("#advanced_section");
      if (simple && isVisible(simple) && !simple.classList.contains("hidden")) {
        root = simple.querySelector(".calc-grid-simple, .calc-grid") || simple;
      } else if (adv && isVisible(adv) && !adv.classList.contains("hidden")) {
        root = adv.querySelector(".calc-grid") || adv;
      }
    }

    var blocks = [];
    var ch = root.children;
    for (var i = 0; i < ch.length; i++) {
      var c = ch[i];
      if (!isVisible(c)) continue;
      if (matchesSectionChild(c)) {
        blocks.push({ el: c, title: getSectionHeading(c) });
      }
    }

    if (!blocks.length && root.classList && root.classList.contains("mortgage-grid")) {
      for (var j = 0; j < root.children.length; j++) {
        var sec = root.children[j];
        if (isVisible(sec) && sec.tagName === "SECTION") {
          blocks.push({ el: sec, title: getSectionHeading(sec) });
        }
      }
    }

    if (!blocks.length && root.classList && root.classList.contains("tool-card")) {
      blocks.push({ el: root, title: getSectionHeading(root) || t("common.export.sectionCalculator") });
    }

    if (!blocks.length) {
      blocks.push({ el: root, title: getSectionHeading(root) || t("common.export.sectionCalculator") });
    }

    return blocks;
  }

  function pushTableCsvOnce(table, csvFn, titleLine, extraSections, seenTables) {
    if (!table || seenTables.has(table)) return;
    var csv = csvFn(table);
    if (!csv) return;
    seenTables.add(table);
    extraSections.push(titleLine + "\r\n" + csv);
  }

  function appendExtraTables(host, extraSections, seenTables) {
    if (!host) return;
    var milestones = host.querySelector(".milestones-table");
    if (milestones && isVisible(milestones)) {
      pushTableCsvOnce(milestones, tableToCsv, t("common.export.milestonesSection"), extraSections, seenTables);
    }
    var monthly = host.querySelector("#monthly_table");
    if (monthly && isVisible(monthly)) {
      pushTableCsvOnce(monthly, tableToCsv, t("common.export.monthlySection"), extraSections, seenTables);
    }
    var schedule = host.querySelector("#scheduleTable, table.schedule-table");
    if (schedule && isVisible(schedule)) {
      pushTableCsvOnce(schedule, tableToCsv, t("common.export.scheduleSection"), extraSections, seenTables);
    }
  }

  function appendMortgageAccordionTables(wrap, extraSections, seenTables) {
    if (!wrap) return;
    wrap.querySelectorAll("table.accordion-table").forEach(function (tbl) {
      var title = t("common.export.mortgageSchedule12");
      if (tbl.id === "table_annual") title = t("common.export.mortgageScheduleAnnual");
      pushTableCsvOnce(tbl, tableToCsvDeep, title, extraSections, seenTables);
    });
  }

  function appendLoanAmortizationTable(wrap, extraSections, seenTables) {
    if (!wrap) return;
    var body = wrap.querySelector("#amortization-body");
    if (!body) return;
    var tbl = body.closest("table");
    pushTableCsvOnce(tbl, tableToCsvDeep, t("common.export.loanAmortizationSection"), extraSections, seenTables);
  }

  function buildExportData(calcRoot, multAnchor) {
    var pageTitle = normText(document.title) || "The Long Math";
    var sections = [];
    var extraSections = [];
    var generatedAt = new Date();
    var seenTables = new WeakSet();

    if (multAnchor && multAnchor.id === "multTable") {
      var csv = tableToCsvDeep(multAnchor);
      if (csv) extraSections.push(t("common.export.compoundTableSection") + "\r\n" + csv);
      sections.push({
        title: t("common.export.compoundTableSection"),
        rows: []
      });
      return { pageTitle: pageTitle, sections: sections, extraSections: extraSections, generatedAt: generatedAt };
    }

    if (!calcRoot) {
      return { pageTitle: pageTitle, sections: sections, extraSections: extraSections, generatedAt: generatedAt };
    }

    var blocks = getSectionBlocks(calcRoot);
    var seenInputs = new WeakSet();

    blocks.forEach(function (block) {
      var inRows = collectInputRowsFromSection(block.el, seenInputs);
      var outRows = collectOutputRowsFromSection(block.el);
      var combined = []
        .concat(
          inRows.map(function (r) {
            return { kind: "input", label: r.label, value: r.value };
          })
        )
        .concat(
          outRows.map(function (r) {
            return { kind: "output", label: r.label, value: r.value };
          })
        );
      if (!combined.length) return;
      sections.push({
        title: block.title || t("common.export.sectionCalculator"),
        rows: combined
      });
    });

    appendExtraTables(calcRoot, extraSections, seenTables);

    var wrapEl = getCalculatorWrap();
    if (wrapEl) {
      appendExtraTables(wrapEl, extraSections, seenTables);
      appendMortgageAccordionTables(wrapEl, extraSections, seenTables);
      appendLoanAmortizationTable(wrapEl, extraSections, seenTables);
    }

    return { pageTitle: pageTitle, sections: sections, extraSections: extraSections, generatedAt: generatedAt };
  }

  function buildPageExportData() {
    var mult = findMultTableAnchor();
    if (mult) {
      return buildExportData(null, mult);
    }
    return buildExportData(findPrimaryCalcRoot(), null);
  }

  function hasExportableContent(data) {
    if (data.extraSections && data.extraSections.length) return true;
    for (var i = 0; i < data.sections.length; i++) {
      if (data.sections[i].rows && data.sections[i].rows.length) return true;
    }
    return false;
  }

  function buildCsv(data) {
    var lines = [];
    lines.push(
      csvEscape(t("common.export.csvTitle")) +
        "," +
        csvEscape(data.pageTitle)
    );
    lines.push(
      csvEscape(t("common.export.generatedAt")) +
        "," +
        csvEscape(data.generatedAt.toISOString())
    );
    lines.push("");
    lines.push(
      [
        csvEscape(t("common.export.csvSectionCol")),
        csvEscape(t("common.export.csvKindCol")),
        csvEscape(t("common.export.csvLabelCol")),
        csvEscape(t("common.export.csvValueCol"))
      ].join(",")
    );

    data.sections.forEach(function (sec) {
      var st = sec.title || "";
      sec.rows.forEach(function (r) {
        lines.push(
          [
            csvEscape(st),
            csvEscape(r.kind === "input" ? t("common.export.kindInput") : t("common.export.kindOutput")),
            csvEscape(r.label),
            csvEscape(r.value)
          ].join(",")
        );
      });
    });

    var body = lines.join("\r\n");
    if (data.extraSections.length) {
      body += "\r\n\r\n" + data.extraSections.join("\r\n\r\n");
    }
    return "\uFEFF" + body;
  }

  function renderStructuredPdf(jsPDF, data) {
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    var pageW = 210;
    var margin = 11;
    var innerW = pageW - margin * 2;
    var y = 14;
    var pad = 2.8;
    var rowUnit = 4.2;

    function newPage() {
      doc.addPage();
      y = 14;
    }

    function ensureSpace(h) {
      if (y + h > 292) newPage();
    }

    doc.setDrawColor(55);
    doc.setTextColor(25);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(data.pageTitle, margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(t("common.export.generatedAt") + ": " + data.generatedAt.toLocaleString(), margin, y);
    y += 6;
    doc.setTextColor(25);

    var labelW = (innerW - pad * 3) * 0.4;
    var valueW = (innerW - pad * 3) * 0.52;
    var lx = margin + pad;
    var vx = margin + pad + labelW + 5;

    data.sections.forEach(function (sec) {
      if (!sec.rows.length) return;
      ensureSpace(12);
      doc.setFillColor(235);
      doc.setDrawColor(72);
      doc.roundedRect(margin, y, innerW, 8, 0.8, 0.8, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(18);
      var stitle = sec.title || t("common.export.sectionCalculator");
      doc.text(doc.splitTextToSize(stitle, innerW - pad * 2), margin + pad, y + 5.2);
      y += 9.5;

      sec.rows.forEach(function (r, idx) {
        var ll = doc.splitTextToSize(r.label || "—", labelW);
        var vl = doc.splitTextToSize(r.value || "—", valueW);
        var lines = Math.max(ll.length, vl.length);
        var bandH = lines * rowUnit + 2;
        ensureSpace(bandH + 1);
        doc.setDrawColor(88);
        doc.setFillColor(idx % 2 === 0 ? 255 : 250);
        doc.roundedRect(margin + 0.5, y, innerW - 1, bandH, 0.5, 0.5, "FD");
        var ty = y + 4;
        doc.setTextColor(85);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text(r.kind === "input" ? t("common.export.kindInput") : t("common.export.kindOutput"), lx, ty);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(28);
        ll.forEach(function (line, li) {
          doc.text(line, lx + 13, ty + li * rowUnit);
        });
        doc.setTextColor(16);
        vl.forEach(function (line, li) {
          doc.text(line, vx, ty + li * rowUnit);
        });
        y += bandH + 1.2;
      });

      y += 3;
    });

    if (data.extraSections.length) {
      ensureSpace(20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(25);
      doc.text(t("common.export.additionalTables"), margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(45);
      data.extraSections.forEach(function (sec) {
        var parts = sec.split("\r\n");
        var max = 55;
        for (var i = 0; i < Math.min(parts.length, max); i++) {
          ensureSpace(5);
          var wrapped = doc.splitTextToSize(parts[i], innerW);
          wrapped.forEach(function (wline) {
            ensureSpace(4.5);
            doc.text(wline, margin, y);
            y += 4.2;
          });
        }
        if (parts.length > max) {
          ensureSpace(5);
          doc.setTextColor(100);
          doc.text("… " + t("common.export.pdfTruncated"), margin, y);
          y += 5;
        }
        y += 3;
      });
    }

    doc.save(baseFilename() + ".pdf");
  }

  function downloadPdf(data) {
    loadJsPdf()
      .then(function (JsPdf) {
        return loadHtml2Canvas()
          .then(function (h2c) {
            return renderScreenshotPdf(JsPdf, h2c, data);
          })
          .catch(function () {
            renderStructuredPdf(JsPdf, data);
          });
      })
      .catch(function (err) {
        console.warn(err);
        window.alert(t("common.export.pdfError"));
      });
  }

  function buildExportDropdown(collect) {
    var root = document.createElement("div");
    root.className = "tlm-export-dropdown";

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "tlm-export-trigger";
    trigger.textContent = t("common.export.exportResults");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-label", t("common.export.ariaGroup"));

    var menu = document.createElement("div");
    menu.className = "tlm-export-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    function runExport(format) {
      var data = collect();
      if (!hasExportableContent(data)) {
        window.alert(t("common.export.noData"));
        return;
      }
      if (format === "csv") {
        downloadText(baseFilename() + ".csv", buildCsv(data), "text/csv;charset=utf-8");
      } else {
        downloadPdf(data);
      }
    }

    function addMenuItem(format, label) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tlm-export-menu-item";
      btn.setAttribute("role", "menuitem");
      btn.textContent = label;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        closeMenu();
        runExport(format);
      });
      menu.appendChild(btn);
    }

    addMenuItem("csv", t("common.export.csv"));
    addMenuItem("pdf", t("common.export.pdf"));

    root.appendChild(trigger);
    root.appendChild(menu);

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });

    return root;
  }

  function findExportMountTarget(wrap) {
    var bar = wrap.querySelector(".inspect-bar");
    if (bar) return { mode: "inspect-bar", el: bar };

    var headers = wrap.querySelectorAll(".results-panel-header");
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].querySelector("a.inspect-arithmetic-btn, .inspect-arithmetic-btn")) {
        return { mode: "results-header", el: headers[i] };
      }
    }

    var tt = wrap.querySelector(".tool-card__top");
    if (tt && wrap.querySelector("#multTable")) {
      return { mode: "tool-top", el: tt };
    }

    var calcRoot = findPrimaryCalcRoot();
    if (calcRoot && calcRoot.parentNode) {
      return { mode: "before-root", parent: calcRoot.parentNode, before: calcRoot };
    }

    return null;
  }

  function mountExportOnce() {
    if (!isCalculatorToolPage()) return;
    var wrap = getCalculatorWrap();
    if (!wrap || wrap.querySelector(".tlm-export-dropdown")) return;

    var target = findExportMountTarget(wrap);
    if (!target) return;

    function collect() {
      return buildPageExportData();
    }

    var dropdown = buildExportDropdown(collect);

    if (target.mode === "inspect-bar") {
      target.el.appendChild(dropdown);
      return;
    }

    if (target.mode === "results-header") {
      var h = target.el;
      if (h.querySelector(".tlm-export-dropdown")) return;
      var h2 = h.querySelector("h2.section-title, h2.tool-card__title");
      var rest = Array.prototype.slice.call(h.children).filter(function (c) {
        return c !== h2;
      });
      var actions = h.querySelector(".results-panel-header-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "results-panel-header-actions";
        rest.forEach(function (c) {
          actions.appendChild(c);
        });
        h.appendChild(actions);
      }
      actions.appendChild(dropdown);
      return;
    }

    if (target.mode === "tool-top") {
      target.el.appendChild(dropdown);
      return;
    }

    if (target.mode === "before-root") {
      var tb = document.createElement("div");
      tb.className = "tlm-calc-toolbar";
      tb.appendChild(dropdown);
      target.parent.insertBefore(tb, target.before);
    }
  }

  function init() {
    mountExportOnce();
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
