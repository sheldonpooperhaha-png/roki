import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

import { createAuth, isHttps, isKeyShaped, newKey, pathOf } from "./auth.js";
import { listGames } from "./games.js";
import { createIconCache } from "./icons.js";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const gamesPath = fileURLToPath(new URL("../public/games/", import.meta.url));

// ROKI secret-link lock (see src/auth.js).
// The secret key comes from ROKI_KEY if it is set (the server uses this), otherwise from
// roki-key.txt in the project folder, which is made the first time ROKI runs.
const keyFile = new URL("../roki-key.txt", import.meta.url);
function loadKey() {
	const fromEnv = (process.env.ROKI_KEY || "").trim();
	if (fromEnv) {
		if (!isKeyShaped(fromEnv)) throw new Error("ROKI_KEY must be 16-128 letters, numbers, - or _");
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

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	// Cloudflare family DNS (blocks malware and adult sites). "resolve" makes wisp actually use these servers.
	dns_method: "resolve",
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const fastify = Fastify({
	// Set TRUST_PROXY=1 when running behind a host's load balancer so login limits use the real visitor IP
	trustProxy: process.env.TRUST_PROXY === "1",
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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

// Shortcut logos on the start page (see src/icons.js): /icons/youtube.png and so on
const getIcon = createIconCache();
fastify.get("/icons/:file", async (req, reply) => {
	const m = /^([a-z]+)\.png$/.exec(req.params.file);
	const icon = m && (await getIcon(m[1]));
	if (!icon) return reply.code(404).header("Cache-Control", "no-store").type("text/plain").send("No logo");
	reply.header("Cache-Control", "public, max-age=86400");
	reply.header("Cross-Origin-Resource-Policy", "same-origin");
	return reply.type(icon.type).send(icon.body);
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
