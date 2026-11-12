import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
const auth = createAuth(loadKey());
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
				// The proxy connection only opens for logged-in browsers
				if (req.url.endsWith("/wisp/") && auth.isAuthed(req.headers.cookie)) {
					wisp.routeRequest(req, socket, head);
				} else {
					socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				}
			});
	},
});

// Lock every page except the login page and the public library files
fastify.addHook("onRequest", async (req, reply) => {
	const path = pathOf(req.url);
	if (auth.isOpenPath(path) || auth.isAuthed(req.headers.cookie)) return;
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
	if (auth.isAuthed(req.headers.cookie)) return reply.redirect("/");
	return reply.sendFile("login.html");
});

// The invite link: opening /join/<key> logs this browser in, then goes to ROKI.
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
	return reply.redirect("/");
});

// Settings asks for this to copy the invite link and to make the friend launcher.
// Like every ROKI page, only browsers that already got in can see it.
fastify.get("/invite.json", async (req, reply) => {
	reply.header("Cache-Control", "no-store");
	return { path: auth.invitePath };
});

fastify.get("/logout", (req, reply) => {
	reply.header("Set-Cookie", auth.clearCookie());
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
