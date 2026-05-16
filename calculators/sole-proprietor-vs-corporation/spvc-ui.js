/**
 * Sole proprietor vs corporation calculator — UI bindings.
 */
import { runComparison, formatShareSummary } from "./spvc-engine.js";

const SPVC_VER = "20260429";
const CALC_NAME = "sole-proprietor-vs-corporation";

const PROVINCES = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
];

function $(id) {
  return document.getElementById(id);
}

function parseNum(el) {
  if (!el) return NaN;
  const cleaned = String(el.value || "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/\u00a0/g, "");
  const x = Number(cleaned);
  return Number.isFinite(x) ? x : NaN;
}

function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtPctOne(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(1) + "%";
}

function fmtEffPerGross(r) {
  const v = Number(r) || 0;
  return `${v.toFixed(3)} per $1 gross`;
}

function setText(id, s) {
  const el = $(id);
  if (el) el.textContent = s;
}

function setError(msg) {
  const b = $("spvc_error");
  if (!b) return;
  if (!msg) {
    b.classList.add("hidden");
    b.textContent = "";
    return;
  }
  b.classList.remove("hidden");
  b.textContent = msg;
}

function setShareStatus(msg, isErr) {
  const el = $("result_share_status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "var(--danger, #e57373)" : "";
}

function markShareReady() {
  const shareBlock = $("spvc_share_block");
  if (shareBlock) shareBlock.classList.add("is-ready-to-share");
}

function collectInputs() {
  const province = $("province")?.value || "ON";
  const taxYear = parseInt($("taxYear")?.value || "2025", 10) || 2025;
  const businessIncome = parseNum($("businessIncome"));
  const spendingNeed = parseNum($("spendingNeed"));
  const rrspRoom = parseNum($("rrspRoom"));
  const annualReturn = parseNum($("annualReturn"));
  const projectionYears = parseNum($("projectionYears"));
  const autoRrsp = $("autoRrsp")?.checked !== false;
  const reinvestRefund = $("reinvestRefund")?.checked !== false;
  const investSurplus = $("investSurplus")?.checked !== false;
  const retainEarnings = $("retainEarnings")?.checked !== false;
  const showProjection = $("showProjection")?.checked === true;
  const corpRateOverride = $("corpRateOverride")?.value?.trim();
  const withdrawalMode = $("withdrawalMode")?.value || "dividend";
  const salaryBlendFraction = (parseNum($("salaryBlendFraction")) || 50) / 100;
  const corpPassiveDrag = parseNum($("corpPassiveDrag"));

  return {
    province,
    taxYear,
    businessIncome,
    spendingNeed,
    rrspRoom,
    annualReturn,
    projectionYears,
    autoRrsp,
    reinvestRefund,
    investSurplus,
    retainEarnings,
    showProjection,
    corpRateOverride,
    withdrawalMode,
    salaryBlendFraction,
    corpPassiveDrag,
  };
}

function buildQueryParams(result) {
  const raw = collectInputs();
  return {
    v: 1,
    sver: SPVC_VER,
    prov: raw.province,
    y: String(raw.taxYear),
    g: String(Math.round(raw.businessIncome)),
    s: String(Math.round(raw.spendingNeed)),
    room: String(Math.round(raw.rrspRoom)),
    ar: String(raw.annualReturn.toFixed(2)),
    py: String(Math.round(raw.projectionYears)),
    auto: raw.autoRrsp ? "1" : "0",
    rc: raw.autoRrsp ? "" : String(Math.round(parseNum($("rrspContribution")) || 0)),
    rr: raw.reinvestRefund ? "1" : "0",
    inv: raw.investSurplus ? "1" : "0",
    ret: raw.retainEarnings ? "1" : "0",
    proj: raw.showProjection ? "1" : "0",
    corp: raw.corpRateOverride || "",
    wm: raw.withdrawalMode,
    sb: String(Math.round((raw.salaryBlendFraction || 0.5) * 100)),
    drag: String(raw.corpPassiveDrag.toFixed(2)),
  };
}

function applyQueryParams() {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get("v") == null) return;
    const prov = u.searchParams.get("prov");
    if (prov && $("province")) $("province").value = prov;
    const y = u.searchParams.get("y");
    if (y && $("taxYear")) $("taxYear").value = y;
    const g = u.searchParams.get("g");
    if (g != null && $("businessIncome")) $("businessIncome").value = g;
    const s = u.searchParams.get("s");
    if (s != null && $("spendingNeed")) $("spendingNeed").value = s;
    const room = u.searchParams.get("room");
    if (room != null && $("rrspRoom")) $("rrspRoom").value = room;
    const ar = u.searchParams.get("ar");
    if (ar != null && $("annualReturn")) $("annualReturn").value = ar;
    const py = u.searchParams.get("py");
    if (py != null && $("projectionYears")) $("projectionYears").value = py;
    if (u.searchParams.get("auto") === "0" && $("autoRrsp")) $("autoRrsp").checked = false;
    const rc = u.searchParams.get("rc");
    if (rc != null && $("rrspContribution")) $("rrspContribution").value = rc;
    if (u.searchParams.get("rr") === "0" && $("reinvestRefund")) $("reinvestRefund").checked = false;
    if (u.searchParams.get("inv") === "0" && $("investSurplus")) $("investSurplus").checked = false;
    if (u.searchParams.get("ret") === "0" && $("retainEarnings")) $("retainEarnings").checked = false;
    if (u.searchParams.get("proj") === "1" && $("showProjection")) $("showProjection").checked = true;
    const corp = u.searchParams.get("corp");
    if (corp != null && $("corpRateOverride")) $("corpRateOverride").value = corp;
    const wm = u.searchParams.get("wm");
    if (wm && $("withdrawalMode")) $("withdrawalMode").value = wm;
    const sb = u.searchParams.get("sb");
    if (sb != null && $("salaryBlendFraction")) $("salaryBlendFraction").value = sb;
    const drag = u.searchParams.get("drag");
    if (drag != null && $("corpPassiveDrag")) $("corpPassiveDrag").value = drag;
  } catch (_e) {
    /* ignore */
  }
}

function syncRrspDisabled() {
  const auto = $("autoRrsp")?.checked !== false;
  const inp = $("rrspContribution");
  if (inp) {
    inp.disabled = auto;
    inp.setAttribute("aria-disabled", auto ? "true" : "false");
  }
}

function syncWithdrawalBlend() {
  const wm = $("withdrawalMode")?.value;
  const row = $("blendFractionRow");
  if (row) row.style.display = wm === "blend" ? "" : "none";
}

function syncProjectionVisibility() {
  const on = $("showProjection")?.checked === true;
  const row = $("projectionFieldsRow");
  if (row) row.style.display = on ? "" : "none";
}

function buildSharePayload(result) {
  if (!window.TLM || !window.TLM.shareCard) return null;
  const q = buildQueryParams(result);
  const url = window.TLM.shareCard.buildResultUrl(window.location.href.split("#")[0], q);
  const winner = result.comparison.winner === "corporation" ? "Corporation (retained)" : "Sole prop + RRSP";
  const diff = fmtMoney(Math.abs(result.comparison.diffFirstYear));
  const headline = `${winner} leads this year`;
  const primaryLine = formatShareSummary(result);

  return {
    calculatorName: CALC_NAME,
    title: "Sole Proprietor vs Corporation Calculator | The Long Math",
    brand: "The Long Math",
    headline,
    mainValue: diff,
    subline: primaryLine,
    contextLines: [
      `Personal / RRSP invested: ${fmtMoney(result.comparison.personalInvested)}`,
      `Corporation retained: ${fmtMoney(result.comparison.corpInvested)}`,
      `Gross business income: ${fmtMoney(result.inputs.businessIncome)}`,
    ],
    footer: "Run your own numbers at TheLongMath.com",
    shareText: primaryLine,
    url,
  };
}

let latestResult = null;
let latestSharePayload = null;
let refreshSeq = 0;

async function refresh() {
  const seq = ++refreshSeq;
  setError("");
  syncRrspDisabled();
  syncWithdrawalBlend();
  syncProjectionVisibility();

  const raw = collectInputs();
  if (!raw.province) {
    setError("Select a province or territory.");
    return;
  }
  if (!Number.isFinite(raw.businessIncome) || !Number.isFinite(raw.spendingNeed)) {
    setError("Enter valid numbers for income and spending.");
    return;
  }

  const merged = {
    province: raw.province,
    taxYear: raw.taxYear,
    businessIncome: raw.businessIncome,
    spendingNeed: raw.spendingNeed,
    rrspRoom: Number.isFinite(raw.rrspRoom) ? raw.rrspRoom : 0,
    annualReturn: Number.isFinite(raw.annualReturn) ? raw.annualReturn : 5,
    projectionYears: Number.isFinite(raw.projectionYears) ? raw.projectionYears : 20,
    reinvestRefund: raw.reinvestRefund,
    investSurplus: raw.investSurplus,
    retainEarnings: raw.retainEarnings,
    showProjection: raw.showProjection,
    corpRateOverride: raw.corpRateOverride,
    withdrawalMode: raw.withdrawalMode,
    salaryBlendFraction: raw.salaryBlendFraction,
    corpPassiveDrag: Number.isFinite(raw.corpPassiveDrag) ? raw.corpPassiveDrag : 0,
    autoRrsp: raw.autoRrsp,
  };
  if (!raw.autoRrsp) {
    merged.rrspContribution = Math.max(0, parseNum($("rrspContribution")) || 0);
  }

  try {
    const result = await runComparison(merged);
    if (seq !== refreshSeq) return;
    latestResult = result;

    /* Default SB rate helper */
    if (result.meta.defaultSmallBusinessCombinedRatePct != null) {
      const hint = $("corpRateHint");
      if (hint) {
        hint.textContent =
          `Table combined small-business rate on first dollar (before override): ${fmtPctOne(result.meta.defaultSmallBusinessCombinedRatePct)}. Income above the small-business limit blends to general corporate rates (see Inspect the arithmetic).`;
      }
    }

    const winCorp = result.comparison.winner === "corporation";
    const heroTitle = winCorp
      ? "Better structure this year (first-year invested capital): Corporation"
      : "Better structure this year (first-year invested capital): Sole proprietorship + RRSP";

    setText("out_hero_title", heroTitle);
    setText(
      "out_hero_diff",
      `Difference (corporation minus sole prop / RRSP): ${fmtMoney(result.comparison.diffFirstYear)}.`
    );

    const pct = result.comparison.pctAdvantageVsLoser;
    let pctLine = "";
    if (pct != null && Number.isFinite(pct)) {
      if (winCorp) {
        pctLine = `Corporation provides ${fmtPctOne(pct)} more capital to invest this year than the sole proprietor / RRSP path (relative to the lower base).`;
      } else {
        pctLine = `Sole proprietorship + RRSP provides ${fmtPctOne(pct)} more capital to invest this year than retained corporate capital (relative to the lower base).`;
      }
    }
    setText("out_hero_pct", pctLine);

    setText("out_personal_inv", fmtMoney(result.comparison.personalInvested));
    setText("out_corp_inv", fmtMoney(result.comparison.corpInvested));
    setText("out_diff", fmtMoney(result.comparison.diffFirstYear));
    setText("out_eff_p", fmtEffPerGross(result.personal.effectivePerDollarGross));
    setText("out_eff_c", fmtEffPerGross(result.corporate.effectivePerDollarGross));

    /* Breakdown tables */
    setText("bd_gross_p", fmtMoney(result.personal.grossBusinessIncome));
    setText("bd_rrsp", fmtMoney(result.personal.rrspContribution));
    setText("bd_refund", fmtMoney(result.personal.rrspRefund));
    setText("bd_ptax", fmtMoney(result.personal.personalTaxWithRrsp));
    setText("bd_spend", fmtMoney(result.personal.spendingNeed));
    setText("bd_wallet_after_rrsp", fmtMoney(result.personal.walletAfterRrspContribution));
    setText("bd_rrsp_inv", fmtMoney(result.personal.rrspContribution));
    setText("bd_refund_inv", fmtMoney(result.personal.refundReinvested));
    setText("bd_nonreg", fmtMoney(result.personal.nonRegisteredSurplusInvested));
    setText("bd_personal_total", fmtMoney(result.personal.totalInvested));

    setText("bd_gross_c", fmtMoney(result.corporate.grossCorporateIncome));
    setText("bd_ctax", fmtMoney(result.corporate.corporateTax));
    setText("bd_after_c", fmtMoney(result.corporate.afterTaxCorporateIncome));
    setText("bd_withdraw", fmtMoney(result.corporate.corpCashUsedForWithdrawal));
    setText("bd_ptax_w", fmtMoney(result.corporate.personalTaxOnWithdrawal));
    setText("bd_retained", fmtMoney(result.corporate.retainedForInvestment));
    setText("bd_corp_total", fmtMoney(result.corporate.retainedForInvestment));

    const sumEl = $("result_summary_text");
    if (sumEl) sumEl.textContent = formatShareSummary(result);

    /* Warnings */
    const w1 = $("spvc_warn_personal");
    if (w1) {
      if (!result.personal.lifestyleFeasible) {
        const walletText = $("bd_wallet_after_rrsp")?.textContent || fmtMoney(result.personal.walletAfterRrspContribution);
        const spendText = $("bd_spend")?.textContent || fmtMoney(result.personal.spendingNeed);
        w1.classList.remove("hidden");
        w1.textContent = `Warning: after-tax cash after the RRSP contribution (${walletText}) is below your stated after-tax spending need (${spendText}). This scenario may be cash-flow strained; results are still shown for comparison.`;
      } else {
        w1.classList.add("hidden");
        w1.textContent = "";
      }
    }
    const w2 = $("spvc_warn_corp");
    if (w2) {
      if (!result.corporate.feasible) {
        w2.classList.remove("hidden");
        w2.textContent = `Warning: the corporation path cannot fully fund the stated after-tax spending need from the available after-tax corporate pool (shortfall about ${fmtMoney(result.corporate.lifestyleShortfall)}). Withdrawals are maximized; retained capital may be $0.`;
      } else {
        w2.classList.add("hidden");
        w2.textContent = "";
      }
    }

    /* Projection */
    const pb = $("spvc_projection_block");
    if (pb) {
      if (result.projection) {
        pb.classList.remove("hidden");
        setText("out_fv_p", fmtMoney(result.projection.fvPersonal));
        setText("out_fv_c", fmtMoney(result.projection.fvCorp));
        setText("out_fv_d", fmtMoney(result.projection.fvDiff));
      } else {
        pb.classList.add("hidden");
      }
    }

    latestSharePayload = buildSharePayload(result);
    markShareReady();
    setShareStatus("");
  } catch (e) {
    if (seq !== refreshSeq) return;
    console.error(e);
    setError(e.message || "Calculation failed.");
    latestResult = null;
    latestSharePayload = null;
    const sb = $("spvc_share_block");
    if (sb) sb.classList.remove("is-ready-to-share");
    const w1 = $("spvc_warn_personal");
    const w2 = $("spvc_warn_corp");
    if (w1) {
      w1.classList.add("hidden");
      w1.textContent = "";
    }
    if (w2) {
      w2.classList.add("hidden");
      w2.textContent = "";
    }
  }
}

function populateProvinces() {
  const sel = $("province");
  if (!sel) return;
  sel.innerHTML = "";
  for (const p of PROVINCES) {
    const o = document.createElement("option");
    o.value = p.code;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = "ON";
}

function debounce(fn, ms) {
  let t;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

export function initSpvcUi() {
  populateProvinces();
  applyQueryParams();
  syncRrspDisabled();
  syncWithdrawalBlend();
  syncProjectionVisibility();

  const debounced = debounce(refresh, 160);

  [
    "province",
    "taxYear",
    "businessIncome",
    "spendingNeed",
    "rrspRoom",
    "annualReturn",
    "projectionYears",
    "autoRrsp",
    "rrspContribution",
    "reinvestRefund",
    "investSurplus",
    "retainEarnings",
    "showProjection",
    "corpRateOverride",
    "withdrawalMode",
    "salaryBlendFraction",
    "corpPassiveDrag",
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", debounced);
    el.addEventListener("change", debounced);
  });

  $("autoRrsp")?.addEventListener("change", () => {
    syncRrspDisabled();
    refresh();
  });
  $("withdrawalMode")?.addEventListener("change", syncWithdrawalBlend);
  $("showProjection")?.addEventListener("change", syncProjectionVisibility);

  $("copy_summary_btn")?.addEventListener("click", async () => {
    if (!latestResult) return;
    const text = formatShareSummary(latestResult);
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus("Summary copied to clipboard.", false);
    } catch (_e) {
      setShareStatus("Could not copy automatically.", true);
    }
  });

  if (window.TLM && window.TLM.shareCard) {
    $("share_result_btn")?.addEventListener("click", async () => {
      if (!latestSharePayload) return;
      try {
        await window.TLM.shareCard.shareResultCard(latestSharePayload);
      } catch (e) {
        setShareStatus(e.message || "Share failed.", true);
      }
    });
    $("download_result_btn")?.addEventListener("click", async () => {
      if (!latestSharePayload) return;
      await window.TLM.shareCard.downloadResultCard(latestSharePayload);
    });
    $("copy_result_link_btn")?.addEventListener("click", async () => {
      if (!latestSharePayload) return;
      await window.TLM.shareCard.copyResultLink(latestSharePayload);
      setShareStatus("Shareable link copied.", false);
    });
  }

  refresh();
}

document.addEventListener("DOMContentLoaded", initSpvcUi);
