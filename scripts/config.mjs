// Hand-maintained settings. Update TBILL_ANNUAL_YIELD periodically (there's no
// live API call for it, per your setup preference — check
// https://www.cnbc.com/quotes/US3M or https://ycharts.com/indicators/3_month_t_bill
// or https://home.treasury.gov/resource-center/data-chart-center/interest-rates
// every so often and edit the number below).

export const CONFIG = {
  // Current 3-month T-bill annualized yield, as a decimal (e.g. 0.052 = 5.2%).
  // Last updated: 2026-09-27. UPDATE THIS PERIODICALLY.
  TBILL_ANNUAL_YIELD: 0.045,

  // How much annualized return an opportunity must clear over the T-bill
  // yield to count toward the "WORTH IT" bar.
  TBILL_MARGIN: 0.03, // 3 percentage points

  // Verdict thresholds
  MIN_PROFIT_WORTH_IT: 5, // dollars, at the sized position
  MIN_RETURN_WORTH_IT: 0.02, // 2%, profit / cost at the sized position

  // Size (in contracts) to evaluate depth/cost at. The scanner walks the book
  // up to this many contracts on each leg; if depth runs out earlier it uses
  // whatever size was actually fillable on both legs.
  TARGET_SIZE_CONTRACTS: 100,

  // Kalshi public REST base. "elections" in the hostname is historical -
  // this endpoint serves all Kalshi markets, not just election ones.
  KALSHI_BASE_URL: "https://api.elections.kalshi.com/trade-api/v2",

  // Polymarket US public read-only gateway.
  POLYMARKET_BASE_URL: "https://gateway.polymarket.us/v1",

  USER_AGENT: "events-arb-scanner/1.0 (personal research tool)",
};
