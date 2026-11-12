#!/usr/bin/env bash
# Sets ROKI's invite link to words you pick: https://<address>/join/<your words>
# The old link stops working and everyone gets logged out, so open the new link on each device and
# send it to your friends again. The words work like a password: make them hard to guess.
# Run on the server:  sudo bash /opt/roki/deploy/set-link.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
	echo "Run it with sudo:  sudo bash /opt/roki/deploy/set-link.sh"
	exit 1
fi

echo
echo "Type the words for the end of your invite link (after /join/)."
echo "16 to 128 characters: letters, numbers, - and _ only, no spaces. Capitals count."
echo "Anyone who has these words can get into ROKI, so don't use something easy to guess."
echo
while :; do
	read -r -p "New link words: " key
	if [[ $key =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
		break
	fi
	echo "That doesn't fit: use 16 to 128 letters, numbers, - or _ (no spaces). You typed ${#key} characters."
done

read -r -p "Your link will end in /join/$key  Use it? (y/n) " ok
case "$ok" in
	[Yy]*) ;;
	*) echo "Nothing changed."; exit 0 ;;
esac

if grep -q '^ROKI_KEY=' /etc/roki/env; then
	sed -i "s/^ROKI_KEY=.*/ROKI_KEY=$key/" /etc/roki/env
else
	printf 'ROKI_KEY=%s\n' "$key" >> /etc/roki/env
fi
chmod 600 /etc/roki/env
systemctl restart roki
/usr/local/sbin/roki-update-address >/dev/null
unset key

echo
echo "Done. Your new invite link:"
cat /etc/roki/link
echo "It works at any of ROKI's addresses, like https://roki-hub.pages.dev/join/... with the same words."
