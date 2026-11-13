import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

import { createAuth, isHttps, isKeyShaped, newKey, pathOf } from "./auth.js";
import { listGames } from "./games.js";
import { ICON_SITES, cleanDomain, createIconCache } from "./icons.js";
import { WISP_OPTIONS } from "./wisp-config.js";
import { patchScramjet } from "./scramjet-patch.js";
import { createArtCache, loadCatalogGames } from "./game-art.js";
import { createChat, sseEvent } from "./chat.js";
import { createAccounts } from "./accounts.js";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const gamesPath = fileURLToPath(new URL("../public/games/", import.meta.url));

// ROKI secret-link lock (see src/auth.js).
// The secret key comes from ROKI_KEY if it is set (the server uses this), otherwise from
// roki-key.txt in the project folder, which is made the first time ROKI runs.
const keyFile = new URL("../roki-key.txt", import.meta.url);
function loadKey() {
	const fromEnv = (process.env.ROKI_KEY || "").trim();
	if (fromEnv) {
		if (!isKeyShaped(fromEnv)) throw new Error("ROKI_KEY must be 4-128 letters, numbers, - or _");
		return fromEnv;
	}
	try {
		const saved = readFileSync(keyFile, "utf8").trim();
		if (isKeyShaped(saved)) return saved;
	} catch {}
	const key = newKey();
	try {
		writeFileSync(keyFile, key + "\n");
	} catch {
		console.warn("Couldn't save roki-key.txt, so the invite link changes every restart.");
	}
	return key;
}
const rokiKey = loadKey();
const auth = createAuth(rokiKey);

// Accounts (see src/accounts.js) and the chat keep their files in data/ (ROKI_DATA_DIR changes the folder).
// Sessions are signed with a secret made from the invite key, so new invite words log everyone out
// (their accounts and passwords stay).
const dataDir = process.env.ROKI_DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url));
const accounts = createAccounts({
	file: join(dataDir, "accounts.json"),
	secret: createHmac("sha256", rokiKey).update("roki-accounts-v1").digest(),
});
const isJson = (req) => String(req.headers["content-type"] || "").startsWith("application/json");
const bodyOf = (req) => (req.body && typeof req.body === "object" ? req.body : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Proxy server settings (see src/wisp-config.js)
logging.set_level(logging.NONE);
Object.assign(wisp.options, WISP_OPTIONS);

const fastify = Fastify({
	// Set TRUST_PROXY=1 when running behind a host's load balancer so login limits use the real visitor IP
	trustProxy: process.env.TRUST_PROXY === "1",
	serverFactory: (handler) => {
		return createServer()
			// ROKI is NOT cross-origin isolated (the Scramjet demo is). Isolation (COOP same-origin + COEP require-corp)
			// stops current Chrome and Edge from starting the SharedWorker that carries ROKI's proxy traffic (bare-mux),
			// so sites never load or the tab crashes. Scramjet only needs isolation for synchronous XHR, which is off.
			// The headers are sent as "unsafe-none" on purpose: browsers that cached ROKI's pages from when it was
			// isolated keep the old headers on a 304 unless the server sends new values.
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
				res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				// The proxy connection only opens for logged-in accounts
				if (req.url.endsWith("/wisp/") && accounts.userFromCookie(req.headers.cookie)) {
					wisp.routeRequest(req, socket, head);
				} else {
					socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				}
			});
	},
});

// Lock every page except the login and sign-up pages and the public library files: everything else needs
// a logged-in account
fastify.addHook("onRequest", async (req, reply) => {
	const path = pathOf(req.url);
	if (auth.isOpenPath(path)) return;
	const user = accounts.userFromCookie(req.headers.cookie);
	if (user) {
		req.user = user;
		return;
	}
	if (req.method === "GET" && String(req.headers.accept || "").includes("text/html")) {
		return reply.redirect("/login");
	}
	return reply.code(401).type("text/plain").send("ROKI is private. Open your invite link to get in.");
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

// Scramjet's main file with ROKI's WebSocket fix (see src/scramjet-patch.js); the rest of /scram/ is as installed
const scramjetAll = (() => {
	const { code, applied } = patchScramjet(readFileSync(join(scramjetPath, "scramjet.all.js"), "utf8"));
	if (!applied) console.warn("Scramjet WebSocket fix not applied (different Scramjet version?), serving it unchanged");
	const body = Buffer.from(code);
	return { body, etag: '"' + createHash("sha1").update(body).digest("base64url") + '"' };
})();
fastify.get("/scram/scramjet.all.js", (req, reply) => {
	reply.header("Cache-Control", "no-cache").header("ETag", scramjetAll.etag);
	if (req.headers["if-none-match"] === scramjetAll.etag) return reply.code(304).send();
	return reply.type("application/javascript; charset=utf-8").send(scramjetAll.body);
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

fastify.get("/login", (req, reply) => {
	if (accounts.userFromCookie(req.headers.cookie)) return reply.redirect("/");
	return reply.sendFile("login.html");
});

// Making an account needs the invite link: opening it leaves a cookie that this page checks
fastify.get("/signup", (req, reply) => {
	if (accounts.userFromCookie(req.headers.cookie)) return reply.redirect("/");
	if (!auth.isAuthed(req.headers.cookie)) return reply.redirect("/login?need=invite");
	return reply.sendFile("signup.html");
});

// The login page asks whether this browser opened the invite link (to offer "make an account")
fastify.get("/account/state", (req, reply) => {
	reply.header("Cache-Control", "no-store");
	const user = accounts.userFromCookie(req.headers.cookie);
	return { invited: auth.isAuthed(req.headers.cookie), user: user ? user.name : null };
});

fastify.post("/account/login", { bodyLimit: 2048 }, async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	if (!isJson(req)) return reply.code(415).send({ error: "Send it as JSON." });
	if (!auth.allowAttempt(req.ip)) return reply.code(429).send({ error: "Too many wrong tries from here. Wait 15 minutes." });
	const body = bodyOf(req);
	const r = await accounts.login(body.username, body.password);
	if (!r.ok) {
		auth.recordFail(req.ip);
		await sleep(300);
		return reply.code(401).send({ error: r.error });
	}
	auth.recordSuccess(req.ip);
	reply.header("Set-Cookie", accounts.sessionCookie(r.user, isHttps(req)));
	return { ok: true, name: r.user.name };
});

const signups = new Map(); // ip -> times accounts were made from it
fastify.post("/account/signup", { bodyLimit: 2048 }, async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	if (!isJson(req)) return reply.code(415).send({ error: "Send it as JSON." });
	if (!auth.isAuthed(req.headers.cookie)) return reply.code(403).send({ error: "Open your invite link first, then make your account." });
	const now = Date.now();
	const recent = (signups.get(req.ip) || []).filter((t) => now - t < 60 * 60 * 1000);
	if (recent.length >= 5) return reply.code(429).send({ error: "Too many new accounts from here. Try again in an hour." });
	const body = bodyOf(req);
	if (body.password !== body.confirm) return reply.code(400).send({ error: "The two passwords don't match." });
	const r = await accounts.signup(typeof body.username === "string" ? body.username.trim() : body.username, body.password);
	if (!r.ok) return reply.code(400).send({ error: r.error });
	recent.push(now);
	signups.set(req.ip, recent);
	if (signups.size > 2000) for (const [ip, list] of signups) if (!list.some((t) => now - t < 3600000)) signups.delete(ip);
	reply.header("Set-Cookie", accounts.sessionCookie(r.user, isHttps(req)));
	return { ok: true, name: r.user.name };
});

fastify.get("/account/me", (req, reply) => {
	reply.header("Cache-Control", "no-store");
	return { name: req.user.name, owner: req.user.role === "owner" };
});

fastify.post("/account/password", { bodyLimit: 2048 }, async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	if (!isJson(req)) return reply.code(415).send({ error: "Send it as JSON." });
	const body = bodyOf(req);
	const r = await accounts.changePassword(req.user.key, body.current, body.password);
	if (!r.ok) return reply.code(400).send({ error: r.error });
	// The new password logs out every other browser; this one gets a fresh session
	reply.header("Set-Cookie", accounts.sessionCookie(r.user, isHttps(req)));
	return { ok: true };
});

// The invite link: opening /join/<key> lets this browser make an account (or log in), then goes on.
// Anything after # in the link (like #cloak from the friend launcher) carries over to ROKI.
fastify.get("/join/:key", async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	reply.header("Referrer-Policy", "no-referrer");
	const ip = req.ip;
	if (!auth.allowAttempt(ip)) return reply.redirect("/login?link=wait");
	if (!auth.checkKey(req.params.key)) {
		auth.recordFail(ip);
		await sleep(400);
		return reply.redirect("/login?link=bad");
	}
	auth.recordSuccess(ip);
	reply.header("Set-Cookie", auth.cookie(isHttps(req)));
	return reply.redirect(accounts.userFromCookie(req.headers.cookie) ? "/" : "/signup");
});

// Settings asks for this to copy the invite link and to make the friend launcher.
// Like every ROKI page, only browsers that already got in can see it.
fastify.get("/invite.json", async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	return { path: auth.invitePath };
});

// Logs the account out of this browser (it can still make an account or log in again)
fastify.get("/logout", (req, reply) => {
	reply.header("Set-Cookie", accounts.clearSessionCookie());
	return reply.redirect("/login");
});

// Site icons (see src/icons.js)
// /icons/<name>.png: shortcut tiles and tab cloak templates. Open to everyone, like the lock screen,
// since they're only a fixed list of public site icons.
// /site-icon?d=<domain>: the tab cloak's "Custom" icon. Locked like every ROKI page.
const getIcon = createIconCache();
function sendIcon(reply, icon) {
	if (!icon) return reply.code(404).header("Cache-Control", "no-store").type("text/plain").send("No icon");
	reply.header("Cache-Control", "public, max-age=86400");
	reply.header("Cross-Origin-Resource-Policy", "same-origin");
	return reply.type(icon.type).send(icon.body);
}
fastify.get("/icons/:file", async (req, reply) => {
	const m = /^([a-z]+)\.png$/.exec(req.params.file);
	const domain = m && Object.hasOwn(ICON_SITES, m[1]) ? ICON_SITES[m[1]] : null;
	return sendIcon(reply, domain && (await getIcon(domain)));
});
fastify.get("/site-icon", async (req, reply) => {
	const domain = cleanDomain(req.query && req.query.d);
	return sendIcon(reply, domain && (await getIcon(domain)));
});

// /game-art?u=<game url>: a "Play online" game's cover picture (see src/game-art.js). Only games in
// public/catalog.js; open like /icons/ since it can't fetch anything else.
const catalogGames = (() => {
	try {
		return loadCatalogGames(readFileSync(join(publicPath, "catalog.js"), "utf8"));
	} catch (e) {
		console.warn("Couldn't read the games in public/catalog.js:", e.message);
		return [];
	}
})();
const gameByUrl = new Map(catalogGames.map((g) => [g.url, g]));
const getArt = createArtCache();
fastify.get("/game-art", async (req, reply) => {
	const game = gameByUrl.get(String((req.query && req.query.u) || ""));
	const art = game && (await getArt(game));
	if (!art) return reply.code(404).header("Cache-Control", "no-store").type("text/plain").send("No picture");
	reply.header("Cache-Control", "public, max-age=86400");
	reply.header("Cross-Origin-Resource-Policy", "same-origin");
	reply.header("X-Content-Type-Options", "nosniff");
	return reply.type(art.type).send(art.body);
});
// Fetch every cover once in the background after starting, so the Games page is quick the first time
setTimeout(() => {
	for (const g of catalogGames) getArt(g);
}, 15000).unref();

// The chatroom (see src/chat.js). Locked like every ROKI page, so only logged-in accounts can read or post,
// and each message goes out under its account's username. The last 200 messages are kept in data/chat.json.
const chat = createChat({ file: join(dataDir, "chat.json") });

// New messages arrive here as server-sent events. A reconnecting page sends Last-Event-ID and gets what it missed.
fastify.get("/chat/stream", (req, reply) => {
	reply.hijack();
	const res = reply.raw;
	res.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-store, no-transform",
		"X-Accel-Buffering": "no",
		Connection: "keep-alive",
	});
	const after = Number(req.headers["last-event-id"]) || 0;
	let out = "retry: 3000\n\n" + sseEvent("ready", { after, owners: accounts.owners(), pinned: chat.pinned() });
	for (const m of chat.history(after)) out += sseEvent("msg", m, m.id);
	out += sseEvent("live", {}); // everything after this is new
	res.write(out);
	const stop = chat.subscribe((e) => res.write(e), req.user.name);
	// A comment every 15 s keeps proxies in front of ROKI (CloudFront, Cloudflare) from closing a quiet stream
	const beat = setInterval(() => res.write(": ping\n\n"), 15_000);
	req.raw.on("close", () => {
		clearInterval(beat);
		stop();
	});
});

fastify.post("/chat/send", { bodyLimit: 4096 }, async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
		return reply.code(415).send({ error: "Send the message as JSON." });
	}
	const r = chat.post(req.user.key, req.user.name, bodyOf(req).text);
	if (!r.ok) return reply.code(r.status).send({ error: r.error });
	return { ok: true, id: r.message.id };
});

// The pinned announcement, for the banner on everyone's home page
fastify.get("/announcement", (req, reply) => {
	reply.header("Cache-Control", "no-store");
	return { pinned: chat.pinned() };
});

/* ---------- Admin page (Owner accounts only; every route checks on the server) ---------- */
const adminLogFile = join(dataDir, "admin-log.json");
let adminLog = [];
try {
	adminLog = JSON.parse(readFileSync(adminLogFile, "utf8")).filter((x) => x && typeof x.what === "string");
} catch {
	// no log yet
}
function logAdmin(req, what) {
	adminLog.push({ at: Date.now(), by: req.user.name, what });
	adminLog = adminLog.slice(-100);
	try {
		writeFileSync(adminLogFile, JSON.stringify(adminLog));
	} catch {
		// the log is a convenience; the action already happened
	}
}
async function ownerOnly(req, reply) {
	reply.header("Cache-Control", "no-store");
	if (!req.user || req.user.role !== "owner") return reply.code(403).send({ error: "Only the Owner can do that." });
	if (req.method === "POST" && !isJson(req)) return reply.code(415).send({ error: "Send it as JSON." });
}
const admin = (path, handler) => fastify.post(path, { preHandler: ownerOnly, bodyLimit: 4096 }, handler);
const MUTE_TIMES = { "10m": 10 * 60 * 1000, "1h": 60 * 60 * 1000, "1d": 24 * 60 * 60 * 1000, forever: null };
const MUTE_WORDS = { "10m": "10 minutes", "1h": "1 hour", "1d": "1 day", forever: "until unmuted" };
// The account an admin action is about (refusing the owner's own account where that would lock them out)
function target(req, reply, { notSelf } = {}) {
	const name = typeof bodyOf(req).name === "string" ? bodyOf(req).name.trim() : "";
	const acct = accounts.list().find((a) => a.name.toLowerCase() === name.toLowerCase());
	if (!acct) {
		reply.code(404).send({ error: "No account with that username." });
		return null;
	}
	if (notSelf && acct.name.toLowerCase() === req.user.key) {
		reply.code(400).send({ error: notSelf });
		return null;
	}
	return acct;
}

fastify.get("/admin/state", { preHandler: ownerOnly }, async (req) => {
	const online = new Set(chat.onlineNames().map((n) => n.toLowerCase()));
	const muted = new Map(chat.mutes().map((m) => [m.key, m.until]));
	const mem = process.memoryUsage();
	return {
		me: req.user.name,
		stats: {
			onlineNow: online.size,
			accounts: accounts.count(),
			...chat.stats(),
			uptimeSec: Math.round(process.uptime()),
			memoryMB: Math.round(mem.rss / 1048576),
		},
		accounts: accounts
			.list()
			.map((a) => {
				const key = a.name.toLowerCase();
				return { ...a, online: online.has(key), muted: muted.has(key), mutedUntil: muted.get(key) ?? null };
			})
			.sort((x, y) => Number(y.online) - Number(x.online) || (y.seen || y.created) - (x.seen || x.created)),
		pinned: chat.pinned(),
		messages: chat.history().slice(-40),
		log: adminLog.slice(-30).reverse(),
	};
});

admin("/admin/chat/delete", async (req, reply) => {
	const id = Number(bodyOf(req).id);
	const m = chat.history().find((x) => x.id === id);
	if (!m || !chat.remove(id)) return reply.code(404).send({ error: "That message is already gone." });
	logAdmin(req, `deleted a message from ${m.name}`);
	return { ok: true };
});
admin("/admin/chat/clear", async (req) => {
	chat.clear();
	logAdmin(req, "cleared the chat");
	return { ok: true };
});
admin("/admin/chat/mute", async (req, reply) => {
	const acct = target(req, reply, { notSelf: "You can't mute yourself." });
	if (!acct) return;
	const time = bodyOf(req).time;
	if (!(time in MUTE_TIMES)) return reply.code(400).send({ error: "Pick how long to mute them." });
	chat.mute(acct.name.toLowerCase(), acct.name, MUTE_TIMES[time]);
	logAdmin(req, `muted ${acct.name} (${MUTE_WORDS[time]})`);
	return { ok: true };
});
admin("/admin/chat/unmute", async (req, reply) => {
	const acct = target(req, reply);
	if (!acct) return;
	chat.unmute(acct.name.toLowerCase());
	logAdmin(req, `unmuted ${acct.name}`);
	return { ok: true };
});
admin("/admin/pin", async (req, reply) => {
	const text = bodyOf(req).text;
	const r = chat.setPinned(typeof text === "string" && text.trim() ? text : null, req.user.name);
	if (!r.ok) return reply.code(400).send({ error: r.error });
	logAdmin(req, r.pinned ? "pinned an announcement" : "removed the announcement");
	return { ok: true };
});
admin("/admin/account/reset", async (req, reply) => {
	const acct = target(req, reply);
	if (!acct) return;
	const r = await accounts.resetPassword(acct.name, bodyOf(req).password);
	if (!r.ok) return reply.code(400).send({ error: r.error });
	logAdmin(req, `reset ${acct.name}'s password`);
	return { ok: true };
});
admin("/admin/account/delete", async (req, reply) => {
	const acct = target(req, reply, { notSelf: "You can't delete your own account here." });
	if (!acct) return;
	accounts.remove(acct.name);
	chat.unmute(acct.name.toLowerCase());
	logAdmin(req, `deleted ${acct.name}'s account`);
	return { ok: true };
});
admin("/admin/account/ban", async (req, reply) => {
	const banned = bodyOf(req).banned === true;
	const acct = target(req, reply, { notSelf: banned ? "You can't ban yourself." : false });
	if (!acct) return;
	accounts.setBanned(acct.name, banned);
	logAdmin(req, `${banned ? "banned" : "unbanned"} ${acct.name}`);
	return { ok: true };
});
admin("/admin/account/owner", async (req, reply) => {
	const owner = bodyOf(req).owner === true;
	const acct = target(req, reply, { notSelf: owner ? false : "You can't take away your own Owner tag here." });
	if (!acct) return;
	accounts.setRole(acct.name, owner ? "owner" : null);
	logAdmin(req, `${owner ? "made" : "removed"} ${acct.name} ${owner ? "an Owner" : "as Owner"}`);
	return { ok: true };
});

// The Games page asks for this list (see src/games.js). It's locked like everything else.
fastify.get("/games/list.json", async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	return { games: listGames(gamesPath) };
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	// by default we are listening on 0.0.0.0 (every interface)
	// we just need to list a few
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);

	console.log("\nROKI is private. Open this invite link to get in (it's also in Settings once you're in):");
	console.log(`\thttp://localhost:${address.port}${auth.invitePath}\n`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
