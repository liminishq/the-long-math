/*
THE LONG MATH — v1 CALCULATOR SPEC
================================

PURPOSE
-------
Quantify the long-horizon cost of an ongoing %AUM advisor fee on an investment
portfolio with regular contributions and compound growth.

This tool models STRUCTURAL FEE DRAG only.
It does NOT model advisor skill, market timing, or intent.
Advisors are not bad people; the arithmetic of %AUM fees is destructive over time.


INPUTS
------

1) starting_balance (CAD)
   - Range: 0 to 10,000,000
   - Default: 0
   - Represents existing invested assets at time zero

2) monthly_contribution (CAD)
   - Range: 100 to 50,000
   - Default: 5,000
   - Fixed contribution added at the START of each month

3) horizon_years
   - Range: 1 to 50
   - Default: 25
   - Internally converted to months = horizon_years * 12

4) annual_return (decimal)
   - Default range: 0.00 to 0.10
   - Default value: 0.07
   - Advanced toggle may allow up to 0.15 with warning:
     "Returns above 10% are exceptional and unlikely to persist long-term.
      Sustained results typically reflect unusual luck, unusual skill, or both."

5) advisor_fee_schedule (FIXED in v1)
   - Tiered %AUM fee
   - Single rate applied to entire balance based on current AUM bracket
   - NOT a blended/marginal fee

   Default tiers (CAD):

   0 – 250,000            : 1.75%
   250,000 – 500,000      : 1.50%
   500,000 – 1,000,000    : 1.25%
   1,000,000 – 2,000,000  : 1.00%
   2,000,000 – 6,000,000  : 1.00%
   6,000,000+             : 0.75%


PRESETS (OPTIONAL UI CONVENIENCE)
--------------------------------
- Starting out:
    starting_balance = 0
    horizon_years = 25
    annual_return = 0.07

- Mid-career:
    starting_balance = 250,000
    horizon_years = 15
    annual_return = 0.07

- Near retirement:
    starting_balance = 2,000,000
    horizon_years = 10 (option to view 5 years)
    annual_return = 0.07


CALCULATION CONVENTIONS
-----------------------

- Monthly compounding
- Monthly contributions at START of month
- Monthly fee deducted every month

growth_factor = (1 + annual_return)^(1/12)

Initialize:
  balance_with_advisor = starting_balance
  balance_without_advisor = starting_balance
  total_fees_paid = 0

For each month t = 1 to (horizon_years * 12):

  base_with = balance_with_advisor + monthly_contribution
  base_without = balance_without_advisor + monthly_contribution

  advisor_rate = lookup_fee_rate(base_with)

  monthly_fee = base_with * (advisor_rate / 12)

  balance_with_advisor =
      (base_with * growth_factor) - monthly_fee

  balance_without_advisor =
      base_without * growth_factor

  total_fees_paid += monthly_fee


OUTPUTS
-------

Primary:
- ending_with_advisor
- ending_without_advisor
- total_fees_paid
- gap_total = ending_without_advisor - ending_with_advisor

Decomposition:
- lost_compounding = gap_total - total_fees_paid

Chart data (for later use):
- balances_with_advisor over time
- balances_without_advisor over time
- cumulative_fees over time (optional)


EDGE CASES / RULES
------------------
- If annual_return = 0, growth_factor = 1
- No negative balances should occur
- All calculations use full precision; display rounds to nearest dollar
- This is deterministic arithmetic — no Monte Carlo, no randomness


COPY / ETHICAL GUARDRAILS
------------------------
"This calculator does not assume advisors are dishonest or unskilled.
It merely isolates the long-term arithmetic consequences of percentage-based
assets-under-management fees."

END SPEC
*/

const DEFAULT_FEE_SCHEDULE = [
    { min: 0, max: 250000, rate: 0.0175 },
    { min: 250000, max: 500000, rate: 0.0150 },
    { min: 500000, max: 1000000, rate: 0.0125 },
    { min: 1000000, max: 2000000, rate: 0.0100 },
    { min: 2000000, max: 6000000, rate: 0.0100 },
    { min: 6000000, max: Infinity, rate: 0.0075 }
  ];
  
  function lookupAdvisorFeeRate(balance, feeSchedule = DEFAULT_FEE_SCHEDULE) {
    if (!Number.isFinite(balance) || balance < 0) balance = 0;
  
    for (const tier of feeSchedule) {
      if (balance >= tier.min && balance < tier.max) {
        return tier.rate;
      }
    }
  
    return feeSchedule[feeSchedule.length - 1].rate;
  }
  
  // -----------------------------
  // Core calculation engine
  // -----------------------------
  function calculateLongMath(inputs = {}) {
    const {
      starting_balance = 0,
      monthly_contribution = 5000,
      horizon_years = 25,
      annual_return = 0.07,
      fee_schedule = DEFAULT_FEE_SCHEDULE
    } = inputs;
  
    const months = horizon_years * 12;
    const growth_factor =
      annual_return === 0
        ? 1
        : Math.pow(1 + annual_return, 1 / 12);
  
    let balance_with = starting_balance;
    let balance_without = starting_balance;
    let total_fees_paid = 0;
  
    const yearly_balances_with = [starting_balance];
    const yearly_balances_without = [starting_balance];
  
    for (let m = 1; m <= months; m++) {
      const base_with = balance_with + monthly_contribution;
      const base_without = balance_without + monthly_contribution;
  
      const rate = lookupAdvisorFeeRate(base_with, fee_schedule);
      const monthly_fee = base_with * (rate / 12);
  
      balance_with = (base_with * growth_factor) - monthly_fee;
      balance_without = base_without * growth_factor;
  
      total_fees_paid += monthly_fee;
  
      if (m % 12 === 0) {
        yearly_balances_with.push(balance_with);
        yearly_balances_without.push(balance_without);
      }
    }
  
    const ending_with_advisor = balance_with;
    const ending_without_advisor = balance_without;
    const gap_total = ending_without_advisor - ending_with_advisor;
    const lost_compounding = gap_total - total_fees_paid;
  
    return {
      ending_with_advisor,
      ending_without_advisor,
      total_fees_paid,
      lost_compounding,
      yearly_balances_with,
      yearly_balances_without
    };
  }
  
  // Node export (for testing)
  module.exports = { calculateLongMath };
  