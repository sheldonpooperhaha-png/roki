// ROKI accounts: a username and password for everyone who got in with the invite link.
// Passwords are never stored, only a salted scrypt hash. Logged-in browsers carry a signed session cookie
// (username + a per-account version + when it was made); changing a password bumps the version, which logs
// that account out everywhere. Accounts live in data/accounts.json; the file is re-read if something else
// (the accounts tool, deploy/accounts.sh) changes it.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
export const SESSION_COOKIE = "roki_session";
export const SESSION_DAYS = 30;

export const NAME_RULE = "3-20 letters, numbers, _ or -";
export const validName = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{3,20}$/.test(s);
export function passwordProblem(pw, name) {
	if (typeof pw !== "string" || pw.length < 6) return "Passwords need at least 6 characters.";
	if (pw.length > 128) return "Passwords can be up to 128 characters.";
	if (name && pw.toLowerCase() === String(name).toLowerCase()) return "Your password can't be your username.";
	return null;
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");

export async function hashPassword(pw, salt = randomBytes(16)) {
	const hash = await scrypt(pw, salt, KEYLEN);
	return { salt: b64(salt), hash: b64(hash) };
}

async function checkPassword(pw, rec) {
	const hash = await scrypt(pw, Buffer.from(rec.salt, "base64url"), KEYLEN);
	const want = Buffer.from(rec.hash, "base64url");
	return want.length === hash.length && timingSafeEqual(want, hash);
}

export function parseCookies(header) {
	const out = {};
	for (const part of String(header || "").split(";")) {
		const i = part.indexOf("=");
		if (i > 0) {
			const k = part.slice(0, i).trim();
			if (!(k in out)) out[k] = part.slice(i + 1).trim();
		}
	}
	return out;
}

export function createAccounts({ file = null, secret, now = Date.now, maxAccounts = 500 } = {}) {
	if (!secret) throw new Error("accounts need a secret to sign sessions with");
	let users = {}; // lowercased name -> { name, salt, hash, v, created }
	let seenMtime = 0;
	let lastCheck = 0;
	const fails = new Map(); // lowercased name -> { count, until }
	// Spends about the same time on a username that doesn't exist, so logins don't reveal who has an account
	const dummy = hashPassword("not a real password");

	function load() {
		if (!file) return;
		try {
			seenMtime = statSync(file).mtimeMs;
			const data = JSON.parse(readFileSync(file, "utf8"));
			const next = {};
			for (const [k, u] of Object.entries(data.users || {})) {
				if (u && validName(u.name) && k === u.name.toLowerCase() && u.salt && u.hash) {
					// Keep a newer "last seen" this process has in memory but hasn't saved yet
					const seen = Math.max(Number(u.seen) || 0, users[k]?.seen || 0) || undefined;
					next[k] = { ...u, seen, v: Number(u.v) || 1, role: u.role === "owner" ? "owner" : undefined, banned: u.banned === true || undefined };
				}
			}
			users = next;
		} catch {
			// no accounts yet
		}
	}

	// Re-reads the file right now if something else (the accounts tool) changed it. Every change calls this
	// first, so a save never writes over the other program's change.
	function sync() {
		if (!file) return;
		try {
			if (statSync(file).mtimeMs !== seenMtime) load();
		} catch {
			// file not made yet
		}
	}

	// For reads, which happen on every request: checks the file at most every 2 seconds
	function maybeReload() {
		if (!file || now() - lastCheck < 2000) return;
		lastCheck = now();
		sync();
	}

	// "Last seen" changes on every visit, so it's saved at most every half minute
	let seenTimer = null;
	function touch(u) {
		if (u.seen && now() - u.seen < 60_000) return;
		u.seen = now();
		if (!file || seenTimer) return;
		seenTimer = setTimeout(() => {
			seenTimer = null;
			try {
				sync();
				save();
			} catch {
				// tried again on the next visit
			}
		}, 30_000);
		seenTimer.unref?.();
	}

	function save() {
		if (!file) return;
		mkdirSync(dirname(file), { recursive: true });
		const tmp = file + ".tmp";
		writeFileSync(tmp, JSON.stringify({ users }, null, 1), { mode: 0o600 });
		renameSync(tmp, file);
		seenMtime = statSync(file).mtimeMs;
	}

	const sign = (s) => createHmac("sha256", secret).update(s).digest("base64url");

	function lockedOut(key) {
		const f = fails.get(key);
		return !!f && f.until > now() && f.count >= 8;
	}
	function failed(key) {
		const f = fails.get(key);
		if (!f || f.until < now()) fails.set(key, { count: 1, until: now() + 15 * 60 * 1000 });
		else f.count++;
		if (fails.size > 5000) for (const [k, v] of fails) if (v.until < now()) fails.delete(k);
	}

	load();

	return {
		reload: load,
		count: () => Object.keys(users).length,
		list: () =>
			Object.values(users).map((u) => ({ name: u.name, created: u.created, seen: u.seen || null, role: u.role || null, banned: !!u.banned })),
		// A banned account can't log in, and its sessions stop working right away
		setBanned(name, banned) {
			sync();
			const u = users[String(name).toLowerCase()];
			if (!u) return false;
			if (banned) {
				u.banned = true;
				u.v++;
			} else {
				delete u.banned;
			}
			save();
			return true;
		},
		// Usernames with the Owner tag (only the server's accounts tool can give it)
		owners() {
			maybeReload();
			return Object.values(users).filter((u) => u.role === "owner").map((u) => u.name);
		},
		setRole(name, role) {
			sync();
			const u = users[String(name).toLowerCase()];
			if (!u) return false;
			if (role === "owner") u.role = "owner";
			else delete u.role;
			save();
			return true;
		},

		async signup(name, pw) {
			maybeReload();
			if (!validName(name)) return { ok: false, error: `Usernames are ${NAME_RULE}.` };
			const problem = passwordProblem(pw, name);
			if (problem) return { ok: false, error: problem };
			const key = name.toLowerCase();
			if (users[key]) return { ok: false, error: "That username is taken. Try another." };
			if (Object.keys(users).length >= maxAccounts) return { ok: false, error: "ROKI has as many accounts as it can hold." };
			const h = await hashPassword(pw);
			sync();
			if (users[key]) return { ok: false, error: "That username is taken. Try another." };
			users[key] = { name, ...h, v: 1, created: now() };
			save();
			return { ok: true, user: { key, name } };
		},

		async login(name, pw) {
			maybeReload();
			const key = typeof name === "string" ? name.trim().toLowerCase() : "";
			if (lockedOut(key)) return { ok: false, error: "Too many wrong passwords for that account. Wait 15 minutes." };
			const u = users[key];
			if (!u || typeof pw !== "string" || pw.length > 128) {
				await checkPassword(String(pw || "").slice(0, 128), await dummy).catch(() => {});
				if (key) failed(key);
				return { ok: false, error: "Wrong username or password." };
			}
			if (!(await checkPassword(pw, u))) {
				failed(key);
				return { ok: false, error: "Wrong username or password." };
			}
			fails.delete(key);
			if (u.banned) return { ok: false, error: "This account is banned from ROKI." };
			return { ok: true, user: { key, name: u.name, role: u.role || null } };
		},

		async changePassword(key, oldPw, newPw) {
			maybeReload();
			const u = users[key];
			if (!u) return { ok: false, error: "That account doesn't exist anymore." };
			if (!(await checkPassword(String(oldPw || ""), u))) return { ok: false, error: "Your current password isn't right." };
			const problem = passwordProblem(newPw, u.name);
			if (problem) return { ok: false, error: problem };
			const h = await hashPassword(newPw);
			sync();
			const cur = users[key];
			if (!cur) return { ok: false, error: "That account doesn't exist anymore." };
			Object.assign(cur, h, { v: cur.v + 1 });
			save();
			return { ok: true, user: { key, name: cur.name } };
		},

		// For the owner's accounts tool: set a new password without the old one, or remove an account
		async resetPassword(name, newPw) {
			sync();
			const key = String(name).toLowerCase();
			const u = users[key];
			if (!u) return { ok: false, error: "No account with that username." };
			const problem = passwordProblem(newPw, u.name);
			if (problem) return { ok: false, error: problem };
			const h = await hashPassword(newPw);
			sync();
			const cur = users[key];
			if (!cur) return { ok: false, error: "No account with that username." };
			Object.assign(cur, h, { v: cur.v + 1 });
			save();
			return { ok: true };
		},
		remove(name) {
			sync();
			const key = String(name).toLowerCase();
			if (!users[key]) return false;
			delete users[key];
			save();
			return true;
		},

		// The session cookie for a logged-in account
		sessionCookie(user, secure) {
			const u = users[user.key];
			const issued = Math.floor(now() / 1000);
			const body = `${b64(user.key)}.${u ? u.v : 1}.${issued}`;
			return `${SESSION_COOKIE}=${body}.${sign(body)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
		},
		clearSessionCookie: () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,

		// The logged-in account for a request's Cookie header, or null
		userFromCookie(header) {
			const value = parseCookies(header)[SESSION_COOKIE];
			if (!value) return null;
			const parts = value.split(".");
			if (parts.length !== 4) return null;
			const body = parts.slice(0, 3).join(".");
			const good = Buffer.from(sign(body));
			const got = Buffer.from(parts[3]);
			if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
			maybeReload();
			let key;
			try {
				key = Buffer.from(parts[0], "base64url").toString("utf8");
			} catch {
				return null;
			}
			const u = users[key];
			if (!u || u.banned || String(u.v) !== parts[1]) return null;
			if (now() / 1000 - Number(parts[2]) > SESSION_DAYS * 86400) return null;
			touch(u);
			return { key, name: u.name, role: u.role || null };
		},
	};
}
