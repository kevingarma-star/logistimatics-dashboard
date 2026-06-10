#!/usr/bin/env python3
"""
generate_return_data.py
-----------------------
Builds return_data.json for the Return Dashboard.

Flow:
  1. Load all returned orders from Supabase shopify_orders
     (rows where return_processed_at IS NOT NULL)
  2. Skip SmartLabel devices (serial starts with SL)
  3. Skip orders already processed (in return_conversations table)
  4. For each new return:
       a. Look up the customer email in Intercom
       b. Find a conversation tagged "B2C - Returns" in LGMX Support inbox
       c. If found → send transcript to Claude → free-text reason summary
       d. If not found → mark as "Undeliverable"
  5. Upsert results into Supabase return_conversations
  6. Write public/return_data.json

Prerequisites:
  - Run once: execute create_return_conversations_table.sql in Supabase
  - Add INTERCOM_TOKEN to server_config.json
    (get it from Intercom → Settings → Integrations → Developer Hub → Your App → Access Token)

Usage:
    python generate_return_data.py [--dry-run]
"""

import json
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, date
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

REPO_DIR    = Path(__file__).parent
CONFIG_PATH = REPO_DIR / 'server_config.json'
OUTPUT_PATH = REPO_DIR / 'public' / 'return_data.json'

# Intercom
LGMX_TEAM_ID    = '5466207'    # LGMX – Customer Support inbox
RETURN_TAG_NAME = 'B2C - Returns'

# Only process returns on or after this date
RETURNS_SINCE = '2026-05-01'

# Anthropic model for conversation summarisation
CLAUDE_MODEL = 'claude-haiku-4-5-20251001'   # fast + cheap for summarisation

DRY_RUN = '--dry-run' in sys.argv


# ── Config loading ────────────────────────────────────────────────────────────

def load_config():
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {CONFIG_PATH} not found.")
        sys.exit(1)

    anthropic_key = cfg.get('ANTHROPIC_API_KEY', '').strip()
    if not anthropic_key:
        print("ERROR: ANTHROPIC_API_KEY missing from server_config.json")
        sys.exit(1)

    intercom_token = cfg.get('INTERCOM_TOKEN', '').strip()
    if not intercom_token:
        print(
            "\nERROR: INTERCOM_TOKEN missing from server_config.json\n"
            "  1. Go to Intercom → Settings → Integrations → Developer Hub\n"
            "  2. Open your app (or create one) → Authentication\n"
            "  3. Copy the Access Token\n"
            "  4. Add to server_config.json:  \"INTERCOM_TOKEN\": \"<token>\"\n"
        )
        sys.exit(1)

    return anthropic_key, intercom_token


# ── Supabase helpers ──────────────────────────────────────────────────────────

def fetch_returned_orders():
    """
    Pull all rows from shopify_orders where return_processed_at is not null
    and >= RETURNS_SINCE. Excludes SmartLabel devices.
    """
    from supabase_client import _fetch_all
    rows = _fetch_all(
        'shopify_orders',
        'order_number,customer_email,billing_name,ship_date,return_processed_at,device_type,serial',
        filters=[
            ('not.is', 'return_processed_at', 'null'),
            ('gte', 'return_processed_at', RETURNS_SINCE),
        ]
    )
    # Filter out SmartLabel devices and rows without email
    result = []
    for r in rows:
        serial = (r.get('serial') or '').strip()
        email  = (r.get('customer_email') or '').strip().lower()
        if not email:
            continue
        if serial.upper().startswith('SL'):
            continue
        result.append(r)
    print(f"  Returned orders since {RETURNS_SINCE}: {len(result)}")
    return result


def fetch_processed_order_numbers():
    """Return a set of order_numbers already in return_conversations."""
    from supabase_client import _fetch_all
    try:
        rows = _fetch_all('return_conversations', 'order_number')
        return {r['order_number'] for r in rows if r.get('order_number')}
    except Exception as e:
        print(f"  [warn] Could not fetch return_conversations ({e}) — will process all")
        return set()


def upsert_return(record):
    """Upsert a single return record into return_conversations."""
    from supabase_client import get_client
    get_client().table('return_conversations').upsert(
        record, on_conflict='order_number'
    ).execute()


def load_all_returns():
    """Load all records from return_conversations ordered by return_date desc."""
    from supabase_client import _fetch_all
    return _fetch_all(
        'return_conversations',
        'order_number,email,customer_name,return_date,ship_date,device_type,'
        'serial,conversation_id,reason_summary,reason_category,is_undeliverable,processed_at',
        filters=[('order', 'return_date', {'desc': True})]
    )


# ── Intercom helpers ──────────────────────────────────────────────────────────

def _intercom_request(token, method, path, body=None):
    """Make a single Intercom API request. Returns parsed JSON or raises."""
    url = f'https://api.intercom.io{path}'
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept':        'application/json',
        'Content-Type':  'application/json',
        'Intercom-Version': '2.10',
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f"Intercom {method} {path} → HTTP {e.code}: {body_text[:300]}")


def get_return_tag_id(token):
    """Fetch all tags and return the ID for RETURN_TAG_NAME."""
    data = _intercom_request(token, 'GET', '/tags')
    tags = data.get('data', [])
    for tag in tags:
        if tag.get('name', '').strip() == RETURN_TAG_NAME:
            return tag['id']
    names = [t.get('name') for t in tags]
    raise RuntimeError(
        f"Tag '{RETURN_TAG_NAME}' not found in Intercom. "
        f"Available tags: {names}"
    )


def find_contact_id(token, email):
    """
    Search Intercom contacts by email. Returns the contact ID or None.
    Uses the /contacts/search endpoint for exact-match lookup.
    """
    body = {
        'query': {
            'field':    'email',
            'operator': '=',
            'value':    email,
        }
    }
    try:
        data = _intercom_request(token, 'POST', '/contacts/search', body)
        contacts = data.get('data', [])
        return contacts[0]['id'] if contacts else None
    except Exception as e:
        print(f"    [warn] Contact lookup failed for {email}: {e}")
        return None


def find_return_conversation(token, contact_id, tag_id):
    """
    Search for a conversation for this contact tagged with the return tag
    in the LGMX Support team inbox. Returns the first match or None.
    """
    body = {
        'query': {
            'operator': 'AND',
            'value': [
                {'field': 'contact_ids', 'operator': 'IN',  'value': [contact_id]},
                {'field': 'tag_ids',     'operator': 'IN',  'value': [tag_id]},
                {'field': 'team_assignee_id', 'operator': '=', 'value': LGMX_TEAM_ID},
            ]
        },
        'pagination': {'per_page': 5},
    }
    try:
        data = _intercom_request(token, 'POST', '/conversations/search', body)
        convs = data.get('conversations', [])
        return convs[0] if convs else None
    except Exception as e:
        print(f"    [warn] Conversation search failed: {e}")
        return None


def get_full_conversation(token, conversation_id):
    """Fetch full conversation including all message parts."""
    try:
        return _intercom_request(token, 'GET', f'/conversations/{conversation_id}')
    except Exception as e:
        print(f"    [warn] Could not fetch conversation {conversation_id}: {e}")
        return None


def build_transcript(conversation):
    """
    Extract a readable transcript from a full conversation object.
    Combines the opening message and all conversation parts (replies/notes).
    Returns a plain-text string capped at ~4000 chars to keep token cost low.
    """
    lines = []

    # Opening message
    source = conversation.get('source', {})
    author = source.get('author', {})
    author_name = author.get('name') or author.get('email') or 'Customer'
    body = source.get('body') or ''
    if body:
        lines.append(f"[{author_name}]: {_strip_html(body)}")

    # Conversation parts (replies, notes, assignments)
    parts = (conversation.get('conversation_parts') or {}).get('conversation_parts', [])
    for part in parts:
        part_type = part.get('part_type', '')
        if part_type in ('note', 'comment', 'open', 'close'):
            part_author = part.get('author', {})
            part_name = part_author.get('name') or part_author.get('email') or 'Agent'
            body = part.get('body') or ''
            if body and body.strip():
                lines.append(f"[{part_name}]: {_strip_html(body)}")

    transcript = '\n'.join(lines)
    # Cap at ~4000 chars — enough context for Claude without burning tokens
    return transcript[:4000]


def _strip_html(text):
    """Remove HTML tags from Intercom message bodies."""
    import re
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# Valid reason category slugs (must match REASON_CONFIG in src/lib/returnReasons.js)
VALID_CATEGORIES = [
    'no_longer_needed',
    'subscription_cost_surprise',
    'size_form_factor',
    'device_defective',
    'wrong_product',
    'audio_quality',
    'activation_issue',
    'battery_life',
    'tracking_accuracy',
    'network_sunset',
    'other',
]


# ── Claude summarisation ──────────────────────────────────────────────────────

def summarise_return(anthropic_key, customer_name, transcript):
    """
    Call Claude to produce a JSON object with:
      - summary: 1-2 sentence free-text summary of why the customer returned
      - category: one slug from VALID_CATEGORIES
    Returns a dict {'summary': ..., 'category': ...} or None on failure.
    """
    categories_list = '\n'.join(f'  - {c}' for c in VALID_CATEGORIES)
    prompt = (
        f"The following is a customer support conversation with {customer_name or 'a customer'} "
        f"who returned a GPS tracker.\n\n"
        f"Conversation:\n{transcript}\n\n"
        f"Return a JSON object with exactly two keys:\n"
        f"1. \"summary\": A 1-2 sentence plain-text summary of why this customer returned the device. "
        f"Be specific and concise. Reference exact complaints or quotes when relevant.\n"
        f"2. \"category\": One of the following slugs that best describes the primary return reason:\n"
        f"{categories_list}\n\n"
        f"Return ONLY the JSON object, no markdown fences, no explanation."
    )

    body = json.dumps({
        'model':      CLAUDE_MODEL,
        'max_tokens': 300,
        'messages':   [{'role': 'user', 'content': prompt}],
    }).encode()

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=body,
        headers={
            'x-api-key':         anthropic_key,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        raw = resp['content'][0]['text'].strip()
        result = json.loads(raw)
        summary  = result.get('summary', '').strip()
        category = result.get('category', '').strip()
        if category not in VALID_CATEGORIES:
            category = 'other'
        return {'summary': summary, 'category': category}
    except Exception as e:
        print(f"    [warn] Claude summarisation failed: {e}")
        return None


# ── Output builder ────────────────────────────────────────────────────────────

def build_return_data(all_returns):
    """
    Transform the flat list of return_conversations rows into the
    structured object written to return_data.json.
    """
    from collections import defaultdict

    by_month = defaultdict(int)
    undeliverable_count = 0

    for r in all_returns:
        return_date = r.get('return_date') or ''
        if return_date:
            month = return_date[:7]   # YYYY-MM
            by_month[month] += 1
        if r.get('is_undeliverable'):
            undeliverable_count += 1

    returns_by_month = [
        {'month': m, 'count': c}
        for m, c in sorted(by_month.items())
    ]

    returns_list = [
        {
            'order_number':    r.get('order_number'),
            'email':           r.get('email'),
            'customer_name':   r.get('customer_name'),
            'return_date':     r.get('return_date'),
            'ship_date':       r.get('ship_date'),
            'device_type':     r.get('device_type'),
            'serial':          r.get('serial'),
            'conversation_id': r.get('conversation_id'),
            'reason_summary':  r.get('reason_summary'),
            'reason_category': r.get('reason_category'),
            'is_undeliverable': r.get('is_undeliverable', False),
        }
        for r in all_returns
    ]

    return {
        'generated_at':       datetime.utcnow().isoformat() + 'Z',
        'total_returns':      len(all_returns),
        'undeliverable_count': undeliverable_count,
        'returns_by_month':   returns_by_month,
        'returns_list':       returns_list,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}generate_return_data.py starting…")
    print(f"  Returns since: {RETURNS_SINCE}")

    anthropic_key, intercom_token = load_config()

    # ── Step 1: Fetch returned orders from Supabase ───────────────────────────
    print("\n[1] Fetching returned orders from Supabase…")
    returned_orders = fetch_returned_orders()
    if not returned_orders:
        print("  No returned orders found. Exiting.")
        return

    # ── Step 2: Skip already-processed orders ────────────────────────────────
    print("\n[2] Checking already-processed orders…")
    processed = fetch_processed_order_numbers()
    new_orders = [o for o in returned_orders if o.get('order_number') not in processed]
    print(f"  Already processed: {len(processed)} | New to process: {len(new_orders)}")

    # ── Step 3: Fetch the Intercom return tag ID ──────────────────────────────
    tag_id = None
    if new_orders:
        print(f"\n[3] Looking up Intercom tag '{RETURN_TAG_NAME}'…")
        try:
            tag_id = get_return_tag_id(intercom_token)
            print(f"  Tag ID: {tag_id}")
        except Exception as e:
            print(f"  ERROR: {e}")
            sys.exit(1)

    # ── Step 4: Process each new return ──────────────────────────────────────
    processed_count = 0
    undeliverable_count = 0
    summarised_count = 0

    if new_orders:
        print(f"\n[4] Processing {len(new_orders)} new return(s)…")

    for i, order in enumerate(new_orders, 1):
        email     = (order.get('customer_email') or '').strip().lower()
        name      = (order.get('billing_name') or '').strip()
        order_num = order.get('order_number') or ''
        ret_date  = order.get('return_processed_at') or ''
        ship_date = order.get('ship_date') or ''
        device    = order.get('device_type') or ''
        serial    = order.get('serial') or ''

        print(f"\n  [{i}/{len(new_orders)}] {order_num} — {email}")

        record = {
            'order_number':    order_num,
            'email':           email,
            'customer_name':   name,
            'return_date':     ret_date[:10] if ret_date else None,
            'ship_date':       ship_date[:10] if ship_date else None,
            'device_type':     device,
            'serial':          serial,
            'conversation_id': None,
            'reason_summary':  None,
            'reason_category': None,
            'is_undeliverable': False,
            'processed_at':    datetime.utcnow().isoformat() + 'Z',
        }

        # Look up Intercom contact
        contact_id = find_contact_id(intercom_token, email)
        if not contact_id:
            print(f"    No Intercom contact → Undeliverable")
            record['reason_summary']  = 'Undeliverable — no Intercom contact found'
            record['is_undeliverable'] = True
            undeliverable_count += 1
        else:
            # Search for return conversation
            conv = find_return_conversation(intercom_token, contact_id, tag_id)
            if not conv:
                print(f"    No 'B2C - Returns' conversation → Undeliverable")
                record['reason_summary']  = 'Undeliverable — no return conversation in Intercom'
                record['is_undeliverable'] = True
                undeliverable_count += 1
            else:
                conv_id = conv.get('id') or ''
                print(f"    Conversation found: {conv_id}")
                record['conversation_id'] = conv_id

                # Fetch full thread
                full_conv = get_full_conversation(intercom_token, conv_id)
                if full_conv:
                    transcript = build_transcript(full_conv)
                    if transcript.strip():
                        result = summarise_return(anthropic_key, name, transcript)
                        if result:
                            record['reason_summary']  = result['summary']
                            record['reason_category'] = result['category']
                            summarised_count += 1
                            summary = result['summary']
                            print(f"    [{result['category']}] {summary[:100]}…" if len(summary) > 100 else f"    [{result['category']}] {summary}")

        if not DRY_RUN:
            upsert_return(record)

        processed_count += 1

        # Respect Intercom rate limit (83 req/10s for most endpoints)
        if i % 10 == 0:
            time.sleep(1)

    # ── Step 5: Build and write output ───────────────────────────────────────
    print("\n[5] Building return_data.json…")
    if DRY_RUN:
        print("  [dry-run] Skipping Supabase writes and output.")
        print(f"\n  Would have processed {processed_count} orders "
              f"({summarised_count} summarised, {undeliverable_count} undeliverable)")
        return

    all_returns = load_all_returns()
    return_data = build_return_data(all_returns)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(return_data, f, indent=2)

    print(f"  Written: {OUTPUT_PATH}")
    print(f"\nDone.")
    print(f"  Total returns in output : {return_data['total_returns']}")
    print(f"  Undeliverable           : {return_data['undeliverable_count']}")
    print(f"  New records processed   : {processed_count}")
    print(f"  Summarised via Claude   : {summarised_count}")


if __name__ == '__main__':
    main()
