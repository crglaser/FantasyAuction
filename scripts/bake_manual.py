#!/usr/bin/env python3
"""
bake_manual.py — Merge data/manual/*.csv into js/data/manual_rankings.js

Each CSV:
  - First column must be "Name" (matched to seed players by name)
  - Any other columns become player properties (column header = property key)
  - Multiple CSVs are merged — same player can appear in multiple files
  - Lines starting with # in the Name column are skipped (comments)

To add a new data source: add a column to the relevant CSV and fill it in.
To add a new group:        create a new CSV with a Name column.

Usage:
  python3 scripts/bake_manual.py              # merge all CSVs → manual_rankings.js
  python3 scripts/bake_manual.py --init       # regenerate blank CSV templates from seed
  python3 scripts/bake_manual.py --sync       # pull CloserMonkey data into rp_rankings.csv CM_Role column
"""

import csv, json, re, unicodedata, os, sys, argparse
from datetime import datetime, timezone

RANKINGS_FILE = 'js/data/rankings.js'
RP_CSV        = 'data/manual/rp_rankings.csv'

MANUAL_DIR  = 'data/manual'
SEED_FILE   = 'js/data/seed.js'
OUTPUT_FILE = 'js/data/manual_rankings.js'
SUFFIXES    = {'jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv'}


def normalize(name):
    n = unicodedata.normalize('NFD', str(name).lower())
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9 ]', '', n).strip()

def name_key(name):
    words = normalize(name).split()
    return ' '.join(w for w in words if w not in SUFFIXES)

def load_seed():
    with open(SEED_FILE) as f:
        content = f.read()
    m = re.search(r'const SEED_PLAYERS = (\[.*\]);', content, re.DOTALL)
    return json.loads(m.group(1))


def bake(players):
    """Read all CSVs and merge into a single {player_id: {field: value}} map."""
    name_to_player = {}
    for p in players:
        k = name_key(p['n'])
        name_to_player[k] = p
        # Also index by last name for short-name fallback
        last = k.split()[-1]
        if last not in name_to_player:
            name_to_player[last] = p

    merged     = {}   # player_id → {field: value}
    all_fields = set()

    csv_files = sorted(f for f in os.listdir(MANUAL_DIR) if f.endswith('.csv'))
    if not csv_files:
        print(f'No CSV files found in {MANUAL_DIR}/')
        return merged, all_fields

    for fname in csv_files:
        path = os.path.join(MANUAL_DIR, fname)
        with open(path, newline='', encoding='utf-8') as f:
            # Skip comment lines before the header
            lines = [l for l in f if not l.strip().startswith('#')]

        reader   = csv.DictReader(lines)
        if not reader.fieldnames:
            continue

        # Data columns: everything except Name
        fields = [col.strip() for col in reader.fieldnames
                  if col and col.strip().lower() != 'name' and not col.strip().startswith('#')]
        if not fields:
            print(f'  {fname}: no data columns (only Name) — skipping')
            continue

        matched = 0
        skipped = []

        # Auto-derive CM_Rank from row order when CSV has CM_Role but no explicit CM_Rank
        auto_cm_rank = 'CM_Role' in fields and 'CM_Rank' not in fields
        cm_rank_counter = 0

        for row in reader:
            raw = (row.get('Name') or '').strip()
            if not raw or raw.startswith('#'):
                continue

            key = name_key(raw)
            p   = name_to_player.get(key) or name_to_player.get(key.split()[-1])
            if not p:
                skipped.append(raw)
                continue

            pid = p['id']
            if pid not in merged:
                merged[pid] = {}

            for field in fields:
                val = (row.get(field) or '').strip()
                if not val:
                    continue
                try:
                    merged[pid][field] = float(val) if '.' in val else int(val)
                except ValueError:
                    merged[pid][field] = val
                all_fields.add(field)

            # Auto-assign CM_Rank from row position (CSV is in CloserMonkey rank order)
            if auto_cm_rank and (row.get('CM_Role') or '').strip():
                cm_rank_counter += 1
                merged[pid]['CM_Rank'] = cm_rank_counter
                all_fields.add('CM_Rank')

            if merged.get(pid):  # only count if at least one field had a value
                matched += 1
            elif pid in merged and not merged[pid]:
                del merged[pid]  # remove empty entries

        print(f'  {fname}: {matched} matched'
              + (f', {len(skipped)} unmatched ({", ".join(skipped[:4])}{"…" if len(skipped)>4 else ""})' if skipped else ''))

    return merged, all_fields


def init_templates(players):
    """Regenerate blank CSV templates with current seed player names."""
    os.makedirs(MANUAL_DIR, exist_ok=True)

    sp  = sorted([p for p in players if 'SP' in p.get('pos', [])],
                 key=lambda p: -(p.get('csValA') or 0))
    rp  = sorted([p for p in players if 'RP' in p.get('pos', []) and 'SP' not in p.get('pos', [])],
                 key=lambda p: -(p.get('csValA') or 0))
    hit = sorted([p for p in players if p.get('PA', 0) > 0],
                 key=lambda p: -(p.get('csValA') or 0))

    def write(path, comment, fieldnames, rows):
        with open(path, 'w', newline='', encoding='utf-8') as f:
            f.write(comment + '\n')
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        print(f'  {path} ({len(rows)} players)')

    print('Generating templates:')
    write('data/manual/sp_rankings.csv',
          '# SP Rankings — add columns for any source. Run: python3 scripts/bake_manual.py\n'
          '# Columns: Name (required) | PL_Tier (PitcherList 1-5) | add more freely',
          ['Name', 'PL_Tier'],
          [{'Name': p['n'], 'PL_Tier': ''} for p in sp])

    write('data/manual/rp_rankings.csv',
          '# RP Rankings — add columns for any source. Run: python3 scripts/bake_manual.py\n'
          '# Columns: Name (required) | PL_CloserRank | add more freely',
          ['Name', 'PL_CloserRank'],
          [{'Name': p['n'], 'PL_CloserRank': ''} for p in rp])

    write('data/manual/hitters.csv',
          '# Hitter Rankings — add columns for any source. Run: python3 scripts/bake_manual.py\n'
          '# Columns: Name (required) | add data columns freely',
          ['Name'],
          [{'Name': p['n']} for p in hit])


def sync_closer_csv(players):
    """Pull CM_Role from rankings.js into rp_rankings.csv (preserves manual edits to other columns)."""
    try:
        with open(RANKINGS_FILE) as f:
            m = re.search(r'const PLAYER_RANKINGS = (\{.*\});', f.read(), re.DOTALL)
        if not m:
            print('  rankings.js not found or empty — run fetch_rankings.py --ranks first')
            return
        rankings = json.loads(m.group(1))
    except FileNotFoundError:
        print(f'  {RANKINGS_FILE} not found — run fetch_rankings.py --ranks first')
        return

    id_to_closer = {pid: r['closerStatus'] for pid, r in rankings.items() if 'closerStatus' in r}
    id_to_closer_rank = {pid: r['closerRank'] for pid, r in rankings.items() if 'closerRank' in r}
    name_to_id   = {name_key(p['n']): p['id'] for p in players}

    with open(RP_CSV, newline='', encoding='utf-8') as f:
        raw = f.readlines()

    comments  = [l for l in raw if l.strip().startswith('#')]
    data_lines = [l for l in raw if not l.strip().startswith('#')]
    reader    = csv.DictReader(data_lines)
    existing  = list(reader)
    fieldnames = list(reader.fieldnames or [])

    if 'CM_Role' not in fieldnames:
        # Insert CM_Role as second column (after Name)
        fieldnames.insert(1, 'CM_Role')

    if 'CM_Rank' not in fieldnames:
        idx = fieldnames.index('CM_Role') + 1 if 'CM_Role' in fieldnames else 2
        fieldnames.insert(idx, 'CM_Rank')

    updated = 0
    for row in existing:
        pid = name_to_id.get(name_key(row.get('Name', '')))
        new_val = id_to_closer.get(pid, '')
        if row.get('CM_Role', '') != new_val:
            row['CM_Role'] = new_val
            if new_val:
                updated += 1
        new_rank = str(id_to_closer_rank.get(pid, '')) if pid else ''
        if row.get('CM_Rank', '') != new_rank:
            row['CM_Rank'] = new_rank

    with open(RP_CSV, 'w', newline='', encoding='utf-8') as f:
        for c in comments:
            f.write(c)
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        w.writeheader()
        w.writerows(existing)

    print(f'  Synced CM_Role → {RP_CSV} ({updated} values updated, {len(existing)} rows total)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--init', action='store_true',
                        help='Regenerate blank CSV templates from current seed')
    parser.add_argument('--sync', action='store_true',
                        help='Pull CloserMonkey data from rankings.js into CM_Role column')
    args = parser.parse_args()

    players = load_seed()
    print(f'Seed: {len(players)} players\n')

    if args.init:
        init_templates(players)
        return

    if args.sync:
        print('Syncing CM_Role from rankings.js...')
        sync_closer_csv(players)
        print()
        # Fall through to re-bake after sync

    print(f'Reading {MANUAL_DIR}/*.csv ...')
    merged, all_fields = bake(players)

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    js  = f"""/**
 * manual_rankings.js — Hand-curated rankings from data/manual/*.csv
 * Generated: {now}
 * Fields: {', '.join(sorted(all_fields)) if all_fields else '(none yet)'}
 * Run: python3 scripts/bake_manual.py
 */
const MANUAL_RANKINGS = {json.dumps(merged, indent=2)};
"""
    with open(OUTPUT_FILE, 'w') as f:
        f.write(js)

    print(f'\nWritten: {OUTPUT_FILE} ({len(merged)} players with data'
          + (f', fields: {sorted(all_fields)}' if all_fields else '') + ')')
    print(f'\nTo deploy:')
    print(f'  git add {OUTPUT_FILE} data/manual/')
    print(f'  git commit -m "Refresh manual rankings" && git push')


if __name__ == '__main__':
    main()
