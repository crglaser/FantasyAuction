#!/usr/bin/env python3
"""
sync_projections.py — Sync seed.js player projections from FanGraphs Steamer.

Matches each seed.js player to FG Steamer via fgId (from player_ids.js),
then falls back to name matching. Updates stat fields and recalculates
csValA/csValS from FPTS × calibrated ratio.

Fallback chain if no FG match:
  1. ESPN auction value (from rankings.js espnAuction) — used for csValA only
  2. Keep existing seed values unchanged

Cache freshness:
  - data/cache/fg_steamer_pit.json and fg_steamer_bat.json
  - Re-fetched if older than 7 days, or with --refresh flag

Usage:
  python3 scripts/sync_projections.py          # use cache if < 7 days old
  python3 scripts/sync_projections.py --refresh  # force re-fetch from FG
  python3 scripts/sync_projections.py --dry-run  # print changes without writing
"""

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

FG_URL_PIT   = 'https://www.fangraphs.com/api/projections?type=steamer&stats=pit&pos=p&team=0&players=0&lg=all'
FG_URL_BAT   = 'https://www.fangraphs.com/api/projections?type=steamer&stats=bat&pos=all&team=0&players=0&lg=all'
FG_CACHE_PIT = Path('data/cache/fg_steamer_pit.json')
FG_CACHE_BAT = Path('data/cache/fg_steamer_bat.json')
SEED_FILE    = Path('js/data/seed.js')
IDS_FILE     = Path('js/data/player_ids.js')
RANKS_FILE   = Path('js/data/rankings.js')
CACHE_AGE_DAYS = 7


def name_key(n):
    decomposed = unicodedata.normalize('NFKD', n)
    ascii_n = decomposed.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]', '', ascii_n.lower())


def normalize_team(t):
    return {'KCR': 'KC', 'SFG': 'SF', 'TBR': 'TB', 'CHW': 'CWS',
            'WSN': 'WSH', 'SDN': 'SD', 'SDP': 'SD', 'ATH': 'OAK'}.get(t, t)


def cache_fresh(path):
    if not path.exists():
        return False
    age = (datetime.now(timezone.utc).timestamp() - path.stat().st_mtime) / 86400
    return age < CACHE_AGE_DAYS


def fetch_fg(url, cache_path, label):
    if cache_path.exists() and not args.refresh:
        age_days = (datetime.now(timezone.utc).timestamp() - cache_path.stat().st_mtime) / 86400
        if age_days < CACHE_AGE_DAYS:
            print(f'  Using cached {label} ({age_days:.1f} days old): {cache_path}')
            return json.loads(cache_path.read_text())
        else:
            print(f'  Cache stale ({age_days:.1f} days) — re-fetching {label}...')
    else:
        print(f'  Fetching {label} from FanGraphs...')

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([
        'curl', '-s', '--compressed',
        '-H', 'Referer: https://www.fangraphs.com/projections',
        '-H', 'User-Agent: Mozilla/5.0',
        url
    ], capture_output=True, text=True)
    data = json.loads(result.stdout)
    cache_path.write_text(json.dumps(data))
    print(f'  Fetched {len(data)} {label} rows → {cache_path}')
    return data


def load_js_object(path, var_name):
    """Extract a JS variable (object or array) from a .js file."""
    text = path.read_text(encoding='utf-8')
    m = re.search(rf'(?:const|var|let)\s+{re.escape(var_name)}\s*=\s*', text)
    if not m:
        return None
    start = m.end()
    # Find the opening bracket/brace
    while start < len(text) and text[start] not in '[{':
        start += 1
    opener = text[start]
    closer = ']' if opener == '[' else '}'
    depth = 0
    for i in range(start, len(text)):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    return None


def is_pitcher(player):
    pos = player.get('pos', [])
    return any(p in ('SP', 'RP') for p in pos) and not any(p in ('C','1B','2B','3B','SS','OF','DH','UT','MI','CI') for p in pos)


def is_hitter(player):
    return not is_pitcher(player)


def compute_ratios(seed_players, fg_by_fgid, fg_by_nameteam, fg_by_name, player_ids):
    """
    Compute csValA/FPTS ratios.
    Pitchers: use fixed CLAUDE.md reference ratios (calibrated to this league's scoring).
    Hitters:  derive from seed-FG overlap (FG FPTS not perfectly aligned, but gives
              consistent relative ordering — good enough for in-season trade/FAAB use).
    """
    hit_pairs_a, hit_pairs_s = [], []
    for p in seed_players:
        if is_pitcher(p):
            continue
        pid = player_ids.get(p['id'], {})
        team = p.get('t', '')
        nk = name_key(p['n'])
        fg_entry = (fg_by_fgid.get(str(pid.get('fgId', '')))
                    or fg_by_nameteam.get((nk, team))
                    or fg_by_name.get(nk))
        if not fg_entry:
            continue
        fpts = fg_entry.get('FPTS', 0) or 0
        spts = fg_entry.get('SPTS', 0) or 0
        cv_a = p.get('csValA', 0)
        cv_s = p.get('csValS', 0)
        if fpts > 0 and cv_a > 0:
            r = cv_a / fpts
            if 0.001 <= r <= 0.1:
                hit_pairs_a.append(r)
        if spts > 0 and cv_s > 0:
            r = cv_s / spts
            if 0.001 <= r <= 0.1:
                hit_pairs_s.append(r)

    hit_ratio_a = statistics.median(hit_pairs_a) if hit_pairs_a else 0.0144
    hit_ratio_s = statistics.median(hit_pairs_s) if hit_pairs_s else hit_ratio_a

    return {
        'sp_a':  0.02180, 'sp_s':  0.01568,  # fixed — calibrated to league scoring
        'rp_a':  0.00972, 'rp_s':  0.01025,  # fixed — calibrated to league scoring
        'hit_a': hit_ratio_a,
        'hit_s': hit_ratio_s,
    }


def apply_pitcher_stats(player, fg):
    """Update pitcher stat fields from FG entry. Returns dict of changed fields."""
    changes = {}
    def upd(key, val, decimals=2):
        val = round(float(val), decimals)
        if player.get(key) != val:
            changes[key] = (player.get(key), val)
            player[key] = val

    upd('IP',   fg.get('IP', 0), 1)
    upd('W',    fg.get('W', 0), 1)
    upd('K',    fg.get('SO', 0), 0)
    upd('SVH',  (fg.get('SV', 0) or 0) + (fg.get('HLD', 0) or 0), 0)
    upd('ERA',  fg.get('ERA', 4.50), 2)
    upd('WHIP', fg.get('WHIP', 1.35), 2)
    return changes


def apply_hitter_stats(player, fg):
    """Update hitter stat fields from FG entry. Returns dict of changed fields."""
    changes = {}
    def upd(key, val, decimals=2):
        val = round(float(val), decimals)
        if player.get(key) != val:
            changes[key] = (player.get(key), val)
            player[key] = val

    xbh = (fg.get('2B', 0) or 0) + (fg.get('3B', 0) or 0)
    rp  = (fg.get('R', 0) or 0) + (fg.get('RBI', 0) or 0) - (fg.get('HR', 0) or 0)

    upd('PA',  fg.get('PA', 0), 0)
    upd('OBP', fg.get('OBP', 0.310), 3)
    upd('HR',  fg.get('HR', 0), 1)
    upd('XBH', xbh, 1)
    upd('RP',  rp, 1)
    upd('SB',  fg.get('SB', 0), 1)
    return changes


def apply_values(player, fg, ratios):
    """Recalculate csValA/csValS from FPTS/SPTS × ratio."""
    changes = {}
    fpts = fg.get('FPTS', 0) or 0
    spts = fg.get('SPTS', 0) or 0
    pos  = player.get('pos', [])

    if 'SP' in pos:
        ra, rs = ratios['sp_a'], ratios['sp_s']
    elif 'RP' in pos:
        ra, rs = ratios['rp_a'], ratios['rp_s']
    else:
        ra, rs = ratios['hit_a'], ratios['hit_s']

    new_a = round(fpts * ra, 1) if fpts > 0 else player.get('csValA', 0)
    new_s = round(spts * rs, 1) if spts > 0 else player.get('csValS', 0)

    if player.get('csValA') != new_a:
        changes['csValA'] = (player.get('csValA'), new_a)
        player['csValA'] = new_a
    if player.get('csValS') != new_s:
        changes['csValS'] = (player.get('csValS'), new_s)
        player['csValS'] = new_s
    return changes


def main():
    global args
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh',  action='store_true', help='Force re-fetch FG data')
    parser.add_argument('--dry-run',  action='store_true', help='Print changes without writing seed.js')
    args = parser.parse_args()

    print('=== sync_projections.py ===\n')

    # Load FG data
    print('Loading FanGraphs Steamer projections...')
    fg_pit = fetch_fg(FG_URL_PIT, FG_CACHE_PIT, 'pitching')
    fg_bat = fetch_fg(FG_URL_BAT, FG_CACHE_BAT, 'batting')

    # Build lookups — fgId (as str), name+team (preferred fallback), name-only (last resort)
    fg_pit_by_id        = {str(p.get('playerids', '')): p for p in fg_pit if p.get('playerids')}
    fg_bat_by_id        = {str(p.get('playerids', '')): p for p in fg_bat if p.get('playerids')}
    # name+team key avoids collisions (e.g. multiple Jose Ramirez entries)
    fg_pit_by_nameteam  = {(name_key(p.get('PlayerName', '')), normalize_team(p.get('Team', ''))): p for p in fg_pit}
    fg_bat_by_nameteam  = {(name_key(p.get('PlayerName', '')), normalize_team(p.get('Team', ''))): p for p in fg_bat}
    # name-only fallback (only if PA/IP is substantial — avoids picking up minor leaguers)
    fg_pit_by_name = {}
    for p in fg_pit:
        k = name_key(p.get('PlayerName', ''))
        if (p.get('IP') or 0) >= 20 and k not in fg_pit_by_name:
            fg_pit_by_name[k] = p
    fg_bat_by_name = {}
    for p in fg_bat:
        k = name_key(p.get('PlayerName', ''))
        if (p.get('PA') or 0) >= 50 and k not in fg_bat_by_name:
            fg_bat_by_name[k] = p

    # Load seed + player_ids
    print('\nLoading seed.js + player_ids.js...')
    seed_players = load_js_object(SEED_FILE, 'SEED_PLAYERS')
    player_ids   = load_js_object(IDS_FILE, 'PLAYER_IDS') or {}
    print(f'  {len(seed_players)} seed players, {len(player_ids)} ID mappings')

    # Compute calibration ratios (pitchers: fixed reference; hitters: derived from overlap)
    print('\nCalibrating ratios...')
    ratios = compute_ratios(
        seed_players,
        {**fg_pit_by_id, **fg_bat_by_id},
        {**fg_pit_by_nameteam, **fg_bat_by_nameteam},
        {**fg_pit_by_name, **fg_bat_by_name},
        player_ids
    )
    print(f'  SP  ratio_a={ratios["sp_a"]:.5f}  ratio_s={ratios["sp_s"]:.5f}')
    print(f'  RP  ratio_a={ratios["rp_a"]:.5f}  ratio_s={ratios["rp_s"]:.5f}')
    print(f'  HIT ratio_a={ratios["hit_a"]:.5f}  ratio_s={ratios["hit_s"]:.5f}')

    # Process each player
    print('\nSyncing projections...')
    matched = unmatched = updated = 0
    unmatched_list = []

    for player in seed_players:
        pid     = player_ids.get(player['id'], {})
        fg_id   = str(pid.get('fgId', ''))
        nk      = name_key(player['n'])
        pitcher = is_pitcher(player)

        team = player.get('t', '')
        # Also try stripping parenthetical suffixes: "Max Muncy (LAD)" → "maxmuncy"
        nk_stripped = name_key(re.sub(r'\s*\([^)]+\)', '', player['n']))
        if pitcher:
            fg = (fg_pit_by_id.get(fg_id)
                  or fg_pit_by_nameteam.get((nk, team))
                  or fg_pit_by_nameteam.get((nk_stripped, team))
                  or fg_pit_by_name.get(nk)
                  or fg_pit_by_name.get(nk_stripped))
        else:
            fg = (fg_bat_by_id.get(fg_id)
                  or fg_bat_by_nameteam.get((nk, team))
                  or fg_bat_by_nameteam.get((nk_stripped, team))
                  or fg_bat_by_name.get(nk)
                  or fg_bat_by_name.get(nk_stripped))

        if not fg:
            unmatched += 1
            unmatched_list.append(f"  {player['n']:<25} {','.join(player.get('pos',[])):<6} {player.get('t','')}")
            continue

        matched += 1
        stat_changes  = apply_pitcher_stats(player, fg) if pitcher else apply_hitter_stats(player, fg)
        val_changes   = apply_values(player, fg, ratios)
        all_changes   = {**stat_changes, **val_changes}

        if all_changes and args.dry_run:
            parts = [f"{k}: {v[0]} → {v[1]}" for k, v in all_changes.items()]
            print(f"  {player['n']:<25} {', '.join(parts)}")

        if all_changes:
            updated += 1

    print(f'\nResults: {matched} matched, {unmatched} unmatched, {updated} updated')

    if unmatched_list:
        print(f'\nUnmatched players (keeping existing seed values):')
        for u in unmatched_list:
            print(u)

    if args.dry_run:
        print('\n[dry-run] seed.js NOT written.')
        return

    # Write updated seed.js — preserve header comment, replace array
    seed_text = SEED_FILE.read_text(encoding='utf-8')
    array_str = json.dumps(seed_players, indent=2, ensure_ascii=False)
    # Replace from first '[' to last ']'
    start = seed_text.index('[')
    end   = seed_text.rindex(']') + 1
    new_text = seed_text[:start] + array_str + seed_text[end:]
    SEED_FILE.write_text(new_text, encoding='utf-8')
    print(f'\nWrote {SEED_FILE} ({updated} players updated)')
    print('Run: python3 scripts/fetch_rankings.py  (to refresh ECR/ESPN/closer data)')


if __name__ == '__main__':
    main()
