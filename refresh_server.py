#!/usr/bin/env python3
"""
Local refresh server for Logistimatics Dashboard.
Listens on localhost:8765 and runs generate_data.py when POSTed to /refresh.
Browsers allow http://localhost calls from HTTPS pages (mixed-content exception).
"""

import subprocess
import sys
import json
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

    def do_POST(self):
        if self.path != '/refresh':
            self.send_response(404)
            self.end_headers()
            return

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

    def log_message(self, fmt, *args):
        pass  # suppress default access log noise


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), RefreshHandler)
    print(f'[refresh-server] Listening on http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[refresh-server] Stopped.')
