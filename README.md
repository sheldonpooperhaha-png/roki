# ROKI

A starfield start page with a private web proxy, tabs, games, a panic key and an about:blank cloak.

ROKI is built on the [Scramjet demo app](https://github.com/MercuryWorkshop/Scramjet-App) by [Mercury Workshop](https://github.com/MercuryWorkshop) and keeps its license, the [GNU AGPL v3](LICENSE).

## What's in it

- **Start page:** a big ROKI over a starfield, a search bar, big Games, Apps, Media and Chat buttons with live counts (how many games and sites, and how many people are on ROKI right now), and big tiles for favorite sites. A dock floats at the bottom with ROKI, every page, the clock, and Hide and Panic buttons (icons only on phones).
- **Apps and Media:** searchable grids of about 50 sites, listed in `public/catalog.js`. Each tile shows the site's own icon, fetched live through ROKI's server.
- **Tabs:** sites open through the [Scramjet](https://github.com/MercuryWorkshop/scramjet) proxy, each in its own tab with back, forward and reload.
- **Accounts:** everyone logs in with a username and password (`src/accounts.js`). Making an account needs the invite link (`/join/<secret key>`): opening it leads to the sign-up page, and a browser that has opened it can make an account for 30 days. Strangers only see the login screen. Passwords are stored as salted scrypt hashes, never as text; logins stay for 30 days, and changing a password (Settings, Account) logs that account out everywhere else. Too many wrong passwords locks an account (or an address) for 15 minutes. Accounts live in `data/accounts.json` on the server; the owner can list them, reset a password, delete one or give someone the Owner tag in Chat with `sudo bash /opt/roki/deploy/accounts.sh list|reset NAME|delete NAME|owner NAME|unowner NAME`. New invite words (`set-link.sh`) log everyone out but keep their accounts.
- **Games:** anything in `public/games` shows up on the Games page (see `public/games/README.txt`), with search and sorting. Comes with DOOM's free shareware episode (see `public/games/DOOM/README.txt`), Star Catcher and Wobble Brawl (an original ragdoll physics brawler made for ROKI, with weapons, a coin shop and a 2-player mode, see `public/games/wobble-brawl/README.txt`), and the page has room for a "Play online" list of games on other websites, opened in ROKI's game screen through the proxy. That list is empty, so the page only shows games saved in ROKI; to add one back, list it under `games` in `public/catalog.js` (its tile shows the game's own cover picture, fetched by ROKI's server, `src/game-art.js`).
- **Chat:** one chatroom for everyone with a ROKI account, on ROKI's own server (`src/chat.js`): messages go out under your username, with new messages showing up live and an unread count on the Chat button. Plain text only, with limits on how fast one person can post. The last 200 messages are saved in `data/chat.json` on the server (set `ROKI_DATA_DIR` to keep them somewhere else).
- **Admin page:** only accounts with the Owner tag see the Admin button, and the server checks the tag on every admin request (`/admin/*` in `src/index.js`). It shows live stats (people online, accounts, messages, uptime, memory), every account with when they joined and were last seen, and buttons to mute someone in Chat (10 minutes, 1 hour, 1 day or until unmuted), reset a password, ban or unban (a ban logs them out at once), give or take the Owner tag, and delete an account. It can pin an announcement (shown at the top of Chat and as a banner on everyone's home page), delete messages or clear the whole chat, and keeps a list of the last 100 admin actions in `data/admin-log.json`. Owners also get delete and mute buttons on messages in Chat. An Owner can't ban, mute, delete or un-Owner themselves.
- **Settings page:** 13 themes (Night, Dawn, Dusk, Aurora, Nebula, Deep sea, Ember, Forest, Graphite, Sakura, Candy, Classic and Eclipse for high contrast), stars, twinkle and shooting stars, tab cloak (fake tab name and icon from presets or your own), about:blank cloak (once or every time), panic key, ad and tracker blocking, "ask before closing", site data wiping, invite link and friend launcher, and settings export/import.

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
