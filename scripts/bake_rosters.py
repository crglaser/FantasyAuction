#!/usr/bin/env python3
"""Bake Fantrax all-roster CSV into js/data/fantrax_rosters.js.

The CSV (exported from Fantrax "Players" view with all teams + FA) has columns:
  ID, Player, Team, Position, RkOv, Status, Opponent, Score, %D, ADP, Ros, +/-

Status column values: team nicknames (Chathams, Spew, etc.) or "FA".

Usage:
  python3 scripts/bake_rosters.py --csv "data/3.26.AllRostersAndFA.Fantrax-Players-Teddy Ballgame League .csv"
  # outputs js/data/fantrax_rosters.js
"""

import argparse
import csv
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


# Map Fantrax team display names (lowercased) -> internal tid
TEAM_NAME_MAP = {
    'chathams':  'me',
    'spew':      't1',
    'idiots':    't2',
    'recap':     't3',
    'bw':        't5',
    'dogs':      't6',
    'deal':      't7',
    'pollos':    't8',
    'hacks':     't9',
    'vt':        't10',
    'fa':        'fa',
}

ALL_TIDS = ['me', 't1', 't2', 't3', 't5', 't6', 't7', 't8', 't9', 't10', 'fa']


def canonical(name: str) -> str:
    """Normalize player name for fuzzy matching.
    Decomposes unicode (NFKD) so accented chars transliterate to ASCII
    before stripping — e.g. 'Andrés Muñoz' → 'andresmuoz'.
    """
    # NFKD decomposes accented chars: é → e + combining_accent
    decomposed = unicodedata.normalize('NFKD', name)
    # encode to ascii, dropping combining marks
    ascii_name = decomposed.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]', '', ascii_name.lower())


def parse_float(val, default=0.0):
    try:
        return float(str(val).replace('%', '').strip())
    except Exception:
        return default


def load_seed_players(seed_file='js/data/seed.js'):
    """Load seed.js, return dict of canonical_name -> player object."""
    p = Path(seed_file)
    if not p.exists():
        print(f'WARNING: seed file not found: {seed_file}')
        return {}
    text = p.read_text(encoding='utf-8')
    # Extract JSON array between first [ and last ]
    try:
        start = text.index('[')
        end = text.rindex(']') + 1
        players = json.loads(text[start:end])
    except Exception as e:
        print(f'WARNING: Failed to parse seed.js: {e}')
        return {}
    by_name = {}
    for player in players:
        key = canonical(player['n'])
        if key not in by_name:
            by_name[key] = player
    return by_name


def main():
    parser = argparse.ArgumentParser(description='Bake Fantrax roster CSV into JS')
    parser.add_argument('--csv', required=True, help='Path to Fantrax all-rosters CSV')
    parser.add_argument('--out', default='js/data/fantrax_rosters.js', help='Output JS file path')
    parser.add_argument('--top-fa', type=int, default=0, help='Max FA players to include (0 = all)')
    args = parser.parse_args()

    seed_by_name = load_seed_players()
    print(f'Loaded {len(seed_by_name)} seed players')

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f'ERROR: CSV not found: {args.csv}')
        return

    rosters = {tid: [] for tid in ALL_TIDS}
    matched = 0
    unmatched_names = []
    seen_ftx_ids = set()

    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('Player', '').strip()
            if not name or name == 'Player':
                continue

            status_raw = row.get('Status', '').strip().lower()
            tid = TEAM_NAME_MAP.get(status_raw)
            if tid is None:
                # Unknown team — skip silently (header artifacts, etc.)
                continue

            ftx_id = row.get('ID', '').strip().strip('*')

            # Deduplicate by Fantrax ID
            if ftx_id and ftx_id in seen_ftx_ids:
                continue
            if ftx_id:
                seen_ftx_ids.add(ftx_id)

            ftx_score  = parse_float(row.get('Score', 0))
            ftx_rank   = parse_float(row.get('RkOv', 9999), default=9999)
            ftx_pct    = parse_float(row.get('%D', 0))
            ftx_ros    = parse_float(row.get('Ros', 0))
            ftx_adp    = parse_float(row.get('ADP', 999), default=999)
            ftx_pm     = row.get('+/-', '').strip()
            ftx_pos_raw = row.get('Position', '').strip()
            ftx_team   = row.get('Team', '').strip()

            name_key = canonical(name)
            seed = seed_by_name.get(name_key)

            if seed:
                entry = {**seed}  # copy all seed fields (stats, values, positions, etc.)
                matched += 1
            else:
                # Minimal entry for players not in seed
                pos_list = [p.strip() for p in re.split(r'[,/]', ftx_pos_raw) if p.strip()]
                entry = {
                    'id': f'{name_key}-{ftx_team.lower()}',
                    'n': name,
                    't': ftx_team,
                    'pos': pos_list,
                    'inj': False,
                    'age': 0,
                    'csValA': 0,
                    'csValS': 0,
                    '_unmatched': True,
                }
                unmatched_names.append(name)

            # Append Fantrax-specific fields
            entry['ftxId']    = ftx_id
            entry['ftxScore'] = ftx_score
            entry['ftxRank']  = int(ftx_rank) if ftx_rank < 9000 else None
            entry['ftxPct']   = ftx_pct
            entry['ftxRos']   = ftx_ros
            entry['ftxAdp']   = ftx_adp
            entry['ftxPm']    = ftx_pm
            entry['ftxTeam']  = status_raw  # the fantasy team or 'fa'

            rosters[tid].append(entry)

    # Sort FA by score descending; trim only if --top-fa explicitly set
    rosters['fa'].sort(key=lambda p: p.get('ftxScore', 0), reverse=True)
    fa_total = len(rosters['fa'])
    if args.top_fa > 0:
        rosters['fa'] = rosters['fa'][:args.top_fa]

    # Print summary
    print(f'\nSeed matches: {matched}, Unmatched: {len(unmatched_names)}')
    for tid in ALL_TIDS:
        if tid == 'fa':
            kept = len(rosters['fa'])
            cap_note = f' (capped at {args.top_fa})' if args.top_fa > 0 and kept < fa_total else ''
            print(f'  fa: {kept} players{cap_note}')
        else:
            print(f'  {tid}: {len(rosters[tid])} players')

    if unmatched_names[:10]:
        print(f'\nFirst unmatched players (not in seed.js):')
        for n in unmatched_names[:10]:
            print(f'  {n}')
        if len(unmatched_names) > 10:
            print(f'  ... and {len(unmatched_names) - 10} more')

    # Build output
    output = {
        **rosters,
        '_meta': {
            'source':     csv_path.name,
            'baked':      datetime.now(timezone.utc).isoformat(),
            'matched':    matched,
            'unmatched':  len(unmatched_names),
            'faTotal':    fa_total,
            'faKept':     len(rosters['fa']),  # same as faTotal unless --top-fa used
        }
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('// Generated by scripts/bake_rosters.py — do not edit\n')
        f.write('// Run: python3 scripts/bake_rosters.py --csv <path-to-csv>\n')
        f.write('const FANTRAX_ROSTERS = ')
        f.write(json.dumps(output, indent=2, ensure_ascii=False))
        f.write(';\n')

    print(f'\nWrote {out_path}')


if __name__ == '__main__':
    main()
