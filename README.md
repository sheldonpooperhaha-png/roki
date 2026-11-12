# ROKI

A starfield start page with a private web proxy, tabs, games, a panic key and an about:blank cloak.

ROKI is built on the [Scramjet demo app](https://github.com/MercuryWorkshop/Scramjet-App) by [Mercury Workshop](https://github.com/MercuryWorkshop) and keeps its license, the [GNU AGPL v3](LICENSE).

## What's in it

- **Start page:** a floating top bar (Games, Apps, Media, Settings), a big search bar and big tiles for favorite sites.
- **Apps and Media:** searchable grids of about 50 sites, listed in `public/catalog.js`. Each tile shows the site's own icon, fetched live through ROKI's server.
- **Tabs:** sites open through the [Scramjet](https://github.com/MercuryWorkshop/scramjet) proxy, each in its own tab with back, forward and reload.
- **Secret invite link, no password:** opening the invite link (`/join/<secret key>`) once gets a browser in for 30 days. Everyone else only sees a lock screen, and 10 wrong links locks that address out for 15 minutes.
- **Games:** anything in `public/games` shows up on the Games page (see `public/games/README.txt`), with search and sorting. Comes with DOOM's free shareware episode (see `public/games/DOOM/README.txt`) and Star Catcher, plus a "Play online" list of 130+ free games on their official sites, Poki and Coolmath (Krunker, Shell Shockers, skribbl.io, Paper.io 2, Drive Mad, Fireboy and Watergirl and more). Each tile shows the game's own cover picture, which ROKI's server fetches from the game's page (`src/game-art.js`); add or remove games in `public/catalog.js`.
- **Settings page:** six color themes (Legacy, Blue, Midnight, Forest, Sunset, High Contrast), optional stars, tab cloak (fake tab name and icon from presets or your own), about:blank cloak (once or every time), panic key, ad and tracker blocking, "ask before closing", site data wiping, invite link and friend launcher, and settings export/import.
- **Corner buttons:** jump into about:blank, panic, or open the source code.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer and pnpm.

```
pnpm install
npm start
```

Then open the invite link ROKI prints (`http://localhost:8080/join/...`). The secret key is made on the first run and saved in `roki-key.txt`, which is never committed. You can set your own with `ROKI_KEY` (4-128 letters, numbers, `-` or `_`).

On Windows you can double-click `Open ROKI.cmd` instead, which opens the invite link for you, and `Stop ROKI.cmd` to turn it off.

## Run it on a server (Amazon Lightsail, Ubuntu 24.04)

Create the instance with this launch script:

```
#!/bin/bash
apt-get update && apt-get install -y git
git clone https://github.com/sheldonpooperhaha-png/roki /opt/roki
bash /opt/roki/deploy/setup.sh
```

Then, in the instance's Networking tab, attach a static IP and allow HTTPS (port 443). ROKI comes up at `https://<static-ip-with-dashes>.nip.io` (for example `https://3-15-1-2.nip.io`) with a free Let's Encrypt certificate. The server checks its address every 2 minutes, so the HTTPS name follows a new static IP on its own.

To get the invite link, connect with SSH and run:

```
sudo cat /etc/roki/link
```

If the link gets out to someone it shouldn't, make a new one (the old one stops working and everyone has to open the new one):

```
sudo bash /opt/roki/deploy/new-link.sh
```

Or pick the words at the end of the link yourself (4-128 letters, numbers, - or _; it asks for them). Short words are easier to guess; ROKI allows 10 wrong tries per 15 minutes from one place:

```
sudo bash /opt/roki/deploy/set-link.sh
```

### A pages.dev address

ROKI also works at https://roki-hub.pages.dev. That's a Cloudflare Pages project whose only file,
`deploy/cloudflare-pages/_worker.js`, passes every request to the server. To change it, upload the
`deploy/cloudflare-pages` folder again in Cloudflare (Workers & Pages → roki-hub → Create deployment).

### A cloudfront.net address

ROKI also works at https://d3b3wz3481cm76.cloudfront.net, an AWS CloudFront distribution ("roki",
E3IVT1AHAOEAE7) in front of the server: origin `18-217-91-210.nip.io` over HTTPS only, cache policy
CachingDisabled, origin request policy AllViewerExceptHostHeader, all HTTP methods, no WAF.
It's free within CloudFront's always-free allowance (1 TB a month).

To update the server later, connect with SSH and run:

```
sudo bash /opt/roki/deploy/update.sh
```

Settings on the server live in `/etc/roki/env` (secret key, port). The current invite link is in `/etc/roki/link`.

## Credits

- [Scramjet](https://github.com/MercuryWorkshop/scramjet) and the [Scramjet demo app](https://github.com/MercuryWorkshop/Scramjet-App) by Mercury Workshop
- [bare-mux](https://github.com/MercuryWorkshop/bare-mux), [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) and [wisp-js](https://github.com/MercuryWorkshop/wisp-js) by Mercury Workshop
- [Caddy](https://caddyserver.com) for HTTPS, and [nip.io](https://nip.io) for the free HTTPS name
