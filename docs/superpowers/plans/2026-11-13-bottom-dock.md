# Bottom Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ROKI's top bar to a floating dock at the bottom and add big Games/Apps/Media/Chat buttons with live counts to the home page.

**Architecture:** The existing `<nav>` moves after the pages inside `#home` (the scroll container) and sticks to the bottom with `position: sticky; bottom`, pushed down with `margin-top: auto` when a page is short. Home buttons are plain `<button data-page>` elements that reuse the dock's page switching in `roki.js`; their counts come from `catalog.js`, `/games/list.json` and a `roki:online` event fired by `chat.js`.

**Tech Stack:** Plain HTML/CSS/JS in `public/`, Playwright (global install, `NODE_PATH=$(npm root -g)`) for UI checks, local server `ROKI_DATA_DIR=$S/acctdata ROKI_KEY=testkeytestkey1234 PORT=8099 node src/index.js`.

**Spec:** `docs/superpowers/specs/2026-11-13-bottom-dock-design.md`

## Global Constraints

- Dock labels in normal case ("Games"), not ALL CAPS.
- Everything from the top bar goes in the dock: ROKI, Games, Apps, Media, Chat, Settings, Admin (owners only), clock, Hide, Panic.
- Phones (max-width 760px): icons only, at the very bottom, clear of `env(safe-area-inset-bottom)`.
- Page body never scrolls sideways at any width from 360px up.
- Keep ids `chat-badge`, `admin-nav`, `clock`, `corner-cloak`, `corner-panic`, `nav-home` (other scripts use them).

## Review Focus

- A short page on a tall screen: the dock sits at the bottom of the window, not right under the content.
- A long page scrolled to the end: the last row is fully visible above the dock.
- Mid widths (800-1100px) with the Admin button showing: the dock fits without wrapping or sideways scroll.
- The Chat unread badge still shows on the dock's Chat button.
- Zero games, or Chat not connected yet: the home buttons show sensible text, not "undefined" or "0 online".

---

### Task 1: Floating dock at the bottom

**Files:**
- Modify: `public/index.html` (move `<nav class="topnav">` from before `#home-main` to after the last `<main class="page">` inside `#home`; rename classes `topnav*` → `dock*`)
- Modify: `public/roki.css` (`.topnav*` rules at ~204-251 and the 760px/520px/reduced-motion blocks)
- Modify: `public/roki.js:162` (`.topnav-link` → `.dock-link`)
- Test: `$S/ui/dock.js` (scratchpad Playwright script, not committed)

**Interfaces:**
- Produces: `.dock-link[data-page]` buttons (Task 2's selectors and the existing click handler in roki.js keep working).

- [ ] **Step 1: Write `dock.js`** that logs in as Youssef and asserts, at 1366x768, 1366x1200, 900x700 and 390x844:
  - `dock.getBoundingClientRect().bottom` is within 4-30px of the window bottom on Home and on Settings.
  - On Apps scrolled to the end, the last `.app-tile`'s bottom is ≤ the dock's top.
  - `getComputedStyle(.dock-link).textTransform === "none"`.
  - `document.documentElement.scrollWidth === innerWidth` and the dock's `scrollWidth <= clientWidth`.
  - At 390px, `.dock-link span` is hidden (display none).
  - `#chat-badge` and (for the owner) a visible `#admin-nav` are inside `.dock`, and the 900px dock still fits.
  - Clicking `.dock-link[data-page="settings"]` shows `#settings-main` and sets `aria-pressed="true"`.
- [ ] **Step 2: Run it** — expected FAIL (no `.dock`).
- [ ] **Step 3: Implement.** Dock: `position: sticky; bottom: calc(14px + env(safe-area-inset-bottom,0px)); margin: auto auto 14px; width: fit-content; max-width: 100%`, same colors/blur/radius as the old bar, a `::after` strip below it in `var(--sky-1)` like the old `::before`. Pages get `padding-bottom: 28px`. Chat box height `max(440px, calc(100vh - 210px))`. At ≤1100px hide the clock and the Hide/Panic labels; at ≤760px icons only, dock flush to the bottom with safe-area padding.
- [ ] **Step 4: Run `dock.js`** — expected all checks PASS, no page errors.
- [ ] **Step 5: Commit** `Move the top bar to a floating dock at the bottom`.

### Task 2: Big section buttons on home

**Files:**
- Modify: `public/index.html` (after `#error`, before `#feature-grid`: `<ul class="section-grid" id="section-grid">` with four `<li><button class="section-btn" type="button" data-page="games|apps|media|chat">` each holding the dock icon, a name and `<span class="section-note" id="sec-games|sec-apps|sec-media|sec-chat">`)
- Modify: `public/roki.js` (include `.section-btn` in the page-switch click handling; fill counts)
- Modify: `public/chat.js` (in the `online` listener, `document.dispatchEvent(new CustomEvent("roki:online", { detail: n }))`; on error, dispatch with `detail: null`)
- Modify: `public/roki.css` (section grid: 4 columns ≥761px, 2 columns ≤760px)
- Test: `$S/ui/dock.js` (extend)

**Interfaces:**
- Consumes: `.dock-link` page switching from Task 1.
- Produces: event `roki:online` with `detail: number | null`.

- [ ] **Step 1: Extend `dock.js`** to assert on Home:
  - `.section-btn` names in order `["Games","Apps","Media","Chat"]`.
  - `#sec-apps` text is `${catalog.apps.length} apps`, `#sec-media` is `${catalog.media.length} sites`.
  - `#sec-games` is `N games` / `1 game` / `No games yet` from `/games/list.json`.
  - With a second logged-in browser open, `#sec-chat` reads `2 online` within 3s; before any count it reads `Talk with friends`.
  - Clicking `.section-btn[data-page="games"]` shows `#games-main` and presses the dock's Games button.
- [ ] **Step 2: Run it** — expected FAIL.
- [ ] **Step 3: Implement.** Counts: apps/media from `catalog`; games by calling the existing `loadGames()` at startup and setting the note in `renderGames`; chat from `roki:online` (`1` → `Just you`, `n` → `${n} online`, `null` → `Talk with friends`).
- [ ] **Step 4: Run `dock.js`** — expected PASS; screenshot home at 1366x768 and 390x844 and look at them.
- [ ] **Step 5: Commit** `Home: big Games, Apps, Media and Chat buttons with live counts`.

### Task 3: Ship

- [ ] Update README "Start page" line (dock at the bottom, big section buttons); run `node --test tools/*.test.mjs` and `npx eslint ./src/` (expected: all pass).
- [ ] Commit, push, deploy through the Lightsail tab (expect `EXIT=0` and the new commit), hash-check and sync changed files to `~/Downloads/ROKI`.
