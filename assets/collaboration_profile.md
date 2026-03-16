# Craig Glaser — Collaboration Profile

## Who He Is

Craig is a co-owner of "Chathams" in the Teddy Ballgame Fantasy Baseball League — a highly competitive 10-team roto league with a hybrid auction/snake format. He has deep domain expertise in fantasy baseball: he knows the players, understands roto strategy, follows injury news, and has strong opinions on value. He's been playing long enough to know what he doesn't know, and to build tools to help him win.

He's technically fluent without being a software engineer. He can read code, understands what a script does when you describe it, and knows enough to ask the right questions — but he's not writing the JS himself. He treats Claude as a capable technical collaborator, not a code generator to be micromanaged.

## How He Likes to Work

**Outcome-first.** Craig describes what he wants in terms of results, not specifications. "I want to see the best deals at each price point" is the brief — figuring out the right control and where it lives is Claude's job.

**Iterative and real-time.** He uses the tool as it's being built and catches things immediately. "Those are negative values!" came from actually looking at the auction board, not from reading a spec. The feedback loop is tight.

**Direct and concise.** Short messages, no preamble. He knows what he wants. He'll push back clearly when something is wrong and move on quickly when it's right.

**Trusts judgment on implementation.** He rarely specifies which file, which function, or what data structure. He expects Claude to understand the existing patterns and fit new features in cleanly. He notices when it isn't clean.

**Good at pinning things.** He knows the difference between "must fix before Tuesday" and "interesting idea for later." He'll explicitly say "let's put a pin in that" and expect it to go on the backlog, not get ignored.

**Thinks out loud about design.** He'll share half-formed ideas and expect a sounding board response, not immediate code. "I like 3 and 4, let's hold for now" is a real outcome of a design conversation.

## What He Cares About

- **Data integrity above all.** The tool is only useful if the numbers are right. When we discovered 85 players had inflated values from the wrong source, fixing that was immediately the most important thing in the world.
- **Not getting fooled during the auction.** Every data check, every red-display for negative values, every sanity badge exists because Craig is sitting at a fast-paced live auction and cannot afford to glance at a number and trust it blindly.
- **Winning the league.** The tool exists to give him an edge. Features that don't serve that goal go to the backlog.

## How We Collaborated to Build This

The project started as a Mr. CheatSheet viewer and became a full draft intelligence platform over many iterative sessions. The collaboration pattern was consistent throughout:

1. Craig identifies a gap ("I need to see where guys rank on CloserMonkey")
2. Claude explores the codebase, finds the right integration point, implements
3. Craig tests live and gives immediate feedback ("that column is too wide" / "the values look wrong")
4. Rinse, repeat

The most valuable sessions weren't feature additions — they were audits. Craig trusting Claude to do a deep data integrity review, and Claude finding that 85 seed players had Steamer-derived values that were $20+ too high, was the kind of collaboration that actually changes draft outcomes.

The working style is close to pair programming with an expert domain owner driving and a technical implementer executing — except the "pair" has instant access to every file, can run Python scripts, and never loses context between the auction board and the data pipeline.

## His Instincts Are Usually Right

When Craig says "I think Kikuchi seems too high" he's right. When he says "those negative values could be a very big mistake during the auction" he's right. When he says "I wouldn't mind a more realistic simulation but it's not that important" — that's also right. The instinct calibration is good. Claude's job is mostly to make the instinct actionable fast.
