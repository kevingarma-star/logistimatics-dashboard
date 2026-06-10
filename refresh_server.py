#!/usr/bin/env python3
"""
Local refresh server for Logistimatics Dashboard.
Listens on localhost:8765 and runs generate_data.py when POSTed to /refresh.
Also proxies Claude AI chat requests at /ask (requires ANTHROPIC_API_KEY env var).
Browsers allow http://localhost calls from HTTPS pages (mixed-content exception).
"""

import subprocess
import sys
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Load API key from server_config.json if env var not set
_cfg_path = Path(__file__).parent / 'server_config.json'
if not os.environ.get('ANTHROPIC_API_KEY') and _cfg_path.exists():
    try:
        _cfg = json.loads(_cfg_path.read_text())
        if _cfg.get('ANTHROPIC_API_KEY'):
            os.environ['ANTHROPIC_API_KEY'] = _cfg['ANTHROPIC_API_KEY']
    except Exception:
        pass

PORT      = 8765
REPO_DIR  = Path(__file__).parent
SCRIPT    = REPO_DIR / 'generate_data.py'
ALLOWED_ORIGINS = [
    'https://kevingarma-star.github.io',
    'http://localhost:5173',
    'http://localhost:4173',
]

SYSTEM_PROMPT = """You are an expert analyst for Logistimatics, a GPS tracker company.
You have access to live dashboard data from the customer activation campaign.
Answer questions concisely and insightfully. When referencing numbers, be precise.
Focus on actionable insights. If asked about things not in the data, say so briefly.
Use plain text — no markdown headers or bullet characters, just clean sentences and newlines."""

INSIGHTS_SYSTEM_PROMPT = """You are a senior growth and retention analyst for Logistimatics, a GPS tracker company.
You will receive live campaign data and must return a single JSON object — nothing else, no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "health_score": <integer 0-100>,
  "health_label": <"Strong" | "Needs Attention" | "At Risk">,
  "summary": <2-3 sentence plain-text executive summary of overall campaign health>,
  "sections": [
    {
      "id": <unique snake_case string>,
      "title": <section title>,
      "content": <2-4 sentences of specific analysis referencing real numbers>,
      "metric": <key number as string, e.g. "12.4%" or "433">,
      "metric_label": <short label for the metric>,
      "sentiment": <"positive" | "neutral" | "negative">
    }
  ],
  "recommendations": [
    {
      "priority": <"high" | "medium" | "low">,
      "title": <short imperative action title, max 8 words>,
      "detail": <1-2 sentences explaining exactly what to do and why>
    }
  ]
}

Rules:
- sections must include: activation_funnel, email_engagement, cohort_performance, follow_up_effectiveness, and survey_signals (if survey data exists)
- recommendations must have 3-5 items ordered high to low priority
- Every metric and claim must come from the provided data — no fabrication
- Be specific and actionable — generic advice is not useful
- Return ONLY the JSON object"""


def _build_insights_context(data):
    s       = data.get('summary', {})
    sg      = data.get('sendgrid_summary', {})
    cohorts = data.get('cohorts', [])
    funnel  = data.get('funnel', [])
    survey  = data.get('survey_summary', {})

    ctx = '=== CAMPAIGN DATA ===\n'

    ctx += '\n--- Activation Funnel ---\n'
    ctx += f"Total customers outreached: {s.get('total_outreached', 0)}\n"
    ctx += f"Activated: {s.get('activated', 0)} ({s.get('activation_rate', 0)}% conversion rate)\n"
    ctx += f"Pending activation: {s.get('pending', 0)}\n"
    ctx += f"Returned device: {s.get('returned', 0)}\n"
    for f in funnel:
        ctx += f"Funnel stage \"{f.get('stage')}\": {f.get('value')} ({f.get('pct')}%)\n"

    ctx += '\n--- Follow-up Performance ---\n'
    ctx += f"Follow-ups sent: {s.get('followup_sent', 0)}\n"
    ctx += f"Follow-up activated: {s.get('followup_activated', 0)}\n"
    ctx += f"Follow-up conversion rate: {s.get('followup_conversion_rate', 0)}%\n"

    ctx += f"\n--- Email Engagement (SendGrid Category Stats: {sg.get('total_requests', 0)} emails, {sg.get('period_start', '?')} to {sg.get('period_end', '?')}) ---\n"
    ctx += f"Delivery rate: {sg.get('avg_delivery_rate', 'N/A')}% ({sg.get('total_delivered', 0)}/{sg.get('total_requests', 0)} delivered)\n"
    ctx += f"Open rate: {sg.get('avg_open_rate', 'N/A')}% ({sg.get('total_opens', 0)} unique opens)\n"
    ctx += f"Click rate: {sg.get('avg_click_rate', 'N/A')}% ({sg.get('total_clicks', 0)} unique clicks)\n"
    ctx += f"Bounce rate: {sg.get('avg_bounce_rate', 'N/A')}%\n"
    ctx += f"Note: {sg.get('total_requests', 0)} of {s.get('total_outreached', 0)} customers have email tracking (category tags added {sg.get('period_start', '?')})\n"

    ctx += f"\n--- Batch Performance ({len(cohorts)} batches) ---\n"
    for c in cohorts:
        ctx += (
            f"{c.get('batch_date')}: {c.get('total')} sent, {c.get('activated')} activated "
            f"({c.get('activation_rate')}%), {c.get('pending')} pending, {c.get('returned')} returned, "
            f"{c.get('followup_sent')} follow-ups ({c.get('followup_conv_rate')}% conv)\n"
        )

    if survey.get('has_survey_data'):
        ctx += '\n--- Activation Barrier Survey ---\n'
        ctx += f"Surveys sent: {survey.get('surveys_sent', 0)}, responses: {survey.get('total_responses', 0)} ({survey.get('response_rate', 0)}% rate)\n"
        for b in survey.get('breakdown', []):
            ctx += f"  \"{b.get('label')}\": {b.get('count')} responses ({b.get('pct')}%)\n"

    ctx += '\n=== END DATA ==='
    return ctx


def _call_claude_insights(data):
    """Call Claude Sonnet with structured insights prompt. Returns (insights_dict, error_str)."""
    try:
        import anthropic
    except ImportError:
        return None, "anthropic package not installed. Run: pip install anthropic"

    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        return None, "ANTHROPIC_API_KEY environment variable is not set."

    ctx = _build_insights_context(data)
    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=2048,
            system=INSIGHTS_SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': ctx}],
        )
        raw = response.content[0].text
        import datetime
        result = json.loads(raw)
        result['generated_at'] = datetime.datetime.utcnow().isoformat() + 'Z'
        return result, None
    except json.JSONDecodeError as exc:
        return None, f"Model returned invalid JSON: {exc}"
    except Exception as exc:
        return None, str(exc)


RETURN_INSIGHTS_SYSTEM_PROMPT = """You are a senior returns analyst for Logistimatics, a GPS tracker company.
You will receive product return data and must return a single JSON object — nothing else, no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "health_score": <integer 0-100, where 100 = best possible, lower = more concerning return patterns>,
  "health_label": <"Healthy" | "Needs Attention" | "Concerning">,
  "summary": <2-3 sentence plain-text executive summary of return patterns and their root causes>,
  "sections": [
    {
      "id": <unique snake_case string>,
      "title": <section title>,
      "content": <2-4 sentences of specific analysis referencing real numbers from the data>,
      "metric": <key number as string, e.g. "31.6%" or "3">,
      "metric_label": <short label for the metric>,
      "sentiment": <"positive" | "neutral" | "negative">
    }
  ],
  "recommendations": [
    {
      "priority": <"high" | "medium" | "low">,
      "title": <short imperative action title, max 8 words>,
      "detail": <1-2 sentences explaining exactly what to do and why>
    }
  ]
}

Rules:
- sections must include: return_volume, reason_breakdown, product_analysis, pricing_signals, undeliverable_rate
- recommendations must have 3-5 items ordered high to low priority
- health_score: start at 100, deduct for rising return trends, high undeliverable %, quick return times (under 14 days), fixable recurring reasons
- Every metric and claim must come from the provided data — no fabrication
- Be specific and actionable — generic advice is not useful
- Return ONLY the JSON object"""


def _build_return_insights_context(data, focus=None):
    import datetime
    returns_list = data.get('returns_list', [])
    total        = data.get('total_returns', 0)
    undeliv      = data.get('undeliverable_count', 0)
    by_month     = data.get('returns_by_month', [])
    categorised  = total - undeliv

    ctx  = '=== RETURN DATA ===\n'
    ctx += f'\nTotal returns tracked (May 2026 onwards): {total}\n'
    ctx += f'Undeliverable (no B2C Returns conversation in Intercom): {undeliv}'
    ctx += f' ({round(undeliv / total * 100) if total else 0}%)\n'
    ctx += f'Categorised returns with Intercom reason: {categorised}\n'

    ctx += '\n--- Returns by Month ---\n'
    for m in by_month:
        ctx += f"  {m.get('month')}: {m.get('count')} returns\n"

    # Reason category breakdown
    reason_counts = {}
    for r in returns_list:
        cat = r.get('reason_category')
        if cat and not r.get('is_undeliverable'):
            reason_counts[cat] = reason_counts.get(cat, 0) + 1

    ctx += '\n--- Return Reason Categories ---\n'
    for cat, count in sorted(reason_counts.items(), key=lambda x: -x[1]):
        pct = round(count / categorised * 100) if categorised else 0
        ctx += f"  {cat.replace('_', ' ')}: {count} ({pct}%)\n"

    # Product breakdown
    product_counts = {}
    for r in returns_list:
        d = r.get('device_type')
        if d and not r.get('is_undeliverable'):
            product_counts[d] = product_counts.get(d, 0) + 1

    ctx += '\n--- Returns by Product/SKU ---\n'
    for prod, count in sorted(product_counts.items(), key=lambda x: -x[1]):
        ctx += f"  {prod}: {count} returns\n"

    # Avg days to return
    days_list = []
    for r in returns_list:
        if r.get('ship_date') and r.get('return_date') and not r.get('is_undeliverable'):
            try:
                ship = datetime.date.fromisoformat(r['ship_date'])
                ret  = datetime.date.fromisoformat(r['return_date'])
                d    = (ret - ship).days
                if d >= 0:
                    days_list.append(d)
            except ValueError:
                pass
    if days_list:
        avg_d = sum(days_list) / len(days_list)
        ctx += f'\nAverage days ship → return: {avg_d:.1f} days'
        ctx += f' (from {len(days_list)} records with both dates)\n'

    # Weekly cadence
    week_counts = {}
    for r in returns_list:
        rd = r.get('return_date')
        if rd:
            try:
                d   = datetime.date.fromisoformat(rd)
                day = d.weekday()  # Mon=0
                mon = d - datetime.timedelta(days=day)
                key = str(mon)
                week_counts[key] = week_counts.get(key, 0) + 1
            except ValueError:
                pass
    if week_counts:
        ctx += '\n--- Weekly return cadence ---\n'
        for wk in sorted(week_counts):
            ctx += f"  Week of {wk}: {week_counts[wk]} returns\n"

    # Individual return summaries
    ctx += '\n--- Individual Return Summaries (categorised only) ---\n'
    for r in returns_list:
        if not r.get('is_undeliverable') and r.get('reason_summary'):
            ctx += (
                f"[{r.get('customer_name', 'Unknown')}]"
                f" {r.get('device_type', 'Unknown device')}"
                f" · {r.get('reason_category', 'uncategorised')}"
                f": {r.get('reason_summary', '')}\n\n"
            )

    if focus:
        ctx += f'\n=== ANALYSIS FOCUS: {focus.upper()} ===\n'
        ctx += 'Go deeper on this area in your sections and recommendations.\n'

    ctx += '\n=== END DATA ==='
    return ctx


def _call_claude_return_insights(data, focus=None):
    """Call Claude Sonnet with return-specific insights prompt. Returns (result_dict, error_str)."""
    try:
        import anthropic
    except ImportError:
        return None, "anthropic package not installed. Run: pip install anthropic"

    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        return None, "ANTHROPIC_API_KEY environment variable is not set."

    import datetime
    ctx    = _build_return_insights_context(data, focus)
    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=2048,
            system=RETURN_INSIGHTS_SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': ctx}],
        )
        raw    = response.content[0].text
        result = json.loads(raw)
        result['generated_at'] = datetime.datetime.utcnow().isoformat() + 'Z'
        return result, None
    except json.JSONDecodeError as exc:
        return None, f"Model returned invalid JSON: {exc}"
    except Exception as exc:
        return None, str(exc)


def _call_claude(messages, data):
    """Call Claude API and return the assistant reply text."""
    try:
        import anthropic
    except ImportError:
        return None, "anthropic package not installed. Run: pip install anthropic"

    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        return None, "ANTHROPIC_API_KEY environment variable is not set."

    # Build data context summary to inject once as the first user turn
    s   = data.get('summary', {})
    sg  = data.get('sendgrid_summary', {})
    ctx = (
        f"=== DASHBOARD DATA (live snapshot) ===\n"
        f"Total outreached: {s.get('total_outreached', 'N/A')}\n"
        f"Activated: {s.get('activated', 'N/A')} ({s.get('activation_rate', 'N/A')}%)\n"
        f"Pending: {s.get('pending', 'N/A')}\n"
        f"Follow-ups sent: {s.get('followup_sent', 'N/A')} "
        f"({s.get('followup_conversion_rate', 'N/A')}% of follow-ups converted)\n"
        f"Returned: {s.get('returned', 'N/A')}\n"
    )
    if sg:
        ctx += (
            f"Email avg open rate: {sg.get('avg_open_rate', 'N/A')}%\n"
            f"Email avg delivery rate: {sg.get('avg_delivery_rate', 'N/A')}%\n"
            f"Email avg click rate: {sg.get('avg_click_rate', 'N/A')}%\n"
            f"Email avg bounce rate: {sg.get('avg_bounce_rate', 'N/A')}%\n"
        )
    cohorts = data.get('cohorts', [])
    if cohorts:
        ctx += f"Cohorts ({len(cohorts)} batches): "
        ctx += ', '.join(
            f"{c.get('batch_date','?')} [{c.get('sent',0)} sent, {c.get('activated',0)} activated]"
            for c in cohorts[:10]
        )
        if len(cohorts) > 10:
            ctx += f" ... +{len(cohorts)-10} more"
        ctx += "\n"
    survey = data.get('survey_summary', {})
    if survey.get('has_survey_data'):
        ctx += (
            f"Survey: {survey.get('total_responses',0)} responses, "
            f"{survey.get('response_rate',0)}% rate\n"
        )
        for b in survey.get('breakdown', []):
            ctx += f"  {b.get('label','?')}: {b.get('count',0)} ({b.get('pct',0)}%)\n"
    ctx += "=== END DATA ==="

    # Prepend context as a system-injected assistant note in first user message
    api_messages = list(messages)
    if api_messages and api_messages[0]['role'] == 'user':
        api_messages[0] = {
            'role': 'user',
            'content': ctx + '\n\n' + api_messages[0]['content'],
        }

    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(
            model='claude-opus-4-6',
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=api_messages,
        )
        return response.content[0].text, None
    except Exception as exc:
        return None, str(exc)


class RefreshHandler(BaseHTTPRequestHandler):

    def _cors(self):
        origin = self.headers.get('Origin', '')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(length) if length else b''

    def _send_json(self, status, obj):
        payload = json.dumps(obj).encode()
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path == '/refresh':
            self._handle_refresh()
        elif self.path == '/ask':
            self._handle_ask()
        elif self.path == '/insights':
            self._handle_insights()
        elif self.path == '/return-insights':
            self._handle_return_insights()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_refresh(self):
        print('\n[refresh] Running generate_data.py ...')
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPT)],
                cwd=str(REPO_DIR),
                capture_output=True,
                text=True,
                timeout=120,
            )
            ok      = result.returncode == 0
            output  = result.stdout[-2000:] if result.stdout else result.stderr[-2000:]
            payload = json.dumps({'ok': ok, 'output': output}).encode()
            status  = 200 if ok else 500
            print(output[-500:])
        except subprocess.TimeoutExpired:
            payload = json.dumps({'ok': False, 'output': 'Timed out after 120s'}).encode()
            status  = 500

        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _handle_ask(self):
        try:
            body = json.loads(self._read_body())
            messages = body.get('messages', [])
            data     = body.get('data', {})
        except Exception:
            self._send_json(400, {'error': 'Invalid JSON body'})
            return

        if not messages:
            self._send_json(400, {'error': 'messages array required'})
            return

        print(f'\n[ask] Question: {messages[-1].get("content","")[:80]}')
        reply, error = _call_claude(messages, data)
        if error:
            print(f'[ask] Error: {error}')
            self._send_json(500, {'error': error})
        else:
            self._send_json(200, {'reply': reply})

    def _handle_insights(self):
        try:
            body = json.loads(self._read_body())
            data = body.get('data', {})
        except Exception:
            self._send_json(400, {'error': 'Invalid JSON body'})
            return

        print('\n[insights] Generating AI insights with Claude Sonnet...')
        result, error = _call_claude_insights(data)
        if error:
            print(f'[insights] Error: {error}')
            self._send_json(500, {'error': error})
        else:
            print('[insights] Done.')
            self._send_json(200, result)

    def _handle_return_insights(self):
        try:
            body  = json.loads(self._read_body())
            data  = body.get('data', {})
            focus = body.get('focus', None)
        except Exception:
            self._send_json(400, {'error': 'Invalid JSON body'})
            return

        print('\n[return-insights] Generating return insights with Claude Sonnet...')
        result, error = _call_claude_return_insights(data, focus)
        if error:
            print(f'[return-insights] Error: {error}')
            self._send_json(500, {'error': error})
        else:
            print('[return-insights] Done.')
            self._send_json(200, result)

    def log_message(self, fmt, *args):
        pass  # suppress default access log noise


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), RefreshHandler)
    print(f'[refresh-server] Listening on http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[refresh-server] Stopped.')
