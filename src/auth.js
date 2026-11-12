// ROKI secret-link lock.
// There's no password. ROKI has a secret key, and opening the invite link
// (https://your-roki/join/<key>) once logs that browser in for 30 days.
// Strangers without the link only see the lock screen.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "roki_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // stay logged in for 30 days
const MAX_FAILS = 10; // wrong links allowed per IP...
const FAIL_WINDOW = 15 * 60 * 1000; // ...in this many milliseconds

// Pages anyone can load without the invite link: the lock screen, its styles,
// the invite link itself, the shortcut logos, the Games page's cover pictures (only ROKI's own list of
// games) and the public Scramjet library files the service worker needs.
// The proxy connection (/wisp/) and every ROKI page stay locked.
const OPEN_PATHS = new Set(["/login", "/login.html", "/logout", "/roki.css", "/favicon.ico", "/sw.js", "/game-art"]);
const OPEN_PREFIXES = ["/join/", "/icons/", "/scram/", "/baremux/", "/libcurl/"];

const sha = (s) => createHash("sha256").update(String(s)).digest();
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);

export const newKey = () => randomBytes(18).toString("base64url");
export const isKeyShaped = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(s);

export function pathOf(url) {
	try {
		return new URL(url, "http://x").pathname;
	} catch {
		return "/";
	}
}

export function parseCookies(header) {
	const out = {};
	if (!header) return out;
	for (const part of String(header).split(";")) {
		const i = part.indexOf("=");
		if (i < 0) continue;
		const name = part.slice(0, i).trim();
		if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
	}
	return out;
}

export function isHttps(req) {
	const fwd = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
	return req.protocol === "https" || fwd === "https";
}

export function createAuth(key) {
	if (!isKeyShaped(key)) throw new Error("ROKI's secret key must be 4-128 letters, numbers, - or _");

	const keyHash = sha(key);
	const token = createHmac("sha256", key).update("roki-session-v2").digest("base64url");
	const tokenBuf = Buffer.from(token);
	const fails = new Map();

	function cleanup(now) {
		if (fails.size < 1000) return;
		for (const [ip, f] of fails) if (f.until < now) fails.delete(ip);
	}

	return {
		// The part of the invite link after the address: /join/<key>
		invitePath: "/join/" + key,

		isOpenPath(path) {
			return OPEN_PATHS.has(path) || OPEN_PREFIXES.some((p) => path.startsWith(p));
		},

		isAuthed(cookieHeader) {
			const value = parseCookies(cookieHeader)[COOKIE];
			return !!value && same(Buffer.from(value), tokenBuf);
		},

		checkKey(input) {
			return typeof input === "string" && same(sha(input), keyHash);
		},

		allowAttempt(ip, now = Date.now()) {
			const f = fails.get(ip);
			return !(f && f.until > now && f.count >= MAX_FAILS);
		},

		recordFail(ip, now = Date.now()) {
			cleanup(now);
			const f = fails.get(ip);
			if (!f || f.until < now) fails.set(ip, { count: 1, until: now + FAIL_WINDOW });
			else f.count++;
		},

		recordSuccess(ip) {
			fails.delete(ip);
		},

		cookie(secure) {
			return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
		},

		clearCookie() {
			return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
		},
	};
}
