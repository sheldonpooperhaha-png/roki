// Run: node --test tools/icons.test.mjs
// ROKI's app icons (src/icons.js): each site's own large icon (web app manifest or apple-touch-icon),
// with Google's favicon service as the fallback.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createIconCache, findIconLinks, imageSize, pickManifestIcons } from "../src/icons.js";

// A real-looking PNG header of the given size (the rest of the file doesn't matter here)
function png(w, h, extra = 64) {
	const b = Buffer.alloc(33 + extra);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
	b.writeUInt32BE(13, 8);
	b.write("IHDR", 12, "latin1");
	b.writeUInt32BE(w, 16);
	b.writeUInt32BE(h, 20);
	return b;
}
const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
const S2 = (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=256`;

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

/* ---------- reading pages and manifests ---------- */

test("finds the manifest, apple-touch-icon and sized icon links in a page", () => {
	const html = `<head>
		<link rel="manifest" href="/manifest.webmanifest">
		<link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
		<link rel="icon" type="image/png" sizes="192x192" href="https://cdn.site.com/i192.png">
		<link rel="icon" href="/favicon.ico">
		<link rel="shortcut icon" href="/f.svg" type="image/svg+xml">
	</head>`;
	const got = findIconLinks(html, "https://site.com/");
	assert.equal(got.manifest, "https://site.com/manifest.webmanifest");
	assert.deepEqual(got.icons, [
		{ src: "https://site.com/apple.png", size: 180 },
		{ src: "https://cdn.site.com/i192.png", size: 192 },
	]);
});

test("apple-touch-icon without sizes counts as 180", () => {
	assert.deepEqual(findIconLinks(`<link rel="apple-touch-icon" href="a.png">`, "https://x.com/p/").icons, [{ src: "https://x.com/p/a.png", size: 180 }]);
});

test("picks manifest icons: raster only, 'any' before 'maskable', largest size per icon", () => {
	const manifest = {
		icons: [
			{ src: "/i/48.png", sizes: "48x48", type: "image/png" },
			{ src: "/i/512.png", sizes: "512x512", type: "image/png" },
			{ src: "/i/m512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
			{ src: "/i/any.svg", sizes: "any", type: "image/svg+xml" },
			{ src: "icons/192.webp", sizes: "96x96 192x192" },
		],
	};
	assert.deepEqual(pickManifestIcons(manifest, "https://site.com/app/manifest.json"), [
		{ src: "https://site.com/i/48.png", size: 48 },
		{ src: "https://site.com/i/512.png", size: 512 },
		{ src: "https://site.com/app/icons/192.webp", size: 192 },
		{ src: "https://site.com/i/m512.png", size: 512, maskable: true },
	]);
	assert.deepEqual(pickManifestIcons({ nope: 1 }, "https://site.com/m.json"), []);
});

test("reads the real size of PNG, WebP, JPEG and GIF images", () => {
	assert.deepEqual(imageSize(png(512, 512)), { w: 512, h: 512 });
	const webpX = Buffer.alloc(40);
	webpX.write("RIFF", 0, "latin1"); webpX.write("WEBP", 8, "latin1"); webpX.write("VP8X", 12, "latin1");
	webpX.writeUIntLE(191, 24, 3); webpX.writeUIntLE(191, 27, 3);
	assert.deepEqual(imageSize(webpX), { w: 192, h: 192 });
	const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xb4, 0x00, 0xb4, 0x03]);
	assert.deepEqual(imageSize(jpg), { w: 180, h: 180 });
	const gif = Buffer.from("GIF89a\x40\x00\x20\x00", "latin1");
	assert.deepEqual(imageSize(gif), { w: 64, h: 32 });
	assert.equal(imageSize(Buffer.from("not an image")), null);
});

/* ---------- choosing the icon ---------- */

test("uses the site's big manifest icon instead of Google's small favicon", async () => {
	const web = fakeWeb({
		"https://twitch.tv/": { body: `<head><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/a180.png"></head>`, type: "text/html" },
		"https://twitch.tv/manifest.json": { body: JSON.stringify({ icons: [{ src: "/i/512.png", sizes: "512x512", type: "image/png" }, { src: "/i/192.png", sizes: "192x192", type: "image/png" }] }), type: "application/manifest+json" },
		"https://twitch.tv/i/192.png": { body: png(192, 192), type: "image/png" },
		"https://twitch.tv/i/512.png": { body: png(512, 512), type: "image/png" },
	});
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl })("twitch.tv");
	assert.deepEqual(imageSize(icon.body), { w: 192, h: 192 }, "the smallest icon that's at least 192 wins");
	assert.equal(icon.type, "image/png");
	assert.ok(!web.calls.some((u) => u.includes("google.com/s2")));
});

test("uses the apple-touch-icon when there's no manifest", async () => {
	const web = fakeWeb({
		"https://snapchat.com/": { body: `<link rel="apple-touch-icon" sizes="180x180" href="/apple.png">`, type: "text/html" },
		"https://snapchat.com/apple.png": { body: png(180, 180), type: "image/png" },
	});
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl })("snapchat.com");
	assert.deepEqual(imageSize(icon.body), { w: 180, h: 180 });
});

test("tries the usual /apple-touch-icon.png when the page doesn't name an icon", async () => {
	const web = fakeWeb({
		"https://plain.com/": { body: `<head><title>x</title></head>`, type: "text/html" },
		"https://plain.com/apple-touch-icon.png": { body: png(180, 180), type: "image/png" },
		[S2("plain.com")]: { body: png(32, 32), type: "image/png" },
	});
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl })("plain.com");
	assert.deepEqual(imageSize(icon.body), { w: 180, h: 180 });
	assert.ok(!web.calls.includes(S2("plain.com")));
});

test("tries /apple-touch-icon.png even when the site's page can't be read", async () => {
	const web = fakeWeb({ "https://locked.com/apple-touch-icon.png": { body: png(180, 180), type: "image/png" } });
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl })("locked.com");
	assert.deepEqual(imageSize(icon.body), { w: 180, h: 180 });
});

test("skips icons that turn out tiny and falls back to Google's", async () => {
	const web = fakeWeb({
		"https://tiny.com/": { body: `<link rel="apple-touch-icon" href="/apple.png">`, type: "text/html" },
		"https://tiny.com/apple.png": { body: png(32, 32), type: "image/png" },
		[S2("tiny.com")]: { body: png(64, 64), type: "image/png" },
	});
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl })("tiny.com");
	assert.deepEqual(imageSize(icon.body), { w: 64, h: 64 });
	assert.equal(web.calls.at(-1), S2("tiny.com"));
});

test("falls back to Google's favicon when the site can't be read", async () => {
	const web = fakeWeb({ [S2("blocked.com")]: { body: png(128, 128), type: "image/png" } });
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl })("blocked.com");
	assert.deepEqual(imageSize(icon.body), { w: 128, h: 128 });
});

test("never follows a site's links into the server's own network", async () => {
	const web = fakeWeb({
		"https://evil.com/": { body: `<link rel="apple-touch-icon" href="http://internal.test/secret.png">`, type: "text/html" },
		"http://internal.test/secret.png": { body: png(512, 512), type: "image/png" },
		[S2("evil.com")]: { body: png(64, 64), type: "image/png" },
	});
	const lookup = async (host) => [{ address: host === "internal.test" ? "10.0.0.5" : "93.184.216.34", family: 4 }];
	const icon = await createIconCache({ fetchImpl: web.fetchImpl, lookupImpl: lookup })("evil.com");
	assert.ok(!web.calls.includes("http://internal.test/secret.png"));
	assert.deepEqual(imageSize(icon.body), { w: 64, h: 64 });
});

test("caches icons and remembers failures for a while", async () => {
	const web = fakeWeb({
		"https://a.com/": { body: `<link rel="apple-touch-icon" href="/x.png">`, type: "text/html" },
		"https://a.com/x.png": { body: png(180, 180), type: "image/png" },
	});
	const getIcon = createIconCache({ fetchImpl: web.fetchImpl, lookupImpl });
	await getIcon("a.com");
	const n = web.calls.length;
	await getIcon("a.com");
	assert.equal(web.calls.length, n);
	assert.equal(await getIcon("nothing.com"), null);
	const m = web.calls.length;
	assert.equal(await getIcon("nothing.com"), null);
	assert.equal(web.calls.length, m);
	assert.equal(await getIcon("not a domain"), null);
});
