#!/usr/bin/env python3
"""
generate_extras.py — Generate steamer_extras.js with FanGraphs Steamer estimates
for players NOT already in seed.js.

Criteria:
  SPs: 80+ IP projected
  RPs: 5+ projected SV OR 10+ projected HLD

Calibration: derived from overlap between seed players and FG data.

Usage:
  python3 scripts/generate_extras.py
"""

import json, re, statistics, os, sys
from datetime import datetime, timezone

FG_URL      = 'https://www.fangraphs.com/api/projections?type=steamer&stats=pit&pos=p&team=0&players=0&lg=all'
FG_CACHE    = '/tmp/fg_steamer.json'
SEED_FILE   = 'js/data/seed.js'
OUTPUT_FILE = 'js/data/steamer_extras.js'


def name_key(n):
    """Normalize name for matching: lowercase, strip accents via regex, keep only a-z0-9."""
    n = n.lower()
    # Basic ASCII-fold common accented chars
    n = n.replace('é', 'e').replace('á', 'a').replace('í', 'i').replace('ó', 'o')
    n = n.replace('ú', 'u').replace('ñ', 'n').replace('ü', 'u').replace('ä', 'a')
    n = n.replace('ö', 'o').replace('è', 'e').replace('ê', 'e').replace('â', 'a')
    n = re.sub(r'[^a-z0-9]', '', n)
    return n


def make_id(name, team):
    n = re.sub(r'[^a-z0-9]', '', name.lower())
    return f"{n}-{team.lower()}"


def normalize_team(team):
    mapping = {'KCR': 'KC', 'SFG': 'SF', 'TBR': 'TB', 'CHW': 'CWS', 'WSN': 'WSH'}
    return mapping.get(team, team)


def load_fg_data():
    """Load FG Steamer JSON from cache or re-fetch."""
    if os.path.exists(FG_CACHE):
        print(f'Loading FG Steamer from cache: {FG_CACHE}')
        with open(FG_CACHE) as f:
            return json.load(f)

    print('Cache not found, fetching from FanGraphs...')
    import subprocess
    result = subprocess.run([
        'curl', '-s', '--compressed',
        '-H', 'Referer: https://www.fangraphs.com/',
        '-H', 'User-Agent: Mozilla/5.0',
        FG_URL
    ], capture_output=True, text=True)
    data = json.loads(result.stdout)
    with open(FG_CACHE, 'w') as f:
        json.dump(data, f)
    print(f'Fetched and cached {len(data)} pitchers to {FG_CACHE}')
    return data


def load_seed():
    """Load SEED_PLAYERS from seed.js."""
    with open(SEED_FILE) as f:
        content = f.read()
    start = content.index('[')
    end = content.rindex(']') + 1
    return json.loads(content[start:end])


def compute_calibration_ratios(seed_players, fg_by_name):
    """Compute median csValA/FPTS and csValS/SPTS ratios for SPs and RPs."""
    sp_ratios_a, sp_ratios_s = [], []
    rp_ratios_a, rp_ratios_s = [], []

    for p in seed_players:
        key = name_key(p['n'])
        if key not in fg_by_name:
            continue
        fgp = fg_by_name[key]
        pos = p.get('pos', [])

        if 'SP' in pos and p.get('csValA', 0) > 1 and fgp['FPTS'] > 500:
            rat_a = p['csValA'] / fgp['FPTS']
            rat_s = p.get('csValS', 0) / fgp['SPTS'] if fgp['SPTS'] > 500 and p.get('csValS', 0) > 1 else None
            if 0.001 < rat_a < 0.05:
                sp_ratios_a.append(rat_a)
            if rat_s and 0.001 < rat_s < 0.05:
                sp_ratios_s.append(rat_s)

        if 'RP' in pos and p.get('csValA', 0) > 1 and fgp['FPTS'] > 100:
            rat_a = p['csValA'] / fgp['FPTS']
            rat_s = p.get('csValS', 0) / fgp['SPTS'] if fgp['SPTS'] > 100 and p.get('csValS', 0) > 1 else None
            if 0.001 < rat_a < 0.05:
                rp_ratios_a.append(rat_a)
            if rat_s and 0.001 < rat_s < 0.05:
                rp_ratios_s.append(rat_s)

    ratios = {
        'sp_a': statistics.median(sp_ratios_a),
        'sp_s': statistics.median(sp_ratios_s),
        'rp_a': statistics.median(rp_ratios_a),
        'rp_s': statistics.median(rp_ratios_s),
    }
    print(f'Calibration: SP ratio_a={ratios["sp_a"]:.6f}, SP ratio_s={ratios["sp_s"]:.6f}')
    print(f'Calibration: RP ratio_a={ratios["rp_a"]:.6f}, RP ratio_s={ratios["rp_s"]:.6f}')
    return ratios


def classify_pitcher(fgp):
    """Determine if a pitcher is primarily SP or RP based on GS vs G."""
    gs = fgp.get('GS', 0)
    g = fgp.get('G', 1)
    if g == 0:
        return None
    if gs / g >= 0.5:
        return 'SP'
    return 'RP'


def main():
    fg_data = load_fg_data()
    seed_players = load_seed()

    seed_ids = {p['id'] for p in seed_players}
    seed_name_keys = {name_key(p['n']) for p in seed_players}

    # Build FG lookup by name_key
    fg_by_name = {}
    for p in fg_data:
        k = name_key(p['PlayerName'])
        # Keep the one with higher IP if duplicate names
        if k not in fg_by_name or p['IP'] > fg_by_name[k]['IP']:
            fg_by_name[k] = p

    ratios = compute_calibration_ratios(seed_players, fg_by_name)

    extras = []
    sp_count = 0
    rp_count = 0

    for fgp in fg_data:
        pname = fgp['PlayerName']
        key = name_key(pname)

        # Skip players already in seed
        if key in seed_name_keys:
            continue

        fg_team = normalize_team(fgp.get('Team') or 'FA')
        pid = make_id(pname, fg_team)
        if pid in seed_ids:
            continue

        ip = fgp.get('IP', 0)
        sv = fgp.get('SV', 0)
        hld = fgp.get('HLD', 0)
        fpts = fgp.get('FPTS', 0)
        spts = fgp.get('SPTS', 0)

        pos_type = classify_pitcher(fgp)

        if pos_type == 'SP' and ip >= 80:
            va = round(fpts * ratios['sp_a'], 1)
            vs = round(spts * ratios['sp_s'], 1)
            player = {
                "id": pid,
                "n": pname,
                "t": fg_team,
                "pos": ["SP"],
                "unofficial": True,
                "csValA": va,
                "csValS": vs,
                "IP": round(ip),
                "W": round(fgp.get('W', 0), 1),
                "SVH": int(round(sv + hld)),
                "K": round(fgp.get('SO', 0)),
                "ERA": round(fgp.get('ERA', 0), 2),
                "WHIP": round(fgp.get('WHIP', 0), 2)
            }
            extras.append(player)
            sp_count += 1

        elif pos_type == 'RP' and (sv >= 5 or hld >= 10):
            va = round(fpts * ratios['rp_a'], 1)
            vs = round(spts * ratios['rp_s'], 1)
            player = {
                "id": pid,
                "n": pname,
                "t": fg_team,
                "pos": ["RP"],
                "unofficial": True,
                "csValA": va,
                "csValS": vs,
                "IP": round(ip),
                "W": round(fgp.get('W', 0), 1),
                "SVH": int(round(sv + hld)),
                "K": round(fgp.get('SO', 0)),
                "ERA": round(fgp.get('ERA', 0), 2),
                "WHIP": round(fgp.get('WHIP', 0), 2)
            }
            extras.append(player)
            rp_count += 1

    # Sort by csValA descending
    extras.sort(key=lambda p: p.get('csValA', 0), reverse=True)

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    js = f"""// steamer_extras.js — FanGraphs Steamer estimates for players not in seed.js
// Generated by scripts/generate_extras.py on {now}
// NOT official values. Shown in muted style in the auction board.
const STEAMER_EXTRAS = {json.dumps(extras, indent=2, ensure_ascii=False)};
"""

    with open(OUTPUT_FILE, 'w') as f:
        f.write(js)

    print(f'\nGenerated {OUTPUT_FILE}:')
    print(f'  SPs: {sp_count}')
    print(f'  RPs: {rp_count}')
    print(f'  Total extras: {len(extras)}')
    print(f'\nTop 10 by csValA:')
    for p in extras[:10]:
        print(f'  {p["n"]} ({p["t"]}): csValA={p["csValA"]}, pos={p["pos"]}')


if __name__ == '__main__':
    main()
