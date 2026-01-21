(function(){

  function num(id){ return Number(document.getElementById(id).value) || 0; }
  function pct(id){ return num(id) / 100; }

  function update(){
    const result = calculateLongMath({
      starting_balance: num("starting_balance"),
      monthly_contribution: num("monthly_contribution"),
      years: num("horizon_years"),
      annual_return: pct("annual_return"),
      advisor_fee_pct: pct("custom_advisor_fee"),
      mer_pct: document.getElementById("include_mer").checked ? pct("mer_pct") : 0
    });

    document.getElementById("out_with").textContent = format(result.ending_with);
    document.getElementById("out_without").textContent = format(result.ending_without);
    document.getElementById("out_fees").textContent = format(result.fees_paid);
    document.getElementById("out_lost").textContent = format(result.lost_compounding);
    document.getElementById("out_total_cost").textContent = format(result.total_cost);
    document.getElementById("out_breakeven").textContent =
      (result.breakeven * 100).toFixed(2) + "%";
  }

  function format(n){
    return n.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0
    });
  }

  document.querySelectorAll("input").forEach(i =>
    i.addEventListener("input", update)
  );

  update();
})();
