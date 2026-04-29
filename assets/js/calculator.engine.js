/* ============================================================
   The Long Math — Calculator Engine (Deterministic Core)
   ============================================================

   Delegates portfolio arithmetic to the shared standardized-period
   engine: /assets/js/engines/portfolioSimulationEngine.js

   Must load after portfolioSimulationEngine.js (sets window.TLM_PortfolioSimulation).
*/

const DEFAULT_ADVISOR_FEE_SCHEDULE = [
  { min: 0, max: 250000, rate: 0.0200 },
  { min: 250000, max: 500000, rate: 0.0175 },
  { min: 500000, max: 1000000, rate: 0.0150 },
  { min: 1000000, max: 2000000, rate: 0.0125 },
  { min: 2000000, max: Infinity, rate: 0.0100 },
];

function buildAdvisorScenario({
  starting_balance,
  monthly_contribution,
  horizon_years,
  annual_return,
  use_default_fee,
  custom_advisor_fee_pct,
  include_mer,
  mer_pct,
}) {
  const PS = window.TLM_PortfolioSimulation;
  if (!PS) throw new Error("TLM_PortfolioSimulation not loaded");

  const mer = include_mer ? (Number(mer_pct) || 0) / 100 : 0;

  // One combined AUM fee per period (advisor + MER) matches the legacy
  // single-deduction model: balance × ((f_advisor + f_MER) / 12).
  let annualRateFn;
  if (use_default_fee) {
    annualRateFn = (bal) => PS.lookupTieredRate(bal, DEFAULT_ADVISOR_FEE_SCHEDULE) + mer;
  } else {
    const adv = (Number(custom_advisor_fee_pct) || 0) / 100;
    annualRateFn = () => adv + mer;
  }

  const fees = [
    {
      type: "aumDynamic",
      annualRateFn,
      frequency: "monthly",
      timing: "end",
    },
  ];

  return {
    initialBalance: starting_balance,
    years: horizon_years,
    annualGrossReturn: annual_return,
    contribution:
      monthly_contribution > 0
        ? { amount: monthly_contribution, frequency: "monthly", timing: "start" }
        : undefined,
    fees,
  };
}

function simulatePortfolioLegacy(inputs) {
  const PS = window.TLM_PortfolioSimulation;
  const r = PS.simulatePortfolioScenario(inputs);
  return {
    ending_value: r.endingBalance,
    total_fees_paid: r.totalFeesPaid,
  };
}

function solveBreakEvenReturn({
  target_ending_value,
  starting_balance,
  monthly_contribution,
  horizon_years,
  use_default_fee,
  custom_advisor_fee_pct,
  include_mer,
  mer_pct,
}) {
  const PS = window.TLM_PortfolioSimulation;

  const scenarioFn = (annual_return) =>
    buildAdvisorScenario({
      starting_balance,
      monthly_contribution,
      horizon_years,
      annual_return,
      use_default_fee,
      custom_advisor_fee_pct,
      include_mer,
      mer_pct,
    });

  const out = PS.solveAnnualReturnForEndingValue({
    scenarioFn,
    targetEnding: target_ending_value,
    lowAnnualReturn: 0.0,
    highAnnualReturn: 0.5,
  });

  return { return_required: out.annualReturn, capped: out.capped };
}

function calculateLongMath(inputs) {
  const {
    starting_balance,
    monthly_contribution,
    horizon_years,
    annual_return,
    use_default_fee,
    custom_advisor_fee_pct,
    include_mer,
    mer_pct,
  } = inputs;

  if (!Number.isFinite(starting_balance) || starting_balance < 0)
    throw new Error("Invalid starting balance");

  if (!Number.isFinite(monthly_contribution) || monthly_contribution < 0)
    throw new Error("Invalid monthly contribution");

  if (!Number.isFinite(horizon_years) || horizon_years < 1)
    throw new Error("Invalid horizon");

  if (!Number.isFinite(annual_return)) throw new Error("Invalid annual return");

  const noFeesScenario = {
    initialBalance: starting_balance,
    years: horizon_years,
    annualGrossReturn: annual_return,
    contribution:
      monthly_contribution > 0
        ? { amount: monthly_contribution, frequency: "monthly", timing: "start" }
        : undefined,
    fees: [],
  };

  const withFeesScenario = buildAdvisorScenario({
    starting_balance,
    monthly_contribution,
    horizon_years,
    annual_return,
    use_default_fee,
    custom_advisor_fee_pct,
    include_mer,
    mer_pct,
  });

  const no_advisor = simulatePortfolioLegacy(noFeesScenario);
  const with_advisor = simulatePortfolioLegacy(withFeesScenario);

  const total_gap = no_advisor.ending_value - with_advisor.ending_value;
  const lost_compounding = total_gap - with_advisor.total_fees_paid;

  const breakeven = solveBreakEvenReturn({
    target_ending_value: no_advisor.ending_value,
    starting_balance,
    monthly_contribution,
    horizon_years,
    use_default_fee,
    custom_advisor_fee_pct,
    include_mer,
    mer_pct,
  });

  return {
    ending_with_advisor: with_advisor.ending_value,
    ending_without_advisor: no_advisor.ending_value,

    fees_paid: with_advisor.total_fees_paid,
    lost_compounding: lost_compounding,
    total_calculated_cost: total_gap,

    break_even_return: breakeven.return_required,
    break_even_capped: breakeven.capped,
  };
}

window.calculateLongMath = calculateLongMath;
