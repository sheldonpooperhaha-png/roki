// Site icons for the app tiles and the tab cloak: each site's own icon, fetched by ROKI's server and kept
// in memory, so pages load them from ROKI itself.
// App tiles show the icon filling the whole tile, so small favicons look blurry. ROKI uses the site's own
// big icon when it has one (its web app manifest's icons, usually 192-512px, or its apple-touch-icon,
// 180px) and only falls back to Google's favicon service, which is often just 32-64px.
import { lookup } from "node:dns/promises";
import { attr, fetchPublic, limiter, readBody, webUrl } from "./fetch-public.js";

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
const GOOD = 192; // an icon this big looks sharp filling a tile
const SMALLEST = 96; // a site icon smaller than this isn't worth it; Google's is used instead
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const PAGE_HEADERS = { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" };
const MANIFEST_HEADERS = { "user-agent": UA, accept: "application/manifest+json,application/json,*/*;q=0.5" };
const IMAGE_HEADERS = { "user-agent": UA, accept: "image/png,image/webp,image/*;q=0.8" };
// No SVG (an SVG opened on its own can run scripts) and no ICO (usually tiny)
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const skipFile = (src, type) => /svg|icon/i.test(type || "") || /\.(svg|ico)(\?|#|$)/i.test(src);

// "quizlet.com" → "quizlet.com"; anything that isn't a plain host name → null
export function cleanDomain(text) {
	const d = String(text || "").trim().toLowerCase();
	return d.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

// "48x48 192x192" → 192; "any" or nothing → 0
function biggest(sizes) {
	let n = 0;
	for (const m of String(sizes || "").matchAll(/(\d+)\s*x\s*(\d+)/gi)) n = Math.max(n, Math.min(Number(m[1]), Number(m[2])));
	return n;
}

// The page's manifest link and its big icon links (apple-touch-icon counts as 180 when it gives no size)
export function findIconLinks(html, pageUrl) {
	let manifest = null;
	const icons = [];
	for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
		const rel = (attr(tag, "rel") || "").toLowerCase().split(/\s+/);
		const href = webUrl(attr(tag, "href") || "", pageUrl);
		if (!href || !attr(tag, "href")) continue;
		if (rel.includes("manifest")) {
			manifest = manifest || href;
		} else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
			if (!skipFile(href, attr(tag, "type"))) icons.push({ src: href, size: biggest(attr(tag, "sizes")) || 180 });
		} else if (rel.includes("icon")) {
			const size = biggest(attr(tag, "sizes"));
			if (size && !skipFile(href, attr(tag, "type"))) icons.push({ src: href, size });
		}
	}
	return { manifest, icons };
}

// A web app manifest's raster icons: plain ones first, then "maskable" ones (made for phone home screens)
export function pickManifestIcons(manifest, manifestUrl) {
	const list = manifest && Array.isArray(manifest.icons) ? manifest.icons : [];
	const plain = [];
	const maskable = [];
	for (const i of list) {
		if (!i || typeof i.src !== "string") continue;
		const src = webUrl(i.src, manifestUrl);
		if (!src || skipFile(src, i.type)) continue;
		const purposes = String(i.purpose || "any").toLowerCase().split(/\s+/);
		const icon = { src, size: biggest(i.sizes) };
		if (purposes.includes("any")) plain.push(icon);
		else if (purposes.includes("maskable")) maskable.push({ ...icon, maskable: true });
	}
	return [...plain, ...maskable];
}

// Width and height from the start of a PNG, GIF, WebP or JPEG file, or null
export function imageSize(b) {
	if (!b || b.length < 10) return null;
	if (b.toString("latin1", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
	if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("latin1", 12, 16) === "IHDR") {
		return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
	}
	if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
		const kind = b.toString("latin1", 12, 16);
		if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
		if (kind === "VP8L") return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
		if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
		return null;
	}
	if (b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null;
			const marker = b[i + 1];
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
			}
			i += 2 + b.readUInt16BE(i + 2);
		}
	}
	return null;
}

// Best first: plain icons at least 192px (smallest of those, to keep things light), then bigger
// maskable ones, then the rest from biggest to smallest
function bestFirst(icons) {
	const seen = new Set();
	const rank = (c) => (c.size >= GOOD ? (c.maskable ? 2 : 0) : 4) + (c.maskable && c.size < GOOD ? 1 : 0);
	return icons
		.filter((c) => !seen.has(c.src) && seen.add(c.src))
		.sort((a, b) => rank(a) - rank(b) || (a.size >= GOOD && b.size >= GOOD ? a.size - b.size : b.size - a.size));
}

// Returns getIcon(domain) → { body, type } or null if that icon can't be had right now.
// Keeps at most `max` icons and `maxBytes` of them; the oldest are dropped first.
export function createIconCache({
	ttl = 7 * 24 * HOUR,
	retry = HOUR / 6,
	max = 300,
	maxBytes = 24 * 1024 * 1024,
	maxImage = 400 * 1024,
	concurrency = 4,
	fetchImpl = fetch,
	lookupImpl = lookup,
} = {}) {
	const deps = { fetchImpl, lookupImpl };
	const entries = new Map(); // domain -> { icon: {body, type} | null, at, pending? }
	let bytes = 0;
	const queue = limiter(concurrency);

	async function fetchImage(src) {
		const got = await fetchPublic(src, IMAGE_HEADERS, deps);
		if (!got) return null;
		const { res } = got;
		const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
		if (!res.ok || !IMAGE_TYPES.has(type) || Number(res.headers.get("content-length")) > maxImage) {
			res.body?.cancel().catch(() => {});
			return null;
		}
		const body = await readBody(res, maxImage, false);
		return body && body.length ? { body, type: type === "image/jpg" ? "image/jpeg" : type } : null;
	}

	async function readJson(url) {
		const got = await fetchPublic(url, MANIFEST_HEADERS, deps);
		if (!got) return null;
		if (!got.res.ok) {
			got.res.body?.cancel().catch(() => {});
			return null;
		}
		const body = await readBody(got.res, 256 * 1024, false);
		try {
			return body ? { json: JSON.parse(body.toString("utf8")), url: got.url } : null;
		} catch {
			return null;
		}
	}

	// The site's own big icon, or null
	async function siteIcon(domain) {
		const got = await fetchPublic(`https://${domain}/`, PAGE_HEADERS, deps);
		if (!got) return null;
		if (!got.res.ok) {
			got.res.body?.cancel().catch(() => {});
			return null;
		}
		const links = findIconLinks((await readBody(got.res, 1536 * 1024, true)).toString("utf8"), got.url);
		const icons = [...links.icons];
		if (links.manifest) {
			const m = await readJson(links.manifest).catch(() => null);
			if (m) icons.push(...pickManifestIcons(m.json, m.url));
		}
		for (const c of bestFirst(icons).slice(0, 4)) {
			const icon = await fetchImage(c.src).catch(() => null);
			if (!icon) continue;
			const size = imageSize(icon.body);
			if (!size || Math.min(size.w, size.h) >= SMALLEST) return icon;
		}
		return null;
	}

	async function load(domain) {
		const own = await siteIcon(domain).catch(() => null);
		if (own) return own;
		return fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`);
	}

	function remember(domain, entry) {
		const old = entries.get(domain);
		if (old && old.icon) bytes -= old.icon.body.length;
		entries.delete(domain);
		entries.set(domain, entry);
		if (entry.icon) bytes += entry.icon.body.length;
		for (const [k, e] of entries) {
			if (entries.size <= max && bytes <= maxBytes) break;
			if (k === domain || e.pending) continue;
			entries.delete(k);
			if (e.icon) bytes -= e.icon.body.length;
		}
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
		const pending = queue(() => load(domain))
			.catch(() => null)
			.then((icon) => {
				if (icon) {
					remember(domain, { icon, at: Date.now() });
					return icon;
				}
				// Keep showing an old icon if there is one, and try again after `retry`
				remember(domain, old ? { icon: old, at: Date.now() - ttl + retry } : { icon: null, at: Date.now() });
				return old;
			});
		remember(domain, { icon: old, at: e?.at || 0, pending });
		return pending;
	};
}
