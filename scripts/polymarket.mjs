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
 * GET /markets/{slug}
 */
export async function fetchPolymarketMarket(slug) {
  const data = await getJson(`${CONFIG.POLYMARKET_BASE_URL}/markets/${encodeURIComponent(slug)}`);
  return data.market ?? data;
}

/**
 * Fetch the order book for a market by slug.
 * GET /markets/{slug}/book
 *
 * Unlike Kalshi, Polymarket US's book is a normal two-sided book for the
 * outcome token this market/slug represents: "bids" are resting buy orders,
 * "offers" are resting sell orders (asks). To BUY this outcome, walk the
 * "offers" ladder ascending by price. A community-reported gateway quirk
 * (see repo README) wraps bids/offers inside a `marketData` envelope on some
 * gateway versions - this function checks both shapes defensively.
 */
export async function fetchPolymarketOrderbook(slug) {
  const data = await getJson(`${CONFIG.POLYMARKET_BASE_URL}/markets/${encodeURIComponent(slug)}/book`);
  const book = data.marketData ?? data;

  const offers = (book.offers ?? []).map((lvl) => ({
    price: Number(lvl.price ?? lvl.px ?? lvl?.price?.value),
    qty: Number(lvl.size ?? lvl.qty ?? lvl?.size?.value),
  }));
  const bids = (book.bids ?? []).map((lvl) => ({
    price: Number(lvl.price ?? lvl.px ?? lvl?.price?.value),
    qty: Number(lvl.size ?? lvl.qty ?? lvl?.size?.value),
  }));

  // Sort asks cheapest-first, bids richest-first, just in case the gateway
  // doesn't guarantee order.
  offers.sort((a, b) => a.price - b.price);
  bids.sort((a, b) => b.price - a.price);

  return { offers, bids };
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
