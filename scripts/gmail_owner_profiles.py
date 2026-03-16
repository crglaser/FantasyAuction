#!/usr/bin/env python3
"""
gmail_owner_profiles.py — Pull league owner emails from Gmail and build personality profiles.

Setup (one-time):
  1. Go to https://console.cloud.google.com/
  2. Create a project → Enable "Gmail API"
  3. Create credentials → OAuth 2.0 Client ID → Desktop app → Download as credentials.json
  4. Place credentials.json in the project root (FantasyAuction/)
  5. pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client anthropic

Run:
  python3 scripts/gmail_owner_profiles.py                  # pull emails + summarize all owners
  python3 scripts/gmail_owner_profiles.py --owner "Barry"  # single owner
  python3 scripts/gmail_owner_profiles.py --pull-only      # skip AI summarization
  python3 scripts/gmail_owner_profiles.py --summarize-only # skip Gmail pull, use cached threads

Output:
  data/owner_profiles/threads_<owner_key>.json  — raw email threads per owner
  data/owner_profiles/profile_<owner_key>.json  — AI personality profile per owner
  data/owner_profiles/summary.json              — all profiles merged (load into draft tool)
"""

import os
import json
import re
import argparse
import time
import base64
from pathlib import Path
from datetime import datetime

# ── Constants ─────────────────────────────────────────────────────────────────

CREDENTIALS_FILE = Path(__file__).parent.parent / 'credentials.json'
TOKEN_FILE = Path(__file__).parent.parent / 'token.json'
OUTPUT_DIR = Path(__file__).parent.parent / 'data' / 'owner_profiles'

# Gmail search terms to find league-related emails.
# Tune these to match your league's actual subject lines / group thread names.
LEAGUE_SEARCH_TERMS = [
    'Teddy Ballgame',
    'fantasy baseball',
    'auction draft',
    'roto',
]

# Max threads to pull per owner (Gmail API quota: 1B units/day; each thread ~10 units)
MAX_THREADS_PER_OWNER = 200
MAX_MESSAGES_PER_THREAD = 20

# League owners: key → display info + known email fragments for matching.
# Add actual email addresses where known — the script matches on From/To headers.
# Use partial strings (e.g. first name, domain) if you don't have full addresses.
OWNERS = {
    'me': {
        'name': 'Craig Glaser & Terry Lyons',
        'team': 'Chathams',
        'emails': ['crglaser@gmail.com', 'tl@terrylyons.com'],
    },
    't1': {
        'name': 'Brian Garber & Andrew Lombardi',
        'team': 'Spew',
        'emails': ['bngarber@yahoo.com', 'littleguyinc@yahoo.com'],
    },
    't2': {
        'name': 'Joe Achille',
        'team': 'Village Idiots',
        'emails': ['jachille1@yahoo.com'],
    },
    't3': {
        'name': 'Barry Carlin',
        'team': 'Happy Recap',
        'emails': ['bcarlin56@gmail.com'],
    },
    't5': {
        'name': 'Andrew & Susan Grossman',
        'team': 'Widowmakers',
        'emails': ['agbarrister@aol.com', 'ungersnug@aol.com'],
    },
    't6': {
        'name': 'Andy Korbak',
        'team': 'Dirt Dogs',
        'emails': ['akorbak6@gmail.com'],
    },
    't7': {
        'name': 'Alex Tarshis',
        'team': "Let's Deal",
        'emails': ['atarshis@gmail.com'],
    },
    't8': {
        'name': 'Bryan Boardman',
        'team': 'Los Pollos Hermanos',
        'emails': ['bryan.boardman@gmail.com'],
    },
    't9': {
        'name': 'Andy Enzweiler & Ed O\'Brien',
        'team': 'Diamond Hacks',
        'emails': ['andrewenzweiler@gmail.com', 'edtempe@gmail.com'],
    },
    't10': {
        'name': 'Derek Carlin & Justin Hurson',
        'team': 'Velvet Thunder',
        'emails': ['derekcarlin31@gmail.com', 'justinhurson23@gmail.com'],
    },
}

GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# ── Auth ───────────────────────────────────────────────────────────────────────

def get_gmail_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), GMAIL_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    f"credentials.json not found at {CREDENTIALS_FILE}\n"
                    "Download it from Google Cloud Console → APIs & Services → Credentials"
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), GMAIL_SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())

    return build('gmail', 'v1', credentials=creds)


# ── Gmail Helpers ──────────────────────────────────────────────────────────────

def decode_body(part):
    """Decode a Gmail message part body to text."""
    data = part.get('body', {}).get('data', '')
    if not data:
        # Try parts recursively
        for subpart in part.get('parts', []):
            result = decode_body(subpart)
            if result:
                return result
        return ''
    try:
        return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
    except Exception:
        return ''


def extract_text(payload):
    """Extract plain text from a Gmail message payload."""
    mime = payload.get('mimeType', '')
    if mime == 'text/plain':
        return decode_body(payload)
    if mime == 'text/html':
        # Strip tags as fallback
        raw = decode_body(payload)
        return re.sub(r'<[^>]+>', ' ', raw)
    # Multipart: prefer text/plain part
    for part in payload.get('parts', []):
        if part.get('mimeType') == 'text/plain':
            return decode_body(part)
    # Fallback: first part
    for part in payload.get('parts', []):
        text = extract_text(part)
        if text.strip():
            return text
    return ''


def get_header(headers, name):
    for h in headers:
        if h['name'].lower() == name.lower():
            return h['value']
    return ''


def search_threads(service, query, max_results=200):
    """Return list of thread IDs matching a Gmail search query."""
    threads = []
    page_token = None
    while len(threads) < max_results:
        params = {
            'userId': 'me',
            'q': query,
            'maxResults': min(100, max_results - len(threads)),
        }
        if page_token:
            params['pageToken'] = page_token
        resp = service.users().threads().list(**params).execute()
        threads.extend(resp.get('threads', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return threads


def fetch_thread(service, thread_id, max_messages=20):
    """Fetch a thread and return structured message list."""
    thread = service.users().threads().get(
        userId='me', id=thread_id, format='full'
    ).execute()
    messages = []
    for msg in thread.get('messages', [])[:max_messages]:
        headers = msg['payload'].get('headers', [])
        text = extract_text(msg['payload'])
        # Trim quoted reply blocks (lines starting with ">")
        lines = [l for l in text.splitlines() if not l.startswith('>')]
        text = '\n'.join(lines).strip()
        # Truncate very long messages
        if len(text) > 2000:
            text = text[:2000] + '...[truncated]'
        messages.append({
            'date': get_header(headers, 'Date'),
            'from': get_header(headers, 'From'),
            'subject': get_header(headers, 'Subject'),
            'body': text,
        })
    return messages


def owner_matches_email(owner_key, email_str):
    """Check if an email address string matches any of the owner's known fragments."""
    email_lower = email_str.lower()
    for fragment in OWNERS[owner_key]['emails']:
        if fragment.lower() in email_lower:
            return True
    return False


# ── Pull Phase ─────────────────────────────────────────────────────────────────

def pull_owner_threads(service, owner_key, owner_info):
    """Search Gmail for threads involving this owner and save to JSON."""
    print(f"\n── {owner_info['name']} ({owner_info['team']}) ──")

    # Build search: league keywords + owner email fragments
    email_clauses = ' OR '.join(
        f'(from:{e} OR to:{e})' for e in owner_info['emails']
    )
    league_clause = ' OR '.join(f'"{t}"' for t in LEAGUE_SEARCH_TERMS)
    query = f'({email_clauses}) ({league_clause})'
    print(f"  Query: {query}")

    thread_stubs = search_threads(service, query, max_results=MAX_THREADS_PER_OWNER)
    print(f"  Found {len(thread_stubs)} threads")

    threads = []
    for i, stub in enumerate(thread_stubs):
        try:
            msgs = fetch_thread(service, stub['id'], max_messages=MAX_MESSAGES_PER_THREAD)
            # Filter: at least one message must actually involve this owner
            involves_owner = any(
                owner_matches_email(owner_key, m['from']) for m in msgs
            )
            if msgs and involves_owner:
                threads.append({
                    'thread_id': stub['id'],
                    'subject': msgs[0]['subject'],
                    'messages': msgs,
                })
            if (i + 1) % 20 == 0:
                print(f"  Fetched {i+1}/{len(thread_stubs)}...")
            time.sleep(0.05)  # gentle rate limiting
        except Exception as e:
            print(f"  Warning: thread {stub['id']} failed: {e}")

    out_path = OUTPUT_DIR / f'threads_{owner_key}.json'
    out_path.write_text(json.dumps({
        'owner_key': owner_key,
        'owner_name': owner_info['name'],
        'team': owner_info['team'],
        'pulled_at': datetime.utcnow().isoformat(),
        'thread_count': len(threads),
        'threads': threads,
    }, indent=2))
    print(f"  Saved {len(threads)} relevant threads → {out_path.name}")
    return threads


# ── Summarize Phase ────────────────────────────────────────────────────────────

PROFILE_PROMPT = """You are analyzing email threads from a 10-team fantasy baseball Roto auction league called "Teddy Ballgame."

Owner: {name} (Team: {team})

Below are excerpts from email threads involving this owner over the years. Based on these, build a behavioral profile useful for predicting their auction behavior and trade tendencies.

Produce a JSON object with these fields:
- "auction_style": 2-3 sentences on how they approach the auction (stars-and-scrubs vs balanced, early/late, position tendencies)
- "positions_they_favor": list of positions they tend to overpay or prioritize (e.g. ["SP", "OF"])
- "positions_they_avoid": list of positions they historically underspend on
- "price_tendency": one of "overbids", "underbids", "fair", "unknown"
- "price_tendency_detail": 1-2 sentences explaining the pattern
- "trade_style": how they approach in-season trades (aggressive, passive, value-seeker, etc.)
- "trash_talk_level": one of "heavy", "moderate", "light", "silent"
- "notable_tendencies": list of 3-5 bullet strings describing specific quirks (e.g. "Panics after losing a closer target", "Always nominates SP early to drive up prices")
- "intel_summary": 2-3 sentence plain-English scouting report — what you'd tell someone drafting against them
- "confidence": one of "high", "medium", "low" (based on how much signal was in the emails)

Respond with only the JSON object, no markdown fences.

EMAIL THREADS:
{threads}"""


def build_thread_text(threads, max_chars=40000):
    """Flatten threads to a single string for the prompt."""
    parts = []
    total = 0
    for t in threads:
        header = f"\n=== {t['subject']} ===\n"
        for m in t['messages']:
            chunk = f"[{m['date']} | From: {m['from']}]\n{m['body']}\n"
            if total + len(chunk) > max_chars:
                parts.append("...[truncated for length]")
                return ''.join(parts)
            parts.append(chunk)
            total += len(chunk)
        parts.append(header)
    return ''.join(parts)


def summarize_owner(owner_key, owner_info, threads):
    """Call Claude Haiku to produce a personality profile JSON."""
    import anthropic
    client = anthropic.Anthropic()

    thread_text = build_thread_text(threads)
    if not thread_text.strip():
        print(f"  No email content — skipping AI summarization for {owner_info['name']}")
        return {'error': 'no_email_content', 'confidence': 'low'}

    prompt = PROFILE_PROMPT.format(
        name=owner_info['name'],
        team=owner_info['team'],
        threads=thread_text,
    )

    print(f"  Calling Claude Haiku ({len(prompt):,} chars)...")
    msg = client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=800,
        messages=[{'role': 'user', 'content': prompt}],
    )
    raw = msg.content[0].text.strip()

    try:
        profile = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON block if model added text around it
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        profile = json.loads(match.group()) if match else {'raw': raw, 'parse_error': True}

    return profile


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Build owner profiles from Gmail threads')
    parser.add_argument('--owner', help='Limit to a single owner key or name fragment (e.g. "t3" or "Barry")')
    parser.add_argument('--pull-only', action='store_true', help='Pull threads only, skip AI summarization')
    parser.add_argument('--summarize-only', action='store_true', help='Skip Gmail pull, use cached thread files')
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Filter owners if --owner flag given
    target_owners = OWNERS
    if args.owner:
        q = args.owner.lower()
        target_owners = {
            k: v for k, v in OWNERS.items()
            if q in k.lower() or q in v['name'].lower() or q in v['team'].lower()
        }
        if not target_owners:
            print(f"No owner matching '{args.owner}'. Valid keys: {list(OWNERS.keys())}")
            return

    all_profiles = {}

    # ── Pull phase ──
    if not args.summarize_only:
        service = get_gmail_service()
        for key, info in target_owners.items():
            pull_owner_threads(service, key, info)

    # ── Summarize phase ──
    if not args.pull_only:
        for key, info in target_owners.items():
            thread_file = OUTPUT_DIR / f'threads_{key}.json'
            if not thread_file.exists():
                print(f"  No thread file for {info['name']} — run without --summarize-only first")
                continue

            data = json.loads(thread_file.read_text())
            threads = data.get('threads', [])
            print(f"\n── Summarizing {info['name']} ({len(threads)} threads) ──")

            profile = summarize_owner(key, info, threads)
            profile['owner_key'] = key
            profile['owner_name'] = info['name']
            profile['team'] = info['team']
            profile['thread_count'] = len(threads)
            profile['generated_at'] = datetime.utcnow().isoformat()

            out_path = OUTPUT_DIR / f'profile_{key}.json'
            out_path.write_text(json.dumps(profile, indent=2))
            print(f"  Profile saved → {out_path.name}")
            print(f"  Intel: {profile.get('intel_summary', '—')}")

            all_profiles[key] = profile

        # Merge all profiles into summary.json for the draft tool
        summary_path = OUTPUT_DIR / 'summary.json'
        # Merge with existing if partial run
        if summary_path.exists():
            existing = json.loads(summary_path.read_text())
            existing.update(all_profiles)
            all_profiles = existing
        summary_path.write_text(json.dumps(all_profiles, indent=2))
        print(f"\nAll profiles → {summary_path}")


if __name__ == '__main__':
    main()
