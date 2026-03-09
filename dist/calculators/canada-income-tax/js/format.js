/**
 * Formatting utilities for currency and percentages
 */

/**
 * Format a number as currency (CAD)
 * @param {number} value - The value to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value) {
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
    return '$–';
  }
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch (e) {
    return '$–';
  }
}

/**
 * Format a number as a percentage
 * @param {number} value - The value to format (e.g., 0.15 for 15%)
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted percentage string
 */
export function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
    return '–%';
  }
  try {
    return (value * 100).toFixed(decimals) + '%';
  } catch (e) {
    return '–%';
  }
}

/**
 * Parse a string input to a number, handling commas and empty strings
 * @param {string} input - The input string
 * @returns {number} Parsed number (0 if empty/invalid)
 */
export function parseInput(input) {
  if (!input || input.trim() === '') {
    return 0;
  }
  const cleaned = input.replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
}
