#!/usr/bin/env python3
"""
Shared Supabase client for all Logistimatics scripts.
Reads credentials from supabase_config.json (gitignored, lives next to this file).
"""

import json
from datetime import datetime
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
    ).eq('status', 'sent').limit(10000).execute()
    return result.data or []


def fetch_survey_responses():
    """Return all survey responses, deduplicated by email (first response wins)."""
    result = get_client().table('survey_responses').select(
        'date,email,name,reason,reason_label'
    ).order('created_at', desc=False).limit(10000).execute()
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


def upsert_click_log(email, email_type, sg_message_id, clicked_at, clicks_count):
    """
    Upsert a click event into sg_click_log.
    sg_message_id is unique so re-runs are safe — no duplicates created.
    """
    get_client().table('sg_click_log').upsert({
        'email':         email.strip().lower(),
        'email_type':    email_type,
        'sg_message_id': sg_message_id,
        'clicked_at':    clicked_at,
        'clicks_count':  clicks_count,
    }, on_conflict='sg_message_id').execute()


def fetch_click_log():
    """
    Return all rows from sg_click_log as a dict keyed by lowercase email.
    Merges multiple clicks per email (summing clicks_count, keeping True flags).
    """
    result = get_client().table('sg_click_log').select(
        'email,email_type,clicked_at,clicks_count'
    ).limit(10000).execute()
    rows = result.data or []
    merged = {}
    for row in rows:
        email = (row.get('email') or '').strip().lower()
        if not email:
            continue
        prev = merged.get(email, {'sg_clicked': False, 'sg_clicks_count': 0})
        merged[email] = {
            'sg_clicked':      True,
            'sg_clicks_count': prev['sg_clicks_count'] + int(row.get('clicks_count') or 1),
        }
    return merged


def upsert_email_event(email, email_type, sg_message_id, status,
                       delivered, bounced, opens_count, clicks_count,
                       last_event_time):
    """
    Upsert a single SendGrid message event into sg_email_events.
    sg_message_id is the unique key — safe to call on every generate_data.py run.
    Covers delivery, opens, clicks, and bounces so the full engagement history
    survives beyond the Activity Feed's 7-day retention window.
    """
    get_client().table('sg_email_events').upsert({
        'email':           email.strip().lower(),
        'email_type':      email_type,
        'sg_message_id':   sg_message_id,
        'status':          status,
        'delivered':       delivered,
        'bounced':         bounced,
        'opens_count':     opens_count,
        'clicks_count':    clicks_count,
        'last_event_time': last_event_time,
        'updated_at':      datetime.utcnow().isoformat() + 'Z',
    }, on_conflict='sg_message_id').execute()


def fetch_shopify_orders():
    """
    Return (email_map, serial_act_map) built from the shopify_orders table.

    email_map      : email (lowercase) → {'sub_id': str, 'returned': str}
    serial_act_map : serial → earliest activation date as 'YYYY-MM-DD'

    These are the same structures that generate_data.py's read_sheet() produces,
    so swapping the data source requires no changes downstream.
    """
    result = get_client().table('shopify_orders').select(
        'customer_email,serial,subscription_id,return_processed_at,subscription_assigned_at'
    ).limit(20000).execute()
    rows = result.data or []

    email_map      = {}
    serial_act_map = {}

    for row in rows:
        email  = (row.get('customer_email') or '').strip().lower()
        serial = (row.get('serial') or '').strip()
        if not email:
            continue

        sub_id   = (row.get('subscription_id')    or '').strip()
        returned = (row.get('return_processed_at') or '').strip()
        act_raw  = (row.get('subscription_assigned_at') or '').strip()

        if email not in email_map:
            email_map[email] = {'sub_id': '', 'returned': ''}
        if sub_id:
            email_map[email]['sub_id'] = sub_id
        if returned:
            email_map[email]['returned'] = returned

        if serial and act_raw:
            date_only = act_raw[:10]
            if serial not in serial_act_map or date_only < serial_act_map[serial]:
                serial_act_map[serial] = date_only

    return email_map, serial_act_map


def fetch_email_events():
    """
    Return all rows from sg_email_events as a dict keyed by lowercase email.
    Merges across multiple messages per customer: once True always True,
    counts are summed, most recent last_event_time is kept as sg_last_event.
    This is the permanent historical record that survives past the Activity Feed window.
    """
    result = get_client().table('sg_email_events').select(
        'email,email_type,status,delivered,bounced,opens_count,clicks_count,last_event_time'
    ).limit(10000).execute()
    rows = result.data or []
    merged = {}
    for row in rows:
        email = (row.get('email') or '').strip().lower()
        if not email:
            continue
        opens    = int(row.get('opens_count',  0) or 0)
        clicks   = int(row.get('clicks_count', 0) or 0)
        evt_time = row.get('last_event_time') or ''
        prev     = merged.get(email, {
            'sg_delivered': False, 'sg_opened': False,
            'sg_clicked':   False, 'sg_bounced': False,
            'sg_opens_count': 0,   'sg_clicks_count': 0,
            'sg_last_event': '',
        })
        merged[email] = {
            'sg_delivered':    prev['sg_delivered']    or bool(row.get('delivered')),
            'sg_opened':       prev['sg_opened']       or (opens  > 0),
            'sg_clicked':      prev['sg_clicked']      or (clicks > 0),
            'sg_bounced':      prev['sg_bounced']      or bool(row.get('bounced')),
            'sg_opens_count':  prev['sg_opens_count']  + opens,
            'sg_clicks_count': prev['sg_clicks_count'] + clicks,
            'sg_last_event':   evt_time if evt_time > (prev.get('sg_last_event') or '') else (prev.get('sg_last_event') or ''),
        }
    return merged
