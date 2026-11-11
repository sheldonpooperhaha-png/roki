#!/usr/bin/env bash
# Points ROKI's HTTPS name (<public-ip>.nip.io) at this server's current public address,
# and writes ROKI's invite link to /etc/roki/link.
# Caddy gets the Let's Encrypt certificate for it on its own.
# Runs every 2 minutes (roki-address.timer), so a new or changed static IP is picked up automatically.
set -euo pipefail

ip="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
if ! [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
	echo "Couldn't read this server's public address (got: '$ip')" >&2
	exit 1
fi
host="${ip//./-}.nip.io"

want="$host {
	reverse_proxy 127.0.0.1:8080
}"

if [ "$(cat /etc/caddy/Caddyfile 2>/dev/null)" != "$want" ]; then
	printf '%s\n' "$want" > /etc/caddy/Caddyfile
	systemctl reload caddy || systemctl restart caddy
	echo "ROKI's HTTPS name is now $host"
fi
# The invite link: https://<name>/join/<secret key>
key="$(sed -n 's/^ROKI_KEY=//p' /etc/roki/env 2>/dev/null || true)"
umask 077
if [ -n "$key" ]; then
	echo "https://$host/join/$key" > /etc/roki/link
else
	echo "https://$host" > /etc/roki/link
fi
