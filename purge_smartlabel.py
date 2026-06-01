#!/usr/bin/env python3
"""
Purge all SmartLabel (SL-prefix serial) records from Supabase log tables
and local CSV log files.

Run once:  python purge_smartlabel.py
Safe to re-run — only deletes rows that still exist.
"""

import csv
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from supabase_client import get_client

SKILLS_DIR = Path.home() / '.claude' / 'skills'

LOG_FILES = [
    SKILLS_DIR / 'logistimatics-intransit'  / 'sent-log.csv',
    SKILLS_DIR / 'logistimatics-features'   / 'sent-log.csv',
    SKILLS_DIR / 'logistimatics-socialproof'/ 'socialproof-log.csv',
    SKILLS_DIR / 'logistimatics-friction'   / 'friction-log.csv',
    SKILLS_DIR / 'logistimatics-personal'   / 'personal-log.csv',
    SKILLS_DIR / 'logistimatics-survey'     / 'survey-log.csv',
]

SUPABASE_LOG_TABLES = [
    'in_transit_log',
    'activation_log',
    'followup_log',
    'followup2_log',
    'followup3_log',
    'survey_log',
]


def is_sl(serials: str) -> bool:
    """Return True if any serial in the (comma/pipe-separated) string starts with SL."""
    if not serials:
        return False
    parts = re.split(r'[,|]', serials)
    return any(p.strip().upper().startswith('SL') for p in parts)


# ── 1. Clean CSV logs ─────────────────────────────────────────────────────────

print("\n[1/3] Cleaning local CSV log files...")
for path in LOG_FILES:
    if not path.exists():
        print(f"  SKIP  {path.name}  (not found)")
        continue

    with open(path, newline='', encoding='utf-8-sig', errors='replace') as f:
        rows = list(csv.reader(f))

    if not rows:
        print(f"  SKIP  {path.name}  (empty)")
        continue

    header  = rows[0]
    data    = rows[1:]

    # serials is column index 3
    try:
        serial_col = header.index('serials')
    except ValueError:
        serial_col = 3   # fallback

    kept    = [r for r in data if not is_sl(r[serial_col] if len(r) > serial_col else '')]
    removed = len(data) - len(kept)

    if removed == 0:
        print(f"  OK    {path.name}  (no SL rows)")
        continue

    with open(path, 'w', newline='', encoding='utf-8-sig', errors='replace') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(kept)

    print(f"  PURGED {path.name}  removed {removed} row(s)")


# ── 2. Clean Supabase log tables ──────────────────────────────────────────────

print("\n[2/3] Cleaning Supabase log tables...")
sb = get_client()
sl_emails = set()   # collect for sg_email_events cleanup

for table in SUPABASE_LOG_TABLES:
    try:
        result = sb.table(table).select('id,email,serials').limit(5000).execute()
        rows   = result.data or []
    except Exception as e:
        print(f"  SKIP  {table}  ({e})")
        continue

    sl_ids = []
    for row in rows:
        if is_sl(row.get('serials', '')):
            sl_ids.append(row['id'])
            sl_emails.add((row.get('email') or '').strip().lower())

    if not sl_ids:
        print(f"  OK    {table}  (no SL rows)")
        continue

    # Delete in batches of 100
    for i in range(0, len(sl_ids), 100):
        batch = sl_ids[i:i+100]
        sb.table(table).delete().in_('id', batch).execute()

    print(f"  PURGED {table}  deleted {len(sl_ids)} row(s)")


# ── 3. Clean sg_email_events for SL customer emails ───────────────────────────

print("\n[3/3] Cleaning sg_email_events for SL customer emails...")
if not sl_emails:
    print("  OK  no SL emails found — nothing to remove from sg_email_events")
else:
    deleted_total = 0
    for email in sl_emails:
        try:
            sb.table('sg_email_events').delete().eq('email', email).execute()
            deleted_total += 1
        except Exception as e:
            print(f"  WARN  {email}: {e}")
    print(f"  PURGED sg_email_events  for {deleted_total} SL customer email(s)")

print("\nDone. Run generate_data.py next to refresh data.json.")
