// Settings' Account card: shows who's logged in and changes the password.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const nameEl = $("acct-name");
	const form = $("acct-form");
	if (!nameEl || !form) return;
	const status = $("acct-status");
	const current = $("acct-current");
	const next = $("acct-new");
	const save = $("acct-save");

	fetch("/account/me", { cache: "no-store" })
		.then((r) => (r.ok ? r.json() : null))
		.then((d) => { if (d && d.name) nameEl.textContent = d.name; })
		.catch(() => {});

	function say(text, bad) {
		status.textContent = text;
		status.style.color = bad ? "var(--danger)" : "";
	}

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		if (!current.value || !next.value) return say("Type your current password and a new one.", true);
		if (next.value.length < 6) return say("New passwords need at least 6 characters.", true);
		save.disabled = true;
		try {
			const r = await fetch("/account/password", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ current: current.value, password: next.value }),
			});
			const data = await r.json().catch(() => ({}));
			if (r.ok) {
				current.value = "";
				next.value = "";
				say("Password changed. Other browsers are logged out.");
			} else {
				say(data.error || "Couldn't change it. Try again.", true);
			}
		} catch (err) {
			say("Can't reach ROKI right now. Try again.", true);
		}
		save.disabled = false;
	});
})();
