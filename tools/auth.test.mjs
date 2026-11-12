// Run: node --test tools/auth.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAuth, isKeyShaped } from "../src/auth.js";

test("invite words can be short (4 to 128 letters, numbers, - or _)", () => {
	for (const ok of ["roki", "my-roki_2", "a".repeat(128), "ABCD"]) assert.equal(isKeyShaped(ok), true, ok);
	for (const bad of ["abc", "", "has space", "roki!", "a".repeat(129), "émoji"]) assert.equal(isKeyShaped(bad), false, bad);
});

test("a short key works for joining, and only exactly", () => {
	const auth = createAuth("roki");
	assert.equal(auth.checkKey("roki"), true);
	assert.equal(auth.checkKey("Roki"), false);
	assert.equal(auth.checkKey("rokii"), false);
});
