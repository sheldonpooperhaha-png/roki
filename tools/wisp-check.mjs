// Checks that ROKI's proxy server can reach websites from this machine.
// It starts a private copy of the proxy (wisp) with ROKI's settings, asks it to load a few
// plain-HTTP pages, and prints what happened, with the proxy's own debug log.
//   node tools/wisp-check.mjs            (from the ROKI folder)
//   node tools/wisp-check.mjs some.site  (check other sites too)
import { createServer } from "node:http";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import WebSocket from "ws";
import { WISP_OPTIONS } from "../src/wisp-config.js";

const HOSTS = ["neverssl.com", "www.google.com", "www.youtube.com", ...process.argv.slice(2)];
const TIMEOUT = 10_000;

logging.set_level(logging.DEBUG);
Object.assign(wisp.options, WISP_OPTIONS);

const server = createServer().on("upgrade", (req, socket, head) => wisp.routeRequest(req, socket, head));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const enc = new TextEncoder();
function packet(type, id, payload) {
	const b = new Uint8Array(5 + payload.length);
	b[0] = type;
	new DataView(b.buffer).setUint32(1, id, true);
	b.set(payload, 5);
	return b;
}

function check(host) {
	return new Promise((resolve) => {
		const started = Date.now();
		const ws = new WebSocket(`ws://127.0.0.1:${port}/wisp/`);
		const done = (result) => {
			clearTimeout(timer);
			ws.close();
			resolve(`${host}: ${result} (${Date.now() - started} ms)`);
		};
		const timer = setTimeout(() => done("NO ANSWER (timed out)"), TIMEOUT);
		ws.on("open", () => {
			const name = enc.encode(host);
			const connect = new Uint8Array(3 + name.length);
			connect[0] = 1; // TCP
			new DataView(connect.buffer).setUint16(1, 80, true);
			connect.set(name, 3);
			ws.send(packet(1, 1, connect));
			ws.send(packet(2, 1, enc.encode(`GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`)));
		});
		ws.on("message", (data) => {
			const u = new Uint8Array(data);
			const id = new DataView(u.buffer, u.byteOffset).getUint32(1, true);
			if (id !== 1) return;
			if (u[0] === 2) done("OK, got " + JSON.stringify(Buffer.from(u.slice(5, 20)).toString()));
			if (u[0] === 4) done("CLOSED by the proxy, reason " + u[5]);
		});
		ws.on("error", (e) => done("websocket error " + e.message));
	});
}

const results = [];
for (const host of HOSTS) results.push(await check(host));
console.log("\n" + results.join("\n"));
process.exit(0);
