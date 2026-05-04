#!/usr/bin/env python3
"""
One-time migration: imports existing CSV log files and Google Sheets survey
responses into Supabase. Safe to re-run — skips rows already present by
checking for duplicate (email, message_id) pairs.

Run once from the repo root:
  python migrate_csv_to_supabase.py
"""

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from supabase_client import get_client, insert_survey_response

LOGS = [
    ('activation_log',  Path.home() / '.claude/skills/logistimatics-activation/sent-log.csv'),
    ('followup_log',    Path.home() / '.claude/skills/logistimatics-followup/followup-log.csv'),
    ('followup2_log',   Path.home() / '.claude/skills/logistimatics-followup/followup2-log.csv'),
    ('survey_log',      Path.home() / '.claude/skills/logistimatics-survey/survey-log.csv'),
]

REASON_LABELS = {
    'serial':       "Can't find serial number",
    'website':      'Activation website trouble',
    'time':         "Haven't had time yet",
    'subscription': 'Not ready for subscription',
}


def migrate_log(table, csv_path):
    if not csv_path.exists():
        print(f"  [skip] {csv_path.name} not found")
        return

    sb = get_client()

    # Fetch existing message_ids to avoid duplicates
    existing = {r['message_id'] for r in (sb.table(table).select('message_id').execute().data or [])}

    rows_to_insert = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if row.get('status', '').strip() != 'sent':
                continue
            if row.get('message_id', '') in existing:
                continue
            rows_to_insert.append({
                'date':          row.get('date', ''),
                'email':         row.get('email', '').strip().lower(),
                'customer_name': row.get('customer_name', ''),
                'serials':       row.get('serials', ''),
                'message_id':    row.get('message_id', ''),
                'status':        'sent',
            })

    if not rows_to_insert:
        print(f"  {table}: nothing new to insert")
        return

    # Insert in batches of 100
    for i in range(0, len(rows_to_insert), 100):
        sb.table(table).insert(rows_to_insert[i:i+100]).execute()
    print(f"  {table}: inserted {len(rows_to_insert)} rows")


def migrate_survey_responses():
    """Migrate Google Sheets survey responses into Supabase."""
    try:
        import gspread
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        sheets_config = Path(__file__).parent / 'sheets_config.json'
        creds_path    = Path.home() / '.google_workspace_mcp/credentials/logistimatics_sheets.json'

        with open(creds_path) as f:
            cdata = json.load(f)
        creds = Credentials(
            token=cdata.get('token'), refresh_token=cdata.get('refresh_token'),
            token_uri=cdata.get('token_uri'), client_id=cdata.get('client_id'),
            client_secret=cdata.get('client_secret'),
        )
        if not creds.valid and creds.refresh_token:
            creds.refresh(Request())

        with open(sheets_config) as f:
            cfg = json.load(f)

        gc = gspread.authorize(creds)
        sh = gc.open_by_key(cfg['spreadsheet_id'])
        ws = sh.worksheet(cfg.get('survey_sheet', 'Survey Responses'))
        rows = ws.get_all_values()

        sb = get_client()
        existing_emails = {r['email'] for r in (sb.table('survey_responses').select('email').execute().data or [])}

        valid_reasons = set(REASON_LABELS.keys())
        inserted = 0
        seen = set()
        for row in rows[1:]:
            if len(row) < 4:
                continue
            reason = row[3].strip()
            if reason not in valid_reasons:
                continue
            email = row[1].strip().lower()
            if email in seen or email in existing_emails:
                continue
            seen.add(email)
            insert_survey_response(
                date=row[0].strip(),
                email=email,
                name=row[2].strip(),
                reason=reason,
                reason_label=REASON_LABELS.get(reason, reason),
            )
            inserted += 1

        print(f"  survey_responses: inserted {inserted} rows")
    except Exception as e:
        print(f"  [warn] Could not migrate survey responses: {e}")


if __name__ == '__main__':
    print("Migrating CSV logs to Supabase...")
    for table, path in LOGS:
        migrate_log(table, path)

    print("Migrating survey responses from Google Sheets...")
    migrate_survey_responses()

    print("\nMigration complete.")
