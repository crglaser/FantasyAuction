#!/usr/bin/env python3
"""Fetch live Fantrax roster + FA data via the public fxea API.

No auth required — the fxea/general API is publicly accessible.

Pulls from two endpoints:
  getTeamRosters  — 310 rostered players with ACTIVE/RESERVE/INJURED_RESERVE slot
  getLeagueInfo   — FA/rostered status + current Fantrax position eligibility for all players

Usage:
  python3 scripts/fetch_fantrax_rosters.py
  python3 scripts/fetch_fantrax_rosters.py --league icfsou40mkzpn7lg
  python3 scripts/fetch_fantrax_rosters.py --csv "data/new.3.26.Fantrax-Players-Teddy Ballgame League .csv"

The --csv flag merges roster assignments from a Fantrax export CSV with the API data.
This handles API lag after FAAB: if a player appears rostered in the CSV but is still
showing as FA in the API, they are added as RESERVE to the correct team. CSV wins on
team assignment; API slot data (ACTIVE/RESERVE/IL) is used when available.

Output:
  js/data/fantrax_rosters.js
    - me/t1/.../t10: rostered players with `slot` (ACTIVE|RESERVE|INJURED_RESERVE)
                     and `ftxEligiblePos` (current Fantrax position eligibility)
    - fa: seed-matched FAs sorted by csValA desc

Refresh workflow:
  python3 scripts/fetch_fantrax_rosters.py --csv "data/<latest>.csv" && reload browser
"""

import argparse
import json
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


# CSV Status column → internal tid
CSV_STATUS_MAP = {
    'chathams': 'me',
    'spew':     't1',
    'idiots':   't2',
    'recap':    't3',
    'bw':       't5',
    'dogs':     't6',
    'deal':     't7',
    'pollos':   't8',
    'hacks':    't9',
    'vt':       't10',
}

LEAGUE_ID    = 'icfsou40mkzpn7lg'
ROSTERS_URL  = 'https://www.fantrax.com/fxea/general/getTeamRosters?leagueId={league_id}'
LEAGUE_URL   = 'https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId={league_id}'
PLAYER_ID_URL = 'https://www.fantrax.com/fxea/general/getPlayerIds?sport=MLB'

# Fantrax team name → internal tid
TEAM_NAME_MAP = {
    'chathams':             'me',
    'spew':                 't1',
    'village idiots':       't2',
    'happy recap':          't3',
    'baseball widowmakers': 't5',
    'dirt dogs':            't6',
    "let's deal":           't7',
    'los pollos hermanos':  't8',
    'diamond hacks':        't9',
    'velvet thunder':       't10',
}

ALL_TIDS = ['me', 't1', 't2', 't3', 't5', 't6', 't7', 't8', 't9', 't10']


def canonical(name: str) -> str:
    decomposed = unicodedata.normalize('NFKD', name)
    ascii_name = decomposed.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]', '', ascii_name.lower())


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load_seed_players():
    """Return (by_name, by_id) dicts from seed.js + steamer_extras.js."""
    by_name = {}
    by_id   = {}

    def _load_js_array(path):
        text = Path(path).read_text(encoding='utf-8')
        start = text.index('[')
        end   = text.rindex(']') + 1
        return json.loads(text[start:end])

    def name_variants(name):
        yield canonical(name)
        # Strip parenthetical suffixes: "Max Muncy (LAD)" → "Max Muncy"
        stripped = re.sub(r'\s*\([^)]+\)', '', name).strip()
        if stripped != name:
            yield canonical(stripped)
        # Strip middle initial: "Jose A. Ferrer" → "Jose Ferrer"
        no_initial = re.sub(r'\b[A-Z]\.\s+', '', name).strip()
        if no_initial != name:
            yield canonical(no_initial)

    for path in ('js/data/seed.js', 'js/data/steamer_extras.js'):
        if not Path(path).exists():
            continue
        try:
            for p in _load_js_array(path):
                for key in name_variants(p['n']):
                    if key not in by_name:
                        by_name[key] = p
                if p.get('id') and p['id'] not in by_id:
                    by_id[p['id']] = p
        except Exception as e:
            print(f'  WARNING: could not parse {path}: {e}')

    return by_name, by_id


def load_player_ids():
    """Return {fantraxId: seed_player_id} from player_ids.js."""
    path = Path('js/data/player_ids.js')
    if not path.exists():
        print('  WARNING: player_ids.js not found')
        return {}
    text = path.read_text(encoding='utf-8')
    m = re.search(r'const\s+PLAYER_IDS\s*=\s*', text)
    if not m:
        return {}
    start = text.index('{', m.end())
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    raw = json.loads(text[start:i + 1])
                    break
                except Exception:
                    return {}
    return {ids['fantraxId']: sid for sid, ids in raw.items() if ids.get('fantraxId')}


def resolve_player(ftx_id, ftx_player_lookup, ftx_id_to_name, ftx_to_seed, by_id, by_name):
    """Return (seed_player_or_None, matched:bool)."""
    seed_id = ftx_to_seed.get(ftx_id)
    player  = by_id.get(seed_id) if seed_id else None
    if not player:
        ftx_name = ftx_id_to_name.get(ftx_id)
        if ftx_name:
            player = by_name.get(ftx_name)
    return player, player is not None


def load_csv_assignments(csv_path):
    """Parse a Fantrax export CSV → {ftx_id: tid} for all rostered players.

    Ignores FA rows. Strips asterisks from IDs.
    Returns empty dict if file not found or parse error.
    """
    import csv as csv_mod
    assignments = {}
    path = Path(csv_path)
    if not path.exists():
        print(f'  WARNING: CSV not found: {csv_path}')
        return assignments
    try:
        with open(path, newline='', encoding='utf-8') as f:
            for row in csv_mod.DictReader(f):
                status = row.get('Status', '').strip()
                tid = CSV_STATUS_MAP.get(status.lower())
                if tid is None:
                    continue  # FA or unknown
                ftx_id = row.get('ID', '').strip('*').strip()
                if ftx_id:
                    assignments[ftx_id] = tid
        print(f'  {len(assignments)} rostered players in CSV (non-FA)')
    except Exception as e:
        print(f'  WARNING: CSV parse error: {e}')
    return assignments


def merge_csv_into_rosters(rosters, csv_assignments, ftx_id_to_name, ftx_elig,
                           ftx_to_seed, by_id, by_name, ftx_player_lookup):
    """Add CSV-rostered players that the API missed (post-FAAB lag).

    For each player in csv_assignments:
      - If already in the correct team's roster: skip (API has them, no action needed)
      - If in FA list or missing entirely: add as RESERVE to the CSV-assigned team,
        remove from FA list
    """
    # Build a quick index: ftx_id → (tid, entry) for already-rostered players
    rostered_ids = {}
    for tid, players in rosters.items():
        if tid in ('fa', '_meta'):
            continue
        for p in players:
            if p.get('ftxId'):
                rostered_ids[p['ftxId']] = tid

    fa_by_ftx = {p['ftxId']: p for p in rosters['fa'] if p.get('ftxId')}

    added = 0
    moved = 0
    for ftx_id, csv_tid in csv_assignments.items():
        existing_tid = rostered_ids.get(ftx_id)
        if existing_tid == csv_tid:
            continue  # API already has them on the right team

        # Resolve player
        player, matched = resolve_player(
            ftx_id, ftx_player_lookup, ftx_id_to_name, ftx_to_seed, by_id, by_name
        )
        if matched:
            entry = {**player}
        else:
            ftx_name_raw = ftx_player_lookup.get(ftx_id, {}).get('name', ftx_id)
            entry = {'id': ftx_id, 'n': ftx_name_raw, 'pos': [], 'csValA': 0, 'csValS': 0, '_unmatched': True}

        entry['ftxId']          = ftx_id
        entry['slot']           = 'RESERVE'  # conservative default; API slot data takes precedence if player IS in API
        entry['ftxEligiblePos'] = ftx_elig.get(ftx_id, '')

        if existing_tid is not None and existing_tid != csv_tid:
            # On wrong team in API — move them (shouldn't normally happen, log it)
            print(f'  CSV: moving {entry["n"]} from {existing_tid} → {csv_tid}')
            rosters[existing_tid] = [p for p in rosters[existing_tid] if p.get('ftxId') != ftx_id]

        if ftx_id in fa_by_ftx:
            rosters['fa'] = [p for p in rosters['fa'] if p.get('ftxId') != ftx_id]
            moved += 1
            print(f'  CSV inject (was FA): {entry["n"]} → {csv_tid}')
        elif existing_tid is None:
            added += 1
            print(f'  CSV inject (not in API): {entry["n"]} → {csv_tid}')

        rosters[csv_tid].append(entry)

    if added + moved:
        print(f'  Merged {added + moved} players from CSV ({moved} from FA, {added} new)')
    else:
        print('  CSV merge: no new adds (API is up to date)')


def main():
    parser = argparse.ArgumentParser(description='Fetch live Fantrax rosters + FAs via API')
    parser.add_argument('--league', default=LEAGUE_ID, help='Fantrax league ID')
    parser.add_argument('--out', default='js/data/fantrax_rosters.js', help='Output JS file')
    parser.add_argument('--csv', default=None, metavar='PATH',
                        help='Path to Fantrax export CSV. Merges roster assignments with API '
                             'data to handle post-FAAB API lag.')
    args = parser.parse_args()

    print('Loading seed players...')
    by_name, by_id = load_seed_players()
    print(f'  {len(by_name)} players in seed + extras')

    print('Loading player ID crosswalk...')
    ftx_to_seed = load_player_ids()
    print(f'  {len(ftx_to_seed)} fantraxId → seed_id mappings')

    print('\nFetching Fantrax player name lookup...')
    ftx_player_lookup = fetch_json(PLAYER_ID_URL)

    def ftx_canonical(raw_name):
        if ',' in raw_name:
            last, first = raw_name.split(',', 1)
            raw_name = f'{first.strip()} {last.strip()}'
        return canonical(raw_name)

    ftx_id_to_name = {
        pid: ftx_canonical(info.get('name', ''))
        for pid, info in ftx_player_lookup.items()
    }
    print(f'  {len(ftx_id_to_name)} Fantrax player IDs loaded')

    print(f'\nFetching league info (FA status + position eligibility)...')
    league_data   = fetch_json(LEAGUE_URL.format(league_id=args.league))
    player_info   = league_data.get('playerInfo', {})
    # {ftxId: {status:'FA'|'T', eligiblePos:'OF,UT,...'}}
    ftx_elig      = {pid: info.get('eligiblePos', '') for pid, info in player_info.items()}
    fa_ftx_ids    = {pid for pid, info in player_info.items() if info.get('status') == 'FA'}
    print(f'  {len(fa_ftx_ids)} FAs, {len(player_info) - len(fa_ftx_ids)} rostered in league data')

    print(f'\nFetching team rosters (slot assignments)...')
    roster_data = fetch_json(ROSTERS_URL.format(league_id=args.league))
    period      = roster_data.get('period', '?')
    print(f'  Period: {period}, Teams: {len(roster_data.get("rosters", {}))}')

    rosters  = {tid: [] for tid in ALL_TIDS}
    rosters['fa'] = []
    rostered_matched = unmatched_roster = 0

    # ── Rostered players ────────────────────────────────────────────────────
    for ftx_team_id, team in roster_data.get('rosters', {}).items():
        team_name = team.get('teamName', '').strip()
        tid = TEAM_NAME_MAP.get(team_name.lower())
        if tid is None:
            print(f'  WARNING: unknown team "{team_name}" — skipping')
            continue

        for item in team.get('rosterItems', []):
            ftx_id = item.get('id', '').strip('*')
            slot   = item.get('status', 'RESERVE')
            pos    = item.get('position', '')

            player, matched = resolve_player(
                ftx_id, ftx_player_lookup, ftx_id_to_name, ftx_to_seed, by_id, by_name
            )
            if matched:
                entry = {**player}
                rostered_matched += 1
            else:
                ftx_name_raw = ftx_player_lookup.get(ftx_id, {}).get('name', ftx_id)
                entry = {'id': ftx_id, 'n': ftx_name_raw, 'pos': [pos] if pos else [],
                         'csValA': 0, 'csValS': 0, '_unmatched': True}
                unmatched_roster += 1

            entry['ftxId']          = ftx_id
            entry['ftxTeamId']      = ftx_team_id
            entry['slot']           = slot
            entry['ftxEligiblePos'] = ftx_elig.get(ftx_id, '')
            rosters[tid].append(entry)

    # ── Free agents ─────────────────────────────────────────────────────────
    fa_matched = fa_unmatched = 0
    for ftx_id in fa_ftx_ids:
        player, matched = resolve_player(
            ftx_id, ftx_player_lookup, ftx_id_to_name, ftx_to_seed, by_id, by_name
        )
        if matched:
            entry = {**player}
            entry['ftxId']          = ftx_id
            entry['ftxEligiblePos'] = ftx_elig.get(ftx_id, '')
            rosters['fa'].append(entry)
            fa_matched += 1
        # Skip FAs not in seed — not relevant for our analysis

    # Sort FA by csValA desc so engines see best players first
    rosters['fa'].sort(key=lambda p: p.get('csValA', 0), reverse=True)

    # ── CSV merge (post-FAAB lag fix) ────────────────────────────────────────
    csv_source = None
    if args.csv:
        print(f'\nMerging CSV: {args.csv}')
        csv_assignments = load_csv_assignments(args.csv)
        merge_csv_into_rosters(
            rosters, csv_assignments, ftx_id_to_name, ftx_elig,
            ftx_to_seed, by_id, by_name, ftx_player_lookup
        )
        rosters['fa'].sort(key=lambda p: p.get('csValA', 0), reverse=True)
        csv_source = Path(args.csv).name
    else:
        print('\n(No --csv supplied — using API data only. Use --csv to merge FAAB adds.)')

    # ── Summary ─────────────────────────────────────────────────────────────
    print(f'\nRostered: {rostered_matched} matched, {unmatched_roster} unmatched')
    for tid in ALL_TIDS:
        active  = sum(1 for p in rosters[tid] if p.get('slot') == 'ACTIVE')
        reserve = sum(1 for p in rosters[tid] if p.get('slot') == 'RESERVE')
        inj     = sum(1 for p in rosters[tid] if p.get('slot') == 'INJURED_RESERVE')
        tag = f'{active}A/{reserve}BN' + (f'/{inj}IL' if inj else '')
        print(f'  {tid}: {tag}')
    print(f'\nFAs: {fa_matched} seed-matched (of {len(fa_ftx_ids)} total)')

    output = {
        **rosters,
        '_meta': {
            'source':          f'fxea API period={period}' + (f' + {csv_source}' if csv_source else ''),
            'baked':           datetime.now(timezone.utc).isoformat(),
            'leagueId':        args.league,
            'period':          period,
            'rosterMatched':   rostered_matched,
            'rosterUnmatched': unmatched_roster,
            'faMatched':       fa_matched,
            'faTotal':         len(fa_ftx_ids),
        },
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('// Generated by scripts/fetch_fantrax_rosters.py — do not edit\n')
        f.write('// Run: python3 scripts/fetch_fantrax_rosters.py\n')
        f.write('const FANTRAX_ROSTERS = ')
        f.write(json.dumps(output, indent=2, ensure_ascii=False))
        f.write(';\n')

    print(f'\nWrote {out_path}')

    # ── Coverage check ───────────────────────────────────────────────────────
    # Find the most recent AllRostersAndFA CSV in data/ for ownership % data.
    csv_files = sorted(Path('data').glob('*.csv'), key=lambda p: p.stat().st_mtime, reverse=True)
    roster_csv = next((f for f in csv_files if 'Fantrax-Players' in f.name), None)
    if roster_csv:
        import csv as csv_mod
        ownership = {}
        with open(roster_csv, newline='', encoding='utf-8') as cf:
            for row in csv_mod.DictReader(cf):
                if row.get('Status', '').strip() != 'FA':
                    continue
                ftx_id_raw = row.get('ID', '').strip('*').strip()
                try:
                    pct = float(row.get('%D', '0') or 0)
                except ValueError:
                    pct = 0
                if ftx_id_raw:
                    ownership[ftx_id_raw] = (pct, row.get('Player', ''), row.get('Position', ''), row.get('Team', ''))

        gaps = []
        for ftx_id, (pct, name, pos, team) in ownership.items():
            if pct < 1:
                continue
            player, matched = resolve_player(ftx_id, ftx_player_lookup, ftx_id_to_name, ftx_to_seed, by_id, by_name)
            if not matched:
                gaps.append((pct, name, pos, team))

        gaps.sort(reverse=True)
        TIERS = [
            (20, 999, '🔴 >20%'),
            (10,  20, '🟡 10–20%'),
            ( 5,  10, '🟠  5–10%'),
            ( 1,   5, '⚪   1–5%'),
        ]
        any_gap = False
        print(f'\nCoverage check (from {roster_csv.name}):')
        for lo, hi, label in TIERS:
            tier_gaps = [(pct, n, p, t) for pct, n, p, t in gaps if lo <= pct < hi]
            if tier_gaps:
                any_gap = True
                print(f'  {label} owned — not in seed:')
                for pct, name, pos, team in tier_gaps:
                    print(f'    {pct:5.1f}%  {name:<25} {pos:<8} {team}')
        if not any_gap:
            print('  ✓ No FAs >1% owned missing from seed')
    else:
        print('\n(No Fantrax-Players CSV found in data/ — skipping coverage check)')


if __name__ == '__main__':
    main()
