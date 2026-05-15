#!/usr/bin/env python3
"""
sync_shopify_orders.py
----------------------
Reads the "Shipped Shopify Orders and Devices" Google Sheet and upserts
every row into the Supabase `shopify_orders` table.

Safe to re-run at any time — upserts by serial (primary key), so
existing rows are updated and new rows are added with no duplicates.

Usage:
    python sync_shopify_orders.py [--dry-run]

    --dry-run   Print what would be upserted without writing to Supabase.
"""

import json
import sys
from pathlib import Path
from datetime import datetime

SOURCE_SHEET_ID = '1Y-L2MPIBEsCbHFDMOBGtWeTq29YrUwe-j3Bf6cc7Vf8'
CACHED_CREDS    = Path.home() / '.google_workspace_mcp/credentials/kevin.garma@go2impact.com.json'
BATCH_SIZE      = 500   # rows per upsert batch


def parse_date(value):
    """Return YYYY-MM-DD string or None from a raw sheet cell."""
    if not value or not value.strip():
        return None
    v = value.strip()[:10]
    try:
        datetime.strptime(v, '%Y-%m-%d')
        return v
    except ValueError:
        return None


def parse_int(value):
    """Return integer or None."""
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return None


def read_google_sheet():
    import gspread
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    with open(CACHED_CREDS) as f:
        creds_data = json.load(f)

    creds = Credentials(
        token=creds_data['token'],
        refresh_token=creds_data['refresh_token'],
        token_uri=creds_data['token_uri'],
        client_id=creds_data['client_id'],
        client_secret=creds_data['client_secret'],
    )
    if not creds.valid:
        creds.refresh(Request())

    gc = gspread.Client(auth=creds)
    ws = gc.open_by_key(SOURCE_SHEET_ID).sheet1
    rows = ws.get_all_values()
    print(f"  Sheet: {len(rows) - 1} data rows")
    return rows


def rows_to_records(all_rows):
    """Convert raw sheet rows to upsert-ready dicts, skipping blank serials."""
    records = []
    skipped = 0
    for row in all_rows[1:]:          # skip header
        if len(row) < 2:
            skipped += 1
            continue

        serial = row[4].strip() if len(row) > 4 else ''
        if not serial:
            skipped += 1
            continue                  # serial is required (primary key)

        customer_email = row[1].strip().lower() if len(row) > 1 else ''
        if not customer_email:
            skipped += 1
            continue

        records.append({
            'serial':                   serial,
            'order_number':             row[0].strip()  if len(row) > 0  else None,
            'customer_email':           customer_email,
            'billing_name':             row[2].strip()  if len(row) > 2  else None,
            'ship_date':                parse_date(row[3]) if len(row) > 3 else None,
            'device_type':              row[5].strip()  if len(row) > 5  else None,
            'user_id':                  row[6].strip()  if len(row) > 6  else None,
            'internal_notes':           row[7].strip()  if len(row) > 7  else None,
            'return_processed_at':      row[8].strip()  if len(row) > 8  else None,
            'subscription_id':          row[9].strip()  if len(row) > 9  else None,
            'subscription_assigned_at': row[10].strip() if len(row) > 10 else None,
            'subscription_term_months': parse_int(row[11]) if len(row) > 11 else None,
        })

    if skipped:
        print(f"  Skipped {skipped} rows (no serial or email)")

    # Deduplicate by serial — prefer the row with activation/subscription data,
    # otherwise take the last occurrence (most recent data).
    seen = {}
    for r in records:
        serial = r['serial']
        prev = seen.get(serial)
        if prev is None:
            seen[serial] = r
        else:
            # Keep whichever row has more data (sub_id or activation date)
            has_data     = bool(r.get('subscription_id') or r.get('subscription_assigned_at'))
            prev_has_data = bool(prev.get('subscription_id') or prev.get('subscription_assigned_at'))
            if has_data and not prev_has_data:
                seen[serial] = r
    deduped = list(seen.values())
    dupes = len(records) - len(deduped)
    if dupes:
        print(f"  Deduplicated {dupes} duplicate serials")
    return deduped


def upsert_batches(records, dry_run=False):
    from supabase_client import get_client
    client = get_client()

    total = len(records)
    upserted = 0
    for i in range(0, total, BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        if dry_run:
            print(f"  [dry-run] Would upsert batch {i // BATCH_SIZE + 1}: {len(batch)} rows")
        else:
            client.table('shopify_orders').upsert(
                batch, on_conflict='serial'
            ).execute()
            upserted += len(batch)
            print(f"  Upserted {upserted}/{total}...")

    return upserted


def main():
    dry_run = '--dry-run' in sys.argv

    print("Reading Google Sheet...")
    all_rows = read_google_sheet()

    print("Converting rows...")
    records = rows_to_records(all_rows)
    print(f"  {len(records)} valid records ready")

    if dry_run:
        print("\n[DRY RUN] Sample of first 3 records:")
        for r in records[:3]:
            print(" ", r)
        upsert_batches(records, dry_run=True)
        print("\nDry run complete — nothing written.")
        return

    print(f"\nUpserting to Supabase (batches of {BATCH_SIZE})...")
    count = upsert_batches(records)
    print(f"\nDone. {count} rows upserted to shopify_orders.")


if __name__ == '__main__':
    main()
