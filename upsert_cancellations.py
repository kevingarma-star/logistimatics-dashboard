#!/usr/bin/env python3
"""
upsert_cancellations.py
-----------------------
Import a CSV export of the subscription_cancellations Google Sheet into
the Supabase `subscription_cancellations` table, upserting on cancellation_id.

Usage:
  python upsert_cancellations.py path/to/export.csv [--dry-run]

Requirements:
  pip install supabase pandas

The CSV must have at minimum a `cancellation_id` column.
Column names are matched case-insensitively; spaces and dashes are
normalised to underscores.  Any extra columns in the CSV are silently
ignored.

cancel_category is derived from cancel_mode if the column is absent or
blank, using the mapping defined in CANCEL_MODE_TO_CATEGORY.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# ── cancel_mode → cancel_category mapping ────────────────────────────────────
CANCEL_MODE_TO_CATEGORY = {
    'customer cancellation':              'Voluntary (customer)',
    'other user cancellation':            'Voluntary (customer)',
    'gpx admin cancellation':             'Voluntary (via GPX staff)',
    'non-payment':                        'Involuntary (non-payment)',
    'ops bulk update':                    'Operational (GPX staff)',
    'device unassigned (archived)':       'Operational (GPX staff)',
    'account data deleted':               'Operational (GPX staff)',
}

# Columns we write to the table, in snake_case
KNOWN_COLS = [
    'cancellation_id', 'subscription_id', 'account_id',
    'outcome', 'cancel_mode', 'cancel_category', 'cancel_timing',
    'initiated_by', 'initiated_by_name', 'initiated_by_email', 'cancelled_by',
    'initiated_at', 'effective_at', 'withdrawn_at', 'term_end_at',
    'recovered_at', 'sub_started_at', 'customer_since',
    'pending_overdue', 'current_status', 'account_fully_churned',
    'recovery', 'recovered_subscription_id',
    'account_title', 'primary_contact_name', 'primary_contact_email',
    'device_model', 'device_serial', 'purchase_channel',
    'plan_months', 'plan_price_usd', 'plan_monthly_price_usd',
    'sub_age_months', 'mrr_at_cancel_usd', 'cancellation_reason',
]

TIMESTAMP_COLS = [
    'initiated_at', 'effective_at', 'withdrawn_at', 'term_end_at',
    'recovered_at', 'sub_started_at', 'customer_since',
]

BOOL_COLS = ['pending_overdue', 'account_fully_churned']

NUMERIC_COLS = [
    'plan_months', 'plan_price_usd', 'plan_monthly_price_usd',
    'sub_age_months', 'mrr_at_cancel_usd',
]


def normalise_col(name: str) -> str:
    """'Cancel Mode ' → 'cancel_mode'"""
    return re.sub(r'[\s\-]+', '_', name.strip().lower())


def parse_ts(val) -> str | None:
    """Return ISO-8601 string or None."""
    if pd.isna(val) or str(val).strip() in ('', 'None', 'NaT'):
        return None
    try:
        ts = pd.to_datetime(val, utc=True)
        return ts.isoformat()
    except Exception:
        return None


def parse_bool(val) -> bool | None:
    if pd.isna(val):
        return None
    s = str(val).strip().lower()
    if s in ('true', '1', 'yes'):
        return True
    if s in ('false', '0', 'no'):
        return False
    return None


def parse_numeric(val):
    if pd.isna(val):
        return None
    try:
        return float(str(val).replace('$', '').replace(',', '').strip())
    except (ValueError, TypeError):
        return None


def derive_cancel_category(row: dict) -> str | None:
    cat = row.get('cancel_category')
    if cat and str(cat).strip():
        return str(cat).strip()
    mode = row.get('cancel_mode')
    if not mode or pd.isna(mode):
        return None
    return CANCEL_MODE_TO_CATEGORY.get(str(mode).strip().lower())


def load_supabase_client():
    config_path = Path(__file__).parent / 'supabase_config.json'
    if not config_path.exists():
        sys.exit('supabase_config.json not found — expected next to this script')
    cfg = json.loads(config_path.read_text())
    from supabase import create_client
    return create_client(cfg['url'], cfg['key'])


def upsert_batch(client, rows: list[dict], dry_run: bool) -> int:
    if dry_run:
        for r in rows[:3]:
            print('  sample:', json.dumps(r, default=str)[:120])
        return len(rows)
    result = (
        client.table('subscription_cancellations')
        .upsert(rows, on_conflict='cancellation_id')
        .execute()
    )
    return len(result.data or [])


def main():
    parser = argparse.ArgumentParser(description='Upsert cancellations CSV → Supabase')
    parser.add_argument('csv', help='Path to CSV export')
    parser.add_argument('--dry-run', action='store_true', help='Parse and print without writing')
    parser.add_argument('--batch', type=int, default=200, help='Rows per upsert batch (default 200)')
    args = parser.parse_args()

    df = pd.read_csv(args.csv, dtype=str, keep_default_na=False)
    # Normalise column names
    df.columns = [normalise_col(c) for c in df.columns]

    missing = [c for c in ['cancellation_id'] if c not in df.columns]
    if missing:
        sys.exit(f'Required column(s) missing from CSV: {missing}')

    rows_out = []
    skipped = 0

    for _, row in df.iterrows():
        r = row.to_dict()

        cid = str(r.get('cancellation_id', '')).strip()
        if not cid:
            skipped += 1
            continue

        rec = {'cancellation_id': cid, 'refreshed_at': datetime.now(timezone.utc).isoformat()}

        for col in KNOWN_COLS:
            if col == 'cancellation_id':
                continue
            val = r.get(col)

            if col in TIMESTAMP_COLS:
                rec[col] = parse_ts(val) if (val and str(val).strip()) else None
            elif col in BOOL_COLS:
                rec[col] = parse_bool(val) if val else None
            elif col in NUMERIC_COLS:
                rec[col] = parse_numeric(val) if val else None
            elif col == 'recovery':
                rec[col] = str(val).strip() if (val and str(val).strip()) else ''
            else:
                rec[col] = str(val).strip() if (val and str(val).strip()) else None

        # Derive cancel_category from cancel_mode if needed
        rec['cancel_category'] = derive_cancel_category(rec)

        rows_out.append(rec)

    total = len(rows_out)
    print(f'Parsed {total} rows ({skipped} skipped — no cancellation_id)')

    if not rows_out:
        print('Nothing to upsert.')
        return

    if args.dry_run:
        print(f'[DRY RUN] Would upsert {total} rows in batches of {args.batch}')
        upsert_batch(None, rows_out[:3], dry_run=True)
        return

    client = load_supabase_client()
    upserted = 0
    for i in range(0, total, args.batch):
        batch = rows_out[i:i + args.batch]
        n = upsert_batch(client, batch, dry_run=False)
        upserted += n
        print(f'  {i + len(batch)}/{total} rows upserted…')

    print(f'Done — {upserted} rows written to subscription_cancellations.')


if __name__ == '__main__':
    main()
