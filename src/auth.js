// ROKI password lock.
// The password comes from the ROKI_PASSWORD environment variable. If it isn't set,
// a random one is made at startup and printed in the console.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "roki_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // stay logged in for 30 days
const MAX_FAILS = 10; // wrong tries allowed per IP...
const FAIL_WINDOW = 15 * 60 * 1000; // ...in this many milliseconds

// Files anyone can load without logging in: the login page itself, its styles,
// and the public Scramjet library files the service worker needs.
// The proxy connection (/wisp/) and every ROKI page stay locked.
const OPEN_PATHS = new Set(["/login", "/login.html", "/logout", "/roki.css", "/favicon.ico", "/sw.js"]);
const OPEN_PREFIXES = ["/scram/", "/baremux/", "/libcurl/"];

const sha = (s) => createHash("sha256").update(String(s)).digest();
const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);

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
		const key = part.slice(0, i).trim();
		if (key && !(key in out)) out[key] = part.slice(i + 1).trim();
	}
	return out;
}

export function isHttps(req) {
	const fwd = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
	return req.protocol === "https" || fwd === "https";
}

export function createAuth(password) {
	const generated = !password;
	if (generated) password = randomBytes(9).toString("base64url");

	const passwordHash = sha(password);
	const token = createHmac("sha256", password).update("roki-session-v1").digest("base64url");
	const tokenBuf = Buffer.from(token);
	const fails = new Map();

	function cleanup(now) {
		if (fails.size < 1000) return;
		for (const [ip, f] of fails) if (f.until < now) fails.delete(ip);
	}

	return {
		password,
		generated,

		isOpenPath(path) {
			return OPEN_PATHS.has(path) || OPEN_PREFIXES.some((p) => path.startsWith(p));
		},

		isAuthed(cookieHeader) {
			const value = parseCookies(cookieHeader)[COOKIE];
			return !!value && same(Buffer.from(value), tokenBuf);
		},

		checkPassword(input) {
			return typeof input === "string" && same(sha(input), passwordHash);
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
