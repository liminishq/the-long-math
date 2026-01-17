const { calculateLongMath } = require("./calculator.js");

function fmt(n) {
  return Math.round(n).toLocaleString("en-CA");
}

  const inputs = {
    starting_balance: 250000,
    monthly_contribution: 5000,
    horizon_years: 15,
    annual_return: 0.07,
  };  

const r = calculateLongMath(inputs);
console.log("years_with length:", r.yearly_balances_with?.length);
console.log("years_without length:", r.yearly_balances_without?.length);

if (r.yearly_balances_with?.length) {
  console.log("year0_with:", r.yearly_balances_with[0]);
  console.log("last_with:", r.yearly_balances_with[r.yearly_balances_with.length - 1]);
}
if (r.yearly_balances_without?.length) {
  console.log("year0_without:", r.yearly_balances_without[0]);
  console.log("last_without:", r.yearly_balances_without[r.yearly_balances_without.length - 1]);
}

console.log("ending_with_advisor:", fmt(r.ending_with_advisor));
console.log("ending_without_advisor:", fmt(r.ending_without_advisor));
console.log("total_fees_paid:", fmt(r.total_fees_paid));
console.log("lost_compounding:", fmt(r.lost_compounding));
console.log("years_with:", r.yearly_balances_with?.length);
console.log("years_without:", r.yearly_balances_without?.length);
