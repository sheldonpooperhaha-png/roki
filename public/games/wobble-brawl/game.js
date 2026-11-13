// Wobble Brawl: an original physics brawler made for ROKI. Every fighter is a ragdoll (Matter.js bodies
// held together by pin joints) that tries to stand and strike; hits land on how fast a fist or foot is
// moving when it connects, and a knocked-out fighter goes fully floppy.
"use strict";
(() => {
	const { Engine, Bodies, Body, Composite, Constraint, Events } = window.Matter;

	/* ---------- Basics ---------- */
	const WORLD_W = 1400;
	const WORLD_H = 800;
	const FLOOR_Y = 700;
	const STEP = 1000 / 60;
	const TAU = Math.PI * 2;
	const wrap = (a) => {
		a = (a + Math.PI) % TAU;
		if (a < 0) a += TAU;
		return a - Math.PI;
	};
	// Angle that makes a limb (pointing down at angle 0) point along (dx, dy)
	const angleFor = (dx, dy) => Math.atan2(-dx, dy);
	const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
	const rand = (a, b) => a + Math.random() * (b - a);
	const pick = (list) => list[Math.floor(Math.random() * list.length)];
	// Mix a #rrggbb color with white
	const lighten = (hex, amt) => {
		const n = parseInt(hex.slice(1), 16);
		const ch = (v) => Math.round(v + (255 - v) * amt).toString(16).padStart(2, "0");
		return "#" + ch(n >> 16) + ch((n >> 8) & 255) + ch(n & 255);
	};
	const norm = (x, y) => {
		const l = Math.hypot(x, y) || 1;
		return { x: x / l, y: y / l };
	};
	const vel = (b) => Body.getVelocity(b);
	const addVel = (b, x, y) => {
		const v = vel(b);
		Body.setVelocity(b, { x: v.x + x, y: v.y + y });
	};
	// The point `d` along a body's own down axis
	const along = (b, d) => ({ x: b.position.x - Math.sin(b.angle) * d, y: b.position.y + Math.cos(b.angle) * d });

	const store = {
		get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
	};

	/* ---------- Fighters ---------- */
	const PLAYER = { name: "You", scale: 1, hp: 120, power: 1.12, speed: 4.7, punchCool: 15, color: "#2de0c0", dark: "#13a38b", look: "band" };
	const TYPES = {
		brawler: { name: "Brawler", scale: 1, hp: 100, power: 0.9, speed: 3.3, punchCool: 22, aggro: 0.34, miss: 30, think: 12, kick: 0.25, color: "#ff7a45", dark: "#c4501f", look: "plain" },
		zippy: { name: "Zippy", scale: 0.86, hp: 70, power: 0.75, speed: 4.5, punchCool: 15, aggro: 0.5, miss: 34, think: 8, kick: 0.15, color: "#ffd23f", dark: "#c99a06", look: "spikes" },
		bruiser: { name: "Bruiser", scale: 1.22, hp: 150, power: 1.2, speed: 2.6, punchCool: 26, aggro: 0.3, miss: 24, think: 14, kick: 0.35, heavy: 1.3, color: "#a78bfa", dark: "#7458d6", look: "brows" },
		boss: { name: "The Boss", scale: 1.55, hp: 290, power: 1.45, speed: 2.9, punchCool: 24, aggro: 0.42, miss: 20, think: 11, kick: 0.3, heavy: 1.45, color: "#ff4d6d", dark: "#b81d3c", look: "crown" },
	};

	const engine = Engine.create({ positionIterations: 10, velocityIterations: 8, constraintIterations: 6 });
	engine.gravity.y = 1.15;
	const world = engine.world;
	const wall = { isStatic: true, friction: 0.9, restitution: 0.1 };
	Composite.add(world, [
		Bodies.rectangle(WORLD_W / 2, FLOOR_Y + 150, WORLD_W + 800, 300, { ...wall, label: "floor" }),
		Bodies.rectangle(-150, 0, 300, 2400, { ...wall, label: "wall" }),
		Bodies.rectangle(WORLD_W + 150, 0, 300, 2400, { ...wall, label: "wall" }),
		Bodies.rectangle(WORLD_W / 2, -650, WORLD_W + 800, 300, { ...wall, label: "wall" }),
	]);

	let nextGroup = 1;
	function makeFighter(t, x, team, facing) {
		const s = t.scale;
		const heavy = t.heavy || 1;
		const filter = { group: -nextGroup++ };
		const opts = (extra) => ({ collisionFilter: filter, friction: 0.5, frictionAir: 0.02, restitution: 0.05, density: 0.0016 * heavy, ...extra });
		const ty = FLOOR_Y - 84 * s; // torso center when standing
		const torso = Bodies.rectangle(x, ty, 28 * s, 58 * s, opts({ chamfer: { radius: 12 * s } }));
		const head = Bodies.circle(x, ty - 46 * s, 17 * s, opts({ density: 0.0021 * heavy }));
		const limb = (y, w, len) => Bodies.rectangle(x, y, w * s, len * s, opts({ chamfer: { radius: (w * s) / 2 - 0.5 } }));
		const pin = (a, pa, b, pb) => Constraint.create({ bodyA: a, pointA: { x: 0, y: pa * s }, bodyB: b, pointB: { x: 0, y: pb * s }, length: 0, stiffness: 1, damping: 0.05 });

		const f = {
			t, s, team, facing, name: t.name,
			hp: t.hp, maxHp: t.hp, power: t.power, speed: t.speed, punchCool: t.punchCool,
			weight: heavy * s * s,
			color: t.color, dark: t.dark, look: t.look, flashColor: lighten(t.color, 0.6), flashDark: lighten(t.dark, 0.6),
			torso, head, arms: [], legs: [], bodies: [torso, head], joints: [],
			move: 0, aim: { x: x + facing * 200, y: ty - 46 * s }, grounded: true,
			stun: 0, ko: false, flash: 0, hurt: 0, phase: 0, cool: 0, kcool: 0, jcool: 0, slamCool: 0, nextArm: 0,
			ai: { timer: 30, err: { x: 0, y: 0 }, want: null },
		};
		f.joints.push(pin(torso, -31, head, 15));
		for (let i = 0; i < 2; i++) {
			const sy = ty - 24 * s;
			const u = limb(sy + 11 * s, 13, 32);
			const l = limb(sy + 33 * s, 11, 32);
			f.joints.push(pin(torso, -24, u, -11), pin(u, 11, l, -11));
			f.arms.push({ u, l, t: 0, hit: false });
			const hy = ty + 25 * s;
			const th = limb(hy + 13 * s, 15, 36);
			const sh = limb(hy + 40 * s, 13, 38);
			f.joints.push(pin(torso, 25, th, -13), pin(th, 13, sh, -14));
			f.legs.push({ u: th, l: sh, t: 0, hit: false });
			f.bodies.push(u, l, th, sh);
		}
		const tag = (b, kind, i) => { b.wb = { f, kind, i }; };
		tag(torso, "torso", 0);
		tag(head, "head", 0);
		f.arms.forEach((a, i) => { tag(a.u, "uarm", i); tag(a.l, "larm", i); });
		f.legs.forEach((l, i) => { tag(l.u, "thigh", i); tag(l.l, "shin", i); });
		Composite.add(world, [...f.bodies, ...f.joints]);
		return f;
	}

	function removeFighter(f) {
		for (const b of f.bodies) Composite.remove(world, b);
		for (const j of f.joints) Composite.remove(world, j);
	}

	const shoulder = (f) => along(f.torso, -24 * f.s);
	const hip = (f) => along(f.torso, 25 * f.s);

	function turnTo(b, target, k, damp) {
		if (k <= 0) return;
		let av = Body.getAngularVelocity(b);
		av += wrap(target - b.angle) * k - av * damp;
		Body.setAngularVelocity(b, clamp(av, -0.6, 0.6));
	}

	// Keep the fighter standing, walking and posed (strength 0 = fully floppy)
	function control(f) {
		const s = f.s;
		const T = f.torso;
		if (f.stun > 0) f.stun--;
		const str = f.ko ? 0 : f.stun > 0 ? 0.1 : 1;
		const fc = f.facing;
		const v = vel(T);

		const feet = f.legs.map((l) => along(l.l, 19 * s).y);
		f.grounded = Math.max(...feet) > FLOOR_Y - 14 * s || T.position.y > FLOOR_Y - 46 * s;

		// Hold the body up at standing height and push it along
		let vx = v.x;
		let vy = v.y;
		if (str > 0) {
			if (f.grounded) {
				const dy = FLOOR_Y - 80 * s - T.position.y; // > 0: torso is above standing height
				if (dy < 8 * s) vy += (dy * 0.12 - v.y * 0.28 - 0.62) * str;
			}
			const target = f.move * f.speed;
			vx += (target - v.x) * (f.grounded ? 0.2 : 0.05) * str;
			Body.setVelocity(T, { x: vx, y: vy });
		}

		const punching = f.arms.some((a) => a.t > 0);
		const lean = f.move * 0.1 + (punching ? fc * 0.14 : 0);
		turnTo(T, -lean, 0.32 * str, 0.32 * str);
		turnTo(f.head, T.angle * 0.5, 0.3 * str, 0.3 * str);

		// Legs: walk cycle on the ground, tucked in the air, a straight leg when kicking
		const speed = Math.abs(v.x);
		if (f.grounded && speed > 0.5) f.phase += speed * 0.08;
		const swing = f.grounded ? Math.min(1, speed / 3) * 0.55 : 0;
		f.legs.forEach((leg, i) => {
			let ta;
			let sa;
			if (leg.t > 0) {
				const h = hip(f);
				const d = norm(f.aim.x - h.x, clamp(f.aim.y - h.y, -90 * s, 10 * s));
				ta = sa = angleFor(d.x, d.y);
				turnTo(leg.u, ta, 0.55 * str, 0.3 * str);
				turnTo(leg.l, sa, 0.55 * str, 0.3 * str);
				return;
			}
			if (f.grounded) {
				const ph = f.phase + i * Math.PI;
				ta = angleFor(fc * (i ? -0.12 : 0.14) + Math.sin(ph) * swing * Math.sign(v.x || fc), 1);
				sa = ta + fc * (0.12 + Math.max(0, Math.cos(ph)) * 0.7 * Math.min(1, speed / 2));
			} else {
				ta = angleFor(fc * (i ? 0.15 : 0.55), 1);
				sa = ta + fc * 0.9;
			}
			turnTo(leg.u, ta, 0.3 * str, 0.3 * str);
			turnTo(leg.l, sa, 0.3 * str, 0.3 * str);
		});

		// Arms: fists up in guard, or a straight arm at the target while punching
		f.arms.forEach((arm, i) => {
			if (arm.t > 0) {
				const sh = shoulder(f);
				const d = norm(f.aim.x - sh.x, f.aim.y - sh.y);
				const a = angleFor(d.x, d.y);
				turnTo(arm.u, a, 0.6 * str, 0.3 * str);
				turnTo(arm.l, a, 0.6 * str, 0.3 * str);
			} else {
				turnTo(arm.u, angleFor(fc * (i ? 0.3 : 0.55), 0.8), 0.22 * str, 0.3 * str);
				turnTo(arm.l, angleFor(fc * (i ? 0.62 : 0.5), -0.9), 0.22 * str, 0.3 * str);
			}
		});

		for (const a of f.arms) if (a.t > 0) a.t--;
		for (const l of f.legs) if (l.t > 0) l.t--;
		if (f.cool > 0) f.cool--;
		if (f.kcool > 0) f.kcool--;
		if (f.jcool > 0) f.jcool--;
		if (f.slamCool > 0) f.slamCool--;
		if (f.flash > 0) f.flash--;
		if (f.hurt > 0) f.hurt--;
	}

	const canAct = (f) => !f.ko && f.stun <= 0;

	function punch(f) {
		if (!canAct(f) || f.cool > 0) return;
		const arm = f.arms[f.nextArm];
		f.nextArm ^= 1;
		arm.t = 11;
		arm.hit = false;
		f.cool = f.punchCool;
		const sh = shoulder(f);
		const d = norm(f.aim.x - sh.x, f.aim.y - sh.y);
		addVel(arm.l, d.x * 17, d.y * 17);
		addVel(arm.u, d.x * 8, d.y * 8);
		addVel(f.torso, d.x * 1.5, 0);
		sfx.whoosh();
	}

	function kick(f) {
		if (!canAct(f) || f.kcool > 0 || f.cool > 0) return;
		const leg = f.legs[0];
		leg.t = 14;
		leg.hit = false;
		f.kcool = 32;
		f.cool = 10;
		const h = hip(f);
		const d = norm(f.aim.x - h.x, clamp(f.aim.y - h.y, -90 * f.s, 10 * f.s));
		addVel(leg.l, d.x * 19, d.y * 19);
		addVel(leg.u, d.x * 9, d.y * 9);
		sfx.whoosh();
	}

	function jump(f) {
		if (!canAct(f) || !f.grounded || f.jcool > 0) return;
		f.jcool = 32;
		for (const b of f.bodies) addVel(b, 0, -11);
		addVel(f.torso, 0, -3);
		sfx.jump();
	}

	/* ---------- Hits ---------- */
	let hitStop = 0;
	let slowmo = 0;
	let shake = 0;
	const particles = [];
	const popups = [];

	function contactPoint(pair, fallback) {
		const sp = pair.collision && pair.collision.supports;
		return sp && sp[0] ? { x: sp[0].x, y: sp[0].y } : { x: fallback.position.x, y: fallback.position.y };
	}

	function strike(x, y, pair) {
		const px = x.wb;
		const py = y.wb;
		if (!px || !py || px.f === py.f || px.f.team === py.f.team) return;
		const A = px.f;
		const V = py.f;
		const limb = px.kind === "larm" ? A.arms[px.i] : px.kind === "shin" ? A.legs[px.i] : null;
		if (!limb || limb.t <= 0 || limb.hit || A.ko || V.ko) return;
		const va = vel(x);
		const vb = vel(y);
		const rx = va.x - vb.x;
		const ry = va.y - vb.y;
		const rv = Math.hypot(rx, ry);
		if (rv < 6) return;
		limb.hit = true;
		const head = py.kind === "head";
		const mult = head ? 1.7 : py.kind === "torso" ? 1 : 0.55;
		const dmg = Math.min(48, (rv - 4) * 0.95 * mult * A.power * (px.kind === "shin" ? 1.25 : 1));
		hurt(V, dmg, y, rx / rv, ry / rv, (4 + rv * 0.45) * A.power, contactPoint(pair, y), head);
	}

	function hurt(V, dmg, part, nx, ny, push, at, head) {
		if (V.ko) return;
		dmg = Math.max(1, Math.round(dmg));
		V.hp = Math.max(0, V.hp - dmg);
		V.flash = 6;
		V.hurt = 30;
		const kb = push / V.weight;
		addVel(part, nx * kb, ny * kb - 2);
		addVel(V.torso, nx * kb * 0.6, ny * kb * 0.4 - 2.5);
		addVel(V.head, nx * kb * 0.5, -1.5);
		if (dmg >= 9) V.stun = Math.max(V.stun, Math.min(V.team === "player" ? 20 : 42, Math.round(dmg * 1.5)));
		burst(at.x, at.y, Math.min(22, 6 + dmg / 2), head ? "#fff3b0" : "#ffffff", nx, ny);
		popups.push({ x: at.x, y: at.y - 10, text: String(dmg), size: 18 + Math.min(26, dmg * 0.7), life: 50, max: 50, color: head ? "#ffd23f" : "#ffffff" });
		shake = Math.min(18, shake + dmg * 0.45);
		if (dmg >= 12) hitStop = Math.min(7, Math.round(dmg / 5));
		sfx.hit(dmg, head);
		if (V.hp <= 0) knockOut(V, nx, ny);
	}

	function knockOut(V, nx, ny) {
		V.ko = true;
		V.stun = 0;
		for (const b of V.bodies) addVel(b, nx * 6, ny * 3 - 6);
		slowmo = 70;
		shake = 20;
		burst(V.head.position.x, V.head.position.y, 34, "#ffd23f", nx, ny);
		popups.push({ x: V.head.position.x, y: V.head.position.y - 50, text: "K.O.!", size: 54, life: 75, max: 75, color: "#ffd23f" });
		sfx.ko();
	}

	// A head or body slammed into the floor or a wall hurts a little
	function slam(x, y) {
		const p = x.wb;
		if (!p || y.wb || (p.kind !== "head" && p.kind !== "torso")) return;
		const F = p.f;
		if (F.ko || F.slamCool > 0 || (F.stun <= 0 && F.grounded)) return;
		const v = vel(x);
		const sp = Math.hypot(v.x, v.y);
		if (sp < 12) return;
		F.slamCool = 24;
		const n = norm(v.x, v.y);
		hurt(F, Math.min(20, (sp - 11) * 0.9), x, -n.x * 0.3, -n.y * 0.3, 2, { x: x.position.x, y: x.position.y }, false);
	}

	function onCollide(e) {
		for (const pair of e.pairs) {
			const a = pair.bodyA.parent || pair.bodyA;
			const b = pair.bodyB.parent || pair.bodyB;
			strike(a, b, pair);
			strike(b, a, pair);
			if (e.name === "collisionStart") {
				slam(a, b);
				slam(b, a);
			}
		}
	}
	Events.on(engine, "collisionStart", onCollide);
	Events.on(engine, "collisionActive", onCollide);

	function burst(x, y, n, color, nx, ny) {
		for (let i = 0; i < n; i++) {
			const a = Math.random() * TAU;
			const sp = rand(2, 9);
			particles.push({ x, y, vx: Math.cos(a) * sp + nx * 4, vy: Math.sin(a) * sp + ny * 4 - 1, life: rand(18, 34), max: 34, size: rand(2, 5), color: Math.random() < 0.35 ? "#ffd23f" : color });
		}
	}

	/* ---------- Sound (made on the fly, no files) ---------- */
	let actx = null;
	let muted = store.get("wobble-brawl:muted") === "1";
	let noiseBuf = null;
	function audio() {
		if (muted) return null;
		try {
			if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
			if (actx.state === "suspended") actx.resume();
			if (!noiseBuf) {
				noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
				const d = noiseBuf.getChannelData(0);
				for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
			}
		} catch (e) {
			return null;
		}
		return actx;
	}
	function tone(freq, dur, type, vol, slideTo) {
		const a = audio();
		if (!a) return;
		const o = a.createOscillator();
		const g = a.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, a.currentTime);
		if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
		g.gain.setValueAtTime(vol, a.currentTime);
		g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
		o.connect(g).connect(a.destination);
		o.start();
		o.stop(a.currentTime + dur);
	}
	function noise(dur, vol, freq) {
		const a = audio();
		if (!a) return;
		const src = a.createBufferSource();
		src.buffer = noiseBuf;
		const filt = a.createBiquadFilter();
		filt.type = "bandpass";
		filt.frequency.value = freq;
		const g = a.createGain();
		g.gain.setValueAtTime(vol, a.currentTime);
		g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
		src.connect(filt).connect(g).connect(a.destination);
		src.start();
		src.stop(a.currentTime + dur);
	}
	const sfx = {
		whoosh: () => noise(0.08, 0.05, 2600),
		jump: () => tone(240, 0.14, "square", 0.04, 480),
		hit: (d, head) => {
			noise(0.09, Math.min(0.5, 0.15 + d / 60), head ? 1500 : 900);
			tone(head ? 230 : 150, 0.14, "sine", Math.min(0.45, 0.2 + d / 80), 55);
		},
		ko: () => {
			tone(880, 0.6, "triangle", 0.16);
			tone(1320, 0.7, "sine", 0.07);
		},
		win: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, "square", 0.05), i * 110)),
	};

	/* ---------- Levels ---------- */
	const menuEl = document.getElementById("menu");
	const overEl = document.getElementById("over");
	const pausedEl = document.getElementById("paused");
	const overText = document.getElementById("over-text");
	const menuBest = document.getElementById("menu-best");

	let state = "menu"; // menu, fight, clear, over, paused
	let level = 1;
	let best = Number(store.get("wobble-brawl:best")) || 0;
	let player = null;
	let enemies = [];
	let startDelay = 0;
	let stateTimer = 0;
	let banner = null;

	function showBest() {
		menuBest.textContent = best > 0 ? `Your best: cleared level ${best}` : "";
	}

	function roster(n) {
		const fixed = { 1: ["brawler"], 2: ["zippy"], 3: ["bruiser"], 4: ["brawler", "zippy"], 5: ["boss"] };
		if (fixed[n]) return fixed[n];
		if (n % 5 === 0) return n >= 15 ? ["boss", pick(["zippy", "brawler"]), pick(["zippy", "brawler"])] : ["boss", pick(["zippy", "brawler"])];
		const count = Math.min(3, 1 + Math.floor((n - 2) / 4));
		return Array.from({ length: count }, () => pick(["brawler", "zippy", "bruiser"]));
	}

	function enemyFor(type, n) {
		const t = TYPES[type];
		const up = n - 1;
		return {
			...t,
			hp: Math.round(t.hp * (1 + up * 0.06)),
			power: t.power * (1 + Math.min(up, 20) * 0.035),
			aggro: Math.min(0.85, t.aggro * (1 + up * 0.05)),
			miss: Math.max(8, t.miss * (1 - Math.min(up, 15) * 0.04)),
			speed: t.speed * (1 + Math.min(up, 15) * 0.02),
		};
	}

	function clearFighters() {
		for (const f of [player, ...enemies]) if (f) removeFighter(f);
		player = null;
		enemies = [];
		particles.length = 0;
		popups.length = 0;
	}

	function setup(n, demo) {
		clearFighters();
		level = n;
		player = makeFighter(PLAYER, 300, "player", 1);
		const list = demo ? ["brawler"] : roster(n);
		enemies = list.map((type, i) => makeFighter(enemyFor(type, n), Math.min(1320, 1080 + i * 115), "enemy", -1));
		startDelay = 75;
		hitStop = slowmo = shake = 0;
	}

	function startLevel(n) {
		setup(n, false);
		state = "fight";
		const names = enemies.map((e) => e.name).join(" + ");
		banner = { title: `Level ${n}`, sub: names, life: 110, max: 110 };
		menuEl.hidden = overEl.hidden = pausedEl.hidden = true;
		canvas.focus();
	}

	function pause(on) {
		if (on && state === "fight") {
			state = "paused";
			pausedEl.hidden = false;
		} else if (!on && state === "paused") {
			state = "fight";
			pausedEl.hidden = true;
			canvas.focus();
		}
	}

	/* ---------- Input ---------- */
	const canvas = document.getElementById("game");
	canvas.tabIndex = 0;
	const keys = {};
	const mouse = { x: 0, y: 0, active: false, movedAt: -1e9, down: false, right: false };

	addEventListener("keydown", (e) => {
		const k = e.key.toLowerCase();
		if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
		if (k === "escape" || k === "p") {
			if (state === "fight") pause(true);
			else if (state === "paused") pause(false);
			return;
		}
		if (k === "m") {
			muted = !muted;
			store.set("wobble-brawl:muted", muted ? "1" : "0");
			popups.push({ x: WORLD_W / 2, y: 140, text: muted ? "Sound off" : "Sound on", size: 26, life: 60, max: 60, color: "#ffffff", screen: true });
			return;
		}
		if (e.repeat) return;
		if ((k === " " || k === "enter") && (state === "menu" || state === "over")) {
			startLevel(state === "over" ? level : 1);
			return;
		}
		if (k === " " && state === "clear") {
			stateTimer = Math.min(stateTimer, 1);
			return;
		}
		keys[k] = true;
		if (k === "w" || k === "arrowup" || k === " ") keys.jumpPressed = true;
	});
	addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
	addEventListener("blur", () => {
		for (const k in keys) keys[k] = false;
		mouse.down = mouse.right = false;
	});

	let view = { scale: 1, x: 0, y: 0 };
	function toWorld(cx, cy) {
		return { x: (cx - view.x) / view.scale, y: (cy - view.y) / view.scale };
	}
	canvas.addEventListener("pointermove", (e) => {
		const p = toWorld(e.clientX, e.clientY);
		mouse.x = p.x;
		mouse.y = p.y;
		mouse.active = true;
		mouse.movedAt = performance.now();
	});
	canvas.addEventListener("pointerdown", (e) => {
		canvas.focus();
		audio();
		const p = toWorld(e.clientX, e.clientY);
		mouse.x = p.x;
		mouse.y = p.y;
		mouse.active = true;
		mouse.movedAt = performance.now();
		if (e.button === 2) mouse.right = true;
		else mouse.down = true;
		try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
	});
	const release = (e) => {
		if (e.button === 2) mouse.right = false;
		else mouse.down = false;
	};
	canvas.addEventListener("pointerup", release);
	canvas.addEventListener("pointercancel", () => { mouse.down = mouse.right = false; });
	canvas.addEventListener("contextmenu", (e) => e.preventDefault());

	document.getElementById("play").addEventListener("click", () => { audio(); startLevel(1); });
	document.getElementById("retry").addEventListener("click", () => { audio(); startLevel(level); });
	document.getElementById("resume").addEventListener("click", () => pause(false));
	document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });

	const alive = () => enemies.filter((e) => !e.ko);

	function playerInput() {
		const p = player;
		p.move = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
		const foes = alive();
		const near = foes.sort((a, b) => Math.abs(a.torso.position.x - p.torso.position.x) - Math.abs(b.torso.position.x - p.torso.position.x))[0];
		const useMouse = mouse.active && performance.now() - mouse.movedAt < 4000;
		if (useMouse) p.aim = { x: mouse.x, y: mouse.y };
		else if (near) p.aim = { x: near.head.position.x, y: near.head.position.y };
		else p.aim = { x: p.torso.position.x + p.facing * 200, y: p.head.position.y };
		if (keys.j && near && !useMouse) p.aim = { x: near.head.position.x, y: near.head.position.y };
		p.facing = p.aim.x >= p.torso.position.x ? 1 : -1;
		if (keys.jumpPressed) jump(p);
		keys.jumpPressed = false;
		if (mouse.down || keys.j) punch(p);
		if (mouse.right || keys.k) kick(p);
	}

	function enemyThink(e) {
		const ai = e.ai;
		const P = player;
		e.aim = { x: P.head.position.x + ai.err.x, y: P.head.position.y + ai.err.y };
		const dx = P.torso.position.x - e.torso.position.x;
		e.facing = dx >= 0 ? 1 : -1;
		if (e.ko || startDelay > 0 || P.ko || state !== "fight") {
			e.move = 0;
			return;
		}
		if (--ai.timer <= 0) {
			const t = e.t;
			ai.timer = t.think + Math.floor(rand(0, 6));
			ai.err = { x: rand(-1, 1) * t.miss, y: rand(-1, 1) * t.miss };
			const dist = Math.abs(dx);
			const reach = 74 * e.s + 26;
			if (dist > reach) e.move = Math.sign(dx);
			else if (dist < reach * 0.55) e.move = -Math.sign(dx) * 0.6;
			else e.move = Math.random() < 0.3 ? Math.sign(dx) * 0.5 : 0;
			if (dist < reach * 1.25 && Math.random() < t.aggro) ai.want = Math.random() < t.kick ? "kick" : "punch";
			if (e.grounded && dist > reach * 1.6 && Math.random() < 0.06) jump(e);
		}
		if (ai.want === "punch" && e.cool <= 0) {
			punch(e);
			ai.want = null;
		} else if (ai.want === "kick" && e.kcool <= 0 && e.cool <= 0) {
			kick(e);
			ai.want = null;
		}
	}

	/* ---------- One physics step ---------- */
	function tick() {
		if (state === "paused") return;
		updateEffects();
		if (hitStop > 0) {
			hitStop--;
			return;
		}
		const ts = slowmo > 0 ? 0.4 : 1;
		if (slowmo > 0) slowmo--;
		if (startDelay > 0) startDelay--;

		if (state === "fight" && !player.ko) playerInput();
		else player.move = 0;
		for (const e of enemies) enemyThink(e);
		control(player);
		for (const e of enemies) control(e);

		Engine.update(engine, STEP * ts);

		for (const f of [player, ...enemies]) {
			for (const b of f.bodies) {
				const v = vel(b);
				const sp = Math.hypot(v.x, v.y);
				if (sp > 40) Body.setVelocity(b, { x: (v.x / sp) * 40, y: (v.y / sp) * 40 });
			}
		}

		if (state === "fight") {
			if (player.ko) {
				state = "over";
				stateTimer = 100;
			} else if (alive().length === 0) {
				state = "clear";
				stateTimer = 140;
				if (level > best) {
					best = level;
					store.set("wobble-brawl:best", String(best));
				}
				setTimeout(sfx.win, 500);
			}
		} else if (state === "clear") {
			if (stateTimer === 60) banner = { title: "Level cleared!", sub: "Next one's tougher", life: 80, max: 80 };
			if (--stateTimer <= 0) startLevel(level + 1);
		} else if (state === "over" && stateTimer > 0) {
			if (--stateTimer === 0) {
				overText.textContent = `Knocked out on level ${level}.` + (best > 0 ? ` Best: cleared level ${best}.` : "");
				overEl.hidden = false;
				document.getElementById("retry").focus();
			}
		}
	}

	function updateEffects() {
		for (let i = particles.length - 1; i >= 0; i--) {
			const p = particles[i];
			p.x += p.vx;
			p.y += p.vy;
			p.vy += 0.35;
			p.vx *= 0.96;
			if (--p.life <= 0) particles.splice(i, 1);
		}
		for (let i = popups.length - 1; i >= 0; i--) {
			const p = popups[i];
			p.y -= 0.9;
			if (--p.life <= 0) popups.splice(i, 1);
		}
		if (banner && --banner.life <= 0) banner = null;
		shake *= 0.86;
		if (shake < 0.3) shake = 0;
	}

	/* ---------- Drawing ---------- */
	const ctx = canvas.getContext("2d");
	let W = 0;
	let H = 0;
	let dpr = 1;
	function resize() {
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		W = innerWidth;
		H = innerHeight;
		canvas.width = Math.round(W * dpr);
		canvas.height = Math.round(H * dpr);
		updateCamera(true);
	}

	const cam = { x: WORLD_W / 2, w: WORLD_W };
	function updateCamera(snap) {
		let tx = WORLD_W / 2;
		let tw = WORLD_W;
		if (player && state !== "menu") {
			const xs = [player, ...enemies.filter((e) => !e.ko)].map((f) => f.torso.position.x);
			const lo = Math.min(...xs);
			const hi = Math.max(...xs);
			tx = (lo + hi) / 2;
			tw = clamp(hi - lo + 560, 820, WORLD_W);
		}
		cam.x += (tx - cam.x) * (snap ? 1 : 0.08);
		cam.w += (tw - cam.w) * (snap ? 1 : 0.05);
		const scale = Math.min(W / cam.w, H / 470);
		const half = W / scale / 2;
		const cx = half * 2 >= WORLD_W + 400 ? WORLD_W / 2 : clamp(cam.x, -200 + half, WORLD_W + 200 - half);
		view = { scale, x: W / 2 - cx * scale, y: H * 0.86 - FLOOR_Y * scale };
	}
	addEventListener("resize", resize);

	// The city behind the roof (made once)
	const stars = Array.from({ length: 90 }, () => ({ x: rand(-700, WORLD_W + 700), y: rand(-600, 420), r: rand(0.6, 1.8), a: rand(0.3, 0.9) }));
	const buildings = [];
	for (let x = -900; x < WORLD_W + 900; ) {
		const w = rand(70, 150);
		const h = rand(140, 330);
		const windows = [];
		for (let wy = FLOOR_Y - h + 18; wy < FLOOR_Y - 20; wy += 24) {
			for (let wx = x + 12; wx < x + w - 14; wx += 20) if (Math.random() < 0.22) windows.push([wx, wy]);
		}
		buildings.push({ x, w, h, windows, far: Math.random() < 0.5 });
		x += w + rand(4, 26);
	}

	function drawBackground() {
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, "#090d2a");
		g.addColorStop(0.6, "#1a2156");
		g.addColorStop(1, "#2b2468");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);
	}

	function drawWorld() {
		for (const s of stars) {
			ctx.globalAlpha = s.a;
			ctx.fillStyle = "#dfe3ff";
			ctx.beginPath();
			ctx.arc(s.x, s.y, s.r, 0, TAU);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		ctx.fillStyle = "rgba(255, 236, 190, 0.9)";
		ctx.beginPath();
		ctx.arc(1120, 150, 46, 0, TAU);
		ctx.fill();
		for (const pass of [true, false]) {
			for (const b of buildings) {
				if (b.far !== pass) continue;
				const top = FLOOR_Y - b.h - (pass ? 70 : 0);
				ctx.fillStyle = pass ? "#18205a" : "#111745";
				ctx.fillRect(b.x, top, b.w, FLOOR_Y - top);
				if (!pass) {
					ctx.fillStyle = "rgba(255, 210, 120, 0.55)";
					for (const [wx, wy] of b.windows) ctx.fillRect(wx, wy, 8, 11);
				}
			}
		}
		// The roof
		ctx.fillStyle = "#262d63";
		ctx.fillRect(-900, FLOOR_Y, WORLD_W + 1800, 600);
		ctx.fillStyle = "#3d478f";
		ctx.fillRect(-900, FLOOR_Y, WORLD_W + 1800, 8);
		ctx.fillStyle = "#2e3672";
		for (let x = -880; x < WORLD_W + 900; x += 120) ctx.fillRect(x, FLOOR_Y + 30, 60, 6);
		// Railings at the edges
		for (const x of [-18, WORLD_W + 2]) {
			ctx.fillStyle = "#4a55a8";
			ctx.fillRect(x, FLOOR_Y - 120, 16, 120);
			ctx.fillRect(x - 40 * (x < 0 ? 1 : -0.4), FLOOR_Y - 124, 56, 8);
		}
	}

	function stroke(p1, p2, w, color) {
		ctx.strokeStyle = color;
		ctx.lineWidth = w;
		ctx.beginPath();
		ctx.moveTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.stroke();
	}
	function dot(p, r, color) {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, TAU);
		ctx.fill();
	}

	const OUT = "#0d1022";
	function drawLimb(b, w, len, color, end, s, fc) {
		const a = along(b, -len / 2 + w / 2);
		const z = along(b, len / 2 - w / 2);
		stroke(a, z, w + 5, OUT);
		if (end === "fist") dot(along(b, len / 2 - 1), 8.5 * s + 2.5, OUT);
		if (end === "foot") stroke(z, { x: z.x + fc * 10 * s, y: z.y + 2 }, 9 * s + 5, OUT);
		stroke(a, z, w, color);
		if (end === "fist") dot(along(b, len / 2 - 1), 8.5 * s, color);
		if (end === "foot") stroke(z, { x: z.x + fc * 10 * s, y: z.y + 2 }, 9 * s, color);
	}

	function drawFighter(f) {
		const s = f.s;
		const fc = f.facing;
		const col = f.flash > 0 ? f.flashColor : f.color;
		const dk = f.flash > 0 ? f.flashDark : f.dark;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		// Shadow on the roof
		const lift = clamp((FLOOR_Y - f.torso.position.y) / 300, 0, 1);
		ctx.fillStyle = `rgba(5, 6, 20, ${0.35 - lift * 0.2})`;
		ctx.beginPath();
		ctx.ellipse(f.torso.position.x, FLOOR_Y + 4, 34 * s * (1 - lift * 0.4), 7 * s, 0, 0, TAU);
		ctx.fill();

		const back = 1;
		const front = 0;
		drawLimb(f.legs[back].u, 15 * s, 36 * s, dk, null, s, fc);
		drawLimb(f.legs[back].l, 13 * s, 38 * s, dk, "foot", s, fc);
		drawLimb(f.arms[back].u, 13 * s, 32 * s, dk, null, s, fc);
		drawLimb(f.arms[back].l, 11 * s, 32 * s, dk, "fist", s, fc);

		// Body, with darker shorts
		const T = f.torso;
		const top = along(T, -29 * s + 13 * s);
		const bot = along(T, 29 * s - 13 * s);
		stroke(top, bot, 26 * s + 5, OUT);
		stroke(top, bot, 26 * s, col);
		stroke(along(T, 14 * s), bot, 26 * s, dk);

		drawLimb(f.legs[front].u, 15 * s, 36 * s, col, null, s, fc);
		drawLimb(f.legs[front].l, 13 * s, 38 * s, col, "foot", s, fc);
		drawHead(f, col, dk);
		drawLimb(f.arms[front].u, 13 * s, 32 * s, col, null, s, fc);
		drawLimb(f.arms[front].l, 11 * s, 32 * s, col, "fist", s, fc);
	}

	function drawHead(f, col, dk) {
		const s = f.s;
		const fc = f.facing;
		const h = f.head.position;
		const r = 17 * s;
		dot(h, r + 2.5, OUT);
		dot(h, r, col);

		if (f.look === "band") {
			ctx.save();
			ctx.beginPath();
			ctx.arc(h.x, h.y, r, 0, TAU);
			ctx.clip();
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(h.x - r, h.y - r * 0.62, r * 2, r * 0.32);
			ctx.restore();
			const tail = { x: h.x - fc * r * 1.05, y: h.y - r * 0.45 };
			stroke(tail, { x: tail.x - fc * 13 * s, y: tail.y + 7 * s + Math.sin(performance.now() / 120) * 3 }, 4 * s, "#ffffff");
		} else if (f.look === "crown") {
			ctx.fillStyle = "#ffd23f";
			ctx.strokeStyle = OUT;
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			const by = h.y - r * 0.7;
			ctx.moveTo(h.x - r * 0.75, by);
			ctx.lineTo(h.x - r * 0.75, by - r * 0.55);
			ctx.lineTo(h.x - r * 0.38, by - r * 0.25);
			ctx.lineTo(h.x, by - r * 0.7);
			ctx.lineTo(h.x + r * 0.38, by - r * 0.25);
			ctx.lineTo(h.x + r * 0.75, by - r * 0.55);
			ctx.lineTo(h.x + r * 0.75, by);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		} else if (f.look === "spikes") {
			ctx.fillStyle = dk;
			for (let i = -1; i <= 1; i++) {
				ctx.beginPath();
				ctx.moveTo(h.x + i * r * 0.5 - r * 0.25, h.y - r * 0.8);
				ctx.lineTo(h.x + i * r * 0.5 - fc * r * 0.2, h.y - r * 1.45);
				ctx.lineTo(h.x + i * r * 0.5 + r * 0.25, h.y - r * 0.8);
				ctx.fill();
			}
		}

		// Face looks toward where the fighter is aiming
		const look = norm(f.aim.x - h.x, f.aim.y - h.y);
		const eyes = [{ x: h.x + fc * r * 0.12, y: h.y - r * 0.12 }, { x: h.x + fc * r * 0.58, y: h.y - r * 0.12 }];
		ctx.lineWidth = 2.6 * s;
		ctx.strokeStyle = OUT;
		if (f.ko) {
			for (const e of eyes) {
				const d = 3.6 * s;
				stroke({ x: e.x - d, y: e.y - d }, { x: e.x + d, y: e.y + d }, 2.6 * s, OUT);
				stroke({ x: e.x + d, y: e.y - d }, { x: e.x - d, y: e.y + d }, 2.6 * s, OUT);
			}
		} else if (f.hurt > 0 || f.stun > 0) {
			for (const [i, e] of eyes.entries()) {
				const d = 3.6 * s;
				const dir = i ? 1 : -1;
				stroke({ x: e.x - dir * d, y: e.y - d }, { x: e.x + dir * d, y: e.y }, 2.6 * s, OUT);
				stroke({ x: e.x + dir * d, y: e.y }, { x: e.x - dir * d, y: e.y + d }, 2.6 * s, OUT);
			}
		} else {
			for (const e of eyes) {
				dot(e, 4.4 * s, "#ffffff");
				dot({ x: e.x + look.x * 1.8 * s, y: e.y + look.y * 1.8 * s }, 2.2 * s, OUT);
			}
			if (f.look === "brows") {
				for (const [i, e] of eyes.entries()) {
					const inner = i ? -1 : 1; // brows dip toward the middle: an angry look
					stroke({ x: e.x - inner * 5 * s, y: e.y - 8 * s }, { x: e.x + inner * 5 * s, y: e.y - 5 * s }, 3 * s, OUT);
				}
			}
		}
		const m = { x: h.x + fc * r * 0.42, y: h.y + r * 0.42 };
		if (f.ko || f.hurt > 0) {
			ctx.fillStyle = OUT;
			ctx.beginPath();
			ctx.ellipse(m.x, m.y, 3.6 * s, 4.2 * s, 0, 0, TAU);
			ctx.fill();
		} else {
			stroke({ x: m.x - 4 * s, y: m.y }, { x: m.x + 4 * s, y: m.y }, 2.4 * s, OUT);
		}
	}

	function bar(x, y, w, f, alignRight) {
		const h = 14;
		ctx.fillStyle = "rgba(8, 10, 32, 0.7)";
		ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
		const frac = f.hp / f.maxHp;
		ctx.fillStyle = "#3a2140";
		ctx.fillRect(x, y, w, h);
		ctx.fillStyle = frac > 0.5 ? f.color : frac > 0.25 ? "#ffb13d" : "#ff4d6d";
		const fw = w * frac;
		ctx.fillRect(alignRight ? x + w - fw : x, y, fw, h);
		ctx.fillStyle = "#ffffff";
		ctx.font = "800 14px system-ui, 'Segoe UI', sans-serif";
		ctx.textAlign = alignRight ? "right" : "left";
		ctx.textBaseline = "bottom";
		ctx.fillText(f.ko ? `${f.name} · K.O.` : f.name, alignRight ? x + w : x, y - 5);
	}

	function outlinedText(text, x, y, size, color, align) {
		ctx.font = `900 ${size}px system-ui, 'Segoe UI', sans-serif`;
		ctx.textAlign = align || "center";
		ctx.textBaseline = "middle";
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(4, size / 6);
		ctx.strokeStyle = OUT;
		ctx.strokeText(text, x, y);
		ctx.fillStyle = color;
		ctx.fillText(text, x, y);
	}

	function render() {
		updateCamera(false);
		drawBackground();
		const sx = shake ? rand(-shake, shake) : 0;
		const sy = shake ? rand(-shake, shake) : 0;
		const k = view.scale * dpr;
		ctx.setTransform(k, 0, 0, k, (view.x + sx) * dpr, (view.y + sy) * dpr);
		drawWorld();
		if (player) {
			for (const e of enemies) if (e.ko) drawFighter(e);
			for (const e of enemies) if (!e.ko) drawFighter(e);
			drawFighter(player);
		}
		for (const p of particles) {
			ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
			dot(p, p.size, p.color);
		}
		ctx.globalAlpha = 1;
		for (const p of popups) {
			if (p.screen) continue;
			ctx.globalAlpha = clamp(p.life / 20, 0, 1);
			outlinedText(p.text, p.x, p.y, p.size, p.color);
		}
		ctx.globalAlpha = 1;
		if (state === "fight" && mouse.active && performance.now() - mouse.movedAt < 4000) {
			ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(mouse.x, mouse.y, 11, 0, TAU);
			ctx.stroke();
			dot(mouse, 2.5, "#ffffff");
		}

		// Screen-space HUD
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (player && state !== "menu") {
			const w = Math.min(280, W * 0.32);
			bar(18, 34, w, player, false);
			enemies.forEach((e, i) => bar(W - 18 - w, 34 + i * 40, w, e, true));
			outlinedText(`LEVEL ${level}`, W / 2, 30, 22, "#ffffff");
		}
		if (banner) {
			const t = banner.life / banner.max;
			ctx.globalAlpha = clamp(Math.min(t * 4, (1 - t) * 8), 0, 1);
			const size = Math.min(84, W / 9);
			outlinedText(banner.title, W / 2, H * 0.32, size, "#ffd23f");
			outlinedText(banner.sub, W / 2, H * 0.32 + size * 0.85, size * 0.38, "#ffffff");
			ctx.globalAlpha = 1;
		}
		for (const p of popups) {
			if (!p.screen) continue;
			ctx.globalAlpha = clamp(p.life / 20, 0, 1);
			outlinedText(p.text, W / 2, 84, p.size, p.color);
		}
		ctx.globalAlpha = 1;
	}

	/* ---------- Main loop ---------- */
	let last = performance.now();
	let acc = 0;
	function frame(now) {
		acc += Math.min(100, now - last);
		last = now;
		let steps = 0;
		while (acc >= STEP && steps < 4) {
			acc -= STEP;
			steps++;
			tick();
		}
		if (steps === 4) acc = 0;
		render();
		requestAnimationFrame(frame);
	}

	showBest();
	setup(1, true); // fighters wobble behind the menu
	resize();
	requestAnimationFrame(frame);

	// For ROKI's automatic play test: a peek at the game, and a way to start any level
	window.__wobbleBrawl = {
		startAt: (n) => startLevel(Math.max(1, Math.floor(n) || 1)),
		peek: () => ({
			state, level, best,
			player: player && { hp: player.hp, ko: player.ko, x: player.torso.position.x, y: player.torso.position.y, angle: player.torso.angle, headY: player.head.position.y, grounded: player.grounded },
			enemies: enemies.map((e) => ({ name: e.name, hp: e.hp, ko: e.ko, x: e.torso.position.x, y: e.torso.position.y, headX: e.head.position.x, headY: e.head.position.y, angle: e.torso.angle })),
			view,
		}),
	};
})();
