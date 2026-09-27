import { CONFIG } from "./config.mjs";

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": CONFIG.USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Polymarket US request failed (${res.status}) for ${url}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/**
 * Fetch a single market's summary by slug.
 * GET /market/slug/{slug}  (confirmed live 2026-09-27 - note singular
 * "market", not "markets"; the plural path 404s)
 */
export async function fetchPolymarketMarket(slug) {
  const data = await getJson(`${CONFIG.POLYMARKET_BASE_URL}/market/slug/${encodeURIComponent(slug)}`);
  return data.market ?? data;
}

/**
 * Fetch the order book for a market by slug.
 * GET /markets/{slug}/book
 *
 * Confirmed against live responses (2026-09-27): each level is shaped like
 * { "px": { "value": "0.16", "currency": "USD" }, "qty": "17535.59" } - this
 * function unwraps that. A community-reported gateway quirk (see repo
 * README) wraps bids/offers inside a `marketData` envelope on some gateway
 * versions; this function checks both shapes defensively.
 *
 * IMPORTANT CAVEAT, confirmed live: every market we inspected only exposes
 * ONE real two-sided book, for the "Yes"/"long" outcome ("bids" = resting
 * buy orders, "offers" = resting sell orders/asks for Yes). There is no
 * separate order book for "No"/"short" reachable through this public
 * gateway - the /bbo endpoint's `shortQuote` field is a DERIVED display
 * quote (== 1 - best Yes bid), not evidence of a tradable No order sitting
 * there. So:
 *   - buying YES: walk `offers` directly (real resting asks).
 *   - buying NO: this script derives an ask ladder by inverting the YES
 *     BIDS (price = 1 - bid_price), the same reciprocal trick used for
 *     Kalshi. This is a best-effort estimate of what a No position would
 *     cost, NOT a confirmed executable price - there is no proof from the
 *     public API that Polymarket US lets you place a resting buy order for
 *     "No" the way you can on Kalshi, versus needing to short/sell Yes
 *     (different mechanics, possibly margin-gated). VERIFY INSIDE YOUR
 *     ACTUAL POLYMARKET US ACCOUNT before trusting a "buy_side: no" number
 *     from this script.
 */
export async function fetchPolymarketOrderbook(slug) {
  const data = await getJson(`${CONFIG.POLYMARKET_BASE_URL}/markets/${encodeURIComponent(slug)}/book`);
  const book = data.marketData ?? data;

  function parseLevel(lvl) {
    const price = Number(lvl.px?.value ?? lvl.price?.value ?? lvl.price ?? lvl.px);
    const qty = Number(lvl.qty ?? lvl.size?.value ?? lvl.size);
    return { price, qty };
  }

  const offers = (book.offers ?? []).map(parseLevel).filter((l) => Number.isFinite(l.price));
  const bids = (book.bids ?? []).map(parseLevel).filter((l) => Number.isFinite(l.price));

  // Sort asks cheapest-first, bids richest-first, just in case the gateway
  // doesn't guarantee order.
  offers.sort((a, b) => a.price - b.price);
  bids.sort((a, b) => b.price - a.price);

  // Derived (unconfirmed-executable) ask ladder for buying "No" - see caveat
  // above. Cheapest first.
  const noAsksDerived = bids
    .map(({ price, qty }) => ({ price: Number((1 - price).toFixed(4)), qty }))
    .sort((a, b) => a.price - b.price);

  return { offers, bids, noAsksDerived };
}

/**
 * Walk the "offers" (ask) ladder to fill `size` contracts (in shares, where
 * each share pays $1 if the outcome resolves true). Prices here are dollars
 * (e.g. 0.55), not cents. Returns { filled, costCents } for a uniform
 * comparison with the Kalshi side (cents-denominated).
 */
export function walkPolymarketBook(askLadder, size) {
  let remaining = size;
  let costCents = 0;
  for (const level of askLadder) {
    if (remaining <= 0) break;
    if (!Number.isFinite(level.price) || !Number.isFinite(level.qty)) continue;
    const take = Math.min(remaining, level.qty);
    costCents += take * level.price * 100;
    remaining -= take;
  }
  return { filled: size - remaining, costCents: Math.round(costCents) };
}
