#!/usr/bin/env node
"use strict";

/**
 * Calculator fuzz tester (UI-driven via Playwright).
 *
 * What it does
 * - Discovers calculator pages under dist/calculators/<slug>/index.html.
 * - For pages with interactive inputs, generates many scenarios (normal/edge/extreme/invalid),
 *   drives the UI by setting inputs + dispatching events, then reads result DOM.
 * - Reports for each scenario:
 *   1) logic violation (exceptions, error text, non-finite numbers)
 *   2) human-unrealistic but technically compliant output (sanity heuristics)
 * - Summarizes per calculator at the end.
 *
 * Usage
 *   node tools/test-calculators.cjs
 *   node tools/test-calculators.cjs --scenarios-per-calculator 200
 *   node tools/test-calculators.cjs --headless false
 *   node tools/test-calculators.cjs --base-url "https://www.thelongmath.com"
 *
 * Notes
 * - This is heuristic-driven for "human realism". Tune thresholds as needed.
 * - "logic violation" is based on visible error text and numeric finiteness (not financial correctness).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

const { chromium } = require("playwright");

const ARG_SEP = " -- ";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function getBoolArg(val, defaultValue) {
  if (val === undefined) return defaultValue;
  if (typeof val === "boolean") return val;
  const s = String(val).toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return defaultValue;
}

function isFiniteNumber(n) {
  return Number.isFinite(n) && !Number.isNaN(n);
}

function safeJsonStringify(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return JSON.stringify({ error: "Failed to stringify result object." }, null, 2);
  }
}

function makeRandom(seed) {
  // xorshift32
  let s = seed >>> 0;
  return function rand() {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    // 0..1
    return ((s >>> 0) / 4294967296);
  };
}

function pickWeighted(rand, items) {
  const total = items.reduce((a, x) => a + x.weight, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

function serveStaticDist(distDir, port) {
  const root = distDir;
  const server = http.createServer((req, res) => {
    try {
      const parsed = url.parse(req.url);
      let pathname = parsed.pathname || "/";
      if (pathname === "/") pathname = "/index.html";

      // Normalize and prevent escaping root.
      pathname = decodeURIComponent(pathname);
      const fullPath = path.join(root, pathname);

      if (!fullPath.startsWith(path.join(root, path.sep))) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      let finalPath = fullPath;
      if (stat.isDirectory()) {
        finalPath = path.join(fullPath, "index.html");
      }

      let content = fs.readFileSync(finalPath);
      const ext = path.extname(finalPath).toLowerCase();

      const contentTypeMap = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".txt": "text/plain; charset=utf-8",
      };
      const contentType = contentTypeMap[ext] || "application/octet-stream";

      res.statusCode = 200;
      res.setHeader("Content-Type", contentType);
      res.end(content);
    } catch (e) {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function discoverCalculatorSlugs(distDir) {
  const calcRoot = path.join(distDir, "calculators");
  if (!fs.existsSync(calcRoot)) return [];

  const entries = fs.readdirSync(calcRoot, { withFileTypes: true });
  const slugs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(calcRoot, entry.name, "index.html");
    if (!fs.existsSync(indexPath)) continue;
    slugs.push(entry.name);
  }

  // Deterministic order.
  slugs.sort((a, b) => a.localeCompare(b));
  return slugs;
}

function clampNumber(n, lo, hi) {
  if (!isFiniteNumber(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Many calculators use plain text inputs without min/max. The fuzzer would otherwise use a
 * generic ~500–2000 range for every field, producing nonsense years and percentages and
 * false "missing numeric output" failures when the UI correctly shows an em dash.
 */
function fillMissingNumericBounds(inp) {
  if (inp.kind !== "number") return;
  const hasMin = isFiniteNumber(inp.min);
  const hasMax = isFiniteNumber(inp.max);
  if (hasMin && hasMax) return;

  const id = (inp.id || "").toLowerCase();
  let lo = null;
  let hi = null;

  if (id === "birth_year" || id === "birthyear") {
    lo = 1900;
    hi = 2015;
  } else if (
    id === "years" ||
    id === "horizon_years" ||
    id === "time_horizon" ||
    id === "timehorizon" ||
    id === "calc_amortization" ||
    id === "amortization_years" ||
    id === "loanyears"
  ) {
    lo = 1;
    hi = 80;
  } else if ((id.includes("amort") && id.includes("year")) || (id.includes("horizon") && id.includes("year"))) {
    lo = 1;
    hi = 80;
  } else if (id.includes("hour")) {
    lo = 0;
    hi = 8760;
  } else if (
    id.includes("pct") ||
    id.includes("percent") ||
    /\b(return|yield)\b/.test(id) ||
    id.endsWith("_rate") ||
    id === "fees" ||
    id === "mer_pct" ||
    id === "fee_pct" ||
    id === "inflation_rate" ||
    id === "custom_inflation_rate" ||
    id === "home_growth" ||
    id === "marginal_tax_rate" ||
    id === "inclusion_rate" ||
    id === "annual_return" ||
    id === "expected_return" ||
    id === "expectedreturn" ||
    id === "current_rate" ||
    id === "interest_rate" ||
    id === "calc_interest_rate"
  ) {
    lo = 0;
    hi = 100;
  } else if (
    id === "p" ||
    id.includes("balance") ||
    id.includes("contrib") ||
    id.includes("proceeds") ||
    id.includes("acb") ||
    id.includes("payment") ||
    id.includes("budget") ||
    id.includes("income") ||
    id.includes("price") ||
    id.includes("amount") ||
    id.includes("cash") ||
    id.includes("withdrawal") ||
    id.includes("deposit") ||
    id.includes("starting") ||
    id.includes("monthly") ||
    id.includes("annual_contribution") ||
    id.includes("lifetime") ||
    id.includes("total")
  ) {
    lo = 0;
    hi = 5e9;
  } else {
    lo = 0;
    hi = 1e7;
  }

  if (!hasMin && lo != null) inp.min = lo;
  if (!hasMax && hi != null) inp.max = hi;
}

function isLikelyHorizonYearsId(id) {
  const idl = (id || "").toLowerCase();
  return (
    idl === "years" ||
    idl === "horizon_years" ||
    idl === "time_horizon" ||
    idl === "timehorizon" ||
    idl === "calc_amortization" ||
    idl === "amortization_years" ||
    idl === "loanyears" ||
    ((idl.includes("amort") && idl.includes("year")) || (idl.includes("horizon") && idl.includes("year")))
  );
}

function isLikelyPercentInputId(id) {
  const idl = (id || "").toLowerCase();
  if (idl === "birth_year" || idl === "birthyear" || isLikelyHorizonYearsId(id)) return false;
  return (
    idl.includes("pct") ||
    idl.includes("percent") ||
    /\b(return|yield)\b/.test(idl) ||
    idl.endsWith("_rate") ||
    idl === "fees" ||
    idl === "mer_pct" ||
    idl === "fee_pct" ||
    idl === "inflation_rate" ||
    idl === "custom_inflation_rate" ||
    idl === "home_growth" ||
    idl === "marginal_tax_rate" ||
    idl === "inclusion_rate" ||
    idl === "annual_return" ||
    idl === "expected_return" ||
    idl === "expectedreturn" ||
    idl === "current_rate" ||
    idl === "interest_rate" ||
    idl === "calc_interest_rate"
  );
}

function parseMaybeNumber(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  return isFiniteNumber(n) ? n : null;
}

function parseAllNumbersFromText(text) {
  if (!text) return [];
  const s = String(text);
  const matches = s.match(/-?\d[\d,]*\.?\d*/g);
  if (!matches) return [];
  const nums = [];
  for (const m of matches) {
    const n = parseMaybeNumber(m);
    if (n != null) nums.push(n);
  }
  return nums;
}

function parseLabelText(valueObj) {
  if (!valueObj) return "";
  return (valueObj.label || valueObj.id || "").toString();
}

function evaluateRealism({ outputItems, inputAbsMax }) {
  // Heuristics:
  // - negative currency-like outputs -> questionable unless label contains refund/credit/overcontribution/recoup/loss
  // - extremely large magnitudes compared to inputs -> questionable
  // - non-finite numbers are logic violations already (not handled here)
  const negativeAllowedKeywords = [
    "refund",
    "credit",
    "rebate",
    "overcontribution",
    "over-contribution",
    "loss",
    "tax refund",
    "recoup",
    "difference",
    "delta",
  ];

  let questionableCount = 0;
  const questionable = [];

  for (const item of outputItems) {
    const label = parseLabelText(item).toLowerCase();
    const text = item.text || "";
    const nums = parseAllNumbersFromText(text);
    if (nums.length === 0) continue;

    // Currency-negative-ish detection: value text has a '-' and looks like money.
    // We do not perfectly know the type, but this is a decent first pass.
    const hasMinus = text.includes("-");
    const looksMoney = text.includes("$") || label.includes("tax") || label.includes("income") || label.includes("burden");

    const maxAbsOut = nums.reduce((a, n) => Math.max(a, Math.abs(n)), 0);

    const hugeVsInputs = inputAbsMax > 0 ? maxAbsOut > inputAbsMax * 1e6 : maxAbsOut > 1e12;

    if (hugeVsInputs) {
      questionableCount++;
      questionable.push({ id: item.id, label: item.label, kind: "huge-vs-inputs", value: text });
      continue;
    }

    if (hasMinus && looksMoney) {
      const allowed = negativeAllowedKeywords.some((k) => label.includes(k));
      if (!allowed) {
        questionableCount++;
        questionable.push({ id: item.id, label: item.label, kind: "negative-money", value: text });
      }
    }

    // Percent sanity if label hints percent.
    if (label.includes("percent") || label.includes("rate") || label.includes("%")) {
      const maxAbsPct = nums.reduce((a, n) => Math.max(a, Math.abs(n)), 0);
      if (maxAbsPct > 2000) {
        questionableCount++;
        questionable.push({ id: item.id, label: item.label, kind: "abs-percent-too-large", value: text });
      }
    }
  }

  return { questionableCount, questionable };
}

async function runScenarioSet({ page, scenarioCount, calculatorSlug, rand, inputSpecs }) {
  const inputs = inputSpecs.inputs;
  const expects = inputSpecs.expected;

  const scenarioTypes = [
    { value: "normal", weight: 0.6 },
    { value: "edge", weight: 0.25 },
    { value: "extreme", weight: 0.1 },
    { value: "invalid", weight: 0.05 },
  ];

  const pickScenarioType = () => pickWeighted(rand, scenarioTypes);

  let logicViolations = 0;
  let questionableButValid = 0;

  const violationSamples = [];
  const questionableSamples = [];

  // Keep logs small by limiting samples.
  const maxSamples = 8;

  // Drive scenarios.
  for (let i = 0; i < scenarioCount; i++) {
    const scenarioType = pickScenarioType();
    const expectedValid = scenarioType !== "invalid";

    // Generate values.
    const valuesById = {};
    let maxAbsInput = 0;

    for (const inp of inputs) {
      const { id, kind, tag, min, max, step } = inp;

      if (kind === "select") {
        const options = inp.options || [];
        if (scenarioType === "invalid") {
          valuesById[id] = options.find((o) => o.value === "")?.value ?? "";
        } else {
          // Prefer non-empty.
          const candidates = options.filter((o) => o.value !== "");
          const chosen = candidates.length ? candidates[Math.floor(rand() * candidates.length)] : options[0];
          valuesById[id] = chosen ? chosen.value : "";
        }
        continue;
      }

      // Numeric input
      const actualMin = isFiniteNumber(min) ? min : null;
      const actualMax = isFiniteNumber(max) ? max : null;

      let value;
      if (scenarioType === "invalid") {
        // Non-numeric or negative where applicable.
        value = rand() < 0.5 ? "abc" : "-10";
      } else if (scenarioType === "edge") {
        if (actualMin != null && actualMax != null) {
          const choices = [actualMin, actualMax, 0, actualMin + (actualMax - actualMin) * 0.5];
          const pick = choices[Math.floor(rand() * choices.length)];
          value = clampNumber(pick, actualMin, actualMax);
        } else {
          // Heuristic fallback
          value = rand() < 0.5 ? 0 : 1;
        }
      } else if (scenarioType === "extreme") {
        if (isLikelyHorizonYearsId(id) && actualMax != null) {
          // Stay in a range the growth formulas can represent without NaN.
          value = Math.min(actualMax * (1.2 + rand() * 0.8), 120);
        } else if (isLikelyPercentInputId(id) && actualMax != null) {
          const lo = actualMin != null ? actualMin : 0;
          value = lo + (actualMax - lo) * (0.88 + rand() * 0.12);
        } else if (actualMax != null) {
          value = actualMax * (1.25 + rand() * 1.75);
        } else if (actualMin != null && actualMin >= 0) {
          value = actualMin * (1000 + Math.floor(rand() * 1000));
        } else {
          value = 1e9 * (0.5 + rand());
        }
      } else {
        // normal
        if (actualMin != null && actualMax != null) {
          value = actualMin + (actualMax - actualMin) * rand();
        } else {
          value = 1000 * (0.5 + rand());
        }
      }

      if (step && isFiniteNumber(step) && step > 0) {
        value = Math.round(value / step) * step;
      }

      // Track maxAbs input based on finite numeric inputs.
      const n = typeof value === "number" ? value : parseMaybeNumber(value);
      if (n != null && isFiniteNumber(n)) maxAbsInput = Math.max(maxAbsInput, Math.abs(n));

      valuesById[id] = String(value);
    }

    // Apply values in the browser.
    await page.evaluate((payload) => {
      const valuesById = payload.values;
      for (const id in valuesById) {
        const el = document.getElementById(id);
        if (!el) continue;
        const v = valuesById[id];
        if (el.tagName === "SELECT") {
          el.value = v;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }
    }, { values: valuesById });

    // Try to click a calculate button if present (some calculators rely on explicit click).
    // Keep this best-effort and cheap.
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button")).filter((b) => {
        const t = (b.textContent || "").toLowerCase();
        const id = (b.id || "").toLowerCase();
        return (
          t.includes("calculate") ||
          t.includes("compute") ||
          t.includes("update") ||
          id.includes("calculate") ||
          id.includes("compute")
        );
      });
      if (candidates.length) candidates[0].click();
    });

    await page.waitForTimeout(150);

    const evalResult = await page.evaluate(() => {
      function extractFromResultsContainers() {
        const items = [];

        // TFSA-style: .results .result-row with .label and .value (id starts with out_ often).
        document.querySelectorAll(".results .result-row").forEach((row) => {
          const label = row.querySelector(".label")?.textContent?.trim() || "";
          const valEl = row.querySelector(".value[id]") || row.querySelector("[id].value") || row.querySelector("[id].highlight-value");
          if (!valEl) return;
          items.push({ id: valEl.id || "", label, text: (valEl.textContent || "").trim() });
        });

        // Canada-income-tax-style: .results .result with p.k and p.v
        document.querySelectorAll(".results .result").forEach((row) => {
          const label = row.querySelector("p.k")?.textContent?.trim() || "";
          const valEl = row.querySelector("p.v[id]") || row.querySelector("p.v") || row.querySelector("[id].v");
          if (!valEl) return;
          const id = valEl.id || "";
          items.push({ id, label, text: (valEl.textContent || "").trim() });
        });

        // Fee-style tools: .out .kv with .k label and .v[id] value (e.g. active-vs-passive-break-even).
        document.querySelectorAll(".out .kv").forEach((row) => {
          const label = row.querySelector(".k")?.textContent?.trim() || "";
          const valEl = row.querySelector(".v[id]") || row.querySelector(".v");
          if (!valEl || !valEl.id) return;
          items.push({ id: valEl.id, label, text: (valEl.textContent || "").trim() });
        });

        return items;
      }

      const items = [];
      const fromResults = extractFromResultsContainers();
      for (const it of fromResults) items.push(it);

      // out_* fallback
      document.querySelectorAll('[id^="out_"]').forEach((el) => {
        items.push({ id: el.id, label: "", text: (el.textContent || "").trim() });
      });

      // De-dupe by id (prefer first non-empty text).
      const byId = new Map();
      for (const it of items) {
        if (!it.id) continue;
        if (!byId.has(it.id) || it.text) byId.set(it.id, it);
      }

      return Array.from(byId.values());
    });

    const outputItems = evalResult;

    // Logic violation detection
    let logicViolation = false;
    const errorSignals = [];

    for (const item of outputItems) {
      const text = item.text || "";
      const lower = text.toLowerCase();
      if (lower.includes("error") || lower.includes("loading") || lower.includes("not found")) {
        logicViolation = true;
        errorSignals.push({ id: item.id, label: item.label, text });
      }

      // numeric parsing checks
      const nums = (text.match(/-?\d[\d,]*\.?\d*/g) || []).map((m) => Number(m.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
      // If the text has numbers-like substrings but parsing resulted in empties, we can't reliably decide.
      for (const n of nums) {
        if (!Number.isFinite(n)) logicViolation = true;
      }
    }

    // Missing numeric outputs (only considered for "expectedValid" scenarios)
    if (!logicViolation && expectedValid) {
      let anyMeaningful = false;
      for (const item of outputItems) {
        const text = (item.text || "").trim();
        if (!text) continue;
        if (text.includes("–") || text === "—" || text === "–") continue;
        if (text.toLowerCase().includes("error") || text.toLowerCase().includes("loading")) continue;
        const hasNumber = /-?\d/.test(text.replace(/,/g, ""));
        if (hasNumber) {
          anyMeaningful = true;
          break;
        }
      }
      if (!anyMeaningful) {
        logicViolation = true;
        errorSignals.push({ id: "outputs", label: "missing-numeric", text: "No numeric-like outputs found" });
      }
    }

    if (logicViolation) {
      logicViolations++;
      if (violationSamples.length < maxSamples) {
        violationSamples.push({
          scenarioIndex: i,
          scenarioType,
          expectedValid,
          inputValues: valuesById,
          maxAbsInput,
          outputItems,
          errorSignals,
        });
      }
      continue;
    }

    // Human realism
    const { questionableCount, questionable } = evaluateRealism({
      outputItems,
      inputAbsMax: maxAbsInput,
    });

    if (questionableCount > 0) {
      questionableButValid++;
      if (questionableSamples.length < maxSamples) {
        questionableSamples.push({
          scenarioIndex: i,
          scenarioType,
          expectedValid,
          inputValues: valuesById,
          maxAbsInput,
          outputItems,
          questionable,
        });
      }
    }
  }

  return {
    logicViolations,
    questionableButValid,
    violationSamples,
    questionableSamples,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const distDir = path.resolve(__dirname, "..", "dist");
  const port = args.port ? Number(args.port) : 4174;
  const baseUrl = args["base-url"];
  const headless = getBoolArg(args.headless, true) ? true : false;
  const scenariosPerCalculator = args["scenarios-per-calculator"] ? Number(args["scenarios-per-calculator"]) : 200;
  const maxCalculators = args["max-calculators"] ? Number(args["max-calculators"]) : 9999;
  const seed = args.seed ? Number(args.seed) : 1337;
  const resultsOut = args["results-out"];

  const rand = makeRandom(seed);

  let server = null;
  let actualBaseUrl = baseUrl;

  if (!actualBaseUrl) {
    console.log("Starting local static server for " + distDir + " on port " + port + " ...");
    server = await serveStaticDist(distDir, port);
    actualBaseUrl = "http://127.0.0.1:" + port;
  } else {
    console.log("Using live/base URL: " + actualBaseUrl);
  }

  console.log("Discovering calculator pages under " + path.join(distDir, "calculators") + " ...");
  const allSlugs = discoverCalculatorSlugs(distDir);
  const slugs = allSlugs.slice(0, maxCalculators);

  console.log("Found " + allSlugs.length + " calculator(s). Testing " + slugs.length + " ...");

  const browser = await chromium.launch({ headless: headless ? true : false });
  const page = await browser.newPage();

  const results = {
    seed,
    scenariosPerCalculator,
    maxCalculators,
    calculators: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  for (let ci = 0; ci < slugs.length; ci++) {
    const slug = slugs[ci];
    const calcUrl = actualBaseUrl + "/calculators/" + slug + "/";

    console.log("[" + (ci + 1) + "/" + slugs.length + "] " + slug + " ...");

    let pageErrors = 0;
    let consoleErrors = 0;

    pageErrors = 0;
    consoleErrors = 0;

    page.removeAllListeners();
    page.on("pageerror", () => {
      pageErrors++;
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors++;
    });

    try {
      await page.goto(calcUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);

      // Collect inputs
      const inputSpecs = await page.evaluate(() => {
        const inputs = [];
        const inputEls = Array.from(document.querySelectorAll("input[id]"))
          .filter((el) => el.type !== "hidden" && !el.disabled);
        const selectEls = Array.from(document.querySelectorAll("select[id]")).filter((el) => !el.disabled);

        function readNumberAttr(el, name) {
          const v = el.getAttribute(name);
          if (v == null) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        }

        for (const el of inputEls) {
          const id = el.id;
          const type = (el.type || "").toLowerCase();
          const inputmode = (el.getAttribute("inputmode") || "").toLowerCase();

          const likelyNumeric =
            type === "number" ||
            inputmode.includes("decimal") ||
            inputmode.includes("numeric") ||
            (el.placeholder && /-?\d/.test(el.placeholder)) ||
            (el.value && /-?\d/.test(el.value));

          // Keep text inputs that look numeric (inputmode decimal/numeric) or type number.
          if (!likelyNumeric) continue;

          inputs.push({
            id,
            kind: "number",
            tag: "input",
            min: readNumberAttr(el, "min"),
            max: readNumberAttr(el, "max"),
            step: readNumberAttr(el, "step"),
          });
        }

        for (const el of selectEls) {
          const id = el.id;
          const options = Array.from(el.querySelectorAll("option")).map((o) => ({
            value: o.value,
            label: (o.textContent || "").trim(),
          }));
          inputs.push({
            id,
            kind: "select",
            tag: "select",
            options,
          });
        }

        // Determine whether any inputs are present.
        const hasInputs = inputs.length > 0;
        return {
          inputs,
          expected: {
            hasInputs,
          },
        };
      });

      for (const inp of inputSpecs.inputs) fillMissingNumericBounds(inp);

      const hasInteractiveInputs = inputSpecs.expected.hasInputs;

      if (!hasInteractiveInputs) {
        results.calculators[slug] = {
          calcUrl,
          static: true,
          scenariosTested: 0,
          logicViolations: 0,
          questionableButValid: 0,
          pageErrors,
          consoleErrors,
          notes: "No interactive inputs detected; skipped scenario fuzzing.",
        };
        continue;
      }

      const scenarioResult = await runScenarioSet({
        page,
        scenarioCount: scenariosPerCalculator,
        calculatorSlug: slug,
        rand,
        inputSpecs,
      });

      results.calculators[slug] = {
        calcUrl,
        static: false,
        scenariosTested: scenariosPerCalculator,
        logicViolations: scenarioResult.logicViolations + (pageErrors > 0 ? 1 : 0),
        questionableButValid: scenarioResult.questionableButValid,
        pageErrors,
        consoleErrors,
        violationSamples: scenarioResult.violationSamples,
        questionableSamples: scenarioResult.questionableSamples,
      };
    } catch (e) {
      results.calculators[slug] = {
        calcUrl,
        static: false,
        scenariosTested: 0,
        logicViolations: 1,
        questionableButValid: 0,
        pageErrors,
        consoleErrors,
        error: e && e.message ? e.message : String(e),
      };
    }
  }

  results.finishedAt = new Date().toISOString();

  // Summary
  const perCalc = Object.entries(results.calculators);
  let totalLogic = 0;
  let totalQ = 0;
  let tested = 0;

  for (const [, r] of perCalc) {
    if (!r || r.static) continue;
    totalLogic += r.logicViolations || 0;
    totalQ += r.questionableButValid || 0;
    tested++;
  }

  console.log("");
  console.log("Summary:");
  console.log("- Calculators tested (interactive): " + tested + "/" + perCalc.length);
  console.log("- Total logic violations: " + totalLogic);
  console.log("- Total questionable outputs: " + totalQ);

  // Print top offenders.
  const offenders = perCalc
    .filter(([, r]) => r && !r.static)
    .map(([slug, r]) => ({ slug, logicViolations: r.logicViolations || 0, questionableButValid: r.questionableButValid || 0 }))
    .sort((a, b) => b.logicViolations - a.logicViolations || b.questionableButValid - a.questionableButValid)
    .slice(0, 10);

  if (offenders.length) {
    console.log("");
    console.log("Top offenders (logic violations first):");
    for (const o of offenders) {
      console.log("- " + o.slug + ": logic=" + o.logicViolations + ", questionable=" + o.questionableButValid);
    }
  }

  if (resultsOut) {
    const outPath = path.resolve(__dirname, "..", resultsOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, safeJsonStringify(results), "utf8");
    console.log("\nWrote detailed results to: " + outPath);
  }

  await browser.close();
  if (server) server.close();
}

main().catch((e) => {
  console.error("Fatal:", e && e.stack ? e.stack : e);
  process.exit(1);
});

