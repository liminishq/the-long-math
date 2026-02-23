# Restructure Plan (restructure-urls branch)

## Target top-level namespaces
/articles/
/essays/   (brand: Beyond The Numbers)
/calculators/
/tools/
/data/
/assets/

## Root items that should remain at root
/index.html
/sitemap.xml
/robots.txt (if/when added)
/_redirects (if/when added)
/functions/  (Cloudflare)
/migrations/ (dev)

/assets/ and /data/ are already present.

## Root-level candidates to relocate or convert to redirects
- calculator/ -> ?
- calculator.html -> ?
- fees/ -> ?
- mortgage-calculator/ -> ?
- ccpc-tax-calculator-2025/ -> ?
- longmath-tax-canada-2025/ -> ?
- styles.css -> ?
- theme.js -> ?

## Notes
- All moved pages must have: canonical updated, internal links updated, 301 in _redirects.
- Do atomic deploys only.