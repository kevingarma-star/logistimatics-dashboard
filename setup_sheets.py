#!/usr/bin/env python3
"""
One-time setup: authenticates with Google (write scope), creates the
Logistimatics Outreach Logs spreadsheet with two tabs, and saves the
sheet ID to sheets_config.json for use by generate_data.py and the skills.
"""

import json
import os
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / 'sheets_config.json'
CREDS_PATH  = Path.home() / '.google_workspace_mcp' / 'credentials' / 'logistimatics_sheets.json'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
]

def get_credentials():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request

    # Load existing creds if available
    if CREDS_PATH.exists():
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
            save_creds(creds)
        return creds

    # Read client secrets from existing MCP credentials file
    existing = Path.home() / '.google_workspace_mcp' / 'credentials' / 'kevin.garma@go2impact.com.json'
    with open(existing) as f:
        existing_data = json.load(f)

    client_config = {
        "installed": {
            "client_id":     existing_data['client_id'],
            "client_secret": existing_data['client_secret'],
            "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
            "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
            "token_uri":     existing_data['token_uri'],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    flow.redirect_uri = 'urn:ietf:wg:oauth:2.0:oob'
    auth_url, _ = flow.authorization_url(prompt='consent')

    print(f"\nOpen this URL in your browser:\n\n{auth_url}\n")
    code = input("Paste the authorization code here: ").strip()

    flow.fetch_token(code=code)
    creds = flow.credentials
    save_creds(creds)
    return creds


def save_creds(creds):
    CREDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CREDS_PATH, 'w') as f:
        json.dump({
            'token':         creds.token,
            'refresh_token': creds.refresh_token,
            'token_uri':     creds.token_uri,
            'client_id':     creds.client_id,
            'client_secret': creds.client_secret,
        }, f, indent=2)


def setup_spreadsheet(creds):
    import gspread

    gc = gspread.authorize(creds)

    # Create spreadsheet
    sh = gc.create('Logistimatics Outreach Logs')
    print(f"  Created spreadsheet: {sh.id}")

    # Rename default sheet to Activation Log
    ws1 = sh.sheet1
    ws1.update_title('Activation Log')
    ws1.append_row(['date', 'email', 'customer_name', 'serials', 'message_id', 'status'])

    # Add Followup Log tab
    ws2 = sh.add_worksheet(title='Followup Log', rows=1000, cols=10)
    ws2.append_row(['date', 'email', 'customer_name', 'serials', 'message_id', 'status'])

    print("  Created tabs: Activation Log, Followup Log")
    print("  Added headers to both tabs")

    # Save config
    config = {
        'spreadsheet_id': sh.id,
        'activation_sheet': 'Activation Log',
        'followup_sheet':   'Followup Log',
        'creds_path':       str(CREDS_PATH),
    }
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

    print(f"\n  Spreadsheet URL: https://docs.google.com/spreadsheets/d/{sh.id}")
    print(f"  Config saved to: {CONFIG_PATH}")
    return sh.id


if __name__ == '__main__':
    print("=" * 55)
    print("  Logistimatics Sheets Setup")
    print("=" * 55)

    try:
        import gspread
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("\n[error] Missing dependencies. Run:")
        print("  pip install gspread google-auth google-auth-oauthlib")
        exit(1)

    print("\n[1] Authenticating with Google (browser will open)...")
    creds = get_credentials()
    print("  Authenticated.")

    print("\n[2] Creating spreadsheet...")
    sheet_id = setup_spreadsheet(creds)

    print("\n[3] Done! Next steps:")
    print("  - Run generate_data.py to sync existing CSV data to the sheet")
    print("  - The activation and followup skills will now log to both CSV and Sheets")
    print("=" * 55)
