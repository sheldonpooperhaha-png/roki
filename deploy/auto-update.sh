#!/usr/bin/env bash
# Checks GitHub every 10 minutes (roki-auto-update.timer) and updates ROKI when there's something new,
# so new versions go live without anyone having to connect to the server.
set -euo pipefail

APP_DIR="${ROKI_DIR:-/opt/roki}"
cd "$APP_DIR"
git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
	echo "New version on GitHub: $(git log -1 --format='%h %s' origin/main)"
	bash deploy/update.sh
else
	echo "ROKI is up to date ($(git rev-parse --short HEAD))"
fi
