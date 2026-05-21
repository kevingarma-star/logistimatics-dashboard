#!/usr/bin/env python3
"""
Appends a single row to the Logistimatics Supabase log tables.
Usage:
  python append_to_sheet.py in_transit "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py activation "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py followup   "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py followup2  "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
  python append_to_sheet.py survey     "2026-04-27" "email@example.com" "John" "123456" "msg_id" "sent"
"""

import sys
from pathlib import Path

TABLE_MAP = {
    'in_transit': 'in_transit_log',
    'activation': 'activation_log',
    'followup':   'followup_log',
    'followup2':  'followup2_log',
    'survey':     'survey_log',
}

if __name__ == '__main__':
    if len(sys.argv) < 8:
        print("Usage: python append_to_sheet.py <activation|followup|followup2|survey> "
              "<date> <email> <name> <serials> <message_id> <status>")
        sys.exit(1)

    log_type   = sys.argv[1]
    date, email, customer_name, serials, message_id, status = sys.argv[2:8]

    table = TABLE_MAP.get(log_type)
    if not table:
        print(f"[warn] Unknown log type: {log_type}", file=sys.stderr)
        sys.exit(0)

    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from supabase_client import insert_log
        insert_log(table, date, email, customer_name, serials, message_id, status)
    except Exception as e:
        # Never block the skill if the insert fails — just warn
        print(f"[warn] Could not insert into Supabase ({table}): {e}", file=sys.stderr)
        sys.exit(0)
