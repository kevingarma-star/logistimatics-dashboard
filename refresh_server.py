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

    def log_message(self, fmt, *args):
        pass  # suppress default access log noise


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), RefreshHandler)
    print(f'[refresh-server] Listening on http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[refresh-server] Stopped.')
