// Shortcut logos on the start page: each site's own icon, fetched by ROKI's server
// (through Google's favicon service) and kept in memory, so the page loads them from ROKI itself.
// Only the sites listed in SHORTCUT_ICONS can be fetched.

export const SHORTCUT_ICONS = {
	youtube: "youtube.com",
	tiktok: "tiktok.com",
	kick: "kick.com",
	twitch: "twitch.tv",
	snapchat: "snapchat.com",
	instagram: "instagram.com",
	discord: "discord.com",
};

const HOUR = 60 * 60 * 1000;
const MAX_BYTES = 200 * 1024;

export function createIconCache(sites = SHORTCUT_ICONS, { ttl = 7 * 24 * HOUR, retry = HOUR / 6, fetchImpl = fetch } = {}) {
	const entries = new Map(); // name -> { icon: {body, type} | null, at, pending? }

	async function load(domain) {
		const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
		const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
		if (!res.ok) throw new Error("HTTP " + res.status);
		const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
		if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|webp|gif|jpeg)$/.test(type)) throw new Error("not an image: " + type);
		const body = Buffer.from(await res.arrayBuffer());
		if (!body.length || body.length > MAX_BYTES) throw new Error("bad size: " + body.length);
		return { body, type };
	}

	// Returns { body, type } or null if this logo can't be had right now
	return async function getIcon(name) {
		if (!Object.hasOwn(sites, name)) return null;
		const now = Date.now();
		const e = entries.get(name);
		if (e?.pending) return e.pending;
		if (e?.icon && now - e.at < ttl) return e.icon;
		if (e && !e.icon && now - e.at < retry) return null; // failed a moment ago

		const old = e?.icon || null;
		const pending = load(sites[name]).then(
			(icon) => {
				entries.set(name, { icon, at: Date.now() });
				return icon;
			},
			() => {
				// Keep showing an old logo if there is one, and try again after `retry`
				entries.set(name, old ? { icon: old, at: Date.now() - ttl + retry } : { icon: null, at: Date.now() });
				return old;
			}
		);
		entries.set(name, { icon: old, at: e?.at || 0, pending });
		return pending;
	};
}
