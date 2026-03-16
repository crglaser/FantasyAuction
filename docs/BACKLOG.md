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
- **Draft Undo** — 10-pick undo stack, ↩ UNDO button in header
- **Periodic Auto-Backup** — configurable N-pick auto-download of JSON backup
- **ROSTER SCOUT tab** — position depth, top-N available per position, editable targets, right sidebar
- **DATA AUDIT tab** — stat/value mismatches, large rank disagreements, missing source data sections
- **AUC $ column** — now shows raw CheatSheet value; ADJ $ (snake-discounted) is a toggleable column
- **Negative value display** — below-replacement players shown in red throughout
- **85 seed value corrections** — Steamer-ratio values replaced with actual auction_values.csv negatives
- **115 unofficial pitcher revaluations** — k-NN against seed comps to produce CS-consistent values
- **87 unofficial batter revaluations** — same k-NN approach
- **Hide Sub-Rep filter** — checkbox (on by default) hides csValS ≤ 0 players from all tabs
- **MI/CI position filter fix** — correctly matches 2B/SS and 1B/3B respectively

---

## 🚨 Pre-Draft Checklist (Do Before Tuesday)

- [ ] Run `python3 scripts/fetch_rankings.py` for fresh ECR + ESPN + CloserMonkey data
- [ ] Run `python3 scripts/update_injuries.py --summarize` if ANTHROPIC_API_KEY is set
- [ ] Verify auto-backup interval is set (Settings → backup every 10 picks)
- [ ] Set snake draft order in SNAKE ORDER tab before auction starts
- [ ] Test share link loads correctly in a second browser
- [ ] Confirm browser localStorage is not cleared between sessions

---

## 🛡 Mission Critical: Data Survival

### Fantrax Console Recovery Script
- **Concept**: A JS snippet to paste into the Fantrax "Team Rosters" browser console to export current rosters as JSON that can be re-imported into the tool.
- **Value**: "Break Glass" feature to restore state if browser data is ever lost mid-draft.

---

## 🎯 High Priority (Nice Before / Soon After Draft)

### Realistic Draft Simulation
- **Concept**: Budget-constrained auction sim where each team gets a randomized hit/pitch split strategy (55–75%), bids up to some fraction of remaining budget with noise, drops out when price > valuation. Snake portion stays as-is.
- **Value**: Standings projections become believable — teams that overspend on studs run dry late, producing realistic roster imbalances.
- **Current state**: Round-robin best-available with no budget enforcement.

### Historical Draft Intelligence — Team Styles & Price Prediction
- **Concept**: Import prior year(s) draft results (player, final price, team) and derive behavioral profiles per team. Two outputs: (1) **Team style cards** — e.g. "Barry tends to overpay for closers, underspends on OF, goes stars-and-scrubs"; (2) **Price prediction** — given a player's CS value and position, estimate what they'll actually go for based on historical closing prices vs. projected values.
- **Data needed**: Past auction results CSV (player, cost, team). Fantrax may export this, or it could be manually entered once.
- **Value**: Knowing Brian overbids on SPs by 20% on average is a real edge — you can let him have them and redirect budget. Price prediction turns "this guy is worth $24" into "this guy will probably go for $31 in this room."
- **AI angle**: Historical patterns + current roster construction of each team = rich context for the AI advisor to give live auction advice ("Barry still needs a closer and has $60 left — expect him to go high on Miller").
- **Connects to**: Realistic Draft Simulation (feed team style profiles into the sim for more accurate opponent behavior).

### Nomination Queue / Watch List
- **Concept**: Mark players as "want to nominate" or "watching" with a priority order. Surface as a sidebar or dedicated view during the draft.
- **Value**: In the chaos of a live auction you lose track of which players to nominate next. A queue lets you plan 3–4 nominations ahead.

### Budget Pacing Indicator
- **Concept**: Show how much budget each team *should* have spent by now (% of roster filled × $202), vs. actual. Red if over-pacing, green if underpacing.
- **Value**: Real-time signal of who is running out of money or who has ammo left to outbid you.

### Keyboard Shortcuts
- **Concept**: `/` to focus search, `Escape` to close modal, number keys to quickly set bid amount.
- **Value**: Speed during fast-paced auction; reduces mouse dependency.

---

## 📈 Dashboard & Visualization

### My Team / League Dashboard Merge
- **Concept**: Option 3 or 4 from earlier discussion — add league-relative context to My Team, or merge with Standings into a single dashboard view.
- **Goal**: Eliminate ambiguity between My Team and League Tracker tabs.

### Market Price Validation (Red Flags)
- **Concept**: Flag players where CS value disagrees with market (ECR/ESPN $) by >50%.
- **Goal**: Spot "Bad Data Traps" or extreme "Arbitrage Steals" during the draft.

### Match Confidence Score (🟢/🟡/🔴)
- **Concept**: Indicator per player showing how many sources successfully matched (ESPN, ECR, CS, Steamer).
- **Goal**: Instantly see which valuations are well-vetted vs potentially buggy.

---

## 🏟 Post-Draft & Season Management (v2.0)

### Trade Analyzer ("What-If" Mode)
- **Concept**: Swap players between teams and see the immediate impact on projected Roto standings.
- **Goal**: Win every trade by knowing exactly how many standing points it gains/loses.

### Fantrax Live Roster Sync
- **Concept**: Pull actual owned/unowned status from Fantrax API or console script to keep the board accurate mid-season.

---

## 📊 New Data Sources

### Statcast Integration (Baseball Savant)
- **Concept**: Add Expected Stats (xBA, xSLG, Hard Hit %) to the player detail/injury modal.
- **Goal**: Identify "bad luck" players who are prime buy-low candidates.

### Baseball Prospectus (PECOTA)
- **Concept**: Incorporate PECOTA valuations alongside Steamer and our Z-scores.
- **Goal**: Blended "Market Intelligence" consensus value.
