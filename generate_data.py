#!/usr/bin/env python3
"""
Logistimatics Activation Dashboard — Data Generator
Reads local CSV logs + Google Sheet → outputs public/data.json
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

ACTIVATION_LOG  = Path.home() / '.claude/skills/logistimatics-activation/sent-log.csv'
FOLLOWUP_LOG    = Path.home() / '.claude/skills/logistimatics-followup/followup-log.csv'
SOURCE_SHEET_ID = '1Y-L2MPIBEsCbHFDMOBGtWeTq29YrUwe-j3Bf6cc7Vf8'
CACHED_CREDS    = Path.home() / '.google_workspace_mcp/credentials/kevin.garma@go2impact.com.json'
MCP_CONFIG      = Path.home() / '.mcp.json'
OUTPUT_PATH     = Path(__file__).parent / 'public' / 'data.json'

# ── CSV helpers ───────────────────────────────────────────────────────────────

def load_csv(path):
    rows = []
    try:
        with open(path, newline='', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                if row.get('status', '').strip() == 'sent':
                    rows.append(row)
    except FileNotFoundError:
        print(f"  [warn] File not found: {path}")
    return rows

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
    ('activation', 'activate in under 2 minutes'),
    ('followup',   'need help activating'),
]


def _parse_date(ts):
    """Extract YYYY-MM-DD from an ISO timestamp or date string."""
    if not ts:
        return ''
    return str(ts)[:10]


def fetch_activity_feed_stats():
    """
    Query the SendGrid Activity Feed for campaign emails using subject LIKE patterns.
    Aggregates opens, clicks, delivered counts per date from actual sent messages.
    This works regardless of category tagging — data is available immediately.
    Returns (stat_list, has_data).
    """
    key = _sg_key()
    if not key:
        print("  [warn] SENDGRID_API_KEY not found — skipping email stats.")
        return [], False

    # date -> rolling metrics dict
    results = defaultdict(lambda: {
        'requests': 0, 'delivered': 0, 'bounces': 0, 'unsubscribes': 0,
        'unique_opens': 0, 'opens': 0, 'unique_clicks': 0, 'clicks': 0,
        'activation': 0, 'followup': 0,
    })

    for email_type, subject_frag in CAMPAIGN_SUBJECTS:
        query = f'subject LIKE "%{subject_frag}%"'
        params = urllib.parse.urlencode({'limit': 1000, 'query': query})
        url = f'https://api.sendgrid.com/v3/messages?{params}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {key}'})
        try:
            r = urllib.request.urlopen(req, timeout=30)
            data = json.loads(r.read())
        except Exception as e:
            print(f"  [warn] Activity Feed query failed ({email_type}): {e}")
            continue

        messages = data.get('messages', [])
        print(f"  Activity Feed ({email_type}): {len(messages)} messages found")

        for msg in messages:
            # Use the send timestamp to bucket by date
            ts  = msg.get('last_event_time') or msg.get('from_email') or ''
            day = _parse_date(ts)
            if not day:
                continue

            status       = msg.get('status', '')
            opens_count  = int(msg.get('opens_count',  0) or 0)
            clicks_count = int(msg.get('clicks_count', 0) or 0)

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

    if not results:
        return [], False

    stat_list = []
    for d in sorted(results.keys()):
        row       = dict(results[d])
        row['date'] = d
        delivered = row['delivered']
        req       = row['requests'] or 1
        stat_list.append({
            **row,
            'open_rate':     round(row['unique_opens']  / delivered * 100, 1) if delivered else 0,
            'click_rate':    round(row['unique_clicks'] / delivered * 100, 2) if delivered else 0,
            'delivery_rate': round(delivered / req * 100, 1),
            'bounce_rate':   round(row['bounces']       / req * 100, 2),
        })

    return stat_list, True


def compute_sg_summary(sg_stats):
    """Roll up SendGrid stats into summary KPIs."""
    if not sg_stats:
        return {
            'has_campaign_data': False,
            'data_note': (
                'No campaign email data found in the Activity Feed. '
                'Data appears within minutes of sending.'
            ),
        }

    all_del  = sum(d.get('delivered',     0) for d in sg_stats)
    all_open = sum(d.get('unique_opens',  0) for d in sg_stats)
    all_clk  = sum(d.get('unique_clicks', 0) for d in sg_stats)
    all_bnc  = sum(d.get('bounces',       0) for d in sg_stats)
    all_req  = sum(d.get('requests',      0) for d in sg_stats) or all_del or 1
    all_uns  = sum(d.get('unsubscribes',  0) for d in sg_stats)

    return {
        'has_campaign_data':  True,
        'data_source':        'activity_feed',
        'period_start':       sg_stats[0]['date'],
        'period_end':         sg_stats[-1]['date'],
        'total_delivered':    all_del,
        'total_opens':        all_open,
        'total_clicks':       all_clk,
        'total_bounces':      all_bnc,
        'total_requests':     all_req,
        'total_unsubscribes': all_uns,
        'avg_open_rate':      round(all_open / all_del * 100, 1) if all_del else 0,
        'avg_click_rate':     round(all_clk  / all_del * 100, 2) if all_del else 0,
        'avg_delivery_rate':  round(all_del  / all_req * 100, 1) if all_req else 0,
        'avg_bounce_rate':    round(all_bnc  / all_req * 100, 2) if all_req else 0,
        'data_note':          'Activation + follow-up emails from Activity Feed (last 30 days).',
    }


# ── Google Sheet ──────────────────────────────────────────────────────────────

def read_sheet():
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

        email_map = {}
        for row in all_rows[1:]:
            if len(row) < 2:
                continue
            email    = row[1].strip().lower()
            sub_id   = row[9].strip() if len(row) > 9 else ''
            returned = row[8].strip() if len(row) > 8 else ''
            if not email:
                continue
            if email not in email_map:
                email_map[email] = {'sub_id': '', 'returned': ''}
            if sub_id:
                email_map[email]['sub_id'] = sub_id
            if returned:
                email_map[email]['returned'] = returned

        print(f"  Sheet: {len(email_map)} unique emails loaded")
        return email_map

    except Exception as e:
        print(f"  [warn] Could not read Google Sheet: {e}")
        print("  Dashboard will show CSV-only data (no activation status).")
        return {}

# ── Data computation ──────────────────────────────────────────────────────────

def compute_data(activation_rows, followup_rows, sheet_map):
    today = date.today()

    # Build follow-up map: email → date
    fu_map = {}
    for row in followup_rows:
        fu_map[row['email'].strip().lower()] = row['date']

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

        fu_sent = email_lc in fu_map
        fu_date = fu_map.get(email_lc, '')

        info     = sheet_map.get(email_lc, {})
        sub_id   = info.get('sub_id', '')
        returned = info.get('returned', '')

        if returned:
            status = 'Returned'
        elif sub_id:
            status = 'Activated'
        else:
            status = 'Pending'

        customers.append({
            'email':      email_lc,
            'sent_date':  sent_date,
            'serials':    serials,
            'days_since': days_since,
            'fu_sent':    fu_sent,
            'fu_date':    fu_date,
            'status':     status,
        })

    # ── Summary ──
    total     = len(customers)
    activated = sum(1 for c in customers if c['status'] == 'Activated')
    pending   = sum(1 for c in customers if c['status'] == 'Pending')
    returned  = sum(1 for c in customers if c['status'] == 'Returned')
    fu_sent   = sum(1 for c in customers if c['fu_sent'])
    fu_activ  = sum(1 for c in customers if c['fu_sent'] and c['status'] == 'Activated')

    act_rate  = round(activated / total * 100, 1) if total else 0
    fu_rate   = round(fu_activ / fu_sent * 100, 1) if fu_sent else 0

    summary = {
        'total_outreached':       total,
        'activated':              activated,
        'pending':                pending,
        'returned':               returned,
        'activation_rate':        act_rate,
        'followup_sent':          fu_sent,
        'followup_activated':     fu_activ,
        'followup_conversion_rate': fu_rate,
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

    return {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'summary':      summary,
        'timeline':     timeline,
        'cohorts':      cohorts,
        'funnel':       funnel,
        'customers':    customers,
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  Logistimatics Dashboard -- Data Generator")
    print("=" * 55)

    print("\n[1/5] Reading local CSV logs...")
    activation_rows = load_csv(ACTIVATION_LOG)
    followup_rows   = load_csv(FOLLOWUP_LOG)
    print(f"  Activation emails: {len(activation_rows)}")
    print(f"  Follow-up emails:  {len(followup_rows)}")

    print("\n[2/5] Reading Google Sheet for activation status...")
    sheet_map = read_sheet()

    print("\n[3/5] Computing campaign metrics...")
    data = compute_data(activation_rows, followup_rows, sheet_map)
    s = data['summary']
    print(f"  Total outreached:    {s['total_outreached']}")
    print(f"  Activated:           {s['activated']} ({s['activation_rate']}%)")
    print(f"  Pending:             {s['pending']}")
    print(f"  Returned:            {s['returned']}")
    print(f"  Follow-ups sent:     {s['followup_sent']}")
    print(f"  Follow-up conv rate: {s['followup_conversion_rate']}%")

    print("\n[4/5] Fetching SendGrid email stats (Activity Feed)...")
    sg_stats, has_data = fetch_activity_feed_stats()
    sg_summary = compute_sg_summary(sg_stats)
    if has_data:
        print(f"  Total campaign messages: {sum(d.get('requests',0) for d in sg_stats)}")
        print(f"  Avg open rate:           {sg_summary.get('avg_open_rate',0)}%")
        print(f"  Avg click rate:          {sg_summary.get('avg_click_rate',0)}%")
        print(f"  Avg delivery rate:       {sg_summary.get('avg_delivery_rate',0)}%")
    else:
        print("  No campaign email data found in Activity Feed.")

    data['sendgrid_stats']   = sg_stats
    data['sendgrid_summary'] = sg_summary

    print(f"\n[5/5] Writing -> {OUTPUT_PATH}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print("  Done.")

    print("\n[6/6] Pushing data.json to GitHub...")
    import subprocess, os
    repo_dir = Path(__file__).parent
    ts = datetime.now().strftime('%Y-%m-%d %H:%M')
    cmds = [
        ['git', 'add', 'public/data.json'],
        ['git', 'commit', '-m', f'data: refresh {ts}'],
        ['git', 'push'],
    ]
    for cmd in cmds:
        result = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True)
        if result.returncode != 0 and 'nothing to commit' not in result.stdout + result.stderr:
            print(f"  [warn] {' '.join(cmd)}: {result.stderr.strip()}")
        else:
            print(f"  {' '.join(cmd[1:])} -> ok")
    print("\nDashboard will update on GitHub Pages in ~30 seconds.")

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
