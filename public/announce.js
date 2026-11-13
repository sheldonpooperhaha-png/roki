// The Owner's pinned announcement as a banner on the home page. Hiding it hides that announcement only;
// a new one shows again.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const box = $("announce");
	if (!box) return;
	const text = $("announce-text");
	const by = $("announce-by");
	let current = null;
	const store = {
		get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
	};
	const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

	async function check() {
		try {
			const r = await fetch("/announcement", { cache: "no-store" });
			if (!r.ok) return;
			const p = (await r.json()).pinned;
			current = p;
			box.hidden = !p || store.get("roki:announce-hidden") === String(p.at);
			if (p) {
				text.textContent = p.text;
				by.textContent = `${p.by} · ${timeFmt.format(new Date(p.at))}`;
			}
		} catch (e) {
			// try again next time
		}
	}
	$("announce-close").addEventListener("click", () => {
		if (current) store.set("roki:announce-hidden", String(current.at));
		box.hidden = true;
	});
	check();
	setInterval(() => { if (!document.hidden) check(); }, 60_000);
})();
