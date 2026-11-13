# Bottom dock and home section buttons

## Why
Youssef's friends say ROKI looks like Reds Exploit Hub. The giveaway is the layout: a floating bar across the
top with ALL-CAPS page names, then a giant title, a search bar and colored tiles. A full redesign was tried before
(left rail, big clock, moon) and Youssef asked to go back, so this keeps the parts he likes and changes the silhouette.

## What he asked for (approved 2026-11-13)
- The top bar moves to the bottom as a **floating dock**: rounded, hovering above the bottom edge, only as wide
  as its buttons. Everything in the top bar moves into it (ROKI, Games, Apps, Media, Chat, Settings, Admin for
  owners, the clock, Hide, Panic). Only the tabs and address bar stay at the top.
- **Big section buttons on the home page** under the search: Games, Apps, Media, Chat, each with a live line
  (number of games, apps, media sites, people in Chat right now). The favorite site tiles stay below them.
- Kept: big ROKI, the date, the search bar, themes, stars.

## Calls I made
- Dock labels in normal case ("Games"), not ALL CAPS: the capitals are part of the Reds look.
- The page you're on stays highlighted in the accent color; the Chat unread number stays on the Chat button.
- Phones (760px and under): the dock shows icons only and sits at the very bottom, clear of the home indicator.
- Every page gets bottom padding so the dock never covers content; Chat's box height accounts for the dock.
- The dock is the same element as before, moved after the pages in the page order and stuck to the bottom with
  `position: sticky`, so keyboard order matches what you see. Class names change from `topnav-*` to `dock-*`.
- Games count comes from `/games/list.json` (already loaded for the Games page), Apps and Media counts from
  `catalog.js`, the Chat count from the chat connection that already runs for the unread badge.
- Settings and Admin stay dock-only (no big button).

## Approaches
1. **Move the existing bar and restyle it (picked).** Small change, keeps every button's behavior, no new code paths.
2. A second, separate dock element with the old bar hidden: duplicate buttons and ids, more to keep in sync.
3. A full new layout: already tried and rejected.

## Not doing
- No change to the tabs/address bar, themes, the Games/Apps/Media/Chat/Settings/Admin page contents, or the server.
