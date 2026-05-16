/**
 * Canada personal income tax — known-answer vectors (2025 data).
 * Implements scenarios defined in calculators/canada-income-tax/tests/known-answer-vectors.test.js
 */

import { test } from "node:test";
import {
  test_ON_2025_eligible_dividends_only_160k,
  test_ON_2025_employment_only_160k,
  test_ON_2025_employment_160k_CRA_expected,
  test_AB_2025_eligible_dividends_only,
  test_ON_OHP_ramp_at_taxable_income_200300,
} from "../calculators/canada-income-tax/tests/known-answer-vectors.test.js";

test("ON 2025: $160k eligible dividends only (known vector)", () => {
  test_ON_2025_eligible_dividends_only_160k();
});

test("ON 2025: $160k employment only (known vector)", () => {
  test_ON_2025_employment_only_160k();
});

test("ON 2025: $160k employment — CRA expected JSON scenario", () => {
  test_ON_2025_employment_160k_CRA_expected();
});

test("AB 2025: $100k eligible dividends only (known vector)", () => {
  test_AB_2025_eligible_dividends_only();
});

test("ON: Ontario Health Premium at taxable income $200,300 (200k–200.6k ramp)", () => {
  test_ON_OHP_ramp_at_taxable_income_200300();
});
