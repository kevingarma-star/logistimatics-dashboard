#!/usr/bin/env python3
"""
Shared Supabase client for all Logistimatics scripts.
Reads credentials from supabase_config.json (gitignored, lives next to this file).
"""

import json
from pathlib import Path

_client = None

def get_client():
    global _client
    if _client is not None:
        return _client
    config_path = Path(__file__).parent / 'supabase_config.json'
    with open(config_path) as f:
        cfg = json.load(f)
    from supabase import create_client
    _client = create_client(cfg['url'], cfg['key'])
    return _client


def insert_log(table, date, email, customer_name, serials, message_id, status):
    """Insert a single outreach log row into the given Supabase table."""
    get_client().table(table).insert({
        'date':          str(date),
        'email':         email.strip().lower(),
        'customer_name': customer_name,
        'serials':       serials,
        'message_id':    message_id,
        'status':        status,
    }).execute()


def fetch_log(table):
    """Return all 'sent' rows from a log table as a list of dicts."""
    result = get_client().table(table).select(
        'date,email,customer_name,serials,message_id,status'
    ).eq('status', 'sent').execute()
    return result.data or []


def fetch_survey_responses():
    """Return all survey responses, deduplicated by email (first response wins)."""
    result = get_client().table('survey_responses').select(
        'date,email,name,reason,reason_label'
    ).order('created_at', desc=False).execute()
    rows = result.data or []
    seen = set()
    deduped = []
    for row in rows:
        email = (row.get('email') or '').strip().lower()
        if email in seen:
            continue
        seen.add(email)
        deduped.append(row)
    return deduped


def insert_survey_response(date, email, name, reason, reason_label):
    """Insert a single survey response row."""
    get_client().table('survey_responses').insert({
        'date':         str(date),
        'email':        email.strip().lower(),
        'name':         name,
        'reason':       reason,
        'reason_label': reason_label,
    }).execute()
