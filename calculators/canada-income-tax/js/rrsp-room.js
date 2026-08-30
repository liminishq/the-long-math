/**
 * Shared RRSP contribution-room arithmetic.
 * Used by the TFSA/RRSP/FHSA calculator, RRSP room & refund calculator, and related tools.
 */

/** Indexed CRA dollar maximum on new RRSP room from earned income (by tax year). */
export const RRSP_LIMITS = {
  2025: 32490,
  2026: 33810
};

export function parseRrspNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Dollar cap on new RRSP room for a tax year.
 * Prefer rrspDollarMax from loaded federal tax data when available.
 */
export function getRrspDollarCap({ taxYear, rrspDollarMax } = {}) {
  if (Number.isFinite(rrspDollarMax) && rrspDollarMax > 0) return rrspDollarMax;
  const y = Number(taxYear) || 2026;
  return RRSP_LIMITS[y] ?? RRSP_LIMITS[2026];
}

/**
 * New RRSP deduction room earned for one calendar year:
 * min(roomRate × earned income, dollar cap).
 *
 * Second argument may be a dollar cap (legacy) or an options object.
 */
export function computeRrspNewAnnualRoom(earnedIncome, optionsOrCap = {}) {
  const options =
    typeof optionsOrCap === "number" ? { dollarCap: optionsOrCap } : optionsOrCap || {};
  const inc = Math.max(0, Number(earnedIncome) || 0);
  const rate = Number(options.roomRate) || 0.18;
  const cap = getRrspDollarCap({
    taxYear: options.taxYear,
    rrspDollarMax: options.dollarCap
  });
  const fromIncome = inc * rate;
  if (!Number.isFinite(cap) || cap <= 0) return fromIncome;
  return Math.min(fromIncome, cap);
}

/**
 * Estimated total RRSP deduction room available for a tax year before any new contribution.
 * Matches the RRSP Contribution Room & Tax Refund calculator formula.
 */
export function computeRrspContributionRoom(inputs) {
  const year =
    typeof inputs.taxYear === "string"
      ? parseInt(inputs.taxYear, 10) || 2026
      : inputs.taxYear || 2026;
  const priorEarnedIncome = parseRrspNumber(inputs.priorEarnedIncome);
  const unusedRoom = parseRrspNumber(inputs.unusedRoom);
  const pa = parseRrspNumber(inputs.pa);
  const par = parseRrspNumber(inputs.par);
  const pspa = parseRrspNumber(inputs.pspa);
  const craOverrideEnabled = !!inputs.craOverrideEnabled;
  const craLimitOverride = parseRrspNumber(inputs.craLimitOverride);
  const roomRate = Number(inputs.roomRate) || 0.18;
  const dollarCap = getRrspDollarCap({
    taxYear: year,
    rrspDollarMax: inputs.rrspDollarMax
  });

  const newRoom = computeRrspNewAnnualRoom(priorEarnedIncome, {
    dollarCap,
    roomRate,
    taxYear: year
  });

  const estimatedAvailableRoom = unusedRoom + newRoom - pa + par - pspa;
  const availableRoomForDeduction = craOverrideEnabled
    ? craLimitOverride
    : estimatedAvailableRoom;
  // Floor at 0 for contribution/excess math; negative estimates may still be shown as warnings.
  const usableRoomForContribution = Math.max(0, availableRoomForDeduction);

  return {
    year,
    newRoom,
    estimatedAvailableRoom,
    availableRoomForDeduction,
    usableRoomForContribution,
    dollarCap
  };
}

/** Default cap for simulations when tax data is not loaded (current indexed maximum). */
export const RRSP_ANNUAL_NEW_ROOM_DOLLAR_CAP = RRSP_LIMITS[2026];
