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
	const GRID = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>';
	const SCREEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
	const CHAT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>';
	const SHIELD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/></svg>';
	const SLIDERS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
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
	// Each tab shows one of ROKI's own pages ("home", "games", "apps", "media", "chat", "settings"),
	// "web" (a site through the proxy) or "game" (a game from public/games).
	const PAGES = { home: "New Tab", games: "Games", apps: "Apps", media: "Media", chat: "Chat", settings: "Settings", admin: "Admin" };
	const PAGE_ICONS = { home: SPARK, games: PAD, apps: GRID, media: SCREEN, chat: CHAT, settings: SLIDERS, admin: SHIELD };
	const tabsEl = $("tabs");
	const viewport = $("viewport");
	const home = $("home");
	const pageEls ={ home: $("home-main"), games: $("games-main"), apps: $("apps-main"), media: $("media-main"), chat: $("chat-main"), settings: $("settings-main"), admin: $("admin-main") };
	const navLinks = [...document.querySelectorAll(".topnav-link")];
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

		const fallback = tab.view === "game" ? PAD : PAGE_ICONS[tab.view] || GLOBE;
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
		for (const [view, el] of Object.entries(pageEls)) el.hidden = tab.view !== view;
		navLinks.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.page === tab.view)));
		if (onPage) home.scrollTop = 0;
		setStarsVisible(onPage);
		if (document.activeElement !== addr) addr.value = addrText(tab);
		updateNav();
		if (tab.view === "games") loadGames();
		// chat.js listens for this to connect, mark messages read and focus its message box
		document.dispatchEvent(new CustomEvent("roki:page", { detail: tab.view }));
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
		tab.title = PAGES[view] || "New Tab";
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

	function makeProxyFrame(tab) {
		const f = scramjet.createFrame();
		f.kind = "proxy";
		f.frame.className = "sj-frame";
		f.frame.title = "Page";
		f.addEventListener("urlchange", (e) => {
			if (tab.frame !== f) return;
			tab.url = realUrl(e.url);
			if (tab === active && document.activeElement !== addr) addr.value = addrText(tab);
			readMeta(tab);
		});
		f.frame.addEventListener("load", () => { if (tab.frame === f) readMeta(tab); });
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

	// Starts the proxy if it isn't yet; on failure goes home and says why
	async function startProxyFor(tab) {
		showError("");
		try {
			await ensureProxy();
			return tabs.includes(tab);
		} catch (err) {
			let msg = "Couldn't start the proxy. " + (err && err.message ? err.message : String(err));
			if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
				msg += "\nOpen ROKI over https:// (or at localhost) so the proxy can start.";
			}
			if (tab === active && tab.view !== "home") goHome(tab);
			showError(msg);
			return false;
		}
	}

	// "Play online" games open in ROKI's game screen, like the games saved in ROKI: the tab shows the
	// game's name, the address bar shows games/<name> and full screen works. The game itself still comes
	// from its own site, through the proxy.
	const gameId = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "game";
	async function openOnlineGame(tab, app) {
		if (!(await startProxyFor(tab))) return;
		if (tab.frame && tab.frame.kind !== "proxy") dropFrame(tab);
		if (!tab.frame) tab.frame = makeProxyFrame(tab);
		tab.view = "game";
		tab.game = { id: gameId(app.name), name: app.name, url: app.url, online: true };
		tab.url = app.url;
		tab.title = app.name;
		tab.icon = "/site-icon?d=" + encodeURIComponent(app.domain) + "&v=3";
		tab.frame.go(app.url);
		if (tab === active) activate(tab);
		else renderTab(tab);
	}

	async function navigate(tab, input) {
		const text = String(input || "").trim();
		if (!text) return;
		let url = search(text, engines[engine]);
		// search.js adds http:// to bare domains; prefer https
		if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && url.startsWith("http://")) url = "https://" + url.slice(7);
		if (!(await startProxyFor(tab))) return;
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
				// An online game keeps its own name in the tab, like the games saved in ROKI
				if (title && title !== tab.title && !(tab.game && tab.game.online)) { tab.title = title; changed = true; }
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
	setInterval(() => { for (const t of tabs) readMeta(t); }, 2000);

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

	/* ---------- App tiles (home, Apps, Media) from catalog.js ---------- */
	// Each tile shows the site's own icon (loaded live through ROKI's server) on the site's color.
	// If the icon can't load, the site's initials show instead.
	const catalog = window.ROKI_CATALOG || { featured: [], apps: [], media: [] };
	function appTile(app) {
		const li = document.createElement("li");
		const btn = document.createElement("button");
		btn.type = "button";
		btn.title = app.name;
		fillAppTile(btn, app);
		btn.addEventListener("click", () => navigate(active, app.url));
		btn.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); newTab(app.url); } });
		li.appendChild(btn);
		return li;
	}
	// The site's icon on its color, with its name. Game tiles fall back to this when there's no picture.
	function fillAppTile(btn, app) {
		btn.className = "app-tile" + (app.dark ? " dark-text" : "");
		btn.style.setProperty("--tile-bg", app.bg || "");
		const img = new Image();
		img.className = "app-icon";
		img.alt = "";
		img.decoding = "async";
		img.loading = "lazy";
		img.onerror = () => {
			const letters = document.createElement("span");
			letters.className = "app-letters";
			letters.setAttribute("aria-hidden", "true");
			letters.textContent = initials(app.name);
			img.replaceWith(letters);
		};
		// Big icons fill their tile; a small one (some sites only have 32px) would look blurry stretched,
		// so it sits in the middle at a size where it stays sharp
		img.onload = () => {
			if (img.naturalWidth && img.naturalWidth < 128) {
				btn.classList.add("small-icon");
				btn.style.setProperty("--icon-px", Math.max(img.naturalWidth * 2, 40) + "px");
			}
		};
		img.src = "/site-icon?d=" + encodeURIComponent(app.domain) + "&v=3"; // v: new, sharper icons
		const name = document.createElement("span");
		name.className = "app-name";
		name.textContent = app.name;
		btn.replaceChildren(img, name);
	}
	// Initials on a plain tile, with the name (a ROKI game with no cover picture)
	function fillLetterTile(btn, label) {
		btn.className = "app-tile";
		const letters = document.createElement("span");
		letters.className = "app-letters";
		letters.setAttribute("aria-hidden", "true");
		letters.textContent = initials(label);
		const name = document.createElement("span");
		name.className = "app-name";
		name.textContent = label;
		btn.replaceChildren(letters, name);
	}

	// Game tiles: the game's picture fills the tile and its name shows on hover.
	// onFail(btn) turns the tile into something else if the picture can't load.
	function artButton(label, src, onFail) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "art-tile";
		btn.title = label;
		const blur = document.createElement("span");
		blur.className = "art-blur";
		blur.setAttribute("aria-hidden", "true");
		const img = new Image();
		img.className = "art-img";
		img.alt = "";
		img.decoding = "async";
		img.loading = "lazy";
		img.onload = () => {
			// Wide pictures (most link previews) fit inside the square, on a blurred copy of themselves
			if (img.naturalWidth > img.naturalHeight * 1.2) {
				btn.classList.add("wide");
				blur.style.backgroundImage = `url("${img.src}")`;
			}
		};
		img.onerror = () => onFail(btn);
		img.src = src;
		const name = document.createElement("span");
		name.className = "art-name";
		name.textContent = label;
		btn.append(blur, img, name);
		return btn;
	}
	function onlineGameTile(app) {
		const li = document.createElement("li");
		const btn = artButton(app.name, "/game-art?u=" + encodeURIComponent(app.url), (b) => fillAppTile(b, app));
		btn.addEventListener("click", () => openOnlineGame(active, app));
		btn.addEventListener("auxclick", (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			const t = makeTab();
			activate(t);
			openOnlineGame(t, app);
		});
		li.appendChild(btn);
		return li;
	}
	function domainOf(url) {
		try {
			return new URL(url).hostname.replace(/^www\./, "");
		} catch (e) {
			return "";
		}
	}
	const allApps = [...catalog.apps, ...catalog.media];
	$("feature-grid").replaceChildren(
		...catalog.featured.map((n) => allApps.find((a) => a.name === n)).filter(Boolean).map(appTile),
	);

	// Apps and Media pages: a grid with a search box that filters it
	function appPage(list, gridId, searchId, emptyId, noun) {
		const grid = $(gridId);
		const search = $(searchId);
		const empty = $(emptyId);
		const items = list.map((app) => ({ app, el: appTile(app) }));
		grid.replaceChildren(...items.map((x) => x.el));
		search.placeholder = `Search through ${list.length} ${noun}`;
		search.addEventListener("input", () => {
			const term = search.value.trim().toLowerCase();
			let shown = 0;
			for (const x of items) {
				const hit = !term || x.app.name.toLowerCase().includes(term) || x.app.domain.includes(term);
				x.el.hidden = !hit;
				if (hit) shown++;
			}
			empty.hidden = shown > 0;
		});
		search.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			const first = items.find((x) => !x.el.hidden);
			if (first) navigate(active, first.app.url);
		});
	}
	appPage(catalog.apps, "apps-grid", "apps-search", "apps-nomatch", "apps");
	appPage(catalog.media, "media-grid", "media-search", "media-nomatch", "video and music sites");

	// Top bar: ROKI goes home; the links open their page in this tab (again to go back home)
	$("nav-home").addEventListener("click", () => goHome(active));
	navLinks.forEach((b) => b.addEventListener("click", () => {
		if (active.view === b.dataset.page) goHome(active);
		else setPage(active, b.dataset.page);
	}));

	/* ---------- Games list (from public/games via /games/list.json) ---------- */
	const gameGrid = $("game-grid");
	const gamesEmpty = $("games-empty");
	const gamesStatus = $("games-status");
	let gamesLoading = null;

	function gameCard(game) {
		const li = document.createElement("li");
		let btn;
		if (game.cover) {
			btn = artButton(game.name, game.cover, (b) => fillLetterTile(b, game.name));
		} else {
			btn = document.createElement("button");
			btn.type = "button";
			btn.title = game.name;
			fillLetterTile(btn, game.name);
		}
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

	// The Games page has two parts: games saved in ROKI (public/games) and "Play online" (catalog.js),
	// both filtered by the search box and sorted by the menu next to it.
	const gamesSearch = $("games-search");
	const gamesSort = $("games-sort");
	const gamesNoMatch = $("games-nomatch");
	const localTitle = $("local-games-title");
	const onlineTitle = $("online-games-title");
	const onlineGrid = $("online-games");
	const onlineGames = (catalog.games || [])
		.map((g) => ({ ...g, domain: g.domain || domainOf(g.url) }))
		.map((app) => ({ app, el: onlineGameTile(app) }));
	let allGames = [];
	function showGames() {
		const term = gamesSearch.value.trim().toLowerCase();
		const dir = gamesSort.value === "za" ? -1 : 1;
		const list = allGames
			.filter((g) => !term || g.name.toLowerCase().includes(term))
			.sort((a, b) => a.name.localeCompare(b.name) * dir);
		gameGrid.replaceChildren(...list.map(gameCard));
		gameGrid.hidden = localTitle.hidden = list.length === 0;
		const online = onlineGames
			.filter((x) => !term || x.app.name.toLowerCase().includes(term))
			.sort((a, b) => a.app.name.localeCompare(b.app.name) * dir);
		onlineGrid.replaceChildren(...online.map((x) => x.el));
		onlineGrid.hidden = onlineTitle.hidden = online.length === 0;
		gamesEmpty.hidden = allGames.length > 0 || Boolean(term);
		gamesNoMatch.hidden = !(term && list.length === 0 && online.length === 0);
	}
	function renderGames(games) {
		gamesStatus.hidden = true;
		allGames = games;
		const n = games.length + onlineGames.length;
		gamesSearch.placeholder = `Search through ${n} game${n === 1 ? "" : "s"}`;
		gamesSort.options[0].textContent = `A to Z (${n})`;
		gamesSort.options[1].textContent = `Z to A (${n})`;
		showGames();
	}
	gamesSearch.addEventListener("input", showGames);
	gamesSort.addEventListener("change", showGames);

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
				showGames(); // "Play online" still works
			} finally {
				gamesLoading = null;
			}
		})();
		return gamesLoading;
	}


	/* ---------- Clock (top bar) and date (home page) ---------- */
	const clockEl = $("clock");
	const dateEl = $("hero-date");
	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
	function tick() {
		const now = new Date();
		clockEl.textContent = timeFmt.format(now);
		dateEl.textContent = dateFmt.format(now);
	}
	tick();
	setInterval(tick, 1000);

	/* ---------- Settings (the window itself, themes, tab cloak and Prevent Close are in settings.js) ---------- */
	const engineEl = $("engine");
	engineEl.value = engine;
	engineEl.addEventListener("change", () => { engine = engineEl.value; store.set("engine", engine); });

	// Ad block: the service worker (sw.js) reads this switch from the "roki-config" cache
	const adblockEl = $("adblock");
	adblockEl.checked = store.get("adblock", true);
	async function sendAdblock() {
		try {
			const cache = await caches.open("roki-config");
			await cache.put("/__roki/adblock", new Response(adblockEl.checked ? "1" : "0"));
		} catch (e) {}
		try {
			const reg = await navigator.serviceWorker.getRegistration();
			for (const w of [reg && reg.active, navigator.serviceWorker.controller]) if (w) w.postMessage({ type: "roki-adblock", on: adblockEl.checked });
		} catch (e) {}
	}
	adblockEl.addEventListener("change", () => { store.set("adblock", adblockEl.checked); sendAdblock(); });
	sendAdblock();

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
		window.__rokiLeaving = true; // no "Leave site?" question for this
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
		cloakBtn.textContent = "Already hidden in about:blank";
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
		window.__rokiLeaving = true; // no "Leave site?" question for this
		location.replace(CLOAK_EXIT);
		return true;
	}
	cloakBtn.addEventListener("click", () => openCloak(cloakNote));
	$("corner-cloak").addEventListener("click", () => {
		if (inCloak) return;
		if (!openCloak(cloakNote)) setPage(active, "settings");
	});
	$("corner-panic").addEventListener("click", () => { if (window.rokiPanic) window.rokiPanic(); });

	// "Open it every time" (Settings > About:blank) and the friend launcher (ROKI link + #cloak):
	// ROKI moves itself into about:blank. Browsers only allow that new tab right away if pop-ups are
	// allowed for ROKI; otherwise one tap on the cover screen does it.
	const cloakAutoEl = $("cloak-auto");
	cloakAutoEl.checked = store.get("cloak-auto", false) === true;
	cloakAutoEl.addEventListener("change", () => store.set("cloak-auto", cloakAutoEl.checked));
	const fromLauncher = location.hash === "#cloak";
	if (fromLauncher) {
		try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
	}
	if (!inCloak && (fromLauncher || cloakAutoEl.checked)) {
		const gate = $("cloak-gate");
		const gateNote = $("cloak-gate-note");
		if (!(cloakAutoEl.checked && openCloak(gateNote))) {
			gateNote.hidden = true;
			gate.hidden = false;
			$("cloak-gate-btn").addEventListener("click", () => {
				if (openCloak(gateNote)) gate.hidden = true;
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

	/* ---------- Save data: export / import ROKI's settings ---------- */
	// Everything ROKI saves in this browser is under "roki:" in localStorage (sites' own data isn't).
	const dataStatus = $("data-status");
	function say(text, bad) {
		dataStatus.textContent = text;
		dataStatus.classList.toggle("bad", !!bad);
	}
	$("export-btn").addEventListener("click", () => {
		const data = {};
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.startsWith("roki:") && k !== SESSION_KEY) data[k] = localStorage.getItem(k);
			}
		} catch (e) {
			say("Couldn't read ROKI's settings in this browser.", true);
			return;
		}
		const file = JSON.stringify({ format: "roki-settings", version: 1, exported: new Date().toISOString(), data }, null, "\t");
		const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "roki-settings.json";
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
		say(`Saved ${Object.keys(data).length} settings to roki-settings.json.`);
	});
	const importFile = $("import-file");
	$("import-btn").addEventListener("click", () => importFile.click());
	importFile.addEventListener("change", async () => {
		const file = importFile.files && importFile.files[0];
		importFile.value = "";
		if (!file) return;
		try {
			if (file.size > 200000) throw new Error("too big");
			const parsed = JSON.parse(await file.text());
			if (!parsed || parsed.format !== "roki-settings" || typeof parsed.data !== "object") throw new Error("not ROKI");
			const entries = Object.entries(parsed.data).filter(
				([k, v]) => k.startsWith("roki:") && k !== SESSION_KEY && typeof v === "string" && v.length < 20000,
			);
			for (const [k, v] of entries) localStorage.setItem(k, v);
			say(`Loaded ${entries.length} settings. Restarting ROKI…`);
			window.__rokiLeaving = true; // no "Leave site?" question for this
			setTimeout(() => location.reload(), 800);
		} catch (e) {
			say("That file isn't a ROKI settings file (roki-settings.json).", true);
		}
	});

	/* ---------- Starfield ---------- */
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const fx = { stars: store.get("fx-stars", true), twinkle: store.get("fx-twinkle", !reduce), shooting: store.get("fx-shooting", !reduce) };
	const canvas = $("stars");
	const ctx = canvas.getContext("2d");
	// Star color comes from the theme (--star-rgb: "r, g, b"); settings.js says when the theme changes
	let starRgb = "255, 255, 255";
	function readStarColor() {
		starRgb = getComputedStyle(document.documentElement).getPropertyValue("--star-rgb").trim() || "255, 255, 255";
	}
	readStarColor();
	document.addEventListener("roki:theme", () => { readStarColor(); restartStars(); });
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
			g.addColorStop(0, "rgba(" + starRgb + "," + (0.9 * fade).toFixed(3) + ")");
			g.addColorStop(1, "rgba(" + starRgb + ",0)");
			ctx.strokeStyle = g;
			ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
		}
	}
	function draw(t) {
		ctx.clearRect(0, 0, w, h);
		if (!fx.stars) return;
		ctx.fillStyle = "rgb(" + starRgb + ")";
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
