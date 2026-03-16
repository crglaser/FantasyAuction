# Teddy Ballgame Draft Tool — 3-Minute Demo Script

**Audience:** Leaguemates, fantasy baseball players, anyone curious about the tool
**Tone:** Confident, practical — this is a working tool built for a real draft on Tuesday

---

## 0:00 — The Problem (20 seconds)

> "We've got a $202 auction budget, 17 players to buy, and a room full of people who've been preparing for months. The difference between winning and losing often comes down to one or two picks — paying $5 too much for a guy, or missing that a closer situation changed. This tool exists to make sure that doesn't happen."

Open the tool. The auction board loads with ~300 players.

---

## 0:20 — The Auction Board (45 seconds)

> "This is the main board. Every player is sorted by their Mr. CheatSheet auction value — our baseline for what they're worth."

Point out:
- **Gold AUC $** = exact CheatSheet value, no modification. What you see is what the sheet says.
- **Red AUC $** = below replacement value. These guys have no auction value — you'd only pick them up in the snake or FAAB. *"Before this tool, some of these were showing as $15 targets. That's the kind of mistake that costs you a championship."*
- The **(est)** badge — unofficial Steamer estimates for players CheatSheet didn't cover.

Use the filters:
- Switch to **SP** — instantly see only starting pitchers ranked by value
- **Hide Sub-Rep** is on by default — you're only seeing players worth owning at season end
- **Hide Drafted** — during the live auction you flip this on and the board updates in real time

Click a player to open the draft modal:
> "When a player gets nominated, I click their name, pick the team, enter the winning bid. The tool enforces budget constraints — it tells me the max anyone can bid based on what they've spent and how many slots they have left."

---

## 1:05 — Value Compare (40 seconds)

> "This is where the real edge is."

Switch to **VALUE COMPARE ★** tab.

> "Every player is scored against three independent sources — FantasyPros consensus rankings, ESPN's auction model, and our own z-score engine. When all three disagree with CheatSheet, that's a signal."

Point out the source badges (FTX▲, ECR▲) on a player:
> "This badge means Fantrax ranks him 30+ spots higher than CheatSheet does. That's a potential sleeper — the market might price him as a $12 player when he projects to perform like a $20 one."

Set **MIN AUC $** to 10:
> "I can filter to only show me deals among real auction targets — guys I'd actually spend money on. No point analyzing the value of a $3 player."

Hit **SLEEPERS ONLY**:
> "Now I'm looking at a short list of players where multiple sources think CheatSheet is leaving money on the table. This is my pre-draft target list."

---

## 1:45 — Draft Day Flow (30 seconds)

> "Once the auction is running, a few things keep me sane."

Show **MY TEAM** tab — projected category bars, budget remaining, roster slots.
> "At any point I can see where I'm strong and where I need to fill. The bars show where I rank in the league for each roto category, not just some arbitrary max."

Show **LEAGUE TRACKER** — all 10 teams' rosters visible.
> "Who's spent what, what positions they still need, where they might be desperate. Knowing Barry is out of outfielders and has $40 left tells me exactly how high he'll bid on the next OF who gets nominated."

Mention **↩ UNDO** in the header:
> "Fast auction, wrong player, wrong price — one click goes back up to 10 picks. And every 10 real picks it auto-saves a JSON backup to my hard drive."

---

## 2:15 — After the Auction (30 seconds)

Switch to **SNAKE ORDER** tab:
> "After the 17-round auction we go into a 14-round snake. I set the draft order here and the tool tracks whose pick it is automatically."

Switch to **ROSTER SCOUT**:
> "This shows me what positions I still need to fill and ranks the best available players for each slot. Going into round 8 needing a catcher, I can see instantly who's left."

Switch to **STANDINGS ★**:
> "And this is the payoff — projected roto standings for all 10 teams based on everyone's current roster. Hit SIMULATE DRAFT to fill all the empty slots and see a full-season projection. This tells me whether I'm in first or fifth before a single pitch is thrown."

---

## 2:45 — Close (15 seconds)

> "The data refreshes weekly from FantasyPros, ESPN, and CloserMonkey. Injury news pulls from Rotowire. It's a static site — no server, no account, just a URL I can open on draft day.

> Everything we drafted last year is recoverable from a JSON file. We'll be using this on Tuesday."

---

## Optional: If Asked How It Was Built

> "Claude built it. I described what I needed, reviewed what it produced, caught the things that were wrong. The data pipeline is Python scripts that pull from six different sources and bake everything into JavaScript files. The frontend is vanilla JS — no framework, no build step, just a GitHub Pages URL that loads in half a second."
