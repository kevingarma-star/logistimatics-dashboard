#!/usr/bin/env python3
"""
Appends a single row to the Logistimatics Outreach Logs spreadsheet.
Usage:
  python append_to_sheet.py activation "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py followup   "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py followup2  "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py survey     "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
"""

import json
import sys
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / 'sheets_config.json'
CREDS_PATH  = Path.home() / '.google_workspace_mcp' / 'credentials' / 'logistimatics_sheets.json'


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


if __name__ == '__main__':
    if len(sys.argv) < 8:
        print("Usage: python append_to_sheet.py <activation|followup> <date> <email> <name> <serials> <message_id> <status>")
        sys.exit(1)

    log_type   = sys.argv[1]  # activation or followup
    row        = sys.argv[2:]  # date, email, name, serials, message_id, status

    try:
        import gspread
        with open(CONFIG_PATH) as f:
            config = json.load(f)

        if log_type == 'activation':
            sheet_name = config['activation_sheet']
        elif log_type == 'followup2':
            sheet_name = config['followup2_sheet']
        elif log_type == 'survey':
            sheet_name = config['survey_sheet']
        else:
            sheet_name = config['followup_sheet']

        creds = get_credentials()
        gc    = gspread.authorize(creds)
        sh    = gc.open_by_key(config['spreadsheet_id'])
        ws    = sh.worksheet(sheet_name)
        ws.append_row(row, value_input_option='RAW')

    except Exception as e:
        # Never block the skill if Sheets append fails — just warn
        print(f"[warn] Could not append to Sheets: {e}", file=sys.stderr)
        sys.exit(0)
