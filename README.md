# Events Arb — logging-only arbitrage scanner

Detects and logs price mismatches between Kalshi and Polymarket US on matching
event contracts (starting with BTC/ETH year-end price brackets). **This does
not place trades** — it only records what it sees so you can judge real
frequency and quality before automating anything.

Runs entirely for free:
- The dashboard is a static site on **GitHub Pages**.
- A **GitHub Actions** workflow runs every 10 minutes, fetches both platforms,
  and commits the results as JSON into `data/opportunity-log.json`.
- The repo itself is the database — no server, no paid hosting.

## One-time setup

1. **Create the repo.** On GitHub, create a new **public** repository (public
   is required for unlimited free Actions minutes and free Pages). Push this
   folder's contents to it:
   ```
   git init
   git add .
   git commit -m "Initial scanner setup"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. **Enable GitHub Pages.** In the repo: Settings → Pages → Source → "Deploy
   from a branch" → branch `main`, folder `/ (root)`. Save. Your dashboard
   will be live at `https://<you>.github.io/<repo>/` within a minute or two.
3. **Enable Actions writing back to the repo.** In the repo: Settings →
   Actions → General → "Workflow permissions" → select **"Read and write
   permissions"**, then save. (The workflow needs this to commit the updated
   log file.) Actions should already be enabled by default on a new repo.
4. **Confirm the schedule is on.** Go to the Actions tab — you should see
   "Scan for arbitrage opportunities" listed. GitHub disables scheduled
   workflows on repos with no activity for 60 days, but pushing a commit
   re-enables it. You can also trigger a run manually any time from the
   Actions tab ("Run workflow" button — the `workflow_dispatch` trigger in
   `scan.yml` is what enables that).

That's it for hosting. The scanner won't produce real data until you add at
least one market pair (next section) — until then, every scheduled run just
logs "nothing to scan" and exits.

## Adding a market pair

Edit `data/mapping.json` and add an entry to the `pairs` array. Each entry
needs:

- `id` — a stable slug. Don't rename this once you start logging data for it,
  or the dashboard will treat it as a new/unrelated trade.
- `label` — what shows on the dashboard card.
- `expiration` — ISO 8601 UTC timestamp both contracts settle at.
- `settlement_note` — write down, in your own words, what index/source and
  settlement instant each side uses. This is the thing to double check before
  trusting a "locked" verdict.
- `assume_locked` — `true` only once you've actually confirmed (via each
  platform's rules page) that both contracts settle to the identical
  underlying and identical settlement timestamp. Leave `false` and the
  scanner will cap the verdict at `MARGINAL` even when the numbers look
  great, tagging it `basis_risk` instead — because a rules mismatch (e.g.
  different reference exchanges, different cutoff times) means the "hedge"
  isn't actually guaranteed.
- `kalshi.ticker` — the exact Kalshi market ticker (find it in the market URL
  or via `GET https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=...`).
- `kalshi.buy_side` — `yes` or `no`: which side you'd buy on Kalshi.
- `polymarket.slug` — the Polymarket US market slug (from its URL).
- `polymarket.buy_side` — `yes` or `no`: which side that slug represents in
  the hedge (labeling only — see "How matching works" below).

The two `buy_side` values should be complementary: e.g. buy YES on Kalshi
("BTC finishes above $100k") and buy the market on Polymarket that pays out
if BTC finishes at or below $100k. Between the two legs, exactly one side
should pay out $1/contract no matter what happens — that's what makes it an
arbitrage instead of a directional bet.

Until you replace the placeholder `REPLACE_ME_...` values, the scanner
skips that entry entirely (it won't error, just logs a skip message).

## How matching works

This uses a **manual mapping file** rather than automated text-matching
between platforms, because contract wording, strike conventions, and
settlement rules differ enough between Kalshi and Polymarket that automatic
matching would regularly produce false "arbitrage" that's actually just two
different bets. You decide which pairs are worth tracking and confirm they
truly match; the scanner just does the math once you've told it what to
compare.

## Updating the T-bill yield

`scripts/config.mjs` has a hardcoded `TBILL_ANNUAL_YIELD`. There's no live
feed for this by design (keeps things simple/free) — check it against
[FRED (DTB3)](https://fred.stlouisfed.org/series/DTB3) or
[Treasury.gov](https://home.treasury.gov/resource-center/data-chart-center/interest-rates)
every so often and update the number. It only affects the "WORTH IT"
threshold, not past logged entries (each entry stores the yield that was in
effect when it was detected, so history stays honest even after you update
it).

## Verdict logic

For a **locked** pair (`assume_locked: true`):
- **Worth it**: profit ≥ $5 **and** return ≥ 2% **and** annualized return
  beats the T-bill yield + 3 percentage points.
- **Marginal**: meets one or two of those three, but not all three.
- **Not worth it**: meets none, or the position loses money.

For a **basis_risk** pair (`assume_locked: false`), the verdict is capped at
`MARGINAL` even if all three bars are cleared, since the payoff isn't
actually guaranteed to be risk-free.

Cost/profit are computed by **walking the order book** on both platforms up
to `TARGET_SIZE_CONTRACTS` (default 100, in `config.mjs`) — not top-of-book
— so the numbers reflect what you could actually fill, not just the best
quote. If one side runs out of depth first, both legs are sized down to
whatever's jointly fillable.

## Local testing

```
npm run scan
```
runs the scanner once against real APIs and updates
`data/opportunity-log.json` locally. Open `index.html` in a browser (or
`python3 -m http.server` from this folder) to preview the dashboard against
whatever's in that file.

## Known caveats / things to verify before trusting this

- **Kalshi's order book only lists resting bids** on each side (a reciprocal
  binary-market structure) — there's no separate ask list. This scanner
  derives the ask ladder for one side by inverting the resting bids on the
  other side (`price = 100 - bid_price`), per Kalshi's public docs. Sanity
  check this against the live Kalshi UI for your first few real pairs.
- **Polymarket US is a newer, less-documented API** (`gateway.polymarket.us`).
  Its order book response shape has had at least one reported quirk (bids/
  offers sometimes nested under a `marketData` wrapper); `scripts/
  polymarket.mjs` handles both shapes defensively, but re-verify against a
  live response if numbers look off.
- Neither platform's public market-data endpoints require an API key for
  reads, per current docs — if that changes, the fetch calls in
  `scripts/kalshi.mjs` / `scripts/polymarket.mjs` are the only places that
  need new auth headers.
- This phase is **read-only by design** — there is no order-placement code,
  no trading credentials, and no notification/email integration anywhere in
  this repo.
