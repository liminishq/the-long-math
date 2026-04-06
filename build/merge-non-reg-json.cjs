"use strict";
const fs = require("fs");
const path = require("path");

const body = fs.readFileSync(path.join(__dirname, "tmp-non-reg-article-body.html"), "utf8");
const faq = [
  {
    q: "Is a non-registered account the same as a taxable account?",
    a: '<p>Yes. "Non-registered account," "taxable account," and "open account" are used interchangeably in Canadian personal finance. They all refer to a standard brokerage account without registered tax protection.</p>',
  },
  {
    q: "Do I pay tax when I withdraw cash from a non-registered account?",
    a: "<p>The withdrawal itself isn't the tax event. Tax is triggered when income is earned — when interest accrues, when a dividend is paid, or when you sell an investment for a gain. Withdrawing cash after those events is simply moving money. There's no additional layer of tax on the act of withdrawal itself.</p>",
  },
  {
    q: "Is there a contribution limit?",
    a: "<p>No. You can deposit as much as you want, whenever you want. There's no annual limit, lifetime cap, or contribution room to track. This is the defining structural difference from registered accounts — and the reason the non-registered account becomes important once registered room is exhausted.</p>",
  },
  {
    q: "Should I hold bonds or GICs in my non-registered account?",
    a: "<p>Generally no — not while registered room is still available. Interest income is taxed at your full marginal rate, making it the least efficient income type to hold outside a shelter. Fixed income belongs in a TFSA or RRSP. The non-registered account is better suited to equity-oriented assets that generate most of their return through capital appreciation.</p>",
  },
  {
    q: "Are foreign dividends treated the same as Canadian dividends?",
    a: "<p>No. Canadian eligible dividends benefit from the dividend tax credit. Foreign dividends do not qualify for the Canadian dividend tax credit. They are generally taxed like ordinary investment income in Canada, and foreign withholding tax may apply at source. A foreign tax credit may be available depending on the facts.</p>",
  },
  {
    q: "Can I use investment losses to reduce my taxes?",
    a: "<p>Capital losses can offset capital gains in the current year, be carried back three years, or carried forward indefinitely. They cannot offset other income types — employment income, interest, or dividends. The superficial loss rule applies: sell a security at a loss and repurchase the same or an identical security within 30 days on either side of the sale, and the loss is denied.</p>",
  },
  {
    q: "What is adjusted cost base and why does it matter?",
    a: "<p>Adjusted cost base (ACB) is what you paid for an investment, adjusted over time for reinvested distributions, return-of-capital payments, additional purchases, and partial sales. It's subtracted from your sale proceeds to calculate your capital gain or loss. Sloppy ACB records mean a wrong gain calculation — and unlike a TFSA or RRSP, a non-registered account requires you to maintain these records yourself, for every position, from the first purchase.</p>",
  },
  {
    q: "What happens to my non-registered account when I die?",
    a: "<p>The Income Tax Act deems a disposition of all capital property at fair market value immediately before death, which can trigger significant capital gains on a large, appreciated portfolio. A rollover to a surviving spouse or common-law partner is available in some circumstances, which can defer that tax event. The larger the non-registered account, the more this warrants deliberate estate planning.</p>",
  },
  {
    q: "What's the difference between a non-registered account and a margin account?",
    a: "<p>A margin account is a type of non-registered account that allows borrowing against holdings to purchase additional securities. The underlying tax rules are identical. The additional consideration: interest paid on money borrowed to earn investment income may be deductible, subject to the tax rules and the actual use of the borrowed funds.</p>",
  },
];

const p = path.join(__dirname, "..", "assets", "i18n", "en", "articles", "what-is-a-non-registered-account.json");
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.wrapMainHtml = body.replace(/\r\n/g, "\n").trim();
j.faq = faq.map(({ q, a }) => ({ question: q, answerHtml: a }));
fs.writeFileSync(p, JSON.stringify(j, null, 2), "utf8");
console.log("Wrote", p, "body chars", j.wrapMainHtml.length, "faq", j.faq.length);
