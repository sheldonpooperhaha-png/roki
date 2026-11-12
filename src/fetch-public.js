// Fetching from the web on ROKI's server without ever reaching the server's own network, and a few
// helpers for reading the start of web pages. Used for game covers (game-art.js) and app icons (icons.js).
import { isIP } from "node:net";

/* ---------- Reading pages ---------- */

export function decodeEntities(s) {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}
export function attr(tag, name) {
	const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
	return m ? decodeEntities((m[1] ?? m[2] ?? m[3]).trim()) : null;
}
export function webUrl(text, base) {
	try {
		const u = new URL(text, base);
		return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
	} catch {
		return null;
	}
}

/* ---------- Never fetching from the server's own network ---------- */

export function privateV4(ip) {
	const [a, b] = ip.split(".").map(Number);
	return (
		a === 0 || a === 10 || a === 127 || a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0) ||
		(a === 198 && (b === 18 || b === 19))
	);
}
export function isPrivateAddress(ip) {
	const kind = isIP(ip);
	if (kind === 4) return privateV4(ip);
	if (kind !== 6) return true;
	const s = ip.toLowerCase();
	if (s.startsWith("::ffff:")) {
		const rest = s.slice(7);
		if (isIP(rest) === 4) return privateV4(rest);
		const [hi, lo] = rest.split(":").map((h) => parseInt(h, 16));
		return privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
	}
	if (s === "::" || s === "::1") return true;
	const first = parseInt(s.split(":")[0] || "0", 16);
	return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

export async function publicUrl(text, lookupImpl) {
	let url;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return null;
	let addrs;
	try {
		addrs = isIP(host) ? [{ address: host }] : await lookupImpl(host, { all: true });
	} catch {
		return null;
	}
	return addrs.length && !addrs.some((a) => isPrivateAddress(a.address)) ? url : null;
}

// fetch() that checks every hop of a redirect, so a page can't point ROKI's server at its own network
export async function fetchPublic(text, headers, { fetchImpl, lookupImpl }) {
	for (let hop = 0; hop < 5; hop++) {
		const url = await publicUrl(text, lookupImpl);
		if (!url) return null;
		const res = await fetchImpl(url.href, { headers, redirect: "manual", signal: AbortSignal.timeout(8000) });
		if (res.status >= 300 && res.status < 400) {
			const next = res.headers.get("location");
			res.body?.cancel().catch(() => {});
			if (!next) return null;
			text = new URL(next, url).href;
			continue;
		}
		return { res, url: url.href };
	}
	return null;
}

// Reads at most `limit` bytes. Pages stop at </head> (the picture is named there); too-big pictures give null.
export async function readBody(res, limit, isPage) {
	if (!res.body) return Buffer.alloc(0);
	const reader = res.body.getReader();
	const chunks = [];
	let size = 0;
	let tail = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit && !isPage) return null;
			chunks.push(Buffer.from(value));
			if (isPage) {
				const text = tail + Buffer.from(value).toString("latin1").toLowerCase();
				if (text.includes("</head>") || size > limit) break;
				tail = text.slice(-8);
			}
		}
	} finally {
		reader.cancel().catch(() => {});
	}
	return Buffer.concat(chunks);
}

export function limiter(n) {
	let active = 0;
	const queue = [];
	function next() {
		if (active >= n || !queue.length) return;
		active++;
		const { fn, resolve, reject } = queue.shift();
		Promise.resolve().then(fn).then(resolve, reject).finally(() => {
			active--;
			next();
		});
	}
	return (fn) => new Promise((resolve, reject) => {
		queue.push({ fn, resolve, reject });
		next();
	});
}

