#!/usr/bin/env python3
"""FAAB recommendation engine for Teddy Ballgame.

Usage:
  python3 scripts/faab_recommend.py \
    --fa-file data/3.24.Fantrax-Players-Teddy Ballgame League .csv \
    --draft-file data/manual/tbg26_backup_2026-03-18_02-08_170picks.json \
    --profile data/owner_profiles/profile_me.json \
    --out recommendations.json --no-c

Output options:
  CSV to stdout or JSON file.

"""

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path


def canonical_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def parse_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def load_draft_roster(draft_file, owner_key="me"):
    if not draft_file:
        return set()
    p = Path(draft_file)
    if not p.exists():
        return set()
    with open(p, encoding='utf-8') as f:
        payload = json.load(f)
    drafted = payload.get('drafted', {})
    roster = set()
    for pid, rec in drafted.items():
        if rec.get('team') == owner_key:
            roster.add(pid)
    return roster


def load_profile(profile_file):
    if not profile_file:
        return {}
    p = Path(profile_file)
    if not p.exists():
        return {}
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def load_league_categories(state_file='js/engine/state.js'):
    default = {
        'hitting': ['HR', 'OBP', 'RP', 'SB', 'XBH'],
        'pitching': ['W', 'K', 'ERA', 'SVH', 'WHIP']
    }
    p = Path(state_file)
    if not p.exists():
        return default

    txt = p.read_text(encoding='utf-8')
    m = re.search(r"categories\s*:\s*\{\s*hitting\s*:\s*\[([^\]]*)\],\s*pitching\s*:\s*\[([^\]]*)\]", txt)
    if not m:
        return default

    def parse_list(s):
        return [x.strip().strip("'\"") for x in s.split(',') if x.strip()]

    try:
        hitting = parse_list(m.group(1))
        pitching = parse_list(m.group(2))
        return {'hitting': hitting, 'pitching': pitching}
    except Exception:
        return default


def compute_position_needs(roster_ids, seed_file='js/data/seed.js'):
    # Use seed.js to map ids -> positions, and count roster positions.
    positions = {'C': 0, '1B': 0, '2B': 0, '3B': 0, 'SS': 0, 'OF': 0, 'SP': 0, 'RP': 0}
    seed = []
    try:
        with open(seed_file, encoding='utf-8') as f:
            text = f.read()
        start = text.index('[')
        end = text.rindex(']') + 1
        seed = json.loads(text[start:end])
    except Exception:
        return positions
    id2pos = {p['id']: p.get('pos', []) for p in seed}

    for pid in roster_ids:
        for pos in id2pos.get(pid, []):
            if pos in positions:
                positions[pos] += 1
    return positions


def recommend_faab(fa_file, roster_ids, no_c=False, faab_budget=400, category_weights=None):
    if category_weights is None:
        category_weights = {
            'HR': 1.0, 'OBP': 1.0, 'RP': 1.0, 'SB': 1.0, 'XBH': 1.0,
            'K': 1.0, 'W': 1.0, 'ERA': 1.0, 'SVH': 1.0, 'WHIP': 1.0
        }

    fa_rows = []
    with open(fa_file, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            r['Score'] = parse_float(r.get('Score', 0), default=0)
            fa_rows.append(r)

    pos_weights = {
        'C': -2.0 if no_c else 0.5,
        '1B': 0.6, '2B': 1.0, '3B': 1.0, 'SS': 1.0, 'OF': 0.6,
        'SP': 1.0, 'RP': 1.2, 'DH': 0.1
    }

    candidates = []
    roster_names = set()

    for row in fa_rows:
        name_key = canonical_name(row['Player'])
        if name_key in roster_names:
            continue

        if no_c and 'C' in row.get('Position', '').split(','):
            continue

        score = row['Score']
        raw_adp = parse_float(row.get('ADP', 999), default=999)

        position = row.get('Position', '')
        pos_list = [p.strip() for p in position.split(',') if p.strip()]
        if not pos_list:
            pos_list = ['OF']

        best_pos_weight = max(pos_weights.get(p, 0.2) for p in pos_list)

        adp_bonus = 0.0
        if 0 < raw_adp < 200:
            adp_bonus = max(0.0, (90 - raw_adp) / 90.0)

        base_value = score + best_pos_weight * 8 + adp_bonus * 5

        if 'SP' in pos_list: base_value += category_weights.get('W', 1.0) + category_weights.get('K', 1.0)
        if 'RP' in pos_list: base_value += category_weights.get('SVH', 1.0)
        if any(p in pos_list for p in ['1B','2B','3B','SS','OF','DH']):
            base_value += category_weights.get('HR', 1.0) + category_weights.get('OBP', 1.0)

        candidates.append({
            'Player': row.get('Player', ''),
            'Position': position,
            'Team': row.get('Team', ''),
            'Score': score,
            'ADP': raw_adp,
            'Rank': parse_float(row.get('RkOv', 999), default=999),
            'Value': round(base_value, 2),
            'pos_weight': best_pos_weight,
            'adp_bonus': round(adp_bonus, 2),
            'plus_minus': row.get('+/-', ''),
        })

    ranked = sorted(candidates, key=lambda x: (x['Value'], x['Score']), reverse=True)
    return {'budget': faab_budget, 'recommendations': ranked}



def main():
    parser = argparse.ArgumentParser(description='FAAB candidate recommender')
    parser.add_argument('--fa-file', required=True, help='FA CSV dump path')
    parser.add_argument('--draft-file', help='Draft backup JSON path to get current roster ids')
    parser.add_argument('--profile', help='Owner profile JSON path (optional)')
    parser.add_argument('--no-c', action='store_true', help='Exclude catchers from recommendations')
    parser.add_argument('--out', help='Output JSON file (default stdout)')
    parser.add_argument('--top', type=int, default=25, help='How many candidates to print (default 25)')
    parser.add_argument('--faab-budget', type=float, default=400.0, help='FAAB budget (default 400)')
    parser.add_argument('--category-weights', help='JSON file setting category weights')
    args = parser.parse_args()

    roster_ids = load_draft_roster(args.draft_file) if args.draft_file else set()
    profile = load_profile(args.profile) if args.profile else {}

    needs = compute_position_needs(roster_ids)
    print('Position counts on roster (derived from seed.js + draft):')
    for pos, cnt in sorted(needs.items(), key=lambda x: x[0]):
        print(f'  {pos}: {cnt}')
    if args.no_c:
        print('Catcher scoring is disabled (--no-c).')

    categories = load_league_categories()
    category_priorities = {
        'HR': 1.0, 'OBP': 1.0, 'RP': 1.0, 'SB': 1.0, 'XBH': 1.0,
        'K': 1.0, 'W': 1.0, 'ERA': 1.0, 'SVH': 1.0, 'WHIP': 1.0
    }

    if args.category_weights:
        custom_path = Path(args.category_weights)
        if custom_path.exists():
            try:
                category_priorities = json.loads(custom_path.read_text(encoding='utf-8'))
            except Exception as e:
                print('Failed to load --category-weights JSON:', e)

    faab_data = recommend_faab(args.fa_file, roster_ids, no_c=args.no_c,
                                faab_budget=args.faab_budget,
                                category_weights=category_priorities)

    recs = faab_data['recommendations']
    print('\nTop FAAB candidates:')
    print('Value | Score | ADP | Player (Position, Team)')
    for c in recs[: args.top]:
        print(f"{c['Value']:5.2f} | {c['Score']:5.2f} | {c['ADP']:5.1f} | {c['Player']} ({c['Position']}, {c['Team']})")

    output = {
        'project': 'faab_recommend',
        'profile': profile,
        'roster_ids': sorted(list(roster_ids)),
        'faabBudget': args.faab_budget,
        'categoryPriorities': category_priorities,
        'recommendations': recs,
        'runAt': datetime.now().isoformat()
    }

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2)
        print(f'\nSaved recommendations to {args.out}')

    # also save JS-friendly version for browser loader
    if args.out:
        js_path = Path(args.out).with_suffix('.js')
        with open(js_path, 'w', encoding='utf-8') as f:
            f.write('const FAAB_RECOMMENDATIONS = ' + json.dumps(output, indent=2) + ';\n')
        print(f'Saved JS version to {js_path}')

if __name__ == '__main__':
    main()
