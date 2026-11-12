// ROKI service worker v3.
// v2: the first one was installed while ROKI was cross-origin isolated; changing this file makes
// browsers install a fresh one that isn't.
// v3: ad block.
importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

/* ---------- Ad block (Settings > Proxy > Ad block) ---------- */
// Requests to these sites (and their subdomains) get an empty answer instead of going out.
// YouTube serves its video ads from its own servers, so those still play.
const AD_HOSTS = [
	"doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
	"google-analytics.com", "googletagservices.com", "pagead2.googlesyndication.com",
	"amazon-adsystem.com", "adnxs.com", "adsrvr.org", "taboola.com", "outbrain.com",
	"criteo.com", "criteo.net", "scorecardresearch.com", "pubmatic.com", "rubiconproject.com",
	"openx.net", "moatads.com", "quantserve.com", "adform.net", "smartadserver.com",
	"media.net", "popads.net", "propellerads.com", "exoclick.com", "adsterra.com",
	"hotjar.com", "yieldmo.com", "sharethrough.com", "33across.com", "teads.tv",
	"casalemedia.com", "indexww.com", "lijit.com", "sovrn.com", "bidswitch.net",
];
const PREFIX = "/scramjet/";

// On unless turned off. The page saves the switch in the "roki-config" cache and also messages us.
let adblock = null;
async function adblockOn() {
	if (adblock === null) {
		try {
			const saved = await (await caches.open("roki-config")).match("/__roki/adblock");
			adblock = saved ? (await saved.text()) !== "0" : true;
		} catch (e) {
			adblock = true;
		}
	}
	return adblock;
}
self.addEventListener("message", (e) => {
	if (e.data && e.data.type === "roki-adblock") adblock = !!e.data.on;
});

function isAd(requestUrl) {
	try {
		const url = new URL(requestUrl);
		if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return false;
		const host = new URL(decodeURIComponent(url.pathname.slice(PREFIX.length) + url.search)).hostname.toLowerCase();
		return AD_HOSTS.some((h) => host === h || host.endsWith("." + h));
	} catch (e) {
		return false;
	}
}

async function handleRequest(event) {
	await scramjet.loadConfig();
	if (scramjet.route(event)) {
		if (isAd(event.request.url) && (await adblockOn())) return new Response(null, { status: 204 });
		return scramjet.fetch(event);
	}
	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
