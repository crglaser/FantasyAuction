#!/usr/bin/env python3
"""Pre-bake FA recommendations for Chathams (team 'me') to data/fa_report.json.

Reads live data files, applies injury adjustments, scores candidates by
position group fit, and outputs ranked lists so FAAB analysis doesn't
require a full Claude session.

Usage:
  python3 scripts/fa_report.py
  python3 scripts/fa_report.py --my-tid me --top 30 --out data/fa_report.json
"""

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


# ── League settings ────────────────────────────────────────────────────────────
LEAGUE_CATS = {
    'hitting':  ['HR', 'OBP', 'RP', 'SB', 'XBH'],
    'pitching': ['W', 'K', 'ERA', 'SVH', 'WHIP'],
}
ALL_TIDS = ['me', 't1', 't2', 't3', 't5', 't6', 't7', 't8', 't9', 't10']

# IL-related keywords that indicate unavailability
IL_60_KEYWORDS = ['60-day il', '60-day injured list', '60 day il', '60day il']
# Require "placed on" language — blurbs that merely mention "injured list" in past/conditional
# context (e.g. "avoided the injured list", "returned from the il") should not flag.
IL_SHORT_KEYWORDS = ['placed on the il', 'placed on the injured list', 'is on the il',
                     'remains on the il', 'transferred to the']
IL_NEGATE_KEYWORDS = ['avoided', 'avoid', 'returned from', 'activated from', 'reinstated']


# ── Utilities ──────────────────────────────────────────────────────────────────
def canonical(name: str) -> str:
    decomposed = unicodedata.normalize('NFKD', name)
    ascii_name = decomposed.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]', '', ascii_name.lower())


def load_js_object(path: str, var_name: str):
    """Extract the JSON value assigned to `var_name` in a JS file."""
    p = Path(path)
    if not p.exists():
        print(f'  WARNING: {path} not found')
        return None
    text = p.read_text(encoding='utf-8')
    # Find assignment: const VARNAME = <value>;
    pattern = rf'{re.escape(var_name)}\s*=\s*'
    m = re.search(pattern, text)
    if not m:
        print(f'  WARNING: {var_name} not found in {path}')
        return None
    start = m.end()
    # Find matching bracket/brace
    first_char = text[start:].lstrip()[0]
    if first_char == '[':
        opener, closer = '[', ']'
    else:
        opener, closer = '{', '}'
    bracket_start = text.index(first_char, m.end())
    depth = 0
    for i, ch in enumerate(text[bracket_start:], bracket_start):
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[bracket_start:i+1])
                except json.JSONDecodeError as e:
                    print(f'  WARNING: JSON parse error in {path}: {e}')
                    return None
    return None


# ── Data loading ───────────────────────────────────────────────────────────────
def load_players() -> dict:
    """Load seed.js + steamer_extras.js, return dict id→player."""
    players = {}

    seed = load_js_object('js/data/seed.js', 'SEED_PLAYERS')
    if seed:
        for p in seed:
            players[p['id']] = dict(p)
        print(f'  seed.js: {len(seed)} players')

    extras = load_js_object('js/data/steamer_extras.js', 'STEAMER_EXTRAS')
    if extras:
        added = 0
        for p in extras:
            if p['id'] not in players:
                players[p['id']] = dict(p)
                added += 1
        print(f'  steamer_extras.js: {added} new players added')

    return players


def apply_manual_rankings(players: dict) -> None:
    manual = load_js_object('js/data/manual_rankings.js', 'MANUAL_RANKINGS')
    if not manual:
        return
    merged = 0
    for pid, fields in manual.items():
        if pid in players:
            players[pid].update(fields)
            merged += 1
    print(f'  manual_rankings.js: enriched {merged} players')


def apply_injury_cache(players: dict) -> dict:
    """Returns dict pid→{title, blurb, il60, il_short} for injured players."""
    cache = load_js_object('js/data/injuries_cache.js', 'INJURY_CACHE')
    if not cache:
        return {}

    injury_map = {}
    for pid, entry in cache.items():
        blurb = (entry.get('blurb') or '').lower()
        title = (entry.get('title') or '').lower()
        combined = title + ' ' + blurb

        negated = any(kw in combined for kw in IL_NEGATE_KEYWORDS)
        il60 = any(kw in combined for kw in IL_60_KEYWORDS)
        il_short = not il60 and not negated and any(kw in combined for kw in IL_SHORT_KEYWORDS)

        if il60 or il_short:
            injury_map[pid] = {
                'title': entry.get('title', ''),
                'il60': il60,
                'il_short': il_short,
            }
            if pid in players:
                players[pid]['inj'] = True
                if il60:
                    players[pid]['_il60'] = True

    print(f'  injuries_cache.js: {len(injury_map)} injured players flagged '
          f'({sum(1 for v in injury_map.values() if v["il60"])} on 60-day IL)')
    return injury_map


def load_fantrax_rosters() -> tuple[set, set, dict]:
    """Returns (rostered_ids, fa_ids, ftx_scores).
    fa_ids: set of player ids/name-keys explicitly listed as FA in Fantrax.
    rostered_ids: set of player ids on any of the 10 teams (from team arrays).
    ftx_scores: pid→ftxScore for players in Fantrax FA list.

    If team arrays are all empty (FA-only CSV export), rostered_ids will be
    empty and the caller must fall back to draft_state for filtering.
    """
    rosters = load_js_object('js/data/fantrax_rosters.js', 'FANTRAX_ROSTERS')
    if not rosters:
        return set(), set(), {}

    rostered_ids = set()
    fa_ids = set()
    ftx_scores = {}

    for tid in ALL_TIDS:
        for p in rosters.get(tid, []):
            pid = p.get('id') or canonical(p.get('n', ''))
            name_key = canonical(p.get('n', ''))
            if pid:
                rostered_ids.add(pid)
            if name_key:
                rostered_ids.add(name_key)

    for p in rosters.get('fa', []):
        pid = p.get('id') or canonical(p.get('n', ''))
        name_key = canonical(p.get('n', ''))
        score = p.get('ftxScore', 0) or 0
        if pid:
            fa_ids.add(pid)
            ftx_scores[pid] = score
        if name_key and name_key != pid:
            fa_ids.add(name_key)
            ftx_scores[name_key] = score

    total_fa = len(rosters.get('fa', []))
    has_team_data = len(rostered_ids) > 0
    print(f'  fantrax_rosters.js: {len(rostered_ids)//2} rostered (team arrays), '
          f'{total_fa} in FA list'
          + ('' if has_team_data else ' — team arrays empty, will use draft_state for rostered filter'))
    return rostered_ids, fa_ids, ftx_scores


def load_all_drafted_ids() -> set:
    """All player ids across all teams in draft_state_2026.js."""
    state = load_js_object('js/data/draft_state_2026.js', 'DRAFT_STATE_2026')
    if not state:
        return set()
    return set(state.get('drafted', {}).keys())


def load_my_roster(my_tid: str) -> set:
    """Get ids on my team from draft_state_2026.js."""
    state = load_js_object('js/data/draft_state_2026.js', 'DRAFT_STATE_2026')
    if not state:
        return set()
    drafted = state.get('drafted', {})
    return {pid for pid, rec in drafted.items() if rec.get('team') == my_tid}


# ── Scoring ────────────────────────────────────────────────────────────────────
def score_sp(p: dict) -> float:
    """Score SP on K volume + IP + ERA/WHIP quality."""
    ip   = float(p.get('IP', 0) or 0)
    k    = float(p.get('K', 0) or 0)
    w    = float(p.get('W', 0) or 0)
    era  = float(p.get('ERA', 4.50) or 4.50)
    whip = float(p.get('WHIP', 1.30) or 1.30)

    # K volume (most important), IP health, W
    k_score   = k * 0.15
    ip_score  = max(0, ip - 100) * 0.04   # bonus above 100 IP
    w_score   = w * 0.3
    era_score = max(0, 4.50 - era) * 2.5  # bonus below 4.50
    whip_score= max(0, 1.35 - whip) * 4.0 # bonus below 1.35

    base = k_score + ip_score + w_score + era_score + whip_score

    # PitcherList rank bonus
    pl_rank = p.get('PL_Rank')
    if pl_rank:
        base += max(0, (100 - pl_rank) * 0.08)

    return round(base, 2)


def score_rp(p: dict) -> float:
    """Score RP on SVH (saves+holds) and closer role."""
    svh  = float(p.get('SVH', 0) or 0)
    era  = float(p.get('ERA', 4.00) or 4.00)
    whip = float(p.get('WHIP', 1.30) or 1.30)
    k    = float(p.get('K', 0) or 0)

    svh_score  = svh * 0.55   # heavily weighted (SVH is key category)
    era_score  = max(0, 4.00 - era) * 1.5
    whip_score = max(0, 1.30 - whip) * 2.0
    k_score    = k * 0.04

    base = svh_score + era_score + whip_score + k_score

    # Closer role bonus
    cm_role = p.get('CM_Role', '') or ''
    if 'CLOSER' in cm_role:
        base += 8.0
    elif '1ST' in cm_role:
        base += 4.5
    elif '2ND' in cm_role:
        base += 1.5

    # PL RP rank bonus
    pl_rp = p.get('PL_RPRank')
    if pl_rp:
        base += max(0, (70 - pl_rp) * 0.08)

    return round(base, 2)


def score_hitter(p: dict) -> float:
    """Score hitter on HR, SB, OBP, XBH, RP (runs)."""
    hr   = float(p.get('HR', 0) or 0)
    sb   = float(p.get('SB', 0) or 0)
    obp  = float(p.get('OBP', 0) or 0)
    xbh  = float(p.get('XBH', 0) or 0)
    rp   = float(p.get('RP', 0) or 0)
    pa   = float(p.get('PA', 0) or 0)

    hr_score  = hr * 0.5
    sb_score  = sb * 0.45
    obp_score = max(0, obp - 0.300) * 40   # bonus above .300 OBP
    xbh_score = xbh * 0.12
    rp_score  = rp * 0.08
    pa_score  = max(0, pa - 200) * 0.015   # PA floor bonus

    base = hr_score + sb_score + obp_score + xbh_score + rp_score + pa_score

    # HitterList rank bonus
    hl_rank = p.get('HL_Rank')
    if hl_rank:
        base += max(0, (200 - hl_rank) * 0.04)

    return round(base, 2)


def get_injury_note(pid: str, injury_map: dict) -> str:
    entry = injury_map.get(pid)
    if not entry:
        return ''
    if entry['il60']:
        return '60-DAY IL'
    if entry['il_short']:
        return 'IL'
    return ''


VALID_CM_ROLES = {'CLOSER', '1ST', '2ND'}


def build_role_note(p: dict) -> str:
    parts = []
    cm = p.get('CM_Role', '') or ''
    if cm:
        segs = cm.split(':')
        role_part = segs[0]
        if role_part in VALID_CM_ROLES:
            team_part = segs[1] if len(segs) > 1 else ''
            committee = '*' in cm
            note = f'{role_part}:{team_part}'
            if committee:
                note += ' (committee)'
            parts.append(note)
    pl = p.get('PL_Rank')
    if pl:
        tier = p.get('PL_Tier', '')
        tier_str = f' T{tier}' if tier else ''
        parts.append(f'PL#{pl}{tier_str}')
    pl_rp = p.get('PL_RPRank')
    if pl_rp and not pl:
        tier = p.get('PL_RPTier', '')
        tier_str = f' T{tier}' if tier else ''
        parts.append(f'PL_RP#{pl_rp}{tier_str}')
    hl = p.get('HL_Rank')
    if hl:
        tier = p.get('HL_Tier', '')
        tier_str = f' T{tier}' if tier else ''
        parts.append(f'HL#{hl}{tier_str}')
    return ' | '.join(parts)


# ── Main report builder ────────────────────────────────────────────────────────
def build_report(my_tid: str, top_n: int) -> dict:
    print('\nLoading data...')
    players = load_players()
    apply_manual_rankings(players)
    injury_map = apply_injury_cache(players)
    rostered_ids, fa_ids, ftx_scores = load_fantrax_rosters()
    my_roster = load_my_roster(my_tid)

    print(f'\nMy roster ({my_tid}): {len(my_roster)} players')

    # If Fantrax team arrays were empty (FA-only export), fall back to draft state
    fantrax_has_team_data = len(rostered_ids) > 0
    all_drafted = load_all_drafted_ids() if not fantrax_has_team_data else set()
    if not fantrax_has_team_data:
        print(f'  Using draft_state for rostered filter ({len(all_drafted)} drafted players)')

    def is_fa(pid: str, p: dict) -> bool:
        name_key = canonical(p.get('n', ''))

        # Never recommend players on my own roster
        if pid in my_roster or name_key in my_roster:
            return False

        if fantrax_has_team_data:
            # Fantrax team data available — use it
            if name_key in rostered_ids or pid in rostered_ids:
                return False
            if pid in fa_ids or name_key in fa_ids:
                return True
            return False  # not listed anywhere, skip
        else:
            # FA-only export — use draft_state to filter out drafted players
            if pid in all_drafted:
                return False
            return True  # not in draft state = FA (or undrafted)

    # Score all candidates
    sps, rps, hitters = [], [], []

    for pid, p in players.items():
        pos = p.get('pos', [])
        if not pos:
            continue

        inj_note = get_injury_note(pid, injury_map)

        # Skip 60-day IL players entirely
        if p.get('_il60') or inj_note == '60-DAY IL':
            continue

        if not is_fa(pid, p):
            continue

        # IL penalty: reduce projected stats by 40% for short-term IL
        effective = dict(p)
        if inj_note == 'IL':
            for stat in ['IP', 'K', 'W', 'SVH', 'HR', 'SB', 'XBH', 'RP', 'PA']:
                if stat in effective and effective[stat]:
                    effective[stat] = float(effective[stat]) * 0.6

        name = p.get('n', pid)
        team = p.get('t', '')
        unofficial = p.get('unofficial', False)
        role_note = build_role_note(p)
        ftx_score = ftx_scores.get(pid, ftx_scores.get(canonical(p.get('n', '')), 0))

        def make_entry(score, pos_label):
            return {
                'id': pid,
                'name': name,
                'team': team,
                'pos': pos,
                'score': score,
                'ftxScore': ftx_score,
                'injNote': inj_note,
                'roleNote': role_note,
                'unofficial': unofficial,
                'csValA': p.get('csValA', 0),
                'csValS': p.get('csValS', 0),
                'stats': _format_stats(p, pos_label),
            }

        if 'SP' in pos:
            sc = score_sp(effective)
            if sc > 0 or p.get('PL_Rank'):
                sps.append(make_entry(sc, 'SP'))

        if 'RP' in pos and 'SP' not in pos:
            sc = score_rp(effective)
            if sc > 0 or p.get('CM_Role') or p.get('PL_RPRank'):
                rps.append(make_entry(sc, 'RP'))

        # Hitters: non-pitchers with PA data
        if not any(pos_p in pos for pos_p in ['SP', 'RP']):
            sc = score_hitter(effective)
            if sc > 0 or p.get('HL_Rank'):
                hitters.append(make_entry(sc, 'H'))

    # Sort and trim
    sps.sort(key=lambda x: x['score'], reverse=True)
    rps.sort(key=lambda x: x['score'], reverse=True)
    hitters.sort(key=lambda x: x['score'], reverse=True)

    print(f'\nCandidates scored: {len(sps)} SP, {len(rps)} RP, {len(hitters)} hitters')

    return {
        'myTid': my_tid,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sp': sps[:top_n],
        'rp': rps[:top_n],
        'hitters': hitters[:top_n],
        '_meta': {
            'totalSP': len(sps),
            'totalRP': len(rps),
            'totalHitters': len(hitters),
            'injuredExcluded': sum(1 for v in injury_map.values() if v['il60']),
        }
    }


def _format_stats(p: dict, pos_label: str) -> dict:
    if pos_label == 'SP':
        return {
            'IP':   p.get('IP', 0),
            'K':    p.get('K', 0),
            'W':    p.get('W', 0),
            'ERA':  p.get('ERA', 0),
            'WHIP': p.get('WHIP', 0),
        }
    if pos_label == 'RP':
        return {
            'SVH':  p.get('SVH', 0),
            'K':    p.get('K', 0),
            'ERA':  p.get('ERA', 0),
            'WHIP': p.get('WHIP', 0),
            'IP':   p.get('IP', 0),
        }
    return {
        'PA':  p.get('PA', 0),
        'HR':  p.get('HR', 0),
        'SB':  p.get('SB', 0),
        'OBP': p.get('OBP', 0),
        'XBH': p.get('XBH', 0),
        'RP':  p.get('RP', 0),
    }


# ── Print report ───────────────────────────────────────────────────────────────
def print_report(report: dict, top_n: int) -> None:
    def badge(entry):
        parts = []
        if entry.get('unofficial'):
            parts.append('(est)')
        if entry.get('injNote'):
            parts.append(f'[{entry["injNote"]}]')
        return ' '.join(parts)

    print(f'\n{"="*70}')
    print(f'FA REPORT — {report["myTid"].upper()} — {report["generatedAt"][:10]}')
    print(f'{"="*70}')

    print(f'\n── TOP SPs ──')
    print(f'{"Scr":>5}  {"FTX":>5}  {"Name":<22} {"T":<4} {"IP":>4} {"K":>4} {"W":>3} {"ERA":>5} {"WHIP":>5}  Note')
    for e in report['sp'][:top_n]:
        s = e['stats']
        note = ' | '.join(filter(None, [e['roleNote'], badge(e)]))
        print(f'{e["score"]:5.1f}  {e["ftxScore"]:5.1f}  {e["name"]:<22} {e["team"]:<4} '
              f'{s.get("IP",0):4.0f} {s.get("K",0):4.0f} {s.get("W",0):3.0f} '
              f'{s.get("ERA",0):5.2f} {s.get("WHIP",0):5.3f}  {note}')

    print(f'\n── TOP RPs ──')
    print(f'{"Scr":>5}  {"FTX":>5}  {"Name":<22} {"T":<4} {"SVH":>4} {"K":>4} {"ERA":>5} {"WHIP":>5}  Role/Note')
    for e in report['rp'][:top_n]:
        s = e['stats']
        note = ' | '.join(filter(None, [e['roleNote'], badge(e)]))
        print(f'{e["score"]:5.1f}  {e["ftxScore"]:5.1f}  {e["name"]:<22} {e["team"]:<4} '
              f'{s.get("SVH",0):4.0f} {s.get("K",0):4.0f} '
              f'{s.get("ERA",0):5.2f} {s.get("WHIP",0):5.3f}  {note}')

    print(f'\n── TOP HITTERS ──')
    print(f'{"Scr":>5}  {"FTX":>5}  {"Name":<22} {"T":<4} {"PA":>4} {"HR":>4} {"SB":>4} {"OBP":>5} {"XBH":>4}  Note')
    for e in report['hitters'][:top_n]:
        s = e['stats']
        note = ' | '.join(filter(None, [e['roleNote'], badge(e)]))
        print(f'{e["score"]:5.1f}  {e["ftxScore"]:5.1f}  {e["name"]:<22} {e["team"]:<4} '
              f'{s.get("PA",0):4.0f} {s.get("HR",0):4.0f} {s.get("SB",0):4.0f} '
              f'{s.get("OBP",0):5.3f} {s.get("XBH",0):4.0f}  {note}')


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Bake FA recommendations to JSON')
    parser.add_argument('--my-tid', default='me', help='My team ID (default: me)')
    parser.add_argument('--top', type=int, default=20, help='Players per group in output (default: 20)')
    parser.add_argument('--out', default='data/fa_report.json', help='Output JSON path')
    parser.add_argument('--print', dest='print_report', action='store_true',
                        help='Print formatted report to stdout')
    args = parser.parse_args()

    report = build_report(my_tid=args.my_tid, top_n=args.top)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f'\nWrote {out_path}')

    # Always write a JS-loadable companion
    js_path = out_path.with_suffix('.js')
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('// Generated by scripts/fa_report.py — do not edit\n')
        f.write('const FA_REPORT = ')
        f.write(json.dumps(report, indent=2, ensure_ascii=False))
        f.write(';\n')
    print(f'Wrote {js_path}')

    if args.print_report:
        print_report(report, args.top)
    else:
        print('\nRe-run with --print to see formatted table.')


if __name__ == '__main__':
    main()
