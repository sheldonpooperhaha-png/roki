// The Admin page, for Owner accounts. The server checks the Owner role on every admin request; this page
// only shows the controls. Everything is drawn with textContent.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const page = $("admin-main");
	const navBtn = $("admin-nav");
	if (!page || !navBtn) return;

	const statsEl = $("admin-stats");
	const accountsEl = $("admin-accounts");
	const accStatus = $("admin-acc-status");
	const pinText = $("admin-pin-text");
	const pinStatus = $("admin-pin-status");
	const msgsEl = $("admin-msgs");
	const chatStatus = $("admin-chat-status");
	const logEl = $("admin-log");

	let me = "";
	let showing = false;
	let timer = null;
	let pinLoaded = false;
	let resetOpen = null; // the account whose "new password" box is open
	const armed = new Map(); // button -> timeout, for "click again to confirm"

	// Only Owners see the Admin button
	fetch("/account/me", { cache: "no-store" })
		.then((r) => (r.ok ? r.json() : null))
		.then((d) => {
			if (d && d.owner) navBtn.hidden = false;
		})
		.catch(() => {});

	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
	function ago(at) {
		if (!at) return "Never";
		const s = Math.max(0, (Date.now() - at) / 1000);
		if (s < 60) return "Just now";
		if (s < 3600) return `${Math.floor(s / 60)} min ago`;
		if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
		return `${Math.floor(s / 86400)} days ago`;
	}
	function uptime(sec) {
		const d = Math.floor(sec / 86400);
		const h = Math.floor((sec % 86400) / 3600);
		const m = Math.floor((sec % 3600) / 60);
		return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
	}
	const el = (tag, cls, text) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		return e;
	};
	function say(where, text, bad) {
		where.textContent = text || "";
		where.classList.toggle("bad", !!bad);
	}

	async function post(path, body, statusEl) {
		try {
			const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
			const d = await r.json().catch(() => ({}));
			if (!r.ok) {
				say(statusEl, d.error || "That didn't work. Try again.", true);
				return false;
			}
			return true;
		} catch (e) {
			say(statusEl, "Can't reach ROKI right now.", true);
			return false;
		}
	}

	// Dangerous buttons need a second click within 4 seconds
	function confirmed(btn, label) {
		if (armed.has(btn)) {
			clearTimeout(armed.get(btn));
			armed.delete(btn);
			return true;
		}
		const old = btn.textContent;
		btn.textContent = label;
		btn.classList.add("armed");
		armed.set(btn, setTimeout(() => {
			armed.delete(btn);
			btn.textContent = old;
			btn.classList.remove("armed");
		}, 4000));
		return false;
	}

	/* ---------- Drawing ---------- */
	function drawStats(s) {
		const tiles = [
			["Online now", s.onlineNow, "in Chat right now"],
			["Accounts", s.accounts, "made so far"],
			["Messages", s.last24h, "in the last 24 hours"],
			["All messages", s.total, "since Chat started"],
			["Uptime", uptime(s.uptimeSec), "since ROKI last started"],
			["Memory", `${s.memoryMB} MB`, "used by ROKI"],
		];
		statsEl.replaceChildren(
			...tiles.map(([label, value, note]) => {
				const t = el("div", "admin-stat");
				t.append(el("span", "admin-stat-label", label), el("span", "admin-stat-value", String(value)), el("span", "admin-stat-note", note));
				return t;
			}),
		);
	}

	function badge(text, cls) {
		return el("span", `admin-badge ${cls}`, text);
	}

	function drawAccounts(list) {
		const rows = [];
		for (const a of list) {
			const self = a.name === me;
			const tr = el("tr");
			const nameCell = el("td", "admin-name");
			const dot = el("span", "admin-dot" + (a.online ? " on" : ""));
			dot.title = a.online ? "Online now" : "Offline";
			nameCell.append(dot, el("strong", "", a.name));
			if (a.role === "owner") nameCell.append(badge("Owner", "owner"));
			if (a.banned) nameCell.append(badge("Banned", "banned"));
			if (a.muted) nameCell.append(badge(a.mutedUntil ? `Muted until ${timeFmt.format(new Date(a.mutedUntil))}` : "Muted", "muted"));
			const joined = el("td", "", a.created ? dateFmt.format(new Date(a.created)) : "—");
			const seen = el("td", "", a.online ? "Online now" : ago(a.seen));
			const actionsCell = el("td");
			const actions = el("div", "admin-actions");
			actionsCell.append(actions);
			if (self) {
				actions.append(el("span", "admin-you", "That's you"));
			} else {
				if (a.muted) {
					actions.append(actionBtn("Unmute", "unmute", a.name));
				} else {
					const sel = el("select", "admin-select");
					sel.setAttribute("aria-label", `Mute ${a.name}`);
					for (const [v, t] of [["", "Mute…"], ["10m", "10 minutes"], ["1h", "1 hour"], ["1d", "1 day"], ["forever", "Until unmuted"]]) {
						const o = el("option", "", t);
						o.value = v;
						sel.append(o);
					}
					sel.dataset.name = a.name;
					actions.append(sel);
				}
				actions.append(actionBtn("Reset password", "reset", a.name));
				actions.append(actionBtn(a.banned ? "Unban" : "Ban", a.banned ? "unban" : "ban", a.name, !a.banned));
				actions.append(actionBtn(a.role === "owner" ? "Remove Owner" : "Make Owner", a.role === "owner" ? "unowner" : "owner", a.name));
				actions.append(actionBtn("Delete", "delete", a.name, true));
			}
			tr.append(nameCell, joined, seen, actionsCell);
			rows.push(tr);
			if (resetOpen === a.name) {
				const r = el("tr", "admin-reset-row");
				const td = el("td");
				td.colSpan = 4;
				const form = el("form", "admin-reset");
				const input = el("input", "field-input");
				input.type = "password";
				input.placeholder = `New password for ${a.name} (at least 6 characters)`;
				input.autocomplete = "new-password";
				input.maxLength = 128;
				input.setAttribute("aria-label", `New password for ${a.name}`);
				const save = el("button", "btn btn-primary", "Set password");
				save.type = "submit";
				const cancel = el("button", "btn", "Cancel");
				cancel.type = "button";
				cancel.addEventListener("click", () => {
					resetOpen = null;
					refresh(true);
				});
				form.addEventListener("submit", async (e) => {
					e.preventDefault();
					if (await post("/admin/account/reset", { name: a.name, password: input.value }, accStatus)) {
						say(accStatus, `${a.name}'s password is changed. Tell them the new one; they're logged out everywhere.`);
						resetOpen = null;
						refresh(true);
					}
				});
				form.append(input, save, cancel);
				td.append(form);
				r.append(td);
				rows.push(r);
				setTimeout(() => input.focus(), 0);
			}
		}
		if (!list.length) {
			const tr = el("tr");
			const td = el("td", "admin-empty", "No accounts yet.");
			td.colSpan = 4;
			tr.append(td);
			rows.push(tr);
		}
		accountsEl.replaceChildren(...rows);
	}

	function actionBtn(label, act, name, danger) {
		const b = el("button", "btn btn-small" + (danger ? " btn-danger" : ""), label);
		b.type = "button";
		b.dataset.act = act;
		b.dataset.name = name;
		return b;
	}

	function drawMessages(list) {
		if (!list.length) {
			msgsEl.replaceChildren(el("li", "admin-empty", "No messages."));
			return;
		}
		msgsEl.replaceChildren(
			...list
				.slice(-15)
				.reverse()
				.map((m) => {
					const li = el("li", "admin-msg");
					const top = el("div", "admin-msg-top");
					top.append(el("strong", "", m.name), el("span", "admin-msg-time", timeFmt.format(new Date(m.at))));
					const text = el("p", "admin-msg-text", m.text);
					const btns = el("div", "admin-msg-btns");
					const del = el("button", "btn btn-small btn-danger", "Delete");
					del.type = "button";
					del.dataset.act = "delmsg";
					del.dataset.id = String(m.id);
					btns.append(del);
					if (m.name !== me) {
						const mute = el("button", "btn btn-small", "Mute 10 min");
						mute.type = "button";
						mute.dataset.act = "mute10";
						mute.dataset.name = m.name;
						btns.append(mute);
					}
					li.append(top, text, btns);
					return li;
				}),
		);
	}

	function drawLog(list) {
		if (!list.length) {
			logEl.replaceChildren(el("li", "admin-empty", "Nothing yet."));
			return;
		}
		logEl.replaceChildren(
			...list.map((x) => {
				const li = el("li");
				li.append(el("span", "admin-log-time", `${dateFmt.format(new Date(x.at))}, ${timeFmt.format(new Date(x.at))}`), document.createTextNode(` ${x.by} ${x.what}`));
				return li;
			}),
		);
	}

	// redraw: true after one of your own actions, so the table always shows the result
	async function refresh(redraw) {
		let d;
		try {
			const r = await fetch("/admin/state", { cache: "no-store" });
			if (r.status === 403) {
				say(accStatus, "Only Owner accounts can use this page.", true);
				return;
			}
			d = await r.json();
		} catch (e) {
			say(accStatus, "Can't reach ROKI right now.", true);
			return;
		}
		me = d.me;
		drawStats(d.stats);
		// The every-8-seconds refresh doesn't redraw the table while you're using it; your own actions always do
		if (redraw === true || !accountsEl.contains(document.activeElement)) drawAccounts(d.accounts);
		drawMessages(d.messages);
		drawLog(d.log);
		if (!pinLoaded || document.activeElement !== pinText) {
			pinText.value = d.pinned ? d.pinned.text : "";
			pinLoaded = true;
		}
		say(pinStatus, d.pinned ? `Pinned by ${d.pinned.by} at ${timeFmt.format(new Date(d.pinned.at))}.` : "Nothing is pinned right now.");
	}

	/* ---------- Actions ---------- */
	accountsEl.addEventListener("change", async (e) => {
		const sel = e.target.closest("select.admin-select");
		if (!sel || !sel.value) return;
		if (await post("/admin/chat/mute", { name: sel.dataset.name, time: sel.value }, accStatus)) say(accStatus, `${sel.dataset.name} is muted.`);
		refresh(true);
	});
	accountsEl.addEventListener("click", async (e) => {
		const b = e.target.closest("button[data-act]");
		if (!b) return;
		const name = b.dataset.name;
		const act = b.dataset.act;
		if (act === "reset") {
			resetOpen = name;
			say(accStatus, "");
			refresh(true);
			return;
		}
		if (act === "delete" && !confirmed(b, `Delete ${name}? Click again`)) return;
		if (act === "ban" && !confirmed(b, `Ban ${name}? Click again`)) return;
		const calls = {
			unmute: ["/admin/chat/unmute", { name }, `${name} can chat again.`],
			ban: ["/admin/account/ban", { name, banned: true }, `${name} is banned and logged out.`],
			unban: ["/admin/account/ban", { name, banned: false }, `${name} can log in again.`],
			owner: ["/admin/account/owner", { name, owner: true }, `${name} is now an Owner.`],
			unowner: ["/admin/account/owner", { name, owner: false }, `${name} isn't an Owner anymore.`],
			delete: ["/admin/account/delete", { name }, `${name}'s account is deleted.`],
		};
		const [path, body, done] = calls[act];
		b.disabled = true;
		if (await post(path, body, accStatus)) say(accStatus, done);
		refresh(true);
	});
	msgsEl.addEventListener("click", async (e) => {
		const b = e.target.closest("button[data-act]");
		if (!b) return;
		b.disabled = true;
		if (b.dataset.act === "delmsg") {
			if (await post("/admin/chat/delete", { id: Number(b.dataset.id) }, chatStatus)) say(chatStatus, "Message deleted.");
		} else if (await post("/admin/chat/mute", { name: b.dataset.name, time: "10m" }, chatStatus)) {
			say(chatStatus, `${b.dataset.name} is muted for 10 minutes.`);
		}
		refresh(true);
	});
	$("admin-clear").addEventListener("click", async (e) => {
		if (!confirmed(e.currentTarget, "Delete every message? Click again")) return;
		if (await post("/admin/chat/clear", {}, chatStatus)) say(chatStatus, "The chat is cleared.");
		refresh(true);
	});
	$("admin-pin-save").addEventListener("click", async () => {
		if (!pinText.value.trim()) return say(pinStatus, "Type the announcement first.", true);
		if (await post("/admin/pin", { text: pinText.value }, pinStatus)) {
			pinLoaded = false;
			refresh(true);
		}
	});
	$("admin-pin-clear").addEventListener("click", async () => {
		if (await post("/admin/pin", { text: "" }, pinStatus)) {
			pinLoaded = false;
			refresh(true);
		}
	});

	document.addEventListener("roki:page", (e) => {
		showing = e.detail === "admin";
		clearInterval(timer);
		if (!showing) return;
		refresh();
		timer = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
	});
	if (!page.hidden) document.dispatchEvent(new CustomEvent("roki:page", { detail: "admin" }));
})();
