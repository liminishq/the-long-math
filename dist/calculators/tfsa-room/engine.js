/* ============================================================
   The Long Math — TFSA Contribution Room Calculator Engine
   ============================================================

   PURPOSE
   -------
   Calculate estimated TFSA contribution room using year-by-year
   arithmetic based on annual limits, contributions, and withdrawals.

   KEY RULES MODELED:
   - Start year = max(2009, year user turned 18 AND was eligible)
   - Total entitlement = sum of annual limits from start year to target year
   - Withdrawals add back to room, but only starting Jan 1 of the NEXT year
   - Contributions reduce available room
   - Overcontribution = negative available room

   IMPORTANT:
   - Withdrawals this year do NOT add to room this year
   - Withdrawals this year WILL add to room next year
   - Prior-year withdrawals are already reflected in start-of-year room
*/

/* ============================================================
   Helper: Get limit for a specific year
   ============================================================ */
function getLimitForYear(limitsData, year) {
  if (!limitsData || !limitsData.limits) return 0;
  const entry = limitsData.limits.find(l => l.year === year);
  return entry ? entry.limit : 0;
}

/* ============================================================
   Helper: Calculate eligible years array
   ============================================================ */
function getEligibleYears(eligibilityStartYear, asOfYear) {
  const years = [];
  for (let y = eligibilityStartYear; y <= asOfYear; y++) {
    years.push(y);
  }
  return years;
}

/* ============================================================
   Calculate total entitlement from limits
   ============================================================ */
function calculateTotalEntitlement(limitsData, eligibilityStartYear, asOfYear) {
  const eligibleYears = getEligibleYears(eligibilityStartYear, asOfYear);
  let total = 0;
  for (const year of eligibleYears) {
    total += getLimitForYear(limitsData, year);
  }
  return total;
}

/* ============================================================
   Calculate estimated available room (estimate mode)
   ============================================================ */
function calculateEstimatedRoom({
  limitsData,
  eligibilityStartYear,
  asOfYear,
  lifetimeContributionsTotal,
  withdrawalsPriorYearsTotal,
  contributionsThisYear,
  withdrawalsThisYear
}) {
  // Total entitlement from limits
  const totalEntitlement = calculateTotalEntitlement(
    limitsData,
    eligibilityStartYear,
    asOfYear
  );

  // Available room this year
  // = entitlement - lifetime contributions + prior withdrawals - this year contributions
  // Note: prior withdrawals already added back in their following years historically
  // Note: this year withdrawals do NOT add to this year's room
  const availableRoomThisYear = 
    totalEntitlement - 
    lifetimeContributionsTotal + 
    withdrawalsPriorYearsTotal - 
    contributionsThisYear;

  // Projected room next year (if no more contributions)
  // = this year's room + this year's limit (if asOfYear < current year limit exists) + this year's withdrawals
  const nextYear = asOfYear + 1;
  const nextYearLimit = getLimitForYear(limitsData, nextYear);
  const projectedRoomNextYear = availableRoomThisYear + nextYearLimit + withdrawalsThisYear;

  // Overcontribution amount (negative room)
  const overcontribution = availableRoomThisYear < 0 ? Math.abs(availableRoomThisYear) : 0;

  return {
    eligibleYears: getEligibleYears(eligibilityStartYear, asOfYear),
    totalEntitlement,
    availableRoomThisYear,
    projectedRoomNextYear,
    overcontribution,
    eligibleYearsCount: getEligibleYears(eligibilityStartYear, asOfYear).length,
    eligibleYearsRange: {
      start: eligibilityStartYear,
      end: asOfYear
    }
  };
}


/* ============================================================
   Main calculation function
   ============================================================ */
function calculateTFSARoom(inputs) {
  const {
    limitsData,
    eligibilityStartYear,
    asOfYear,
    lifetimeContributionsTotal,
    withdrawalsPriorYearsTotal,
    contributionsThisYear,
    withdrawalsThisYear
  } = inputs;

  // Validation
  if (!limitsData || !limitsData.limits) {
    return { error: "TFSA limits data not loaded" };
  }

  if (!Number.isFinite(eligibilityStartYear) || eligibilityStartYear < 2009) {
    return { error: "Invalid eligibility start year (must be >= 2009)" };
  }

  if (!Number.isFinite(asOfYear) || asOfYear < 2009) {
    return { error: "Invalid as-of year (must be >= 2009)" };
  }

  if (eligibilityStartYear > asOfYear) {
    return { error: "Eligibility start year cannot be after as-of year" };
  }

  if (!Number.isFinite(lifetimeContributionsTotal) || lifetimeContributionsTotal < 0) {
    return { error: "Invalid lifetime contributions (must be >= 0)" };
  }

  if (!Number.isFinite(withdrawalsPriorYearsTotal) || withdrawalsPriorYearsTotal < 0) {
    return { error: "Invalid prior-year withdrawals (must be >= 0)" };
  }

  if (!Number.isFinite(contributionsThisYear) || contributionsThisYear < 0) {
    return { error: "Invalid this-year contributions (must be >= 0)" };
  }

  if (!Number.isFinite(withdrawalsThisYear) || withdrawalsThisYear < 0) {
    return { error: "Invalid this-year withdrawals (must be >= 0)" };
  }

  // Calculate estimated room
  const estimated = calculateEstimatedRoom({
    limitsData,
    eligibilityStartYear,
    asOfYear,
    lifetimeContributionsTotal,
    withdrawalsPriorYearsTotal,
    contributionsThisYear,
    withdrawalsThisYear
  });

  return estimated;
}

// Export to window for UI
window.calculateTFSARoom = calculateTFSARoom;
window.getLimitForYear = getLimitForYear;
