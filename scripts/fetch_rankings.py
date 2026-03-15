#!/usr/bin/env python3
"""
fetch_rankings.py — Pull ECR, ESPN ADP/auction, CloserMonkey, and FanGraphs IDs

Writes:
  js/data/player_ids.js   — fgId, mlbId, espnId per player (stable, commit once)
  js/data/rankings.js     — ecr, adp, espnAuction, closerStatus (refresh weekly)

Usage:
  python3 scripts/fetch_rankings.py           # full run
  python3 scripts/fetch_rankings.py --ids     # only rebuild IDs (slow, uses Chadwick)
  python3 scripts/fetch_rankings.py --ranks   # only refresh rankings (fast)
"""

import json, urllib.request, urllib.parse, unicodedata, re, time, sys, argparse, csv, io
from datetime import datetime, timezone

SEED_FILE      = 'js/data/seed.js'
IDS_FILE       = 'js/data/player_ids.js'
RANKINGS_FILE  = 'js/data/rankings.js'
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

def build_ids(players):
    """Match seed players to MLBAM, FanGraphs, ESPN IDs."""
    chadwick, _ = build_chadwick_map()
    espn_map    = build_espn_id_map()

    ids = {}
    matched_fg = 0; matched_espn = 0; unmatched = []

    for p in players:
        key   = name_key(p['n'])
        entry = {'fgId': None, 'mlbId': None, 'espnId': None}

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

        if entry['fgId'] or entry['espnId']:
            ids[p['id']] = {k: v for k, v in entry.items() if v is not None}
        else:
            unmatched.append(p['n'])

    print(f'\nID matching: {matched_fg} FanGraphs IDs, {matched_espn} ESPN IDs')
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
    closer_map = {}  # normalize(name) → status

    def add_player(name, status):
        if not name or name.strip() in ('', '—', '-', 'TBD', 'N/A'): return
        # Handle multiple players in one cell (e.g., "Hader/Smith")
        for n in re.split(r'[/,]', name):
            n = n.strip()
            if n:
                closer_map[name_key(n)] = status

    # Table rows: Team | Closer | 1st in line | 2nd in line | ...
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
        if len(cells) < 3: continue
        # cells[0]=team, cells[1]=closer, cells[2]=1st, cells[3]=2nd...
        if cells[0] and len(cells[0]) <= 4:  # looks like a team abbrev
            if len(cells) > 1 and cells[1]:
                add_player(cells[1].rstrip('*'), 'CLOSER')
            if len(cells) > 2 and cells[2]:
                add_player(cells[2].rstrip('*'), 'HANDCUFF')
            if len(cells) > 3 and cells[3]:
                add_player(cells[3].rstrip('*'), 'DEEP')

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
                if key not in closer_map:  # don't override depth chart
                    closer_map[key] = f'SVH#{rank}'
        except Exception as e:
            print(f'  CloserMonkey article error: {e}')

    print(f'  CloserMonkey: {len(closer_map)} relievers classified')
    return closer_map

# ── Merge everything ─────────────────────────────────────────────────────────

def build_rankings(players, existing_ids, ecr_data, espn_adp, closer_data):
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

        # CloserMonkey (RPs only)
        is_rp = any(pos in p.get('pos', []) for pos in ['RP', 'SP'])
        if is_rp or p.get('IP', 0) > 0:
            cm = closer_data.get(key)
            if cm:
                entry['closerStatus'] = cm

        if entry:
            rankings[pid] = entry

    return rankings

# ── Write output files ───────────────────────────────────────────────────────

def write_ids(ids):
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    js  = f"""/**
 * player_ids.js — External ID crosswalk (Chadwick Bureau + ESPN)
 * Generated: {now}
 * Refresh: python3 scripts/fetch_rankings.py --ids
 * Fields: fgId (FanGraphs), mlbId (MLBAM), espnId (ESPN Fantasy)
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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids',   action='store_true', help='Only rebuild IDs (Chadwick + ESPN)')
    parser.add_argument('--ranks', action='store_true', help='Only refresh rankings (fast)')
    args = parser.parse_args()

    do_ids   = args.ids   or (not args.ids and not args.ranks)
    do_ranks = args.ranks or (not args.ids and not args.ranks)

    players      = load_seed()
    existing_ids = load_existing_ids()

    print(f'Seed players: {len(players)}\n')

    if do_ids:
        print('=== BUILDING PLAYER IDS ===')
        ids = build_ids(players)
        # Merge with existing (preserve manual additions)
        merged = {**existing_ids, **ids}
        write_ids(merged)
        existing_ids = merged
        print()

    if do_ranks:
        print('=== FETCHING RANKINGS ===')
        ecr_data   = fetch_ecr()
        espn_adp   = fetch_espn_adp()
        closer     = fetch_closer_monkey()
        rankings   = build_rankings(players, existing_ids, ecr_data, espn_adp, closer)

        matched_ecr    = sum(1 for v in rankings.values() if 'ecr' in v)
        matched_auct   = sum(1 for v in rankings.values() if 'espnAuction' in v)
        matched_closer = sum(1 for v in rankings.values() if 'closerStatus' in v)
        print(f'\nMatched: {matched_ecr} ECR  |  {matched_auct} ESPN auction  |  {matched_closer} CloserMonkey')

        write_rankings(rankings)

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f'\nTo deploy:')
    if do_ids:
        print(f'  git add {IDS_FILE}')
    if do_ranks:
        print(f'  git add {RANKINGS_FILE}')
    print(f'  git commit -m "Refresh rankings {now}" && git push')

if __name__ == '__main__':
    main()
