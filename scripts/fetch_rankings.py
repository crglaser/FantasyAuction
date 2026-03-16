#!/usr/bin/env python3
"""
fetch_rankings.py — Pull ECR, ESPN ADP/auction, CloserMonkey, and FanGraphs IDs

Writes:
  js/data/player_ids.js   — fgId, mlbId, espnId, fantraxId per player (stable, commit once)
  js/data/rankings.js     — ecr, adp, espnAuction, closerStatus (refresh weekly)

Usage:
  python3 scripts/fetch_rankings.py           # full run
  python3 scripts/fetch_rankings.py --ids     # only rebuild IDs (slow, uses Chadwick)
  python3 scripts/fetch_rankings.py --ranks   # only refresh rankings (fast)
"""

import json, urllib.request, urllib.parse, unicodedata, re, time, sys, argparse, csv, io, glob, os
from datetime import datetime, timezone

SEED_FILE      = 'js/data/seed.js'
IDS_FILE       = 'js/data/player_ids.js'
RANKINGS_FILE  = 'js/data/rankings.js'
ASSETS_DIR     = 'assets'
RATE_DELAY     = 0.1
SUFFIXES       = {'jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv'}

# ── Utilities ────────────────────────────────────────────────────────────────

def normalize(name):
    n = unicodedata.normalize('NFD', str(name).lower())
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9 ]', '', n).strip()

def fetch(url, headers=None, timeout=15):
    h = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
    if headers: h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def fetch_json(url, headers=None):
    return json.loads(fetch(url, headers))

def load_seed():
    with open(SEED_FILE) as f:
        content = f.read()
    m = re.search(r'const SEED_PLAYERS = (\[.*\]);', content, re.DOTALL)
    return json.loads(m.group(1))

def load_existing_ids():
    try:
        with open(IDS_FILE) as f:
            content = f.read()
        m = re.search(r'const PLAYER_IDS = (\{.*\});', content, re.DOTALL)
        return json.loads(m.group(1)) if m else {}
    except:
        return {}

def name_key(name):
    """Normalized name without suffixes for fuzzy matching."""
    words = normalize(name).split()
    return ' '.join(w for w in words if w not in SUFFIXES)

# ── Chadwick Bureau — MLBAM ↔ FanGraphs ID crosswalk ────────────────────────

def build_chadwick_map():
    print('Downloading Chadwick Bureau crosswalk (7 shards)...')
    chadwick = {}  # normalize(name) → {mlbam, fgId}
    mlbam_to_fg = {}  # mlbam_id → fgId

    for i in range(7):
        url = f'https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-{i}.csv'
        try:
            raw = fetch(url).decode('utf-8')
            reader = csv.DictReader(io.StringIO(raw))
            for row in reader:
                mlbam = row.get('key_mlbam', '').strip()
                fg    = row.get('key_fangraphs', '').strip()
                first = row.get('name_first', '').strip()
                last  = row.get('name_last', '').strip()
                if not mlbam or not fg or not first or not last:
                    continue
                suffix = row.get('name_suffix', '').strip()
                full   = f'{first} {last}' + (f' {suffix}' if suffix else '')
                key    = name_key(full)
                entry  = {'mlbId': int(mlbam), 'fgId': int(fg)}
                chadwick[key] = entry
                mlbam_to_fg[mlbam] = int(fg)
            print(f'  shard {i}: {sum(1 for _ in reader)} — cumulative {len(chadwick)}', end='\r')
        except Exception as e:
            print(f'  shard {i} error: {e}')

    print(f'\n  Chadwick: {len(chadwick)} players with both MLBAM + FG IDs')
    return chadwick, mlbam_to_fg

def build_espn_id_map():
    """Get ESPN Fantasy IDs for all active players."""
    print('Loading ESPN player IDs...')
    d = fetch_json(
        'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026'
        '/players?scoringPeriodId=0&view=players_wl',
        headers={'X-Fantasy-Filter': '{"filterActive":{"value":true}}'}
    )
    result = {}
    for p in d:
        if 'fullName' not in p: continue
        key = name_key(p['fullName'])
        result[key] = p['id']
    print(f'  ESPN: {len(result)} players')
    return result


def build_fantrax_id_map():
    """Read local Fantrax CSV exports and return name_key → fantraxId map."""
    result = {}
    for pattern in ('Fantrax-Hitters*.csv', 'Fantrax-Pitchers*.csv'):
        matches = sorted(glob.glob(os.path.join(ASSETS_DIR, pattern)))
        if not matches:
            print(f'  Fantrax: no file matching {ASSETS_DIR}/{pattern} — skipping')
            continue
        path = matches[-1]  # use latest if multiple
        with open(path, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                raw_id = row.get('ID', '').strip().strip('*')
                name   = row.get('Player', '').strip()
                if not raw_id or not name:
                    continue
                result[name_key(name)] = raw_id
    print(f'  Fantrax: {len(result)} players from local CSVs')
    return result

def build_ids(players):
    """Match seed players to MLBAM, FanGraphs, ESPN, and Fantrax IDs."""
    chadwick, _ = build_chadwick_map()
    espn_map    = build_espn_id_map()
    fantrax_map = build_fantrax_id_map()

    ids = {}
    matched_fg = 0; matched_espn = 0; matched_ftx = 0; unmatched = []

    for p in players:
        key   = name_key(p['n'])
        entry = {'fgId': None, 'mlbId': None, 'espnId': None, 'fantraxId': None}

        # Chadwick match
        ch = chadwick.get(key)
        if not ch:
            # Try without suffix
            words = key.split()
            if words[-1] in SUFFIXES:
                ch = chadwick.get(' '.join(words[:-1]))
        if ch:
            entry['fgId']  = ch['fgId']
            entry['mlbId'] = ch['mlbId']
            matched_fg += 1

        # ESPN match
        espn_id = espn_map.get(key)
        if espn_id:
            entry['espnId'] = espn_id
            matched_espn += 1

        # Fantrax match
        ftx_id = fantrax_map.get(key)
        if not ftx_id:
            words = key.split()
            if words[-1] in SUFFIXES:
                ftx_id = fantrax_map.get(' '.join(words[:-1]))
        if ftx_id:
            entry['fantraxId'] = ftx_id
            matched_ftx += 1

        if entry['fgId'] or entry['espnId'] or entry['fantraxId']:
            ids[p['id']] = {k: v for k, v in entry.items() if v is not None}
        else:
            unmatched.append(p['n'])

    print(f'\nID matching: {matched_fg} FanGraphs IDs, {matched_espn} ESPN IDs, {matched_ftx} Fantrax IDs')
    if unmatched:
        print(f'No IDs found for {len(unmatched)}: {", ".join(unmatched[:8])}{"…" if len(unmatched)>8 else ""}')
    return ids

# ── FantasyPros ECR ──────────────────────────────────────────────────────────

def fetch_ecr():
    print('Fetching FantasyPros ECR...')
    url = ('https://partners.fantasypros.com/api/v1/consensus-rankings.php'
           '?sport=MLB&year=2026&week=0&id=0&position=ALL&type=roto&scoring=H&teams=0&draft=0')
    d = fetch_json(url)
    players = d.get('players', [])
    # name → {ecr, ecrMin, ecrMax, fpId}
    result = {}
    for p in players:
        key = name_key(p.get('player_name', ''))
        result[key] = {
            'ecr':    int(p.get('rank_ecr', 999)),
            'ecrMin': int(p.get('rank_min', 999)),
            'ecrMax': int(p.get('rank_max', 999)),
            'fpId':   p.get('player_id'),
        }
    print(f'  FantasyPros: {len(result)} players, updated {d.get("last_updated","?")}')
    return result

# ── ESPN ADP / Auction averages ──────────────────────────────────────────────

def fetch_espn_adp():
    print('Fetching ESPN auction/ADP data...')
    d = fetch_json(
        'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026'
        '/players?scoringPeriodId=0&view=kona_player_info',
        headers={'X-Fantasy-Filter': '{"filterActive":{"value":true}}'}
    )
    result = {}  # espnId → {adp, espnAuction, pctOwned}
    for p in d:
        pid = p.get('id')
        if not pid: continue
        own   = p.get('ownership', {})
        ranks = p.get('draftRanksByRankType', {}).get('ROTO', {})
        result[str(pid)] = {
            'adp':          round(own.get('averageDraftPosition', 0), 1),
            'espnAuction':  round(own.get('auctionValueAverage', 0), 1),
            'pctOwned':     round(own.get('percentOwned', 0), 1),
            'espnRotoRank': ranks.get('rank'),
        }
    print(f'  ESPN ADP: {len(result)} players')
    return result

# ── CloserMonkey ─────────────────────────────────────────────────────────────

def fetch_closer_monkey():
    print('Fetching CloserMonkey depth chart...')
    html = fetch('https://closermonkey.com/').decode('utf-8', errors='ignore')

    # Find the latest rankings article link
    article_match = re.search(
        r'href="(https://closermonkey\.com/[^"]*closer[^"]*rankings[^"]*)"',
        html, re.IGNORECASE
    )
    article_url = article_match.group(1) if article_match else None

    # Parse depth chart table (Table 0 on homepage)
    # Each row has 10 cells: [team1, closer1, 1st1, 2nd1, date1, team2, closer2, 1st2, 2nd2, date2]
    # Asterisk at START of name = closer by committee (e.g. "*Jax", "*Cleavinger")
    # Value format stored: "STATUS:TEAM" or "STATUS:TEAM:*" (committee)
    # STATUS: CLOSER | 1ST | 2ND
    closer_map = {}

    def add_player(raw_cell, status, team):
        if not raw_cell or raw_cell.strip() in ('', '—', '-', 'TBD', 'N/A'): return
        cell_has_asterisk = '*' in raw_cell
        # Strip leading/trailing asterisks and split on slash/comma
        clean = raw_cell.replace('*', '').strip()
        parts = [p.strip() for p in re.split(r'[/,]', clean) if p.strip()]
        if not parts: return
        is_committee = cell_has_asterisk or len(parts) > 1
        flag = ':*' if is_committee else ''
        for n in parts:
            nk = name_key(n)
            value = f'{status}:{team}{flag}'
            closer_map[nk] = value
            # Also index by last word so full-name seed players can match short names
            last = nk.split()[-1]
            if last != nk and last not in closer_map:
                closer_map[last] = value

    # Table rows: each data row has two teams (10 cells)
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
        if len(cells) < 5: continue
        # Process left team (cols 0-4) and right team (cols 5-9)
        for offset in (0, 5):
            if offset + 3 >= len(cells): break
            team = cells[offset].strip()
            if not team or len(team) > 5: continue  # skip header/blank rows
            add_player(cells[offset + 1], 'CLOSER', team)
            add_player(cells[offset + 2], '1ST',    team)
            add_player(cells[offset + 3], '2ND',    team)

    rank_map = {}

    # Also fetch ranked saves list from latest article if found
    if article_url:
        try:
            art_html = fetch(article_url).decode('utf-8', errors='ignore')
            # First ranked list = saves rankings
            ranked = re.findall(
                r'<tr[^>]*>.*?<td[^>]*>\s*(\d+)\s*</td>\s*<td[^>]*>(.*?)</td>',
                art_html, re.DOTALL
            )
            for rank_str, name_html in ranked[:60]:
                name = re.sub(r'<[^>]+>', '', name_html).strip()
                rank = int(rank_str)
                key  = name_key(name)
                rank_map[key] = rank  # always track rank
                last = key.split()[-1]
                if last != key:
                    rank_map.setdefault(last, rank)
                if key not in closer_map:  # don't override depth chart role
                    closer_map[key] = f'SVH#{rank}'
        except Exception as e:
            print(f'  CloserMonkey article error: {e}')

    print(f'  CloserMonkey: {len(closer_map)} relievers classified')
    return closer_map, rank_map

# ── Merge everything ─────────────────────────────────────────────────────────

def build_rankings(players, existing_ids, ecr_data, espn_adp, closer_data, closer_ranks):
    rankings = {}

    for p in players:
        pid   = p['id']
        key   = name_key(p['n'])
        entry = {}

        # ECR
        fp = ecr_data.get(key)
        if not fp:
            # Try without Jr/Sr
            words = key.split()
            if words[-1] in SUFFIXES:
                fp = ecr_data.get(' '.join(words[:-1]))
        if fp:
            entry['ecr']    = fp['ecr']
            entry['ecrMin'] = fp['ecrMin']
            entry['ecrMax'] = fp['ecrMax']

        # ESPN ADP — need ESPN ID from our ids file
        ids   = existing_ids.get(pid, {})
        eid   = ids.get('espnId')
        if eid and str(eid) in espn_adp:
            adp_data = espn_adp[str(eid)]
            if adp_data['espnAuction'] > 0:
                entry['espnAuction'] = adp_data['espnAuction']
            if adp_data['adp'] > 0:
                entry['adp'] = adp_data['adp']

        # CloserMonkey (RPs only) — try full name, then last-name+team fallback
        # Depth chart uses short names ("Helsley"), article uses full names ("Ryan Helsley").
        # Prefer depth-chart (CLOSER/1ST/2ND) over article (SVH#N) when both exist.
        is_rp  = 'RP' in p.get('pos', [])
        has_ip = p.get('IP', 0) > 0
        if is_rp or has_ip:
            cm = closer_data.get(key)
            if is_rp and (not cm or cm.startswith('SVH')):
                # Try last-name+team fallback to find depth-chart entry
                last = key.split()[-1] if key.split() else ''
                if last:
                    candidate = closer_data.get(last)
                    if candidate and not candidate.startswith('SVH'):
                        cm_team   = candidate.split(':')[1].upper() if ':' in candidate else ''
                        seed_team = p.get('t', '').upper()
                        if cm_team and seed_team and cm_team == seed_team:
                            cm = candidate  # upgrade SVH to depth-chart status
            if cm:
                entry['closerStatus'] = cm
            rank = closer_ranks.get(key)
            if not rank:
                last = key.split()[-1]
                rank = closer_ranks.get(last)
            if rank:
                entry['closerRank'] = rank

        if entry:
            rankings[pid] = entry

    return rankings

# ── Write output files ───────────────────────────────────────────────────────

def write_ids(ids):
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    js  = f"""/**
 * player_ids.js — External ID crosswalk (Chadwick Bureau + ESPN + Fantrax)
 * Generated: {now}
 * Refresh: python3 scripts/fetch_rankings.py --ids
 * Fields: fgId (FanGraphs), mlbId (MLBAM), espnId (ESPN Fantasy), fantraxId (Fantrax)
 */
const PLAYER_IDS = {json.dumps(ids, indent=2)};
"""
    with open(IDS_FILE, 'w') as f:
        f.write(js)
    print(f'Written: {IDS_FILE} ({len(ids)} players)')

def write_rankings(rankings):
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    js  = f"""/**
 * rankings.js — ECR, ESPN ADP/auction, CloserMonkey status
 * Generated: {now}
 * Refresh: python3 scripts/fetch_rankings.py --ranks
 * Fields: ecr, ecrMin, ecrMax, espnAuction, adp, closerStatus
 */
const PLAYER_RANKINGS = {json.dumps(rankings, indent=2)};
"""
    with open(RANKINGS_FILE, 'w') as f:
        f.write(js)
    print(f'Written: {RANKINGS_FILE} ({len(rankings)} players)')

# ── Main ─────────────────────────────────────────────────────────────────────

def load_existing_rankings():
    try:
        with open(RANKINGS_FILE) as f:
            content = f.read()
        m = re.search(r'const PLAYER_RANKINGS = (\{.*\});', content, re.DOTALL)
        return json.loads(m.group(1)) if m else {}
    except:
        return {}


def diff_rankings(old, new, players):
    """Print a human-readable diff of what would change in rankings.js."""
    pid_to_name = {p['id']: p['n'] for p in players}
    fields = ['ecr', 'espnAuction', 'adp', 'closerStatus', 'closerRank']

    added = []      # players gaining a field they didn't have
    removed = []    # players losing a field
    changed = []    # players with changed values

    all_pids = set(old) | set(new)
    for pid in sorted(all_pids, key=lambda p: pid_to_name.get(p, p)):
        name = pid_to_name.get(pid, pid)
        o = old.get(pid, {})
        n = new.get(pid, {})
        for f in fields:
            ov, nv = o.get(f), n.get(f)
            if ov == nv:
                continue
            if ov is None:
                added.append((name, f, nv))
            elif nv is None:
                removed.append((name, f, ov))
            else:
                changed.append((name, f, ov, nv))

    print(f'\n{"="*60}')
    print(f'DRY RUN DIFF — rankings.js')
    print(f'{"="*60}')
    print(f'Players with ECR:         {sum(1 for v in new.values() if "ecr" in v)}')
    print(f'Players with ESPN$:       {sum(1 for v in new.values() if "espnAuction" in v)}')
    print(f'Players with closerStatus:{sum(1 for v in new.values() if "closerStatus" in v)}')
    print(f'\nField changes: {len(changed)} changed | {len(added)} gained | {len(removed)} lost')

    if changed:
        print(f'\n── Changed values (showing up to 40) ──')
        for name, f, ov, nv in changed[:40]:
            print(f'  {name:<28} {f:<15} {str(ov):<12} → {nv}')
        if len(changed) > 40:
            print(f'  ... and {len(changed)-40} more')

    if added:
        print(f'\n── Newly tracked (gained data) ──')
        for name, f, nv in added[:20]:
            print(f'  {name:<28} {f:<15} (new) {nv}')
        if len(added) > 20:
            print(f'  ... and {len(added)-20} more')

    if removed:
        print(f'\n── Lost data (dropped from source) ──')
        for name, f, ov in removed[:20]:
            print(f'  {name:<28} {f:<15} was {ov}')
        if len(removed) > 20:
            print(f'  ... and {len(removed)-20} more')

    # Closer role changes specifically — high signal
    closer_changes = [(n, o, nv) for n, f, o, nv in changed if f == 'closerStatus']
    closer_added   = [(n, nv) for n, f, nv in added if f == 'closerStatus']
    closer_removed = [(n, ov) for n, f, ov in removed if f == 'closerStatus']
    if closer_changes or closer_added or closer_removed:
        print(f'\n── Closer role changes ──')
        for name, ov, nv in closer_changes:
            print(f'  {name:<28} {ov} → {nv}')
        for name, nv in closer_added:
            print(f'  {name:<28} (new role) {nv}')
        for name, ov in closer_removed:
            print(f'  {name:<28} lost role: was {ov}')

    print(f'\nNo files written. Run without --dry-run to apply.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids',      action='store_true', help='Only rebuild IDs (Chadwick + ESPN)')
    parser.add_argument('--ranks',    action='store_true', help='Only refresh rankings (fast)')
    parser.add_argument('--dry-run',  action='store_true', help='Fetch data but show diff only — write nothing')
    args = parser.parse_args()

    do_ids   = args.ids   or (not args.ids and not args.ranks)
    do_ranks = args.ranks or (not args.ids and not args.ranks)
    dry_run  = args.dry_run

    if dry_run:
        print('*** DRY RUN — no files will be written ***\n')

    players      = load_seed()
    existing_ids = load_existing_ids()

    print(f'Seed players: {len(players)}\n')

    if do_ids:
        print('=== BUILDING PLAYER IDS ===')
        ids = build_ids(players)
        merged = {**existing_ids, **ids}
        if dry_run:
            new_count  = sum(1 for pid in ids if pid not in existing_ids)
            diff_count = sum(
                1 for pid, entry in ids.items()
                if pid in existing_ids and entry != existing_ids[pid]
            )
            print(f'\nDRY RUN: {new_count} new players would be added, {diff_count} existing entries would change')
            print('No files written.')
        else:
            write_ids(merged)
        existing_ids = merged
        print()

    if do_ranks:
        print('=== FETCHING RANKINGS ===')
        ecr_data             = fetch_ecr()
        espn_adp             = fetch_espn_adp()
        closer, closer_ranks = fetch_closer_monkey()
        rankings             = build_rankings(players, existing_ids, ecr_data, espn_adp, closer, closer_ranks)

        matched_ecr    = sum(1 for v in rankings.values() if 'ecr' in v)
        matched_auct   = sum(1 for v in rankings.values() if 'espnAuction' in v)
        matched_closer = sum(1 for v in rankings.values() if 'closerStatus' in v)
        print(f'\nMatched: {matched_ecr} ECR  |  {matched_auct} ESPN auction  |  {matched_closer} CloserMonkey')

        if dry_run:
            old_rankings = load_existing_rankings()
            diff_rankings(old_rankings, rankings, players)
        else:
            write_rankings(rankings)
            # Keep rp_rankings.csv CM_Role column in sync
            print('\nSyncing CM_Role → data/manual/rp_rankings.csv ...')
            try:
                import subprocess
                subprocess.run(['python3', 'scripts/bake_manual.py', '--sync'], check=True)
            except Exception as e:
                print(f'  (sync skipped: {e})')

    if not dry_run:
        now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        print(f'\nTo deploy:')
        if do_ids:
            print(f'  git add {IDS_FILE}')
        if do_ranks:
            print(f'  git add {RANKINGS_FILE} data/manual/rp_rankings.csv js/data/manual_rankings.js')
        print(f'  git commit -m "Refresh rankings {now}" && git push')

if __name__ == '__main__':
    main()
