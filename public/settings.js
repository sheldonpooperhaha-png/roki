"use strict";
// ROKI's Settings page parts that change the whole tab: color themes, the tab cloak
// ("Tab appearance") and Prevent Close ("Ask before closing the tab").
(() => {
	const $ = (id) => document.getElementById(id);
	const store = {
		get(k, d) { try { const v = localStorage.getItem("roki:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
		set(k, v) { try { localStorage.setItem("roki:" + k, JSON.stringify(v)); } catch (e) {} },
	};

	/* ---------- Themes ---------- */
	// The colors live in roki.css under :root[data-theme="..."]; "legacy" is the plain :root.
	const THEMES = [
		["legacy", "Legacy"],
		["blue", "Blue"],
		["midnight", "Midnight"],
		["forest", "Forest"],
		["sunset", "Sunset"],
		["contrast", "High Contrast"],
	];
	const themeEl = $("theme");
	themeEl.innerHTML = THEMES.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
	function applyTheme(t) {
		if (t === "legacy") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", t);
	}
	let theme = store.get("theme", "legacy");
	if (!THEMES.some(([v]) => v === theme)) theme = "legacy";
	themeEl.value = theme;
	applyTheme(theme);
	themeEl.addEventListener("change", () => {
		theme = themeEl.value;
		store.set("theme", theme);
		applyTheme(theme);
	});

	/* ---------- Tab appearance (tab cloak) ---------- */
	// Changes the tab's name and icon so it looks like another site. The icon is that site's own,
	// loaded live through ROKI's server.
	const PRESETS = [
		{ label: "Google Classroom", title: "Classes", site: "classroom.google.com" },
		{ label: "Google Docs", title: "Untitled document - Google Docs", site: "docs.google.com" },
		{ label: "Google Drive", title: "My Drive - Google Drive", site: "drive.google.com" },
		{ label: "Gmail", title: "Inbox - Gmail", site: "mail.google.com" },
		{ label: "Google Search", title: "Google", site: "google.com" },
		{ label: "Canvas", title: "Dashboard", site: "canvas.instructure.com" },
		{ label: "Clever", title: "Clever | Portal", site: "clever.com" },
		{ label: "Khan Academy", title: "Khan Academy", site: "khanacademy.org" },
		{ label: "Quizlet", title: "Quizlet", site: "quizlet.com" },
		{ label: "Desmos", title: "Desmos | Graphing Calculator", site: "desmos.com" },
		{ label: "Wikipedia", title: "Wikipedia, the free encyclopedia", site: "wikipedia.org" },
		{ label: "IXL", title: "IXL | Dashboard", site: "ixl.com" },
	];
	const BLANK_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

	const presetEl = $("tab-preset");
	const titleEl = $("tab-title");
	const iconEl = $("tab-icon");
	const whenEl = $("tab-when");
	const statusEl = $("tab-status");
	presetEl.innerHTML = '<option value="">Choose a preset…</option>'
		+ PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join("");

	// "quizlet.com", "https://quizlet.com/latest" → "quizlet.com"
	function siteName(text) {
		const t = String(text || "").trim();
		if (!t) return "";
		try {
			const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : "https://" + t).hostname.toLowerCase();
			return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
		} catch (e) {
			return "";
		}
	}

	// The saved disguise: { title, site } or null when the tab looks like ROKI
	let cloak = store.get("tabcloak", null);
	if (!cloak || typeof cloak !== "object" || typeof cloak.title !== "string") cloak = null;
	let when = store.get("tabcloak-when", "always") === "away" ? "away" : "always";

	function disguise() {
		if (!cloak) return null;
		const site = siteName(cloak.site);
		return {
			title: cloak.title.trim() || site || "Untitled",
			icon: site ? location.origin + "/site-icon?d=" + encodeURIComponent(site) : BLANK_ICON,
		};
	}

	// The tab people see: ROKI itself, or the about:blank tab when ROKI is hidden inside one
	function shownWindow() {
		try {
			if (window.top !== window && window.top.location.href === "about:blank") return window.top;
		} catch (e) {}
		return window;
	}
	function iconLink(doc) {
		let link = doc.querySelector('link[rel~="icon"]');
		if (!link) {
			link = doc.createElement("link");
			link.rel = "icon";
			doc.head.appendChild(link);
		}
		return link;
	}

	const saved = new WeakMap(); // document → its own title and icon, to put back later
	let shown = null; // the disguise on screen right now
	let writing = false;
	function putOn(doc, d) {
		const link = iconLink(doc);
		let s = saved.get(doc);
		if (!s) {
			s = { title: doc.title, href: link.getAttribute("href"), type: link.getAttribute("type"), wrote: null };
			saved.set(doc, s);
		} else if (doc.title !== s.wrote) {
			s.title = doc.title; // the page renamed itself meanwhile: keep that for later
		}
		writing = true;
		if (doc.title !== d.title) doc.title = d.title;
		s.wrote = d.title;
		if (link.getAttribute("href") !== d.icon) {
			link.removeAttribute("type");
			link.setAttribute("href", d.icon);
		}
		writing = false;
	}
	function takeOff(doc) {
		const s = saved.get(doc);
		if (!s) return;
		saved.delete(doc);
		const link = iconLink(doc);
		writing = true;
		doc.title = s.title;
		if (s.href === null) link.removeAttribute("href");
		else link.setAttribute("href", s.href);
		if (s.type) link.setAttribute("type", s.type);
		writing = false;
	}

	function topHasFocus() {
		try { return shownWindow().document.hasFocus(); } catch (e) { return document.hasFocus(); }
	}
	function update() {
		const d = disguise();
		const away = document.visibilityState === "hidden" || !topHasFocus();
		const want = d && (when === "always" || away) ? d : null;
		const doc = shownWindow().document;
		if (want) {
			putOn(doc, want);
			if (doc !== document) takeOff(document);
		} else {
			takeOff(doc);
			if (doc !== document) takeOff(document);
		}
		shown = want;
	}

	// If ROKI changes its own tab name while the disguise is on, put the disguise straight back
	const titleTag = document.querySelector("title");
	if (titleTag) {
		new MutationObserver(() => {
			if (writing || !shown || shownWindow() !== window || !saved.has(document)) return;
			putOn(document, shown);
		}).observe(titleTag, { childList: true, characterData: true, subtree: true });
	}

	function fillFields() {
		titleEl.value = cloak ? cloak.title : "";
		iconEl.value = cloak ? cloak.site : "";
		const i = cloak ? PRESETS.findIndex((p) => p.title === cloak.title && p.site === siteName(cloak.site)) : -1;
		presetEl.value = i >= 0 ? String(i) : "";
	}
	let statusTimer = 0;
	function status(text) {
		clearTimeout(statusTimer);
		statusEl.textContent = text;
		statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 3000);
	}
	presetEl.addEventListener("change", () => {
		const p = PRESETS[Number(presetEl.value)];
		if (!presetEl.value || !p) return;
		titleEl.value = p.title;
		iconEl.value = p.site;
		status("Press Apply to use it.");
	});
	$("tab-apply").addEventListener("click", () => {
		const title = titleEl.value.trim();
		const site = siteName(iconEl.value);
		if (!title && !site) {
			status("Pick a preset or type a title first.");
			return;
		}
		cloak = { title, site };
		store.set("tabcloak", cloak);
		iconEl.value = site;
		update();
		status(when === "always" ? "Applied." : "Applied. It shows when you leave this tab.");
	});
	$("tab-reset").addEventListener("click", () => {
		cloak = null;
		store.set("tabcloak", null);
		fillFields();
		update();
		status("Back to ROKI.");
	});
	whenEl.value = when;
	whenEl.addEventListener("change", () => {
		when = whenEl.value === "away" ? "away" : "always";
		store.set("tabcloak-when", when);
		update();
	});
	fillFields();

	document.addEventListener("visibilitychange", update);
	window.addEventListener("focus", update);
	window.addEventListener("blur", update);
	setInterval(update, 500); // catches clicks into other windows and ROKI moving into about:blank
	update();

	/* ---------- Prevent Close ("Ask before closing the tab") ---------- */
	// Asks "Leave site?" before the tab closes or reloads. ROKI's own exits (panic key, about:blank,
	// log out, wipe and restart, importing settings) set window.__rokiLeaving first so they never ask.
	const guardEl = $("prevent-close");
	let guard = store.get("prevent-close", false) === true;
	guardEl.checked = guard;
	guardEl.addEventListener("change", () => {
		guard = guardEl.checked;
		store.set("prevent-close", guard);
	});
	function beforeUnload(e) {
		if (!guard || window.__rokiLeaving) return;
		e.preventDefault();
		e.returnValue = "";
	}
	window.addEventListener("beforeunload", beforeUnload);
	// Hidden in an about:blank tab, the blank tab is the one that closes
	let guardedTop = null;
	setInterval(() => {
		const top = shownWindow();
		if (top === window || top === guardedTop) return;
		try { top.addEventListener("beforeunload", beforeUnload); guardedTop = top; } catch (e) {}
	}, 1000);
	const logout = $("logout-link");
	if (logout) logout.addEventListener("click", () => { window.__rokiLeaving = true; });
})();
