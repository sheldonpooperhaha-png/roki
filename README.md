# ROKI

A starfield start page with a password-locked web proxy, tabs, games, a panic key and an about:blank cloak.

ROKI is built on the [Scramjet demo app](https://github.com/MercuryWorkshop/Scramjet-App) by [Mercury Workshop](https://github.com/MercuryWorkshop) and keeps its license, the [GNU AGPL v3](LICENSE).

## What's in it

- **Start page:** starfield, clock, search bar and shortcut tiles. Effects can be turned off in Effects.
- **Tabs:** sites open through the [Scramjet](https://github.com/MercuryWorkshop/scramjet) proxy, each in its own tab with back, forward and reload.
- **Password lock:** every page and the proxy connection need the password. 10 wrong tries locks that address out for 15 minutes.
- **Games:** anything in `public/games` shows up on the Games page (see `public/games/README.txt`).
- **Panic key:** press `` ` `` to jump to Google. Change the key, the site, or turn it off in Settings.
- **Privacy:** DuckDuckGo by default, site data wiped between visits, an about:blank cloak and a friend launcher.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer and pnpm.

```
pnpm install
npm start
```

Then open http://localhost:8080. Put the password in `roki-password.txt` (it's never committed) or set `ROKI_PASSWORD`. Without one, ROKI makes a random password and prints it.

On Windows you can double-click `Open ROKI.cmd` instead, and `Stop ROKI.cmd` to turn it off.

## Run it on a server (Amazon Lightsail, Ubuntu 24.04)

Create the instance with this launch script (put your own password in it):

```
#!/bin/bash
apt-get update && apt-get install -y git
git clone https://github.com/sheldonpooperhaha-png/roki /opt/roki
ROKI_PASSWORD='your-password' bash /opt/roki/deploy/setup.sh
```

Then, in the instance's Networking tab, attach a static IP and allow HTTPS (port 443). ROKI comes up at `https://<static-ip-with-dashes>.nip.io` (for example `https://3-15-1-2.nip.io`) with a free Let's Encrypt certificate. The server checks its address every 2 minutes, so the HTTPS name follows a new static IP on its own.

To update the server later, connect with SSH and run:

```
sudo bash /opt/roki/deploy/update.sh
```

Settings on the server live in `/etc/roki/env` (password, port). The current link is in `/etc/roki/link`.

## Credits

- [Scramjet](https://github.com/MercuryWorkshop/scramjet) and the [Scramjet demo app](https://github.com/MercuryWorkshop/Scramjet-App) by Mercury Workshop
- [bare-mux](https://github.com/MercuryWorkshop/bare-mux), [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) and [wisp-js](https://github.com/MercuryWorkshop/wisp-js) by Mercury Workshop
- [Caddy](https://caddyserver.com) for HTTPS, and [nip.io](https://nip.io) for the free HTTPS name
