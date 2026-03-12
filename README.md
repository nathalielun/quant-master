# Quant Master V3.1 — Nathalie's Trading Command Center

## What this does
- Live RS Momentum leaderboard for your full watchlist (ranked vs SPY baseline)
- Market breadth gauge (% of watchlist above 50-day MA)
- Market regime indicator (Bull/Bear based on SPX vs 200MA)
- ATR-based auto stop-loss & position size calculator
- Pre-market checklist
- Portfolio tracker (NBIS + NVDA)

---

## HOW TO DEPLOY (5 minutes, free)

### Step 1 — Create a GitHub account
Go to https://github.com and sign up (free). You only need to do this once.

### Step 2 — Upload this folder to GitHub
1. Go to https://github.com/new
2. Repository name: `quant-master`
3. Click **Create repository**
4. Click **uploading an existing file**
5. Drag the entire `quant-dashboard` folder contents into the upload area
6. Click **Commit changes**

### Step 3 — Deploy to Vercel
1. Go to https://vercel.com and click **Sign up with GitHub**
2. Click **Add New Project**
3. Select your `quant-master` repository
4. Click **Deploy** (all settings are auto-detected)
5. Wait ~2 minutes — you'll get a URL like `quant-master-abc123.vercel.app`

That's it! Open the URL on any device. It's live with real data.

---

## How to update your watchlist
Open `src/App.js` and edit the `WATCHLIST_PRIMARY` array at the top.
Then re-upload to GitHub — Vercel auto-rebuilds in 2 minutes.

---

## Data source
Yahoo Finance (free, no API key needed). Refreshes when you click the ↻ button.

---

*All orders must be placed manually in Futu. This system never executes trades.*
