#!/usr/bin/env bash
# Makes a new invite link for ROKI. Use it if the link got out to someone it shouldn't have.
# The old link stops working and everyone gets logged out, so send the new link to your friends.
# Run on the server:  sudo bash /opt/roki/deploy/new-link.sh
set -euo pipefail

key="$(head -c 18 /dev/urandom | base64 | tr '+/' '-_')"
sed -i "s/^ROKI_KEY=.*/ROKI_KEY=$key/" /etc/roki/env
grep -q '^ROKI_KEY=' /etc/roki/env || printf 'ROKI_KEY=%s\n' "$key" >> /etc/roki/env
systemctl restart roki
/usr/local/sbin/roki-update-address >/dev/null
echo "New invite link: $(cat /etc/roki/link)"
