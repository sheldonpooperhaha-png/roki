"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const store = {
		get(k, d) { try { const v = localStorage.getItem("roki:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
		set(k, v) { try { localStorage.setItem("roki:" + k, JSON.stringify(v)); } catch (e) {} },
	};

	/* ---------- Proxy setup (Scramjet + bare-mux over wisp) ---------- */
	const { ScramjetController } = $scramjetLoadController();
	const scramjet = new ScramjetController({
		files: {
			wasm: "/scram/scramjet.wasm.wasm",
			all: "/scram/scramjet.all.js",
			sync: "/scram/scramjet.sync.js",
		},
	});

	/* ---------- Private mode: wipe site data ---------- */
	// Scramjet stores each proxied site's data under the site's own name:
	// "host@key" in localStorage/sessionStorage and "https://origin@name" for databases and caches.
	// Only that gets wiped, so ROKI's settings, the ROKI login and game saves stay.
	const SESSION_KEY = "roki:session";
	const SCRAMJET_DB = "$scramjet";
	const SCRAMJET_SITE_STORES = ["cookies", "redirectTrackers", "referrerPolicies"];
	const SITE_KEY = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?@/i;
	const SITE_NAME = /^https?:\/\/[^@\/]+@/i;

	function deleteDB(name) {
		return new Promise((resolve) => {
			const req = indexedDB.deleteDatabase(name);
			req.onsuccess = req.onerror = () => resolve();
			req.onblocked = () => setTimeout(resolve, 1500);
		});
	}
	function clearStores(name, stores) {
		return new Promise((resolve) => {
			const open = indexedDB.open(name);
			open.onupgradeneeded = () => open.transaction.abort();
			open.onerror = () => resolve();
			open.onsuccess = () => {
				const db = open.result;
				const present = stores.filter((s) => db.objectStoreNames.contains(s));
				if (!present.length) { db.close(); resolve(); return; }
				const tx = db.transaction(present, "readwrite");
				present.forEach((s) => tx.objectStore(s).clear());
				tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); resolve(); };
			};
		});
	}
	function clearSiteKeys(storage) {
		const doomed = [];
		for (let i = 0; i < storage.length; i++) {
			const k = storage.key(i);
			if (k && SITE_KEY.test(k)) doomed.push(k);
		}
		doomed.forEach((k) => storage.removeItem(k));
	}
	async function wipeSiteData() {
		try { clearSiteKeys(localStorage); } catch (e) {}
		try { clearSiteKeys(sessionStorage); } catch (e) {}
		try {
			const dbs = indexedDB.databases ? await indexedDB.databases() : [{ name: SCRAMJET_DB }];
			for (const { name } of dbs) {
				if (!name) continue;
				if (name === SCRAMJET_DB) await clearStores(name, SCRAMJET_SITE_STORES);
				else if (SITE_NAME.test(name)) await deleteDB(name);
			}
		} catch (e) {}
		try {
			if (window.caches) for (const k of await caches.keys()) if (SITE_NAME.test(k)) await caches.delete(k);
		} catch (e) {}
	}

	// "Wipe between visits": clear what sites left behind last time, before anything loads
	let freshVisit = false;
	try {
		freshVisit = !sessionStorage.getItem(SESSION_KEY);
		sessionStorage.setItem(SESSION_KEY, "1");
	} catch (e) {}
	const startupWipe = store.get("auto-wipe", true) && freshVisit ? wipeSiteData() : Promise.resolve();

	const scramjetReady = startupWipe.then(() => scramjet.init());
	const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

	let proxyReady = null;
	function ensureProxy() {
		if (!proxyReady) {
			proxyReady = (async () => {
				await scramjetReady;
				await registerSW();
				await navigator.serviceWorker.ready;
				const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
				if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
					await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
				}
			})().catch((err) => {
				proxyReady = null;
				throw err;
			});
		}
		return proxyReady;
	}

	/* ---------- Search engines ---------- */
	const engines = {
		google: "https://www.google.com/search?q=%s",
		duckduckgo: "https://duckduckgo.com/?q=%s",
		bing: "https://www.bing.com/search?q=%s",
	};
	let engine = store.get("engine", "duckduckgo");
	if (!engines[engine]) engine = "duckduckgo";

	/* ---------- Helpers ---------- */
	const GLOBE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
	const SPARK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>';
	const PAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4"/><path d="M15.5 11h.01M18 13h.01"/></svg>';
	const CLOSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
	const PREFIX = "/scramjet/";

	function realUrl(u) {
		let s = String(u);
		try {
			if (s.startsWith(location.origin + PREFIX) || s.startsWith(PREFIX)) s = scramjet.decodeUrl(s);
		} catch (e) {}
		return s;
	}
	function hostOf(u) {
		try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return String(u); }
	}
	function proxiedAsset(href) {
		try {
			const u = new URL(href, location.href);
			if (u.origin === location.origin) return u.href;
			if (!/^https?:$/.test(u.protocol)) return null;
			return scramjet.encodeUrl(u.href);
		} catch (e) {
			return null;
		}
	}
	function initials(name) {
		const words = String(name).split(/\s+/).filter(Boolean);
		if (!words.length) return "?";
		if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].charAt(1).toLowerCase();
		return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
	}

	/* ---------- Tabs ---------- */
	// Each tab shows one of: "home" (new tab page), "games" (games list),
	// "web" (a site through the proxy) or "game" (a game from public/games).
	const tabsEl = $("tabs");
	const viewport = $("viewport");
	const home = $("home");
	const homeMain = $("home-main");
	const gamesMain = $("games-main");
	const gamesBtn = $("games-btn");
	const addr = $("addr");
	const q = $("q");
	const errorEl = $("error");
	const tabs = [];
	let active = null;
	let nextId = 1;

	const isFrameView = (tab) => tab.view === "web" || tab.view === "game";

	function setIcon(tab, html) {
		tab.iconImg = null;
		tab.iconEl.innerHTML = html;
	}

	function renderTab(tab) {
		const isActive = tab === active;
		tab.el.classList.toggle("active", isActive);
		tab.el.setAttribute("aria-selected", String(isActive));
		tab.el.tabIndex = isActive ? 0 : -1;
		tab.titleEl.textContent = tab.title;
		tab.el.title = tab.title;

		const fallback = tab.view === "game" || tab.view === "games" ? PAD : tab.view === "home" ? SPARK : GLOBE;
		if (!isFrameView(tab) || !tab.icon) {
			setIcon(tab, fallback);
		} else if (!tab.iconImg || tab.iconImg.dataset.src !== tab.icon) {
			const img = new Image();
			img.alt = "";
			img.dataset.src = tab.icon;
			img.onerror = () => { if (tab.icon === img.dataset.src) { tab.icon = null; setIcon(tab, fallback); } };
			img.src = tab.icon;
			tab.iconImg = img;
			tab.iconEl.replaceChildren(img);
		}
	}

	function makeTab() {
		const tab = { id: nextId++, view: "home", url: null, game: null, title: "New Tab", icon: null, iconImg: null, frame: null };
		const el = document.createElement("div");
		el.className = "tab";
		el.setAttribute("role", "tab");
		el.innerHTML = '<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-close" type="button" aria-label="Close tab" title="Close tab">' + CLOSE + "</button>";
		tab.el = el;
		tab.iconEl = el.querySelector(".tab-icon");
		tab.titleEl = el.querySelector(".tab-title");

		el.addEventListener("click", (e) => { if (!e.target.closest(".tab-close")) activate(tab); });
		el.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(tab); }
			if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
				const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
				if (tabs[i]) { activate(tabs[i]); tabs[i].el.focus(); }
			}
		});
		el.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab); });

		tabsEl.appendChild(el);
		tabs.push(tab);
		return tab;
	}

	function newTab(url) {
		const tab = makeTab();
		activate(tab);
		tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
		if (url) navigate(tab, url);
		else q.focus();
		return tab;
	}

	function addrText(tab) {
		if (tab.view === "web") return tab.url || "";
		if (tab.view === "game") return "games/" + (tab.game ? tab.game.id : "");
		return "";
	}

	function activate(tab) {
		active = tab;
		for (const t of tabs) {
			if (t.frame) t.frame.frame.hidden = t !== tab || !isFrameView(t);
			renderTab(t);
		}
		const onPage = !isFrameView(tab);
		home.hidden = !onPage;
		homeMain.hidden = tab.view !== "home";
		gamesMain.hidden = tab.view !== "games";
		gamesBtn.setAttribute("aria-pressed", String(tab.view === "games"));
		setStarsVisible(onPage);
		if (document.activeElement !== addr) addr.value = addrText(tab);
		updateNav();
		if (tab.view === "games") loadGames();
	}

	function dropFrame(tab) {
		if (tab.frame) { tab.frame.frame.remove(); tab.frame = null; }
	}

	function closeTab(tab) {
		const i = tabs.indexOf(tab);
		if (i < 0) return;
		dropFrame(tab);
		tab.el.remove();
		tabs.splice(i, 1);
		if (!tabs.length) { newTab(); return; }
		if (tab === active) activate(tabs[Math.min(i, tabs.length - 1)]);
	}

	function setPage(tab, view) {
		dropFrame(tab);
		tab.view = view;
		tab.url = null;
		tab.game = null;
		tab.icon = null;
		tab.title = view === "games" ? "Games" : "New Tab";
		if (tab === active) activate(tab);
		else renderTab(tab);
	}

	function goHome(tab) {
		setPage(tab, "home");
		if (tab === active) q.focus();
	}

	function showError(msg) {
		errorEl.textContent = msg || "";
		errorEl.hidden = !msg;
	}

	// YouTube workaround: when YouTube switches to a video inside the same page (clicking a video from the
	// home page, search or the side list), the browser tab crashes under Scramjet 1.x ("This page is having a
	// problem" / STATUS_BREAKPOINT). Opening the same video page fresh works fine. So on youtube.com, a plain
	// click on a video link loads that video page fresh instead of letting YouTube switch to it in place.
	const YT_VIDEO_PATH = /^\/(watch|shorts\/|live\/)/;
	const guardedWindows = new WeakSet();
	function youTubeVideoUrl(u) {
		try {
			const url = new URL(realUrl(u));
			return /(^|\.)youtube\.com$/.test(url.hostname) && YT_VIDEO_PATH.test(url.pathname) ? url.href : null;
		} catch (e) {
			return null;
		}
	}
	function guardYouTube(tab, f) {
		let win;
		try {
			win = f.frame.contentWindow;
			if (!win || guardedWindows.has(win) || !/(^|\.)youtube\.com$/.test(new URL(realUrl(win.location.href)).hostname)) return;
		} catch (e) {
			return;
		}
		guardedWindows.add(win);
		win.addEventListener("click", (e) => {
			if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
			const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
			const video = a && youTubeVideoUrl(a.href);
			if (!video || tab.frame !== f) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			f.go(video);
		}, true);
	}

	function makeProxyFrame(tab) {
		const f = scramjet.createFrame();
		f.kind = "proxy";
		f.frame.className = "sj-frame";
		f.frame.title = "Page";
		f.addEventListener("urlchange", (e) => {
			if (tab.frame !== f) return;
			tab.url = realUrl(e.url);
			if (tab === active && document.activeElement !== addr) addr.value = tab.url;
			readMeta(tab);
			guardYouTube(tab, f);
		});
		f.frame.addEventListener("load", () => {
			if (tab.frame !== f) return;
			readMeta(tab);
			guardYouTube(tab, f);
		});
		viewport.appendChild(f.frame);
		return f;
	}

	// Games run straight from ROKI's server, not through the proxy
	function makeGameFrame(tab) {
		const iframe = document.createElement("iframe");
		iframe.className = "sj-frame game-frame";
		iframe.title = "Game";
		iframe.setAttribute("allow", "fullscreen; autoplay; gamepad");
		iframe.allowFullscreen = true;
		const f = {
			kind: "game",
			frame: iframe,
			go(url) { iframe.src = url; },
			back() { try { iframe.contentWindow.history.back(); } catch (e) {} },
			forward() { try { iframe.contentWindow.history.forward(); } catch (e) {} },
			reload() { try { iframe.contentWindow.location.reload(); } catch (e) { iframe.src = iframe.src; } },
		};
		iframe.addEventListener("load", () => {
			if (tab.frame !== f) return;
			readMeta(tab);
			if (tab === active) iframe.focus();
		});
		viewport.appendChild(iframe);
		return f;
	}

	function openGame(tab, game) {
		dropFrame(tab);
		tab.frame = makeGameFrame(tab);
		tab.view = "game";
		tab.game = game;
		tab.url = game.url;
		tab.title = game.name;
		tab.icon = game.cover || null;
		tab.frame.go(game.url);
		if (tab === active) activate(tab);
		else renderTab(tab);
	}

	async function navigate(tab, input) {
		const text = String(input || "").trim();
		if (!text) return;
		let url = search(text, engines[engine]);
		// search.js adds http:// to bare domains; prefer https
		if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && url.startsWith("http://")) url = "https://" + url.slice(7);
		showError("");
		try {
			await ensureProxy();
		} catch (err) {
			let msg = "Couldn't start the proxy. " + (err && err.message ? err.message : String(err));
			if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
				msg += "\nOpen ROKI over https:// (or at localhost) so the proxy can start.";
			}
			if (tab === active && tab.view !== "home") goHome(tab);
			showError(msg);
			return;
		}
		if (!tabs.includes(tab)) return;
		if (tab.frame && tab.frame.kind !== "proxy") dropFrame(tab);
		if (!tab.frame) tab.frame = makeProxyFrame(tab);
		tab.view = "web";
		tab.game = null;
		tab.url = url;
		tab.title = hostOf(url);
		tab.icon = null;
		tab.frame.go(url);
		if (tab === active) activate(tab);
		else renderTab(tab);
	}

	function readMeta(tab) {
		if (!tab.frame || !isFrameView(tab)) return;
		let changed = false;
		try {
			const doc = tab.frame.frame.contentDocument;
			if (doc) {
				const title = (doc.title || "").trim();
				if (title && title !== tab.title) { tab.title = title; changed = true; }
				if (tab.view === "web") {
					const link = doc.querySelector('link[rel~="icon"]');
					const icon = link && link.getAttribute("href") ? proxiedAsset(link.href) : proxiedAsset(new URL("/favicon.ico", tab.url).href);
					if (icon && icon !== tab.icon) { tab.icon = icon; changed = true; }
				}
			}
		} catch (e) {}
		if (!tab.title || tab.title === "New Tab") {
			tab.title = tab.view === "game" && tab.game ? tab.game.name : hostOf(tab.url);
			changed = true;
		}
		if (changed) renderTab(tab);
	}
	setInterval(() => {
		for (const t of tabs) {
			readMeta(t);
			if (t.frame && t.frame.kind === "proxy") guardYouTube(t, t.frame);
		}
	}, 2000);

	function updateNav() {
		const has = !!(active && active.frame && isFrameView(active));
		$("back").disabled = !has;
		$("forward").disabled = !has;
		$("reload").disabled = !has;
		$("fullscreen").hidden = !(active && active.view === "game");
	}

	$("new-tab").addEventListener("click", () => newTab());
	$("back").addEventListener("click", () => active.frame && active.frame.back());
	$("forward").addEventListener("click", () => active.frame && active.frame.forward());
	$("reload").addEventListener("click", () => active.frame && active.frame.reload());
	$("go-home").addEventListener("click", () => goHome(active));
	$("fullscreen").addEventListener("click", () => {
		const el = active.frame && active.frame.frame;
		if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
	});

	$("addr-form").addEventListener("submit", (e) => {
		e.preventDefault();
		const value = addr.value;
		addr.blur();
		navigate(active, value);
	});
	addr.addEventListener("focus", () => addr.select());
	addr.addEventListener("keydown", (e) => {
		if (e.key === "Escape") { addr.value = addrText(active); addr.blur(); }
	});

	$("home-form").addEventListener("submit", (e) => {
		e.preventDefault();
		const value = q.value;
		q.value = "";
		navigate(active, value);
	});

	// Shortcut logos: if a site's logo can't load, show its letters instead
	document.querySelectorAll(".tile-logo").forEach((img) => {
		const fail = () => img.parentElement.classList.add("no-logo");
		if (img.complete && !img.naturalWidth) fail();
		else img.addEventListener("error", fail, { once: true });
	});
	document.querySelectorAll(".tile").forEach((tile) => {
		tile.addEventListener("click", () => navigate(active, tile.dataset.url));
		tile.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); newTab(tile.dataset.url); } });
	});

	/* ---------- Games list (from public/games via /games/list.json) ---------- */
	const gameGrid = $("game-grid");
	const gamesEmpty = $("games-empty");
	const gamesStatus = $("games-status");
	const gamesCount = $("games-count");
	let gamesLoading = null;

	function gameCard(game) {
		const li = document.createElement("li");
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "game-card";
		const cover = document.createElement("span");
		cover.className = "game-cover";
		cover.setAttribute("aria-hidden", "true");
		if (game.cover) {
			const img = new Image();
			img.alt = "";
			img.onerror = () => { img.remove(); cover.textContent = initials(game.name); };
			img.src = game.cover;
			cover.appendChild(img);
		} else {
			cover.textContent = initials(game.name);
		}
		const name = document.createElement("span");
		name.className = "game-name";
		name.textContent = game.name;
		btn.append(cover, name);
		btn.addEventListener("click", () => openGame(active, game));
		btn.addEventListener("auxclick", (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			const t = makeTab();
			activate(t);
			openGame(t, game);
		});
		li.appendChild(btn);
		return li;
	}

	function renderGames(games) {
		gamesStatus.hidden = true;
		gameGrid.replaceChildren(...games.map(gameCard));
		gameGrid.hidden = games.length === 0;
		gamesEmpty.hidden = games.length > 0;
		gamesCount.textContent = games.length === 1 ? "1 game" : games.length + " games";
	}

	function loadGames() {
		if (gamesLoading) return gamesLoading;
		gamesLoading = (async () => {
			try {
				const res = await fetch("/games/list.json", { cache: "no-store" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				const games = (Array.isArray(data.games) ? data.games : []).filter(
					(g) => g && typeof g.name === "string" && typeof g.url === "string" && g.url.startsWith("/games/"),
				);
				renderGames(games);
			} catch (e) {
				gamesStatus.textContent = "Couldn't load your games. Reload ROKI and try again.";
				gamesStatus.hidden = false;
			} finally {
				gamesLoading = null;
			}
		})();
		return gamesLoading;
	}

	gamesBtn.addEventListener("click", () => {
		if (active.view === "games") goHome(active);
		else setPage(active, "games");
	});

	/* ---------- Clock ---------- */
	const clockEl = $("clock");
	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
	function tick() { const now = new Date(); clockEl.textContent = timeFmt.format(now) + " · " + dateFmt.format(now); }
	tick();
	setInterval(tick, 1000);

	/* ---------- Panels ---------- */
	const panels = [["effects-btn", "effects-panel"], ["settings-btn", "settings-panel"]]
		.map(([b, p]) => ({ btn: $(b), panel: $(p) }));
	function closePanels(except) {
		panels.forEach((x) => { if (x !== except) { x.panel.hidden = true; x.btn.setAttribute("aria-expanded", "false"); } });
	}
	panels.forEach((x) => x.btn.addEventListener("click", (e) => {
		e.stopPropagation();
		const open = x.panel.hidden;
		closePanels(x);
		x.panel.hidden = !open;
		x.btn.setAttribute("aria-expanded", String(open));
	}));
	document.addEventListener("click", (e) => { if (!e.target.closest(".panel")) closePanels(); });
	document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanels(); });

	document.querySelectorAll('input[name="engine"]').forEach((r) => {
		r.checked = r.value === engine;
		r.addEventListener("change", () => { engine = r.value; store.set("engine", engine); });
	});

	const autoWipeEl = $("auto-wipe");
	autoWipeEl.checked = store.get("auto-wipe", true);
	autoWipeEl.addEventListener("change", () => store.set("auto-wipe", autoWipeEl.checked));

	$("wipe-now").addEventListener("click", async () => {
		const btn = $("wipe-now");
		btn.disabled = true;
		btn.textContent = "Wiping…";
		for (const t of tabs) if (t.view === "web") dropFrame(t);
		await wipeSiteData();
		btn.textContent = "Wiped. Restarting…";
		setTimeout(() => location.reload(), 600);
	});

	/* ---------- about:blank cloak ---------- */
	// Opens ROKI inside a blank tab so the address bar shows "about:blank" instead of ROKI's link,
	// then sends this tab to Google so the link isn't left on screen.
	const CLOAK_EXIT = "https://www.google.com";
	const cloakBtn = $("cloak-btn");
	const cloakNote = $("cloak-note");
	let inCloak = false;
	try { inCloak = window.top !== window && window.top.location.href === "about:blank"; } catch (e) {}
	if (inCloak) {
		cloakBtn.disabled = true;
		cloakBtn.textContent = "Link hidden (in about:blank)";
	}

	// Returns true once ROKI has moved into the blank tab; otherwise shows why in noteEl
	function openCloak(noteEl) {
		noteEl.hidden = true;
		const win = window.open("about:blank", "_blank");
		if (!win) {
			noteEl.textContent = "Your browser blocked the new tab. Allow pop-ups for ROKI, then try again.";
			noteEl.hidden = false;
			return false;
		}
		try {
			const doc = win.document;
			const style = doc.createElement("style");
			style.textContent = "html,body{margin:0;height:100%;overflow:hidden;background:#07070d}iframe{display:block;width:100%;height:100%;border:0}";
			doc.head.appendChild(style);
			const icon = doc.createElement("link");
			icon.rel = "icon";
			icon.href = location.origin + "/favicon.ico";
			doc.head.appendChild(icon);
			const frame = doc.createElement("iframe");
			frame.src = location.origin + "/";
			frame.setAttribute("allow", "fullscreen; autoplay; gamepad; clipboard-write");
			frame.allowFullscreen = true;
			doc.body.appendChild(frame);
		} catch (e) {
			win.close();
			noteEl.textContent = "Couldn't set up the hidden tab. Try again.";
			noteEl.hidden = false;
			return false;
		}
		location.replace(CLOAK_EXIT);
		return true;
	}
	cloakBtn.addEventListener("click", () => openCloak(cloakNote));

	// Opened from a friend launcher (ROKI link + #cloak): one tap moves ROKI into about:blank.
	// Browsers only allow a new tab after a tap or click, so it can't happen on its own.
	if (location.hash === "#cloak") {
		try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
		if (!inCloak) {
			const gate = $("cloak-gate");
			gate.hidden = false;
			$("cloak-gate-btn").addEventListener("click", () => {
				if (openCloak($("cloak-gate-note"))) gate.hidden = true;
			});
		}
	}

	// Settings → "Copy invite link": the secret link that gets a browser into ROKI (/join/<key>)
	async function inviteLink() {
		const res = await fetch("/invite.json", { cache: "no-store" });
		if (!res.ok) throw new Error("HTTP " + res.status);
		const { path } = await res.json();
		if (typeof path !== "string" || !path.startsWith("/join/")) throw new Error("bad invite");
		return location.origin + path;
	}
	const inviteBtn = $("invite-btn");
	const inviteHint = $("invite-hint");
	const inviteHintText = inviteHint.textContent;
	const onThisPc = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
	if (onThisPc) inviteHint.textContent += " This copy of ROKI runs on your PC, so its link only works on this PC.";
	let inviteTimer = 0;
	inviteBtn.addEventListener("click", async () => {
		clearTimeout(inviteTimer);
		inviteHint.classList.remove("bad");
		let link;
		try {
			link = await inviteLink();
		} catch (e) {
			inviteHint.textContent = "Couldn't get the invite link. Reload ROKI and try again.";
			inviteHint.classList.add("bad");
			return;
		}
		try {
			await navigator.clipboard.writeText(link);
			inviteBtn.textContent = "Copied!";
			inviteTimer = setTimeout(() => { inviteBtn.textContent = "Copy invite link"; }, 2000);
		} catch (e) {
			// Clipboard blocked: show the link so it can be copied by hand
			inviteHint.textContent = link;
			inviteHint.classList.add("invite-link");
			const range = document.createRange();
			range.selectNodeContents(inviteHint);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
			inviteTimer = setTimeout(() => {
				inviteHint.textContent = inviteHintText;
				inviteHint.classList.remove("invite-link");
			}, 30000);
		}
	});

	// Settings → "Download friend launcher": a small .html file with this ROKI's invite link filled in
	const launcherNote = $("launcher-note");
	$("launcher-btn").addEventListener("click", async () => {
		launcherNote.hidden = true;
		try {
			const res = await fetch("/launcher.html", { cache: "no-store" });
			if (!res.ok) throw new Error("HTTP " + res.status);
			const html = (await res.text()).replace("__ROKI_LINK__", await inviteLink());
			const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = "ROKI.html";
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 10000);
		} catch (e) {
			launcherNote.textContent = "Couldn't make the launcher. Reload ROKI and try again.";
			launcherNote.hidden = false;
		}
	});

	/* ---------- Starfield ---------- */
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const fx = { stars: store.get("fx-stars", true), twinkle: store.get("fx-twinkle", !reduce), shooting: store.get("fx-shooting", !reduce) };
	const canvas = $("stars");
	const ctx = canvas.getContext("2d");
	const starColor = getComputedStyle(document.documentElement).getPropertyValue("--star").trim() || "#ffffff";
	let w = 0, h = 0, stars = [], shooters = [], raf = 0, nextShot = 0, starsVisible = true;

	function makeStars() {
		const count = Math.round((w * h) / 5500);
		stars = Array.from({ length: count }, () => ({
			x: Math.random() * w, y: Math.random() * h,
			r: Math.random() * 0.9 + 0.3, a: Math.random() * 0.6 + 0.25,
			s: Math.random() * 1.5 + 0.5, p: Math.random() * Math.PI * 2,
		}));
	}
	function drawShooters(t) {
		if (t > nextShot) {
			shooters.push({ x: w * (0.3 + Math.random() * 0.7), y: Math.random() * h * 0.4, vx: -(6 + Math.random() * 4), vy: 2.5 + Math.random() * 2, life: 0 });
			nextShot = t + 5000 + Math.random() * 7000;
		}
		shooters = shooters.filter((s) => s.life < 60);
		ctx.lineWidth = 1.5;
		for (const s of shooters) {
			s.x += s.vx; s.y += s.vy; s.life++;
			const fade = 1 - s.life / 60;
			const tx = s.x - s.vx * 14, ty = s.y - s.vy * 14;
			const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
			g.addColorStop(0, "rgba(255,255,255," + (0.9 * fade).toFixed(3) + ")");
			g.addColorStop(1, "rgba(255,255,255,0)");
			ctx.strokeStyle = g;
			ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
		}
	}
	function draw(t) {
		ctx.clearRect(0, 0, w, h);
		if (!fx.stars) return;
		ctx.fillStyle = starColor;
		for (const s of stars) {
			const tw = fx.twinkle ? 0.55 + 0.45 * Math.sin((t / 1000) * s.s + s.p) : 1;
			ctx.globalAlpha = s.a * tw;
			ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
		}
		ctx.globalAlpha = 1;
		if (fx.shooting) drawShooters(t);
	}
	function loop(t) { draw(t); raf = requestAnimationFrame(loop); }
	function restartStars() {
		cancelAnimationFrame(raf); raf = 0;
		shooters = [];
		nextShot = performance.now() + 1500;
		if (!starsVisible) return;
		if (fx.stars && (fx.twinkle || fx.shooting)) raf = requestAnimationFrame(loop);
		else draw(performance.now());
	}
	function setStarsVisible(on) {
		if (on === starsVisible) return;
		starsVisible = on;
		restartStars();
	}
	function resize() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		w = window.innerWidth; h = window.innerHeight;
		canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		makeStars();
		draw(performance.now());
	}
	["stars", "twinkle", "shooting"].forEach((k) => {
		const el = $("fx-" + k);
		el.checked = fx[k];
		el.addEventListener("change", () => { fx[k] = el.checked; store.set("fx-" + k, fx[k]); restartStars(); });
	});
	window.addEventListener("resize", resize);
	resize();
	restartStars();

	/* ---------- Start ---------- */
	newTab();
	ensureProxy().catch(() => {}); // warm up so the first search is quick; errors show on first use
})();
