// Run: node --test tools/pages-worker.test.mjs
// Checks deploy/cloudflare-pages/_worker.js (ROKI at a pages.dev address) with a stand-in for fetch().
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import worker from "../deploy/cloudflare-pages/_worker.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function serverReplies(make) {
	const seen = [];
	globalThis.fetch = async (req) => {
		seen.push(req);
		return make(req);
	};
	return seen;
}

test("passes a page request to ROKI's server, path, query, cookies and all", async () => {
	const seen = serverReplies(() => new Response("<h1>ROKI</h1>", { status: 200, headers: { "content-type": "text/html", "set-cookie": "roki_auth=abc; Path=/; HttpOnly; Secure" } }));
	const res = await worker.fetch(new Request("https://roki-hub.pages.dev/games/list.json?x=1", { headers: { cookie: "roki_auth=abc" } }));
	assert.equal(seen[0].url, "https://18-217-91-210.nip.io/games/list.json?x=1");
	assert.equal(seen[0].headers.get("cookie"), "roki_auth=abc");
	assert.equal(seen[0].redirect, "manual");
	assert.equal(res.status, 200);
	assert.equal(await res.text(), "<h1>ROKI</h1>");
	assert.match(res.headers.get("set-cookie"), /roki_auth=abc/);
});

test("sends POST bodies along", async () => {
	const seen = serverReplies(() => new Response("ok"));
	await worker.fetch(new Request("https://roki-hub.pages.dev/x", { method: "POST", body: "hello" }));
	assert.equal(seen[0].method, "POST");
	assert.equal(await seen[0].text(), "hello");
});

test("keeps redirects on the pages.dev address", async () => {
	serverReplies(() => new Response(null, { status: 302, headers: { location: "/login?link=bad" } }));
	let res = await worker.fetch(new Request("https://roki-hub.pages.dev/join/nope"));
	assert.equal(res.status, 302);
	assert.equal(res.headers.get("location"), "/login?link=bad");

	serverReplies(() => new Response(null, { status: 302, headers: { location: "https://18-217-91-210.nip.io/login#x" } }));
	res = await worker.fetch(new Request("https://roki-hub.pages.dev/"));
	assert.equal(res.headers.get("location"), "https://roki-hub.pages.dev/login#x");

	serverReplies(() => new Response(null, { status: 302, headers: { location: "https://example.com/" } }));
	res = await worker.fetch(new Request("https://roki-hub.pages.dev/"));
	assert.equal(res.headers.get("location"), "https://example.com/");
});

test("hands the proxy's WebSocket answer straight back", async () => {
	const upgraded = { status: 101, webSocket: {}, headers: new Headers() };
	const seen = serverReplies(() => upgraded);
	const res = await worker.fetch(new Request("https://roki-hub.pages.dev/wisp/", { headers: { upgrade: "websocket", "sec-websocket-key": "k" } }));
	assert.equal(res, upgraded);
	assert.equal(seen[0].headers.get("upgrade"), "websocket");
	assert.equal(seen[0].url, "https://18-217-91-210.nip.io/wisp/");
});

test("says so plainly if the server can't be reached", async () => {
	globalThis.fetch = async () => { throw new Error("connection refused"); };
	const res = await worker.fetch(new Request("https://roki-hub.pages.dev/"));
	assert.equal(res.status, 502);
	assert.match(await res.text(), /can't reach/i);
});
