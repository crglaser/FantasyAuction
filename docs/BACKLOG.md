# Teddy Ballgame Tool Backlog

This document tracks planned features and data integrity improvements for the Teddy Ballgame Fantasy Baseball Draft Tool.

## 🛡 Mission Critical: Data Survival & Entry (Draft Day Essentials)

### Draft Undo / History
- **Concept**: A quick way to revert the last pick or view a history of all logged picks.
- **Value**: Prevents corrupting the state with a typo during the fast-paced auction.

### Fantrax Console Recovery Script
- **Concept**: A small JavaScript snippet you paste into the Fantrax "Team Rosters" console to export current rosters as JSON.
- **Value**: A "Break Glass" feature to instantly restore the tool's state if browser data is ever lost.

### Automated Cloud-Packed Sharing
- **Concept**: Further harden the Bit-Packed link generator.
- **Value**: Keep a second "Hot Standby" browser open on another device in case of a crash.

### Periodic Auto-Backup
- **Concept**: Automatically trigger a JSON configuration download every 10 picks.
- **Value**: Ensures a local hard-copy of the draft progress exists on your hard drive.

---

## 🛡 Data Quality & Integrity (High Priority)

### Market Price Validation (Discordance Red Flags)
- **Concept**: Flag players (🚩) where our custom Z-Score/Cheat Sheet value disagrees with the market (ECR/ESPN Auction $) by more than 50%.
- **Goal**: Spot "Bad Data Traps" or identify extreme "Arbitrage Steals" during the draft.

### Match Confidence Score (🟢/🟡/🔴)
- **Concept**: Add a confidence indicator to each player row based on successful ID mapping across multiple sources (ESPN, ECR, Steamer).
- **Goal**: Instantly identify which player valuations are most "vetted" versus potentially buggy name-matches.

### Projection Sanity Shield
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

---

## 🏟 Post-Draft & Season Management (v2.0.0)

### Trade Analyzer (The "What-If" Mode)
- **Concept**: Swap players between teams and see the immediate impact on projected Roto standings.
- **Goal**: Win every trade by knowing exactly how many points it gains you in the standings.

---

## 📊 New Data Sources

### Statcast Integration (Baseball Savant)
- **Points**: Add "Expected Stats" (xBA, xSLG, Hard Hit %).
- **Goal**: Identify "Bad Luck" players who are prime buy-low candidates mid-season.

### Baseball Prospectus (PECOTA)
- **Points**: Incorporate BP valuations into the "Market Weighted Consensus Value."
- **Goal**: Reach the ultimate "Market Intelligence" by blending Steamer, PECOTA, and our Z-Scores.
