// A fix for Scramjet 1.1.0, applied to scramjet.all.js as ROKI serves it (the installed package is
// left as it is).
//
// Scramjet hands proxied pages a stand-in WebSocket. When the connection opens, gets a message, errors
// or closes, it runs the page's onopen/onmessage/onerror/onclose handler as a method of its own private
// state object, so inside the handler `this` is that object instead of the WebSocket. Games that check
// `this` (slither.io does `if (this != ws) this.close()`) crash there and never connect.
// The fix runs the handler with `this` set to the page's WebSocket, like a real browser does.

const BUGGY = 'function o(e){s["on"+e.type]?.(new Proxy(e,';
const FIXED = 'function o(e){s["on"+e.type]?.call(i,new Proxy(e,';

// Returns { code, applied }. A different Scramjet build is returned unchanged with applied: false.
export function patchScramjet(source) {
	const at = source.indexOf(BUGGY);
	if (at === -1 || source.indexOf(BUGGY, at + 1) !== -1) return { code: source, applied: false };
	return { code: source.slice(0, at) + FIXED + source.slice(at + BUGGY.length), applied: true };
}
