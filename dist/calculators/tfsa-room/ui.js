// ui.js
// UI only: reads inputs, calls engine, writes outputs. No math logic.

(function () {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
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

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function fmtCAD(n) {
    if (!Number.isFinite(n)) return "$–";
    return Math.round(n).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
  }

  // -----------------------------
  // State
  // -----------------------------
  let limitsData = null;

  // -----------------------------
  // Load TFSA limits data
  // -----------------------------
  async function loadLimitsData() {
    try {
      const response = await fetch("/assets/data/tfsa_limits.json");
      if (!response.ok) {
        throw new Error("Failed to load TFSA limits data");
      }
      limitsData = await response.json();
      return limitsData;
    } catch (error) {
      console.error("Error loading TFSA limits:", error);
      return null;
    }
  }

  // -----------------------------
  // Calculate eligibility start year from birth year
  // -----------------------------
  function calculateEligibilityStartYear(birthYear) {
    const yearTurned18 = birthYear + 18;
    return Math.max(2009, yearTurned18);
  }

  // -----------------------------
  // Populate eligibility year dropdown
  // -----------------------------
  function populateEligibilityYearDropdown(preferredYear = null) {
    const select = $("eligibility_start_year");
    const currentYear = new Date().getFullYear();
    const birthYear = num($("birth_year").value);
    
    // Clear existing options
    select.innerHTML = "";

    // Add options from 2009 to current year
    for (let year = 2009; year <= currentYear; year++) {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      select.appendChild(option);
    }

    // Set value: use preferredYear if provided, otherwise calculate from birth year, otherwise default to 2009
    let yearToSet = 2009;
    if (preferredYear !== null && Number.isFinite(preferredYear)) {
      yearToSet = clamp(preferredYear, 2009, currentYear);
    } else if (Number.isFinite(birthYear)) {
      yearToSet = clamp(calculateEligibilityStartYear(birthYear), 2009, currentYear);
    }
    
    select.value = yearToSet;
  }

  // -----------------------------
  // Populate as-of year dropdown
  // -----------------------------
  function populateAsOfYearDropdown() {
    const select = $("as_of_year");
    const currentYear = new Date().getFullYear();
    
    // Clear existing options
    select.innerHTML = "";

    // Add options from 2009 to current year + 1 (for projections)
    for (let year = 2009; year <= currentYear + 1; year++) {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      if (year === currentYear) {
        option.selected = true;
      }
      select.appendChild(option);
    }
  }

  // -----------------------------
  // Format number input with commas
  // -----------------------------
  function formatNumberInput(input) {
    const value = input.value.replace(/,/g, "");
    if (value === "" || value === "-") {
      return;
    }
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      input.value = num.toLocaleString("en-CA");
    }
  }

  // -----------------------------
  // Read inputs -> payload for engine
  // -----------------------------
  function readInputs() {
    const birthYear = num($("birth_year").value);
    const eligibilityStartYear = num($("eligibility_start_year").value);
    const asOfYear = num($("as_of_year").value);
    const lifetimeContributionsTotal = num($("lifetime_contributions_total").value.replace(/,/g, "")) || 0;
    const withdrawalsPriorYearsTotal = num($("withdrawals_prior_years_total").value.replace(/,/g, "")) || 0;
    const contributionsThisYear = num($("contributions_this_year").value.replace(/,/g, "")) || 0;
    const withdrawalsThisYear = num($("withdrawals_this_year").value.replace(/,/g, "")) || 0;

    return {
      limitsData,
      birthYear,
      eligibilityStartYear: clamp(eligibilityStartYear, 2009, new Date().getFullYear()),
      asOfYear: clamp(asOfYear, 2009, new Date().getFullYear() + 1),
      lifetimeContributionsTotal: clamp(lifetimeContributionsTotal, 0, 10000000),
      withdrawalsPriorYearsTotal: clamp(withdrawalsPriorYearsTotal, 0, 10000000),
      contributionsThisYear: clamp(contributionsThisYear, 0, 10000000),
      withdrawalsThisYear: clamp(withdrawalsThisYear, 0, 10000000)
    };
  }

  // -----------------------------
  // Render outputs
  // -----------------------------
  function render() {
    if (!limitsData) {
      $("out_available_room").textContent = "Loading...";
      return;
    }

    const inp = readInputs();

    // Calculate via engine
    if (typeof window.calculateTFSARoom !== "function") {
      $("out_available_room").textContent = "Error: calculateTFSARoom(...) not found.";
      return;
    }

    const result = window.calculateTFSARoom(inp);

    if (result.error) {
      $("out_available_room").textContent = "Error: " + result.error;
      $("out_projected_next_year").textContent = "–";
      $("out_overcontribution").textContent = "";
      $("out_breakdown").innerHTML = "";
      return;
    }

    // Primary outputs
    $("out_available_room").textContent = fmtCAD(result.availableRoomThisYear);
    $("out_projected_next_year").textContent = fmtCAD(result.projectedRoomNextYear);

    // Overcontribution warning
    const overcontributionEl = $("out_overcontribution");
    if (result.overcontribution > 0) {
      overcontributionEl.innerHTML = `
        <div style="padding: 12px; background: rgba(255,100,100,0.1); border: 1px solid rgba(255,100,100,0.3); border-radius: 8px; margin-top: 12px;">
          <strong style="color: var(--accent2);">Estimated overcontribution: ${fmtCAD(result.overcontribution)}</strong>
          <p style="margin: 8px 0 0; font-size: 13px; color: var(--muted);">
            CRA may assess tax on overcontributions; verify against your CRA record.
          </p>
        </div>
      `;
    } else {
      overcontributionEl.innerHTML = "";
    }

    // Breakdown
    const breakdownEl = $("out_breakdown");
    breakdownEl.innerHTML = `
      <div style="margin-top: 16px; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: 13px;">
        <div style="margin-bottom: 8px;"><strong>Calculation method:</strong> Year-by-year estimate</div>
        <div style="margin-bottom: 4px;">Eligible years: ${result.eligibleYearsRange.start}–${result.eligibleYearsRange.end} (${result.eligibleYearsCount} years)</div>
        <div style="margin-bottom: 4px;">Total entitlement from limits: ${fmtCAD(result.totalEntitlement)}</div>
        <div style="margin-bottom: 4px;">Less lifetime contributions: ${fmtCAD(inp.lifetimeContributionsTotal)}</div>
        <div style="margin-bottom: 4px;">Plus withdrawals in prior years: ${fmtCAD(inp.withdrawalsPriorYearsTotal)}</div>
        <div style="margin-bottom: 4px;">Less contributions this year: ${fmtCAD(inp.contributionsThisYear)}</div>
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
          <div style="margin-bottom: 4px;"><strong>This year withdrawals:</strong> ${fmtCAD(inp.withdrawalsThisYear)}</div>
          <div style="margin-bottom: 4px; font-size: 12px; color: var(--muted);">(Adds back to room next year, not this year)</div>
        </div>
      </div>
    `;
  }

  // -----------------------------
  // Reset function
  // -----------------------------
  function reset() {
    $("birth_year").value = "";
    populateEligibilityYearDropdown();
    populateAsOfYearDropdown();
    $("lifetime_contributions_total").value = "";
    $("withdrawals_prior_years_total").value = "";
    $("contributions_this_year").value = "";
    $("withdrawals_this_year").value = "";
    render();
  }

  // -----------------------------
  // Toggle CRA mode
  // -----------------------------
  function toggleCRAMode() {
    const useCRA = $("use_cra_mode").checked;
    const craFields = $("cra_fields");
    if (useCRA) {
      craFields.style.display = "block";
    } else {
      craFields.style.display = "none";
    }
    render();
  }

  // -----------------------------
  // Wire events
  // -----------------------------
  function wire() {
    // Load data first
    loadLimitsData().then(() => {
      populateEligibilityYearDropdown();
      populateAsOfYearDropdown();
      render();
    });

    // Birth year -> auto-update eligibility year
    $("birth_year").addEventListener("input", () => {
      const birthYear = num($("birth_year").value);
      if (Number.isFinite(birthYear) && birthYear >= 1900 && birthYear <= new Date().getFullYear()) {
        const calculatedYear = calculateEligibilityStartYear(birthYear);
        // Repopulate dropdown with the calculated year as preferred
        populateEligibilityYearDropdown(calculatedYear);
      } else {
        // If birth year is invalid or empty, just repopulate with default logic
        populateEligibilityYearDropdown();
      }
      render();
    });

    // All inputs trigger render
    const inputs = [
      "eligibility_start_year",
      "as_of_year",
      "lifetime_contributions_total",
      "withdrawals_prior_years_total",
      "contributions_this_year",
      "withdrawals_this_year"
    ];

    inputs.forEach(id => {
      const el = $(id);
      el.addEventListener("input", () => {
        if (id.includes("contributions") || id.includes("withdrawals")) {
          formatNumberInput(el);
        }
        render();
      });
    });

    // Reset button
    $("reset_button").addEventListener("click", reset);

    // Format number inputs on blur
    ["lifetime_contributions_total", "withdrawals_prior_years_total", 
     "contributions_this_year", "withdrawals_this_year"].forEach(id => {
      $(id).addEventListener("blur", function() {
        formatNumberInput(this);
      });
    });
  }

  // -----------------------------
  // Initialize on DOM ready
  // -----------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
