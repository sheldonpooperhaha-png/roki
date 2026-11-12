// Cover art for the Games page's "Play online" tiles: each game's own picture, the one its page shares
// for link previews (og:image). ROKI's server fetches it and keeps it in memory, so the Games page loads
// the pictures from ROKI itself. Only games listed in public/catalog.js are fetched.
import vm from "node:vm";
import { lookup } from "node:dns/promises";
import { attr, fetchPublic, limiter, readBody, webUrl } from "./fetch-public.js";

export { isPrivateAddress } from "./fetch-public.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const PAGE_HEADERS = { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" };
const IMAGE_HEADERS = { "user-agent": UA, accept: "image/webp,image/png,image/jpeg,image/*;q=0.8" };
// No SVG: an SVG opened on its own can run scripts, and this is served from ROKI's own address
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);

// public/catalog.js sets window.ROKI_CATALOG; this runs it on its own and returns the games list
export function loadCatalogGames(source) {
	const sandbox = { window: {} };
	vm.runInNewContext(source, sandbox, { timeout: 1000 });
	const games = sandbox.window.ROKI_CATALOG && sandbox.window.ROKI_CATALOG.games;
	return Array.isArray(games)
		? games.filter((g) => g && typeof g.name === "string" && typeof g.url === "string" && /^https?:\/\//.test(g.url))
		: [];
}

// The page's preview picture: og:image, then twitter:image, then <link rel="image_src">
export function findArtUrl(html, pageUrl) {
	const metas = {};
	for (const [tag] of String(html).matchAll(/<meta\b[^>]*>/gi)) {
		const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
		const content = attr(tag, "content");
		if (key && content && !(key in metas)) metas[key] = content;
	}
	let link = null;
	for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
		if (/(^|\s)image_src(\s|$)/i.test(attr(tag, "rel") || "")) {
			link = attr(tag, "href");
			break;
		}
	}
	const choices = [metas["og:image:secure_url"], metas["og:image"], metas["og:image:url"], metas["twitter:image"], metas["twitter:image:src"], link];
	for (const c of choices) {
		const u = c && webUrl(c, pageUrl);
		if (u) return u;
	}
	return null;
}

// Pictures on Cloudflare's image resizer (Poki's are 1200px PNGs): ask for a 320px square WebP instead
export function smallerArt(url) {
	const m = /^(https?:\/\/[^/]+\/cdn-cgi\/image\/)[^/]+(\/.+)$/.exec(url);
	return m ? m[1] + "width=320,height=320,fit=cover,quality=80,format=webp" + m[2] : null;
}

/* ---------- The cache ---------- */

// Returns getArt(game) → { body, type } or null. game is a catalog entry: { url, img? }.
// img, if a game has one, is used as is; otherwise the picture comes from the game's page.
export function createArtCache({
	fetchImpl = fetch,
	lookupImpl = lookup,
	ttl = 7 * DAY,
	retry = 30 * MINUTE,
	maxBytes = 40 * 1024 * 1024,
	maxImage = 2 * 1024 * 1024,
	maxPage = 1536 * 1024,
	concurrency = 4,
} = {}) {
	const deps = { fetchImpl, lookupImpl };
	const entries = new Map(); // key -> { art: {body, type} | null, at, pending? }
	let bytes = 0;
	const queue = limiter(concurrency);

	async function fetchImage(text) {
		const got = await fetchPublic(text, IMAGE_HEADERS, deps);
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

	async function load(game) {
		let choices;
		if (game.img) {
			choices = [game.img];
		} else {
			const got = await fetchPublic(game.url, PAGE_HEADERS, deps);
			if (!got) return null;
			if (!got.res.ok) {
				got.res.body?.cancel().catch(() => {});
				return null;
			}
			const art = findArtUrl((await readBody(got.res, maxPage, true)).toString("utf8"), got.url);
			if (!art) return null;
			choices = [smallerArt(art), art].filter(Boolean);
		}
		for (const choice of choices) {
			try {
				const art = await fetchImage(choice);
				if (art) return art;
			} catch {
				// try the next one
			}
		}
		return null;
	}

	function remember(key, entry) {
		const old = entries.get(key);
		if (old && old.art) bytes -= old.art.body.length;
		entries.delete(key);
		entries.set(key, entry);
		if (entry.art) bytes += entry.art.body.length;
		for (const [k, e] of entries) {
			if (bytes <= maxBytes && entries.size <= 1000) break;
			if (k === key || e.pending) continue;
			entries.delete(k);
			if (e.art) bytes -= e.art.body.length;
		}
	}

	return async function getArt(game) {
		const key = game.url + (game.img ? " " + game.img : "");
		const now = Date.now();
		const e = entries.get(key);
		if (e && e.pending) return e.pending;
		if (e && e.art && now - e.at < ttl) {
			entries.delete(key); // most recently used goes last
			entries.set(key, e);
			return e.art;
		}
		if (e && !e.art && now - e.at < retry) return null; // failed a moment ago

		const old = (e && e.art) || null;
		const pending = queue(() => load(game))
			.catch(() => null)
			.then((art) => {
				if (art) {
					remember(key, { art, at: Date.now() });
					return art;
				}
				// Keep showing an old picture if there is one, and try again after `retry`
				remember(key, old ? { art: old, at: Date.now() - ttl + retry } : { art: null, at: Date.now() });
				return old;
			});
		remember(key, { art: old, at: (e && e.at) || 0, pending });
		return pending;
	};
}
