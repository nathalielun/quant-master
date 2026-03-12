import { useState, useEffect, useCallback } from "react";

// ─── UNIVERSE ──────────────────────────────────────────────────────────────────
const SCAN_UNIVERSE = {
  "AI / Semiconductors":             ["NVDA","AMD","ARM","MRVL","ALAB","CRDO","ASML","LRCX","KLAC","AMAT","SMCI","TSM","AVGO","QCOM","MU","MPWR","ADI","TXN"],
  "AI Infra / Data Centers":         ["EQIX","DLR","DELL","HPE","VRT","ETN","PLTR","DDOG","SNOW","PANW","NET","CRWD","ZS","RDDT"],
  "Energy / Power":                  ["VST","CEG","NRG","AES","PCG","EXC","NEE","OKE","LNG","KMI","WMB","AEP","DUK","SO","NTR","ADM"],
  "Bitcoin Mining / Crypto":         ["MARA","RIOT","CLSK","HUT","IREN","WULF","CIFR","COIN","HOOD","MSTR"],
  "Fintech / E-commerce":            ["SQ","AFRM","UPST","NU","SOFI","PYPL","BILL","SHOP","MELI","SE","APP","TTD","CRCL"],
  "Defense / Aerospace":             ["KTOS","AVAV","LMT","RTX","NOC","HII","LDOS","BWXT","RCAT"],
  "Consumer / Health / Other":       ["NFLX","COST","WMT","HIMS","LULU","ONON","DECK","VIK","SNDK","LUMN","ONDS","SMTC"],
};
const ALL_SCAN_TICKERS = [...new Set(Object.values(SCAN_UNIVERSE).flat())];
const DEFAULT_WATCHLIST = ["NBIS","VST","IREN","SHOP","SOFI","WULF","LUMN","ONDS","CRCL","HIMS","VIK","NFLX","SNDK","ADM","NVDA","TSM","SMCI","VRT","AVGO","PLTR","ETN","COST","WMT","KTOS","AVAV"];

// ─── STORAGE ───────────────────────────────────────────────────────────────────
const TODAY = () => new Date().toISOString().slice(0, 10);

const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Scan cache: keyed by date, stores {ticker: quoteObj}
const SCAN_KEY  = "qm_scan_v9";
const SCAN_DATE = "qm_scan_date_v9";
const WL_KEY    = "qm_wl_v9";
// Pre-market cache: keyed by date
const PM_KEY    = "qm_pm_v9";
const PM_DATE   = "qm_pm_date_v9";

const readScanCache = () => {
  if (store.get(SCAN_DATE) !== TODAY()) return null;
  return store.get(SCAN_KEY) || null;
};
const writeScanCache = (d) => { store.set(SCAN_KEY, d); store.set(SCAN_DATE, TODAY()); };

const readPMCache = () => {
  if (store.get(PM_DATE) !== TODAY()) return null;
  return store.get(PM_KEY) || null;
};
const writePMCache = (d) => { store.set(PM_KEY, d); store.set(PM_DATE, TODAY()); };

const readWL  = () => store.get(WL_KEY) || [...DEFAULT_WATCHLIST];
const writeWL = (wl) => store.set(WL_KEY, wl);

// ─── FETCH ─────────────────────────────────────────────────────────────────────
// Rotate proxies so one doesn't get hammered
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];
let _proxyIdx = 0;
const nextProxy = () => { const p = PROXIES[_proxyIdx % PROXIES.length]; _proxyIdx++; return p; };

const fetchJSON = async (url, timeoutMs = 10000) => {
  // Try each proxy once
  for (let i = 0; i < PROXIES.length; i++) {
    const proxy = PROXIES[(i + _proxyIdx) % PROXIES.length];
    try {
      const res = await fetch(proxy(url), { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 30) continue;
      return JSON.parse(text);
    } catch { continue; }
  }
  return null;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── QUOTE PARSER (uses 1y chart for MA200 + ATR) ─────────────────────────────
const fetchQuote = async (ticker, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await sleep(800 * attempt); // back-off on retry
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
      const data = await fetchJSON(url);
      const r = data?.chart?.result?.[0];
      if (!r) continue;
      const q = r.indicators?.quote?.[0] || {};
      const closes  = (q.close  || []).filter(Boolean);
      const highs   = (q.high   || []);
      const lows    = (q.low    || []);
      const volumes = (q.volume || []);
      if (closes.length < 20) continue;
      const price = r.meta?.regularMarketPrice || closes[closes.length - 1];
      if (!price || price <= 0) continue;
      const prev       = closes[closes.length - 2];
      const changePct  = prev ? ((price - prev) / prev) * 100 : 0;
      const ma50       = closes.length >= 50  ? closes.slice(-50).reduce((a,b)=>a+b,0)  / 50  : null;
      const ma200      = closes.length >= 200 ? closes.slice(-200).reduce((a,b)=>a+b,0) / 200 : null;
      const trs = [];
      for (let i = Math.max(1, highs.length - 14); i < highs.length; i++) {
        if (highs[i] && lows[i] && closes[i-1])
          trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
      }
      const atr        = trs.length ? trs.reduce((a,b)=>a+b,0) / trs.length : null;
      const ret3m      = closes.length >= 63
        ? ((price - closes[closes.length-63]) / closes[closes.length-63]) * 100
        : ((price - closes[0]) / closes[0]) * 100;
      const w52High    = Math.max(...closes);
      const w52Low     = Math.min(...closes);
      const pctFromHigh = ((price - w52High) / w52High) * 100;
      const validVols  = volumes.filter(Boolean);
      const avgVol     = validVols.length >= 20 ? validVols.slice(-20).reduce((a,b)=>a+b,0)/20 : null;
      const volRatio   = avgVol && validVols[validVols.length-1] ? validVols[validVols.length-1]/avgVol : null;
      return { ticker, price, changePct, ma50, ma200, atr, ret3m, w52High, w52Low, pctFromHigh, volRatio };
    } catch { continue; }
  }
  return null;
};

// ─── PRE-MARKET DATA ──────────────────────────────────────────────────────────
// These use 5-day range — much smaller payload, load fast
const fetchSimple = async (sym) => {
  try {
    const data = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`);
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter(Boolean);
    const price  = r.meta?.regularMarketPrice || closes[closes.length-1];
    const prev   = closes[closes.length-2];
    return price ? { price, changePct: prev ? ((price-prev)/prev)*100 : 0 } : null;
  } catch { return null; }
};

const loadPreMarket = async () => {
  const cached = readPMCache();
  if (cached) return cached;
  // Load all PM tickers in parallel — small payloads, fine to parallel
  const [vix, t10y, dxy, nq, es, spy, qqq, spxa50r] = await Promise.allSettled([
    fetchSimple("%5EVIX"),
    fetchSimple("%5ETNX"),
    fetchSimple("DX-Y.NYB"),
    fetchSimple("NQ%3DF"),
    fetchSimple("ES%3DF"),
    fetchSimple("SPY"),
    fetchSimple("QQQ"),
    fetchSimple("%5ESPXA50R"),  // S&P 500 stocks above 50MA — market breadth
  ]);
  const get = (r) => r.status === "fulfilled" ? r.value : null;
  const result = { vix: get(vix), t10y: get(t10y), dxy: get(dxy), nq: get(nq), es: get(es), spy: get(spy), qqq: get(qqq), spxa50r: get(spxa50r) };
  writePMCache(result);
  return result;
};

// ─── PLAIN ENGLISH SUMMARIES ──────────────────────────────────────────────────
const G = "#00E87A", Y = "#FFB800", R = "#FF4455", DIM = "#5A8AAB";

const pmText = {
  futures: (nq, es) => {
    if (!nq && !es) return { c: DIM, e: "❓", t: "Futures data unavailable right now." };
    const parts = [];
    if (nq) parts.push(`Nasdaq ${nq.changePct>=0?"+":""}${nq.changePct.toFixed(2)}%`);
    if (es)  parts.push(`S&P ${es.changePct>=0?"+":""}${es.changePct.toFixed(2)}%`);
    const avg = ((nq?.changePct||0)+(es?.changePct||0)) / ((nq&&es)?2:1);
    const note = avg>0.3 ? "Market pointing UP at open. Good tone for buyers."
      : avg<-0.3 ? "Market pointing DOWN. Be careful with new buys today."
      : "Mixed signals before open. Wait and see.";
    return { c: avg>0.3?G:avg<-0.3?R:Y, e: avg>0.3?"🟢":avg<-0.3?"🔴":"🟡", t: parts.join("  ·  ")+"  —  "+note };
  },
  regime: (spy) => {
    if (!spy) return { c: DIM, e: "❓", t: "SPY data unavailable.", regime: "—" };
    const regime = "BULL"; // will be updated from scan data
    const note = "SPY loaded — regime will confirm once scan completes.";
    return { c: Y, e: "🟡", t: `SPY $${spy.price.toFixed(2)}  —  ${note}`, regime };
  },
  vix: (v) => {
    if (!v) return { c: DIM, e: "❓", t: "VIX unavailable — check finance.yahoo.com/quote/%5EVIX manually." };
    const x = v.price;
    const d = v.changePct>1?", rising ↑":v.changePct<-1?", falling ↓":"";
    if (x<15) return { c: G, e: "🟢", t: `VIX ${x.toFixed(1)}${d} — Very calm. Excellent conditions to trade.` };
    if (x<20) return { c: G, e: "🟢", t: `VIX ${x.toFixed(1)}${d} — Calm market. Normal conditions.` };
    if (x<25) return { c: Y, e: "🟡", t: `VIX ${x.toFixed(1)}${d} — Mild nervousness. Trade smaller sizes.` };
    if (x<35) return { c: Y, e: "🟡", t: `VIX ${x.toFixed(1)}${d} — Market fearful. Reduce position sizes.` };
    return { c: R, e: "🔴", t: `VIX ${x.toFixed(1)}${d} — HIGH FEAR. Avoid new trades. Protect capital.` };
  },
  rates: (t10y, dxy) => {
    if (!t10y && !dxy) return { c: DIM, e: "❓", t: "10Y yield & DXY unavailable — check TradingView or investing.com manually." };
    const parts = []; let warn = false;
    if (t10y) { const d=t10y.changePct>0.5?"rising fast ⚠️":t10y.changePct>0?"slightly up":"falling ↓"; parts.push(`10Y yield ${t10y.price.toFixed(2)}% (${d})`); if(t10y.changePct>0.5) warn=true; }
    if (dxy)  { const d=dxy.changePct>0.3?"strengthening ⚠️":dxy.changePct>0?"slightly up":"weakening ↓"; parts.push(`DXY ${dxy.price.toFixed(1)} (${d})`); if(dxy.changePct>0.3) warn=true; }
    const note = warn ? "Rising yields/dollar can pressure tech & growth stocks. Be selective."
      : "Stable — no major rate or dollar headwind today.";
    return { c: warn?Y:G, e: warn?"🟡":"🟢", t: parts.join("  ·  ")+"  —  "+note };
  },
  qqq: (q) => {
    if (!q) return { c: DIM, e: "❓", t: "QQQ data unavailable." };
    const dir = q.changePct>=0?"up":"down";
    const note = q.changePct>1 ? "Strong tech rally — great environment for AI/growth."
      : q.changePct>0 ? "Tech slightly positive — neutral to good for your watchlist."
      : q.changePct>-1 ? "Tech slightly weak — be patient, don't chase."
      : "Tech selling off — avoid new buys, wait for stabilisation.";
    return { c: q.changePct>0?G:q.changePct>-1?Y:R, e: q.changePct>0?"🟢":q.changePct>-1?"🟡":"🔴",
      t: `QQQ $${q.price.toFixed(2)}, ${dir} ${Math.abs(q.changePct).toFixed(2)}% today  —  ${note}` };
  },
  breadth: (s) => {
    // SPXA50R price = number of S&P 500 stocks above 50MA (out of 500)
    if (!s) return { c: DIM, e: "❓", t: "S&P 500 breadth ($SPXA50R) unavailable right now." };
    const pct = (s.price / 500) * 100; // convert count → percentage
    const dir = s.changePct > 0 ? "improving ↑" : s.changePct < 0 ? "deteriorating ↓" : "flat";
    if (pct >= 70) return { c: G,   e: "🟢", t: `${pct.toFixed(0)}% of S&P 500 stocks above 50MA (${dir}) — Broad bull market. Most stocks participating. ✅ Good environment to buy.` };
    if (pct >= 50) return { c: G,   e: "🟢", t: `${pct.toFixed(0)}% of S&P 500 stocks above 50MA (${dir}) — More than half the market healthy. OK to buy strong setups.` };
    if (pct >= 40) return { c: Y,   e: "🟡", t: `${pct.toFixed(0)}% of S&P 500 stocks above 50MA (${dir}) — Mixed market. Under half the stocks are healthy. Be very selective.` };
    if (pct >= 30) return { c: Y,   e: "🟡", t: `${pct.toFixed(0)}% of S&P 500 stocks above 50MA (${dir}) — Weak breadth. Most stocks struggling. Only trade the very best setups.` };
    return { c: R, e: "🔴", t: `${pct.toFixed(0)}% of S&P 500 stocks above 50MA (${dir}) — Very poor breadth. Broad market weakness. Avoid new buys — protect capital.` };
  },
};

// ─── SCANNER / RATING ─────────────────────────────────────────────────────────
const passes    = (q, spyRS) => q && q.ma50 && q.ma200 && q.price>q.ma50 && q.price>q.ma200 && (q.ret3m-spyRS)>5 && q.pctFromHigh>-20;
const calcScore = (q, spyRS) => (q.ret3m-spyRS) + (100+q.pctFromHigh)*0.25 + (q.volRatio>1.5?8:0);

// Unified rating — same in scanner AND watchlist
const getRating = (rs, a50, a200, fromHigh) => {
  if (rs==null) return { label:"—", col:"blue" };
  if (a50 && a200 && rs>20 && fromHigh>-15) return { label:"STRONG", col:"green" };
  if (a50 && a200 && rs>5)                  return { label:"WATCH",  col:"yellow" };
  if ((a50||a200) && rs>0)                  return { label:"SPEC",   col:"blue" };
  return { label:"WEAK", col:"red" };
};

// ─── DESIGN ────────────────────────────────────────────────────────────────────
const C = { bg:"#050A0E", s1:"#080F15", s2:"#0D1825", b1:"#0D1F2D", b2:"#1A3A5C",
  accent:"#00D4FF", green:G, red:R, yellow:Y, dim:DIM, text:"#D8E8F0", bright:"#F0F8FF" };
const F = { base:"'DM Sans',sans-serif", mono:"'DM Mono',monospace" };

const lbl  = { fontFamily:F.mono, fontSize:"12px", letterSpacing:"2px", color:C.dim, textTransform:"uppercase", marginBottom:"8px" };
const TH   = { fontFamily:F.mono, fontSize:"12px", letterSpacing:"1px", color:C.dim, textTransform:"uppercase", padding:"14px 18px", textAlign:"left", borderBottom:`1px solid ${C.b1}`, background:C.s2, whiteSpace:"nowrap" };
const TD   = { padding:"13px 18px", fontSize:"16px", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap", fontFamily:F.base };

const spin = `@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
const Spinner = ({ size=14 }) => (
  <div style={{ width:size, height:size, border:`2px solid ${C.b2}`, borderTop:`2px solid ${C.accent}`,
    borderRadius:"50%", animation:"spin 0.8s linear infinite", display:"inline-block", flexShrink:0 }} />
);

const Pill = ({ color, text }) => {
  const m = { green:[G,"rgba(0,232,122,0.12)","rgba(0,232,122,0.3)"], red:[R,"rgba(255,68,85,0.1)","rgba(255,68,85,0.25)"],
    yellow:[Y,"rgba(255,184,0,0.1)","rgba(255,184,0,0.25)"], blue:[C.accent,"rgba(0,212,255,0.1)","rgba(0,212,255,0.25)"] };
  const [fg, bg, border] = m[color]||m.blue;
  return <span style={{ display:"inline-block", padding:"5px 12px", borderRadius:"4px", fontSize:"13px",
    fontFamily:F.mono, fontWeight:600, letterSpacing:"1px", background:bg, color:fg, border:`1px solid ${border}` }}>{text}</span>;
};

const RSBar = ({ value }) => {
  const capped = Math.max(0, Math.min(100, ((value+20)/80)*100));
  const color  = value>15?G:value>0?Y:R;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"10px", width:"100%" }}>
      <div style={{ flex:1, height:"8px", background:C.b1, borderRadius:"4px", overflow:"hidden" }}>
        <div style={{ width:`${capped}%`, height:"100%", background:color, transition:"width 0.8s ease", borderRadius:"4px" }} />
      </div>
      <span style={{ fontFamily:F.mono, fontSize:"14px", color, minWidth:"62px", textAlign:"right", fontWeight:600 }}>
        {value>0?"+":""}{value.toFixed(1)}%
      </span>
    </div>
  );
};

const BreadthGauge = ({ value }) => {
  const color = value>=60?G:value>=40?Y:R;
  const angle = (value/100)*180-90;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"24px 20px" }}>
      <svg width="170" height="96" viewBox="0 0 170 96">
        <path d="M12,88 A73,73 0 0,1 158,88" fill="none" stroke={C.b1} strokeWidth="14" strokeLinecap="round"/>
        <path d="M12,88 A73,73 0 0,1 158,88" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(value/100)*230} 230`} style={{ transition:"stroke-dasharray 1s ease" }}/>
        <line x1="85" y1="88" x2="85" y2="26" stroke={color} strokeWidth="3" strokeLinecap="round" transform={`rotate(${angle},85,88)`}/>
        <circle cx="85" cy="88" r="5" fill={color}/>
        <text x="5" y="96" fill={C.dim} fontSize="11" fontFamily={F.mono}>0%</text>
        <text x="140" y="96" fill={C.dim} fontSize="11" fontFamily={F.mono}>100%</text>
      </svg>
      <div style={{ fontFamily:F.base, fontSize:"46px", fontWeight:800, color, lineHeight:1, marginTop:"-6px" }}>{value.toFixed(0)}%</div>
      <div style={{ fontFamily:F.mono, fontSize:"12px", color:C.dim, letterSpacing:"2px", marginTop:"8px" }}>ABOVE 50-DAY MA</div>
    </div>
  );
};

// ─── PRE-MARKET PAGE ──────────────────────────────────────────────────────────
function PreMarketPage({ scanQuotes }) {
  const [pm, setPm]       = useState(null);
  const [pmLoad, setPmLoad] = useState(true);

  useEffect(() => {
    loadPreMarket().then(d => { setPm(d); setPmLoad(false); });
  }, []);

  // Enrich regime from scan data if available
  const spyFull = scanQuotes?.SPY;
  const regimeInfo = (() => {
    const spySrc = pm?.spy || spyFull;
    if (!spySrc) return { c:DIM, e:"❓", t:"SPY loading..." };
    const a200 = spyFull?.ma200 ? spyFull.price>spyFull.ma200 : null;
    const a50  = spyFull?.ma50  ? spyFull.price>spyFull.ma50  : null;
    if (a200===null) return { c:Y, e:"🟡", t:`SPY $${spySrc.price.toFixed(2)} — Scan still loading moving averages...` };
    const color = a200&&a50?G:a200?Y:R;
    const note  = a200&&a50 ? "Above both 50MA & 200MA. Bull market confirmed. ✅ OK to be buying strong stocks."
      : a200 ? "Above 200MA but below 50MA. Bull trend intact but recent weakness. Be selective."
      : "Below 200MA. ⚠️ Bear market. Avoid new buys. Protect capital.";
    return { c:color, e:color===G?"🟢":color===Y?"🟡":"🔴", t:`SPY $${spySrc.price.toFixed(2)}  —  ${note}` };
  })();

  const qqqSrc = pm?.qqq || scanQuotes?.QQQ;

  const items = [
    { n:"1", title:"US Futures — Pre-Market Direction",    info: pmLoad?null:pmText.futures(pm?.nq, pm?.es), loading:pmLoad },
    { n:"2", title:"Market Regime (SPX vs 200MA)",         info: regimeInfo,                                loading:!pm?.spy&&!spyFull },
    { n:"3", title:"VIX — Fear Level",                     info: pmLoad?null:pmText.vix(pm?.vix),           loading:pmLoad },
    { n:"4", title:"10Y Treasury + Dollar (DXY)",          info: pmLoad?null:pmText.rates(pm?.t10y,pm?.dxy),loading:pmLoad },
    { n:"5", title:"QQQ — AI & Tech Bellwether",           info: qqqSrc?pmText.qqq(qqqSrc):null,            loading:!qqqSrc },
    { n:"6", title:"$SPXA50R — S&P 500 Market Breadth",   info: pmLoad?null:pmText.breadth(pm?.spxa50r),   loading:pmLoad },
    { n:"7", title:"NBIS + NVDA — News Check",
      info:{ c:DIM, e:"📰", t:"Check Futu or Google Finance for earnings, analyst upgrades, or news on your held stocks before placing orders." },
      loading:false },
  ];

  // Regime metric from scan
  const regime = spyFull ? (spyFull.ma200&&spyFull.price>spyFull.ma200?"BULL":"BEAR") : "—";
  const regimeColor = regime==="BULL"?G:regime==="BEAR"?R:Y;

  // Breadth from scan
  const wlTickers = readWL();
  const wlLoaded  = wlTickers.map(t=>scanQuotes?.[t]).filter(Boolean);
  const above50   = wlLoaded.filter(q=>q.ma50&&q.price>q.ma50).length;
  const breadth   = wlLoaded.length>0 ? (above50/wlLoaded.length)*100 : 0;

  const qqqLive = scanQuotes?.QQQ || pm?.qqq;

  return (
    <div>
      {/* Top metrics */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"2px", background:C.b1 }}>
        {[
          ["Market Regime",      regime,     regimeColor, spyFull?`SPY $${spyFull.price.toFixed(2)}`:"Loading..."],
          ["S&P 500 Breadth",    pm?.spxa50r ? `${((pm.spxa50r.price/500)*100).toFixed(0)}%` : pmLoad?"Loading...":"—",
            pm?.spxa50r ? (pm.spxa50r.price/500*100>=50?G:pm.spxa50r.price/500*100>=30?Y:R) : DIM,
            pm?.spxa50r ? `${pm.spxa50r.price.toFixed(0)}/500 stocks above 50MA` : "$SPXA50R — fetching..."],
          ["VIX Fear Level",     pm?.vix?`${pm.vix.price.toFixed(1)}`:pmLoad?"Loading...":"—", pm?.vix?(pm.vix.price<20?G:pm.vix.price<30?Y:R):DIM, pm?.vix?`${pm.vix.price<20?"Calm":"Elevated"} · ${pm.vix.changePct>=0?"↑":""} ${pm.vix.changePct.toFixed(1)}%`:"Fetching..."],
          ["QQQ Today",          qqqLive?`$${qqqLive.price.toFixed(2)}`:"Loading...", qqqLive?.changePct>=0?G:R, qqqLive?`${qqqLive.changePct>=0?"+":""}${qqqLive.changePct.toFixed(2)}% · AI bellwether`:"Fetching..."],
        ].map(([l,v,col,sub])=>(
          <div key={l} style={{ background:C.s1, padding:"22px 26px" }}>
            <div style={lbl}>{l}</div>
            <div style={{ fontFamily:F.base, fontSize:"36px", fontWeight:800, color:col, lineHeight:1, marginTop:"6px" }}>{v}</div>
            <div style={{ fontFamily:F.mono, fontSize:"13px", color:C.dim, marginTop:"8px" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Breadth gauge + cards */}
      <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:"2px", background:C.b1 }}>
        <div style={{ background:C.s1, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <BreadthGauge value={wlLoaded.length>0?breadth:0} />
        </div>
        <div style={{ background:C.s1, padding:"20px 24px" }}>
          <div style={{ ...lbl, marginBottom:"16px" }}>📋 Pre-Market Briefing — Read this BEFORE looking at individual stock prices</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
            {items.map(({ n, title, info, loading:isLoad })=>(
              <div key={n} style={{ display:"flex", gap:"14px", padding:"16px 18px", background:C.s2,
                border:`1px solid ${C.b1}`, borderRadius:"8px", borderLeft:`4px solid ${isLoad?C.b2:(info?.c||C.b2)}` }}>
                <div style={{ fontFamily:F.base, fontWeight:800, fontSize:"26px", color:C.accent, lineHeight:1, minWidth:"24px" }}>{n}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:F.mono, fontSize:"11px", color:C.dim, letterSpacing:"1px", textTransform:"uppercase", marginBottom:"8px" }}>{title}</div>
                  {isLoad
                    ? <div style={{ display:"flex", alignItems:"center", gap:"8px" }}><Spinner /><span style={{ fontFamily:F.base, fontSize:"14px", color:C.dim }}>Fetching live data...</span></div>
                    : <div style={{ fontFamily:F.base, fontSize:"15px", color:info?.c||C.dim, lineHeight:1.6, fontWeight:500 }}>{info?.e}  {info?.t}</div>
                  }
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:"12px", fontFamily:F.mono, fontSize:"11px", color:C.b2 }}>
            ✓ Pre-market data cached once per day · Macro conditions don't change minute-to-minute · Force Rescan reloads if needed
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SCANNER PAGE ─────────────────────────────────────────────────────────────
function ScannerPage({ quotes, spyRS, watchlist, addToWL, addedSet }) {
  const scanByTheme = {}; let totalHits = 0;
  Object.entries(SCAN_UNIVERSE).forEach(([theme, tickers]) => {
    const hits = tickers.map(t=>quotes[t])
      .filter(q=>q&&passes(q,spyRS)&&!watchlist.includes(q.ticker))
      .map(q=>({ ...q, rs:q.ret3m-spyRS, sc:calcScore(q,spyRS) }))
      .sort((a,b)=>b.sc-a.sc);
    if (hits.length>0) { scanByTheme[theme]=hits; totalHits+=hits.length; }
  });

  if (totalHits===0) return (
    <div style={{ padding:"60px", textAlign:"center", fontFamily:F.base, fontSize:"18px", color:C.dim, background:C.s1 }}>
      No stocks passing all 4 filters right now. Market conditions are challenging — it's OK to stay in cash.
    </div>
  );

  return (
    <div style={{ background:C.s1 }}>
      <div style={{ padding:"14px 22px", background:C.s2, borderBottom:`1px solid ${C.b1}`, display:"flex", gap:"24px", alignItems:"center", flexWrap:"wrap" }}>
        <span style={{ fontFamily:F.mono, fontSize:"13px", color:C.dim }}>4 FILTERS: ① Above 50MA  ② Above 200MA  ③ RS vs SPY &gt;+5%  ④ Within 20% of 52W high</span>
        <span style={{ marginLeft:"auto", display:"flex", gap:"18px" }}>
          {[["STRONG = best setup",G],["WATCH = decent",Y],["SPEC = risky",C.accent]].map(([l,col])=>(
            <span key={l} style={{ fontFamily:F.mono, fontSize:"12px", color:col }}>● {l}</span>
          ))}
        </span>
      </div>
      {Object.entries(scanByTheme).map(([theme, stocks])=>(
        <div key={theme}>
          <div style={{ padding:"12px 22px", background:"rgba(0,212,255,0.04)", borderTop:`1px solid ${C.b1}`, borderBottom:`1px solid ${C.b1}`, display:"flex", gap:"12px", alignItems:"center" }}>
            <span style={{ fontFamily:F.base, fontSize:"16px", fontWeight:700, color:C.accent }}>{theme}</span>
            <span style={{ fontFamily:F.mono, fontSize:"13px", color:C.dim }}>{stocks.length} idea{stocks.length!==1?"s":""}</span>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>{["Ticker","Price","Today","RS vs SPY","Score","vs 50MA","vs 200MA","From High","Vol","Rating","Action"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {stocks.map((q,i)=>{
                const isOn = addedSet.has(q.ticker)||watchlist.includes(q.ticker);
                const { label:rating, col:rCol } = getRating(q.rs, true, true, q.pctFromHigh);
                const bCol = rCol==="green"?G:rCol==="yellow"?Y:rCol==="red"?R:C.accent;
                return (
                  <tr key={q.ticker} style={{ background:i%2===0?C.s1:C.bg, borderLeft:`4px solid ${bCol}` }}>
                    <td style={{ ...TD, fontFamily:F.base, fontWeight:800, fontSize:"18px", color:C.accent }}>{q.ticker}</td>
                    <td style={{ ...TD, fontFamily:F.mono }}>${q.price.toFixed(2)}</td>
                    <td style={{ ...TD, fontFamily:F.mono, color:q.changePct>=0?G:R, fontWeight:600 }}>{q.changePct>=0?"+":""}{q.changePct.toFixed(2)}%</td>
                    <td style={{ ...TD, minWidth:"170px" }}><RSBar value={q.rs}/></td>
                    <td style={{ ...TD, fontFamily:F.mono }}>{q.sc.toFixed(0)}</td>
                    <td style={TD}><Pill color="green" text="ABOVE"/></td>
                    <td style={TD}><Pill color="green" text="ABOVE"/></td>
                    <td style={{ ...TD, fontFamily:F.mono, color:q.pctFromHigh>-10?G:q.pctFromHigh>-20?Y:R, fontWeight:600 }}>{q.pctFromHigh.toFixed(1)}%</td>
                    <td style={{ ...TD, fontFamily:F.mono, color:q.volRatio>1.5?G:q.volRatio<0.7?R:C.dim }}>{q.volRatio?`${q.volRatio.toFixed(1)}x`:"—"}</td>
                    <td style={TD}><Pill color={rCol} text={rating}/></td>
                    <td style={TD}>{isOn
                      ? <span style={{ fontFamily:F.mono, fontSize:"13px", color:G }}>✓ On watchlist</span>
                      : <button onClick={()=>addToWL(q.ticker)} style={{ background:"rgba(0,232,122,0.1)", border:`1px solid rgba(0,232,122,0.3)`, color:G, padding:"7px 16px", cursor:"pointer", fontFamily:F.base, fontWeight:600, fontSize:"14px", borderRadius:"4px" }}>+ Add</button>
                    }</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── WATCHLIST PAGE ───────────────────────────────────────────────────────────
function WatchlistPage({ quotes, spyRS, watchlist, removeFromWL, loading, loaded, total }) {
  const rows = watchlist.map(t=>{
    const q = quotes[t];
    if (!q) return { ticker:t, rs:null };
    const rs     = q.ret3m-spyRS;
    const a50    = !!(q.ma50&&q.price>q.ma50);
    const a200   = !!(q.ma200&&q.price>q.ma200);
    const sc     = calcScore(q,spyRS);
    return { ...q, rs, aboveMa50:a50, aboveMa200:a200, sc };
  }).sort((a,b)=>(b.sc??-999)-(a.sc??-999));

  return (
    <div style={{ background:C.s1 }}>
      <div style={{ padding:"14px 22px", background:C.s2, borderBottom:`1px solid ${C.b1}`, display:"flex", gap:"24px", alignItems:"center", flexWrap:"wrap" }}>
        <span style={{ fontFamily:F.mono, fontSize:"13px", color:C.dim }}>
          Sorted by strength score · SPY baseline: {spyRS>=0?"+":""}{spyRS.toFixed(1)}% · {loading?<><Spinner size={11}/> {loaded}/{total} loading...</>:`${loaded}/${total} loaded`}
        </span>
        <span style={{ marginLeft:"auto", display:"flex", gap:"18px" }}>
          {[["STRONG",G],["WATCH",Y],["SPEC",C.accent],["WEAK",R]].map(([l,col])=>(
            <span key={l} style={{ fontFamily:F.mono, fontSize:"12px", color:col }}>● {l}</span>
          ))}
        </span>
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr>{["#","Ticker","Price","Today","RS vs SPY","vs 50MA","vs 200MA","From High","Vol","Rating","Remove"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((q,i)=>{
            const { label:rating, col:rCol } = getRating(q.rs, q.aboveMa50, q.aboveMa200, q.pctFromHigh);
            const bCol = rCol==="green"?G:rCol==="yellow"?Y:rCol==="red"?R:C.b1;
            return (
              <tr key={q.ticker} style={{ background:i%2===0?C.s1:C.bg, borderLeft:`4px solid ${bCol}` }}>
                <td style={{ ...TD, fontFamily:F.mono, color:C.dim }}>{i+1}</td>
                <td style={{ ...TD, fontFamily:F.base, fontWeight:800, fontSize:"18px", color:C.accent }}>{q.ticker}</td>
                <td style={{ ...TD, fontFamily:F.mono }}>{q.price?`$${q.price.toFixed(2)}`:<span style={{ color:C.dim }}>Loading...</span>}</td>
                <td style={{ ...TD, fontFamily:F.mono, color:(q.changePct??0)>=0?G:R, fontWeight:600 }}>{q.changePct!=null?`${q.changePct>=0?"+":""}${q.changePct.toFixed(2)}%`:"—"}</td>
                <td style={{ ...TD, minWidth:"180px" }}>{q.rs!=null?<RSBar value={q.rs}/>:<span style={{ fontFamily:F.mono, color:C.dim, fontSize:"13px", display:"flex", alignItems:"center", gap:"6px" }}><Spinner size={11}/> Loading...</span>}</td>
                <td style={TD}>{q.aboveMa50!=null?<Pill color={q.aboveMa50?"green":"red"} text={q.aboveMa50?"ABOVE":"BELOW"}/>:"—"}</td>
                <td style={TD}>{q.aboveMa200!=null?<Pill color={q.aboveMa200?"green":"red"} text={q.aboveMa200?"ABOVE":"BELOW"}/>:"—"}</td>
                <td style={{ ...TD, fontFamily:F.mono, color:q.pctFromHigh>-10?G:q.pctFromHigh>-25?Y:R, fontWeight:600 }}>{q.pctFromHigh!=null?`${q.pctFromHigh.toFixed(1)}%`:"—"}</td>
                <td style={{ ...TD, fontFamily:F.mono, color:q.volRatio>1.5?G:q.volRatio<0.7?R:C.dim }}>{q.volRatio?`${q.volRatio.toFixed(1)}x`:"—"}</td>
                <td style={TD}>{q.rs!=null?<Pill color={rCol} text={rating}/>:"—"}</td>
                <td style={TD}><button onClick={()=>removeFromWL(q.ticker)} style={{ background:"rgba(255,68,85,0.08)", border:`1px solid rgba(255,68,85,0.2)`, color:R, padding:"7px 14px", cursor:"pointer", fontFamily:F.base, fontWeight:600, fontSize:"14px", borderRadius:"4px" }}>✕ Remove</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ATR CALCULATOR ───────────────────────────────────────────────────────────
function ATRPage({ quotes }) {
  const [ticker,   setTicker]   = useState("NVDA");
  const [account,  setAccount]  = useState("50000");
  const [riskPct,  setRiskPct]  = useState("2");
  const [useManual,setUseManual]= useState(false);
  const [manual,   setManual]   = useState("");
  const [res,      setRes]      = useState(null);
  const [busy,     setBusy]     = useState(false);

  const calc = async () => {
    setBusy(true); setRes(null);
    const tk = ticker.toUpperCase();
    let q = quotes[tk] || await fetchQuote(tk);
    if (!q?.atr) { setRes({ err:`Could not load ATR data for ${tk}. Try again.` }); setBusy(false); return; }
    const entry = useManual&&parseFloat(manual)>0 ? parseFloat(manual) : q.price;
    const acc   = parseFloat(account)||50000;
    const risk  = parseFloat(riskPct)/100;
    const stop  = entry - 2*q.atr;
    const t1    = entry + 3*q.atr;
    const t2    = entry + 6*q.atr;
    const rps   = entry - stop;
    const maxR  = acc*risk;
    const shares = Math.floor(maxR/rps);
    const total  = shares*entry;
    const posPct = (total/acc)*100;
    const rr     = (t1-entry)/rps;
    setRes({ livePrice:q.price, entry, atr:q.atr, stop, t1, t2, shares, total, posPct, rr, rps, maxR, usedManual:useManual&&parseFloat(manual)>0 });
    setBusy(false);
  };

  const inp = { background:C.s2, border:`1px solid ${C.b2}`, color:C.bright, padding:"14px 18px", fontFamily:F.base, fontSize:"17px", outline:"none", width:"100%", boxSizing:"border-box", borderRadius:"6px" };

  return (
    <div style={{ padding:"28px", background:C.s1 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:"14px", alignItems:"start", marginBottom:"8px" }}>
        {[["TICKER",ticker,v=>setTicker(v.toUpperCase()),"text"],["ACCOUNT SIZE ($)",account,setAccount,"number"],["RISK PER TRADE (%)",riskPct,setRiskPct,"number"]].map(([l,v,s,t])=>(
          <div key={l}><div style={lbl}>{l}</div><input style={inp} value={v} onChange={e=>s(e.target.value)} type={t} onKeyDown={e=>e.key==="Enter"&&calc()}/></div>
        ))}
        <div style={{ paddingTop:"28px" }}>
          <button onClick={calc} disabled={busy} style={{ background:C.accent, color:C.bg, border:"none", padding:"14px 30px", fontFamily:F.base, fontWeight:700, fontSize:"17px", cursor:busy?"not-allowed":"pointer", borderRadius:"6px", height:"56px" }}>
            {busy?"...":"Calculate"}
          </button>
        </div>
      </div>

      <label style={{ display:"flex", alignItems:"center", gap:"10px", cursor:"pointer", fontFamily:F.base, fontSize:"15px", color:C.dim, marginBottom:"24px", userSelect:"none" }}
        onClick={()=>setUseManual(!useManual)}>
        <div style={{ width:"20px", height:"20px", border:`2px solid ${useManual?C.accent:C.b2}`, borderRadius:"4px", background:useManual?C.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", flexShrink:0 }}>
          {useManual&&<span style={{ color:C.bg, fontSize:"13px", fontWeight:700 }}>✓</span>}
        </div>
        Use a custom entry price instead of live price
      </label>
      {useManual && <div style={{ marginBottom:"20px", maxWidth:"280px" }}><div style={lbl}>MY ENTRY PRICE ($)</div><input style={inp} value={manual} onChange={e=>setManual(e.target.value)} type="number" step="0.01" placeholder="e.g. 185.50"/></div>}

      {res&&!res.err&&(
        <div style={{ background:C.s2, border:`1px solid ${C.b2}`, padding:"28px", borderRadius:"8px" }}>
          {res.usedManual&&<div style={{ marginBottom:"14px", padding:"10px 16px", background:"rgba(0,212,255,0.06)", border:`1px solid rgba(0,212,255,0.2)`, borderRadius:"6px", fontFamily:F.base, fontSize:"14px", color:C.accent }}>Using custom entry ${res.entry.toFixed(2)} (live: ${res.livePrice.toFixed(2)})</div>}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"2px", marginBottom:"24px" }}>
            {[["Entry Price",`$${res.entry.toFixed(2)}`,C.accent],["Stop Loss (−2 ATR)",`$${res.stop.toFixed(2)}`,R],["Target 1 (+3 ATR)",`$${res.t1.toFixed(2)}`,G],["Target 2 (+6 ATR)",`$${res.t2.toFixed(2)}`,G]].map(([l,v,col])=>(
              <div key={l} style={{ background:C.s1, padding:"18px 22px", borderRadius:"4px" }}>
                <div style={lbl}>{l}</div>
                <div style={{ fontFamily:F.base, fontSize:"30px", fontWeight:800, color:col, marginTop:"6px" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"20px", marginBottom:"18px" }}>
            {[["Shares to Buy",res.shares,C.bright],["Total Position",`$${res.total.toFixed(0)} (${res.posPct.toFixed(1)}%)`,res.posPct>15?R:C.bright],["Max Risk $",`$${res.maxR.toFixed(0)}`,R],["Reward / Risk",`${res.rr.toFixed(1)} : 1`,res.rr>=2?G:R]].map(([l,v,col])=>(
              <div key={l}><div style={lbl}>{l}</div><div style={{ fontFamily:F.base, fontSize:"28px", fontWeight:800, color:col, marginTop:"6px" }}>{v}</div></div>
            ))}
          </div>
          <div style={{ padding:"14px 18px", background:"rgba(0,212,255,0.05)", border:`1px solid rgba(0,212,255,0.15)`, borderRadius:"6px", fontFamily:F.base, fontSize:"15px", color:C.dim }}>
            ATR = ${res.atr.toFixed(2)}  ·  Risk per share = ${res.rps.toFixed(2)}  ·  {" "}
            <strong style={{ color:res.posPct>15?R:res.rr<2?R:G }}>
              {res.posPct>15?"⚠ Position >15% of portfolio — reduce shares":res.rr<2?"⚠ Reward/risk below 2:1 — skip this trade":"✓ Setup within your risk rules"}
            </strong>
          </div>
        </div>
      )}
      {res?.err&&<div style={{ padding:"18px", background:"rgba(255,68,85,0.05)", border:`1px solid rgba(255,68,85,0.2)`, borderRadius:"6px", fontFamily:F.base, fontSize:"16px", color:R }}>{res.err}</div>}
      <div style={{ marginTop:"24px", fontFamily:F.base, fontSize:"15px", color:C.dim, lineHeight:"2.1" }}>
        💡 <strong style={{ color:C.text }}>ATR</strong> = Average True Range — how much the stock moves per day on average.<br/>
        <strong style={{ color:C.text }}>Stop Loss</strong> = Entry − 2×ATR. Room to breathe without stopping you out too early.<br/>
        <strong style={{ color:C.text }}>Target 1</strong> = Entry + 3×ATR = 3:1 reward vs risk.  <strong style={{ color:C.text }}>Shares</strong> = (Account × Risk%) ÷ (Entry − Stop).
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [quotes,      setQuotes]      = useState({});
  const [scanLoading, setScanLoading] = useState(true);
  const [scanDone,    setScanDone]    = useState(0);
  const [scanTotal,   setScanTotal]   = useState(0);
  const [fromCache,   setFromCache]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab,         setTab]         = useState("premarket");
  const [watchlist,   setWatchlist]   = useState(readWL);
  const [addedSet,    setAddedSet]    = useState(new Set());

  // Unique tickers needed: scan universe + SPY + QQQ + watchlist
  const allTickers = [...new Set(["SPY","QQQ",...watchlist,...ALL_SCAN_TICKERS])];

  const runScan = useCallback(async (force=false) => {
    setScanLoading(true); setScanDone(0); setScanTotal(allTickers.length);
    if (!force) {
      const cached = readScanCache();
      if (cached) {
        setQuotes(cached); setFromCache(true);
        setLastUpdated(new Date()); setScanLoading(false);
        setScanDone(Object.keys(cached).length);
        return;
      }
    }
    setFromCache(false);
    const results = {};

    // 1. Priority: SPY, QQQ, watchlist first — sequential, one at a time
    const priority = ["SPY","QQQ",...watchlist];
    for (const t of priority) {
      const q = await fetchQuote(t, 2);
      if (q) { results[t]=q; setQuotes(prev=>({...prev,[t]:q})); }
      setScanDone(prev=>prev+1);
      await sleep(400); // 400ms between each = reliable
    }

    // 2. Scan universe — sequential, one at a time, 350ms gap
    const remaining = ALL_SCAN_TICKERS.filter(t=>!priority.includes(t));
    for (const t of remaining) {
      const q = await fetchQuote(t, 1); // 1 retry only for scan tickers
      if (q) { results[t]=q; setQuotes(prev=>({...prev,[t]:q})); }
      setScanDone(prev=>prev+1);
      await sleep(350);
    }

    writeScanCache(results);
    setLastUpdated(new Date());
    setScanLoading(false);
  }, [watchlist]);

  useEffect(() => { runScan(); }, []);

  const addToWL = (ticker) => {
    if (watchlist.includes(ticker)) return;
    const u=[...watchlist,ticker]; setWatchlist(u); writeWL(u);
    setAddedSet(p=>new Set([...p,ticker]));
  };
  const removeFromWL = (ticker) => { const u=watchlist.filter(t=>t!==ticker); setWatchlist(u); writeWL(u); };

  const spy    = quotes["SPY"];
  const qqq    = quotes["QQQ"];
  const spyRS  = spy?.ret3m || 0;
  const wlLoaded = watchlist.filter(t=>quotes[t]);
  const totalHits = (() => {
    let n=0;
    Object.values(SCAN_UNIVERSE).forEach(tickers=>{ tickers.forEach(t=>{ if(quotes[t]&&passes(quotes[t],spyRS)&&!watchlist.includes(t)) n++; }); });
    return n;
  })();

  const TABS = [
    ["premarket", "🌅  Pre-Market"],
    ["scanner",   `🔍  Scanner ${scanLoading?"…":"("+totalHits+")"}`],
    ["watchlist", "📈  Watchlist"],
    ["atr",       "🎯  ATR Calculator"],
  ];

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:F.base }}>
      <style>{spin}</style>

      {/* HEADER */}
      <div style={{ background:C.s2, borderBottom:`2px solid ${C.b2}`, padding:"18px 28px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:F.base, fontSize:"24px", fontWeight:800, color:C.accent }}>⬡ QUANT MASTER V3.1</div>
          <div style={{ fontFamily:F.mono, fontSize:"11px", color:C.dim, letterSpacing:"2px", marginTop:"4px" }}>NATHALIE'S COMMAND CENTER · {ALL_SCAN_TICKERS.length}+ STOCKS</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
          {scanLoading && (
            <div style={{ display:"flex", alignItems:"center", gap:"8px", fontFamily:F.mono, fontSize:"12px", color:C.accent }}>
              <Spinner size={14}/>
              <span>{scanDone}/{scanTotal} stocks loaded</span>
              <div style={{ width:"120px", height:"5px", background:C.b1, borderRadius:"3px", overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${scanTotal>0?(scanDone/scanTotal*100):0}%`, background:C.accent, transition:"width 0.3s" }}/>
              </div>
            </div>
          )}
          {fromCache && <div style={{ fontFamily:F.mono, fontSize:"11px", color:C.dim, background:C.s1, padding:"6px 12px", borderRadius:"4px", border:`1px solid ${C.b1}` }}>✓ Cached</div>}
          <button onClick={()=>runScan(true)} disabled={scanLoading} style={{ background:"transparent", color:C.accent, border:`1px solid ${C.b2}`, padding:"9px 18px", fontFamily:F.base, fontWeight:600, fontSize:"14px", cursor:scanLoading?"not-allowed":"pointer", borderRadius:"6px" }}>
            ↻ Force Rescan
          </button>
          {lastUpdated && <div style={{ fontFamily:F.mono, fontSize:"11px", color:C.dim, textAlign:"right" }}>
            <div>{lastUpdated.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
            <div>{lastUpdated.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
          </div>}
        </div>
      </div>

      {/* TABS */}
      <div style={{ display:"flex", gap:"2px", background:C.b1 }}>
        {TABS.map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ padding:"16px 24px", border:"none", cursor:"pointer", fontFamily:F.base, fontWeight:tab===id?700:500, fontSize:"16px", background:tab===id?C.s1:C.bg, color:tab===id?C.accent:C.dim, borderBottom:tab===id?`3px solid ${C.accent}`:"3px solid transparent" }}>
            {label}
          </button>
        ))}
      </div>

      {tab==="premarket"  && <PreMarketPage  scanQuotes={quotes} />}
      {tab==="scanner"    && <ScannerPage    quotes={quotes} spyRS={spyRS} watchlist={watchlist} addToWL={addToWL} addedSet={addedSet}/>}
      {tab==="watchlist"  && <WatchlistPage  quotes={quotes} spyRS={spyRS} watchlist={watchlist} removeFromWL={removeFromWL} loading={scanLoading} loaded={wlLoaded.length} total={watchlist.length}/>}
      {tab==="atr"        && <ATRPage        quotes={quotes}/>}

      <div style={{ padding:"14px 24px", borderTop:`1px solid ${C.b1}`, display:"flex", justifyContent:"space-between", fontFamily:F.mono, fontSize:"11px", color:"#1A3A5C" }}>
        <span>QUANT MASTER V3.1 · NATHALIE'S TRADING COMMAND CENTER</span>
        <span>DATA: YAHOO FINANCE · EDUCATIONAL USE ONLY · NOT FINANCIAL ADVICE · ALL ORDERS MANUAL IN FUTU</span>
      </div>
    </div>
  );
}
