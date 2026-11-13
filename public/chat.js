// ROKI's Chat page. Messages arrive from /chat/stream (server-sent events, which reconnect on their own and
// pick up anything missed); sending is a POST to /chat/send. Everything is shown with textContent, so a
// message can never run code or change the page.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const page = $("chat-main");
	if (!page) return;
	const log = $("chat-log");
	const scroller = $("chat-scroll");
	const count = $("chat-count");
	const empty = $("chat-empty");
	const online = $("chat-online");
	const me = $("chat-me");
	const form = $("chat-form");
	const input = $("chat-input");
	const sendBtn = $("chat-send");
	const statusEl = $("chat-status");
	const jump = $("chat-jump");
	const badge = $("chat-badge");

	const store = {
		get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
	};

	let myName = ""; // the logged-in account's username, which the server puts on every message
	let source = null;
	let lastId = 0;
	let showing = false;
	let unread = 0;
	let lastShown = null; // the last message drawn, to group messages from the same person
	let lastLi = null;
	let catchingUp = true; // the saved history sent when the page first connects isn't "unread"

	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
	function dayLabel(at) {
		const d = new Date(at);
		const today = new Date();
		const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
		if (d.toDateString() === today.toDateString()) return "Today";
		if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
		return dayFmt.format(d);
	}

	// Each name gets its own color
	function hue(name) {
		let h = 0;
		for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360;
		return h;
	}

	function setStatus(text, isError) {
		statusEl.textContent = text || "";
		statusEl.classList.toggle("bad", !!isError);
	}

	const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
	function toBottom() {
		scroller.scrollTop = scroller.scrollHeight;
		jump.hidden = true;
	}

	// Messages from the same person a few minutes apart sit together: one avatar and name for the group,
	// with the corners between their bubbles tucked in
	function draw(m, live) {
		const stick = nearBottom();
		const mine = m.name === myName;
		if (!lastShown || new Date(lastShown.at).toDateString() !== new Date(m.at).toDateString()) {
			const day = document.createElement("li");
			day.className = "chat-day";
			day.textContent = dayLabel(m.at);
			log.append(day);
			lastShown = null;
		}
		const grouped = lastShown && lastShown.name === m.name && m.at - lastShown.at < 3 * 60 * 1000;
		const li = document.createElement("li");
		li.className = `chat-msg ${mine ? "mine" : "theirs"} last` + (grouped ? "" : " first") + (live ? " new" : "");
		li.dataset.name = m.name;
		li.style.setProperty("--h", hue(m.name));
		if (grouped && lastLi) lastLi.classList.remove("last");

		const avatar = document.createElement("span");
		avatar.className = "chat-avatar";
		avatar.setAttribute("aria-hidden", "true");
		if (!grouped && !mine) avatar.textContent = Array.from(m.name)[0].toUpperCase();
		const body = document.createElement("div");
		body.className = "chat-body";
		if (!grouped) {
			const meta = document.createElement("div");
			meta.className = "chat-meta";
			const who = document.createElement("span");
			who.className = "chat-who";
			who.textContent = mine ? "You" : m.name;
			const time = document.createElement("time");
			time.dateTime = new Date(m.at).toISOString();
			time.textContent = timeFmt.format(new Date(m.at));
			meta.append(who, time);
			body.append(meta);
		}
		const bubble = document.createElement("p");
		bubble.className = "chat-bubble";
		bubble.textContent = m.text;
		bubble.title = timeFmt.format(new Date(m.at));
		body.append(bubble);
		li.append(avatar, body);
		log.append(li);
		lastShown = m;
		lastLi = li;
		while (log.children.length > 320) log.firstElementChild.remove();
		empty.hidden = true;
		if (stick || mine) toBottom();
		else jump.hidden = false;
	}

	function setUnread(n) {
		unread = n;
		badge.hidden = n <= 0;
		badge.textContent = n > 9 ? "9+" : String(n);
	}

	// Your username comes from your account; the page waits for it so your own messages land on the right
	const meReady = fetch("/account/me", { cache: "no-store" })
		.then((r) => (r.ok ? r.json() : null))
		.then((d) => {
			if (!d || !d.name) return;
			myName = d.name;
			me.textContent = `You're ${myName} · everyone with a ROKI account can see this`;
		})
		.catch(() => {});

	async function connect() {
		if (source) return;
		source = "starting";
		await meReady;
		store.set("roki:chat-used", "1");
		source = new EventSource("/chat/stream");
		source.addEventListener("ready", () => {
			setStatus("");
			catchingUp = lastId === 0;
			if (!lastId) empty.hidden = log.children.length > 0;
		});
		source.addEventListener("live", () => { catchingUp = false; });
		source.addEventListener("msg", (e) => {
			let m;
			try { m = JSON.parse(e.data); } catch (err) { return; }
			if (!m || !(m.id > lastId)) return;
			lastId = m.id;
			draw(m, !catchingUp);
			if (!catchingUp && !showing && m.name !== myName) setUnread(unread + 1);
		});
		source.addEventListener("online", (e) => {
			try {
				const n = JSON.parse(e.data).n;
				online.textContent = n === 1 ? "Just you" : `${n} online`;
				online.classList.add("live");
			} catch (err) {}
		});
		source.onerror = () => {
			online.textContent = "Reconnecting…";
			online.classList.remove("live");
		};
	}

	// The send button lights up when there's something to send; a counter shows near the 300-character limit
	function updateBar() {
		const n = Array.from(input.value).length;
		sendBtn.disabled = sending || !input.value.trim();
		count.hidden = n < 240;
		count.textContent = `${n}/300`;
		count.classList.toggle("bad", n >= 300);
	}
	input.addEventListener("input", updateBar);

	let sending = false;
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const text = input.value.trim();
		if (!text || sending) return;
		sending = true;
		updateBar();
		try {
			const res = await fetch("/chat/send", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				input.value = "";
				setStatus("");
				updateBar();
			} else if (res.status === 401) {
				setStatus("You're logged out of ROKI. Reload the page and log in again to chat.", true);
			} else {
				setStatus(data.error || "Couldn't send that. Try again.", true);
			}
		} catch (err) {
			setStatus("Can't reach ROKI right now. Check your connection and try again.", true);
		} finally {
			sending = false;
			updateBar();
			input.focus();
		}
	});

	scroller.addEventListener("scroll", () => { if (nearBottom()) jump.hidden = true; });
	jump.addEventListener("click", toBottom);

	document.addEventListener("roki:page", (e) => {
		showing = e.detail === "chat";
		if (!showing) return;
		connect();
		setUnread(0);
		requestAnimationFrame(toBottom);
		input.focus();
	});

	// Someone who has used the chat before gets the unread badge without opening the page first
	if (store.get("roki:chat-used") === "1") connect();
	if (!page.hidden) document.dispatchEvent(new CustomEvent("roki:page", { detail: "chat" }));
})();
