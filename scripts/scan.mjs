import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.mjs";
import { fetchKalshiMarket, fetchKalshiOrderbook, walkKalshiBook } from "./kalshi.mjs";
import { fetchPolymarketMarket, fetchPolymarketOrderbook, walkPolymarketBook } from "./polymarket.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MAPPING_PATH = path.join(ROOT, "data", "mapping.json");
const LOG_PATH = path.join(ROOT, "data", "opportunity-log.json");

function daysUntil(isoDate) {
  const ms = new Date(isoDate).getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}

function annualizedReturn(profitCents, costCents, daysToExpiration) {
  if (costCents <= 0 || daysToExpiration <= 0) return 0;
  return (profitCents / costCents) * (365 / daysToExpiration);
}

function verdictFor({ profitDollars, returnPct, annualized, isLocked }) {
  const meetsProfit = profitDollars >= CONFIG.MIN_PROFIT_WORTH_IT;
  const meetsReturn = returnPct >= CONFIG.MIN_RETURN_WORTH_IT;
  const meetsAnnualized = annualized >= CONFIG.TBILL_ANNUAL_YIELD + CONFIG.TBILL_MARGIN;

  if (profitDollars < 0) return "NOT_WORTH_IT";
  if (!isLocked) {
    // Basis risk opportunities are capped at MARGINAL even if the numbers
    // look great, since the "guaranteed" payout isn't actually guaranteed.
    return meetsProfit && meetsReturn && meetsAnnualized ? "MARGINAL" : "NOT_WORTH_IT";
  }

  const metCount = [meetsProfit, meetsReturn, meetsAnnualized].filter(Boolean).length;
  if (metCount === 3) return "WORTH_IT";
  if (metCount >= 1) return "MARGINAL";
  return "NOT_WORTH_IT";
}

async function evaluatePair(pair) {
  const [kalshiMarket, kalshiBook, polyMarket, polyBook] = await Promise.all([
    fetchKalshiMarket(pair.kalshi.ticker).catch((err) => ({ error: String(err) })),
    fetchKalshiOrderbook(pair.kalshi.ticker).catch((err) => ({ error: String(err) })),
    fetchPolymarketMarket(pair.polymarket.slug).catch((err) => ({ error: String(err) })),
    fetchPolymarketOrderbook(pair.polymarket.slug).catch((err) => ({ error: String(err) })),
  ]);

  if (kalshiBook.error || polyBook.error) {
    return {
      id: pair.id,
      label: pair.label,
      error: kalshiBook.error || polyBook.error,
      detectedAt: new Date().toISOString(),
    };
  }

  const kalshiLadder = pair.kalshi.buy_side === "no" ? kalshiBook.noAsks : kalshiBook.yesAsks;
  const polyLadder = polyBook.offers; // polymarket "buy_side" just labels which outcome this slug/book represents

  const size = CONFIG.TARGET_SIZE_CONTRACTS;
  const kalshiFill = walkKalshiBook(kalshiLadder, size);
  const polyFill = walkPolymarketBook(polyLadder, size);

  const filled = Math.min(kalshiFill.filled, polyFill.filled);
  // Re-walk both books at the jointly-fillable size so the cost numbers line
  // up to the same contract count (walking twice is cheap and keeps the math
  // simple to follow).
  const kalshiAtSize = walkKalshiBook(kalshiLadder, filled);
  const polyAtSize = walkPolymarketBook(polyLadder, filled);

  const combinedCostCents = kalshiAtSize.costCents + polyAtSize.costCents;
  const payoutCents = filled * 100; // one leg always pays $1/contract at settlement
  const profitCents = payoutCents - combinedCostCents;
  const profitDollars = profitCents / 100;
  const returnPct = combinedCostCents > 0 ? profitCents / combinedCostCents : 0;
  const daysToExp = daysUntil(pair.expiration);
  const annualized = annualizedReturn(profitCents, combinedCostCents, daysToExp);
  const isLocked = Boolean(pair.assume_locked);

  const verdict = verdictFor({ profitDollars, returnPct, annualized, isLocked });

  return {
    id: pair.id,
    label: pair.label,
    detectedAt: new Date().toISOString(),
    expiration: pair.expiration,
    daysToExpiration: Number(daysToExp.toFixed(2)),
    tagged: isLocked ? "locked" : "basis_risk",
    legs: {
      kalshi: {
        ticker: pair.kalshi.ticker,
        side: pair.kalshi.buy_side,
        title: kalshiMarket?.title ?? kalshiMarket?.error ?? null,
        contracts: filled,
        priceCents: filled > 0 ? Math.round(kalshiAtSize.costCents / filled) : null,
        costDollars: kalshiAtSize.costCents / 100,
        depthAvailable: kalshiFill.filled,
        url: `https://kalshi.com/markets/${pair.kalshi.ticker}`,
      },
      polymarket: {
        slug: pair.polymarket.slug,
        side: pair.polymarket.buy_side,
        title: polyMarket?.question ?? polyMarket?.error ?? null,
        contracts: filled,
        priceCents: filled > 0 ? Math.round(polyAtSize.costCents / filled) : null,
        costDollars: polyAtSize.costCents / 100,
        depthAvailable: polyFill.filled,
        url: `https://polymarket.us/market/${pair.polymarket.slug}`,
      },
    },
    combinedCostDollars: combinedCostCents / 100,
    guaranteedPayoutDollars: payoutCents / 100,
    profitDollars: Number(profitDollars.toFixed(2)),
    returnPct: Number((returnPct * 100).toFixed(2)),
    annualizedReturnPct: Number((annualized * 100).toFixed(2)),
    tbillAnnualYieldPctAtDetection: Number((CONFIG.TBILL_ANNUAL_YIELD * 100).toFixed(2)),
    verdict,
  };
}

async function main() {
  const mappingRaw = await readFile(MAPPING_PATH, "utf8");
  const mapping = JSON.parse(mappingRaw);

  const pairs = (mapping.pairs ?? []).filter((p) => {
    const hasRealTickers =
      p.kalshi?.ticker && !String(p.kalshi.ticker).startsWith("REPLACE_ME") &&
      p.polymarket?.slug && !String(p.polymarket.slug).startsWith("REPLACE_ME");
    return hasRealTickers;
  });

  if (pairs.length === 0) {
    console.log("No fully-configured pairs in data/mapping.json yet (tickers still say REPLACE_ME) - nothing to scan.");
    return;
  }

  const results = [];
  for (const pair of pairs) {
    try {
      const result = await evaluatePair(pair);
      results.push(result);
      console.log(`[${pair.id}] ${result.error ? "ERROR: " + result.error : result.verdict}`);
    } catch (err) {
      console.error(`[${pair.id}] failed:`, err);
      results.push({ id: pair.id, label: pair.label, error: String(err), detectedAt: new Date().toISOString() });
    }
  }

  const existingLogRaw = await readFile(LOG_PATH, "utf8").catch(() => "[]");
  const existingLog = JSON.parse(existingLogRaw || "[]");
  const updatedLog = existingLog.concat(results.filter((r) => !r.error));

  await writeFile(LOG_PATH, JSON.stringify(updatedLog, null, 2) + "\n", "utf8");
  console.log(`Appended ${results.filter((r) => !r.error).length} entries. Log now has ${updatedLog.length} entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
