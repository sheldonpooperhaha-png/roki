// Run: node --test tools/chat.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanName, cleanText, createChat, MAX_TEXT, sseEvent } from "../src/chat.js";

test("cleans names: trims, squashes spaces, drops hidden characters, caps the length", () => {
	assert.equal(cleanName("  Sam   the  Man "), "Sam the Man");
	assert.equal(cleanName("a‮b​c\u0007"), "abc");
	assert.equal(cleanName("x".repeat(40)), "x".repeat(20));
	assert.equal(cleanName("   "), null);
	assert.equal(cleanName(42), null);
});

test("cleans messages and refuses ones that are too long", () => {
	assert.equal(cleanText("  hi   there \r\n\n\n\nyo "), "hi there\n\nyo");
	assert.equal(cleanText("‮hi"), "hi");
	assert.equal(cleanText(""), null);
	assert.equal(cleanText("x".repeat(MAX_TEXT)), "x".repeat(MAX_TEXT));
	assert.equal(cleanText("x".repeat(MAX_TEXT + 1)), false);
});

test("posts messages, keeps only the newest ones and sends history after an id", () => {
	let t = 0;
	const chat = createChat({ max: 3, now: () => (t += 1000), gapMs: 0 });
	for (const word of ["a", "b", "c", "d"]) assert.equal(chat.post("ip" + word, "Sam", word).ok, true);
	assert.deepEqual(chat.history().map((m) => m.text), ["b", "c", "d"]);
	const [, second] = chat.history();
	assert.deepEqual(chat.history(second.id).map((m) => m.text), ["d"]);
});

test("refuses bad input with a reason", () => {
	const chat = createChat();
	assert.deepEqual(chat.post("x", "", "hi"), { ok: false, status: 400, error: "Pick a name first." });
	assert.equal(chat.post("x", "Sam", "   ").status, 400);
	assert.equal(chat.post("x", "Sam", "x".repeat(MAX_TEXT + 5)).status, 400);
});

test("slows down spam from one person, and repeats", () => {
	let t = 0;
	const chat = createChat({ now: () => t, burst: 3, windowMs: 10_000, gapMs: 500 });
	assert.equal(chat.post("a", "Sam", "1").ok, true);
	t += 100;
	assert.equal(chat.post("a", "Sam", "2").status, 429, "too soon after the last one");
	t += 600;
	assert.equal(chat.post("a", "Sam", "2").ok, true);
	t += 600;
	assert.equal(chat.post("a", "Sam", "3").ok, true);
	t += 600;
	assert.equal(chat.post("a", "Sam", "4").status, 429, "burst used up");
	assert.equal(chat.post("b", "Alex", "hey").ok, true, "someone else can still talk");
	t += 10_000;
	assert.equal(chat.post("a", "Sam", "4").ok, true, "and the limit resets");
	t += 1000;
	assert.equal(chat.post("a", "Sam", "4").status, 409, "the same message twice");
});

test("pushes new messages and the online count to listeners", () => {
	const chat = createChat({ gapMs: 0 });
	const got = [];
	const stop = chat.subscribe((e) => got.push(e));
	assert.equal(chat.online(), 1);
	chat.post("a", "Sam", "hello <b>");
	stop();
	assert.equal(chat.online(), 0);
	assert.ok(got[0].startsWith("event: online"));
	const msg = got.find((e) => e.includes("event: msg"));
	assert.match(msg, /^id: 1\nevent: msg\ndata: \{.*"text":"hello <b>".*\}\n\n$/);
	assert.equal(sseEvent("x", { a: 1 }), 'event: x\ndata: {"a":1}\n\n');
});

test("saves history to a file and picks it up again after a restart", async () => {
	const file = join(mkdtempSync(join(tmpdir(), "roki-chat-")), "chat.json");
	const one = createChat({ file, saveDelay: 5, gapMs: 0 });
	one.post("a", "Sam", "first");
	one.post("b", "Alex", "second");
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(JSON.parse(readFileSync(file, "utf8")).messages.length, 2);
	const two = createChat({ file, gapMs: 0 });
	assert.deepEqual(two.history().map((m) => m.text), ["first", "second"]);
	assert.equal(two.post("c", "Kai", "third").message.id, 3, "ids keep counting up");
});
