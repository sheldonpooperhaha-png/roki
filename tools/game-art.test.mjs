// Run: node --test tools/game-art.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createArtCache, findArtUrl, isPrivateAddress, loadCatalogGames, smallerArt } from "../src/game-art.js";

const PAGE = "https://poki.com/en/g/drive-mad";
const POKI_ART = "https://img.poki-cdn.com/cdn-cgi/image/q=78,scq=50,width=1200,height=1200,fit=cover,f=png/abc123/drive-mad.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

/* ---------- finding the picture in a page ---------- */

test("finds og:image whichever order the attributes are in", () => {
	assert.equal(findArtUrl(`<head><meta property="og:image" content="https://a.com/x.png"></head>`, PAGE), "https://a.com/x.png");
	assert.equal(findArtUrl(`<meta content='https://a.com/y.jpg' property='og:image' />`, PAGE), "https://a.com/y.jpg");
	assert.equal(findArtUrl(`<META PROPERTY=og:image CONTENT=https://a.com/z.webp>`, PAGE), "https://a.com/z.webp");
});

test("decodes &amp; and makes relative pictures absolute", () => {
	assert.equal(findArtUrl(`<meta property="og:image" content="/img/a.png?w=1&amp;h=2">`, PAGE), "https://poki.com/img/a.png?w=1&h=2");
});

test("falls back to twitter:image, then link rel=image_src", () => {
	assert.equal(findArtUrl(`<meta name="twitter:image" content="https://a.com/t.png">`, PAGE), "https://a.com/t.png");
	assert.equal(findArtUrl(`<link rel="image_src" href="https://a.com/l.png">`, PAGE), "https://a.com/l.png");
	assert.equal(
		findArtUrl(`<meta name="twitter:image" content="https://a.com/t.png"><meta property="og:image" content="https://a.com/o.png">`, PAGE),
		"https://a.com/o.png",
	);
});

test("ignores pages without a picture and non-web links", () => {
	assert.equal(findArtUrl(`<head><title>x</title></head>`, PAGE), null);
	assert.equal(findArtUrl(`<meta property="og:image" content="javascript:alert(1)">`, PAGE), null);
	assert.equal(findArtUrl(`<meta property="og:image" content="data:image/png;base64,AAAA">`, PAGE), null);
});

test("asks Poki's image server for a small square instead of the 1200px one", () => {
	assert.equal(
		smallerArt(POKI_ART),
		"https://img.poki-cdn.com/cdn-cgi/image/width=320,height=320,fit=cover,quality=80,format=webp/abc123/drive-mad.png",
	);
	assert.equal(smallerArt("https://a.com/x.png"), null);
});

test("knows private and local addresses", () => {
	for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::"]) {
		assert.equal(isPrivateAddress(ip), true, ip);
	}
	for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.1.1", "2606:4700::1111"]) {
		assert.equal(isPrivateAddress(ip), false, ip);
	}
});

test("reads the Play online games out of public/catalog.js", () => {
	const games = loadCatalogGames(readFileSync(new URL("../public/catalog.js", import.meta.url), "utf8"));
	assert.ok(games.length > 30, `only ${games.length} games`);
	assert.deepEqual(Array.from(games.filter((g) => /poki\.com/i.test(g.url)), (g) => g.name), [], "Poki games don't play outside poki.com");
	assert.ok(games.every((g) => /^https:\/\//.test(g.url) && typeof g.name === "string"));
	assert.equal(new Set(games.map((g) => g.url)).size, games.length, "a game is listed twice");
	assert.equal(new Set(games.map((g) => g.name.toLowerCase())).size, games.length, "two games share a name");
});

/* ---------- fetching and caching ---------- */

const html = (art) => `<!doctype html><html><head><meta property="og:image" content="${art}"></head><body>${"x".repeat(5000)}</body></html>`;
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function fakeWeb(routes) {
	const calls = [];
	const fetchImpl = async (url, opts) => {
		calls.push(url);
		assert.equal(opts.redirect, "manual");
		const r = routes[url];
		if (!r) return new Response("nope", { status: 404 });
		if (r.redirect) return new Response(null, { status: 302, headers: { location: r.redirect } });
		return new Response(r.body, { status: 200, headers: { "content-type": r.type } });
	};
	return { fetchImpl, calls };
}

test("gets the small Poki picture from the game's page", async () => {
	const small = smallerArt(POKI_ART);
	const web = fakeWeb({ [PAGE]: { body: html(POKI_ART), type: "text/html" }, [small]: { body: PNG, type: "image/webp" } });
	const getArt = createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup });
	const art = await getArt({ url: PAGE });
	assert.equal(art.type, "image/webp");
	assert.deepEqual(new Uint8Array(art.body), PNG);
	assert.deepEqual(web.calls, [PAGE, small]);
	await getArt({ url: PAGE }); // cached
	assert.equal(web.calls.length, 2);
});

test("uses the full-size picture if the small one fails", async () => {
	const web = fakeWeb({ [PAGE]: { body: html(POKI_ART), type: "text/html" }, [POKI_ART]: { body: PNG, type: "image/png" } });
	const art = await createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup })({ url: PAGE });
	assert.equal(art.type, "image/png");
});

test("a game's own img skips reading its page", async () => {
	const web = fakeWeb({ "https://cdn.example/a.jpg": { body: PNG, type: "image/jpeg" } });
	const art = await createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup })({ url: PAGE, img: "https://cdn.example/a.jpg" });
	assert.equal(art.type, "image/jpeg");
	assert.deepEqual(web.calls, ["https://cdn.example/a.jpg"]);
});

test("follows redirects but never to a private address", async () => {
	const web = fakeWeb({
		[PAGE]: { body: html("https://cdn.example/a.png"), type: "text/html" },
		"https://cdn.example/a.png": { redirect: "http://metadata.internal.test/latest" },
		"http://metadata.internal.test/latest": { body: PNG, type: "image/png" },
	});
	const lookupImpl = async (host) => [{ address: host === "metadata.internal.test" ? "169.254.169.254" : "93.184.216.34", family: 4 }];
	const art = await createArtCache({ fetchImpl: web.fetchImpl, lookupImpl })({ url: PAGE });
	assert.equal(art, null);
	assert.ok(!web.calls.includes("http://metadata.internal.test/latest"));
});

test("follows ordinary redirects", async () => {
	const web = fakeWeb({
		[PAGE]: { redirect: "https://poki.com/en/g/drive-mad-2" },
		"https://poki.com/en/g/drive-mad-2": { body: html("http://cdn.example/a.png"), type: "text/html" },
		"http://cdn.example/a.png": { redirect: "https://cdn.example/a.png" },
		"https://cdn.example/a.png": { body: PNG, type: "image/png" },
	});
	const art = await createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup })({ url: PAGE });
	assert.equal(art.type, "image/png");
});

test("refuses SVGs, non-images and pictures that are too big", async () => {
	for (const [type, body] of [["image/svg+xml", "<svg/>"], ["text/html", "<html>"], ["image/png", new Uint8Array(3000)]]) {
		const web = fakeWeb({ "https://cdn.example/a": { body, type } });
		const getArt = createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup, maxImage: 2000 });
		assert.equal(await getArt({ url: PAGE, img: "https://cdn.example/a" }), null, type);
	}
});

test("remembers a failure for a while instead of asking again every time", async () => {
	const web = fakeWeb({});
	const getArt = createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup });
	assert.equal(await getArt({ url: PAGE }), null);
	assert.equal(await getArt({ url: PAGE }), null);
	assert.equal(web.calls.length, 1);
});

test("keeps the cache under its size budget, dropping the oldest first", async () => {
	const routes = {};
	for (let i = 0; i < 5; i++) routes[`https://cdn.example/${i}.png`] = { body: new Uint8Array(400), type: "image/png" };
	const web = fakeWeb(routes);
	const getArt = createArtCache({ fetchImpl: web.fetchImpl, lookupImpl: publicLookup, maxBytes: 1000 });
	for (let i = 0; i < 5; i++) await getArt({ url: `${PAGE}?${i}`, img: `https://cdn.example/${i}.png` });
	assert.equal(web.calls.length, 5);
	await getArt({ url: `${PAGE}?4`, img: "https://cdn.example/4.png" }); // newest: still cached
	assert.equal(web.calls.length, 5);
	await getArt({ url: `${PAGE}?0`, img: "https://cdn.example/0.png" }); // oldest: dropped, fetched again
	assert.equal(web.calls.length, 6);
});

test("asks for only a few pictures at a time", async () => {
	let open = 0;
	let most = 0;
	const fetchImpl = async () => {
		open++;
		most = Math.max(most, open);
		await new Promise((r) => setTimeout(r, 5));
		open--;
		return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
	};
	const getArt = createArtCache({ fetchImpl, lookupImpl: publicLookup, concurrency: 3 });
	await Promise.all(Array.from({ length: 12 }, (_, i) => getArt({ url: `${PAGE}?${i}`, img: `https://cdn.example/${i}.png` })));
	assert.ok(most <= 3, `${most} at once`);
});
