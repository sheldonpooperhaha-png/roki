// ROKI at a pages.dev address (roki-hub.pages.dev).
// Cloudflare Pages runs this for every request and passes it on to ROKI's server, including the proxy's
// live connection (/wisp/), so the address bar stays on pages.dev while ROKI itself runs on the server.
//
// To update it: Cloudflare dashboard → Workers & Pages → roki-hub → Create deployment → drop this folder.
// If the server's address ever changes, change ROKI_SERVER below and upload again.
const ROKI_SERVER = "https://18-217-91-210.nip.io";

export default {
	async fetch(request) {
		const here = new URL(request.url);
		const server = new URL(ROKI_SERVER);
		const target = new URL(here.pathname + here.search, server);
		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		const upstream = new Request(target, {
			method: request.method,
			headers: request.headers,
			body: hasBody ? request.body : undefined,
			redirect: "manual",
			duplex: "half",
		});

		let res;
		try {
			res = await fetch(upstream);
		} catch (e) {
			return new Response("Can't reach ROKI's server right now. Try again in a minute.\n", {
				status: 502,
				headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
			});
		}

		// The proxy's WebSocket: hand Cloudflare's connection straight back
		if (res.status === 101 || res.webSocket) return res;

		// Redirects that name the server's own address go to this pages.dev address instead
		const out = new Response(res.body, res);
		const location = out.headers.get("location");
		if (location && /^([a-z][a-z0-9+.-]*:)?\/\//i.test(location)) {
			try {
				const to = new URL(location, target);
				if (to.host === server.host) out.headers.set("location", here.origin + to.pathname + to.search + to.hash);
			} catch (e) {
				// leave it as it is
			}
		}
		return out;
	},
};
