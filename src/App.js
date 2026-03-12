import { useState, useEffect, useCallback } from "react";

// ─── UNIVERSE ─────────────────────────────────────────────────────────────────
const SCAN_UNIVERSE = {
  "AI / Semiconductors": ["NVDA","AMD","ARM","MRVL","ALAB","CRDO","ASML","LRCX","KLAC","AMAT","SMCI","TSM","AVGO","QCOM","MU","MPWR","ADI","TXN"],
  "AI Infrastructure / Data Centers": ["EQIX","DLR","DELL","HPE","VRT","ETN","PLTR","DDOG","SNOW","PANW","NET","CRWD","ZS","RDDT"],
  "Energy / Power": ["VST","CEG","NRG","AES","PCG","EXC","NEE","OKE","LNG","KMI","WMB","AEP","DUK","SO","NTR","ADM"],
  "Bitcoin Mining / Crypto": ["MARA","RIOT","CLSK","HUT","IREN","WULF","CIFR","COIN","HOOD","MSTR"],
  "Fintech / E-commerce": ["SQ","AFRM","UPST","NU","SOFI","PYPL","BILL","SHOP","MELI","SE","APP","TTD","CRCL"],
  "Defense / Aerospace": ["KTOS","AVAV","LMT","RTX","NOC","HII","LDOS","BWXT","RCAT"],
  "Consumer / Health / Other": ["NFLX","COST","WMT","HIMS","LULU","ONON","DECK","VIK","SNDK","LUMN","ONDS","SMTC"],
};
const ALL_SCAN_TICKERS = [...new Set(Object.values(SCAN_UNIVERSE).flat())];
const DEFAULT_WATCHLIST = ["NBIS","VST","IREN","SHOP","SOFI","WULF","LUMN","ONDS","CRCL","HIMS","VIK","NFLX","SNDK","ADM","NVDA","TSM","SMCI","VRT","AVGO","PLTR","ETN","COST","WMT","KTOS","AVAV"];
const PORTFOLIO = [
  { ticker: "NBIS", shares: null, avgCost: null, note: "Main position — trimming in progress" },
  { ticker: "NVDA", shares: 2, avgCost: 178, note: "Core holding" },
];

// ─── CACHE ────────────────────────────────────────────────────────────────────
const CACHE_KEY = "qm_data_v7";
const CACHE_DATE_KEY = "qm_date_v7";
const WL_KEY = "qm_wl_v7";
const PM_KEY = "qm_pm_v7";
const PM_DATE_KEY = "qm_pm_date_v7";
const getToday = () => new Date().toISOString().slice(0, 10);
const readCache = () => { try { if (localStorage.getItem(CACHE_DATE_KEY) !== getToday()) return null; const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const writeCache = (d) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); localStorage.setItem(CACHE_DATE_KEY, getToday()); } catch {} };
const readWL = () => { try { const r = localStorage.getItem(WL_KEY); return r ? JSON.parse(r) : [...DEFAULT_WATCHLIST]; } catch { return [...DEFAULT_WATCHLIST]; } };
const writeWL = (wl) => { try { localStorage.setItem(WL_KEY, JSON.stringify(wl)); } catch {} };
const readPM = () => { try { if (localStorage.getItem(PM_DATE_KEY) !== getToday()) return null; const r = localStorage.getItem(PM_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const writePM = (d) => { try { localStorage.setItem(PM_KEY, JSON.stringify(d)); localStorage.setItem(PM_DATE_KEY, getToday()); } catch {} };

// ─── FETCH HELPERS ────────────────────────────────────────────────────────────
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

const fetchJSON = async (url, attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(PROXIES[i % PROXIES.length](url), { signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 30) continue;
      return JSON.parse(text);
    } catch { continue; }
  }
  return null;
};

const parseChart = (data) => {
  const r = data?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  const closes = (q.close || q.closes || []).filter(Boolean);
  if (closes.length < 5) return null;
  const price = r.meta?.regularMarketPrice || closes[closes.length - 1];
  if (!price || price <= 0) return null;
  const prev = closes[closes.length - 2];
  const changePct = prev ? ((price - prev) / prev) * 100 : 0;
  return { price, changePct, closes, highs: q.high || [], lows: q.low || [], volumes: q.volume || [], meta: r.meta };
};

const fetchQuote = async (ticker) => {
  try {
    const data = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`);
    const p = parseChart(data);
    if (!p) return null;
    const { price, changePct, closes, highs, lows, volumes } = p;
    const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
    const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    const trs = [];
    for (let i = Math.max(1, highs.length - 14); i < highs.length; i++) {
      if (highs[i] && lows[i] && closes[i - 1]) trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    const atr = trs.length > 0 ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
    const ret3m = closes.length >= 63 ? ((price - closes[closes.length - 63]) / closes[closes.length - 63]) * 100 : ((price - closes[0]) / closes[0]) * 100;
    const w52High = Math.max(...closes); const w52Low = Math.min(...closes);
    const pctFromHigh = ((price - w52High) / w52High) * 100;
    const validVols = volumes.filter(Boolean);
    const avgVol = validVols.length >= 20 ? validVols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    const volRatio = avgVol && validVols[validVols.length - 1] ? validVols[validVols.length - 1] / avgVol : null;
    return { ticker, price, changePct, ma50, ma200, atr, ret3m, w52High, w52Low, pctFromHigh, volRatio };
  } catch { return null; }
};

// ─── PRE-MARKET FETCHERS ──────────────────────────────────────────────────────
const fetchSimple = async (symbol) => {
  const data = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
  const p = parseChart(data);
  return p ? { price: p.price, changePct: p.changePct } : null;
};

const fetchPreMarket = async () => {
  const [vix, t10y, dxy, nq, es, spy, qqq] = await Promise.allSettled([
    fetchSimple("%5EVIX"),
    fetchSimple("%5ETNX"),
    fetchSimple("DX-Y.NYB"),
    fetchSimple("NQ%3DF"),
    fetchSimple("ES%3DF"),
    fetchSimple("SPY"),
    fetchSimple("QQQ"),
  ]);
  const get = (r) => r.status === "fulfilled" ? r.value : null;
  return { vix: get(vix), t10y: get(t10y), dxy: get(dxy), nq: get(nq), es: get(es), spy: get(spy), qqq: get(qqq) };
};

// ─── PLAIN ENGLISH ────────────────────────────────────────────────────────────
const GREEN = "#00E87A"; const YELLOW = "#FFB800"; const RED = "#FF4455"; const DIM = "#5A8AAB";

const interpret = {
  futures: (nq, es) => {
    if (!nq && !es) return { color: DIM, emoji: "❓", text: "Futures data unavailable right now." };
    const parts = [];
    if (nq) parts.push(`Nasdaq futures ${nq.changePct >= 0 ? "+" : ""}${nq.changePct.toFixed(2)}%`);
    if (es) parts.push(`S&P futures ${es.changePct >= 0 ? "+" : ""}${es.changePct.toFixed(2)}%`);
    const avg = ((nq?.changePct || 0) + (es?.changePct || 0)) / (nq && es ? 2 : 1);
    const color = avg > 0.3 ? GREEN : avg < -0.3 ? RED : YELLOW;
    const note = avg > 0.3 ? "Market pointing UP at open. Good tone for buyers." : avg < -0.3 ? "Market pointing DOWN at open. Be careful with new buys today." : "Mixed signals before open. Wait and see.";
    return { color, emoji: avg > 0.3 ? "🟢" : avg < -0.3 ? "🔴" : "🟡", text: parts.join("  ·  ") + "  —  " + note };
  },
  regime: (spy) => {
    if (!spy) return { color: DIM, emoji: "❓", text: "SPY data unavailable.", regime: "—" };
    const regime = spy.price > (spy.ma200 || 0) ? "BULL" : "BEAR";
    if (!spy.ma50 && !spy.ma200) return { color: YELLOW, emoji: "🟡", text: `SPY $${spy.price?.toFixed(2)} — Moving averages still loading.`, regime };
    const a200 = spy.ma200 && spy.price > spy.ma200;
    const a50 = spy.ma50 && spy.price > spy.ma50;
    const color = a200 && a50 ? GREEN : a200 ? YELLOW : RED;
    const note = a200 && a50 ? "Above both 50MA & 200MA. Bull market confirmed. ✅ OK to be buying strong stocks."
      : a200 ? "Above 200MA but below 50MA. Bull trend intact but recent weakness. Be selective — only buy the strongest setups."
      : "Below 200MA. ⚠️ Bear market. Avoid new buys. Focus on capital protection.";
    return { color, emoji: color === GREEN ? "🟢" : color === YELLOW ? "🟡" : "🔴", text: `SPY $${spy.price?.toFixed(2)}  —  ${note}`, regime };
  },
  vix: (v) => {
    if (!v) return { color: DIM, emoji: "❓", text: "VIX unavailable. Check finance.yahoo.com/quote/%5EVIX manually." };
    const x = v.price;
    const dir = v.changePct > 1 ? ", rising ↑" : v.changePct < -1 ? ", falling ↓" : "";
    if (x < 15) return { color: GREEN, emoji: "🟢", text: `VIX ${x.toFixed(1)}${dir} — Very calm market. Excellent conditions to trade.` };
    if (x < 20) return { color: GREEN, emoji: "🟢", text: `VIX ${x.toFixed(1)}${dir} — Calm market. Normal conditions, proceed normally.` };
    if (x < 25) return { color: YELLOW, emoji: "🟡", text: `VIX ${x.toFixed(1)}${dir} — Mild nervousness in the market. Trade smaller position sizes.` };
    if (x < 35) return { color: YELLOW, emoji: "🟡", text: `VIX ${x.toFixed(1)}${dir} — Market is fearful. Be cautious. Reduce new position sizes.` };
    return { color: RED, emoji: "🔴", text: `VIX ${x.toFixed(1)}${dir} — HIGH FEAR. Avoid all new trades. Protect capital.` };
  },
  rates: (t10y, dxy) => {
    if (!t10y && !dxy) return { color: DIM, emoji: "❓", text: "10Y yield & DXY unavailable. Check them on TradingView or investing.com manually." };
    const parts = []; let warn = false;
    if (t10y) { const dir = t10y.changePct > 0.5 ? "rising fast ⚠️" : t10y.changePct > 0 ? "slightly up" : "falling ↓"; parts.push(`10Y yield ${t10y.price.toFixed(2)}% (${dir})`); if (t10y.changePct > 0.5) warn = true; }
    if (dxy) { const dir = dxy.changePct > 0.3 ? "strengthening ⚠️" : dxy.changePct > 0 ? "slightly up" : "weakening ↓"; parts.push(`DXY ${dxy.price.toFixed(1)} (${dir})`); if (dxy.changePct > 0.3) warn = true; }
    const color = warn ? YELLOW : GREEN;
    const note = warn ? "Rising yields or strong dollar can pressure tech and growth stocks. Be more selective today."
      : "Rates and dollar stable — no major headwind for your watchlist.";
    return { color, emoji: warn ? "🟡" : "🟢", text: parts.join("  ·  ") + "  —  " + note };
  },
  qqq: (q) => {
    if (!q) return { color: DIM, emoji: "❓", text: "QQQ data unavailable." };
    const dir = q.changePct >= 0 ? "up" : "down";
    const color = q.changePct > 1 ? GREEN : q.changePct > 0 ? GREEN : q.changePct > -1 ? YELLOW : RED;
    const note = q.changePct > 1 ? "Strong tech rally — great environment for AI/growth stocks."
      : q.changePct > 0 ? "Tech slightly positive — neutral to good for your watchlist."
      : q.changePct > -1 ? "Tech slightly weak — be patient, don't chase setups."
      : "Tech selling off — avoid new buys, wait for stabilisation.";
    return { color, emoji: color === GREEN ? "🟢" : color === YELLOW ? "🟡" : "🔴", text: `QQQ $${q.price?.toFixed(2)}, ${dir} ${Math.abs(q.changePct).toFixed(2)}% today  —  ${note}` };
  },
};

// ─── SCANNER ──────────────────────────────────────────────────────────────────
const passes = (q, spyRS) => q && q.ma50 && q.ma200 && q.price > q.ma50 && q.price > q.ma200 && (q.ret3m - spyRS) > 5 && q.pctFromHigh > -20;
const score = (q, spyRS) => (q.ret3m - spyRS) + (100 + q.pctFromHigh) * 0.25 + (q.volRatio > 1.5 ? 8 : 0);

// Unified rating — identical logic for scanner AND watchlist
// STRONG = above both MAs + RS >20% + near highs → best setups, consider buying
// WATCH  = above both MAs + RS positive → decent, wait for better entry or breakout
// SPEC   = above one MA, RS marginally positive → risky/speculative only
// WEAK   = below key MAs or negative RS → avoid, not a good setup right now
const getRating = (rs, aboveMa50, aboveMa200, pctFromHigh) => {
  if (rs == null) return { label: "—", color: "blue" };
  if (aboveMa50 && aboveMa200 && rs > 20 && pctFromHigh > -15) return { label: "STRONG", color: "green" };
  if (aboveMa50 && aboveMa200 && rs > 5)                       return { label: "WATCH",  color: "yellow" };
  if ((aboveMa50 || aboveMa200) && rs > 0)                     return { label: "SPEC",   color: "blue" };
  return { label: "WEAK", color: "red" };
};

// ─── DESIGN ───────────────────────────────────────────────────────────────────
const C = { bg: "#050A0E", s1: "#080F15", s2: "#0D1825", b1: "#0D1F2D", b2: "#1A3A5C", accent: "#00D4FF", green: GREEN, red: RED, yellow: YELLOW, dim: DIM, text: "#D8E8F0", bright: "#F0F8FF" };
const F = { base: "'DM Sans', sans-serif", mono: "'DM Mono', monospace" };
const lbl = { fontFamily: F.mono, fontSize: "12px", letterSpacing: "2px", color: C.dim, textTransform: "uppercase", marginBottom: "8px" };
const TH = { fontFamily: F.mono, fontSize: "12px", letterSpacing: "1px", color: C.dim, textTransform: "uppercase", padding: "14px 18px", textAlign: "left", borderBottom: `1px solid ${C.b1}`, background: C.s2, whiteSpace: "nowrap" };
const TD = { padding: "13px 18px", fontSize: "16px", borderBottom: `1px solid ${C.b1}`, whiteSpace: "nowrap", fontFamily: F.base };

const Pill = ({ color, text }) => {
  const m = { green: [C.green, "rgba(0,232,122,0.12)", "rgba(0,232,122,0.3)"], red: [C.red, "rgba(255,68,85,0.1)", "rgba(255,68,85,0.25)"], yellow: [C.yellow, "rgba(255,184,0,0.1)", "rgba(255,184,0,0.25)"], blue: [C.accent, "rgba(0,212,255,0.1)", "rgba(0,212,255,0.25)"] };
  const [fg, bg, border] = m[color] || m.blue;
  return <span style={{ display: "inline-block", padding: "5px 12px", borderRadius: "4px", fontSize: "13px", fontFamily: F.mono, fontWeight: 600, letterSpacing: "1px", background: bg, color: fg, border: `1px solid ${border}` }}>{text}</span>;
};

const RSBar = ({ value }) => {
  const capped = Math.max(0, Math.min(100, ((value + 20) / 80) * 100));
  const color = value > 15 ? C.green : value > 0 ? C.yellow : C.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
      <div style={{ flex: 1, height: "8px", background: C.b1, borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ width: `${capped}%`, height: "100%", background: color, transition: "width 0.8s ease", borderRadius: "4px" }} />
      </div>
      <span style={{ fontFamily: F.mono, fontSize: "14px", color, minWidth: "62px", textAlign: "right", fontWeight: 600 }}>
        {value > 0 ? "+" : ""}{value.toFixed(1)}%
      </span>
    </div>
  );
};

const BreadthGauge = ({ value }) => {
  const color = value >= 60 ? C.green : value >= 40 ? C.yellow : C.red;
  const angle = (value / 100) * 180 - 90;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 20px" }}>
      <svg width="170" height="96" viewBox="0 0 170 96">
        <path d="M12,88 A73,73 0 0,1 158,88" fill="none" stroke={C.b1} strokeWidth="14" strokeLinecap="round" />
        <path d="M12,88 A73,73 0 0,1 158,88" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(value / 100) * 230} 230`} style={{ transition: "stroke-dasharray 1s ease" }} />
        <line x1="85" y1="88" x2="85" y2="26" stroke={color} strokeWidth="3" strokeLinecap="round" transform={`rotate(${angle},85,88)`} />
        <circle cx="85" cy="88" r="5" fill={color} />
        <text x="5" y="96" fill={C.dim} fontSize="11" fontFamily={F.mono}>0%</text>
        <text x="140" y="96" fill={C.dim} fontSize="11" fontFamily={F.mono}>100%</text>
      </svg>
      <div style={{ fontFamily: F.base, fontSize: "46px", fontWeight: 800, color, lineHeight: 1, marginTop: "-6px" }}>{value.toFixed(0)}%</div>
      <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, letterSpacing: "2px", marginTop: "8px" }}>ABOVE 50-DAY MA</div>
    </div>
  );
};

// Spinner CSS injected once
const spinnerStyle = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;

// ─── PRE-MARKET PANEL ─────────────────────────────────────────────────────────
function PreMarketPanel({ spyQuote, qqqQuote }) {
  const [pm, setPm] = useState(null);
  const [pmLoading, setPmLoading] = useState(true);

  useEffect(() => {
    const cached = readPM();
    if (cached) { setPm(cached); setPmLoading(false); return; }
    fetchPreMarket().then(data => { writePM(data); setPm(data); setPmLoading(false); });
  }, []);

  // Build spy/qqq enriched from main quotes if pm doesn't have them
  const spy = pm?.spy || (spyQuote ? { price: spyQuote.price, changePct: spyQuote.changePct, ma50: spyQuote.ma50, ma200: spyQuote.ma200 } : null);
  const qqq = pm?.qqq || (qqqQuote ? { price: qqqQuote.price, changePct: qqqQuote.changePct, ma50: qqqQuote.ma50 } : null);

  const items = [
    { n: "1", title: "US Futures — Pre-Market Direction", info: interpret.futures(pm?.nq, pm?.es), loading: pmLoading },
    { n: "2", title: "Market Regime (SPX vs 200MA)", info: interpret.regime(spy), loading: !spy },
    { n: "3", title: "VIX — Fear Level", info: interpret.vix(pm?.vix), loading: pmLoading },
    { n: "4", title: "10Y Treasury + Dollar (DXY)", info: interpret.rates(pm?.t10y, pm?.dxy), loading: pmLoading },
    { n: "5", title: "QQQ — AI & Tech Bellwether", info: interpret.qqq(qqq), loading: !qqq },
    { n: "6", title: "NBIS + NVDA — News Check", info: { color: C.dim, emoji: "📰", text: "Check Futu app or Google Finance for any earnings, analyst upgrades, or news on your held stocks before placing any orders today." }, loading: false },
  ];

  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ ...lbl, marginBottom: "16px" }}>📋 Pre-Market Briefing — Read this BEFORE looking at individual stock prices</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {items.map(({ n, title, info, loading: isLoading }) => (
          <div key={n} style={{ display: "flex", gap: "14px", padding: "16px 18px", background: C.s2, border: `1px solid ${C.b1}`, borderRadius: "8px", borderLeft: `4px solid ${isLoading ? C.b2 : (info?.color || C.b2)}` }}>
            <div style={{ fontFamily: F.base, fontWeight: 800, fontSize: "28px", color: C.accent, lineHeight: 1, minWidth: "26px", paddingTop: "2px" }}>{n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F.mono, fontSize: "11px", color: C.dim, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>{title}</div>
              {isLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "14px", height: "14px", border: `2px solid ${C.b2}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ fontFamily: F.base, fontSize: "14px", color: C.dim }}>Fetching live data...</span>
                </div>
              ) : (
                <div style={{ fontFamily: F.base, fontSize: "15px", color: info?.color || C.dim, lineHeight: 1.6, fontWeight: 500 }}>
                  {info?.emoji}  {info?.text}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ATR CALCULATOR ──────────────────────────────────────────────────────────
function ATRCalculator({ quotes }) {
  const [ticker, setTicker] = useState("NVDA");
  const [account, setAccount] = useState("50000");
  const [riskPct, setRiskPct] = useState("2");
  const [useManualPrice, setUseManualPrice] = useState(false);
  const [manualPrice, setManualPrice] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const calc = async () => {
    setBusy(true); setRes(null);
    let q = quotes[ticker.toUpperCase()] || await fetchQuote(ticker.toUpperCase());
    if (!q?.atr) { setRes({ err: `Could not load ATR data for ${ticker.toUpperCase()}. Try again or check the ticker.` }); setBusy(false); return; }
    const entryPrice = useManualPrice && parseFloat(manualPrice) > 0 ? parseFloat(manualPrice) : q.price;
    const acc = parseFloat(account) || 50000;
    const risk = parseFloat(riskPct) / 100;
    const stop = entryPrice - 2 * q.atr;
    const t1 = entryPrice + 3 * q.atr;
    const t2 = entryPrice + 6 * q.atr;
    const rps = entryPrice - stop;
    const maxR = acc * risk;
    const shares = Math.floor(maxR / rps);
    const total = shares * entryPrice;
    const posPct = (total / acc) * 100;
    const rr = (t1 - entryPrice) / rps;
    setRes({ livePrice: q.price, entryPrice, atr: q.atr, stop, t1, t2, shares, total, posPct, rr, rps, maxR, ticker: ticker.toUpperCase(), usedManual: useManualPrice && parseFloat(manualPrice) > 0 });
    setBusy(false);
  };

  const inp = { background: C.s2, border: `1px solid ${C.b2}`, color: C.bright, padding: "14px 18px", fontFamily: F.base, fontSize: "17px", outline: "none", width: "100%", boxSizing: "border-box", borderRadius: "6px" };
  const checkStyle = { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontFamily: F.base, fontSize: "15px", color: C.dim, marginTop: "12px", userSelect: "none" };

  return (
    <div style={{ padding: "28px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "14px", alignItems: "start", marginBottom: "8px" }}>
        <div>
          <div style={lbl}>TICKER</div>
          <input style={inp} value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="e.g. NVDA" onKeyDown={e => e.key === "Enter" && calc()} />
        </div>
        <div>
          <div style={lbl}>ACCOUNT SIZE ($)</div>
          <input style={inp} value={account} onChange={e => setAccount(e.target.value)} type="number" />
        </div>
        <div>
          <div style={lbl}>RISK PER TRADE (%)</div>
          <input style={inp} value={riskPct} onChange={e => setRiskPct(e.target.value)} type="number" step="0.5" />
        </div>
        <div style={{ paddingTop: "28px" }}>
          <button onClick={calc} disabled={busy} style={{ background: C.accent, color: C.bg, border: "none", padding: "14px 30px", fontFamily: F.base, fontWeight: 700, fontSize: "17px", cursor: busy ? "not-allowed" : "pointer", borderRadius: "6px", height: "56px", whiteSpace: "nowrap" }}>
            {busy ? "..." : "Calculate"}
          </button>
        </div>
      </div>

      {/* Manual price toggle */}
      <div style={{ marginBottom: "24px" }}>
        <label style={checkStyle} onClick={() => setUseManualPrice(!useManualPrice)}>
          <div style={{ width: "20px", height: "20px", border: `2px solid ${useManualPrice ? C.accent : C.b2}`, borderRadius: "4px", background: useManualPrice ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0 }}>
            {useManualPrice && <span style={{ color: C.bg, fontSize: "13px", fontWeight: 700 }}>✓</span>}
          </div>
          Use a custom entry price instead of live price
        </label>
        {useManualPrice && (
          <div style={{ marginTop: "10px", maxWidth: "280px" }}>
            <div style={lbl}>MY ENTRY PRICE ($)</div>
            <input style={inp} value={manualPrice} onChange={e => setManualPrice(e.target.value)} type="number" step="0.01" placeholder="e.g. 185.50" />
          </div>
        )}
      </div>

      {res && !res.err && (
        <div style={{ background: C.s2, border: `1px solid ${C.b2}`, padding: "28px", borderRadius: "8px" }}>
          {res.usedManual && (
            <div style={{ marginBottom: "14px", padding: "10px 16px", background: "rgba(0,212,255,0.06)", border: `1px solid rgba(0,212,255,0.2)`, borderRadius: "6px", fontFamily: F.base, fontSize: "14px", color: C.accent }}>
              Using your custom entry price of ${res.entryPrice.toFixed(2)} (live price is ${res.livePrice.toFixed(2)})
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "2px", marginBottom: "24px" }}>
            {[["Entry Price", `$${res.entryPrice.toFixed(2)}`, C.accent],
              ["Stop Loss (−2 ATR)", `$${res.stop.toFixed(2)}`, C.red],
              ["Target 1 (+3 ATR)", `$${res.t1.toFixed(2)}`, C.green],
              ["Target 2 (+6 ATR)", `$${res.t2.toFixed(2)}`, C.green]].map(([l, v, col]) => (
              <div key={l} style={{ background: C.s1, padding: "18px 22px", borderRadius: "4px" }}>
                <div style={lbl}>{l}</div>
                <div style={{ fontFamily: F.base, fontSize: "30px", fontWeight: 800, color: col, marginTop: "6px" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px", marginBottom: "18px" }}>
            {[["Shares to Buy", res.shares, C.bright],
              ["Total Position", `$${res.total.toFixed(0)} (${res.posPct.toFixed(1)}%)`, res.posPct > 15 ? C.red : C.bright],
              ["Max Risk $", `$${res.maxR.toFixed(0)}`, C.red],
              ["Reward / Risk", `${res.rr.toFixed(1)} : 1`, res.rr >= 2 ? C.green : C.red]].map(([l, v, col]) => (
              <div key={l}>
                <div style={lbl}>{l}</div>
                <div style={{ fontFamily: F.base, fontSize: "28px", fontWeight: 800, color: col, marginTop: "6px" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "14px 18px", background: "rgba(0,212,255,0.05)", border: `1px solid rgba(0,212,255,0.15)`, borderRadius: "6px", fontFamily: F.base, fontSize: "15px", color: C.dim }}>
            ATR = ${res.atr.toFixed(2)}  ·  Risk per share = ${res.rps.toFixed(2)}  ·  {" "}
            <strong style={{ color: res.posPct > 15 ? C.red : res.rr < 2 ? C.red : C.green }}>
              {res.posPct > 15 ? "⚠ Position >15% of portfolio — reduce shares" : res.rr < 2 ? "⚠ Reward/risk below 2:1 — skip this trade" : "✓ Setup within your risk rules"}
            </strong>
          </div>
        </div>
      )}
      {res?.err && <div style={{ padding: "18px", background: "rgba(255,68,85,0.05)", border: `1px solid rgba(255,68,85,0.2)`, borderRadius: "6px", fontFamily: F.base, fontSize: "16px", color: C.red }}>{res.err}</div>}

      <div style={{ marginTop: "24px", fontFamily: F.base, fontSize: "15px", color: C.dim, lineHeight: "2.1" }}>
        💡 <strong style={{ color: C.text }}>ATR</strong> = Average True Range — how much the stock moves per day on average.<br />
        <strong style={{ color: C.text }}>Stop Loss</strong> = Entry − 2×ATR. Gives the stock breathing room without stopping you out too early.<br />
        <strong style={{ color: C.text }}>Target 1</strong> = Entry + 3×ATR = 3:1 reward vs risk. <strong style={{ color: C.text }}>Shares</strong> = (Account × Risk%) ÷ (Entry − Stop).
      </div>
    </div>
  );
}

// ─── SCAN PROGRESS ────────────────────────────────────────────────────────────
function ScanScreen({ done, total, current }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ padding: "70px 48px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", marginBottom: "12px" }}>
        <div style={{ width: "32px", height: "32px", border: `3px solid ${C.b2}`, borderTop: `3px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
        <div style={{ fontFamily: F.base, fontSize: "36px", fontWeight: 800, color: C.accent }}>Scanning Market...</div>
      </div>
      <div style={{ fontFamily: F.mono, fontSize: "14px", color: C.dim, letterSpacing: "2px", marginBottom: "40px" }}>RUNS ONCE PER DAY · CACHED UNTIL MIDNIGHT · {total} STOCKS</div>
      <div style={{ maxWidth: "560px", margin: "0 auto 16px" }}>
        <div style={{ height: "10px", background: C.b1, borderRadius: "5px", overflow: "hidden", marginBottom: "12px" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: C.accent, transition: "width 0.4s ease", borderRadius: "5px" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: "14px", color: C.dim }}>
          <span>{done} / {total} stocks</span>
          <span style={{ color: C.accent, fontWeight: 700 }}>{pct}%</span>
        </div>
      </div>
      {current && <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim, marginBottom: "40px" }}>Fetching: {current}</div>}
    </div>
  );
}

// ─── LOADING INDICATOR for scanner tab ───────────────────────────────────────
function ScanLoadingBadge({ loading, done, total }) {
  if (!loading) return null;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(0,212,255,0.08)", border: `1px solid rgba(0,212,255,0.2)`, borderRadius: "20px", padding: "4px 12px 4px 8px", marginLeft: "8px" }}>
      <div style={{ width: "12px", height: "12px", border: `2px solid rgba(0,212,255,0.3)`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
      <span style={{ fontFamily: F.mono, fontSize: "11px", color: C.accent }}>{pct}%</span>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [scanDone, setScanDone] = useState(0);
  const [scanCurrent, setScanCurrent] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab, setTab] = useState("premarket");
  const [watchlist, setWatchlist] = useState(readWL);
  const [addedSet, setAddedSet] = useState(new Set());

  const allTickers = [...new Set([...ALL_SCAN_TICKERS, "SPY", "QQQ", "NBIS", ...watchlist])];

  const runScan = useCallback(async (force = false) => {
    setLoading(true); setScanDone(0); setScanCurrent("");
    if (!force) {
      const cached = readCache();
      if (cached) { setQuotes(cached); setFromCache(true); setLastUpdated(new Date()); setLoading(false); return; }
    }
    setFromCache(false);
    const results = {};
    // Priority first: SPY, QQQ, portfolio tickers, then watchlist
    const priority = ["SPY", "QQQ", "NBIS", "NVDA", ...watchlist.slice(0, 8)];
    for (const t of priority) {
      const q = await fetchQuote(t);
      if (q) { results[t] = q; setQuotes(prev => ({ ...prev, [t]: q })); }
      setScanDone(prev => prev + 1);
      await new Promise(r => setTimeout(r, 150));
    }
    // Remaining in batches of 2 (slower = more reliable)
    const remaining = allTickers.filter(t => !priority.includes(t));
    const batches = [];
    for (let i = 0; i < remaining.length; i += 2) batches.push(remaining.slice(i, i + 2));
    for (const batch of batches) {
      setScanCurrent(batch.join(", "));
      const fetched = await Promise.all(batch.map(fetchQuote));
      fetched.forEach((q, i) => { if (q) { results[batch[i]] = q; setQuotes(prev => ({ ...prev, [batch[i]]: q })); } });
      setScanDone(prev => prev + batch.length);
      await new Promise(r => setTimeout(r, 500));
    }
    writeCache(results);
    setLastUpdated(new Date());
    setLoading(false);
  }, [watchlist]);

  useEffect(() => { runScan(); }, []);

  const addToWL = (ticker) => { if (watchlist.includes(ticker)) return; const u = [...watchlist, ticker]; setWatchlist(u); writeWL(u); setAddedSet(p => new Set([...p, ticker])); };
  const removeFromWL = (ticker) => { const u = watchlist.filter(t => t !== ticker); setWatchlist(u); writeWL(u); };

  const spy = quotes["SPY"]; const qqq = quotes["QQQ"];
  const spyRS = spy?.ret3m || 0;
  const wlQ = watchlist.map(t => quotes[t]).filter(Boolean);
  const above50 = wlQ.filter(q => q.ma50 && q.price > q.ma50).length;
  const breadth = wlQ.length > 0 ? (above50 / wlQ.length) * 100 : 0;
  const regime = spy ? (spy.ma200 && spy.price > spy.ma200 ? "BULL" : "BEAR") : "—";
  const regimeColor = regime === "BULL" ? C.green : regime === "BEAR" ? C.red : C.yellow;

  const wlMomentum = watchlist.map(t => {
    const q = quotes[t];
    if (!q) return { ticker: t, rs: null, price: null };
    const rs = q.ret3m - spyRS;
    const aboveMa50 = !!(q.ma50 && q.price > q.ma50);
    const aboveMa200 = !!(q.ma200 && q.price > q.ma200);
    const sc = score(q, spyRS);
    return { ...q, rs, aboveMa50, aboveMa200, sc };
  }).sort((a, b) => (b.sc ?? -999) - (a.sc ?? -999));

  const scanByTheme = {}; let totalHits = 0;
  Object.entries(SCAN_UNIVERSE).forEach(([theme, tickers]) => {
    const hits = tickers.map(t => quotes[t]).filter(q => q && passes(q, spyRS) && !watchlist.includes(q.ticker))
      .map(q => ({ ...q, rs: q.ret3m - spyRS, sc: score(q, spyRS) })).sort((a, b) => b.sc - a.sc);
    if (hits.length > 0) { scanByTheme[theme] = hits; totalHits += hits.length; }
  });

  const TABS = [
    ["premarket", "🌅  Pre-Market"],
    ["scanner", "🔍  Scanner"],
    ["watchlist", "📈  Watchlist"],
    ["portfolio", "💼  Portfolio"],
    ["atr", "🎯  ATR Calculator"],
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: F.base }}>
      <style>{spinnerStyle}</style>

      {/* HEADER */}
      <div style={{ background: C.s2, borderBottom: `2px solid ${C.b2}`, padding: "20px 30px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: F.base, fontSize: "26px", fontWeight: 800, color: C.accent }}>⬡ QUANT MASTER V3.1</div>
          <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, letterSpacing: "2px", marginTop: "4px" }}>NATHALIE'S COMMAND CENTER · {ALL_SCAN_TICKERS.length}+ STOCKS SCANNED DAILY</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {fromCache && <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, background: C.s1, padding: "8px 14px", borderRadius: "6px", border: `1px solid ${C.b1}` }}>✓ Cached · Next scan tomorrow</div>}
          <button onClick={() => runScan(true)} disabled={loading} style={{ background: "transparent", color: C.accent, border: `1px solid ${C.b2}`, padding: "10px 20px", fontFamily: F.base, fontWeight: 600, fontSize: "15px", cursor: loading ? "not-allowed" : "pointer", borderRadius: "6px" }}>
            ↻ Force Rescan
          </button>
          {lastUpdated && <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, textAlign: "right" }}>
            <div>{lastUpdated.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
            <div>{lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>}
        </div>
      </div>

      {loading && scanDone < 4 ? <ScanScreen done={scanDone} total={allTickers.length} current={scanCurrent} /> : (
        <>
          {/* METRICS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "2px", background: C.b1 }}>
            {[
              ["Market Regime", regime, regimeColor, spy ? `SPY $${spy.price?.toFixed(2)}` : "Loading..."],
              ["Watchlist vs 50MA", wlQ.length > 0 ? `${breadth.toFixed(0)}%` : "—", breadth >= 60 ? C.green : breadth >= 40 ? C.yellow : C.red, `${above50} of ${wlQ.length} stocks loaded`],
              ["Scanner Ideas", loading ? "..." : totalHits, totalHits > 5 ? C.green : totalHits > 0 ? C.yellow : C.red, "passing all 4 filters"],
              ["QQQ Today", qqq ? `$${qqq.price?.toFixed(2)}` : "Loading...", qqq?.changePct >= 0 ? C.green : C.red, qqq ? `${qqq.changePct >= 0 ? "+" : ""}${qqq.changePct?.toFixed(2)}% · AI & tech bellwether` : "Fetching..."],
            ].map(([l, v, col, sub]) => (
              <div key={l} style={{ background: C.s1, padding: "22px 26px" }}>
                <div style={lbl}>{l}</div>
                <div style={{ fontFamily: F.base, fontSize: "40px", fontWeight: 800, color: col, lineHeight: 1, marginTop: "6px" }}>{v}</div>
                <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim, marginTop: "8px" }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* BREADTH + PRE-MARKET */}
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "2px", background: C.b1 }}>
            <div style={{ background: C.s1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BreadthGauge value={wlQ.length > 0 ? breadth : 0} />
            </div>
            <div style={{ background: C.s1 }}>
              <PreMarketPanel spyQuote={spy} qqqQuote={qqq} />
            </div>
          </div>

          {/* TABS */}
          <div style={{ display: "flex", gap: "2px", background: C.b1 }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{ padding: "16px 24px", border: "none", cursor: "pointer", fontFamily: F.base, fontWeight: tab === id ? 700 : 500, fontSize: "16px", background: tab === id ? C.s1 : C.bg, color: tab === id ? C.accent : C.dim, borderBottom: tab === id ? `3px solid ${C.accent}` : "3px solid transparent", display: "flex", alignItems: "center" }}>
                {label}
                {id === "scanner" && <ScanLoadingBadge loading={loading} done={scanDone} total={allTickers.length} />}
              </button>
            ))}
          </div>

          {/* SCANNER TAB */}
          {tab === "scanner" && (
            <div style={{ background: C.s1 }}>
              <div style={{ padding: "14px 22px", background: C.s2, borderBottom: `1px solid ${C.b1}`, display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim }}>4 FILTERS: ① Above 50MA  ② Above 200MA  ③ RS vs SPY &gt;+5%  ④ Within 20% of 52W high</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: "18px" }}>
                  {[["STRONG = best setup", C.green], ["WATCH = decent", C.yellow], ["SPEC = risky", C.accent]].map(([l, col]) => (
                    <span key={l} style={{ fontFamily: F.mono, fontSize: "12px", color: col }}>● {l}</span>
                  ))}
                </div>
              </div>
              {loading && <div style={{ padding: "20px 22px", display: "flex", alignItems: "center", gap: "12px", borderBottom: `1px solid ${C.b1}`, background: "rgba(0,212,255,0.03)" }}>
                <div style={{ width: "16px", height: "16px", border: `2px solid ${C.b2}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                <span style={{ fontFamily: F.base, fontSize: "14px", color: C.dim }}>Still loading more stocks in the background... results will update automatically.</span>
              </div>}
              {totalHits === 0 && !loading ? (
                <div style={{ padding: "60px", textAlign: "center", fontFamily: F.base, fontSize: "18px", color: C.dim }}>No stocks passing all filters right now. Market conditions are challenging — it's OK to stay in cash.</div>
              ) : Object.entries(scanByTheme).map(([theme, stocks]) => (
                <div key={theme}>
                  <div style={{ padding: "12px 22px", background: "rgba(0,212,255,0.04)", borderTop: `1px solid ${C.b1}`, borderBottom: `1px solid ${C.b1}`, display: "flex", gap: "12px", alignItems: "center" }}>
                    <span style={{ fontFamily: F.base, fontSize: "16px", fontWeight: 700, color: C.accent }}>{theme}</span>
                    <span style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim }}>{stocks.length} idea{stocks.length !== 1 ? "s" : ""}</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Ticker","Price","Today","RS vs SPY","Score","vs 50MA","vs 200MA","From High","Vol","Rating","Action"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {stocks.map((q, i) => {
                        const isOn = addedSet.has(q.ticker) || watchlist.includes(q.ticker);
                        const { label: rating, color: rCol } = getRating(q.rs, true, true, q.pctFromHigh);
                        return (
                          <tr key={q.ticker} style={{ background: i % 2 === 0 ? C.s1 : C.bg, borderLeft: `4px solid ${rCol === "green" ? C.green : rCol === "yellow" ? C.yellow : rCol === "red" ? C.red : C.accent}` }}>
                            <td style={{ ...TD, fontFamily: F.base, fontWeight: 800, fontSize: "18px", color: C.accent }}>{q.ticker}</td>
                            <td style={{ ...TD, fontFamily: F.mono }}>${q.price?.toFixed(2)}</td>
                            <td style={{ ...TD, fontFamily: F.mono, color: q.changePct >= 0 ? C.green : C.red, fontWeight: 600 }}>{q.changePct >= 0 ? "+" : ""}{q.changePct?.toFixed(2)}%</td>
                            <td style={{ ...TD, minWidth: "170px" }}><RSBar value={q.rs} /></td>
                            <td style={{ ...TD, fontFamily: F.mono }}>{q.sc?.toFixed(0)}</td>
                            <td style={TD}><Pill color="green" text="ABOVE" /></td>
                            <td style={TD}><Pill color="green" text="ABOVE" /></td>
                            <td style={{ ...TD, fontFamily: F.mono, color: q.pctFromHigh > -10 ? C.green : q.pctFromHigh > -20 ? C.yellow : C.red, fontWeight: 600 }}>{q.pctFromHigh?.toFixed(1)}%</td>
                            <td style={{ ...TD, fontFamily: F.mono, color: q.volRatio > 1.5 ? C.green : q.volRatio < 0.7 ? C.red : C.dim }}>{q.volRatio ? `${q.volRatio.toFixed(1)}x` : "—"}</td>
                            <td style={TD}><Pill color={rCol} text={rating} /></td>
                            <td style={TD}>{isOn ? <span style={{ fontFamily: F.mono, fontSize: "13px", color: C.green }}>✓ On watchlist</span> : <button onClick={() => addToWL(q.ticker)} style={{ background: "rgba(0,232,122,0.1)", border: `1px solid rgba(0,232,122,0.3)`, color: C.green, padding: "7px 16px", cursor: "pointer", fontFamily: F.base, fontWeight: 600, fontSize: "14px", borderRadius: "4px" }}>+ Add</button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* WATCHLIST TAB */}
          {tab === "watchlist" && (
            <div style={{ background: C.s1 }}>
              <div style={{ padding: "14px 22px", background: C.s2, borderBottom: `1px solid ${C.b1}`, fontFamily: F.mono, fontSize: "13px", color: C.dim, display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
                <span>Sorted by strength score (best setup first) · SPY baseline: {spyRS > 0 ? "+" : ""}{spyRS.toFixed(1)}% · {loading ? "Still loading..." : `${wlQ.length}/${watchlist.length} loaded`}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: "18px" }}>
                  {[["STRONG = best setup", C.green], ["WATCH = decent", C.yellow], ["SPEC = risky", C.accent], ["WEAK = avoid", C.red]].map(([l, col]) => (
                    <span key={l} style={{ color: col }}>● {l}</span>
                  ))}
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["#","Ticker","Price","Today","RS vs SPY","vs 50MA","vs 200MA","From High","Vol","Rating","Remove"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {wlMomentum.map((q, i) => {
                    const { label: rating, color: rCol } = getRating(q.rs, q.aboveMa50, q.aboveMa200, q.pctFromHigh);
                    const borderCol = rCol === "green" ? C.green : rCol === "yellow" ? C.yellow : rCol === "red" ? C.red : C.b1;
                    return (
                    <tr key={q.ticker} style={{ background: i % 2 === 0 ? C.s1 : C.bg, borderLeft: `4px solid ${borderCol}` }}>
                      <td style={{ ...TD, fontFamily: F.mono, color: C.dim }}>{i + 1}</td>
                      <td style={{ ...TD, fontFamily: F.base, fontWeight: 800, fontSize: "18px", color: C.accent }}>{q.ticker}</td>
                      <td style={{ ...TD, fontFamily: F.mono }}>{q.price ? `$${q.price.toFixed(2)}` : <span style={{ color: C.dim, fontSize: "14px" }}>Loading...</span>}</td>
                      <td style={{ ...TD, fontFamily: F.mono, color: (q.changePct ?? 0) >= 0 ? C.green : C.red, fontWeight: 600 }}>{q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"}</td>
                      <td style={{ ...TD, minWidth: "180px" }}>{q.rs != null ? <RSBar value={q.rs} /> : <span style={{ fontFamily: F.mono, color: C.dim, fontSize: "13px" }}>Loading...</span>}</td>
                      <td style={TD}>{q.aboveMa50 != null ? <Pill color={q.aboveMa50 ? "green" : "red"} text={q.aboveMa50 ? "ABOVE" : "BELOW"} /> : "—"}</td>
                      <td style={TD}>{q.aboveMa200 != null ? <Pill color={q.aboveMa200 ? "green" : "red"} text={q.aboveMa200 ? "ABOVE" : "BELOW"} /> : "—"}</td>
                      <td style={{ ...TD, fontFamily: F.mono, color: q.pctFromHigh > -10 ? C.green : q.pctFromHigh > -25 ? C.yellow : C.red, fontWeight: 600 }}>{q.pctFromHigh != null ? `${q.pctFromHigh.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...TD, fontFamily: F.mono, color: q.volRatio > 1.5 ? C.green : q.volRatio < 0.7 ? C.red : C.dim }}>{q.volRatio ? `${q.volRatio.toFixed(1)}x` : "—"}</td>
                      <td style={TD}>{q.rs != null ? <Pill color={rCol} text={rating} /> : "—"}</td>
                      <td style={TD}><button onClick={() => removeFromWL(q.ticker)} style={{ background: "rgba(255,68,85,0.08)", border: `1px solid rgba(255,68,85,0.2)`, color: C.red, padding: "7px 14px", cursor: "pointer", fontFamily: F.base, fontWeight: 600, fontSize: "14px", borderRadius: "4px" }}>✕ Remove</button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* PORTFOLIO TAB */}
          {tab === "portfolio" && (
            <div style={{ padding: "28px", background: C.s1 }}>
              <div style={{ ...lbl, marginBottom: "18px" }}>Current Holdings</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
                <thead><tr>{["Ticker","Shares","Avg Cost","Live Price","Market Value","P&L $","P&L %","Note"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {PORTFOLIO.map(pos => {
                    const q = quotes[pos.ticker];
                    const price = q?.price;
                    const mv = pos.shares && price ? pos.shares * price : null;
                    const pnl = pos.shares && pos.avgCost && price ? (price - pos.avgCost) * pos.shares : null;
                    const pnlPct = pos.avgCost && price ? ((price - pos.avgCost) / pos.avgCost) * 100 : null;
                    return (
                      <tr key={pos.ticker} style={{ background: C.bg }}>
                        <td style={{ ...TD, fontFamily: F.base, fontWeight: 800, fontSize: "18px", color: C.accent }}>{pos.ticker}</td>
                        <td style={{ ...TD, fontFamily: F.mono }}>{pos.shares ?? "—"}</td>
                        <td style={{ ...TD, fontFamily: F.mono }}>{pos.avgCost ? `$${pos.avgCost}` : "—"}</td>
                        <td style={{ ...TD, fontFamily: F.mono }}>{price ? `$${price.toFixed(2)}` : <span style={{ color: C.dim }}>Loading...</span>}</td>
                        <td style={{ ...TD, fontFamily: F.mono }}>{mv ? `$${mv.toFixed(0)}` : "—"}</td>
                        <td style={{ ...TD, fontFamily: F.mono, color: pnl >= 0 ? C.green : C.red, fontWeight: 600 }}>{pnl != null ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}` : "—"}</td>
                        <td style={{ ...TD, fontFamily: F.mono, color: pnlPct >= 0 ? C.green : C.red, fontWeight: 600 }}>{pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}</td>
                        <td style={{ ...TD, fontSize: "14px", color: C.dim }}>{pos.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: "16px 20px", background: C.s2, border: `1px solid ${C.b2}`, borderRadius: "8px", fontFamily: F.base, fontSize: "15px", color: C.dim, lineHeight: "2" }}>
                ⚠ Update NBIS shares and avg cost manually each time you trim a position.<br />
                All orders must be placed manually in Futu. This system never executes trades.
              </div>
            </div>
          )}

          {/* ATR TAB */}
          {tab === "atr" && <div style={{ background: C.s1 }}><ATRCalculator quotes={quotes} /></div>}

          {/* FOOTER */}
          <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.b1}`, display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: "12px", color: "#1A3A5C" }}>
            <span>QUANT MASTER V3.1 · NATHALIE'S TRADING COMMAND CENTER</span>
            <span>DATA: YAHOO FINANCE · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE · ALL ORDERS MANUAL IN FUTU</span>
          </div>
        </>
      )}
    </div>
  );
}
