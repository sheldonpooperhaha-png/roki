// Wobble Brawl: an original physics brawler made for ROKI. Every fighter is a ragdoll (Matter.js bodies
// held together by pin joints) that tries to stand and strike. Moving toward an enemy throws punches;
// hits land on how fast a fist, foot or weapon is moving when it connects, and a knocked-out fighter
// goes fully floppy. Weapons lie on the roof to grab and throw; coins from wins buy weapons and skins.
"use strict";
(() => {
	const { Engine, Bodies, Body, Composite, Constraint, Events } = window.Matter;

	/* ---------- Basics ---------- */
	const WORLD_W = 1400;
	const FLOOR_Y = 700;
	const STEP = 1000 / 60;
	const TAU = Math.PI * 2;
	const SWING = 16; // steps a weapon swing takes
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
	const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
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
	const CAT = { world: 0x0001, loose: 0x0002, fighter: 0x0004, armed: 0x0008 };
	const vel = (b) => Body.getVelocity(b);
	const addVel = (b, x, y) => {
		const v = vel(b);
		Body.setVelocity(b, { x: v.x + x, y: v.y + y });
	};
	// The point `d` along a body's own down axis
	const along = (b, d) => ({ x: b.position.x - Math.sin(b.angle) * d, y: b.position.y + Math.cos(b.angle) * d });
	// Speed of one point of a spinning body
	const pointVel = (b, p) => {
		const v = vel(b);
		const w = Body.getAngularVelocity(b);
		return { x: v.x - w * (p.y - b.position.y), y: v.y + w * (p.x - b.position.x) };
	};

	const store = {
		get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
	};

	/* ---------- Weapons, skins and fighters ---------- */
	// Shapes are measured from the handle end (d = 0) toward the head; `grip` is where the hand holds it
	const WEAPONS = {
		bat: { name: "Bat", price: 40, mult: 1.35, cool: 20, len: 88, grip: 12, shape: [{ d0: 0, d1: 88, w: 14, dens: 0.0018 }] },
		plank: { name: "Plank", price: 60, mult: 1.3, cool: 22, len: 110, grip: 14, shape: [{ d0: 0, d1: 110, w: 14, dens: 0.0014 }] },
		sword: { name: "Toy Sword", price: 100, mult: 1.5, cool: 16, len: 92, grip: 10, shape: [{ d0: 0, d1: 92, w: 11, dens: 0.0016 }] },
		pan: { name: "Frying Pan", price: 140, mult: 1.7, cool: 22, len: 78, grip: 10, shape: [{ d0: 0, d1: 42, w: 9, dens: 0.0015 }, { d: 58, r: 20, dens: 0.0022 }] },
		hammer: { name: "Hammer", price: 200, mult: 2, cool: 28, len: 77, grip: 10, shape: [{ d0: 0, d1: 60, w: 10, dens: 0.0015 }, { d0: 55, d1: 77, w: 36, dens: 0.0026 }] },
	};
	const WEAPON_IDS = Object.keys(WEAPONS);
	const SKINS = [
		{ id: "teal", name: "Classic", price: 0, color: "#2de0c0", dark: "#13a38b", look: "band", band: "#ffffff" },
		{ id: "lime", name: "Lime", price: 50, color: "#9be15d", dark: "#5fa52e", look: "cap", hat: "#2f6fe0" },
		{ id: "bubble", name: "Bubblegum", price: 80, color: "#ff8fc7", dark: "#d9549a", look: "party", hat: "#ffd23f" },
		{ id: "ice", name: "Ice", price: 120, color: "#9fd8ff", dark: "#5aa6e0", look: "beanie", hat: "#ffffff" },
		{ id: "shadow", name: "Shadow", price: 160, color: "#5b6185", dark: "#363a57", look: "band", band: "#ff4d6d" },
		{ id: "gold", name: "Gold", price: 250, color: "#ffc93c", dark: "#c9930a", look: "tophat", hat: "#1b1d2e" },
	];
	const P2_SKIN = { color: "#ff7a45", dark: "#c4501f", look: "cap", hat: "#1b1d2e" };
	const HUMAN = { scale: 1, hp: 120, power: 1.12, speed: 4.7, punchCool: 14 };
	const TYPES = {
		brawler: { name: "Brawler", scale: 1, hp: 100, power: 0.9, speed: 3.3, punchCool: 22, aggro: 0.34, miss: 30, think: 12, kick: 0.25, color: "#ff7a45", dark: "#c4501f", look: "plain" },
		zippy: { name: "Zippy", scale: 0.86, hp: 70, power: 0.75, speed: 4.5, punchCool: 15, aggro: 0.5, miss: 34, think: 8, kick: 0.15, color: "#ffd23f", dark: "#c99a06", look: "spikes" },
		bruiser: { name: "Bruiser", scale: 1.22, hp: 150, power: 1.2, speed: 2.6, punchCool: 26, aggro: 0.3, miss: 24, think: 14, kick: 0.35, heavy: 1.3, color: "#a78bfa", dark: "#7458d6", look: "brows" },
		boss: { name: "The Boss", scale: 1.55, hp: 290, power: 1.45, speed: 2.9, punchCool: 24, aggro: 0.42, miss: 20, think: 11, kick: 0.3, heavy: 1.45, color: "#ff4d6d", dark: "#b81d3c", look: "crown" },
	};

	/* ---------- Saved progress ---------- */
	const SAVE_KEY = "wobble-brawl:save";
	const save = (() => {
		let d = null;
		try { d = JSON.parse(store.get(SAVE_KEY) || "null"); } catch (e) {}
		if (!d || typeof d !== "object") d = {};
		const list = (x, ok) => (Array.isArray(x) ? x.filter((v) => typeof v === "string" && ok(v)) : []);
		const s = {
			coins: Math.max(0, Math.floor(Number(d.coins) || 0)),
			best: Math.max(0, Math.floor(Number(d.best) || Number(store.get("wobble-brawl:best")) || 0)),
			skins: list(d.skins, (v) => SKINS.some((k) => k.id === v)),
			weapons: list(d.weapons, (v) => v in WEAPONS),
			skin: typeof d.skin === "string" ? d.skin : "teal",
			weapon: typeof d.weapon === "string" ? d.weapon : null,
		};
		if (!s.skins.includes("teal")) s.skins.unshift("teal");
		if (!s.skins.includes(s.skin)) s.skin = "teal";
		if (s.weapon && !s.weapons.includes(s.weapon)) s.weapon = null;
		return s;
	})();
	const persist = () => store.set(SAVE_KEY, JSON.stringify(save));

	/* ---------- Physics world ---------- */
	const engine = Engine.create({ positionIterations: 10, velocityIterations: 8, constraintIterations: 6 });
	engine.gravity.y = 0.85;
	const G_STEP = 0.85 * 0.001 * STEP * STEP; // how much speed gravity adds per step
	const world = engine.world;
	const wall = { isStatic: true, friction: 0.9, restitution: 0.1 };
	Composite.add(world, [
		Bodies.rectangle(WORLD_W / 2, FLOOR_Y + 150, WORLD_W + 800, 300, { ...wall, label: "floor" }),
		Bodies.rectangle(-150, 0, 300, 2400, { ...wall, label: "wall" }),
		Bodies.rectangle(WORLD_W + 150, 0, 300, 2400, { ...wall, label: "wall" }),
		Bodies.rectangle(WORLD_W / 2, -650, WORLD_W + 800, 300, { ...wall, label: "wall" }),
	]);

	let fighters = [];
	let humans = [];
	let enemies = [];
	let weapons = [];

	let nextGroup = 1;
	function makeFighter(t, x, team, facing) {
		const s = t.scale;
		const heavy = t.heavy || 1;
		const group = -nextGroup++;
		const filter = { group, category: CAT.fighter, mask: 0xffffffff };
		const opts = (extra) => ({ collisionFilter: filter, friction: 0.12, frictionAir: 0.008, restitution: 0.05, density: 0.0016 * heavy, ...extra });
		const ty = FLOOR_Y - 84 * s; // torso center when standing
		const torso = Bodies.rectangle(x, ty, 28 * s, 58 * s, opts({ chamfer: { radius: 12 * s } }));
		const head = Bodies.circle(x, ty - 46 * s, 17 * s, opts({ density: 0.0021 * heavy }));
		const limb = (y, w, len) => Bodies.rectangle(x, y, w * s, len * s, opts({ chamfer: { radius: (w * s) / 2 - 0.5 } }));
		const pin = (a, pa, b, pb) => Constraint.create({ bodyA: a, pointA: { x: 0, y: pa * s }, bodyB: b, pointB: { x: 0, y: pb * s }, length: 0, stiffness: 1, damping: 0.05 });

		const f = {
			t, s, team, facing, group, name: t.name,
			hp: t.hp, maxHp: t.hp, power: t.power, speed: t.speed, punchCool: t.punchCool,
			weight: heavy * s * s,
			color: t.color, dark: t.dark, look: t.look, band: t.band, hat: t.hat,
			flashColor: lighten(t.color, 0.6), flashDark: lighten(t.dark, 0.6),
			torso, head, arms: [], legs: [], bodies: [torso, head], joints: [],
			move: 0, aim: { x: x + facing * 200, y: ty - 46 * s }, grounded: true, weapon: null, equip: null, equipT: 0,
			stepT: 0, stepLeg: 0, crouch: 0, reach: null, throwT: 0, lungeT: 0, lungeCool: 0, airLunges: 0, lungeStrike: false, lungeArm: 0, held: null, heldBy: null, thrownBy: null, thrownT: 0, thrownHit: false, trail: [], swingTrail: [],
			stun: 0, ko: false, flash: 0, hurt: 0, phase: 0, cool: 0, kcool: 0, jcool: 0, slamCool: 0, nextArm: 0,
			ai: { timer: 30, err: { x: 0, y: 0 }, want: null, target: null },
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

	function makeWeapon(type, x, y, angle) {
		const t = WEAPONS[type];
		const filter = { group: 0, category: CAT.loose, mask: CAT.world | CAT.loose };
		const base = { collisionFilter: filter, friction: 0.7, frictionAir: 0.012, restitution: 0.15 };
		const parts = t.shape.map((p) =>
			p.r
				? Bodies.circle(x, y - p.d, p.r, { ...base, density: p.dens })
				: Bodies.rectangle(x, y - (p.d0 + p.d1) / 2, p.w, p.d1 - p.d0, { ...base, density: p.dens, chamfer: { radius: Math.min(p.w, p.d1 - p.d0) / 2 - 0.5 } }),
		);
		const body = parts.length > 1 ? Body.create({ parts, ...base }) : parts[0];
		// Matter copies the options, so share the body's own filter with its parts and change that one later
		for (const part of body.parts) part.collisionFilter = body.collisionFilter;
		const w = {
			type, t, body, filter: body.collisionFilter,
			gripLocal: { x: x - body.position.x, y: y - t.grip - body.position.y },
			holder: null, joint: null, thrownBy: null, thrownT: 0, thrownHit: false, swingHit: false, ungroupT: 0,
		};
		body.wpn = w;
		Body.setAngle(body, angle);
		Composite.add(world, body);
		weapons.push(w);
		return w;
	}

	// A weapon lying around can be walked over; held or flying, it hits fighters
	function setLoose(w, loose) {
		w.filter.category = loose ? CAT.loose : CAT.armed;
		w.filter.mask = loose ? CAT.world | CAT.loose : 0xffffffff;
	}

	const gripOf = (w) => {
		const g = rot(w.gripLocal, w.body.angle);
		return { x: w.body.position.x + g.x, y: w.body.position.y + g.y };
	};

	// Holds w where it is: the grip is pulled into the hand by the joint (used when a reach touches it)
	function hold(f, w) {
		const arm = f.arms[0].l;
		w.filter.group = f.group;
		setLoose(w, false);
		w.joint = Constraint.create({ bodyA: arm, pointA: rot({ x: 0, y: 16 * f.s }, arm.angle), bodyB: w.body, pointB: rot(w.gripLocal, w.body.angle), length: 0, stiffness: 0.9, damping: 0.1 });
		Composite.add(world, w.joint);
		w.holder = f;
		w.thrownBy = null;
		w.thrownT = 0;
		w.ungroupT = 0;
		f.weapon = w;
	}

	// Puts w straight into the hand (a starting weapon)
	function attach(f, w) {
		const arm = f.arms[0].l;
		const hand = along(arm, 16 * f.s);
		const ang = arm.angle + Math.PI;
		Body.setAngle(w.body, ang);
		const g = rot(w.gripLocal, ang);
		Body.setPosition(w.body, { x: hand.x - g.x, y: hand.y - g.y });
		Body.setVelocity(w.body, vel(arm));
		Body.setAngularVelocity(w.body, 0);
		w.filter.group = f.group; // never bumps its own holder
		setLoose(w, false);
		w.joint = Constraint.create({ bodyA: arm, pointA: rot({ x: 0, y: 16 * f.s }, arm.angle), bodyB: w.body, pointB: g, length: 0, stiffness: 1, damping: 0.05 });
		Composite.add(world, w.joint);
		w.holder = f;
		w.thrownBy = null;
		w.thrownT = 0;
		w.ungroupT = 0;
		f.weapon = w;
	}

	function drop(f, throwIt) {
		const w = f.weapon;
		if (!w) return;
		if (w.joint) Composite.remove(world, w.joint);
		w.joint = null;
		w.holder = null;
		f.weapon = null;
		w.ungroupT = 12;
		if (throwIt) {
			Body.setVelocity(w.body, { x: f.facing * 24, y: -6 });
			Body.setAngularVelocity(w.body, f.facing * 0.3);
			w.thrownBy = f;
			w.thrownT = 70;
			w.thrownHit = false;
			sfx.whoosh();
		}
	}

	// How far a point is from the weapon's length (handle end to head)
	function distToWeapon(w, p) {
		const g = gripOf(w);
		const a = w.body.angle;
		const ax = { x: Math.sin(a), y: -Math.cos(a) };
		const t = clamp((p.x - g.x) * ax.x + (p.y - g.y) * ax.y, -w.t.grip, w.t.len - w.t.grip);
		return Math.hypot(p.x - (g.x + ax.x * t), p.y - (g.y + ax.y * t));
	}

	function nearestFreeWeapon(f, range) {
		let best = null;
		let bestD = Infinity;
		for (const w of weapons) {
			if (w.holder || w.thrownT > 0) continue;
			const dx = Math.abs(w.body.position.x - f.torso.position.x);
			const dy = Math.abs(w.body.position.y - f.torso.position.y);
			if (dx < range && dy < 170 * f.s && dx < bestD) {
				best = w;
				bestD = dx;
			}
		}
		return best;
	}

	function removeWeapon(w) {
		if (w.holder) drop(w.holder, false);
		Composite.remove(world, w.body);
		weapons = weapons.filter((x) => x !== w);
	}

	const shoulder = (f) => along(f.torso, -24 * f.s);
	const hip = (f) => along(f.torso, 25 * f.s);
	const reachOf = (f) => 60 * f.s + 20 + (f.weapon ? f.weapon.t.len * 0.7 : 0);
	const opponentsOf = (f) => fighters.filter((o) => o.team !== f.team && !o.ko);
	function nearestOpponent(f) {
		let best = null;
		for (const o of opponentsOf(f)) {
			if (!best || Math.abs(o.torso.position.x - f.torso.position.x) < Math.abs(best.torso.position.x - f.torso.position.x)) best = o;
		}
		return best;
	}

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
		if (f.heldBy) f.stun = Math.max(f.stun, 2);
		if (f.held) {
			const h = f.held;
			if (--h.t <= 0 || f.ko || f.stun > 0 || h.foe.ko) release(f);
		}
		if (f.thrownT > 0) {
			f.thrownT--;
			f.stun = Math.max(f.stun, 2); // limp until it lands
		}
		const str = f.ko ? 0 : f.stun > 0 ? 0.08 : 1;
		const fc = f.facing;
		const v = vel(T);

		const feet = f.legs.map((l) => along(l.l, 19 * s).y);
		f.grounded = Math.max(...feet) > FLOOR_Y - 14 * s || T.position.y > FLOOR_Y - 46 * s;

		// Reaching for a weapon: bend toward it, and grab it once the hand touches the grip
		f.crouch = 0;
		let reachLean = 0;
		if (f.reach && f.reach.foe) {
			const o = f.reach.foe;
			if (o.ko || o.heldBy || f.held) f.reach = null;
			else {
				f.move = Math.sign(o.torso.position.x - T.position.x) * 0.8; // step in to grab
				const hand = along(f.arms[0].l, 16 * s);
				let best = null;
				let bestD = 42 * s;
				for (const b of [o.torso, o.head, ...o.arms.map((a) => a.u), ...o.legs.map((l) => l.u)]) {
					const d = Math.hypot(hand.x - b.position.x, hand.y - b.position.y) - 10 * o.s;
					if (d < bestD) {
						best = b;
						bestD = d;
					}
				}
				if (best) {
					grabFoe(f, o, best);
					f.reach = null;
				} else if (--f.reach.t <= 0) f.reach = null;
			}
		} else if (f.reach) {
			const w = f.reach.w;
			if (w && !w.holder && !f.weapon && weapons.includes(w)) {
				const g = gripOf(w);
				if (g.y > T.position.y) {
					f.crouch = clamp(g.y - T.position.y, 0, 44 * s);
					reachLean = Math.sign(g.x - T.position.x || fc) * 0.9;
				}
				const hand = along(f.arms[0].l, 16 * s);
				if (distToWeapon(w, hand) < 30 * s) {
					hold(f, w);
					sfx.pickup();
					f.reach = null;
				}
			}
			if (f.reach && --f.reach.t <= 0) f.reach = null;
		}

		// Hold the body up (a little springy, so it bobs) and lurch it along one step at a time
		if (str > 0) {
			let vy = v.y;
			if (f.grounded) {
				const dy = FLOOR_Y - 80 * s + f.crouch - T.position.y; // > 0: torso is above standing height
				if (dy < 8 * s) vy += (dy * 0.085 - v.y * 0.2 - 0.47) * str;
			}
			let vx = v.x;
			if (f.move) vx += (f.move * f.speed * (f.held ? 0.7 : 1) - v.x) * (f.grounded ? 0.2 : 0.03) * str;
			else if (f.grounded) vx *= 1 - 0.12 * str; // plant the feet
			Body.setVelocity(T, { x: vx, y: vy });
			if (f.move && f.grounded) {
				if (--f.stepT <= 0) {
					f.stepT = Math.round(15 / Math.max(0.6, f.speed / 4.7));
					f.stepLeg ^= 1;
					const leg = f.legs[f.stepLeg];
					addVel(leg.l, f.move * 5 * str, -5 * str);
					addVel(leg.u, f.move * 2.5 * str, -2.5 * str);
					addVel(T, f.move * 1.2 * str, -1.6 * str);
				}
			} else {
				f.stepT = 0;
			}
		}

		// Lean into the walk and into punches; the body sways because the hold is loose
		const punching = f.arms.some((a) => a.t > 0);
		const lean = f.lungeT > 14 ? fc * 0.7 : reachLean || f.move * 0.2 + (punching ? fc * 0.16 : 0);
		const air = f.grounded ? 1 : 0.25; // in the air the body tumbles, on the ground it rights itself
		turnTo(T, lean, (f.lungeT > 14 ? 0.12 : 0.18 * air) * str, 0.22 * air * str);
		turnTo(f.head, T.angle * 0.5, 0.14 * str, 0.14 * str);

		// Legs: walk cycle on the ground, tucked in the air, a straight leg when kicking
		const speed = Math.abs(v.x);
		if (f.grounded && speed > 0.5) f.phase += speed * 0.08;
		const swing = f.grounded ? Math.min(1, speed / 3) * 0.55 : 0;
		f.legs.forEach((leg, i) => {
			let ta;
			let sa;
			let k = f.grounded ? 0.22 : 0.1;
			if (leg.t > 0) {
				const h = hip(f);
				const d = norm(f.aim.x - h.x, clamp(f.aim.y - h.y, -90 * s, 10 * s));
				ta = sa = angleFor(d.x, d.y);
				k = 0.55;
			} else if (f.grounded) {
				const ph = f.phase + i * Math.PI;
				ta = angleFor(fc * (i ? -0.12 : 0.14) + Math.sin(ph) * swing * Math.sign(v.x || fc), 1);
				sa = ta + fc * (0.12 + Math.max(0, Math.cos(ph)) * 0.7 * Math.min(1, speed / 2));
			} else {
				ta = angleFor(fc * (i ? 0.15 : 0.55), 1);
				sa = ta + fc * 0.9;
			}
			turnTo(leg.u, ta, k * str, 0.3 * str);
			turnTo(leg.l, sa, k * str, 0.3 * str);
		});

		// Arms: fists up, a straight arm at the target while punching, or a weapon raised and swung
		f.arms.forEach((arm, i) => {
			let ua;
			let la;
			let k = 0.2;
			if (i === 0 && f.reach) {
				const w = f.reach.w;
				const sh = shoulder(f);
				const g = f.reach.foe ? f.reach.foe.torso.position : w ? gripOf(w) : { x: sh.x + fc * 80, y: sh.y + 60 };
				const d = norm(g.x - sh.x, g.y - sh.y);
				ua = la = angleFor(d.x, d.y);
				k = 0.55;
			} else if (i === 0 && f.held && f.throwT <= 0) {
				ua = angleFor(fc * 0.9, -0.15);
				la = angleFor(fc * 0.9, -0.35);
				k = 0.5;
			} else if (i === 0 && f.throwT > 0) {
				ua = la = f.throwT > 8 ? angleFor(-fc * 0.7, -0.8) : angleFor(fc, -0.35);
				k = 0.7;
			} else if (i === 0 && f.weapon) {
				if (arm.t > 0) {
					const p = 1 - arm.t / SWING;
					const start = angleFor(-fc * 0.45, -1);
					// Sweep over the top and finish pointing at the target, with a little follow-through
					const sh = shoulder(f);
					const to = norm(f.aim.x - sh.x, f.aim.y - sh.y);
					const end = angleFor(to.x, to.y) + fc * 0.35;
					let sweep = fc > 0 ? (((end - start) % TAU) + TAU) % TAU : -((((start - end) % TAU) + TAU) % TAU);
					sweep = clamp(sweep, -3.6, 3.6);
					const e = p < 0.3 ? 0 : Math.min(1, (p - 0.3) / 0.4);
					ua = la = start + sweep * e;
					k = 0.7;
					if (arm.t === Math.round(SWING * 0.7) && str > 0) {
						const dir = Math.sign(sweep) || fc;
						Body.setAngularVelocity(f.weapon.body, dir * 0.42);
						Body.setAngularVelocity(arm.l, dir * 0.35);
					}
				} else {
					ua = angleFor(fc * 0.5, 0.6);
					la = angleFor(fc * 0.35, -1);
					k = 0.25;
				}
			} else if (arm.t > 0) {
				const sh = shoulder(f);
				const d = norm(f.aim.x - sh.x, f.aim.y - sh.y);
				ua = la = angleFor(d.x, d.y);
				k = 0.6;
			} else {
				ua = angleFor(fc * (i ? 0.3 : 0.55), 0.8);
				la = angleFor(fc * (i ? 0.62 : 0.5), -0.9);
				k = f.grounded ? 0.13 : 0.06;
			}
			turnTo(arm.u, ua, k * str, 0.3 * str);
			turnTo(arm.l, la, k * str, 0.3 * str);
		});
		if (f.weapon) {
			const firm = f.arms[0].t > 0 || f.throwT > 0;
			if (f.ko) drop(f, false);
			else turnTo(f.weapon.body, f.arms[0].l.angle + Math.PI, (firm ? 0.45 : 0.22) * str, (firm ? 0.3 : 0.14) * str);
		}
		if (f.throwT > 0) {
			f.throwT--;
			if (f.throwT === 6 && f.held) throwFoe(f);
			if (f.throwT === 6 && f.weapon) {
				const w = f.weapon;
				const hand = along(f.arms[0].l, 16 * s);
				drop(f, false);
				// Aim at the nearest fighter in front: fast and fairly flat, allowing for the drop
				const opp = nearestOpponent(f);
				const SPEED = 21;
				let vy = -3;
				if (opp && (opp.torso.position.x - hand.x) * fc > 0) {
					const steps = Math.max(4, Math.abs(opp.torso.position.x - hand.x) / SPEED);
					vy = clamp((opp.torso.position.y - 10 * opp.s - hand.y) / steps - 0.5 * G_STEP * steps, -12, 6);
				}
				Body.setVelocity(w.body, { x: fc * SPEED, y: vy });
				Body.setAngularVelocity(w.body, fc * 0.3);
				w.thrownBy = f;
				w.thrownT = 70;
				w.thrownHit = false;
				setLoose(w, false);
				sfx.whoosh();
			}
		}
		if (f.equip && f.equipT > 0 && --f.equipT === 0 && !f.ko && !f.weapon) {
			const hand = along(f.arms[0].l, 16 * f.s);
			attach(f, makeWeapon(f.equip, hand.x, hand.y, 0));
		}

		for (const a of f.arms) if (a.t > 0) a.t--;
		for (const l of f.legs) if (l.t > 0) l.t--;
		if (f.cool > 0) f.cool--;
		lungeStrike(f);
		if (f.lungeT > 0) f.lungeT--;
		if (f.lungeCool > 0) f.lungeCool--;
		if (f.grounded && f.lungeT <= 0) f.airLunges = 0;
		// Speed streaks behind a lunging or flying body, and a trail behind a swinging weapon
		const sp = Math.hypot(v.x, v.y);
		if (f.lungeT > 0 || sp > 15) f.trail.push({ x: T.position.x, y: T.position.y, life: 10 });
		for (const p of f.trail) p.life--;
		f.trail = f.trail.filter((p) => p.life > 0).slice(-12);
		if (f.weapon && f.arms[0].t > 0) {
			const w = f.weapon;
			const g = gripOf(w);
			const a = w.body.angle;
			const d = w.t.len - w.t.grip;
			f.swingTrail.push({ x: g.x + Math.sin(a) * d, y: g.y - Math.cos(a) * d, gx: g.x, gy: g.y, life: 9 });
		}
		for (const p of f.swingTrail) p.life--;
		f.swingTrail = f.swingTrail.filter((p) => p.life > 0);
		if (f.kcool > 0) f.kcool--;
		if (f.jcool > 0) f.jcool--;
		if (f.slamCool > 0) f.slamCool--;
		if (f.flash > 0) f.flash--;
		if (f.hurt > 0) f.hurt--;
	}

	const canAct = (f) => !f.ko && f.stun <= 0;

	function attack(f) {
		if (!canAct(f) || f.cool > 0 || f.reach || f.throwT > 0) return;
		if (f.weapon) {
			const arm = f.arms[0];
			arm.t = SWING;
			arm.hit = false;
			f.weapon.swingHit = false;
			f.cool = f.weapon.t.cool;
			sfx.whoosh();
			return;
		}
		const arm = f.held ? f.arms[1] : f.arms[f.nextArm];
		if (!f.held) f.nextArm ^= 1;
		arm.t = 11;
		arm.hit = false;
		f.cool = f.punchCool;
		const sh = shoulder(f);
		const d = norm(f.aim.x - sh.x, f.aim.y - sh.y);
		addVel(arm.l, d.x * 17, d.y * 17);
		addVel(arm.u, d.x * 8, d.y * 8);
		addVel(f.torso, d.x * 3, 0);
		sfx.whoosh();
	}

	function kick(f) {
		if (!canAct(f) || f.kcool > 0 || f.cool > 0) return;
		const leg = f.legs[0];
		leg.t = 14;
		leg.hit = false;
		f.kcool = 30;
		f.cool = 10;
		const h = hip(f);
		const d = norm(f.aim.x - h.x, clamp(f.aim.y - h.y, -90 * f.s, 10 * f.s));
		addVel(leg.l, d.x * 19, d.y * 19);
		addVel(leg.u, d.x * 9, d.y * 9);
		sfx.whoosh();
	}

	function jump(f) {
		if (!canAct(f) || !f.grounded || f.jcool > 0) return;
		f.jcool = 30;
		for (const b of f.bodies) addVel(b, 0, -12);
		addVel(f.torso, 0, -3);
		sfx.jump();
	}

	// Tap a direction: the whole body launches that way, fist (or weapon) first. Two lunges in the air.
	function lunge(f, dir) {
		if (!canAct(f) || f.lungeCool > 0 || f.reach || f.throwT > 0 || f.held) return false;
		if (!f.grounded && f.airLunges >= 2) return false;
		if (!f.grounded) f.airLunges++;
		f.facing = dir;
		f.lungeT = 32;
		f.lungeCool = 20;
		const up = f.grounded ? (f.weapon ? -3.5 : -5) : -3;
		for (const b of f.bodies) {
			const v = vel(b);
			Body.setVelocity(b, { x: dir * 8.5, y: Math.min(v.y, 0) + up });
		}
		// The strike stays live for the whole flight: the fist leads until it lands, a weapon swings once in reach
		f.lungeStrike = true;
		if (!f.weapon) {
			f.lungeArm = f.nextArm;
			f.cool = 0;
			attack(f);
		}
		return true;
	}

	function lungeStrike(f) {
		if (!f.lungeStrike) return;
		if (f.lungeT <= 0 || f.ko || f.stun > 0) {
			f.lungeStrike = false;
			return;
		}
		if (f.weapon) {
			const opp = nearestOpponent(f);
			const dx = opp ? opp.torso.position.x - f.torso.position.x : 0;
			// Start the swing early enough that the wind-up finishes as you arrive
			const closing = Math.max(0, vel(f.torso).x * f.facing) * SWING * 0.45;
			if (opp && dx * f.facing > -10 && Math.abs(dx) < reachOf(f) + closing) {
				f.cool = 0;
				attack(f);
				f.lungeStrike = false;
			}
		} else {
			const arm = f.arms[f.lungeArm];
			if (arm.hit) f.lungeStrike = false;
			else arm.t = Math.max(arm.t, 2);
		}
	}

	// Space: reach out and grab the nearest weapon (the hand has to touch it), or throw the one you hold
	function grab(f) {
		if (!canAct(f) || f.reach || f.throwT > 0) return;
		if (f.weapon || f.held) {
			f.throwT = 16;
			return;
		}
		const opp = nearestOpponent(f);
		if (opp && !opp.heldBy) {
			const dx = opp.torso.position.x - f.torso.position.x;
			if (Math.abs(dx) < 125 * f.s + 20 * opp.s && Math.abs(opp.torso.position.y - f.torso.position.y) < 190) {
				f.facing = Math.sign(dx) || f.facing;
				f.reach = { foe: opp, t: 22 };
				return;
			}
		}
		f.reach = { w: nearestFreeWeapon(f, 130 * f.s), t: 24 };
	}

	// The hand closes on whatever part of the enemy it touched; they go limp until thrown or free
	function grabFoe(f, o, b) {
		const arm = f.arms[0].l;
		const hand = along(arm, 16 * f.s);
		const joint = Constraint.create({ bodyA: arm, pointA: rot({ x: 0, y: 16 * f.s }, arm.angle), bodyB: b, pointB: { x: hand.x - b.position.x, y: hand.y - b.position.y }, length: 0, stiffness: 0.7, damping: 0.1 });
		Composite.add(world, joint);
		f.held = { foe: o, joint, t: 150 };
		o.heldBy = f;
		drop(o, false);
		o.reach = null;
		o.lungeStrike = false;
		popups.push({ x: hand.x, y: hand.y - 30, text: "GRAB!", size: 26, life: 40, max: 40, color: "#ffffff" });
		sfx.pickup();
	}

	function release(f) {
		const h = f.held;
		if (!h) return;
		Composite.remove(world, h.joint);
		h.foe.heldBy = null;
		f.held = null;
	}

	function throwFoe(f) {
		const o = f.held.foe;
		release(f);
		const fc = f.facing;
		const k = 1 / Math.sqrt(o.weight);
		const carry = vel(f.torso).x * 0.5;
		for (const b of o.bodies) Body.setVelocity(b, { x: fc * 9.5 * k + carry, y: -8.5 * k });
		Body.setAngularVelocity(o.torso, fc * 0.25);
		o.stun = Math.max(o.stun, 30);
		o.thrownBy = f;
		o.thrownT = 180;
		o.thrownHit = false;
		shake = Math.min(18, shake + 6);
		sfx.whoosh();
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

	// x hits y: a fist or foot mid-punch/kick, a weapon mid-swing, or a thrown weapon
	function strike(x, y, pair) {
		const py = y.wb;
		if (!py || py.f.ko) return;
		const V = py.f;
		let A;
		let mult;
		let done;
		if (x.wpn) {
			const w = x.wpn;
			if (w.holder) {
				A = w.holder;
				const arm = A.arms[0];
				if (A.team === V.team || A.ko || arm.t <= 0 || arm.t > SWING * 0.75 || w.swingHit) return;
				mult = w.t.mult;
				done = () => { w.swingHit = true; };
			} else if (w.thrownT > 0 && w.thrownBy && !w.thrownHit) {
				A = w.thrownBy;
				if (A.team === V.team) return;
				mult = w.t.mult * 0.85;
				done = () => { w.thrownHit = true; };
			} else {
				return;
			}
		} else if (x.wb && x.wb.f !== V && x.wb.f.thrownT > 0 && x.wb.f.thrownBy && x.wb.f.thrownBy.team !== V.team && !x.wb.f.thrownHit) {
			const T = x.wb.f;
			A = T.thrownBy;
			mult = 0.7;
			done = () => { T.thrownHit = true; };
		} else {
			const px = x.wb;
			if (!px || px.f === V || px.f.team === V.team) return;
			A = px.f;
			const limb = px.kind === "larm" ? A.arms[px.i] : px.kind === "shin" ? A.legs[px.i] : null;
			if (!limb || limb.t <= 0 || limb.hit || A.ko) return;
			if (px.kind === "larm" && px.i === 0 && A.weapon) return; // that hand hits with its weapon
			mult = px.kind === "shin" ? 1.25 : 1;
			done = () => { limb.hit = true; };
		}
		const at = contactPoint(pair, y);
		const va = pointVel(x, at);
		const vb = vel(y);
		const rx = va.x - vb.x;
		const ry = va.y - vb.y;
		const rv = Math.hypot(rx, ry);
		if (rv < 6) return;
		done();
		const head = py.kind === "head";
		const part = head ? 1.7 : py.kind === "torso" ? 1 : 0.55;
		const dmg = Math.min(60, (rv - 4) * 0.9 * part * A.power * mult);
		hurt(V, dmg, y, rx / rv, ry / rv, (8 + rv * 0.7) * A.power * Math.min(1.6, mult), at, head);
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
		if (dmg >= 8) V.stun = Math.max(V.stun, Math.min(humans.includes(V) ? 22 : 46, Math.round(dmg * 1.6)));
		if (V.weapon && dmg >= 18 && Math.random() < 0.4) drop(V, false);
		if (V.held && dmg >= 8) release(V);
		if (dmg >= 8) V.reach = null;
		burst(at.x, at.y, Math.min(24, 6 + dmg / 2), head ? "#fff3b0" : "#ffffff", nx, ny);
		popups.push({ x: at.x, y: at.y - 10, text: String(dmg), size: 18 + Math.min(28, dmg * 0.7), life: 50, max: 50, color: head ? "#ffd23f" : "#ffffff" });
		shake = Math.min(18, shake + dmg * 0.45);
		if (dmg >= 12) hitStop = Math.min(7, Math.round(dmg / 5));
		sfx.hit(dmg, head);
		if (V.hp <= 0) knockOut(V, nx, ny);
	}

	function knockOut(V, nx, ny) {
		V.ko = true;
		V.stun = 0;
		drop(V, false);
		for (const b of V.bodies) addVel(b, nx * 13, ny * 5 - 11);
		slowmo = 70;
		shake = 20;
		burst(V.head.position.x, V.head.position.y, 34, "#ffd23f", nx, ny);
		popups.push({ x: V.head.position.x, y: V.head.position.y - 50, text: "K.O.!", size: 54, life: 75, max: 75, color: "#ffd23f" });
		sfx.ko();
	}

	// A head or body slammed into the floor or a wall hurts a little
	function slam(x, y) {
		const p = x.wb;
		if (!p || y.wb || y.wpn) return;
		const F = p.f;
		if (p.kind !== "head" && p.kind !== "torso" && !(F.thrownT > 0)) return;
		if (F.ko || F.slamCool > 0 || (F.stun <= 0 && F.grounded)) return;
		const thrown = F.thrownT > 0;
		const v = vel(x);
		const tv = vel(F.torso);
		const sp = thrown ? Math.max(Math.hypot(v.x, v.y), Math.hypot(tv.x, tv.y)) : Math.hypot(v.x, v.y);
		if (sp < (thrown ? 3 : 12)) return;
		F.slamCool = 24;
		if (thrown && y.label === "floor") F.thrownT = 0; // landed
		const n = norm(v.x, v.y);
		hurt(F, thrown ? clamp((sp - 2) * 2.2, 6, 34) : Math.min(20, (sp - 11) * 0.9), x, -n.x * 0.3, -n.y * 0.3, 2, { x: x.position.x, y: x.position.y }, false);
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
		pickup: () => tone(520, 0.1, "triangle", 0.08, 780),
		coin: () => [988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.12, "square", 0.05), i * 90)),
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

	/* ---------- Game flow ---------- */
	const $ = (id) => document.getElementById(id);
	const canvas = $("game");
	canvas.tabIndex = 0;
	const screens = { menu: $("menu"), cleared: $("cleared"), over: $("over"), match: $("match"), paused: $("paused"), shop: $("shop") };

	let mode = "solo"; // solo or duo
	let state = "menu"; // menu, fight, clear, over, roundEnd, result, paused
	let level = 1;
	let round = 0;
	let score = [0, 0];
	let startDelay = 0;
	let stateTimer = 0;
	let banner = null;
	let hintT = 0;
	let shopBack = null;

	function show(name) {
		for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
	}
	const visibleScreen = () => Object.values(screens).find((el) => !el.hidden) || null;

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

	const skinById = (id) => SKINS.find((k) => k.id === id) || SKINS[0];

	function clearArena() {
		for (const f of fighters) release(f);
		for (const w of [...weapons]) removeWeapon(w);
		for (const f of fighters) removeFighter(f);
		fighters = [];
		humans = [];
		enemies = [];
		particles.length = 0;
		popups.length = 0;
		hitStop = slowmo = shake = 0;
	}

	function spawnWeapon(type, x) {
		makeWeapon(type, x, FLOOR_Y - 40, Math.PI / 2 + rand(-0.15, 0.15));
	}

	function setupSolo(n, demo) {
		clearArena();
		mode = "solo";
		level = n;
		const p = makeFighter({ ...HUMAN, ...skinById(save.skin), name: "You" }, 300, "p1", 1);
		if (!demo && save.weapon) {
			p.equip = save.weapon;
			p.equipT = 20;
		}
		humans = [p];
		const list = demo ? ["brawler"] : roster(n);
		enemies = list.map((type, i) => {
			const e = makeFighter(enemyFor(type, n), Math.min(1320, 1080 + i * 115), "enemy", -1);
			if (!demo && n >= 3 && type !== "zippy" && Math.random() < Math.min(0.6, 0.15 + n * 0.04)) {
				e.equip = pick(WEAPON_IDS);
				e.equipT = 22 + i * 3;
			}
			return e;
		});
		fighters = [...humans, ...enemies];
		if (!demo) {
			if (n === 1) spawnWeapon("bat", 640);
			else for (let i = 0; i < (n >= 6 ? 2 : 1); i++) spawnWeapon(pick(WEAPON_IDS), rand(520, 900));
		}
		startDelay = 75;
	}

	function startLevel(n) {
		setupSolo(n, false);
		state = "fight";
		banner = { title: `Level ${n}`, sub: enemies.map((e) => e.name).join(" + "), life: 110, max: 110 };
		hintT = n === 1 ? 480 : 0;
		show(null);
		canvas.focus();
	}

	function startDuo() {
		score = [0, 0];
		round = 0;
		nextRound();
	}

	function nextRound() {
		clearArena();
		mode = "duo";
		round++;
		const p1 = makeFighter({ ...HUMAN, ...skinById(save.skin), hp: 150, name: "P1" }, 380, "p1", 1);
		const p2 = makeFighter({ ...HUMAN, ...P2_SKIN, hp: 150, name: "P2" }, 1020, "p2", -1);
		humans = [p1, p2];
		fighters = [p1, p2];
		spawnWeapon(pick(WEAPON_IDS), rand(560, 660));
		spawnWeapon(pick(WEAPON_IDS), rand(740, 840));
		startDelay = 60;
		state = "fight";
		banner = { title: `Round ${round}`, sub: "Fight!", life: 100, max: 100 };
		hintT = round === 1 ? 480 : 0;
		show(null);
		canvas.focus();
	}

	function toMenu() {
		setupSolo(1, true);
		state = "menu";
		banner = null;
		$("menu-info").innerHTML = `<span class="coins">${save.coins} coins</span>` + (save.best ? ` · Best: cleared level ${save.best}` : "");
		show("menu");
	}

	function pause(on) {
		if (on && state === "fight") {
			state = "paused";
			show("paused");
		} else if (!on && state === "paused") {
			state = "fight";
			show(null);
			canvas.focus();
		}
	}

	function finishLevel() {
		const p = humans[0];
		const earned = 8 + level * 4 + Math.round((10 * p.hp) / p.maxHp);
		save.coins += earned;
		save.best = Math.max(save.best, level);
		persist();
		popups.push({ x: p.head.position.x, y: p.head.position.y - 60, text: `+${earned} coins`, size: 30, life: 90, max: 90, color: "#ffd23f" });
		setTimeout(sfx.coin, 300);
		$("cleared-title").textContent = `Level ${level} cleared!`;
		$("cleared-text").innerHTML = `<span class="coins">+${earned} coins</span> · You have ${save.coins}`;
	}

	function openShop() {
		shopBack = Object.keys(screens).find((k) => !screens[k].hidden) || null;
		renderShop();
		show("shop");
		$("shop-done").focus();
	}
	function closeShop() {
		show(shopBack);
		if (shopBack === "menu") toMenu();
	}

	$("play").addEventListener("click", () => { audio(); startLevel(1); });
	$("duo").addEventListener("click", () => { audio(); startDuo(); });
	$("menu-shop").addEventListener("click", openShop);
	$("next").addEventListener("click", () => startLevel(level + 1));
	$("cleared-shop").addEventListener("click", openShop);
	$("retry").addEventListener("click", () => { audio(); startLevel(level); });
	$("over-shop").addEventListener("click", openShop);
	$("over-menu").addEventListener("click", toMenu);
	$("rematch").addEventListener("click", startDuo);
	$("match-menu").addEventListener("click", toMenu);
	$("resume").addEventListener("click", () => pause(false));
	$("quit").addEventListener("click", toMenu);
	$("shop-done").addEventListener("click", closeShop);
	document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });

	/* ---------- Input ---------- */
	const keys = {};
	const pressed = {};
	const CONTROLS = {
		solo: [{ left: ["a", "arrowleft"], right: ["d", "arrowright"], jump: ["w", "arrowup"], kick: ["s", "arrowdown"], grab: [" ", "enter"] }],
		duo: [
			{ left: ["a"], right: ["d"], jump: ["w"], kick: ["s"], grab: [" "] },
			{ left: ["arrowleft"], right: ["arrowright"], jump: ["arrowup"], kick: ["arrowdown"], grab: ["enter", "/", "shift"] },
		],
	};
	const isDown = (list) => list.some((k) => keys[k]);
	const wasPressed = (list) => list.some((k) => pressed[k]);

	addEventListener("keydown", (e) => {
		const k = e.key.toLowerCase();
		const scr = visibleScreen();
		if (scr) {
			if (scr === screens.shop) {
				if (k === "escape") closeShop();
				return;
			}
			if (k === "escape" && scr === screens.paused) {
				pause(false);
				return;
			}
			if (k === " " || k === "enter") {
				const focused = document.activeElement;
				if (focused && focused.tagName === "BUTTON" && scr.contains(focused)) return; // the button handles it
				e.preventDefault();
				if (!e.repeat) scr.querySelector("[data-primary]").click();
			}
			return;
		}
		if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "enter", "/"].includes(k)) e.preventDefault();
		if (k === "escape" || k === "p") {
			pause(true);
			return;
		}
		if (k === "m") {
			muted = !muted;
			store.set("wobble-brawl:muted", muted ? "1" : "0");
			popups.push({ text: muted ? "Sound off" : "Sound on", size: 26, life: 60, max: 60, color: "#ffffff", screen: true });
			return;
		}
		audio();
		if (!e.repeat) pressed[k] = true;
		keys[k] = true;
	});
	addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
	addEventListener("blur", () => { for (const k in keys) keys[k] = false; });
	canvas.addEventListener("pointerdown", () => { canvas.focus(); audio(); });
	canvas.addEventListener("contextmenu", (e) => e.preventDefault());

	// Moving toward an enemy is how you hit: a fresh tap always punches (or swings), and holding the key
	// keeps punching while someone is in reach.
	function humanInput(f, c) {
		const dir = (isDown(c.right) ? 1 : 0) - (isDown(c.left) ? 1 : 0);
		const tapR = wasPressed(c.right);
		const tapL = wasPressed(c.left);
		if (f.heldBy) {
			if (tapR || tapL || wasPressed(c.jump) || wasPressed(c.kick)) f.heldBy.held.t -= 14; // mash to break free
			f.move = 0;
			return;
		}
		f.move = dir;
		const opp = nearestOpponent(f);
		if (dir) f.facing = dir;
		else if (tapR !== tapL) f.facing = tapR ? 1 : -1; // a tap shorter than one frame still counts
		else if (opp) f.facing = opp.torso.position.x >= f.torso.position.x ? 1 : -1;
		const fc = f.facing;
		const dx = opp ? opp.torso.position.x - f.torso.position.x : 0;
		const ahead = opp && dx * fc > -20 && Math.abs(dx) < 280 * f.s;
		f.aim = ahead ? { x: opp.head.position.x, y: opp.head.position.y + 6 } : { x: f.torso.position.x + fc * 200, y: f.head.position.y + 10 };
		const tapped = tapR || tapL;
		if (tapped) {
			// On the ground a tap lunges at an enemy in front; with nobody there it just walks. In the air it always lunges.
			const d = tapR ? 1 : -1;
			const foe = opp && (opp.torso.position.x - f.torso.position.x) * d > 0 && Math.abs(dx) < 420 * f.s;
			if (!((foe || !f.grounded) && lunge(f, d)) && foe && Math.abs(dx) < reachOf(f) * 1.2) attack(f);
		} else if (dir && ahead && Math.abs(dx) < reachOf(f) * 1.1) attack(f);
		if (wasPressed(c.jump)) jump(f);
		if (wasPressed(c.kick)) kick(f);
		if (wasPressed(c.grab)) grab(f);
	}

	function enemyThink(e) {
		const ai = e.ai;
		const P = nearestOpponent(e);
		if (!P) {
			e.move = 0;
			return;
		}
		e.aim = { x: P.head.position.x + ai.err.x, y: P.head.position.y + ai.err.y };
		const dx = P.torso.position.x - e.torso.position.x;
		e.facing = dx >= 0 ? 1 : -1;
		if (e.ko || startDelay > 0 || state !== "fight") {
			e.move = 0;
			return;
		}
		if (ai.target && (ai.target.holder || ai.target.thrownT > 0 || !weapons.includes(ai.target) || e.weapon)) ai.target = null;
		if (--ai.timer <= 0) {
			const t = e.t;
			ai.timer = t.think + Math.floor(rand(0, 6));
			ai.err = { x: rand(-1, 1) * t.miss, y: rand(-1, 1) * t.miss };
			const dist = Math.abs(dx);
			const reach = reachOf(e);
			if (!e.weapon && !ai.target && Math.random() < 0.5) {
				const w = nearestFreeWeapon(e, 320);
				if (w && Math.abs(w.body.position.x - e.torso.position.x) < dist) ai.target = w;
			}
			if (ai.target) {
				const wx = ai.target.body.position.x - e.torso.position.x;
				e.move = Math.abs(wx) > 30 ? Math.sign(wx) : 0;
			} else if (dist > reach * 0.7) e.move = Math.sign(dx); // close in to where a fist actually lands
			else if (dist < reach * 0.35) e.move = -Math.sign(dx) * 0.6;
			else e.move = Math.random() < 0.3 ? Math.sign(dx) * 0.5 : 0;
			if (dist < reach * 0.9 && Math.random() < t.aggro + 0.15) ai.want = !e.weapon && Math.random() < t.kick ? "kick" : "attack";
			if (!e.weapon && !e.held && dist < reach && Math.random() < 0.12 + t.aggro * 0.1) ai.want = "grab";
			if (e.heldBy && Math.random() < 0.5) e.heldBy.held.t -= 10;
			if (e.weapon && dist > 380 && Math.random() < 0.05) grab(e); // throw it
			if (e.grounded && dist > reach * 1.6 && Math.random() < 0.06) jump(e);
			if (dist > reach * 0.9 && dist < 380 && e.lungeCool <= 0 && Math.random() < 0.25 + t.aggro * 0.6) lunge(e, Math.sign(dx));
		}
		if (ai.target) {
			e.facing = ai.target.body.position.x >= e.torso.position.x ? 1 : -1;
			if (Math.abs(ai.target.body.position.x - e.torso.position.x) < 95 * e.s && !e.reach) {
				grab(e);
				ai.target = null;
			}
		}
		if (e.held && e.held.t < 115) grab(e); // throw the one it's holding
		if (ai.want === "grab") {
			grab(e);
			ai.want = null;
		} else if (ai.want === "attack" && e.cool <= 0) {
			attack(e);
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
		if (hintT > 0) hintT--;

		const ctl = CONTROLS[mode];
		humans.forEach((h, i) => {
			if (state === "fight" && !h.ko) humanInput(h, ctl[i]);
			else h.move = 0;
		});
		for (const k in pressed) delete pressed[k];
		for (const e of enemies) enemyThink(e);
		for (const f of fighters) control(f);

		Engine.update(engine, STEP * ts);

		for (const f of fighters) {
			for (const b of f.bodies) {
				const v = vel(b);
				const sp = Math.hypot(v.x, v.y);
				if (sp > 40) Body.setVelocity(b, { x: (v.x / sp) * 40, y: (v.y / sp) * 40 });
			}
		}
		for (const w of [...weapons]) {
			if (w.ungroupT > 0 && --w.ungroupT === 0) {
				w.filter.group = 0;
				if (!(w.thrownT > 0)) setLoose(w, true);
			}
			if (w.thrownT > 0 && --w.thrownT === 0 && !w.holder) setLoose(w, true);
			if (w.body.position.y > 1600) removeWeapon(w);
		}

		if (state === "fight") {
			if (mode === "solo") {
				if (humans[0].ko) {
					state = "over";
					stateTimer = 100;
				} else if (enemies.every((e) => e.ko)) {
					state = "clear";
					stateTimer = 110;
					finishLevel();
					setTimeout(sfx.win, 500);
				}
			} else {
				const loser = humans.find((h) => h.ko);
				if (loser) {
					const wi = loser === humans[0] ? 1 : 0;
					score[wi]++;
					state = "roundEnd";
					stateTimer = 150;
				}
			}
		} else if (state === "clear") {
			if (--stateTimer === 0) {
				state = "result";
				show("cleared");
			}
		} else if (state === "over") {
			if (--stateTimer === 0) {
				state = "result";
				$("over-text").textContent = `Knocked out on level ${level}.` + (save.best ? ` Best: cleared level ${save.best}.` : "");
				show("over");
			}
		} else if (state === "roundEnd") {
			if (stateTimer === 110) {
				const winner = humans[1].ko ? "P1" : "P2";
				banner = { title: `${winner} wins the round!`, sub: `${score[0]} - ${score[1]}`, life: 100, max: 100 };
			}
			if (--stateTimer === 0) {
				if (Math.max(...score) >= 3) {
					state = "result";
					$("match-title").textContent = `${score[0] > score[1] ? "P1" : "P2"} wins!`;
					$("match-text").textContent = `${score[0]} - ${score[1]}`;
					show("match");
				} else {
					nextRound();
				}
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
			if (!p.screen) p.y -= 0.9;
			if (--p.life <= 0) popups.splice(i, 1);
		}
		if (banner && --banner.life <= 0) banner = null;
		shake *= 0.86;
		if (shake < 0.3) shake = 0;
	}

	/* ---------- Drawing ---------- */
	let ctx = canvas.getContext("2d");
	let W = 0;
	let H = 0;
	let dpr = 1;
	let view = { scale: 1, x: 0, y: 0 };
	const cam = { x: WORLD_W / 2, w: WORLD_W, h: 470 };

	function resize() {
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		W = innerWidth;
		H = innerHeight;
		canvas.width = Math.round(W * dpr);
		canvas.height = Math.round(H * dpr);
		updateCamera(true);
	}

	function updateCamera(snap) {
		let tx = WORLD_W / 2;
		let tw = WORLD_W;
		const live = fighters.filter((f) => !f.ko);
		if (state !== "menu" && live.length) {
			const xs = live.map((f) => f.torso.position.x);
			const lo = Math.min(...xs);
			const hi = Math.max(...xs);
			tx = (lo + hi) / 2;
			tw = clamp(hi - lo + 560, 820, WORLD_W);
		}
		cam.x += (tx - cam.x) * (snap ? 1 : 0.08);
		cam.w += (tw - cam.w) * (snap ? 1 : 0.05);
		// Zoom out (never up) so a fighter flying high stays in view along with the floor
		const live2 = fighters.filter((f) => !f.ko);
		const top = live2.length && state !== "menu" ? Math.min(...live2.map((f) => f.head.position.y)) : FLOOR_Y;
		const needH = clamp(FLOOR_Y - top + 90, 404, 1100) / 0.86; // world units the screen must show
		cam.h += (needH - cam.h) * (snap ? 1 : 0.07);
		const scale = Math.min(W / cam.w, H / cam.h);
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
			dot(s, s.r, "#dfe3ff");
		}
		ctx.globalAlpha = 1;
		dot({ x: 1120, y: 150 }, 46, "rgba(255, 236, 190, 0.9)");
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
	// A weapon, drawn from where it's held (g) along its angle (a)
	function drawWeaponAt(type, g, a) {
		const t = WEAPONS[type];
		const ax = { x: Math.sin(a), y: -Math.cos(a) };
		const pp = { x: Math.cos(a), y: Math.sin(a) };
		const Q = (d, o = 0) => ({ x: g.x + ax.x * (d - t.grip) + pp.x * o, y: g.y + ax.y * (d - t.grip) + pp.y * o });
		const segs = [];
		const dots = [];
		if (type === "bat") {
			segs.push([Q(3), Q(30), 8, "#a86f3a"], [Q(26), Q(40), 12, "#c98b4b"], [Q(36), Q(80), 16, "#c98b4b"]);
			dots.push([Q(2), 6, "#a86f3a"]);
		} else if (type === "plank") {
			segs.push([Q(4), Q(106), 14, "#b07a45"]);
		} else if (type === "sword") {
			segs.push([Q(3), Q(18), 7, "#5b4a8b"], [Q(21, -13), Q(21, 13), 6, "#ffd23f"], [Q(26), Q(86), 11, "#dbe9ff"]);
		} else if (type === "pan") {
			segs.push([Q(3), Q(38), 8, "#3a3a4a"]);
			dots.push([Q(58), 20, "#555b6e"]);
		} else if (type === "hammer") {
			segs.push([Q(3), Q(58), 9, "#c98b4b"], [Q(66, -8), Q(66, 8), 22, "#8e96b0"]);
		}
		ctx.lineCap = "round";
		for (const [p1, p2, w] of segs) stroke(p1, p2, w + 5, OUT);
		for (const [p, r] of dots) dot(p, r + 2.5, OUT);
		for (const [p1, p2, w, c] of segs) stroke(p1, p2, w, c);
		for (const [p, r, c] of dots) dot(p, r, c);
		if (type === "pan") dot(Q(58), 14, "#6b7287");
		if (type === "plank") for (const o of [-3.5, 3.5]) dot(Q(98, o), 1.8, "#cfd3e6");
		if (type === "sword") dot(Q(3), 4.5, "#ffd23f");
	}

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

		if (!f.preview) {
			const lift = clamp((FLOOR_Y - f.torso.position.y) / 300, 0, 1);
			ctx.fillStyle = `rgba(5, 6, 20, ${0.35 - lift * 0.2})`;
			ctx.beginPath();
			ctx.ellipse(f.torso.position.x, FLOOR_Y + 4, 34 * s * (1 - lift * 0.4), 7 * s, 0, 0, TAU);
			ctx.fill();
		}

		drawLimb(f.legs[1].u, 15 * s, 36 * s, dk, null, s, fc);
		drawLimb(f.legs[1].l, 13 * s, 38 * s, dk, "foot", s, fc);
		drawLimb(f.arms[1].u, 13 * s, 32 * s, dk, null, s, fc);
		drawLimb(f.arms[1].l, 11 * s, 32 * s, dk, "fist", s, fc);

		// Body, with darker shorts
		const T = f.torso;
		const top = along(T, -29 * s + 13 * s);
		const bot = along(T, 29 * s - 13 * s);
		stroke(top, bot, 26 * s + 5, OUT);
		stroke(top, bot, 26 * s, col);
		stroke(along(T, 14 * s), bot, 26 * s, dk);

		drawLimb(f.legs[0].u, 15 * s, 36 * s, col, null, s, fc);
		drawLimb(f.legs[0].l, 13 * s, 38 * s, col, "foot", s, fc);
		drawHead(f, col, dk);
		if (f.weapon) {
			const w = f.weapon;
			if (w.body) drawWeaponAt(w.type, gripOf(w), w.body.angle);
			else drawWeaponAt(w.type, along(f.arms[0].l, 16 * s), f.arms[0].l.angle + Math.PI);
		}
		drawLimb(f.arms[0].u, 13 * s, 32 * s, col, null, s, fc);
		drawLimb(f.arms[0].l, 11 * s, 32 * s, col, "fist", s, fc);
	}

	function drawHat(f, h, r, dk) {
		const s = f.s;
		const fc = f.facing;
		const look = f.look;
		ctx.strokeStyle = OUT;
		ctx.lineWidth = 2.5;
		if (look === "band") {
			ctx.save();
			ctx.beginPath();
			ctx.arc(h.x, h.y, r, 0, TAU);
			ctx.clip();
			ctx.fillStyle = f.band;
			ctx.fillRect(h.x - r, h.y - r * 0.62, r * 2, r * 0.32);
			ctx.restore();
			const tail = { x: h.x - fc * r * 1.05, y: h.y - r * 0.45 };
			const wave = f.preview ? 0 : Math.sin(performance.now() / 120) * 3;
			stroke(tail, { x: tail.x - fc * 13 * s, y: tail.y + 7 * s + wave }, 4 * s, f.band);
		} else if (look === "cap" || look === "beanie") {
			ctx.fillStyle = f.hat;
			ctx.beginPath();
			ctx.arc(h.x, h.y - r * 0.32, r * 1.0, Math.PI, 0);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			if (look === "cap") {
				stroke({ x: h.x + fc * r * 0.3, y: h.y - r * 0.34 }, { x: h.x + fc * r * 1.4, y: h.y - r * 0.28 }, 5 * s + 4, OUT);
				stroke({ x: h.x + fc * r * 0.3, y: h.y - r * 0.34 }, { x: h.x + fc * r * 1.4, y: h.y - r * 0.28 }, 5 * s, f.hat);
			} else {
				ctx.fillStyle = dk;
				ctx.fillRect(h.x - r, h.y - r * 0.5, r * 2, r * 0.22);
				dot({ x: h.x, y: h.y - r * 1.38 }, r * 0.3 + 2, OUT);
				dot({ x: h.x, y: h.y - r * 1.38 }, r * 0.3, f.hat);
			}
		} else if (look === "party") {
			ctx.fillStyle = f.hat;
			ctx.beginPath();
			ctx.moveTo(h.x - r * 0.6, h.y - r * 0.72);
			ctx.lineTo(h.x + r * 0.6, h.y - r * 0.72);
			ctx.lineTo(h.x - fc * r * 0.2, h.y - r * 2.05);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			dot({ x: h.x - fc * r * 0.2, y: h.y - r * 2.05 }, r * 0.22 + 2, OUT);
			dot({ x: h.x - fc * r * 0.2, y: h.y - r * 2.05 }, r * 0.22, "#ffffff");
		} else if (look === "tophat") {
			ctx.fillStyle = f.hat;
			ctx.fillRect(h.x - r * 0.62, h.y - r * 1.95, r * 1.24, r * 1.2);
			ctx.strokeRect(h.x - r * 0.62, h.y - r * 1.95, r * 1.24, r * 1.2);
			ctx.fillStyle = "#ff4d6d";
			ctx.fillRect(h.x - r * 0.62, h.y - r * 0.98, r * 1.24, r * 0.2);
			stroke({ x: h.x - r * 1.0, y: h.y - r * 0.72 }, { x: h.x + r * 1.0, y: h.y - r * 0.72 }, 5 * s + 4, OUT);
			stroke({ x: h.x - r * 1.0, y: h.y - r * 0.72 }, { x: h.x + r * 1.0, y: h.y - r * 0.72 }, 5 * s, f.hat);
		} else if (look === "crown") {
			ctx.fillStyle = "#ffd23f";
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
		} else if (look === "spikes") {
			ctx.fillStyle = dk;
			for (let i = -1; i <= 1; i++) {
				ctx.beginPath();
				ctx.moveTo(h.x + i * r * 0.5 - r * 0.25, h.y - r * 0.8);
				ctx.lineTo(h.x + i * r * 0.5 - fc * r * 0.2, h.y - r * 1.45);
				ctx.lineTo(h.x + i * r * 0.5 + r * 0.25, h.y - r * 0.8);
				ctx.fill();
			}
		}
	}

	function drawHead(f, col, dk) {
		const s = f.s;
		const fc = f.facing;
		const h = f.head.position;
		const r = 17 * s;
		dot(h, r + 2.5, OUT);
		dot(h, r, col);
		drawHat(f, h, r, dk);

		// Face looks toward where the fighter is aiming
		const look = norm(f.aim.x - h.x, f.aim.y - h.y);
		const eyes = [{ x: h.x + fc * r * 0.12, y: h.y - r * 0.12 }, { x: h.x + fc * r * 0.58, y: h.y - r * 0.12 }];
		const d = 3.6 * s;
		if (f.ko) {
			for (const e of eyes) {
				stroke({ x: e.x - d, y: e.y - d }, { x: e.x + d, y: e.y + d }, 2.6 * s, OUT);
				stroke({ x: e.x + d, y: e.y - d }, { x: e.x - d, y: e.y + d }, 2.6 * s, OUT);
			}
		} else if (f.hurt > 0 || f.stun > 0) {
			for (const [i, e] of eyes.entries()) {
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
		let label = f.ko ? `${f.name} · K.O.` : f.name;
		if (f.weapon && !f.ko) label += ` · ${f.weapon.t.name}`;
		ctx.fillText(label, alignRight ? x + w : x, y - 5);
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
		for (const w of weapons) if (!w.holder) drawWeaponAt(w.type, gripOf(w), w.body.angle);
		ctx.lineCap = "round";
		for (const f of fighters) {
			for (let i = 1; i < f.trail.length; i++) {
				const a = f.trail[i - 1];
				const b = f.trail[i];
				ctx.globalAlpha = (b.life / 10) * 0.5;
				for (const o of [-18, 0, 18]) stroke({ x: a.x, y: a.y + o * f.s }, { x: b.x, y: b.y + o * f.s }, 3, "#e8ecff");
			}
			if (f.swingTrail.length > 1) {
				ctx.fillStyle = "#ffffff";
				for (let i = 1; i < f.swingTrail.length; i++) {
					const a = f.swingTrail[i - 1];
					const b = f.swingTrail[i];
					ctx.globalAlpha = (b.life / 9) * 0.45;
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.lineTo((b.x + b.gx) / 2, (b.y + b.gy) / 2);
					ctx.lineTo((a.x + a.gx) / 2, (a.y + a.gy) / 2);
					ctx.closePath();
					ctx.fill();
				}
			}
		}
		ctx.globalAlpha = 1;
		for (const f of fighters) if (f.ko) drawFighter(f);
		for (const f of fighters) if (!f.ko && !humans.includes(f)) drawFighter(f);
		for (const f of humans) if (!f.ko) drawFighter(f);
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

		// Screen-space HUD
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (state !== "menu" && humans.length) {
			const w = Math.min(280, W * 0.32);
			bar(18, 34, w, humans[0], false);
			const right = mode === "duo" ? [humans[1]] : enemies;
			right.forEach((e, i) => bar(W - 18 - w, 34 + i * 40, w, e, true));
			if (mode === "solo") {
				outlinedText(`LEVEL ${level}`, W / 2, 30, 22, "#ffffff");
				outlinedText(`${save.coins} coins`, W / 2, 56, 15, "#ffd23f");
			} else {
				outlinedText(`ROUND ${round}`, W / 2, 30, 22, "#ffffff");
				outlinedText(`${score[0]} - ${score[1]}`, W / 2, 58, 20, "#ffd23f");
			}
		}
		if (hintT > 0 && state === "fight") {
			ctx.globalAlpha = clamp(hintT / 40, 0, 1);
			const text = mode === "duo" ? "P1: A D lunge/walk · W jump · S kick · Space grab      P2: ← → lunge/walk · ↑ jump · ↓ kick · Enter grab" : "A D: tap to lunge at an enemy, hold to walk   ·   W: jump   ·   S: kick   ·   Space: grab an enemy or weapon, again to throw";
			outlinedText(text, W / 2, H - 28, Math.min(18, W / 48), "#ffffff");
			ctx.globalAlpha = 1;
		}
		if (banner) {
			const t = banner.life / banner.max;
			ctx.globalAlpha = clamp(Math.min(t * 4, (1 - t) * 8), 0, 1);
			const size = Math.min(84, W / 10);
			outlinedText(banner.title, W / 2, H * 0.3, size, "#ffd23f");
			outlinedText(banner.sub, W / 2, H * 0.3 + size * 0.85, size * 0.38, "#ffffff");
			ctx.globalAlpha = 1;
		}
		for (const p of popups) {
			if (!p.screen) continue;
			ctx.globalAlpha = clamp(p.life / 20, 0, 1);
			outlinedText(p.text, W / 2, 96, p.size, p.color);
		}
		ctx.globalAlpha = 1;
	}

	/* ---------- Shop ---------- */
	// A standing fighter in a skin, for the shop's pictures (same drawing as in the game)
	function posed(skin) {
		const P = (x, y, angle) => ({ position: { x, y }, angle });
		const dir = (a) => ({ x: -Math.sin(a), y: Math.cos(a) });
		const pair = (jx, jy, a1, h1, a2, h2) => {
			const d1 = dir(a1);
			const c1 = { x: jx + d1.x * h1, y: jy + d1.y * h1 };
			const k = { x: c1.x + d1.x * h1, y: c1.y + d1.y * h1 };
			const d2 = dir(a2);
			return [P(c1.x, c1.y, a1), P(k.x + d2.x * h2, k.y + d2.y * h2, a2)];
		};
		const arm = (a, b) => { const [u, l] = pair(0, -24, a, 11, b, 11); return { u, l }; };
		const leg = (a, b) => { const [u, l] = pair(0, 25, a, 13, b, 14); return { u, l }; };
		const t1 = angleFor(0.14, 1);
		const t2 = angleFor(-0.12, 1);
		return {
			preview: true, s: 1, facing: 1, flash: 0, ko: false, hurt: 0, stun: 0, weapon: null,
			color: skin.color, dark: skin.dark, look: skin.look, band: skin.band, hat: skin.hat,
			torso: P(0, 0, 0), head: P(0, -46, 0), aim: { x: 200, y: -46 },
			arms: [arm(angleFor(0.55, 0.8), angleFor(0.5, -0.9)), arm(angleFor(0.3, 0.8), angleFor(0.62, -0.9))],
			legs: [leg(t1, t1 + 0.12), leg(t2, t2 + 0.12)],
		};
	}

	function paintPreview(cv, draw) {
		const r = Math.min(window.devicePixelRatio || 1, 2);
		cv.width = 96 * r;
		cv.height = 96 * r;
		const saved = ctx;
		ctx = cv.getContext("2d");
		ctx.setTransform(r, 0, 0, r, 0, 0);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		draw();
		ctx = saved;
	}

	function shopItem(kind, id, name, price) {
		const owned = kind === "skin" ? save.skins.includes(id) : id === null || save.weapons.includes(id);
		const on = kind === "skin" ? save.skin === id : save.weapon === id;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "item" + (on ? " on" : "");
		const cv = document.createElement("canvas");
		const nameEl = document.createElement("span");
		nameEl.className = "item-name";
		nameEl.textContent = name;
		const tagEl = document.createElement("span");
		tagEl.className = "item-tag" + (owned ? "" : " price");
		tagEl.textContent = on ? "Using" : owned ? "Owned · tap to use" : `${price} coins`;
		btn.append(cv, nameEl, tagEl);
		paintPreview(cv, () => {
			if (kind === "skin") {
				ctx.translate(48, 52);
				ctx.scale(0.5, 0.5);
				drawFighter(posed(skinById(id)));
			} else if (id) {
				const t = WEAPONS[id];
				const sc = 80 / t.len;
				const a = 0.75;
				ctx.translate(48, 48);
				ctx.scale(sc, sc);
				const ax = { x: Math.sin(a), y: -Math.cos(a) };
				const mid = t.len / 2 - t.grip;
				drawWeaponAt(id, { x: -ax.x * mid, y: -ax.y * mid }, a);
			} else {
				dot({ x: 48, y: 50 }, 22, OUT);
				dot({ x: 48, y: 50 }, 19, "#2de0c0");
				stroke({ x: 36, y: 44 }, { x: 58, y: 44 }, 3, OUT);
				stroke({ x: 38, y: 54 }, { x: 56, y: 54 }, 3, OUT);
			}
		});
		btn.addEventListener("click", () => {
			if (!owned) {
				if (save.coins < price) {
					tagEl.textContent = `Need ${price - save.coins} more`;
					tagEl.className = "item-tag short";
					btn.classList.remove("nope");
					void btn.offsetWidth;
					btn.classList.add("nope");
					return;
				}
				save.coins -= price;
				if (kind === "skin") save.skins.push(id);
				else save.weapons.push(id);
				sfx.coin();
			}
			if (kind === "skin") save.skin = id;
			else save.weapon = id;
			persist();
			renderShop();
		});
		return btn;
	}

	function renderShop() {
		$("shop-coins").textContent = `${save.coins} coins`;
		$("shop-weapons").replaceChildren(shopItem("weapon", null, "Fists", 0), ...WEAPON_IDS.map((id) => shopItem("weapon", id, WEAPONS[id].name, WEAPONS[id].price)));
		$("shop-skins").replaceChildren(...SKINS.map((k) => shopItem("skin", k.id, k.name, k.price)));
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

	toMenu();
	resize();
	requestAnimationFrame(frame);

	// For ROKI's automatic play test: a peek at the game, and a way to start any level
	window.__wobbleBrawl = {
		startAt: (n) => startLevel(Math.max(1, Math.floor(n) || 1)),
		peek: () => ({
			state, mode, level, round, score: [...score], coins: save.coins, skin: save.skin, weapon: save.weapon, view,
			fighters: fighters.map((f) => ({
				name: f.name, team: f.team, hp: f.hp, ko: f.ko, x: f.torso.position.x, y: f.torso.position.y, angle: f.torso.angle,
				headX: f.head.position.x, headY: f.head.position.y, grounded: f.grounded, weapon: f.weapon ? f.weapon.type : null, holding: f.held ? f.held.foe.name : null, heldBy: f.heldBy ? f.heldBy.name : null, vx: vel(f.torso).x,
			})),
			weapons: weapons.map((w) => ({ type: w.type, held: !!w.holder, x: w.body.position.x, y: w.body.position.y })),
		}),
	};
})();
