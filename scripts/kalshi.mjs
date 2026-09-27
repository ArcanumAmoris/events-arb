import { CONFIG } from "./config.mjs";

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": CONFIG.USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Kalshi request failed (${res.status}) for ${url}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/**
 * Fetch a single market's summary (title, expiration, last price, volume, etc).
 * GET /markets/{ticker}
 */
export async function fetchKalshiMarket(ticker) {
  const data = await getJson(`${CONFIG.KALSHI_BASE_URL}/markets/${encodeURIComponent(ticker)}`);
  return data.market ?? data;
}

/**
 * Fetch the order book for a market.
 * GET /markets/{ticker}/orderbook
 *
 * Kalshi's binary markets are reciprocal: the book only carries resting BIDS
 * for each side ("yes" bids and "no" bids), each level as [price_cents, qty].
 * There is no separate "ask" list. A yes bid at price p is a standing offer
 * to buy yes at p cents; equivalently that is an implicit ask to SELL no at
 * (100 - p). So:
 *   - the ask ladder to BUY "no" contracts = invert the "yes" bids: price = 100 - p
 *   - the ask ladder to BUY "yes" contracts = invert the "no" bids: price = 100 - p
 * This function returns both raw bid ladders and the derived ask ladders for
 * convenience.
 */
export async function fetchKalshiOrderbook(ticker) {
  const data = await getJson(`${CONFIG.KALSHI_BASE_URL}/markets/${encodeURIComponent(ticker)}/orderbook`);
  const book = data.orderbook ?? data;

  // Raw resting bids, each [price_cents, qty]. Kalshi may omit a side entirely
  // if there are no resting orders on it.
  const yesBids = (book.yes ?? []).map(([price, qty]) => ({ price, qty }));
  const noBids = (book.no ?? []).map(([price, qty]) => ({ price, qty }));

  // Derived ask ladders (what you'd actually pay to buy each side), sorted
  // cheapest-first.
  const yesAsks = noBids
    .map(({ price, qty }) => ({ price: 100 - price, qty }))
    .sort((a, b) => a.price - b.price);
  const noAsks = yesBids
    .map(({ price, qty }) => ({ price: 100 - price, qty }))
    .sort((a, b) => a.price - b.price);

  return { yesBids, noBids, yesAsks, noAsks };
}

/**
 * Walk an ask ladder (as produced by fetchKalshiOrderbook) to fill `size`
 * contracts. Returns { filled, costCents } where filled may be less than
 * size if the book doesn't have enough depth.
 */
export function walkKalshiBook(askLadder, size) {
  let remaining = size;
  let costCents = 0;
  for (const level of askLadder) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, level.qty);
    costCents += take * level.price;
    remaining -= take;
  }
  return { filled: size - remaining, costCents };
}
