#!/usr/bin/env bash
# Updates ROKI on the server to the latest version on GitHub.
# Run as root on the server:  sudo bash /opt/roki/deploy/update.sh
set -euxo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
bash deploy/setup.sh
