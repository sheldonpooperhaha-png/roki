// ROKI's chatroom: one room for everyone with the invite link. Keeps the last 200 messages (saved to a file
// so a restart doesn't wipe them) and pushes new ones to every open Chat page as they're sent.
// Plain text only: names and messages are cleaned here and shown with textContent on the page.
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_NAME = 20;
export const MAX_TEXT = 300;

// Control characters, and invisible characters that can flip or hide text (bidi overrides, zero-width)
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const cut = (s, n) => Array.from(s).slice(0, n).join("");

export function cleanName(input) {
	if (typeof input !== "string") return null;
	const s = cut(input.replace(HIDDEN, "").replace(/\s+/g, " ").trim(), MAX_NAME).trim();
	return s || null;
}

export function cleanText(input) {
	if (typeof input !== "string") return null;
	const s = input
		.replace(/\r\n?/g, "\n")
		.replace(HIDDEN, "")
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!s) return null;
	return Array.from(s).length > MAX_TEXT ? false : s;
}

// One server-sent event
export const sseEvent = (name, data, id) => (id !== undefined ? `id: ${id}\n` : "") + `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

export function createChat({
	file = null,
	max = 200,
	burst = 5, // messages one person can send...
	windowMs = 10_000, // ...in this long
	gapMs = 700, // and at least this far apart
	roomPerMin = 120, // everyone together, per minute
	now = Date.now,
	saveDelay = 1000,
} = {}) {
	let messages = [];
	let nextId = 1;
	const listeners = new Set();
	const senders = new Map(); // who -> recent send times
	let roomSends = [];
	let saveTimer = null;

	if (file) {
		try {
			const saved = JSON.parse(readFileSync(file, "utf8"));
			if (Array.isArray(saved.messages)) {
				messages = saved.messages
					.filter((m) => m && Number.isInteger(m.id) && cleanName(m.name) && typeof m.text === "string" && Number.isFinite(m.at))
					.slice(-max);
			}
			nextId = Math.max(Number(saved.nextId) || 0, ...messages.map((m) => m.id + 1), 1);
		} catch {
			// no history yet
		}
	}

	function save() {
		if (!file || saveTimer) return;
		saveTimer = setTimeout(() => {
			saveTimer = null;
			try {
				mkdirSync(dirname(file), { recursive: true });
				const tmp = file + ".tmp";
				writeFileSync(tmp, JSON.stringify({ nextId, messages }));
				renameSync(tmp, file);
			} catch (e) {
				console.warn("Couldn't save the chat:", e.message);
			}
		}, saveDelay);
		saveTimer.unref?.();
	}

	function broadcast(text) {
		for (const fn of listeners) {
			try {
				fn(text);
			} catch {
				// a closed connection; its own cleanup removes it
			}
		}
	}

	const onlineEvent = () => sseEvent("online", { n: listeners.size });

	return {
		// Messages after `afterId` (all of them when it's 0)
		history(afterId = 0) {
			return messages.filter((m) => m.id > afterId);
		},

		post(who, name, text) {
			const n = cleanName(name);
			if (!n) return { ok: false, status: 400, error: "Pick a name first." };
			const t = cleanText(text);
			if (t === false) return { ok: false, status: 400, error: `Messages can be up to ${MAX_TEXT} characters.` };
			if (!t) return { ok: false, status: 400, error: "Type a message first." };

			const at = now();
			const mine = (senders.get(who) || []).filter((x) => at - x < windowMs);
			roomSends = roomSends.filter((x) => at - x < 60_000);
			if (mine.length >= burst || (mine.length && at - mine[mine.length - 1] < gapMs) || roomSends.length >= roomPerMin) {
				return { ok: false, status: 429, error: "Slow down a little, then try again." };
			}
			const last = messages[messages.length - 1];
			if (last && last.name === n && last.text === t && at - last.at < 30_000) {
				return { ok: false, status: 409, error: "You just sent that." };
			}
			mine.push(at);
			senders.set(who, mine);
			roomSends.push(at);
			if (senders.size > 2000) for (const [k, v] of senders) if (!v.some((x) => at - x < windowMs)) senders.delete(k);

			const message = { id: nextId++, name: n, text: t, at };
			messages.push(message);
			if (messages.length > max) messages = messages.slice(-max);
			save();
			broadcast(sseEvent("msg", message, message.id));
			return { ok: true, message };
		},

		// fn gets each new event as server-sent-event text; returns a function that stops it
		subscribe(fn) {
			listeners.add(fn);
			broadcast(onlineEvent());
			return () => {
				if (listeners.delete(fn)) broadcast(onlineEvent());
			};
		},

		online: () => listeners.size,
		onlineEvent,
	};
}
