// Run: node --test tools/scramjet-patch.test.mjs
// Checks ROKI's fix for Scramjet 1.1.0's WebSocket handlers (src/scramjet-patch.js) against the
// real scramjet.all.js that ROKI serves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";

import { patchScramjet } from "../src/scramjet-patch.js";

const original = readFileSync(join(scramjetPath, "scramjet.all.js"), "utf8");

// Pulls Scramjet's "fire this WebSocket event" helper out of the file and runs it on its own.
// In the file it reads: function o(e){ s["on"+e.type]...(...), i.dispatchEvent(e) }
// where i is the WebSocket the page holds and s is Scramjet's private state for it.
function fireHelper(code) {
	const m = code.match(/function o\(e\)\{s\["on"\+e\.type\][^]*?i\.dispatchEvent\(e\)\}/);
	assert.ok(m, "Scramjet's WebSocket event helper wasn't found");
	return (s, i) => new Function("s", "i", m[0] + "; return o;")(s, i);
}

function handlerThis(code) {
	const socket = new EventTarget();
	let seen;
	const state = { onopen() { seen = this; } };
	fireHelper(code)(state, socket)(new Event("open"));
	return { seen, socket, state };
}

test("unpatched Scramjet runs onopen with the wrong `this` (the bug)", () => {
	const { seen, state } = handlerThis(original);
	assert.equal(seen, state);
});

test("patched Scramjet runs onopen with `this` set to the page's WebSocket", () => {
	const { code, applied } = patchScramjet(original);
	assert.equal(applied, true);
	const { seen, socket } = handlerThis(code);
	assert.equal(seen, socket);
});

test("addEventListener listeners still fire after the patch", () => {
	const { code } = patchScramjet(original);
	const socket = new EventTarget();
	let fired = 0;
	socket.addEventListener("message", () => fired++);
	fireHelper(code)({ onmessage: null }, socket)(new MessageEvent("message", { data: "hi" }));
	assert.equal(fired, 1);
});

test("a Scramjet build without the bug is left alone", () => {
	const other = "console.log('some other build')";
	assert.deepEqual(patchScramjet(other), { code: other, applied: false });
});
