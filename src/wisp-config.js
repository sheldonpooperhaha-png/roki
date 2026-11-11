// How ROKI's proxy server (wisp) connects to sites. Used by src/index.js and tools/wisp-check.mjs.
// Options: https://www.npmjs.com/package/@mercuryworkshop/wisp-js
export const WISP_OPTIONS = {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	// Cloudflare family DNS (blocks malware and adult sites). "resolve" makes wisp actually use these servers.
	dns_method: "resolve",
	dns_servers: ["1.1.1.3", "1.0.0.3"],
	// Connect over IPv4 first. Wisp's default tries IPv6 first, and on servers or home networks
	// where IPv6 doesn't really work (like the Lightsail server), every site just hangs.
	dns_result_order: "ipv4first",
};
