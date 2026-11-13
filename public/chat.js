// ROKI's Chat page. Messages arrive from /chat/stream (server-sent events, which reconnect on their own and
// pick up anything missed); sending is a POST to /chat/send. Everything is shown with textContent, so a
// message can never run code or change the page.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const page = $("chat-main");
	if (!page) return;
	const log = $("chat-log");
	const empty = $("chat-empty");
	const online = $("chat-online");
	const nameBtn = $("chat-name-btn");
	const nameForm = $("chat-name-form");
	const nameInput = $("chat-name");
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

	let myName = (store.get("roki:chat-name") || "").trim();
	let source = null;
	let lastId = 0;
	let showing = false;
	let unread = 0;
	let lastShown = null; // the last message drawn, to group messages from the same person
	let catchingUp = true; // the saved history sent when the page first connects isn't "unread"

	const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
	function when(at) {
		const d = new Date(at);
		const today = new Date().toDateString() === d.toDateString();
		return today ? timeFmt.format(d) : `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
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

	const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
	function toBottom() {
		log.scrollTop = log.scrollHeight;
		jump.hidden = true;
	}

	function draw(m) {
		const stick = nearBottom();
		const li = document.createElement("li");
		li.className = "chat-msg" + (m.name === myName ? " mine" : "");
		const grouped = lastShown && lastShown.name === m.name && m.at - lastShown.at < 3 * 60 * 1000;
		if (!grouped) {
			const head = document.createElement("div");
			head.className = "chat-meta";
			const who = document.createElement("span");
			who.className = "chat-who";
			who.style.setProperty("--h", hue(m.name));
			who.textContent = m.name;
			const time = document.createElement("time");
			time.dateTime = new Date(m.at).toISOString();
			time.textContent = when(m.at);
			head.append(who, time);
			li.append(head);
		} else {
			li.classList.add("grouped");
		}
		const text = document.createElement("p");
		text.className = "chat-text";
		text.textContent = m.text;
		li.append(text);
		log.append(li);
		lastShown = m;
		while (log.children.length > 300) log.firstElementChild.remove();
		empty.hidden = true;
		if (stick || m.name === myName) toBottom();
		else jump.hidden = false;
	}

	function setUnread(n) {
		unread = n;
		badge.hidden = n <= 0;
		badge.textContent = n > 9 ? "9+" : String(n);
	}

	function connect() {
		if (source) return;
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
			draw(m);
			if (!catchingUp && !showing && m.name !== myName) setUnread(unread + 1);
		});
		source.addEventListener("online", (e) => {
			try {
				const n = JSON.parse(e.data).n;
				online.textContent = n === 1 ? "Just you here" : `${n} people here`;
			} catch (err) {}
		});
		source.onerror = () => {
			online.textContent = "Reconnecting…";
		};
	}

	function showNameForm(show) {
		nameForm.hidden = !show;
		form.hidden = show;
		nameBtn.hidden = show || !myName;
		nameBtn.textContent = `You're ${myName} · change`;
		if (show) {
			nameInput.value = myName;
			if (showing) nameInput.focus();
		} else if (showing) {
			input.focus();
		}
	}

	nameForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const n = nameInput.value.replace(/\s+/g, " ").trim().slice(0, 20);
		if (!n) {
			setStatus("Type a name first.", true);
			return;
		}
		myName = n;
		store.set("roki:chat-name", n);
		setStatus("");
		showNameForm(false);
	});
	nameBtn.addEventListener("click", () => showNameForm(true));

	let sending = false;
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const text = input.value.trim();
		if (!text || sending) return;
		sending = true;
		sendBtn.disabled = true;
		try {
			const res = await fetch("/chat/send", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: myName, text }),
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				input.value = "";
				setStatus("");
			} else if (res.status === 401) {
				setStatus("You're logged out of ROKI. Open your invite link again to chat.", true);
			} else {
				setStatus(data.error || "Couldn't send that. Try again.", true);
			}
		} catch (err) {
			setStatus("Can't reach ROKI right now. Check your connection and try again.", true);
		} finally {
			sending = false;
			sendBtn.disabled = false;
			input.focus();
		}
	});

	log.addEventListener("scroll", () => { if (nearBottom()) jump.hidden = true; });
	jump.addEventListener("click", toBottom);

	document.addEventListener("roki:page", (e) => {
		showing = e.detail === "chat";
		if (!showing) return;
		connect();
		setUnread(0);
		showNameForm(!myName);
		requestAnimationFrame(toBottom);
	});

	// Someone who has used the chat before gets the unread badge without opening the page first
	showNameForm(!myName);
	if (store.get("roki:chat-used") === "1") connect();
	if (!page.hidden) document.dispatchEvent(new CustomEvent("roki:page", { detail: "chat" }));
})();
