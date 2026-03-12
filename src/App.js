import { useState, useEffect, useCallback } from "react";

// ─── SCAN UNIVERSE ────────────────────────────────────────────────────────────
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

const DEFAULT_WATCHLIST = [
  "NBIS","VST","IREN","SHOP","SOFI","WULF","LUMN","ONDS","CRCL","HIMS",
  "VIK","NFLX","SNDK","ADM","NVDA","TSM","SMCI","VRT","AVGO","PLTR",
  "ETN","COST","WMT","KTOS","AVAV"
];

const PORTFOLIO = [
  { ticker: "NBIS", shares: null, avgCost: null, note: "Main position — trimming in progress" },
  { ticker: "NVDA", shares: 2, avgCost: 178, note: "Core holding" },
];

// ─── CACHE ────────────────────────────────────────────────────────────────────
const CACHE_KEY = "qm_data_v5";
const CACHE_DATE_KEY = "qm_date_v5";
const WL_KEY = "qm_watchlist_v5";
const PM_CACHE_KEY = "qm_premarket_v5";
const PM_DATE_KEY = "qm_premarket_date_v5";
const getTodayStr = () => new Date().toISOString().slice(0, 10);

const readCache = () => {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== getTodayStr()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const writeCache = (d) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); localStorage.setItem(CACHE_DATE_KEY, getTodayStr()); } catch {}
};
const readWL = () => {
  try { const r = localStorage.getItem(WL_KEY); return r ? JSON.parse(r) : [...DEFAULT_WATCHLIST]; } catch { return [...DEFAULT_WATCHLIST]; }
};
const writeWL = (wl) => { try { localStorage.setItem(WL_KEY, JSON.stringify(wl)); } catch {} };
const readPMCache = () => {
  try {
    if (localStorage.getItem(PM_DATE_KEY) !== getTodayStr()) return null;
    const raw = localStorage.getItem(PM_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const writePMCache = (d) => {
  try { localStorage.setItem(PM_CACHE_KEY, JSON.stringify(d)); localStorage.setItem(PM_DATE_KEY, getTodayStr()); } catch {}
};

// ─── FETCH WITH MULTIPLE PROXIES + RETRY ──────────────────────────────────────
const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

const fetchWithRetry = async (url, maxAttempts = 3) => {
  for (let i = 0; i < maxAttempts; i++) {
    const proxy = PROXIES[i % PROXIES.length];
    try {
      const res = await fetch(proxy(url), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 50) continue;
      return JSON.parse(text);
    } catch { continue; }
  }
  return null;
};

const fetchQuote = async (ticker) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    const data = await fetchWithRetry(url);
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const q = r.indicators?.quote?.[0] || {};
    const closes = (q.close || q.closes || []).filter(Boolean);
    const highs = q.high || [];
    const lows = q.low || [];
    const volumes = q.volume || [];
    if (closes.length < 10) return null;
    const price = r.meta?.regularMarketPrice || closes[closes.length - 1];
    if (!price || price <= 0) return null;
    const prev = closes[closes.length - 2];
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
    const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    const trs = [];
    for (let i = Math.max(1, highs.length - 14); i < highs.length; i++) {
      if (highs[i] && lows[i] && closes[i - 1])
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    const atr = trs.length > 0 ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
    const ret3m = closes.length >= 63 ? ((price - closes[closes.length - 63]) / closes[closes.length - 63]) * 100
      : ((price - closes[0]) / closes[0]) * 100;
    const w52High = Math.max(...closes);
    const w52Low = Math.min(...closes);
    const pctFromHigh = ((price - w52High) / w52High) * 100;
    const validVols = volumes.filter(Boolean);
    const avgVol = validVols.length >= 20 ? validVols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    const todayVol = validVols[validVols.length - 1] || null;
    const volRatio = avgVol && todayVol ? todayVol / avgVol : null;
    return { ticker, price, changePct, ma50, ma200, atr, ret3m, w52High, w52Low, pctFromHigh, volRatio };
  } catch { return null; }
};

// ─── PRE-MARKET DATA FETCHERS ─────────────────────────────────────────────────
const fetchVIX = async () => {
  try {
    const data = await fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d");
    const r = data?.chart?.result?.[0];
    const closes = r?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const price = r?.meta?.regularMarketPrice || closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return price ? { price, changePct } : null;
  } catch { return null; }
};

const fetchYield10Y = async () => {
  try {
    const data = await fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d");
    const r = data?.chart?.result?.[0];
    const closes = r?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const price = r?.meta?.regularMarketPrice || closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return price ? { price, changePct } : null;
  } catch { return null; }
};

const fetchDXY = async () => {
  try {
    const data = await fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d");
    const r = data?.chart?.result?.[0];
    const closes = r?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const price = r?.meta?.regularMarketPrice || closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return price ? { price, changePct } : null;
  } catch { return null; }
};

const fetchFutures = async () => {
  try {
    const [nqData, esData] = await Promise.all([
      fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=1d&range=5d"),
      fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=1d&range=5d"),
    ]);
    const getChg = (data) => {
      const r = data?.chart?.result?.[0];
      const closes = r?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
      const price = r?.meta?.regularMarketPrice || closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      return price && prev ? ((price - prev) / prev) * 100 : null;
    };
    return { nq: getChg(nqData), es: getChg(esData) };
  } catch { return null; }
};

// ─── PLAIN ENGLISH SUMMARIES ──────────────────────────────────────────────────
const vixSummary = (vix) => {
  if (!vix) return { text: "VIX unavailable", color: "#5A8AAB", emoji: "❓" };
  const v = vix.price;
  const dir = vix.changePct > 0 ? "↑ rising" : "↓ falling";
  if (v < 15) return { text: `VIX ${v.toFixed(1)} (${dir}) — Very calm market. Good conditions to trade.`, color: "#00E87A", emoji: "🟢" };
  if (v < 20) return { text: `VIX ${v.toFixed(1)} (${dir}) — Calm market. Normal conditions.`, color: "#00E87A", emoji: "🟢" };
  if (v < 25) return { text: `VIX ${v.toFixed(1)} (${dir}) — Mild nervousness. Trade smaller sizes.`, color: "#FFB800", emoji: "🟡" };
  if (v < 35) return { text: `VIX ${v.toFixed(1)} (${dir}) — Market is fearful. Be very cautious, reduce exposure.`, color: "#FFB800", emoji: "🟡" };
  return { text: `VIX ${v.toFixed(1)} (${dir}) — HIGH FEAR. Avoid new trades. Protect capital.`, color: "#FF4455", emoji: "🔴" };
};

const yieldSummary = (y10, dxy) => {
  if (!y10 && !dxy) return { text: "10Y yield & DXY unavailable", color: "#5A8AAB", emoji: "❓" };
  const parts = [];
  let color = "#00E87A";
  if (y10) {
    const dir = y10.changePct > 0.5 ? "rising fast ⚠️" : y10.changePct > 0 ? "slightly up" : "falling";
    parts.push(`10Y yield ${y10.price.toFixed(2)}% (${dir})`);
    if (y10.changePct > 0.5) color = "#FFB800";
  }
  if (dxy) {
    const dir = dxy.changePct > 0.3 ? "strong dollar ⚠️" : dxy.changePct > 0 ? "slightly stronger" : "weaker";
    parts.push(`DXY ${dxy.price.toFixed(1)} (${dir})`);
    if (dxy.changePct > 0.3 && color === "#00E87A") color = "#FFB800";
  }
  const warning = (y10?.changePct > 0.5 || dxy?.changePct > 0.3)
    ? " — Rising yields/dollar can pressure growth & tech stocks."
    : " — Stable conditions, no major headwinds from rates or dollar.";
  return { text: parts.join(" · ") + warning, color, emoji: color === "#00E87A" ? "🟢" : "🟡" };
};

const futuresSummary = (futures) => {
  if (!futures || (futures.nq == null && futures.es == null)) return { text: "Futures data unavailable", color: "#5A8AAB", emoji: "❓" };
  const parts = [];
  let bullish = 0, bearish = 0;
  if (futures.nq != null) {
    parts.push(`Nasdaq futures ${futures.nq >= 0 ? "+" : ""}${futures.nq.toFixed(2)}%`);
    futures.nq > 0 ? bullish++ : bearish++;
  }
  if (futures.es != null) {
    parts.push(`S&P futures ${futures.es >= 0 ? "+" : ""}${futures.es.toFixed(2)}%`);
    futures.es > 0 ? bullish++ : bearish++;
  }
  let color, note;
  if (bullish > bearish) { color = "#00E87A"; note = " — Market pointing UP at open. Positive tone."; }
  else if (bearish > bullish) { color = "#FF4455"; note = " — Market pointing DOWN at open. Be careful with new buys."; }
  else { color = "#FFB800"; note = " — Mixed signals. Wait and see."; }
  return { text: parts.join(" · ") + note, color, emoji: bullish > bearish ? "🟢" : bearish > bullish ? "🔴" : "🟡" };
};

const regimeSummary = (spy, spyRS) => {
  if (!spy) return { text: "SPY data unavailable", color: "#5A8AAB", emoji: "❓", regime: "—" };
  const aboveMa200 = spy.ma200 && spy.price > spy.ma200;
  const aboveMa50 = spy.ma50 && spy.price > spy.ma50;
  const regime = aboveMa200 ? "BULL" : "BEAR";
  let text, color;
  if (aboveMa200 && aboveMa50) {
    color = "#00E87A";
    text = `SPY $${spy.price.toFixed(2)} — Above both 50MA & 200MA. Bull market confirmed. ✅ It's OK to be buying stocks.`;
  } else if (aboveMa200 && !aboveMa50) {
    color = "#FFB800";
    text = `SPY $${spy.price.toFixed(2)} — Above 200MA but below 50MA. Bull trend intact but recent weakness. Be selective.`;
  } else {
    color = "#FF4455";
    text = `SPY $${spy.price.toFixed(2)} — Below 200MA. Bear market conditions. ⚠️ Avoid new buys. Protect capital.`;
  }
  return { text, color, emoji: color === "#00E87A" ? "🟢" : color === "#FFB800" ? "🟡" : "🔴", regime };
};

const qqqSummary = (qqq) => {
  if (!qqq) return { text: "QQQ data unavailable", color: "#5A8AAB", emoji: "❓" };
  const dir = qqq.changePct >= 0 ? "up" : "down";
  const absMa50 = qqq.ma50 && qqq.price > qqq.ma50;
  let color, note;
  if (qqq.changePct > 1) { color = "#00E87A"; note = "Strong tech rally today — good environment for AI/growth stocks."; }
  else if (qqq.changePct > 0) { color = "#00E87A"; note = "Tech slightly positive. Neutral to good for your watchlist."; }
  else if (qqq.changePct > -1) { color = "#FFB800"; note = "Tech slightly weak. Be patient, don't chase setups."; }
  else { color = "#FF4455"; note = "Tech selling off. Avoid new buys today, wait for stabilisation."; }
  return { text: `QQQ $${qqq.price.toFixed(2)}, ${dir} ${Math.abs(qqq.changePct).toFixed(2)}% today${absMa50 ? "" : " (below 50MA ⚠️)"}. ${note}`, color, emoji: color === "#00E87A" ? "🟢" : color === "#FFB800" ? "🟡" : "🔴" };
};

// ─── SCANNER LOGIC ────────────────────────────────────────────────────────────
const passesFilters = (q, spyRS) =>
  q && q.ma50 && q.ma200 && q.price > q.ma50 && q.price > q.ma200 && (q.ret3m - spyRS) > 5 && q.pctFromHigh > -20;

const calcScore = (q, spyRS) => (q.ret3m - spyRS) + (100 + q.pctFromHigh) * 0.25 + (q.volRatio > 1.5 ? 8 : 0);

// ─── DESIGN ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#050A0E", s1: "#080F15", s2: "#0D1825",
  b1: "#0D1F2D", b2: "#1A3A5C",
  accent: "#00D4FF", green: "#00E87A", red: "#FF4455", yellow: "#FFB800",
  dim: "#5A8AAB", text: "#D8E8F0", bright: "#F0F8FF",
};
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
        <path d="M12,88 A73,73 0 0,1 158,88" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * 230} 230`} style={{ transition: "stroke-dasharray 1s ease" }} />
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

// ─── PRE-MARKET PANEL ─────────────────────────────────────────────────────────
function PreMarketPanel({ spy, qqq }) {
  const [pmData, setPmData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readPMCache();
    if (cached) { setPmData(cached); setLoading(false); return; }
    const load = async () => {
      setLoading(true);
      const [vix, y10, dxy, futures] = await Promise.all([fetchVIX(), fetchYield10Y(), fetchDXY(), fetchFutures()]);
      const data = { vix, y10, dxy, futures };
      writePMCache(data);
      setPmData(data);
      setLoading(false);
    };
    load();
  }, []);

  const spyRS = spy?.ret3m || 0;
  const regime = regimeSummary(spy, spyRS);
  const qqq_ = qqqSummary(qqq);
  const vix_ = pmData ? vixSummary(pmData.vix) : null;
  const yield_ = pmData ? yieldSummary(pmData.y10, pmData.dxy) : null;
  const futures_ = pmData ? futuresSummary(pmData.futures) : null;

  const items = [
    { n: "1", title: "US Futures (Direction)", summary: futures_, loading: loading },
    { n: "2", title: "Market Regime (SPX vs 200MA)", summary: regime, loading: !spy },
    { n: "3", title: "VIX — Fear Level", summary: vix_, loading: loading },
    { n: "4", title: "10Y Treasury + Dollar (DXY)", summary: yield_, loading: loading },
    { n: "5", title: "QQQ — AI/Tech Bellwether", summary: qqq_, loading: !qqq },
    { n: "6", title: "News on NBIS + NVDA", summary: { text: "Check Futu app or Google News for any earnings, analyst upgrades/downgrades, or major news on your held stocks before trading.", color: C.dim, emoji: "📰" }, loading: false },
  ];

  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ ...lbl, marginBottom: "16px" }}>📋 Pre-Market Briefing — Check this before looking at any stock prices</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {items.map(({ n, title, summary, loading: isLoading }) => (
          <div key={n} style={{ display: "flex", gap: "14px", padding: "14px 18px", background: C.s2, border: `1px solid ${C.b1}`, borderRadius: "8px", borderLeft: `4px solid ${summary?.color || C.b2}` }}>
            <div style={{ fontFamily: F.base, fontWeight: 800, fontSize: "26px", color: C.accent, lineHeight: 1, minWidth: "24px", paddingTop: "2px" }}>{n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F.base, fontSize: "14px", fontWeight: 700, color: C.dim, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "1px" }}>{title}</div>
              {isLoading ? (
                <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim }}>Loading...</div>
              ) : (
                <div style={{ fontFamily: F.base, fontSize: "15px", color: summary?.color || C.dim, lineHeight: 1.5, fontWeight: 500 }}>
                  {summary?.emoji} {summary?.text}
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
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const calc = async () => {
    setBusy(true); setRes(null);
    let q = quotes[ticker.toUpperCase()] || await fetchQuote(ticker.toUpperCase());
    if (!q?.atr) { setRes({ err: `Could not load data for ${ticker.toUpperCase()}. Try again.` }); setBusy(false); return; }
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

  const inp = { background: C.s2, border: `1px solid ${C.b2}`, color: C.bright, padding: "14px 18px", fontFamily: F.base, fontSize: "17px", outline: "none", width: "100%", boxSizing: "border-box", borderRadius: "6px" };

  return (
    <div style={{ padding: "28px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "14px", alignItems: "end", marginBottom: "28px" }}>
        {[["TICKER", ticker, v => setTicker(v.toUpperCase()), "text", "e.g. NVDA"],
          ["ACCOUNT SIZE ($)", account, setAccount, "number", ""],
          ["RISK PER TRADE (%)", riskPct, setRiskPct, "number", ""]].map(([l, v, s, t, ph]) => (
          <div key={l}>
            <div style={lbl}>{l}</div>
            <input style={inp} value={v} onChange={e => s(e.target.value)} type={t} placeholder={ph} onKeyDown={e => e.key === "Enter" && calc()} />
          </div>
        ))}
        <button onClick={calc} disabled={busy} style={{ background: C.accent, color: C.bg, border: "none", padding: "14px 30px", fontFamily: F.base, fontWeight: 700, fontSize: "17px", cursor: busy ? "not-allowed" : "pointer", borderRadius: "6px", height: "56px" }}>
          {busy ? "..." : "Calculate"}
        </button>
      </div>

      {res && !res.err && (
        <div style={{ background: C.s2, border: `1px solid ${C.b2}`, padding: "28px", borderRadius: "8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "2px", marginBottom: "24px" }}>
            {[["Entry Price", `$${res.q.price.toFixed(2)}`, C.accent],
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
            ATR = ${res.q.atr.toFixed(2)} · Risk per share = ${res.rps.toFixed(2)} ·&nbsp;
            <strong style={{ color: res.posPct > 15 ? C.red : res.rr < 2 ? C.red : C.green }}>
              {res.posPct > 15 ? "⚠ Position >15% of portfolio — reduce shares" : res.rr < 2 ? "⚠ Reward/risk below 2:1 — skip this trade" : "✓ Setup within your risk rules"}
            </strong>
          </div>
        </div>
      )}
      {res?.err && <div style={{ padding: "18px", background: "rgba(255,68,85,0.05)", border: `1px solid rgba(255,68,85,0.2)`, borderRadius: "6px", fontFamily: F.base, fontSize: "16px", color: C.red }}>{res.err}</div>}

      <div style={{ marginTop: "24px", fontFamily: F.base, fontSize: "15px", color: C.dim, lineHeight: "2" }}>
        💡 <strong style={{ color: C.text }}>ATR</strong> = Average True Range — measures how much the stock moves per day on average.<br />
        <strong style={{ color: C.text }}>Stop Loss</strong> = Entry minus 2×ATR. Gives the stock breathing room without cutting you out too early.<br />
        <strong style={{ color: C.text }}>Target 1</strong> = Entry plus 3×ATR = 3:1 reward vs risk. <strong style={{ color: C.text }}>Shares</strong> = (Account × Risk%) ÷ Risk per share.
      </div>
    </div>
  );
}

// ─── SCAN PROGRESS ────────────────────────────────────────────────────────────
function ScanScreen({ done, total, current }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ padding: "70px 48px", textAlign: "center" }}>
      <div style={{ fontFamily: F.base, fontSize: "40px", fontWeight: 800, color: C.accent, marginBottom: "12px" }}>Scanning Market...</div>
      <div style={{ fontFamily: F.mono, fontSize: "14px", color: C.dim, letterSpacing: "2px", marginBottom: "40px" }}>RUNS ONCE PER DAY · CACHED UNTIL MIDNIGHT · {total} STOCKS</div>
      <div style={{ maxWidth: "560px", margin: "0 auto 16px" }}>
        <div style={{ height: "10px", background: C.b1, borderRadius: "5px", overflow: "hidden", marginBottom: "12px" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: C.accent, transition: "width 0.3s ease", borderRadius: "5px" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: "14px", color: C.dim }}>
          <span>{done} / {total} stocks loaded</span>
          <span style={{ color: C.accent, fontWeight: 700 }}>{pct}%</span>
        </div>
      </div>
      {current && <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim, marginBottom: "40px" }}>Currently fetching: {current}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px", maxWidth: "680px", margin: "0 auto" }}>
        {Object.entries(SCAN_UNIVERSE).map(([theme, tickers]) => (
          <div key={theme} style={{ padding: "14px 16px", background: C.s2, border: `1px solid ${C.b1}`, borderRadius: "8px", textAlign: "left" }}>
            <div style={{ fontFamily: F.mono, fontSize: "10px", color: C.dim, letterSpacing: "1px", marginBottom: "4px" }}>{theme.slice(0, 22).toUpperCase()}</div>
            <div style={{ fontFamily: F.base, fontSize: "20px", fontWeight: 700, color: C.text }}>{tickers.length} stocks</div>
          </div>
        ))}
      </div>
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

  const allTickers = [...new Set([...ALL_SCAN_TICKERS, "SPY", "QQQ", ...watchlist])];

  const runScan = useCallback(async (force = false) => {
    setLoading(true); setScanDone(0); setScanCurrent("");
    if (!force) {
      const cached = readCache();
      if (cached) { setQuotes(cached); setFromCache(true); setLastUpdated(new Date()); setLoading(false); return; }
    }
    setFromCache(false);
    const results = {};
    // Load SPY and QQQ first so regime shows immediately
    const priority = ["SPY", "QQQ", ...watchlist.slice(0, 5)];
    for (const t of priority) {
      const q = await fetchQuote(t);
      if (q) results[t] = q;
      setScanDone(prev => prev + 1);
    }
    setQuotes({ ...results });
    // Then load rest in small batches
    const remaining = allTickers.filter(t => !priority.includes(t));
    const batches = [];
    for (let i = 0; i < remaining.length; i += 3) batches.push(remaining.slice(i, i + 3));
    for (const batch of batches) {
      setScanCurrent(batch.join(", "));
      const fetched = await Promise.all(batch.map(fetchQuote));
      fetched.forEach((q, i) => { if (q) results[batch[i]] = q; });
      setScanDone(prev => prev + batch.length);
      setQuotes({ ...results });
      await new Promise(r => setTimeout(r, 300));
    }
    writeCache(results);
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

  const spy = quotes["SPY"];
  const qqq = quotes["QQQ"];
  const spyRS = spy?.ret3m || 0;
  const regime = spy ? (spy.ma200 && spy.price > spy.ma200 ? "BULL" : "BEAR") : "—";
  const wlQuotes = watchlist.map(t => quotes[t]).filter(Boolean);
  const above50 = wlQuotes.filter(q => q.ma50 && q.price > q.ma50).length;
  const breadth = wlQuotes.length > 0 ? (above50 / wlQuotes.length) * 100 : 0;

  const wlMomentum = watchlist.map(t => {
    const q = quotes[t];
    if (!q) return { ticker: t, rs: null, price: null };
    return { ...q, rs: q.ret3m - spyRS, aboveMa50: q.ma50 && q.price > q.ma50, aboveMa200: q.ma200 && q.price > q.ma200 };
  }).sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999));

  const scanByTheme = {};
  let totalHits = 0;
  Object.entries(SCAN_UNIVERSE).forEach(([theme, tickers]) => {
    const hits = tickers.map(t => quotes[t])
      .filter(q => q && passesFilters(q, spyRS) && !watchlist.includes(q.ticker))
      .map(q => ({ ...q, rs: q.ret3m - spyRS, score: calcScore(q, spyRS) }))
      .sort((a, b) => b.score - a.score);
    if (hits.length > 0) { scanByTheme[theme] = hits; totalHits += hits.length; }
  });

  const TABS = [
    ["premarket", "🌅  Pre-Market"],
    ["scanner", `🔍  Scanner  ${loading ? "..." : `(${totalHits})`}`],
    ["watchlist", "📈  Watchlist"],
    ["portfolio", "💼  Portfolio"],
    ["atr", "🎯  ATR Calculator"],
  ];

  const regimeColor = regime === "BULL" ? C.green : regime === "BEAR" ? C.red : C.yellow;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: F.base }}>

      {/* HEADER */}
      <div style={{ background: C.s2, borderBottom: `2px solid ${C.b2}`, padding: "20px 30px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: F.base, fontSize: "26px", fontWeight: 800, color: C.accent, letterSpacing: "1px" }}>⬡ QUANT MASTER V3.1</div>
          <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, letterSpacing: "2px", marginTop: "4px" }}>NATHALIE'S COMMAND CENTER · {ALL_SCAN_TICKERS.length}+ STOCKS SCANNED DAILY</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {fromCache && <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, background: C.s1, padding: "8px 14px", borderRadius: "6px", border: `1px solid ${C.b1}` }}>✓ Cached · Next scan tomorrow</div>}
          <button onClick={() => runScan(true)} disabled={loading} style={{ background: "transparent", color: C.accent, border: `1px solid ${C.b2}`, padding: "10px 20px", fontFamily: F.base, fontWeight: 600, fontSize: "15px", cursor: loading ? "not-allowed" : "pointer", borderRadius: "6px" }}>
            ↻ Force Rescan
          </button>
          {lastUpdated && (
            <div style={{ fontFamily: F.mono, fontSize: "12px", color: C.dim, textAlign: "right" }}>
              <div>{lastUpdated.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
              <div>{lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          )}
        </div>
      </div>

      {loading && scanDone < 3 ? <ScanScreen done={scanDone} total={allTickers.length} current={scanCurrent} /> : (
        <>
          {/* METRICS BAR */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "2px", background: C.b1 }}>
            {[
              ["Market Regime", regime, regimeColor, spy ? `SPY  $${spy.price?.toFixed(2)}` : "Loading..."],
              ["Watchlist vs 50MA", `${wlQuotes.length > 0 ? breadth.toFixed(0) : "—"}%`, breadth >= 60 ? C.green : breadth >= 40 ? C.yellow : C.red, `${above50} of ${wlQuotes.length} stocks loaded`],
              ["Scanner Ideas", loading ? "..." : totalHits, totalHits > 5 ? C.green : totalHits > 0 ? C.yellow : C.red, "stocks passing all 4 filters"],
              ["QQQ Today", qqq ? `$${qqq.price?.toFixed(2)}` : "Loading...", qqq?.changePct >= 0 ? C.green : C.red, qqq ? `${qqq.changePct >= 0 ? "+" : ""}${qqq.changePct?.toFixed(2)}%  ·  AI & tech bellwether` : "Fetching..."],
            ].map(([l, v, col, sub]) => (
              <div key={l} style={{ background: C.s1, padding: "22px 26px" }}>
                <div style={lbl}>{l}</div>
                <div style={{ fontFamily: F.base, fontSize: "40px", fontWeight: 800, color: col, lineHeight: 1, marginTop: "6px" }}>{v}</div>
                <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim, marginTop: "8px" }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* BREADTH + PRE-MARKET SUMMARY */}
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "2px", background: C.b1 }}>
            <div style={{ background: C.s1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BreadthGauge value={wlQuotes.length > 0 ? breadth : 0} />
            </div>
            <div style={{ background: C.s1 }}>
              <PreMarketPanel spy={spy} qqq={qqq} />
            </div>
          </div>

          {/* TABS */}
          <div style={{ display: "flex", gap: "2px", background: C.b1 }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{ padding: "16px 26px", border: "none", cursor: "pointer", fontFamily: F.base, fontWeight: tab === id ? 700 : 500, fontSize: "16px", background: tab === id ? C.s1 : C.bg, color: tab === id ? C.accent : C.dim, borderBottom: tab === id ? `3px solid ${C.accent}` : "3px solid transparent" }}>
                {label}
              </button>
            ))}
          </div>

          {/* SCANNER */}
          {tab === "scanner" && (
            <div style={{ background: C.s1 }}>
              <div style={{ padding: "14px 22px", background: C.s2, borderBottom: `1px solid ${C.b1}`, display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontFamily: F.mono, fontSize: "13px", color: C.dim }}>
                  4 FILTERS: ① Above 50MA &nbsp; ② Above 200MA &nbsp; ③ RS vs SPY &gt;+5% &nbsp; ④ Within 20% of 52-week high
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: "18px" }}>
                  {[["STRONG = best setup", C.green], ["WATCH = decent", C.yellow], ["SPEC = risky", C.accent]].map(([l, col]) => (
                    <span key={l} style={{ fontFamily: F.mono, fontSize: "12px", color: col, letterSpacing: "1px" }}>● {l}</span>
                  ))}
                </div>
              </div>
              {totalHits === 0 ? (
                <div style={{ padding: "60px", textAlign: "center", fontFamily: F.base, fontSize: "18px", color: C.dim }}>
                  No stocks passing all filters right now — market conditions are challenging. It's OK to stay in cash.
                </div>
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
                        const rating = q.rs > 20 && q.pctFromHigh > -10 ? "STRONG" : q.rs > 10 ? "WATCH" : "SPEC";
                        const rCol = rating === "STRONG" ? "green" : rating === "WATCH" ? "yellow" : "blue";
                        const bCol = rating === "STRONG" ? C.green : rating === "WATCH" ? C.yellow : C.accent;
                        return (
                          <tr key={q.ticker} style={{ background: i % 2 === 0 ? C.s1 : C.bg, borderLeft: `4px solid ${bCol}` }}>
                            <td style={{ ...TD, fontFamily: F.base, fontWeight: 800, fontSize: "18px", color: C.accent }}>{q.ticker}</td>
                            <td style={{ ...TD, fontFamily: F.mono }}>${q.price?.toFixed(2)}</td>
                            <td style={{ ...TD, fontFamily: F.mono, color: q.changePct >= 0 ? C.green : C.red, fontWeight: 600 }}>{q.changePct >= 0 ? "+" : ""}{q.changePct?.toFixed(2)}%</td>
                            <td style={{ ...TD, minWidth: "170px" }}><RSBar value={q.rs} /></td>
                            <td style={{ ...TD, fontFamily: F.mono }}>{q.score?.toFixed(0)}</td>
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

          {/* WATCHLIST */}
          {tab === "watchlist" && (
            <div style={{ background: C.s1 }}>
              <div style={{ padding: "14px 22px", background: C.s2, borderBottom: `1px solid ${C.b1}`, fontFamily: F.mono, fontSize: "13px", color: C.dim }}>
                RS = 3-month return minus SPY baseline (SPY: {spyRS > 0 ? "+" : ""}{spyRS.toFixed(1)}%) · Sorted strongest first · {loading ? "Still loading some stocks..." : `${wlQuotes.length}/${watchlist.length} loaded`}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["#","Ticker","Price","Today","RS vs SPY","vs 50MA","vs 200MA","From High","Vol","Status","Remove"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {wlMomentum.map((q, i) => (
                    <tr key={q.ticker} style={{ background: i % 2 === 0 ? C.s1 : C.bg, borderLeft: i < 5 ? `4px solid ${C.green}` : i < 12 ? `4px solid ${C.yellow}` : `4px solid ${C.b1}` }}>
                      <td style={{ ...TD, fontFamily: F.mono, color: C.dim }}>{i + 1}</td>
                      <td style={{ ...TD, fontFamily: F.base, fontWeight: 800, fontSize: "18px", color: C.accent }}>{q.ticker}</td>
                      <td style={{ ...TD, fontFamily: F.mono }}>{q.price ? `$${q.price.toFixed(2)}` : <span style={{ color: C.dim }}>Loading...</span>}</td>
                      <td style={{ ...TD, fontFamily: F.mono, color: (q.changePct ?? 0) >= 0 ? C.green : C.red, fontWeight: 600 }}>{q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"}</td>
                      <td style={{ ...TD, minWidth: "180px" }}>{q.rs != null ? <RSBar value={q.rs} /> : <span style={{ fontFamily: F.mono, color: C.dim, fontSize: "13px" }}>Loading...</span>}</td>
                      <td style={TD}>{q.aboveMa50 != null ? <Pill color={q.aboveMa50 ? "green" : "red"} text={q.aboveMa50 ? "ABOVE" : "BELOW"} /> : "—"}</td>
                      <td style={TD}>{q.aboveMa200 != null ? <Pill color={q.aboveMa200 ? "green" : "red"} text={q.aboveMa200 ? "ABOVE" : "BELOW"} /> : "—"}</td>
                      <td style={{ ...TD, fontFamily: F.mono, color: q.pctFromHigh > -10 ? C.green : q.pctFromHigh > -25 ? C.yellow : C.red, fontWeight: 600 }}>{q.pctFromHigh != null ? `${q.pctFromHigh.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...TD, fontFamily: F.mono, color: q.volRatio > 1.5 ? C.green : q.volRatio < 0.7 ? C.red : C.dim }}>{q.volRatio ? `${q.volRatio.toFixed(1)}x` : "—"}</td>
                      <td style={TD}>{q.rs != null ? <Pill color={q.aboveMa50 && q.rs > 5 ? "green" : q.rs > 0 ? "yellow" : "red"} text={q.aboveMa50 && q.rs > 5 ? "ACTIVE" : q.rs > 0 ? "MONITOR" : "WEAK"} /> : "—"}</td>
                      <td style={TD}><button onClick={() => removeFromWL(q.ticker)} style={{ background: "rgba(255,68,85,0.08)", border: `1px solid rgba(255,68,85,0.2)`, color: C.red, padding: "7px 14px", cursor: "pointer", fontFamily: F.base, fontWeight: 600, fontSize: "14px", borderRadius: "4px" }}>✕ Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* PORTFOLIO */}
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
                ⚠ NBIS share count and cost basis must be updated manually each time you trim.<br />
                All orders must be placed manually in Futu. This system never executes trades.
              </div>
            </div>
          )}

          {/* ATR */}
          {tab === "atr" && <div style={{ background: C.s1 }}><ATRCalculator quotes={quotes} /></div>}

          {/* FOOTER */}
          <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.b1}`, display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: "12px", color: "#1A3A5C", letterSpacing: "1px" }}>
            <span>QUANT MASTER V3.1 · NATHALIE'S TRADING COMMAND CENTER</span>
            <span>DATA: YAHOO FINANCE · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE · ALL ORDERS MANUAL IN FUTU</span>
          </div>
        </>
      )}
    </div>
  );
}
