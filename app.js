const LOG_URL = "data/opportunity-log.json";

const VERDICT_LABEL = {
  WORTH_IT: "Worth it",
  MARGINAL: "Marginal",
  NOT_WORTH_IT: "Not worth it",
};

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n) {
  return `${n.toFixed(2)}%`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function verdictClass(v) {
  return `verdict-${v.toLowerCase()}`;
}

function isLive(entry) {
  return new Date(entry.expiration).getTime() > Date.now();
}

function renderSummary(entries) {
  const el = document.getElementById("summary");
  if (entries.length === 0) {
    el.innerHTML = "";
    return;
  }
  const total = entries.length;
  const worthIt = entries.filter((e) => e.verdict === "WORTH_IT").length;
  const marginal = entries.filter((e) => e.verdict === "MARGINAL").length;
  const avgProfit = entries.reduce((s, e) => s + e.profitDollars, 0) / total;
  const avgAnnualized = entries.reduce((s, e) => s + e.annualizedReturnPct, 0) / total;

  el.innerHTML = `
    <div class="summary-stat"><div class="label">Logged</div><div class="value">${total}</div></div>
    <div class="summary-stat"><div class="label">Worth it</div><div class="value">${worthIt}</div></div>
    <div class="summary-stat"><div class="label">Marginal</div><div class="value">${marginal}</div></div>
    <div class="summary-stat"><div class="label">Avg profit</div><div class="value">${fmtMoney(avgProfit)}</div></div>
    <div class="summary-stat"><div class="label">Avg annualized</div><div class="value">${fmtPct(avgAnnualized)}</div></div>
  `;
}

function legBox(leg, platformName) {
  return `
    <div class="leg-box">
      <div class="platform">${platformName}</div>
      <div class="detail">${leg.contracts} contracts (${leg.side.toUpperCase()})</div>
      <div class="detail">@ ${leg.priceCents != null ? leg.priceCents + "¢" : "—"}</div>
      <div class="detail">Cost: ${fmtMoney(leg.costDollars)}</div>
    </div>
  `;
}

function renderCard(entry) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-collapsed">
      <div class="card-main">
        <div class="card-title">${entry.label}</div>
        <div class="card-platforms">Kalshi vs Polymarket US${entry.tagged === "basis_risk" ? " · basis risk" : ""}</div>
        <div class="card-expiration">Expires ${fmtDate(entry.expiration)}</div>
      </div>
      <div class="card-right">
        <span class="verdict-pill ${verdictClass(entry.verdict)}">${VERDICT_LABEL[entry.verdict] ?? entry.verdict}</span>
        <div class="annualized">${fmtPct(entry.annualizedReturnPct)}</div>
        <div class="annualized-label">per yr, if held</div>
      </div>
    </div>
    <div class="card-expanded">
      <div class="legs">
        ${legBox(entry.legs.kalshi, "Kalshi")}
        ${legBox(entry.legs.polymarket, "Polymarket US")}
      </div>
      <div class="stat-row">
        <div><span class="stat-label">Combined cost</span>${fmtMoney(entry.combinedCostDollars)}</div>
        <div><span class="stat-label">Profit</span>${fmtMoney(entry.profitDollars)}+</div>
        <div><span class="stat-label">Return</span>${fmtPct(entry.returnPct)}</div>
        <div><span class="stat-label">Detected</span>${fmtDateTime(entry.detectedAt)}</div>
      </div>
      <div class="leg-links">
        <a class="leg-link" href="${entry.legs.kalshi.url}" target="_blank" rel="noopener">Open on Kalshi</a>
        <a class="leg-link" href="${entry.legs.polymarket.url}" target="_blank" rel="noopener">Open on Polymarket US</a>
      </div>
    </div>
  `;
  card.addEventListener("click", () => card.classList.toggle("expanded"));
  return card;
}

function renderLiveCards(entries) {
  const container = document.getElementById("live-cards");
  container.innerHTML = "";

  // "Live" = most recent detection per id, only if still before expiration.
  const latestById = new Map();
  for (const e of entries) {
    const prev = latestById.get(e.id);
    if (!prev || new Date(e.detectedAt) > new Date(prev.detectedAt)) {
      latestById.set(e.id, e);
    }
  }
  const live = [...latestById.values()].filter(isLive).sort((a, b) => b.annualizedReturnPct - a.annualizedReturnPct);

  if (live.length === 0) {
    container.innerHTML = `<div class="empty-state">No live opportunities logged yet. Once the scheduled scan runs against real market pairs, they'll show up here.</div>`;
    return;
  }
  for (const entry of live) {
    container.appendChild(renderCard(entry));
  }
}

function renderHistory(entries) {
  const body = document.getElementById("history-body");
  const sorted = [...entries].sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
  body.innerHTML = sorted
    .map(
      (e) => `
    <tr>
      <td class="mono">${fmtDateTime(e.detectedAt)}</td>
      <td>${e.label}</td>
      <td class="mono">${fmtDate(e.expiration)}</td>
      <td class="mono">${fmtMoney(e.profitDollars)}</td>
      <td class="mono">${fmtPct(e.returnPct)}</td>
      <td class="mono">${fmtPct(e.annualizedReturnPct)}</td>
      <td><span class="verdict-pill ${verdictClass(e.verdict)}">${VERDICT_LABEL[e.verdict] ?? e.verdict}</span></td>
    </tr>
  `
    )
    .join("");
}

function setupTheme() {
  const toggle = document.getElementById("theme-toggle");
  const stored = localStorage.getItem("theme");
  if (stored) document.documentElement.setAttribute("data-theme", stored);
  toggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch (_) {
      /* private browsing etc - theme just won't persist */
    }
  });
}

async function main() {
  setupTheme();
  try {
    const res = await fetch(LOG_URL, { cache: "no-store" });
    const entries = res.ok ? await res.json() : [];
    renderSummary(entries);
    renderLiveCards(entries);
    renderHistory(entries);
  } catch (err) {
    document.getElementById("live-cards").innerHTML =
      `<div class="empty-state">Couldn't load the opportunity log (${err.message}).</div>`;
  }
}

main();
