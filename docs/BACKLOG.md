# Teddy Ballgame Tool Backlog

This document tracks planned features and data integrity improvements for the Teddy Ballgame Draft Tool.

---

## ✅ Recently Completed

- **Scrollable My Team & League Tracker tabs** — flex/overflow fix, draftLog moved inside scroll region
- **Name search filter** on My Team and League Tracker tabs
- **Share URL fix** — shared state now loads after players are populated (was always empty)
- **Sleeper filter (VALUE COMPARE)** — SLEEPERS ONLY button; bidirectional FTX▲/ECR▲/CS▲ source badges
- **Edit auction picks correctly** — cost field forced visible when editing a pick that has cost > 0
- **UNDRAFT button** in draft modal when editing an existing pick
- **SCOUT badge hover tooltips** — `title` attribute on PL/HL/CM badges (Tier, Rank, source info)
- **CloserMonkey rank in badge** — CM_Rank auto-derived from row order in rp_rankings.csv
- **FTX ghost-entry fix** — bake_assets.py now skips zero-score/rank>1000 duplicate rows; keeps best rank per name collision
- **Snake Order tab** — set draft order, current-pick banner, 14-round snake board
- **Unified sim/real picks** — sim picks in same AppState.drafted with sim:true flag; editable like real picks

---

## 🛡 Mission Critical: Data Survival (Draft Day Essentials)

### Draft Undo / History
- **Concept**: Revert the last pick, or view a log of all picks in reverse order.
- **Value**: Prevents corrupting state during the fast-paced auction. Currently picks can be edited one at a time but there's no bulk undo.

### Fantrax Console Recovery Script
- **Concept**: A JS snippet to paste into the Fantrax "Team Rosters" browser console to export current rosters as JSON that can be imported back into the tool.
- **Value**: "Break Glass" feature to restore state if browser data is ever lost during the draft.

### Periodic Auto-Backup
- **Concept**: Automatically trigger a JSON export every N picks (configurable, e.g. every 10).
- **Value**: Local hard-copy of draft progress on your hard drive as insurance.

---

## 🛡 Data Quality & Integrity (High Priority)

### Projection Sanity Shield
- **Concept**: Flag players where stats are good but CS value is wildly low (e.g. Will Smith C at $2 with 18 HR). Already partially addressed by the sleeper badge system, but a dedicated audit script would help.
- **Goal**: Prevent drafting based on spreadsheet glitches.

### Market Price Validation (Red Flags)
- **Concept**: Flag players (🚩) where CS value disagrees with market (ECR/ESPN $) by >50%.
- **Goal**: Spot "Bad Data Traps" or extreme "Arbitrage Steals" during the draft.

### Match Confidence Score (🟢/🟡/🔴)
- **Concept**: Indicator per player row showing how many sources successfully matched (ESPN, ECR, FTX, Steamer).
- **Goal**: Instantly see which valuations are well-vetted vs potentially buggy.

---

## 📈 Dashboard & Visualization

### Relative Category Standings (My Team)
- **Concept**: Recalibrate the "My Team" progress bars to show where your team sits **relative to the league leader** for each category, not just a fixed max.
- **Goal**: Know at a glance if you're leading in HR or getting crushed in SB.

### Snake Draft Planner
- **Concept**: The Snake tab identifies remaining roster needs (e.g., "Need 2 OF, 1 SP") and suggests the **Top 3 best-value** available players for those slots.
- **Goal**: Seamless transition from the high-stakes auction into late-round snake picks.

---

## 🏟 Post-Draft & Season Management (v2.0)

### Trade Analyzer ("What-If" Mode)
- **Concept**: Swap players between teams and see the immediate impact on projected Roto standings.
- **Goal**: Win every trade by knowing exactly how many standing points it gains/loses.

---

## 📊 New Data Sources

### Statcast Integration (Baseball Savant)
- **Concept**: Add Expected Stats (xBA, xSLG, Hard Hit %) to the player detail/injury modal.
- **Goal**: Identify "bad luck" players who are prime buy-low candidates.

### Baseball Prospectus (PECOTA)
- **Concept**: Incorporate PECOTA valuations alongside Steamer and our Z-scores.
- **Goal**: Blended "Market Intelligence" consensus value.
