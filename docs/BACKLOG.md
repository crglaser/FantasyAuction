# Teddy Ballgame Tool Backlog

This document tracks planned features and data integrity improvements for the Teddy Ballgame Fantasy Baseball Draft Tool.

## 🛡 Data Quality & Integrity (High Priority)

### Match Confidence Score (🟢/🟡/🔴)
- **Concept**: Add a confidence indicator to each player row based on successful data mapping.
- **Logic**:
    - **High (3/3)**: ID matched across ESPN, ECR, and Steamer.
    - **Medium (2/3)**: Matched only 2 sources.
    - **Low (1/3)**: Name-match only (needs manual verification).
- **Goal**: Instantly identify which player valuations are most "vetted" versus potentially buggy.

### Market Price Validation (The Red Flag System)
- **Concept**: Flag players where our custom Z-Score/Cheat Sheet value disagrees with the market (ECR/ESPN Auction $) by more than 50%.
- **Goal**: Spot "Bad Data Traps" or identify extreme "Arbitrage Steals" during the draft.

### Projection Sanity Checks
- **Concept**: Automated flagging of impossible projections (e.g., >750 PA, >220 IP, or elite stats with a $0 valuation).
- **Goal**: Prevent drafting based on spreadsheet glitches.

---

## 📈 Dashboard & Visualization (v1.6.0)

### Relative Category Standings
- **Concept**: Recalibrate the "My Team" progress bars to be **Relative to the League Leader** for each category.
- **Goal**: Instead of fixed maximums, show where your team sits in the *distribution* of all 10 teams.

### SCOUT Badge Hover Tooltips
- **Concept**: Add mouseover tooltips to the unified SCOUT badge.
- **Content**: Show raw Tier, Rank, and Status from the source (PitcherList, CloserMonkey, HitterList).

---

## 🐍 Draft Strategy Tools

### Snake Draft Planner
- **Concept**: A dedicated tab that identifies remaining roster needs (e.g., "Need 2 OF, 1 SP") and suggests the **Top 3 Best Value** available players for those specific empty slots.
- **Goal**: Seamless transition from the high-stakes auction into the late-round snake.

### Inflation Tracker
- **Concept**: A live indicator of the current "Inflation Rate" in the auction.
- **Goal**: See how overpays for superstars are increasing the effective price of the remaining mid-tier talent.

---

## 🏟 Post-Draft & Season Management (v2.0.0)

### Fantrax Roster Sync
- **Concept**: A copy-paste console script for Fantrax to instantly update all 10 team rosters in the tool.
- **Goal**: Eliminate manual data entry for trades and FAAB pickups after the draft ends.

### Trade Analyzer (The "What-If" Mode)
- **Concept**: Swap players between teams and see the immediate impact on projected Roto standings.
- **Goal**: Win every trade by knowing exactly how many points it gains you in the standings.

### FAAB Budget Manager
- **Concept**: Track the remaining $400 FAAB for every team to predict opponent bidding power.

---

## 📊 New Data Sources

### Statcast Integration (Baseball Savant)
- **Points**: Add "Expected Stats" (xBA, xSLG, Hard Hit %).
- **Goal**: Identify "Bad Luck" players who are prime buy-low candidates mid-season.

### Baseball Prospectus (PECOTA)
- **Points**: Incorporate BP valuations into the "Market Weighted Consensus Value."
- **Goal**: Reach the ultimate "Market Intelligence" by blending Steamer, PECOTA, and our Z-Scores.
