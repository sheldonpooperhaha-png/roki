// Run: node --test tools/accounts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAccounts, passwordProblem, validName } from "../src/accounts.js";

const fresh = (opts = {}) => createAccounts({ secret: "test-secret", ...opts });
const cookieValue = (setCookie) => setCookie.split(";")[0];

test("usernames and passwords follow the rules", () => {
	assert.equal(validName("Sam_2"), true);
	assert.equal(validName("ab"), false);
	assert.equal(validName("has space"), false);
	assert.equal(validName("x".repeat(21)), false);
	assert.match(passwordProblem("12345"), /at least 6/);
	assert.match(passwordProblem("SamSam", "samsam"), /can't be your username/);
	assert.equal(passwordProblem("good pass"), null);
});

test("signs up, refuses taken names in any case, and logs in", async () => {
	const acc = fresh();
	assert.equal((await acc.signup("Sam", "hunter22")).ok, true);
	assert.match((await acc.signup("sam", "another1")).error, /taken/);
	const ok = await acc.login("SAM", "hunter22");
	assert.deepEqual(ok, { ok: true, user: { key: "sam", name: "Sam", role: null } });
	assert.equal((await acc.login("Sam", "wrong-pass")).error, "Wrong username or password.");
	assert.equal((await acc.login("nobody", "hunter22")).error, "Wrong username or password.", "same answer for a missing account");
});

test("the session cookie logs the right account in, and only if untouched", async () => {
	const acc = fresh();
	const { user } = await acc.signup("Alex", "pass1234");
	const c = cookieValue(acc.sessionCookie(user, true));
	assert.deepEqual(acc.userFromCookie(`other=1; ${c}`), { key: "alex", name: "Alex", role: null });
	assert.match(acc.sessionCookie(user, true), /HttpOnly; SameSite=Lax; Secure$/);
	const forged = c.replace(/\.[^.]+$/, ".AAAA");
	assert.equal(acc.userFromCookie(forged), null);
	const other = createAccounts({ secret: "different" });
	assert.equal(other.userFromCookie(c), null, "a cookie signed with another secret");
	assert.equal(acc.userFromCookie(""), null);
});

test("changing a password logs out old sessions", async () => {
	const acc = fresh();
	const { user } = await acc.signup("Kai", "first-pass");
	const old = cookieValue(acc.sessionCookie(user));
	assert.match((await acc.changePassword("kai", "nope-nope", "second-pass")).error, /current password/);
	assert.equal((await acc.changePassword("kai", "first-pass", "second-pass")).ok, true);
	assert.equal(acc.userFromCookie(old), null);
	assert.equal((await acc.login("Kai", "second-pass")).ok, true);
});

test("sessions run out after 30 days", async () => {
	let t = Date.now();
	const acc = fresh({ now: () => t });
	const { user } = await acc.signup("Lee", "pass-word");
	const c = cookieValue(acc.sessionCookie(user));
	t += 29 * 86400 * 1000;
	assert.ok(acc.userFromCookie(c));
	t += 2 * 86400 * 1000;
	assert.equal(acc.userFromCookie(c), null);
});

test("locks an account for a while after many wrong passwords", async () => {
	const acc = fresh();
	await acc.signup("Mo", "right-pass");
	for (let i = 0; i < 8; i++) await acc.login("Mo", "wrong" + i);
	assert.match((await acc.login("Mo", "right-pass")).error, /Too many wrong passwords/);
});

test("saves to a file without plain passwords, and picks up outside changes", async () => {
	const file = join(mkdtempSync(join(tmpdir(), "roki-acc-")), "accounts.json");
	let t = Date.now();
	const acc = fresh({ file, now: () => t });
	await acc.signup("Sam", "secret-pass");
	const raw = readFileSync(file, "utf8");
	assert.ok(!raw.includes("secret-pass"));
	assert.equal(fresh({ file }).count(), 1, "a restart keeps accounts");
	// the owner's tool removes the account in the file
	const data = JSON.parse(raw);
	delete data.users.sam;
	writeFileSync(file, JSON.stringify(data));
	t += 5000;
	assert.equal((await acc.login("Sam", "secret-pass")).ok, false);
});

test("the owner can reset a password or remove an account", async () => {
	const acc = fresh();
	const { user } = await acc.signup("Tyler", "forgot-it");
	const c = cookieValue(acc.sessionCookie(user));
	assert.equal((await acc.resetPassword("TYLER", "brand-new")).ok, true);
	assert.equal(acc.userFromCookie(c), null);
	assert.equal((await acc.login("tyler", "brand-new")).ok, true);
	assert.equal(acc.remove("tyler"), true);
	assert.equal(acc.count(), 0);
});

test("only the accounts tool gives the Owner tag, and it survives a restart", async () => {
	const file = join(mkdtempSync(join(tmpdir(), "roki-own-")), "accounts.json");
	const acc = fresh({ file });
	const { user } = await acc.signup("Youssef", "owner-pass");
	assert.deepEqual(acc.owners(), []);
	assert.equal(acc.setRole("youssef", "owner"), true);
	assert.deepEqual(acc.owners(), ["Youssef"]);
	const c = cookieValue(acc.sessionCookie(user));
	assert.equal(acc.userFromCookie(c).role, "owner");
	assert.deepEqual(fresh({ file }).owners(), ["Youssef"]);
	assert.equal(acc.setRole("youssef", null), true);
	assert.deepEqual(acc.owners(), []);
	assert.equal(acc.setRole("nobody", "owner"), false);
});

test("a banned account can't log in and its sessions stop working; unbanning lets it back", async () => {
	const acc = fresh();
	const { user } = await acc.signup("Spammer", "spam-pass");
	const c = cookieValue(acc.sessionCookie(user));
	assert.ok(acc.userFromCookie(c));
	assert.equal(acc.setBanned("spammer", true), true);
	assert.equal(acc.userFromCookie(c), null);
	assert.match((await acc.login("Spammer", "spam-pass")).error, /banned/);
	assert.equal(acc.list()[0].banned, true);
	acc.setBanned("spammer", false);
	assert.equal((await acc.login("Spammer", "spam-pass")).ok, true);
});

test("a change from the accounts tool isn't lost when the site saves right after it", async () => {
	const file = join(mkdtempSync(join(tmpdir(), "roki-race-")), "accounts.json");
	const t = Date.now();
	const site = fresh({ file, now: () => t });
	await site.signup("Youssef", "owner-pass");
	site.owners(); // the site just checked the file, so a plain check would wait 2 seconds
	const tool = fresh({ file });
	assert.equal(tool.setRole("youssef", "owner"), true);
	await site.signup("Alex", "alex-pass"); // saves right away
	site.setBanned("alex", true);
	assert.deepEqual(fresh({ file }).owners(), ["Youssef"], "the Owner tag survived");
	assert.equal(fresh({ file }).count(), 2);
});

test("remembers when each account was last seen", async () => {
	let t = 1_000_000;
	const acc = fresh({ now: () => t });
	const { user } = await acc.signup("Seen", "seen-pass");
	const c = cookieValue(acc.sessionCookie(user));
	assert.equal(acc.list()[0].seen, null);
	t += 5000;
	acc.userFromCookie(c);
	assert.equal(acc.list()[0].seen, t);
});
