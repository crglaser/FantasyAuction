# ⚾ Teddy Ballgame Fantasy Baseball Draft Tool 2026

A high-performance, dark-themed draft dashboard for the Teddy Ballgame Fantasy Baseball League.

### 🌐 Live Tool
**[Launch Draft Tool](https://crglaser.github.io/FantasyAuction/)**

---

## 🚀 Features

*   **Dual-Context Valuation**: Track both Auction values (110-player pool) and Full-Season values (310-player pool) simultaneously.
*   **Arbitrage Engine**: Instantly spot "Buys" vs "Traps" based on the delta between auction and season-long ROI.
*   **Live Conversational Assistant**: Log drafts via natural language (e.g., `"Judge to Teddy Ballgames 45"`).
*   **AI-Ready**: One-click "Copy for AI" context generator for deep strategy advice from Gemini/Claude.
*   **Category Stands**: Real-time progress bars for all 10 Roto categories (HR, OBP, RP, SB, XBH | W, K, ERA, SVH, WHIP).
*   **IP Floor Monitor**: Persistent HUD tracking the critical 1,000 IP league minimum.
*   **Custom Z-Score Logic**: Built-in engine for dynamic positional scarcity and graduated snake draft discounts.

## Data Refresh

The tool ships with pre-baked player data. To update it during the season:

```bash
# Refresh ECR, ESPN auction prices, CloserMonkey depth charts, and manual CSV rankings
python3 scripts/fetch_rankings.py

# Refresh unofficial Steamer projections for fringe players
python3 scripts/generate_extras.py
```

**What each command does:**
- `fetch_rankings.py` — Pulls FantasyPros ECR consensus rankings, ESPN fantasy auction values, and CloserMonkey closer depth charts. Then automatically re-bakes `data/manual/*.csv` into `js/data/manual_rankings.js`. Run weekly during draft prep.
- `generate_extras.py` — Reads FanGraphs Steamer projections and generates unofficial value estimates for ~115 fringe pitchers not in the main player pool. These appear muted (with an "est" badge) in the auction board.

**Adding custom data columns:**
Drop a column into any file in `data/manual/` — e.g., add `PL_Rank` to `sp_rankings.csv` — then run `bake_manual.py`. The new column automatically appears as a toggleable column in the auction board.

**Rebuilding player IDs** (once per season or after adding players to seed.js):
```bash
python3 scripts/fetch_rankings.py --ids  # slower: rebuilds ESPN/FanGraphs ID crosswalk via Chadwick Bureau
```

## 🛠 Tech Stack

*   **Vanilla JavaScript (ES6)**: No build steps, light and fast.
*   **CSS3 Grid/Flexbox**: Responsive dark theme UI.
*   **LocalStorage Persistence**: Draft data is saved automatically in your browser.
*   **CSV Integration**: Custom robust parser for Mr. CheatSheet spreadsheet exports.

## 📁 Project Structure

*   `/js/engine`: Core logic (Z-scores, state management, conversational assistant).
*   `/js/ui`: Dynamic component rendering and event handling.
*   `/js/data`: Data loading and CSV parsing.
*   `/assets`: Default league CSV data and rules documentation.

## ⚙️ How to Use

1.  **Initialize**: Open the live link or `index.html`.
2.  **Import**: The tool auto-loads the 2026 Teddy Ballgame defaults. You can override them via the **IMPORT DATA** tab.
3.  **Draft**: Click "DRAFT" on any player or use the **Live Assistant** text input.
4.  **Analyze**: Use the **My Team** and **Arbitrage** tabs to refine your strategy in real-time.

---
*Created for the 2026 Teddy Ballgame Draft Phase.*
