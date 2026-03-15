#!/usr/bin/env python3
"""
update_injuries.py — Refresh js/data/injuries_cache.js from ESPN Fantasy API

Usage:
    python3 scripts/update_injuries.py            # injured players + active last 7 days
    python3 scripts/update_injuries.py --days 14  # wider recency window
    python3 scripts/update_injuries.py --all      # all 500 players (slow, ~2 min)

AI summaries are generated automatically when ANTHROPIC_API_KEY is set.
Existing summaries are preserved if the blurb hasn't changed (no redundant API calls).

Writes: js/data/injuries_cache.js
Then:   git add js/data/injuries_cache.js && git commit -m "Refresh injuries $(date -u +%Y-%m-%d)"
        git push origin main
"""

import json, urllib.request, urllib.parse, unicodedata, re, time, sys, argparse, os, subprocess
from datetime import datetime, timezone, timedelta

SEED_FILE    = 'js/data/seed.js'
OUTPUT_FILE  = 'js/data/injuries_cache.js'
RATE_DELAY   = 0.15
AI_RATE_DELAY = 0.3  # pause between Claude API calls

# Keywords that strongly indicate an injury — avoid generic words that appear in all blurbs
INJ_KEYWORDS = {
    'injured list', '10-day il', '15-day il', '60-day il', 'placed on the il',
    'disabled list', 'placed on the dl', 'day-to-day', 'dtd',
    'shut down', 'out indefinitely', 'out for the season',
    'surgery', 'operated', 'procedure',
    'elbow inflammation', 'shoulder inflammation', 'knee inflammation',
    'strained', 'sprained', 'fractured', 'torn', 'rupture',
    'recovery from', 'rehab assignment', 'rehabbing',
    'setback', 'not expected to be ready',
}

# Softer keywords — only flag if also no game activity mentioned
INJ_SOFT = {
    'elbow', 'shoulder', 'knee', 'hamstring', 'quad', 'oblique', 'back',
    'wrist', 'forearm', 'hamate', 'lat', 'hip', 'calf', 'ankle',
    'biceps', 'triceps', 'hand', 'finger',
}

SUFFIXES = {'jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv'}

def normalize(name):
    n = unicodedata.normalize('NFD', name.lower())
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn')
    return n.strip().rstrip('.')  # strip trailing periods

def fetch(url, headers=None, timeout=12):
    h = {'User-Agent': 'Mozilla/5.0'}
    if headers: h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def has_injury_content(headline, blurb):
    combined = (headline + ' ' + blurb).lower()
    # Hard keywords — definitive
    if any(kw in combined for kw in INJ_KEYWORDS):
        return True
    # Soft keywords — only if no signs of active play
    active_signs = {'went', 'homered', 'struck out', 'pitched', 'started', 'batted',
                    'went 1-for', 'went 2-for', 'went 0-for', 'spring debut',
                    'allowed', 'strikeout', 'innings', 'at-bat'}
    if any(kw in combined for kw in INJ_SOFT):
        if not any(s in combined for s in active_signs):
            return True
    return False

def load_seed_players():
    with open(SEED_FILE) as f:
        content = f.read()
    m = re.search(r'const SEED_PLAYERS = (\[.*\]);', content, re.DOTALL)
    return json.loads(m.group(1))

def build_espn_map():
    print('Loading ESPN player list...')
    d = fetch(
        'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026'
        '/players?scoringPeriodId=0&view=players_wl',
        headers={'X-Fantasy-Filter': '{"filterActive":{"value":true}}'}
    )
    result = {}
    for p in d:
        if 'fullName' not in p: continue
        key = normalize(p['fullName'])
        result[key] = {'id': p['id'], 'lastNewsDate': p.get('lastNewsDate', 0)}
    print(f'  {len(result)} ESPN players loaded')
    return result

def match_espn(player_name, espn_map):
    """Match player name to ESPN entry. Returns {'id':..,'lastNewsDate':..} or None."""
    norm = normalize(player_name)
    # 1. Exact match
    if norm in espn_map:
        return espn_map[norm]
    # 2. Try without suffix (e.g. "Bobby Witt Jr." → "Bobby Witt")
    words = norm.split()
    if words and words[-1] in SUFFIXES:
        no_suffix = ' '.join(words[:-1])
        if no_suffix in espn_map:
            return espn_map[no_suffix]
    # 3. Last-name fuzzy — only if last name is NOT a suffix and match is unique
    last = words[-1] if words else ''
    if last in SUFFIXES and len(words) > 1:
        last = words[-2]  # use actual last name for Jr. players
    if last and last not in SUFFIXES:
        matches = [(k, v) for k, v in espn_map.items()
                   if last in k.split() and k.split()[-1] not in SUFFIXES]
        if len(matches) == 1:
            return matches[0][1]
    return None

def fetch_player_news(espn_id):
    url = (f'https://site.api.espn.com/apis/fantasy/v2/games/flb'
           f'/news/players?playerId={espn_id}&limit=3')
    return fetch(url).get('feed', [])

def make_cache_entry(item):
    story = item.get('story', '') or item.get('description', '') or ''
    clean = re.sub(r'<[^>]+>', '', story).strip()
    return {
        'title':   item.get('headline', ''),
        'blurb':   clean[:700],
        'ts':      int(time.time() * 1000),
        'pubDate': item.get('lastModified', ''),
        'link':    f"https://www.espn.com/fantasy/baseball/story/_/id/{item.get('id','')}",
        'isNew':   True,
        'source':  'ESPN',
    }


def ai_summarize(blurb):
    """Use the claude CLI (already authenticated) to summarize an injury blurb."""
    if not blurb:
        return None
    prompt = (
        'You are a terse fantasy baseball injury analyst. Respond with exactly 3 labeled lines and nothing else.\n\n'
        'Summarize this injury report:\n'
        'INJURY: [type of injury]\n'
        'PROGNOSIS: [good/moderate/serious/season-ending]\n'
        'RETURN: [expected timeline, e.g. "2-3 weeks" or "day-to-day" or "out for season"]\n\n'
        f'Report: {blurb[:600]}'
    )
    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--model', 'claude-haiku-4-5-20251001'],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip() or None
    except Exception as e:
        print(f'    AI summary error: {e}')
        return None

def load_existing_cache():
    """Load the existing injuries_cache.js to preserve summaries for unchanged blurbs."""
    try:
        with open(OUTPUT_FILE) as f:
            content = f.read()
        m = re.search(r'const INJURY_CACHE = (\{.*\});', content, re.DOTALL)
        if m:
            return json.loads(m.group(1))
    except Exception:
        pass
    return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--all', action='store_true')
    args = parser.parse_args()

    claude_bin = subprocess.run(['which', 'claude'], capture_output=True, text=True).stdout.strip()
    use_ai = bool(claude_bin)
    print(f'AI summaries: {"enabled (claude CLI found at " + claude_bin + ")" if use_ai else "disabled (claude CLI not found)"}')

    cutoff_ms = 0 if args.all else (
        (datetime.now(timezone.utc) - timedelta(days=args.days)).timestamp() * 1000
    )

    players        = load_seed_players()
    espn_map       = build_espn_map()
    existing_cache = load_existing_cache()
    print(f'Existing cache: {len(existing_cache)} entries (summaries will be preserved for unchanged blurbs)\n')

    cache         = {}
    newly_injured = []
    updated       = []
    skipped       = 0
    no_espn       = []
    summarized    = 0
    reused        = 0

    already_injured = {p['id'] for p in players if p.get('inj')}
    print(f'\nPool: {len(players)} players  |  Pre-flagged injured: {len(already_injured)}\n')

    for p in players:
        espn = match_espn(p['n'], espn_map)
        if not espn:
            no_espn.append(p['n'])
            continue

        is_inj    = p['id'] in already_injured
        is_recent = espn['lastNewsDate'] > cutoff_ms

        if not is_inj and not is_recent and not args.all:
            skipped += 1
            continue

        try:
            feed = fetch_player_news(espn['id'])
            time.sleep(RATE_DELAY)
        except Exception as e:
            print(f'  ✗ {p["n"]}: {e}')
            continue

        if not feed:
            continue

        latest   = feed[0]
        headline = latest.get('headline', '')
        blurb    = re.sub(r'<[^>]+>', '', latest.get('story', '') or '').strip()

        if is_inj or has_injury_content(headline, blurb):
            entry = make_cache_entry(latest)
            prev  = existing_cache.get(p['id'], {})

            if use_ai and entry.get('blurb'):
                if prev.get('summary') and prev.get('blurb', '') == entry['blurb']:
                    # Blurb unchanged — reuse existing summary, no API call needed
                    entry['summary'] = prev['summary']
                    reused += 1
                else:
                    summary = ai_summarize(entry['blurb'])
                    if summary:
                        entry['summary'] = summary
                        summarized += 1
                        print(f'    ✓ AI summary: {summary[:60]}…')
                    time.sleep(AI_RATE_DELAY)

            cache[p['id']] = entry
            if is_inj:
                updated.append(p['n'])
                print(f'  [UPD] {p["n"]}: {headline[:65]}')
            else:
                newly_injured.append(p['n'])
                print(f'  [NEW ⚠] {p["n"]}: {headline[:65]}')

    # Write output
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    summarized_count = sum(1 for e in cache.values() if e.get('summary'))
    out = f"""/**
 * injuries_cache.js — Player injury news (ESPN Fantasy API)
 * Generated: {now_str}
 * Updated:       {len(updated)} existing injured players
 * Newly flagged: {len(newly_injured)} previously healthy players
 * AI summaries:  {summarized_count} entries
 * Run: python3 scripts/update_injuries.py
 */
const INJURY_CACHE = {json.dumps(cache, indent=2)};
"""
    with open(OUTPUT_FILE, 'w') as f:
        f.write(out)

    print(f'\n{"="*60}')
    print(f'Updated:         {len(updated)} existing injured players')
    print(f'Newly detected:  {len(newly_injured)}' + (' — REVIEW:' if newly_injured else ''))
    for n in newly_injured:
        print(f'   ⚠  {n}')
    print(f'Skipped (quiet): {skipped}')
    print(f'No ESPN match:   {len(no_espn)} ({", ".join(no_espn[:4])}{"…" if len(no_espn)>4 else ""})')
    if use_ai:
        print(f'AI summaries:    {summarized} new, {reused} reused from cache')
    print(f'\nWritten: {OUTPUT_FILE} ({len(cache)} players cached, {summarized_count} with summaries)')
    print(f'\nTo deploy:')
    print(f'  git add {OUTPUT_FILE} && git commit -m "Refresh injuries {now_str[:10]}" && git push')
    if not use_ai:
        print(f'\nTo enable AI summaries: install claude CLI (https://claude.ai/code)')

if __name__ == '__main__':
    main()
