// Site icons for the start page's shortcut tiles and the tab cloak: each site's own icon, fetched by
// ROKI's server (through Google's favicon service) and kept in memory, so pages load them from ROKI itself.

// /icons/<name>.png: the shortcut tiles and the tab cloak templates (settings.js)
export const ICON_SITES = {
	youtube: "youtube.com",
	tiktok: "tiktok.com",
	kick: "kick.com",
	twitch: "twitch.tv",
	snapchat: "snapchat.com",
	instagram: "instagram.com",
	discord: "discord.com",
	classroom: "classroom.google.com",
	docs: "docs.google.com",
	drive: "drive.google.com",
	gmail: "mail.google.com",
	google: "google.com",
	canvas: "canvas.instructure.com",
	clever: "clever.com",
	khan: "khanacademy.org",
	quizlet: "quizlet.com",
	desmos: "desmos.com",
	wikipedia: "wikipedia.org",
	ixl: "ixl.com",
};

const HOUR = 60 * 60 * 1000;
const MAX_BYTES = 200 * 1024;

// "quizlet.com" → "quizlet.com"; anything that isn't a plain host name → null
export function cleanDomain(text) {
	const d = String(text || "").trim().toLowerCase();
	return d.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

// Returns getIcon(domain) → { body, type } or null if that icon can't be had right now.
// Keeps at most `max` icons; the oldest are dropped first.
export function createIconCache({ ttl = 7 * 24 * HOUR, retry = HOUR / 6, max = 300, fetchImpl = fetch } = {}) {
	const entries = new Map(); // domain -> { icon: {body, type} | null, at, pending? }

	async function load(domain) {
		const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
		const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
		if (!res.ok) throw new Error("HTTP " + res.status);
		const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
		if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|webp|gif|jpeg)$/.test(type)) throw new Error("not an image: " + type);
		const body = Buffer.from(await res.arrayBuffer());
		if (!body.length || body.length > MAX_BYTES) throw new Error("bad size: " + body.length);
		return { body, type };
	}

	function remember(domain, entry) {
		entries.delete(domain);
		entries.set(domain, entry);
		while (entries.size > max) entries.delete(entries.keys().next().value);
	}

	return async function getIcon(domain) {
		domain = cleanDomain(domain);
		if (!domain) return null;
		const now = Date.now();
		const e = entries.get(domain);
		if (e?.pending) return e.pending;
		if (e?.icon && now - e.at < ttl) return e.icon;
		if (e && !e.icon && now - e.at < retry) return null; // failed a moment ago

		const old = e?.icon || null;
		const pending = load(domain).then(
			(icon) => {
				remember(domain, { icon, at: Date.now() });
				return icon;
			},
			() => {
				// Keep showing an old icon if there is one, and try again after `retry`
				remember(domain, old ? { icon: old, at: Date.now() - ttl + retry } : { icon: null, at: Date.now() });
				return old;
			}
		);
		remember(domain, { icon: old, at: e?.at || 0, pending });
		return pending;
	};
}
