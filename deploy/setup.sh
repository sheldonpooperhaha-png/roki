#!/usr/bin/env bash
# Sets up ROKI on a fresh Ubuntu 24.04 server (made for Amazon Lightsail).
# Run as root from the cloned repo:
#   bash deploy/setup.sh
# Safe to run again; it updates what's already there and keeps the same invite link.
#
# What it does:
#   - adds 1 GB of swap (the $5 Lightsail plan has 512 MB of memory)
#   - installs Node.js 22 (official build, checksum checked), pnpm and Caddy
#   - installs ROKI's packages and runs ROKI as a service on 127.0.0.1:8080
#   - puts Caddy in front for HTTPS on https://<server-ip>.nip.io (free Let's Encrypt certificate)
#   - checks the server's public address every 2 minutes and updates the HTTPS name if it changes
#   - makes ROKI's secret invite link; see it with:  sudo cat /etc/roki/link
set -euxo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=22
PNPM_VERSION=10.18.3
export DEBIAN_FRONTEND=noninteractive

# --- Swap ---
if ! swapon --show | grep -q '^/swapfile'; then
	if [ ! -f /swapfile ]; then
		fallocate -l 1G /swapfile
		chmod 600 /swapfile
		mkswap /swapfile
	fi
	swapon /swapfile
	grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- System packages and Caddy ---
apt-get update
apt-get install -y ca-certificates curl git xz-utils gnupg
if ! apt-get install -y caddy; then
	# Not in this Ubuntu's package list: use Caddy's official package repository
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
	apt-get update
	apt-get install -y caddy
fi

# --- Node.js ---
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
	tmp="$(mktemp -d)"
	base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
	curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
	file="$(awk '/-linux-x64\.tar\.xz$/ {print $2}' "$tmp/SHASUMS256.txt")"
	curl -fsSL "$base/$file" -o "$tmp/$file"
	(cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
	tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
	rm -rf "$tmp"
fi
node --version
npm install -g "pnpm@${PNPM_VERSION}"

# --- ROKI's packages ---
cd "$APP_DIR"
pnpm install --prod --ignore-workspace
id roki >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin roki
chown -R roki:roki "$APP_DIR"
git config --global --add safe.directory "$APP_DIR"

# --- Settings (the invite link's secret key stays on the server, never in the repo) ---
set +x # keep the key out of the setup log
install -d -m 700 /etc/roki
key="$(sed -n 's/^ROKI_KEY=//p' /etc/roki/env 2>/dev/null || true)"
if ! [[ $key =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
	key="$(head -c 18 /dev/urandom | base64 | tr '+/' '-_')"
fi
{
	printf 'ROKI_KEY=%s\n' "$key"
	echo "PORT=8080"
	echo "TRUST_PROXY=1"
} > /etc/roki/env
chmod 600 /etc/roki/env
unset key
set -x

# --- ROKI service ---
cat > /etc/systemd/system/roki.service <<EOF
[Unit]
Description=ROKI
After=network-online.target
Wants=network-online.target

[Service]
User=roki
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/roki/env
ExecStart=/usr/local/bin/node src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# --- HTTPS address updater ---
install -m 755 "$APP_DIR/deploy/update-address.sh" /usr/local/sbin/roki-update-address
cat > /etc/systemd/system/roki-address.service <<'EOF'
[Unit]
Description=Point ROKI's HTTPS name at this server's public address
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/roki-update-address
EOF
cat > /etc/systemd/system/roki-address.timer <<'EOF'
[Unit]
Description=Check ROKI's public address every 2 minutes

[Timer]
OnBootSec=20s
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now roki.service
systemctl restart roki.service
systemctl enable --now caddy.service
systemctl enable --now roki-address.timer
/usr/local/sbin/roki-update-address

set +x
echo "ROKI is set up. Invite link: $(cat /etc/roki/link)"
