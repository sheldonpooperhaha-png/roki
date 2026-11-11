import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { readFileSync } from "node:fs";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

import { createAuth, isHttps, pathOf } from "./auth.js";
import { listGames } from "./games.js";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const gamesPath = fileURLToPath(new URL("../public/games/", import.meta.url));

// ROKI password lock (see src/auth.js).
// The password comes from ROKI_PASSWORD if it is set, otherwise from roki-password.txt in the project folder.
function loadPassword() {
	if (process.env.ROKI_PASSWORD) return { password: process.env.ROKI_PASSWORD, from: "ROKI_PASSWORD" };
	try {
		const password = readFileSync(new URL("../roki-password.txt", import.meta.url), "utf8").trim();
		if (password) return { password, from: "roki-password.txt" };
	} catch {}
	return { password: "", from: null };
}
const passwordSource = loadPassword();
const auth = createAuth(passwordSource.password);
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
	return reply.code(401).type("text/plain").send("ROKI is locked. Log in at /login.");
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

fastify.post("/login", async (req, reply) => {
	const ip = req.ip;
	if (!auth.allowAttempt(ip)) {
		return reply.code(429).send({ ok: false, error: "Too many wrong tries. Wait 15 minutes, then try again." });
	}
	const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
	if (!auth.checkPassword(password)) {
		auth.recordFail(ip);
		await sleep(400);
		return reply.code(401).send({ ok: false, error: "Wrong password." });
	}
	auth.recordSuccess(ip);
	reply.header("Set-Cookie", auth.cookie(isHttps(req)));
	return { ok: true };
});

fastify.get("/logout", (req, reply) => {
	reply.header("Set-Cookie", auth.clearCookie());
	return reply.redirect("/login");
});

// The Games page asks for this list (see src/games.js). It's behind the password lock like everything else.
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

	if (auth.generated) {
		console.log("\nROKI password lock is on.");
		console.log(`No password was set (ROKI_PASSWORD or roki-password.txt), so this run's password is: ${auth.password}`);
		console.log("It changes every restart. Put your own in roki-password.txt or ROKI_PASSWORD.\n");
	} else {
		console.log(`\nROKI password lock is on (password from ${passwordSource.from}).\n`);
	}
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
