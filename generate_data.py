#!/usr/bin/env python3
"""
Logistimatics Activation Dashboard — Data Generator
Reads Supabase logs + Google Sheet → outputs public/data.json
Run this script to refresh the dashboard data.
"""

import csv
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, date
from pathlib import Path
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────

SOURCE_SHEET_ID = '1Y-L2MPIBEsCbHFDMOBGtWeTq29YrUwe-j3Bf6cc7Vf8'
CACHED_CREDS    = Path.home() / '.google_workspace_mcp/credentials/kevin.garma@go2impact.com.json'
MCP_CONFIG      = Path.home() / '.mcp.json'
OUTPUT_PATH     = Path(__file__).parent / 'public' / 'data.json'

# ── SmartLabel exclusion ─────────────────────────────────────────────────────

import re as _re

def _is_smartlabel(serials: str) -> bool:
    """Return True if any serial in the (comma/pipe-separated) string starts with 'SL'."""
    if not serials:
        return False
    return any(p.strip().upper().startswith('SL') for p in _re.split(r'[,|]', serials))

def _filter_sl(rows):
    """Drop any log rows whose serials field is a SmartLabel serial."""
    return [r for r in rows if not _is_smartlabel(r.get('serials', ''))]

# ── Supabase log helpers ──────────────────────────────────────────────────────

def load_log(table):
    """Fetch all sent rows from a Supabase log table, excluding SmartLabel devices."""
    try:
        from supabase_client import fetch_log
        return _filter_sl(fetch_log(table))
    except Exception as e:
        print(f"  [warn] Could not read {table} from Supabase: {e}")
        return []

# ── SendGrid stats ────────────────────────────────────────────────────────────

def _sg_key():
    """Load SendGrid API key from .mcp.json."""
    try:
        with open(MCP_CONFIG) as f:
            cfg = json.load(f)
        for name, srv in cfg.get('mcpServers', {}).items():
            if 'sendgrid' in name.lower():
                return srv.get('env', {}).get('SENDGRID_API_KEY', '')
    except Exception:
        pass
    return ''


# Subject fragments that identify our campaign emails in the Activity Feed
CAMPAIGN_SUBJECTS = [
    ('in_transit', 'tracker is on its way'),
    ('activation', 'activate in under 2 minutes'),
    ('followup',   'need help activating'),
    ('followup2',  "your tracker still isn't protecting anything"),
]

# Categories used when sending — used for the reliable Category Stats API
CAMPAIGN_CATEGORIES = ['in-transit-email', 'activation-email', 'followup-email', 'followup2-email']


def _parse_date(ts):
    """Extract YYYY-MM-DD from an ISO timestamp or date string."""
    if not ts:
        return ''
    return str(ts)[:10]


def _load_cached_sg_stats():
    """Load sendgrid_stats from the previous data.json, keyed by date."""
    try:
        with open(OUTPUT_PATH) as f:
            old = json.load(f)
        return {row['date']: row for row in old.get('sendgrid_stats', [])}
    except Exception:
        return {}




def fetch_category_stats(key):
    """
    Query /v3/categories/stats for our campaign categories (activation-email,
    followup-email). This API is pre-aggregated by SendGrid and is far more
    reliable than the Activity Feed for click/open/delivery KPIs.
    Returns a dict: {date -> metrics_dict} (only dates with non-zero sends).
    """
    start = (date.today() - __import__('datetime').timedelta(days=90)).isoformat()
    end   = date.today().isoformat()

    params = urllib.parse.urlencode(
        [('start_date', start), ('end_date', end), ('aggregated_by', 'day')]
        + [('categories', c) for c in CAMPAIGN_CATEGORIES]
    )
    url = f'https://api.sendgrid.com/v3/categories/stats?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {key}'})
    try:
        r    = urllib.request.urlopen(req, timeout=30)
        rows = json.loads(r.read())
    except Exception as e:
        print(f"  [warn] Category Stats API failed: {e}")
        return {}

    result = {}
    for row in rows:
        d = row.get('date', '')
        combined = {
            'requests': 0, 'delivered': 0, 'bounces': 0, 'unsubscribes': 0,
            'unique_opens': 0, 'opens': 0, 'unique_clicks': 0, 'clicks': 0,
            'drops': 0, 'blocks': 0, 'spam_report_drops': 0,
            'in_transit': 0, 'activation': 0, 'followup': 0,
        }
        for s in row.get('stats', []):
            m = s.get('metrics', {})
            combined['requests']          += m.get('requests',          0)
            combined['delivered']         += m.get('delivered',         0)
            combined['bounces']           += m.get('bounces',           0)
            combined['unsubscribes']      += m.get('unsubscribes',      0)
            combined['unique_opens']      += m.get('unique_opens',      0)
            combined['opens']             += m.get('opens',             0)
            combined['unique_clicks']     += m.get('unique_clicks',     0)
            combined['clicks']            += m.get('clicks',            0)
            combined['drops']             += m.get('drops',             0)
            combined['blocks']            += m.get('blocks',            0)
            combined['spam_report_drops'] += m.get('spam_report_drops', 0)
            if s.get('name') == 'in-transit-email':
                combined['in_transit'] += m.get('requests', 0)
            elif s.get('name') == 'activation-email':
                combined['activation'] += m.get('requests', 0)
            elif s.get('name') == 'followup-email':
                combined['followup'] += m.get('requests', 0)
        if combined['requests'] > 0:
            result[d] = combined

    print(f"  Category Stats: {len(result)} days with sends, "
          f"{sum(v['delivered'] for v in result.values())} delivered, "
          f"{sum(v['unique_clicks'] for v in result.values())} clicks")
    return result


def fetch_activity_feed_stats():
    """
    Query the SendGrid Activity Feed for campaign emails using subject LIKE patterns.
    Used for per-customer engagement enrichment (sg_email_map) and as a fallback
    for dates not covered by Category Stats (emails sent before categories were tagged).

    Includes a regression guard: if the Activity Feed returns suspiciously few
    results (likely a timeout/partial response), the cached stats from the previous
    data.json are preserved rather than overwriting good data with bad data.

    Returns (stat_list, has_data, sg_email_map).
    """
    key = _sg_key()
    if not key:
        print("  [warn] SENDGRID_API_KEY not found — skipping email stats.")
        return [], False, {}

    cached_by_date = _load_cached_sg_stats()

    # date -> rolling metrics dict
    results = defaultdict(lambda: {
        'requests': 0, 'delivered': 0, 'bounces': 0, 'unsubscribes': 0,
        'unique_opens': 0, 'opens': 0, 'unique_clicks': 0, 'clicks': 0,
        'in_transit': 0, 'activation': 0, 'followup': 0, 'followup2': 0,
    })

    # email -> best engagement across all campaign messages
    sg_email_map = {}
    total_feed_messages = 0

    # Pre-load existing sg_email_events from Supabase keyed by sg_message_id so
    # that upserts never overwrite a higher click/open count with a lower one.
    # (Activity Feed may show clicks_count=0 for a message if it appears due to
    # a later delivery/open event after the click already aged out of the feed.)
    existing_events_by_msg_id = {}
    try:
        from supabase_client import get_client as _get_sb_client
        _rows = _get_sb_client().table('sg_email_events').select(
            'sg_message_id,clicks_count,opens_count'
        ).limit(10000).execute()
        for _r in (_rows.data or []):
            _mid = _r.get('sg_message_id') or ''
            if _mid:
                existing_events_by_msg_id[_mid] = {
                    'clicks_count': int(_r.get('clicks_count', 0) or 0),
                    'opens_count':  int(_r.get('opens_count',  0) or 0),
                }
    except Exception as _e:
        pass  # Non-fatal — upserts will still write whatever the Activity Feed has

    for email_type, subject_frag in CAMPAIGN_SUBJECTS:
        query  = f'subject LIKE "%{subject_frag}%"'
        params = urllib.parse.urlencode({'limit': 1000, 'query': query})
        url    = f'https://api.sendgrid.com/v3/messages?{params}'
        req    = urllib.request.Request(url, headers={'Authorization': f'Bearer {key}'})
        try:
            r    = urllib.request.urlopen(req, timeout=60)
            data = json.loads(r.read())
        except Exception as e:
            print(f"  [warn] Activity Feed query failed ({email_type}): {e}")
            continue

        messages = data.get('messages', [])
        total_feed_messages += len(messages)
        feed_clicks = sum(1 for m in messages if int(m.get('clicks_count', 0) or 0) > 0)
        print(f"  Activity Feed ({email_type}): {len(messages)} messages found, {feed_clicks} with clicks")

        for msg in messages:
            ts  = msg.get('last_event_time') or ''
            day = _parse_date(ts)
            if not day:
                continue

            status       = msg.get('status', '')
            opens_count  = int(msg.get('opens_count',  0) or 0)
            clicks_count = int(msg.get('clicks_count', 0) or 0)
            to_email     = (msg.get('to_email') or '').strip().lower()

            results[day]['requests']    += 1
            results[day][email_type]    += 1

            if status == 'delivered':
                results[day]['delivered'] += 1
            elif status in ('bounce', 'blocked', 'deferred'):
                results[day]['bounces']   += 1

            if opens_count > 0:
                results[day]['unique_opens'] += 1
                results[day]['opens']        += opens_count

            if clicks_count > 0:
                results[day]['unique_clicks'] += 1
                results[day]['clicks']        += clicks_count

            # Persist every message event to Supabase so delivery, open, click,
            # and bounce data survives beyond the 7-day Activity Feed window.
            # Use max(feed, existing) for counts so a later delivery/open event
            # that brings a message back into the feed never overwrites a
            # previously-stored higher click or open count.
            if to_email:
                msg_id = msg.get('msg_id') or msg.get('message_id') or ''
                if msg_id:
                    try:
                        from supabase_client import upsert_email_event
                        existing = existing_events_by_msg_id.get(msg_id, {})
                        upsert_email_event(
                            email=to_email,
                            email_type=email_type,
                            sg_message_id=msg_id,
                            status=status,
                            delivered=(status == 'delivered'),
                            bounced=(status in ('bounce', 'blocked', 'deferred')),
                            opens_count=max(opens_count, existing.get('opens_count', 0)),
                            clicks_count=max(clicks_count, existing.get('clicks_count', 0)),
                            last_event_time=ts,
                        )
                    except Exception as e:
                        print(f"  [warn] Could not upsert email event: {e}")

                    # Also log to sg_click_log whenever there are clicks
                    if clicks_count > 0:
                        try:
                            from supabase_client import upsert_click_log
                            upsert_click_log(
                                email=to_email,
                                email_type=email_type,
                                sg_message_id=msg_id,
                                clicked_at=ts,
                                clicks_count=clicks_count,
                            )
                        except Exception as e:
                            print(f"  [warn] Could not upsert click log: {e}")

            # Merge into per-email map (keep best engagement across multiple sends)
            if to_email:
                prev = sg_email_map.get(to_email, {})
                prev_evt = prev.get('sg_last_event') or ''
                sg_email_map[to_email] = {
                    'sg_delivered':    prev.get('sg_delivered', False)    or (status == 'delivered'),
                    'sg_opened':       prev.get('sg_opened',    False)    or (opens_count  > 0),
                    'sg_clicked':      prev.get('sg_clicked',   False)    or (clicks_count > 0),
                    'sg_bounced':      prev.get('sg_bounced',   False)    or (status in ('bounce', 'blocked', 'deferred')),
                    'sg_opens_count':  prev.get('sg_opens_count',  0)     + opens_count,
                    'sg_clicks_count': prev.get('sg_clicks_count', 0)     + clicks_count,
                    'sg_last_event':   ts if ts > prev_evt else prev_evt,
                }

    # ── Regression guard ──────────────────────────────────────────────────────
    # If the Activity Feed returned far fewer delivered messages than we have
    # cached, the API likely returned a partial/truncated response. In that case,
    # fall back to the cached stats (keeping the historical sg_email_map from
    # Category Stats / previous runs) rather than overwriting good data.
    new_total_del  = sum(v['delivered'] for v in results.values())
    prev_total_del = sum(v.get('delivered', 0) for v in cached_by_date.values())
    if prev_total_del > 0 and new_total_del < prev_total_del * 0.2:
        print(f"  [warn] Activity Feed returned only {new_total_del} delivered "
              f"(was {prev_total_del}) — keeping cached stats to avoid regression.")
        # Rebuild results from cache so downstream code stays the same
        results = {d: dict(row) for d, row in cached_by_date.items()}
        # Remove computed fields so they get recalculated below
        for row in results.values():
            for k in ('open_rate', 'click_rate', 'delivery_rate', 'bounce_rate', 'date'):
                row.pop(k, None)

    if not results:
        return [], False, sg_email_map

    # Merge with Category Stats: for dates where Category Stats has data,
    # override the Activity Feed's open/click/delivery numbers (Category Stats
    # is more accurate; Activity Feed uses last_event_time which can shift dates).
    cat_stats = fetch_category_stats(key)
    for d, cs in cat_stats.items():
        if d in results:
            # Override ALL delivery+engagement metrics with Category Stats numbers.
            # Critically, use Category Stats request count — NOT max() — to avoid
            # inflating requests with Activity Feed emails from other campaigns
            # (e.g. reengagement emails that share a subject pattern with followup2).
            results[d]['unique_opens']      = cs['unique_opens']
            results[d]['opens']             = cs['opens']
            results[d]['unique_clicks']     = cs['unique_clicks']
            results[d]['clicks']            = cs['clicks']
            results[d]['delivered']         = cs['delivered']
            results[d]['bounces']           = cs['bounces']
            results[d]['requests']          = cs['requests']
            results[d]['drops']             = cs.get('drops', 0)
            results[d]['blocks']            = cs.get('blocks', 0)
            results[d]['spam_report_drops'] = cs.get('spam_report_drops', 0)
        else:
            # Date only in Category Stats (e.g. today's sends not yet in Activity Feed)
            results[d] = cs

    stat_list = []
    for d in sorted(results.keys()):
        row       = dict(results[d])
        row['date'] = d
        delivered = row['delivered']
        req       = row['requests'] or 1
        # Cap unique_opens at delivered — Category Stats can report more opens than
        # deliveries for small batches due to Apple Mail Privacy Protection
        # pre-fetching, or when SendGrid processes delivery events with a delay.
        capped_opens = min(row['unique_opens'], delivered) if delivered else 0
        if capped_opens != row['unique_opens']:
            print(f"  [cap] {d}: unique_opens {row['unique_opens']} -> {capped_opens} (delivered={delivered})")
        row['unique_opens'] = capped_opens
        stat_list.append({
            **row,
            'from_category_stats': d in cat_stats,
            'open_rate':     round(capped_opens            / delivered * 100, 1) if delivered else 0,
            'click_rate':    min(round(row['unique_clicks'] / delivered * 100, 2), 100.0) if delivered else 0,
            'delivery_rate': round(delivered / req * 100, 1),
            'bounce_rate':   round(row['bounces']           / req * 100, 2),
        })

    return stat_list, True, sg_email_map, cat_stats


def compute_sg_customer_summary(customers):
    """
    Compute email health KPIs directly from per-customer SG flags.
    These numbers align exactly with the drill-down counts shown in the UI —
    when a user clicks an Email Health KPI card they see this exact population.
    """
    tracked   = [c for c in customers if any(c.get(k) is not None for k in ('sg_delivered', 'sg_opened', 'sg_bounced'))]
    delivered = [c for c in tracked   if c.get('sg_delivered') is True]
    opened    = [c for c in delivered if c.get('sg_opened')    is True]
    clicked   = [c for c in delivered if c.get('sg_clicked')   is True]
    bounced   = [c for c in tracked   if c.get('sg_bounced')   is True]

    n_tracked   = len(tracked)
    n_delivered = len(delivered)
    n_opened    = len(opened)
    n_clicked   = len(clicked)
    n_bounced   = len(bounced)

    return {
        'customer_tracked':       n_tracked,
        'customer_delivered':     n_delivered,
        'customer_opened':        n_opened,
        'customer_clicked':       n_clicked,
        'customer_bounced':       n_bounced,
        'customer_open_rate':     round(n_opened    / n_delivered * 100, 1) if n_delivered else 0,
        'customer_click_rate':    round(n_clicked   / n_delivered * 100, 2) if n_delivered else 0,
        'customer_delivery_rate': round(n_delivered / n_tracked   * 100, 1) if n_tracked  else 0,
        'customer_bounce_rate':   round(n_bounced   / n_tracked   * 100, 2) if n_tracked  else 0,
    }


def compute_sg_summary(sg_stats, cat_stats_dates):
    """
    Roll up SendGrid stats into summary KPIs.
    For open/click rates, prefer rows sourced from Category Stats (more reliable
    than Activity Feed, which is biased by last_event_time sorting and can
    over-count opens for small batches).  Falls back to all rows if no
    Category Stats data is available.
    """
    if not sg_stats:
        return {
            'has_campaign_data': False,
            'data_note': (
                'No campaign email data found in the Activity Feed. '
                'Data appears within minutes of sending.'
            ),
        }

    # Use Category Stats rows for engagement rates if we have enough data (>=25 delivered)
    cat_rows = [d for d in sg_stats if d.get('from_category_stats')]
    cat_del  = sum(d.get('delivered', 0) for d in cat_rows)
    use_cat  = cat_del >= 25

    rate_rows = cat_rows if use_cat else sg_stats
    rate_note = ('Category Stats (activation-email + followup-email categories)'
                 if use_cat else 'Activity Feed (subject match)')

    # Use Category Stats rows for delivery metrics — the Activity Feed can capture
    # emails from other campaigns (e.g. reengagement) that share a subject pattern,
    # inflating requests and cratering the apparent delivery rate.
    # Fall back to all rows if we have no Category Stats data.
    from datetime import timedelta
    settled_cutoff = (date.today() - timedelta(days=2)).isoformat()
    settled_all = [d for d in sg_stats if d.get('date', '') <= settled_cutoff] or sg_stats
    settled_cat = [d for d in cat_rows if d.get('date', '') <= settled_cutoff] or cat_rows
    settled     = settled_cat if settled_cat else settled_all

    all_del  = sum(d.get('delivered',     0) for d in settled)
    all_bnc  = sum(d.get('bounces',       0) for d in settled)
    all_req  = sum(d.get('requests',      0) for d in settled) or all_del or 1
    all_uns  = sum(d.get('unsubscribes',  0) for d in settled)
    all_drp  = sum(d.get('drops',         0) for d in settled)
    all_blk  = sum(d.get('blocks',        0) for d in settled)
    all_spd  = sum(d.get('spam_report_drops', 0) for d in settled)

    # Open rate and click rate: use Category Stats rows only.
    # Activity Feed is unreliable for historical data — it only returns messages
    # with recent last_event_time, so pre-category sends appear to have zero clicks,
    # diluting the rate against the full delivery count.
    rate_del = sum(d.get('delivered',     0) for d in rate_rows) or 1
    open_cnt = sum(d.get('unique_opens',  0) for d in rate_rows)
    clk_cnt  = sum(d.get('unique_clicks', 0) for d in rate_rows)

    return {
        'has_campaign_data':       True,
        'data_source':             'category_stats' if use_cat else 'activity_feed',
        'period_start':            sg_stats[0]['date'],
        'period_end':              sg_stats[-1]['date'],
        'total_delivered':         all_del,
        'total_opens':             open_cnt,
        'total_clicks':            clk_cnt,
        'total_bounces':           all_bnc,
        'total_requests':          all_req,
        'total_unsubscribes':      all_uns,
        'total_drops':             all_drp,
        'total_blocks':            all_blk,
        'total_spam_report_drops': all_spd,
        'avg_open_rate':           min(round(open_cnt / rate_del * 100, 1), 100.0),
        'avg_click_rate':          min(round(clk_cnt  / rate_del * 100, 2), 100.0) if rate_del else 0,
        'avg_delivery_rate':       round(all_del / all_req * 100, 1) if all_req else 0,
        'avg_bounce_rate':         round(all_bnc / all_req * 100, 2) if all_req else 0,
        'data_note': (
            f'Open & click rates from {rate_note} ({rate_del} delivered). '
            f'Delivery rate from Category Stats rows ({all_del} delivered / {all_req} sent).'
        ),
    }


# ── Google Sheet ──────────────────────────────────────────────────────────────

def read_sheet():
    # ── Step 0: Sync Google Sheet → Supabase ─────────────────────────────────
    try:
        import sync_shopify_orders
        all_rows = sync_shopify_orders.read_google_sheet()
        records  = sync_shopify_orders.rows_to_records(all_rows)
        sync_shopify_orders.upsert_batches(records)
        print(f"  Synced {len(records)} rows from Google Sheet to Supabase shopify_orders")
    except Exception as e:
        print(f"  [warn] Sheet-to-Supabase sync skipped ({e})")

    # ── Primary: Supabase ────────────────────────────────────────────────────
    try:
        from supabase_client import fetch_shopify_orders
        email_map, serial_act_map = fetch_shopify_orders()
        if email_map:
            print(f"  Supabase: {len(email_map)} unique emails, {len(serial_act_map)} serials with activation date")
            return email_map, serial_act_map
        print("  [warn] Supabase shopify_orders returned no rows — falling back to Google Sheet")
    except Exception as e:
        print(f"  [warn] Supabase shopify_orders unavailable ({e}) — falling back to Google Sheet")

    # ── Fallback: Google Sheet ───────────────────────────────────────────────
    try:
        import gspread
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        with open(CACHED_CREDS) as f:
            data = json.load(f)

        creds = Credentials(
            token=data['token'],
            refresh_token=data['refresh_token'],
            token_uri=data['token_uri'],
            client_id=data['client_id'],
            client_secret=data['client_secret'],
        )
        if not creds.valid:
            creds.refresh(Request())

        gc = gspread.Client(auth=creds)
        sh = gc.open_by_key(SOURCE_SHEET_ID)
        ws = sh.sheet1
        all_rows = ws.get_all_values()

        email_map      = {}  # email → {sub_id, returned}
        serial_act_map = {}  # serial → earliest YYYY-MM-DD activation date
        for row in all_rows[1:]:
            if len(row) < 2:
                continue
            email           = row[1].strip().lower()
            serial          = row[4].strip()  if len(row) > 4  else ''
            sub_id          = row[9].strip()  if len(row) > 9  else ''
            returned        = row[8].strip()  if len(row) > 8  else ''
            activation_date = row[10].strip() if len(row) > 10 else ''
            if not email:
                continue
            if email not in email_map:
                email_map[email] = {'sub_id': '', 'returned': ''}
            if sub_id:
                email_map[email]['sub_id'] = sub_id
            if returned:
                email_map[email]['returned'] = returned
            if serial and activation_date:
                date_only = activation_date[:10]
                if serial not in serial_act_map or date_only < serial_act_map[serial]:
                    serial_act_map[serial] = date_only

        print(f"  Sheet (fallback): {len(email_map)} unique emails, {len(serial_act_map)} serials with activation date")
        return email_map, serial_act_map

    except Exception as e:
        print(f"  [warn] Could not read Google Sheet: {e}")
        print("  Dashboard will show CSV-only data (no activation status).")
        return {}, {}

# ── Data computation ──────────────────────────────────────────────────────────

def compute_data(activation_rows, followup_rows, sheet_map, sg_email_map=None, followup2_rows=None, serial_act_map=None, in_transit_rows=None, reengagement_rows=None, followup3_rows=None):
    today = date.today()

    # Build in-transit map: email → earliest T0 date
    in_transit_map = {}
    for row in (in_transit_rows or []):
        key = row['email'].strip().lower()
        if key not in in_transit_map:
            in_transit_map[key] = row['date']

    # Build touch-2 map: email → earliest T2 date
    fu_map = {}
    for row in followup_rows:
        key = row['email'].strip().lower()
        if key not in fu_map:
            fu_map[key] = row['date']

    # Build touch-3 map: email → earliest T3 date
    fu2_map = {}
    for row in (followup2_rows or []):
        key = row['email'].strip().lower()
        if key not in fu2_map:
            fu2_map[key] = row['date']

    # Build touch-4 map: email → earliest T4 (personal note) date
    fu3_map = {}
    for row in (followup3_rows or []):
        key = row['email'].strip().lower()
        if key not in fu3_map:
            fu3_map[key] = row['date']

    # Dedup activation rows by email (keep first sent)
    seen = {}
    for row in activation_rows:
        key = row['email'].strip().lower()
        if key not in seen:
            seen[key] = row

    # Per-customer rows with status
    customers = []
    for email_lc, row in seen.items():
        sent_date = row['date']
        serials   = row['serials'].strip('"').strip("'")

        try:
            days_since = (today - datetime.strptime(sent_date, '%Y-%m-%d').date()).days
        except Exception:
            days_since = 0

        in_transit_sent = email_lc in in_transit_map
        in_transit_date = in_transit_map.get(email_lc, '')
        fu_sent  = email_lc in fu_map
        fu_date  = fu_map.get(email_lc, '')
        fu2_sent = email_lc in fu2_map
        fu2_date = fu2_map.get(email_lc, '')
        fu3_sent = email_lc in fu3_map
        fu3_date = fu3_map.get(email_lc, '')

        info     = sheet_map.get(email_lc, {})
        sub_id   = info.get('sub_id', '')
        returned = info.get('returned', '')

        # Use serial-level activation check when possible so that a subscription
        # on a prior order doesn't incorrectly mark new unactivated devices as
        # Activated. Falls back to email-level sub_id only when serials are absent.
        if returned:
            status = 'Returned'
        elif serials and serial_act_map:
            ser_list_status = [s.strip() for s in _re.split(r'[,|]', serials) if s.strip()]
            status = 'Activated' if any(s in serial_act_map for s in ser_list_status) else 'Pending'
        else:
            status = 'Activated' if sub_id else 'Pending'

        # Look up activation date by serial number to avoid matching old
        # subscriptions from prior orders (email-based lookup causes negative days).
        activation_date = ''
        if serial_act_map and serials:
            try:
                sent_dt  = datetime.strptime(sent_date, '%Y-%m-%d').date()
                ser_list = [s.strip() for s in _re.split(r'[,|]', serials) if s.strip()]
                candidates = [serial_act_map[s] for s in ser_list if s in serial_act_map]
                after = [d for d in candidates if date.fromisoformat(d) >= sent_dt]
                if after:
                    activation_date = sorted(after)[0]       # earliest post-outreach
                elif candidates:
                    activation_date = sorted(candidates)[-1] # latest pre-outreach (fallback)
            except Exception:
                pass

        # Compute days-to-activate and which touch preceded activation.
        # Touch attribution is assigned for ALL activated customers so that
        # EmailCampaignBreakdown and activation_timing always sum to the same total.
        days_to_activate      = None
        activated_after_touch = None
        if status == 'Activated':
            if activation_date:
                try:
                    act_dt  = date.fromisoformat(activation_date[:10])
                    sent_dt = datetime.strptime(sent_date, '%Y-%m-%d').date()
                    days_to_activate = (act_dt - sent_dt).days
                except (ValueError, TypeError):
                    pass
            # Attribution based on which touches were sent (regardless of timing).
            # Priority: T4 > T3 > T2 > T0 > T1
            # T0 applies when the customer received only the in-transit email (activated before T1 sent).
            if fu3_sent:
                activated_after_touch = 'T4'
            elif fu2_sent:
                activated_after_touch = 'T3'
            elif fu_sent:
                activated_after_touch = 'T2'
            elif in_transit_sent and activation_date and activation_date < sent_date:
                activated_after_touch = 'T0'
            else:
                activated_after_touch = 'T1'

        # sg_email_map is already the merged result of Activity Feed + Supabase
        # (the merge happens in main() before compute_data is called).
        # Supabase is the authoritative permanent store — no data.json fallback needed.
        sg = (sg_email_map or {}).get(email_lc, {})
        customers.append({
            'email':                  email_lc,
            'sent_date':              sent_date,
            'serials':                serials,
            'days_since':             days_since,
            'in_transit_sent':        in_transit_sent,
            'in_transit_date':        in_transit_date,
            'fu_sent':                fu_sent,
            'fu_date':                fu_date,
            'fu2_sent':               fu2_sent,
            'fu2_date':               fu2_date,
            'fu3_sent':               fu3_sent,
            'fu3_date':               fu3_date,
            'status':                 status,
            'activation_date':        activation_date,
            'days_to_activate':       days_to_activate,
            'activated_after_touch':  activated_after_touch,
            'sg_delivered':           sg.get('sg_delivered'),
            'sg_opened':              sg.get('sg_opened'),
            'sg_clicked':             sg.get('sg_clicked'),
            'sg_bounced':             sg.get('sg_bounced'),
            'sg_opens_count':         sg.get('sg_opens_count',  0),
            'sg_clicks_count':        sg.get('sg_clicks_count', 0),
            'sg_last_event':          sg.get('sg_last_event', ''),
        })

    # ── Summary ──
    total     = len(customers)
    activated = sum(1 for c in customers if c['status'] == 'Activated')
    pending   = sum(1 for c in customers if c['status'] == 'Pending')
    returned  = sum(1 for c in customers if c['status'] == 'Returned')
    fu_sent        = sum(1 for c in customers if c['fu_sent'])
    fu_activ       = sum(1 for c in customers if c['fu_sent'] and c['status'] == 'Activated')
    fu_total_emails = len(followup_rows)   # total emails sent across all touches (not deduped)

    act_rate  = round(activated / total * 100, 1) if total else 0
    fu_rate   = round(fu_activ / fu_sent * 100, 1) if fu_sent else 0

    # In-transit per-customer records for drill-down
    # (must cover ALL T0 recipients, not just those who also got T1)
    it_seen = {}
    for row in (in_transit_rows or []):
        key = row['email'].strip().lower()
        if key not in it_seen:
            it_seen[key] = row

    in_transit_customers = []
    for email_lc, row in it_seen.items():
        sent_date = row['date']
        serials   = row.get('serials', '').strip('"').strip("'")
        try:
            days_since = (today - datetime.strptime(sent_date, '%Y-%m-%d').date()).days
        except Exception:
            days_since = 0
        info        = sheet_map.get(email_lc, {})
        sub_id      = info.get('sub_id', '')
        returned_at = info.get('returned', '')
        if returned_at:
            status = 'Returned'
        elif serials and serial_act_map:
            ser_list_status = [s.strip() for s in _re.split(r'[,|]', serials) if s.strip()]
            status = 'Activated' if any(s in serial_act_map for s in ser_list_status) else 'Pending'
        else:
            status = 'Activated' if sub_id else 'Pending'
        # fu_sent = whether this T0 customer also received T1 (activation email)
        t1_row  = seen.get(email_lc)

        # Look up activation date by serial number so the WoW chart can correctly
        # bucket T0-only activations (customers who never got T1) by the week
        # they actually activated, not by when the in-transit email was sent.
        activation_date = ''
        if serial_act_map and serials and status == 'Activated':
            try:
                sent_dt  = datetime.strptime(sent_date, '%Y-%m-%d').date()
                ser_list = [s.strip() for s in _re.split(r'[,|]', serials) if s.strip()]
                candidates = [serial_act_map[s] for s in ser_list if s in serial_act_map]
                after = [d for d in candidates if date.fromisoformat(d) >= sent_dt]
                if after:
                    activation_date = sorted(after)[0]
                elif candidates:
                    activation_date = sorted(candidates)[-1]
            except Exception:
                pass

        in_transit_customers.append({
            'email':                 email_lc,
            'sent_date':             sent_date,
            'serials':               serials,
            'days_since':            days_since,
            'fu_sent':               t1_row is not None,
            'fu_date':               t1_row['date'] if t1_row else '',
            'status':                status,
            'activation_date':       activation_date,
            'activated_after_touch': 'T0' if status == 'Activated' else None,
        })

    it_total     = len(in_transit_customers)
    it_activated = sum(1 for c in in_transit_customers if c['status'] == 'Activated')

    # Exclusive T0 counts: in-transit recipients who never received T1.
    # These are NOT in the main customers list, so they represent incremental
    # activations that the T1 campaign would never have captured.
    # Used by Campaign Overview and the T0 email card so numbers align.
    seen_emails    = set(seen.keys())
    it_excl        = [c for c in in_transit_customers if c['email'] not in seen_emails]
    it_excl_total  = len(it_excl)
    it_excl_act    = sum(1 for c in it_excl if c['status'] == 'Activated')
    it_excl_pend   = sum(1 for c in it_excl if c['status'] == 'Pending')
    it_excl_ret    = sum(1 for c in it_excl if c['status'] == 'Returned')

    # Re-engagement per-customer records for drill-down
    re_seen = {}
    for row in (reengagement_rows or []):
        key = row['email'].strip().lower()
        if key not in re_seen:
            re_seen[key] = row

    reengagement_customers = []
    for email_lc, row in re_seen.items():
        sent_date = row['date']
        serials   = row.get('serials', '').strip('"').strip("'")
        try:
            days_since = (today - datetime.strptime(sent_date, '%Y-%m-%d').date()).days
        except Exception:
            days_since = 0
        info        = sheet_map.get(email_lc, {})
        sub_id      = info.get('sub_id', '')
        returned_at = info.get('returned', '')
        if returned_at:
            status = 'Returned'
        elif serials and serial_act_map:
            ser_list_status = [s.strip() for s in _re.split(r'[,|]', serials) if s.strip()]
            status = 'Activated' if any(s in serial_act_map for s in ser_list_status) else 'Pending'
        else:
            status = 'Activated' if sub_id else 'Pending'
        reengagement_customers.append({
            'email':      email_lc,
            'sent_date':  sent_date,
            'serials':    serials,
            'days_since': days_since,
            'fu_sent':    False,
            'fu_date':    '',
            'status':     status,
        })

    re_total     = len(reengagement_customers)
    re_activated = sum(1 for c in reengagement_customers if c['status'] == 'Activated')

    # True campaign-wide totals include T0-only customers (never got T1).
    # These are the numbers shown in the Campaign Overview KPIs.
    true_total     = total     + it_excl_total
    true_activated = activated + it_excl_act
    true_pending   = pending   + it_excl_pend
    true_returned  = returned  + it_excl_ret
    true_act_rate  = round(true_activated / true_total * 100, 1) if true_total else 0

    summary = {
        'total_outreached':         true_total,
        'activated':                true_activated,
        'pending':                  true_pending,
        'returned':                 true_returned,
        'activation_rate':          true_act_rate,
        'followup_sent':            fu_total_emails,   # total emails sent (all touches)
        'followup_customers_reached': fu_sent,         # unique customers reached
        'followup_activated':       fu_activ,
        'followup_conversion_rate': fu_rate,
        'in_transit_sent':          it_total,
        'in_transit_activated':     it_activated,
        # Exclusive T0 counts: recipients who never got T1 (no overlap with T1 campaign).
        # Used by the T0 email card so per-campaign numbers add up to Campaign Overview.
        'in_transit_exclusive_sent':      it_excl_total,
        'in_transit_exclusive_activated': it_excl_act,
        'reengagement_sent':        re_total,
        'reengagement_activated':   re_activated,
    }

    # ── Timeline (emails sent per date) ──
    timeline_act = defaultdict(int)
    for row in activation_rows:
        timeline_act[row['date']] += 1

    timeline_fu = defaultdict(int)
    for row in followup_rows:
        timeline_fu[row['date']] += 1

    all_dates = sorted(set(list(timeline_act.keys()) + list(timeline_fu.keys())))
    timeline = []
    for d in all_dates:
        try:
            label = datetime.strptime(d, '%Y-%m-%d').strftime('%b %d')
        except Exception:
            label = d
        timeline.append({
            'date':       d,
            'label':      label,
            'activation': timeline_act.get(d, 0),
            'followup':   timeline_fu.get(d, 0),
        })

    # ── Cohorts (per activation batch date) ──
    cohort_map = defaultdict(lambda: {'total': 0, 'activated': 0, 'pending': 0, 'returned': 0, 'followup_sent': 0, 'followup_activated': 0})
    for c in customers:
        d = c['sent_date']
        cohort_map[d]['total']    += 1
        cohort_map[d][c['status'].lower()] += 1
        if c['fu_sent']:
            cohort_map[d]['followup_sent'] += 1
            if c['status'] == 'Activated':
                cohort_map[d]['followup_activated'] += 1

    cohorts = []
    for d in sorted(cohort_map.keys()):
        m = cohort_map[d]
        try:
            label = datetime.strptime(d, '%Y-%m-%d').strftime('%b %d')
        except Exception:
            label = d
        act_r = round(m['activated'] / m['total'] * 100, 1) if m['total'] else 0
        fu_conv = round(m['followup_activated'] / m['followup_sent'] * 100, 1) if m['followup_sent'] else 0
        cohorts.append({
            'batch_date':           d,
            'label':                label,
            'total':                m['total'],
            'activated':            m['activated'],
            'pending':              m['pending'],
            'returned':             m['returned'],
            'followup_sent':        m['followup_sent'],
            'followup_activated':   m['followup_activated'],
            'activation_rate':      act_r,
            'followup_conv_rate':   fu_conv,
        })

    # ── Funnel ──
    funnel = [
        {'stage': 'Outreached',     'value': total,     'pct': 100},
        {'stage': 'Follow-up Sent', 'value': fu_sent,   'pct': round(fu_sent / total * 100, 1) if total else 0},
        {'stage': 'Activated',      'value': activated,  'pct': act_rate},
    ]

    # ── Activation Timing ──
    # by_touch uses ALL activated customers (touch attribution is always set now).
    # timed is the subset that also have an activation date (for days/avg/distribution).
    all_activated = [c for c in customers if c['status'] == 'Activated']
    timed = [c for c in all_activated if c['days_to_activate'] is not None]
    touch_counts = {'T0': 0, 'T1': 0, 'T2': 0, 'T3': 0, 'T4': 0}
    for c in all_activated:
        t = c['activated_after_touch'] or 'T1'
        touch_counts[t] = touch_counts.get(t, 0) + 1
    n_all = len(all_activated)

    by_touch = [
        {
            'touch': 'T0',
            'label': 'After In-Transit',
            'desc':  'Activated before the first follow-up email',
            'count': touch_counts['T0'],
            'pct':   round(touch_counts['T0'] / n_all * 100, 1) if n_all else 0,
        },
        {
            'touch': 'T1',
            'label': 'After Touch 1',
            'desc':  'Activated without needing a follow-up',
            'count': touch_counts['T1'],
            'pct':   round(touch_counts['T1'] / n_all * 100, 1) if n_all else 0,
        },
        {
            'touch': 'T2',
            'label': 'After Touch 2',
            'desc':  'Activated after the second email',
            'count': touch_counts['T2'],
            'pct':   round(touch_counts['T2'] / n_all * 100, 1) if n_all else 0,
        },
        {
            'touch': 'T3',
            'label': 'After Touch 3',
            'desc':  'Activated after the third email',
            'count': touch_counts['T3'],
            'pct':   round(touch_counts['T3'] / n_all * 100, 1) if n_all else 0,
        },
        {
            'touch': 'T4',
            'label': 'After Personal Note',
            'desc':  'Activated after the personal note from Kevin',
            'count': touch_counts['T4'],
            'pct':   round(touch_counts['T4'] / n_all * 100, 1) if n_all else 0,
        },
    ]

    # Use days >= 0 for avg/median/distribution — negative values are sheet sync
    # lag artifacts and would skew stats. Touch attribution above already counts them as T1.
    all_days = sorted(c['days_to_activate'] for c in timed if c['days_to_activate'] >= 0)
    avg_days    = round(sum(all_days) / len(all_days), 1) if all_days else None
    median_days = all_days[len(all_days) // 2] if all_days else None

    BUCKETS = [
        ('≤ 3d',   lambda d: d <= 3),
        ('4–7d',   lambda d: 4  <= d <= 7),
        ('8–14d',  lambda d: 8  <= d <= 14),
        ('15–21d', lambda d: 15 <= d <= 21),
        ('22–30d', lambda d: 22 <= d <= 30),
        ('31–45d', lambda d: 31 <= d <= 45),
        ('46+d',   lambda d: d >= 46),
    ]
    days_distribution = [
        {'bucket': label, 'count': sum(1 for d in all_days if fn(d))}
        for label, fn in BUCKETS
    ]

    activation_timing = {
        'total_activated':         activated,
        'with_activation_date':    len(timed),
        'avg_days_to_activate':    avg_days,
        'median_days_to_activate': median_days,
        'by_touch':                by_touch,
        'days_distribution':       days_distribution,
    }

    return {
        'generated_at':            datetime.now().isoformat(timespec='seconds'),
        'summary':                 summary,
        'timeline':                timeline,
        'cohorts':                 cohorts,
        'funnel':                  funnel,
        'customers':               customers,
        'activation_timing':       activation_timing,
        'in_transit_customers':    in_transit_customers,
        'reengagement_customers':  reengagement_customers,
    }

# ── Survey responses ──────────────────────────────────────────────────────────

SURVEY_LOG      = Path.home() / '.claude/skills/logistimatics-survey/survey-log.csv'
SHEETS_CONFIG   = Path(__file__).parent / 'sheets_config.json'
SHEETS_CREDS    = Path.home() / '.google_workspace_mcp/credentials/logistimatics_sheets.json'

REASON_LABELS = {
    'time':       "Haven't had time yet",
    'need':       "Don't need it yet",
    'activation': 'Issue with the activation page',
    'ready':      'Not ready for a paying subscription',
}


def read_survey_responses():
    """
    Read survey responses and sent count from Supabase.
    Returns (responses_list, surveys_sent_count).
    """
    try:
        from supabase_client import fetch_survey_responses, get_client
        # Count surveys sent from Supabase survey_log table
        _result = get_client().table('survey_log').select('id', count='exact').eq('status', 'sent').execute()
        surveys_sent = _result.count or 0
        responses    = fetch_survey_responses()
        # Normalise field names to match downstream expectations
        normalised = []
        for r in responses:
            reason = r.get('reason', '')
            normalised.append({
                'date':         r.get('date', ''),
                'email':        r.get('email', ''),
                'name':         r.get('name', ''),
                'reason':       reason,
                'reason_label': r.get('reason_label') or REASON_LABELS.get(reason, reason),
            })
        print(f"  Survey responses: {len(normalised)} (from {surveys_sent} sent)")
        return normalised, surveys_sent
    except Exception as e:
        print(f"  [warn] Could not read survey data from Supabase: {e}")
        return [], 0


def compute_survey_summary(responses, surveys_sent):
    """Aggregate survey responses into counts by reason."""
    from collections import Counter
    if not responses and surveys_sent == 0:
        return {'has_survey_data': False}

    counts = Counter(r['reason'] for r in responses)
    total  = len(responses)

    breakdown = []
    for reason in ['time', 'need', 'activation', 'ready']:
        n = counts.get(reason, 0)
        breakdown.append({
            'reason':      reason,
            'label':       REASON_LABELS.get(reason, reason),
            'count':       n,
            'pct':         round(n / total * 100, 1) if total else 0,
        })

    return {
        'has_survey_data':  True,
        'surveys_sent':     surveys_sent,
        'total_responses':  total,
        'response_rate':    round(total / surveys_sent * 100, 1) if surveys_sent else 0,
        'breakdown':        breakdown,
        'recent':           sorted(responses, key=lambda r: r['date'], reverse=True)[:20],
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  Logistimatics Dashboard -- Data Generator")
    print("=" * 55)

    print("\n[1/5] Reading Supabase logs...")
    in_transit_rows    = load_log('in_transit_log')
    activation_rows    = load_log('activation_log')
    followup_rows      = load_log('followup_log')
    followup2_rows     = load_log('followup2_log')
    followup3_rows     = load_log('followup3_log')
    reengagement_rows  = load_log('reengagement_log')
    # Merge touch-2 and touch-3 into a single list for fu_sent tracking
    all_followup_rows = followup_rows + followup2_rows
    print(f"  In-transit emails:   {len(in_transit_rows)}")
    print(f"  Activation emails:   {len(activation_rows)}")
    print(f"  Follow-up emails:    {len(followup_rows)} touch-2 + {len(followup2_rows)} touch-3 + {len(followup3_rows)} touch-4 = {len(all_followup_rows) + len(followup3_rows)} total")
    print(f"  Re-engagement emails:{len(reengagement_rows)}")

    print("\n[2/5] Reading Google Sheet for activation status...")
    sheet_map, serial_act_map = read_sheet()

    print("\n[3/5] Fetching SendGrid email stats (Activity Feed)...")
    sg_stats, has_data, sg_email_map, cat_stats_dates = fetch_activity_feed_stats()
    sg_summary = compute_sg_summary(sg_stats, cat_stats_dates)
    if has_data:
        print(f"  Total campaign messages: {sum(d.get('requests',0) for d in sg_stats)}")
        print(f"  Avg open rate:           {sg_summary.get('avg_open_rate',0)}%")
        print(f"  Avg click rate:          {sg_summary.get('avg_click_rate',0)}%")
        print(f"  Avg delivery rate:       {sg_summary.get('avg_delivery_rate',0)}%")
        print(f"  Per-customer records:    {len(sg_email_map)}")
    else:
        print("  No campaign email data found in Activity Feed.")

    # Merge full Supabase event history into sg_email_map.
    # sg_email_events persists delivery, open, click, and bounce data across runs,
    # so customers outside the current 7-day Activity Feed window are still
    # correctly attributed from previous runs.
    try:
        from supabase_client import fetch_email_events
        sb_events = fetch_email_events()
        merged = 0
        for email, evt in sb_events.items():
            prev = sg_email_map.get(email, {})
            updated = {
                'sg_delivered':    prev.get('sg_delivered')    or evt.get('sg_delivered',    False),
                'sg_opened':       prev.get('sg_opened')       or evt.get('sg_opened',       False),
                'sg_clicked':      prev.get('sg_clicked')      or evt.get('sg_clicked',      False),
                'sg_bounced':      prev.get('sg_bounced')      or evt.get('sg_bounced',      False),
                'sg_opens_count':  max(prev.get('sg_opens_count',  0), evt.get('sg_opens_count',  0)),
                'sg_clicks_count': max(prev.get('sg_clicks_count', 0), evt.get('sg_clicks_count', 0)),
            }
            if updated != prev:
                merged += 1
            sg_email_map[email] = updated
        print(f"  Merged {len(sb_events)} customer(s) from Supabase sg_email_events ({merged} updated).")
    except Exception as e:
        print(f"  [warn] Could not read Supabase email events: {e}")

    print("\n[4/5] Computing campaign metrics...")
    data = compute_data(activation_rows, all_followup_rows, sheet_map, sg_email_map,
                        followup2_rows=followup2_rows, serial_act_map=serial_act_map,
                        in_transit_rows=in_transit_rows, reengagement_rows=reengagement_rows,
                        followup3_rows=followup3_rows)
    s = data['summary']
    print(f"  Total outreached:    {s['total_outreached']}")
    print(f"  Activated:           {s['activated']} ({s['activation_rate']}%)")
    print(f"  Pending:             {s['pending']}")
    print(f"  Returned:            {s['returned']}")
    print(f"  Follow-ups sent:     {s['followup_sent']}")
    print(f"  Follow-up conv rate: {s['followup_conversion_rate']}%")

    data['sendgrid_stats']   = sg_stats
    data['sendgrid_summary'] = sg_summary
    # Merge per-customer email health stats so KPI cards and drill-downs use
    # the same population (customer_open_rate, customer_delivery_rate, etc.)
    data['sendgrid_summary'].update(compute_sg_customer_summary(data['customers']))

    print("\n[4b/5] Reading survey responses...")
    survey_responses, surveys_sent = read_survey_responses()
    data['survey_summary']  = compute_survey_summary(survey_responses, surveys_sent)
    data['survey_responses'] = survey_responses

    print(f"\n[5/5] Writing -> {OUTPUT_PATH}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print("  Done.")

    print("\n[6/6] Pushing data.json to GitHub...")
    import subprocess, shutil
    repo_dir = Path(__file__).parent
    ts = datetime.now().strftime('%Y-%m-%d %H:%M')

    # Step A: commit public/data.json to master so CI rebuilds always use fresh data.
    master_cmds = [
        ['git', 'add', 'public/data.json'],
        ['git', 'commit', '-m', f'data: refresh {ts}'],
        ['git', 'push'],
    ]
    for cmd in master_cmds:
        result = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True)
        if result.returncode != 0 and 'nothing to commit' not in result.stdout + result.stderr:
            print(f"  [warn] master push: {' '.join(cmd[1:])}: {result.stderr.strip()[:120]}")
        else:
            print(f"  {' '.join(cmd[1:])} -> ok")

    # Step B: also push data.json directly to gh-pages so GitHub API serves
    # fresh content within ~60 seconds (vs waiting for the full CI rebuild).
    worktree_dir = repo_dir / '.gh-pages-worktree'
    try:
        subprocess.run(['git', 'worktree', 'remove', '--force', str(worktree_dir)],
                       cwd=repo_dir, capture_output=True)
        subprocess.run(['git', 'fetch', 'origin', 'gh-pages'],
                       cwd=repo_dir, capture_output=True)
        r = subprocess.run(
            ['git', 'worktree', 'add', str(worktree_dir), 'origin/gh-pages'],
            cwd=repo_dir, capture_output=True, text=True
        )
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        shutil.copy(OUTPUT_PATH, worktree_dir / 'data.json')
        for cmd in [
            ['git', 'add', 'data.json'],
            ['git', 'commit', '-m', f'data: refresh {ts}'],
            ['git', 'push', 'origin', 'HEAD:gh-pages'],
        ]:
            result = subprocess.run(cmd, cwd=worktree_dir, capture_output=True, text=True)
            if result.returncode != 0 and 'nothing to commit' not in result.stdout + result.stderr:
                raise RuntimeError(f"{result.stderr.strip()[:120]}")
        print("  gh-pages direct push -> ok")
    except Exception as e:
        print(f"  [warn] gh-pages direct push skipped: {e}")
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', str(worktree_dir)],
                       cwd=repo_dir, capture_output=True)

    print("\nDashboard will update within ~60 seconds (GitHub API cache).")

    # Sync CSV logs to Google Sheets (best-effort)
    try:
        sync_script = Path(__file__).parent / 'sync_to_sheets.py'
        if sync_script.exists():
            result = subprocess.run(
                [sys.executable, str(sync_script)],
                capture_output=True, text=True, timeout=60
            )
            if 'synced' in result.stdout:
                print("\n[sheets] CSV logs synced to Google Sheets.")
            elif result.returncode != 0:
                print(f"\n[sheets] Sync skipped: {result.stderr.strip()[:120]}")
    except Exception as e:
        print(f"\n[sheets] Sync skipped: {e}")

    print("=" * 55)

if __name__ == '__main__':
    main()
