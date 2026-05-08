#!/usr/bin/env python3
"""
Syncs existing local CSV logs to Google Sheets.
Reads activation and followup CSVs and uploads all rows to the
Logistimatics Outreach Logs spreadsheet.
"""

import csv
import json
from pathlib import Path

CONFIG_PATH     = Path(__file__).parent / 'sheets_config.json'
CREDS_PATH      = Path.home() / '.google_workspace_mcp' / 'credentials' / 'logistimatics_sheets.json'
ACTIVATION_LOG  = Path.home() / '.claude/skills/logistimatics-activation/sent-log.csv'
FOLLOWUP_LOG    = Path.home() / '.claude/skills/logistimatics-followup/followup-log.csv'


def get_credentials():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    with open(CREDS_PATH) as f:
        data = json.load(f)

    creds = Credentials(
        token=data.get('token'),
        refresh_token=data.get('refresh_token'),
        token_uri=data.get('token_uri'),
        client_id=data.get('client_id'),
        client_secret=data.get('client_secret'),
    )
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
    return creds


def load_csv(path):
    rows = []
    try:
        with open(path, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
    except FileNotFoundError:
        pass
    return rows


def sync_sheet(gc, spreadsheet_id, sheet_name, rows, headers):
    sh = gc.open_by_key(spreadsheet_id)
    ws = sh.worksheet(sheet_name)

    # Clear existing data (keep header)
    ws.clear()
    ws.append_row(headers)

    if not rows:
        print(f"  {sheet_name}: no rows to sync")
        return

    # Build batch of rows in correct order
    batch = [[row.get(h, '') for h in headers] for row in rows]
    ws.append_rows(batch, value_input_option='RAW')
    print(f"  {sheet_name}: {len(batch)} rows synced")


if __name__ == '__main__':
    import gspread

    print("=" * 55)
    print("  Logistimatics CSV -> Sheets Sync")
    print("=" * 55)

    with open(CONFIG_PATH) as f:
        config = json.load(f)

    spreadsheet_id   = config['spreadsheet_id']
    activation_sheet = config['activation_sheet']
    followup_sheet   = config['followup_sheet']

    print("\n[1] Authenticating...")
    creds = get_credentials()
    gc    = gspread.authorize(creds)
    print("  Done.")

    headers = ['date', 'email', 'customer_name', 'serials', 'message_id', 'status']

    print("\n[2] Syncing Activation Log...")
    activation_rows = load_csv(ACTIVATION_LOG)
    sync_sheet(gc, spreadsheet_id, activation_sheet, activation_rows, headers)

    print("\n[3] Syncing Followup Log...")
    followup_rows = load_csv(FOLLOWUP_LOG)
    sync_sheet(gc, spreadsheet_id, followup_sheet, followup_rows, headers)

    print(f"\n[4] Done! View your spreadsheet:")
    print(f"  https://docs.google.com/spreadsheets/d/{spreadsheet_id}")
    print("=" * 55)
