#!/usr/bin/env bash
# Manage ROKI accounts on the server. Run as root:
#   sudo bash /opt/roki/deploy/accounts.sh list           everyone's username
#   sudo bash /opt/roki/deploy/accounts.sh reset NAME     set a new password for NAME (asks for it)
#   sudo bash /opt/roki/deploy/accounts.sh delete NAME    remove NAME's account
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
exec sudo -u roki /usr/local/bin/node src/accounts-cli.js "$@"
