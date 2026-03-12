import { useState, useEffect, useCallback } from "react";

// ─── SCAN UNIVERSE BY THEME ──────────────────────────────────────────────────
const SCAN_UNIVERSE = {
  "AI / Semiconductors": [
    "NVDA","AMD","ARM","MRVL","ALAB","CRDO","ASML","LRCX","KLAC",
    "AMAT","ONTO","SMCI","TSM","AVGO","QCOM","MU","MPWR","ADI","TXN","NXPI"
  ],
  "AI Infrastructure / Data Centers": [
    "EQIX","DLR","DELL","HPE","VRT","ETN","PLTR","DDOG","SNOW",
    "PANW","NET","CRWD","ZS","RDDT","GTLB","HCP"
  ],
  "Energy / Power": [
    "VST","CEG","NRG","AES","PCG","EXC","NEE","OKE","LNG","KMI",
    "WMB","AEP","DUK","SO","NTR","ADM","ETR","PPL"
  ],
  "Bitcoin Mining / Crypto": [
    "MARA","RIOT","CLSK","HUT","IREN","WULF","CIFR","CORZ","COIN","HOOD","MSTR"
  ],
  "Fintech / E-commerce": [
    "SQ","AFRM","UPST","NU","SOFI","PYPL","BILL","SHOP","MELI","SE",
    "APP","TTD","CRCL","SEZL","MQ"
  ],
  "Defense / Aerospace": [
    "KTOS","AVAV","LMT","RTX","NOC","HII","LDOS","BWXT","CACI","SAIC","RCAT"
  ],
  "Consumer / Health / Other": [
    "NFLX","COST","WMT","HIMS","LULU","ONON","DECK","VIK","SNDK",
    "LUMN","ONDS","SMTC","BOOT","TPR"
  ],
};

const ALL_SCAN_TICKERS = [...new Set(Object.values(SCAN_UNIVERSE).flat())];

// ─── NATHALIE'S DEFAULT WATCHLIST ────────────────────────────────────────────
const DEFAULT_WATCHLIST = [
  "NBIS","VST","IREN","SHOP","SOFI","WULF","LUMN","ONDS","CRCL","HIMS",
  "VIK","NFLX","SNDK","ADM","NVDA","TSM","SMCI","VRT","AVGO","PLTR",
  "ETN","COST","WMT","KTOS","AVAV"
];

const PORTFOLIO = [
  { ticker: "NBIS", shares: null, avgCost: null, note: "Main position — trimming in progress" },
  { ticker: "NVDA", shares: 2, avgCost: 178, note: "Core holding" },
];

// ─── CACHE (once per day) ────────────────────────────────────────────────────
const CACHE_KEY = "qm_data_v3";
const CACHE_DATE_KEY = "qm_date_v3";
const WL_KEY = "qm_watchlist_v3";
const getTodayStr = () => new Date().toISOString().slice(0, 10);

const readCache = () => {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== getTodayStr()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const writeCache = (d) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(d));
    localStorage.setItem(CACHE_DATE_KEY, getTodayStr());
  } catch {}
};
const readWL = () => {
  try { const r = localStorage.getItem(WL_KEY); return r ? JSON.parse(r) : [...DEFAULT_WATCHLIST]; }
  catch { return [...DEFAULT_WATCHLIST]; }
};
const writeWL = (wl) => { try { localStorage.setItem(WL_KEY, JSON.stringify(wl)); } catch {} };

// ─── FETCH ONE TICKER ────────────────────────────────────────────────────────
const fetchQuote = async (ticker) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const q = r.indicators?.quote?.[0] || {};
    const closes = (q.close || q.closes || []).filter(Boolean);
    const highs = (q.high || []);
    const lows = (q.low || []);
    const volumes = (q.volume || []);
    if (closes.length < 10) return null;
    const price = r.meta?.regularMarketPrice || closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const changePct = ((price - prev) / prev) * 100;
    const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
    const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    // ATR
    let atr = null;
    const trs = [];
    for (let i = Math.max(1, highs.length - 14); i < highs.length; i++) {
      if (highs[i] && lows[i] && closes[i - 1]) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
      }
    }
    if (trs.length > 0) atr = trs.reduce((a, b) => a + b, 0) / trs.length;
    // Returns
    const ret3m = closes.length >= 63 ? ((price - closes[closes.length - 63]) / closes[closes.length - 63]) * 100 : ((price - closes[0]) / closes[0]) * 100;
    const w52High = Math.max(...closes);
    const w52Low = Math.min(...closes);
    const pctFromHigh = ((price - w52High) / w52High) * 100;
    // Volume ratio
    const validVols = volumes.filter(Boolean);
    const avgVol = validVols.length >= 20 ? validVols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    const todayVol = validVols[validVols.length - 1] || null;
    const volRatio = avgVol && todayVol ? todayVol / avgVol : null;
    return { ticker, price, changePct, ma50, ma200, atr, ret3m, w52High, w52Low, pctFromHigh, volRatio };
  } catch { return null; }
};

// ─── SCANNER LOGIC ───────────────────────────────────────────────────────────
const passesFilters = (q, spyRS) => {
  if (!q || !q.ma50 || !q.ma200) return false;
  return q.price > q.ma50 && q.price > q.ma200 && (q.ret3m - spyRS) > 5 && q.pctFromHigh > -20;
};
const calcScore = (q, spyRS) => {
  const rs = q.ret3m - spyRS;
  const proximity = 100 + q.pctFromHigh;
  const volBonus = q.volRatio > 1.5 ? 8 : 0;
  return rs + proximity * 0.25 + volBonus;
};

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg: "#050A0E", s1: "#080F15", s2: "#0A1520",
  b1: "#0D1F2D", b2: "#1A3A5C",
  accent: "#00D4FF", green: "#00FF88", red: "#FF4444", yellow: "#FFC800",
  dim: "#4A7A9B", text: "#C8D8E8",
};
const mono = { fontFamily: "'Share Tech Mono', monospace" };
const cond = { fontFamily: "'Barlow Condensed', sans-serif" };
const lbl = { ...mono, fontSize: "9px", letterSpacing: "2px", color: C.dim, textTransform: "uppercase" };
const TH = { ...lbl, padding: "8px 12px", textAlign: "left", borderBottom: `1px solid ${C.b1}`, background: C.s2, whiteSpace: "nowrap" };
const TD = { padding: "7px 12px", fontSize: "13px", borderBottom: `1px solid ${C.b1}`, whiteSpace: "nowrap" };

const Pill = ({ color, text }) => {
  const map = {
    green: [C.green, "rgba(0,255,136,0.1)", "rgba(0,255,136,0.3)"],
    red: [C.red, "rgba(255,68,68,0.1)", "rgba(255,68,68,0.25)"],
    yellow: [C.yellow, "rgba(255,200,0,0.1)", "rgba(255,200,0,0.25)"],
    blue: [C.accent, "rgba(0,212,255,0.1)", "rgba(0,212,255,0.25)"],
  };
  const [fg, bg, border] = map[color] || map.blue;
  return <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: "2px", fontSize: "10px", ...mono, fontWeight: 600, letterSpacing: "1px", background: bg, color: fg, border: `1px solid ${border}` }}>{text}</span>;
};

const RSBar = ({ value }) => {
  const capped = Math.max(0, Math.min(100, ((value + 20) / 80) * 100));
  const color = value > 15 ? C.green : value > 0 ? C.yellow : C.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
      <div style={{ flex: 1, height: "5px", background: C.b1, borderRadius: "1px", overflow: "hidden" }}>
        <div style={{ width: `${capped}%`, height: "100%", background: color, transition: "width 0.8s ease" }} />
      </div>
      <span style={{ ...mono, fontSize: "11px", color, minWidth: "52px", textAlign: "right" }}>{value > 0 ? "+" : ""}{value.toFixed(1)}%</span>
    </div>
  );
};

const BreadthGauge = ({ value }) => {
  const color = value >= 60 ? C.green : value >= 40 ? C.yellow : C.red;
  const angle = (value / 100) * 180 - 90;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 16px" }}>
      <svg width="130" height="74" viewBox="0 0 130 74">
        <path d="M8,67 A57,57 0 0,1 122,67" fill="none" stroke={C.b1} strokeWidth="12" strokeLinecap="round" />
        <path d="M8,67 A57,57 0 0,1 122,67" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * 179} 179`} style={{ transition: "stroke-dasharray 1s ease" }} />
        <line x1="65" y1="67" x2="65" y2="20" stroke={color} strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${angle},65,67)`} />
        <circle cx="65" cy="67" r="4" fill={color} />
        <text x="4" y="74" fill={C.dim} fontSize="8" fontFamily="'Share Tech Mono',monospace">0%</text>
        <text x="108" y="74" fill={C.dim} fontSize="8" fontFamily="'Share Tech Mono',monospace">100%</text>
      </svg>
      <div style={{ ...cond, fontSize: "32px", fontWeight: 700, color, lineHeight: 1, marginTop: "-4px" }}>{value.toFixed(0)}%</div>
      <div style={{ ...mono, fontSize: "9px", color: C.dim, letterSpacing: "2px", marginTop: "3px" }}>ABOVE 50-DAY MA</div>
    </div>
  );
};

// ─── ATR CALCULATOR ──────────────────────────────────────────────────────────
function ATRCalculator({ quotes }) {
  const [ticker, setTicker] = useState("NVDA");
  const [account, setAccount] = useState("50000");
  const [riskPct, setRiskPct] = useState("2");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const calc = async () => {
    setBusy(true); setRes(null);
    let q = quotes[ticker.toUpperCase()] || await fetchQuote(ticker.toUpperCase());
    if (!q?.atr) { setRes({ err: `No ATR data for ${ticker.toUpperCase()}` }); setBusy(false); return; }
    const acc = parseFloat(account) || 50000;
    const risk = parseFloat(riskPct) / 100;
    const stop = q.price - 2 * q.atr;
    const t1 = q.price + 3 * q.atr;
    const t2 = q.price + 6 * q.atr;
    const rps = q.price - stop;
    const maxR = acc * risk;
    const shares = Math.floor(maxR / rps);
    const total = shares * q.price;
    const posPct = (total / acc) * 100;
    const rr = (t1 - q.price) / rps;
    setRes({ q, stop, t1, t2, shares, total, posPct, rr, rps, maxR, ticker: ticker.toUpperCase() });
    setBusy(false);
  };

  const inp = { background: C.s2, border: `1px solid ${C.b2}`, color: C.text, padding: "8px 12px", ...mono, fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "8px", alignItems: "end", marginBottom: "16px" }}>
        {[["TICKER", ticker, v => setTicker(v.toUpperCase()), "text", "e.g. NVDA"],
          ["ACCOUNT SIZE ($)", account, setAccount, "number", ""],
          ["RISK PER TRADE (%)", riskPct, setRiskPct, "number", ""]].map(([l, v, s, t, ph]) => (
          <div key={l}>
            <div style={{ ...lbl, marginBottom: "6px" }}>{l}</div>
            <input style={inp} value={v} onChange={e => s(e.target.value)} type={t} placeholder={ph} onKeyDown={e => e.key === "Enter" && calc()} />
          </div>
        ))}
        <button onClick={calc} disabled={busy} style={{ ...cond, background: C.accent, color: C.bg, border: "none", padding: "9px 20px", fontWeight: 700, fontSize: "13px", letterSpacing: "2px", cursor: busy ? "not-allowed" : "pointer", textTransform: "uppercase", height: "38px" }}>
          {busy ? "..." : "CALCULATE"}
        </button>
      </div>

      {res && !res.err && (
        <div style={{ background: C.s2, border: `1px solid ${C.b2}`, padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: C.b1, marginBottom: "12px" }}>
            {[["ENTRY PRICE", `$${res.q.price.toFixed(2)}`, C.accent],
              ["STOP LOSS (−2 ATR)", `$${res.stop.toFixed(2)}`, C.red],
              ["TARGET 1 (+3 ATR)", `$${res.t1.toFixed(2)}`, C.green],
              ["TARGET 2 (+6 ATR)", `$${res.t2.toFixed(2)}`, C.green]].map(([l, v, col]) => (
              <div key={l} style={{ background: C.s1, padding: "12px 14px" }}>
                <div style={lbl}>{l}</div>
                <div style={{ ...cond, fontSize: "22px", fontWeight: 700, color: col, marginTop: "4px" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px", marginBottom: "12px" }}>
            {[["SHARES TO BUY", res.shares, C.text],
              ["TOTAL POSITION", `$${res.total.toFixed(0)} (${res.posPct.toFixed(1)}%)`, res.posPct > 15 ? C.red : C.text],
              ["MAX RISK $", `$${res.maxR.toFixed(0)}`, C.red],
              ["REWARD / RISK", `${res.rr.toFixed(1)}:1`, res.rr >= 2 ? C.green : C.red]].map(([l, v, col]) => (
              <div key={l}>
                <div style={lbl}>{l}</div>
                <div style={{ ...cond, fontSize: "22px", fontWeight: 700, color: col, marginTop: "4px" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 12px", background: "rgba(0,212,255,0.04)", border: `1px solid rgba(0,212,255,0.12)`, ...mono, fontSize: "10px", color: C.dim, letterSpacing: "1px" }}>
            ATR = ${res.q.atr.toFixed(2)} · RISK/SHARE = ${res.rps.toFixed(2)} ·&nbsp;
            {res.posPct > 15 ? "⚠ POSITION >15% — REDUCE SHARES" : res.rr < 2 ? "⚠ R/R BELOW 2:1 — SKIP THIS TRADE" : "✓ SETUP WITHIN RISK PARAMETERS"}
          </div>
        </div>
      )}
      {res?.err && <div style={{ padding: "12px", background: "rgba(255,68,68,0.05)", border: "1px solid rgba(255,68,68,0.2)", ...mono, fontSize: "11px", color: C.red }}>{res.err}</div>}

      <div style={{ marginTop: "16px", ...mono, fontSize: "10px", color: C.dim, lineHeight: "2" }}>
        💡 ATR = Average True Range — how much the stock moves per day on average.<br />
        Stop = Entry − 2×ATR (room to breathe). Target 1 = Entry + 3×ATR = 3:1 reward/risk.<br />
        Shares = (Account × Risk%) ÷ (Entry − Stop). Caps your max loss to your chosen % of account.
      </div>
    </div>
  );
}

// ─── SCAN PROGRESS SCREEN ─────────────────────────────────────────────────────
function ScanScreen({ done, total, current }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ padding: "48px 32px", textAlign: "center" }}>
      <div style={{ ...cond, fontSize: "30px", fontWeight: 700, color: C.accent, marginBottom: "6px" }}>SCANNING MARKET...</div>
      <div style={{ ...mono, fontSize: "10px", color: C.dim, letterSpacing: "2px", marginBottom: "28px" }}>
        RUNS ONCE PER DAY · DATA CACHED UNTIL MIDNIGHT · {total} STOCKS
      </div>
      <div style={{ maxWidth: "480px", margin: "0 auto 12px" }}>
        <div style={{ height: "6px", background: C.b1, borderRadius: "3px", overflow: "hidden", marginBottom: "8px" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: C.accent, transition: "width 0.3s ease", borderRadius: "3px" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: "10px", color: C.dim }}>
          <span>{done} / {total} stocks</span>
          <span style={{ color: C.accent }}>{pct}%</span>
        </div>
      </div>
      {current && <div style={{ ...mono, fontSize: "10px", color: C.dim, letterSpacing: "1px", marginBottom: "28px" }}>→ {current}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", maxWidth: "560px", margin: "0 auto" }}>
        {Object.entries(SCAN_UNIVERSE).map(([theme, tickers]) => (
          <div key={theme} style={{ padding: "8px 10px", background: C.s2, border: `1px solid ${C.b1}`, textAlign: "left" }}>
            <div style={{ ...mono, fontSize: "8px", color: C.dim, letterSpacing: "1px", marginBottom: "2px" }}>{theme.slice(0, 20).toUpperCase()}</div>
            <div style={{ ...cond, fontSize: "14px", fontWeight: 700, color: C.text }}>{tickers.length} stocks</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [scanDone, setScanDone] = useState(0);
  const [scanCurrent, setScanCurrent] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab, setTab] = useState("scanner");
  const [watchlist, setWatchlist] = useState(readWL);
  const [addedSet, setAddedSet] = useState(new Set());

  const allTickers = [...new Set([...ALL_SCAN_TICKERS, "SPY", "QQQ", ...watchlist])];

  const runScan = useCallback(async (force = false) => {
    setLoading(true); setScanDone(0); setScanCurrent("");
    if (!force) {
      const cached = readCache();
      if (cached) { setQuotes(cached); setFromCache(true); setLastUpdated(new Date()); setLoading(false); return; }
    }
    setFromCache(false);
    const results = {};
    const batches = [];
    for (let i = 0; i < allTickers.length; i += 4) batches.push(allTickers.slice(i, i + 4));
    let done = 0;
    for (const batch of batches) {
      setScanCurrent(batch.join(", "));
      const fetched = await Promise.all(batch.map(fetchQuote));
      fetched.forEach((q, i) => { if (q) results[batch[i]] = q; });
      done += batch.length;
      setScanDone(done);
      await new Promise(r => setTimeout(r, 220));
    }
    writeCache(results);
    setQuotes(results);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { runScan(); }, []);

  const addToWL = (ticker) => {
    if (watchlist.includes(ticker)) return;
    const updated = [...watchlist, ticker];
    setWatchlist(updated); writeWL(updated);
    setAddedSet(prev => new Set([...prev, ticker]));
  };
  const removeFromWL = (ticker) => {
    const updated = watchlist.filter(t => t !== ticker);
    setWatchlist(updated); writeWL(updated);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const spy = quotes["SPY"];
  const qqq = quotes["QQQ"];
  const spyRS = spy?.ret3m || 0;
  const wlQuotes = watchlist.map(t => quotes[t]).filter(Boolean);
  const above50 = wlQuotes.filter(q => q.ma50 && q.price > q.ma50).length;
  const breadth = wlQuotes.length > 0 ? (above50 / wlQuotes.length) * 100 : 0;
  const regime = spy ? (spy.ma200 && spy.price > spy.ma200 ? "BULL" : "BEAR") : "—";

  // watchlist momentum sorted
  const wlMomentum = watchlist.map(t => {
    const q = quotes[t];
    if (!q) return { ticker: t, rs: null, price: null };
    return { ...q, rs: q.ret3m - spyRS, aboveMa50: q.ma50 && q.price > q.ma50, aboveMa200: q.ma200 && q.price > q.ma200 };
  }).sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999));

  // scanner results by theme
  const scanByTheme = {};
  let totalHits = 0;
  Object.entries(SCAN_UNIVERSE).forEach(([theme, tickers]) => {
    const hits = tickers.map(t => quotes[t]).filter(q => q && passesFilters(q, spyRS) && !watchlist.includes(q.ticker))
      .map(q => ({ ...q, rs: q.ret3m - spyRS, score: calcScore(q, spyRS) }))
      .sort((a, b) => b.score - a.score);
    if (hits.length > 0) { scanByTheme[theme] = hits; totalHits += hits.length; }
  });

  const TABS = [
    ["scanner", `🔍 SCANNER  ${loading ? "..." : totalHits + " IDEAS"}`],
    ["watchlist", "📈 WATCHLIST"],
    ["portfolio", "💼 PORTFOLIO"],
    ["atr", "🎯 ATR CALCULATOR"],
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Barlow', sans-serif" }}>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(180deg,${C.s2} 0%,${C.bg} 100%)`, borderBottom: `1px solid ${C.b2}`, padding: "13px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ ...cond, fontSize: "19px", fontWeight: 700, letterSpacing: "3px", color: C.accent, textTransform: "uppercase" }}>⬡ QUANT MASTER V3.1</div>
          <div style={{ ...mono, fontSize: "9px", color: C.dim, letterSpacing: "2px", marginTop: "2px" }}>
            NATHALIE'S COMMAND CENTER · {ALL_SCAN_TICKERS.length}+ STOCKS · DAILY SCAN · CACHED UNTIL MIDNIGHT
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {fromCache && <div style={{ ...mono, fontSize: "9px", color: C.dim, letterSpacing: "1px" }}>✓ CACHED · NEXT SCAN TOMORROW</div>}
          <button onClick={() => runScan(true)} disabled={loading} style={{ ...cond, background: "transparent", color: C.accent, border: `1px solid rgba(0,212,255,0.3)`, padding: "5px 14px", fontWeight: 700, fontSize: "10px", letterSpacing: "2px", cursor: loading ? "not-allowed" : "pointer", textTransform: "uppercase" }}>
            ↻ FORCE RESCAN
          </button>
          {lastUpdated && (
            <div style={{ ...mono, fontSize: "10px", color: C.dim, textAlign: "right" }}>
              <div>{lastUpdated.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
              <div>{lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          )}
        </div>
      </div>

      {loading ? <ScanScreen done={scanDone} total={allTickers.length} current={scanCurrent} /> : (
        <>
          {/* METRICS BAR */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: C.b1 }}>
            {[
              ["MARKET REGIME", regime, regime === "BULL" ? C.green : regime === "BEAR" ? C.red : C.yellow, spy ? `SPY $${spy.price?.toFixed(2)}` : "—"],
              ["WATCHLIST vs 50MA", `${breadth.toFixed(0)}%`, breadth >= 60 ? C.green : breadth >= 40 ? C.yellow : C.red, `${above50} of ${wlQuotes.length} stocks`],
              ["SCANNER IDEAS", totalHits, totalHits > 5 ? C.green : totalHits > 0 ? C.yellow : C.red, "stocks passing all 3 filters"],
              ["QQQ TODAY", qqq ? `$${qqq.price?.toFixed(2)}` : "—", qqq?.changePct >= 0 ? C.green : C.red, qqq ? `${qqq.changePct >= 0 ? "+" : ""}${qqq.changePct?.toFixed(2)}% · AI bellwether` : "—"],
            ].map(([l, v, col, sub]) => (
              <div key={l} style={{ background: C.s1, padding: "13px 16px" }}>
                <div style={lbl}>{l}</div>
                <div style={{ ...cond, fontSize: "26px", fontWeight: 700, color: col, lineHeight: 1, marginTop: "4px" }}>{v}</div>
                <div style={{ ...mono, fontSize: "10px", color: C.dim, marginTop: "3px" }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* BREADTH + CHECKLIST */}
          <div style={{ display: "grid", gridTemplateColumns: "195px 1fr", gap: "1px", background: C.b1 }}>
            <div style={{ background: C.s1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BreadthGauge value={breadth} />
            </div>
            <div style={{ background: C.s1, padding: "13px 16px" }}>
              <div style={{ ...lbl, marginBottom: "10px" }}>📋 PRE-MARKET CHECKLIST — DO IN THIS ORDER BEFORE LOOKING AT STOCK PRICES</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "5px" }}>
                {[["1","10Y Treasury + DXY","Risk appetite & dollar"],["2","US Futures (NQ / ES)","Pre-market direction"],["3","VIX Volatility Index","Fear level — high = caution"],["4","CPI / PCE / NFP today?","Market-moving events"],["5","NBIS + NVDA news","Your active positions"],["6","Only THEN: stock prices","Context before prices"]].map(([n, s, note]) => (
                  <div key={n} style={{ display: "flex", gap: "8px", padding: "6px 10px", background: C.s2, border: `1px solid ${C.b1}` }}>
                    <div style={{ ...cond, fontWeight: 700, fontSize: "16px", color: C.accent, lineHeight: 1, minWidth: "12px" }}>{n}</div>
                    <div>
                      <div style={{ fontSize: "12px", color: C.text, fontWeight: 500 }}>{s}</div>
                      <div style={{ ...mono, fontSize: "9px", color: C.dim, marginTop: "1px" }}>{note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* TABS */}
          <div style={{ display: "flex", gap: "1px", background: C.b1 }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{ padding: "9px 18px", border: "none", cursor: "pointer", ...cond, fontWeight: 700, fontSize: "11px", letterSpacing: "2px", background: tab === id ? C.s1 : C.bg, color: tab === id ? C.accent : C.dim, borderBottom: tab === id ? `2px solid ${C.accent}` : "2px solid transparent", textTransform: "uppercase" }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── SCANNER TAB ──────────────────────────────────────────────── */}
          {tab === "scanner" && (
            <div style={{ background: C.s1 }}>
              <div style={{ padding: "10px 16px", background: C.s2, borderBottom: `1px solid ${C.b1}`, display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ ...mono, fontSize: "10px", color: C.dim }}>
                  3 FILTERS: ① Price above 50MA &nbsp;② Price above 200MA &nbsp;③ RS vs SPY &gt;+5% &nbsp;④ Within 20% of 52W high
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: "14px" }}>
                  {[["STRONG", C.green], ["WATCH", C.yellow], ["SPECULATIVE", C.accent]].map(([l, col]) => (
                    <span key={l} style={{ ...mono, fontSize: "9px", color: col, letterSpacing: "1px" }}>● {l}</span>
                  ))}
                </div>
              </div>

              {totalHits === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", ...mono, fontSize: "12px", color: C.dim }}>
                  NO STOCKS PASSING ALL FILTERS TODAY — MARKET CONDITIONS UNFAVORABLE. HOLD CASH.
                </div>
              ) : Object.entries(scanByTheme).map(([theme, stocks]) => (
                <div key={theme}>
                  <div style={{ padding: "7px 16px", background: "rgba(0,212,255,0.03)", borderTop: `1px solid ${C.b1}`, borderBottom: `1px solid ${C.b1}`, display: "flex", gap: "10px", alignItems: "center" }}>
                    <span style={{ ...cond, fontSize: "11px", fontWeight: 700, letterSpacing: "3px", color: C.accent, textTransform: "uppercase" }}>{theme}</span>
                    <span style={{ ...mono, fontSize: "10px", color: C.dim }}>{stocks.length} idea{stocks.length !== 1 ? "s" : ""}</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{["TICKER","PRICE","TODAY %","RS vs SPY","SCORE","vs 50MA","vs 200MA","FROM 52W HIGH","VOL vs AVG","RATING","ACTION"].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {stocks.map((q, i) => {
                        const isOn = addedSet.has(q.ticker) || watchlist.includes(q.ticker);
                        const rating = q.rs > 20 && q.pctFromHigh > -10 ? "STRONG" : q.rs > 10 ? "WATCH" : "SPEC";
                        const rCol = rating === "STRONG" ? "green" : rating === "WATCH" ? "yellow" : "blue";
                        const borderCol = rating === "STRONG" ? C.green : rating === "WATCH" ? C.yellow : C.accent;
                        return (
                          <tr key={q.ticker} style={{ background: i % 2 === 0 ? C.s1 : C.bg, borderLeft: `3px solid ${borderCol}` }}>
                            <td style={{ ...TD, ...cond, fontWeight: 700, fontSize: "15px", color: C.accent }}>{q.ticker}</td>
                            <td style={{ ...TD, ...mono }}>${q.price?.toFixed(2)}</td>
                            <td style={{ ...TD, ...mono, color: q.changePct >= 0 ? C.green : C.red }}>{q.changePct >= 0 ? "+" : ""}{q.changePct?.toFixed(2)}%</td>
                            <td style={{ ...TD, minWidth: "150px" }}><RSBar value={q.rs} /></td>
                            <td style={{ ...TD, ...mono }}>{q.score?.toFixed(0)}</td>
                            <td style={TD}><Pill color="green" text="ABOVE" /></td>
                            <td style={TD}><Pill color="green" text="ABOVE" /></td>
                            <td style={{ ...TD, ...mono, color: q.pctFromHigh > -10 ? C.green : q.pctFromHigh > -20 ? C.yellow : C.red }}>{q.pctFromHigh?.toFixed(1)}%</td>
                            <td style={{ ...TD, ...mono, color: q.volRatio > 1.5 ? C.green : q.volRatio < 0.7 ? C.red : C.dim }}>{q.volRatio ? `${q.volRatio.toFixed(1)}x` : "—"}</td>
                            <td style={TD}><Pill color={rCol} text={rating} /></td>
                            <td style={TD}>
                              {isOn
                                ? <span style={{ ...mono, fontSize: "10px", color: C.green, letterSpacing: "1px" }}>✓ ON WATCHLIST</span>
                                : <button onClick={() => addToWL(q.ticker)} style={{ background: "rgba(0,255,136,0.08)", border: `1px solid rgba(0,255,136,0.3)`, color: C.green, padding: "4px 10px", cursor: "pointer", ...mono, fontSize: "10px", letterSpacing: "1px" }}>+ ADD</button>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* ── WATCHLIST TAB ────────────────────────────────────────────── */}
          {tab === "watchlist" && (
            <div style={{ background: C.s1 }}>
              <div style={{ padding: "8px 16px", background: C.s2, borderBottom: `1px solid ${C.b1}`, ...mono, fontSize: "9px", color: C.dim }}>
                RS = 3-MONTH RETURN MINUS SPY BASELINE (SPY: {spyRS > 0 ? "+" : ""}{spyRS.toFixed(1)}%) · SORTED STRONGEST FIRST
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["#","TICKER","PRICE","TODAY","RS vs SPY","vs 50MA","vs 200MA","FROM 52W HIGH","VOL","STATUS","REMOVE"].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {wlMomentum.map((q, i) => (
                    <tr key={q.ticker} style={{ background: i % 2 === 0 ? C.s1 : C.bg, borderLeft: i < 5 ? `3px solid ${C.green}` : i < 12 ? `3px solid ${C.yellow}` : `3px solid ${C.b1}` }}>
                      <td style={{ ...TD, ...mono, color: C.dim }}>{i + 1}</td>
                      <td style={{ ...TD, ...cond, fontWeight: 700, fontSize: "15px", color: C.accent }}>{q.ticker}</td>
                      <td style={{ ...TD, ...mono }}>{q.price ? `$${q.price.toFixed(2)}` : "—"}</td>
                      <td style={{ ...TD, ...mono, color: (q.changePct ?? 0) >= 0 ? C.green : C.red }}>{q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"}</td>
                      <td style={{ ...TD, minWidth: "160px" }}>{q.rs != null ? <RSBar value={q.rs} /> : <span style={{ ...mono, color: C.dim, fontSize: "10px" }}>NO DATA</span>}</td>
                      <td style={TD}>{q.aboveMa50 != null ? <Pill color={q.aboveMa50 ? "green" : "red"} text={q.aboveMa50 ? "ABOVE" : "BELOW"} /> : "—"}</td>
                      <td style={TD}>{q.aboveMa200 != null ? <Pill color={q.aboveMa200 ? "green" : "red"} text={q.aboveMa200 ? "ABOVE" : "BELOW"} /> : "—"}</td>
                      <td style={{ ...TD, ...mono, color: q.pctFromHigh > -10 ? C.green : q.pctFromHigh > -25 ? C.yellow : C.red }}>{q.pctFromHigh != null ? `${q.pctFromHigh.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...TD, ...mono, color: q.volRatio > 1.5 ? C.green : q.volRatio < 0.7 ? C.red : C.dim }}>{q.volRatio ? `${q.volRatio.toFixed(1)}x` : "—"}</td>
                      <td style={TD}>{q.rs != null ? <Pill color={q.aboveMa50 && q.rs > 5 ? "green" : q.rs > 0 ? "yellow" : "red"} text={q.aboveMa50 && q.rs > 5 ? "ACTIVE" : q.rs > 0 ? "MONITOR" : "WEAK"} /> : "—"}</td>
                      <td style={TD}>
                        <button onClick={() => removeFromWL(q.ticker)} style={{ background: "rgba(255,68,68,0.08)", border: `1px solid rgba(255,68,68,0.2)`, color: C.red, padding: "3px 8px", cursor: "pointer", ...mono, fontSize: "10px" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── PORTFOLIO TAB ────────────────────────────────────────────── */}
          {tab === "portfolio" && (
            <div style={{ padding: "16px", background: C.s1 }}>
              <div style={{ ...lbl, marginBottom: "12px" }}>CURRENT HOLDINGS</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px" }}>
                <thead>
                  <tr>{["TICKER","SHARES","AVG COST","LIVE PRICE","MARKET VALUE","P&L $","P&L %","NOTE"].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {PORTFOLIO.map(pos => {
                    const q = quotes[pos.ticker];
                    const price = q?.price;
                    const mv = pos.shares && price ? pos.shares * price : null;
                    const pnl = pos.shares && pos.avgCost && price ? (price - pos.avgCost) * pos.shares : null;
                    const pnlPct = pos.avgCost && price ? ((price - pos.avgCost) / pos.avgCost) * 100 : null;
                    return (
                      <tr key={pos.ticker} style={{ background: C.bg }}>
                        <td style={{ ...TD, ...cond, fontWeight: 700, fontSize: "15px", color: C.accent }}>{pos.ticker}</td>
                        <td style={{ ...TD, ...mono }}>{pos.shares ?? "—"}</td>
                        <td style={{ ...TD, ...mono }}>{pos.avgCost ? `$${pos.avgCost}` : "—"}</td>
                        <td style={{ ...TD, ...mono }}>{price ? `$${price.toFixed(2)}` : "Loading..."}</td>
                        <td style={{ ...TD, ...mono }}>{mv ? `$${mv.toFixed(0)}` : "—"}</td>
                        <td style={{ ...TD, ...mono, color: pnl >= 0 ? C.green : C.red }}>{pnl != null ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}` : "—"}</td>
                        <td style={{ ...TD, ...mono, color: pnlPct >= 0 ? C.green : C.red }}>{pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}</td>
                        <td style={{ ...TD, fontSize: "11px", color: C.dim }}>{pos.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: "10px 14px", background: C.s2, border: `1px solid ${C.b2}`, ...mono, fontSize: "10px", color: C.dim, lineHeight: "1.9" }}>
                ⚠ NBIS share count and cost basis must be updated manually when you trim.<br />
                All orders must be placed manually in Futu. This system never executes trades.
              </div>
            </div>
          )}

          {/* ── ATR TAB ──────────────────────────────────────────────────── */}
          {tab === "atr" && (
            <div style={{ background: C.s1 }}>
              <ATRCalculator quotes={quotes} />
            </div>
          )}

          {/* FOOTER */}
          <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.b1}`, display: "flex", justifyContent: "space-between", ...mono, fontSize: "9px", color: "#1A3A5C", letterSpacing: "1px" }}>
            <span>QUANT MASTER V3.1 · NATHALIE'S TRADING COMMAND CENTER</span>
            <span>DATA: YAHOO FINANCE · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE · ALL ORDERS MANUAL IN FUTU</span>
          </div>
        </>
      )}
    </div>
  );
}
