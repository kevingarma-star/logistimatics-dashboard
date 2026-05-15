"""
One-time patch: read updated Subscription Assigned At dates from the sheet
and fill in activation_date + days_to_activate for the 41 customers in
data.json that were missing them.
"""
import json
from pathlib import Path
from datetime import date, datetime

SOURCE_SHEET_ID = '1Y-L2MPIBEsCbHFDMOBGtWeTq29YrUwe-j3Bf6cc7Vf8'
CACHED_CREDS    = Path.home() / '.google_workspace_mcp/credentials/kevin.garma@go2impact.com.json'
DATA_JSON       = Path(__file__).parent / 'public/data.json'


def read_serial_activation_map():
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
    sh = gc.open_by_key(SOURCE_SHEET_ID)
    ws = sh.sheet1
    all_rows = ws.get_all_values()

    serial_act_map = {}
    for row in all_rows[1:]:
        serial          = row[4].strip()  if len(row) > 4  else ''
        activation_date = row[10].strip() if len(row) > 10 else ''
        if serial and activation_date:
            date_only = activation_date[:10]
            if serial not in serial_act_map or date_only < serial_act_map[serial]:
                serial_act_map[serial] = date_only

    print(f"  Sheet: {len(serial_act_map)} serials with activation date")
    return serial_act_map


def main():
    print("Reading sheet...")
    serial_act_map = read_serial_activation_map()

    print("Loading data.json...")
    with open(DATA_JSON) as f:
        data = json.load(f)

    missing = [c for c in data['customers'] if c['status'] == 'Activated' and not c.get('days_to_activate')]
    print(f"  {len(missing)} customers missing days_to_activate")

    patched = 0
    still_missing = []

    for c in missing:
        serials = [s.strip() for s in (c.get('serials') or '').split(',') if s.strip()]
        act_date = None
        for serial in serials:
            if serial in serial_act_map:
                candidate = serial_act_map[serial]
                if act_date is None or candidate < act_date:
                    act_date = candidate
                break  # use first matched serial

        if act_date:
            sent = datetime.strptime(c['sent_date'], '%Y-%m-%d').date()
            act  = datetime.strptime(act_date, '%Y-%m-%d').date()
            days = (act - sent).days
            c['activation_date']  = act_date
            c['days_to_activate'] = days
            print(f"  OK {c['email']:45s} {act_date}  ({days}d)")
            patched += 1
        else:
            still_missing.append(c['email'])

    print(f"\nPatched {patched} / {len(missing)} customers.")
    if still_missing:
        print(f"Still no match for {len(still_missing)}:")
        for e in still_missing:
            print(f"  - {e}")

    print("\nWriting data.json...")
    with open(DATA_JSON, 'w') as f:
        json.dump(data, f, indent=2)
    print("Done.")


if __name__ == '__main__':
    main()
