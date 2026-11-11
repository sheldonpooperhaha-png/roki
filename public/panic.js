"use strict";
// ROKI panic key: one key press sends you to a normal site, fast.
// Set it up in Settings: turn it on or off, pick the key, and pick where it sends you.
// Shared by ROKI Website and the proxy ROKI.
(() => {
	const KEY_STORE = "roki:panic-key";
	const URL_STORE = "roki:panic-url";
	const ON_STORE = "roki:panic-on";
	const DEFAULT_KEY = "`";
	const DEFAULT_URL = "https://www.google.com";
	// Keys that can't be the panic key (they're needed for typing, games or closing menus)
	const BLOCKED = new Set(["Escape", "Enter", "Tab", "Backspace", "Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified", "Process"]);

	const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
	const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

	let key = read(KEY_STORE, DEFAULT_KEY);
	let dest = read(URL_STORE, DEFAULT_URL);
	let on = read(ON_STORE, "1") === "1";
	let recording = false;

	const norm = (k) => (k && k.length === 1 ? k.toLowerCase() : k);
	function keyLabel(k) {
		if (k === " ") return "Space";
		if (k && k.length === 1) return k.toUpperCase();
		return k || "None";
	}

	// Turns "classroom.google.com" into "https://classroom.google.com"; returns null if it isn't a web address
	function toSafeUrl(input) {
		let s = String(input || "").trim();
		if (!s) return null;
		if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
		try {
			const u = new URL(s);
			if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
			return u.href;
		} catch (e) {
			return null;
		}
	}

	function panic() {
		const url = toSafeUrl(dest) || DEFAULT_URL;
		// In the about:blank cloak ROKI is inside a frame, so leave from the whole tab.
		// replace() also keeps ROKI out of the Back button.
		try { window.top.location.replace(url); return; } catch (e) {}
		location.replace(url);
	}

	function onKey(e) {
		if (recording || !on || e.repeat) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (norm(e.key) !== norm(key)) return;
		e.preventDefault();
		e.stopPropagation();
		panic();
	}
	window.addEventListener("keydown", onKey, true);

	// Also listen inside games and site frames, which get the key presses while they're focused.
	// A frame gets a new page every time it navigates, so this re-hooks on every load and once a second.
	// Adding the same listener twice does nothing, so re-hooking is safe.
	// (Frames the browser won't let ROKI reach, like games opened straight from the folder, are skipped.)
	function attach(frame) {
		try {
			const w = frame.contentWindow;
			if (w) w.addEventListener("keydown", onKey, true);
		} catch (e) {}
	}
	const hooked = new WeakSet();
	function hookFrame(frame) {
		if (!hooked.has(frame)) {
			hooked.add(frame);
			frame.addEventListener("load", () => attach(frame));
		}
		attach(frame);
	}
	function scan(node) {
		if (node.nodeType !== 1) return;
		if (node.tagName === "IFRAME") hookFrame(node);
		else node.querySelectorAll && node.querySelectorAll("iframe").forEach(hookFrame);
	}
	new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan)))
		.observe(document.documentElement, { childList: true, subtree: true });
	scan(document.documentElement);
	setInterval(() => document.querySelectorAll("iframe").forEach(attach), 1000);

	/* ---------- Settings ---------- */
	function setupSettings() {
		const onEl = document.getElementById("panic-on");
		const keyBtn = document.getElementById("panic-key");
		const urlEl = document.getElementById("panic-url");
		const hint = document.getElementById("panic-hint");
		if (!onEl || !keyBtn || !urlEl || !hint) return;

		// Opened straight from the folder, the browser walls each game off from ROKI
		if (location.protocol === "file:") {
			hint.textContent += " Opened from the folder, it won't work while a game has focus. Online, it works everywhere.";
		}
		const HINT = hint.textContent;
		const say = (text, bad) => {
			hint.textContent = text;
			hint.classList.toggle("bad", !!bad);
		};

		onEl.checked = on;
		keyBtn.textContent = keyLabel(key);
		urlEl.value = dest;

		onEl.addEventListener("change", () => {
			on = onEl.checked;
			write(ON_STORE, on ? "1" : "0");
		});

		function stopRecording() {
			recording = false;
			keyBtn.setAttribute("aria-pressed", "false");
			keyBtn.textContent = keyLabel(key);
			window.removeEventListener("keydown", recordKey, true);
		}
		function recordKey(e) {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.key === "Escape") {
				stopRecording();
				say(HINT);
				return;
			}
			if (BLOCKED.has(e.key)) {
				say(`${keyLabel(e.key)} can't be the panic key. Try another, like \` or F2.`, true);
				return;
			}
			key = e.key;
			write(KEY_STORE, key);
			stopRecording();
			say(`Panic key set to ${keyLabel(key)}.`);
		}
		keyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (recording) { stopRecording(); say(HINT); return; }
			recording = true;
			keyBtn.setAttribute("aria-pressed", "true");
			keyBtn.textContent = "Press a key…";
			say("Press the key you want. Esc cancels.");
			window.addEventListener("keydown", recordKey, true);
		});

		function saveUrl() {
			const url = toSafeUrl(urlEl.value);
			if (!url) {
				say("That isn't a web address. Try something like google.com.", true);
				urlEl.value = dest;
				return;
			}
			dest = url;
			urlEl.value = url;
			write(URL_STORE, url);
			say(HINT);
		}
		urlEl.addEventListener("change", saveUrl);
		urlEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); urlEl.blur(); }
		});
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupSettings);
	else setupSettings();
})();
