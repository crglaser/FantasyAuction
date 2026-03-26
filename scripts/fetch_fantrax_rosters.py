#!/usr/bin/env python3
"""Fetch live Fantrax roster data via the public fxea API and bake fantrax_rosters.js.

No auth required — the fxea/general API is publicly accessible.

Usage:
  python3 scripts/fetch_fantrax_rosters.py
  python3 scripts/fetch_fantrax_rosters.py --league icfsou40mkzpn7lg
  python3 scripts/fetch_fantrax_rosters.py --out js/data/fantrax_rosters.js

Output:
  js/data/fantrax_rosters.js — same shape as bake_rosters.py output, with added
  `slot` field per player: ACTIVE | RESERVE | INJURED_RESERVE

Refresh workflow:
  python3 scripts/fetch_fantrax_rosters.py && reload browser
"""

import argparse
import json
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


LEAGUE_ID   = 'icfsou40mkzpn7lg'
ROSTERS_URL = 'https://www.fantrax.com/fxea/general/getTeamRosters?leagueId={league_id}'
FA_URL      = 'https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId={league_id}'

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
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load_seed_players() -> dict:
    """Return {canonical_name: player} and {id: player} from seed.js + steamer_extras.js."""
    by_name = {}
    by_id   = {}

    def _load_js_array(path):
        text = Path(path).read_text(encoding='utf-8')
        start = text.index('[')
        end   = text.rindex(']') + 1
        return json.loads(text[start:end])

    for path in ('js/data/seed.js', 'js/data/steamer_extras.js'):
        if not Path(path).exists():
            continue
        try:
            for p in _load_js_array(path):
                key = canonical(p['n'])
                if key not in by_name:
                    by_name[key] = p
                if p.get('id') and p['id'] not in by_id:
                    by_id[p['id']] = p
        except Exception as e:
            print(f'  WARNING: could not parse {path}: {e}')

    return by_name, by_id


def load_player_ids() -> dict:
    """Return {fantraxId: seed_player_id} from player_ids.js."""
    path = Path('js/data/player_ids.js')
    if not path.exists():
        print('  WARNING: player_ids.js not found')
        return {}
    text = path.read_text(encoding='utf-8')
    # Extract the object literal
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

    ftx_to_seed = {}
    for seed_id, ids in raw.items():
        ftx_id = ids.get('fantraxId')
        if ftx_id:
            ftx_to_seed[ftx_id] = seed_id
    return ftx_to_seed


def main():
    parser = argparse.ArgumentParser(description='Fetch live Fantrax rosters via API')
    parser.add_argument('--league', default=LEAGUE_ID, help='Fantrax league ID')
    parser.add_argument('--out', default='js/data/fantrax_rosters.js', help='Output JS file')
    args = parser.parse_args()

    print('Loading seed players...')
    by_name, by_id = load_seed_players()
    print(f'  {len(by_name)} players in seed + extras')

    print('Loading player ID crosswalk...')
    ftx_to_seed = load_player_ids()
    print(f'  {len(ftx_to_seed)} fantraxId → seed_id mappings')

    print('\nFetching Fantrax player name lookup...')
    ftx_player_lookup = fetch_json('https://www.fantrax.com/fxea/general/getPlayerIds?sport=MLB')
    # Build {fantraxId: canonical_name} for fallback name matching.
    # Fantrax names are "Last, First" — swap to "First Last" before canonicalizing.
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

    print(f'\nFetching rosters from Fantrax API (league={args.league})...')
    data = fetch_json(ROSTERS_URL.format(league_id=args.league))
    period = data.get('period', '?')
    print(f'  Period: {period}, Teams: {len(data.get("rosters", {}))}')

    rosters = {tid: [] for tid in ALL_TIDS}
    rosters['fa'] = []

    matched   = 0
    unmatched = []

    for ftx_team_id, team in data.get('rosters', {}).items():
        team_name = team.get('teamName', '').strip()
        tid = TEAM_NAME_MAP.get(team_name.lower())
        if tid is None:
            print(f'  WARNING: unknown team "{team_name}" — skipping')
            continue

        for item in team.get('rosterItems', []):
            ftx_id = item.get('id', '').strip('*')
            slot   = item.get('status', 'RESERVE')   # ACTIVE | RESERVE | INJURED_RESERVE
            pos    = item.get('position', '')

            # Match to seed: fantraxId crosswalk → canonical name fallback
            seed_id = ftx_to_seed.get(ftx_id)
            player  = by_id.get(seed_id) if seed_id else None

            if not player:
                # Fallback: look up name via getPlayerIds, then match to seed by canonical name
                ftx_name = ftx_id_to_name.get(ftx_id)
                if ftx_name:
                    player = by_name.get(ftx_name)

            if player:
                entry = {**player}
                matched += 1
            else:
                ftx_name_raw = ftx_player_lookup.get(ftx_id, {}).get('name', ftx_id)
                entry = {
                    'id':         ftx_id,
                    'n':          ftx_name_raw,
                    'pos':        [pos] if pos else [],
                    'csValA':     0,
                    'csValS':     0,
                    '_unmatched': True,
                }
                unmatched.append(f'{ftx_id} ({ftx_name_raw})')

            entry['ftxId']      = ftx_id
            entry['ftxTeamId']  = ftx_team_id
            entry['slot']       = slot   # ACTIVE | RESERVE | INJURED_RESERVE
            rosters[tid].append(entry)

    print(f'\nMatched: {matched}  Unmatched: {len(unmatched)}')
    for tid in ALL_TIDS:
        active  = sum(1 for p in rosters[tid] if p.get('slot') == 'ACTIVE')
        reserve = sum(1 for p in rosters[tid] if p.get('slot') == 'RESERVE')
        inj     = sum(1 for p in rosters[tid] if p.get('slot') == 'INJURED_RESERVE')
        parts   = [f'{active}A/{reserve}BN']
        if inj:
            parts.append(f'{inj}IL')
        print(f'  {tid}: {" ".join(parts)}')

    if unmatched[:10]:
        print(f'\nUnmatched fantraxIds (not in player_ids.js):')
        for fid in unmatched[:10]:
            print(f'  {fid}')
        if len(unmatched) > 10:
            print(f'  ... and {len(unmatched) - 10} more')

    output = {
        **rosters,
        '_meta': {
            'source':    f'fxea API period={period}',
            'baked':     datetime.now(timezone.utc).isoformat(),
            'leagueId':  args.league,
            'period':    period,
            'matched':   matched,
            'unmatched': len(unmatched),
        },
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('// Generated by scripts/fetch_fantrax_rosters.py — do not edit\n')
        f.write(f'// Run: python3 scripts/fetch_fantrax_rosters.py\n')
        f.write('const FANTRAX_ROSTERS = ')
        f.write(json.dumps(output, indent=2, ensure_ascii=False))
        f.write(';\n')

    print(f'\nWrote {out_path}')


if __name__ == '__main__':
    main()
