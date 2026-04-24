#!/usr/bin/env python3
"""
Logistimatics Dashboard — Data Watcher
Runs generate_data.py on a fixed interval so the dashboard stays fresh.

Usage:
    python watch.py            # refresh every 30 minutes (default)
    python watch.py --every 60 # refresh every 60 minutes
"""

import subprocess
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

PYTHON  = Path(sys.executable)
SCRIPT  = Path(__file__).parent / 'generate_data.py'


def run_once():
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Refreshing dashboard data...")
    result = subprocess.run(
        [str(PYTHON), str(SCRIPT)],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        # Print only the metrics summary lines
        for line in result.stdout.splitlines():
            if any(k in line for k in ['outreached', 'Activated', 'Pending', 'Returned',
                                        'Follow', 'Done', 'open rate']):
                print(' ', line.strip())
        print(f"  Done. Next refresh in {INTERVAL_MIN} min.")
    else:
        print(f"  ERROR:\n{result.stderr[:400]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--every', type=int, default=30,
                        help='Refresh interval in minutes (default: 30)')
    args = parser.parse_args()

    global INTERVAL_MIN
    INTERVAL_MIN = args.every

    print(f"Logistimatics Dashboard Watcher")
    print(f"Refreshing every {INTERVAL_MIN} minutes. Press Ctrl+C to stop.\n")

    run_once()  # immediate first run

    while True:
        time.sleep(INTERVAL_MIN * 60)
        run_once()


if __name__ == '__main__':
    main()
