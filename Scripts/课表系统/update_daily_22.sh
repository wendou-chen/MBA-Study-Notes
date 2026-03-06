#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
python3 obsidian_daily_update.py --reminder-time 22:00 --reminder-for tomorrow
