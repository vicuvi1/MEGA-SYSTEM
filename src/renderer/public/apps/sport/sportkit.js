var SportKit = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// src/core/sportFigure.ts
	var FLOOR = 84;
	var BONES = {
		torso: 25,
		upperArm: 13.5,
		foreArm: 13,
		thigh: 18.5,
		shin: 18,
		neck: 3,
		head: 6,
		foot: 5.5
	};
	var add$1 = (p, q) => [p[0] + q[0], p[1] + q[1]];
	var sub$1 = (p, q) => [p[0] - q[0], p[1] - q[1]];
	var mul$1 = (p, k) => [p[0] * k, p[1] * k];
	var len$1 = (p) => Math.hypot(p[0], p[1]);
	var unit$1 = (p) => {
		const l = len$1(p);
		return l > 1e-9 ? [p[0] / l, p[1] / l] : [0, -1];
	};
	var rot = (p, deg) => {
		const r = deg * Math.PI / 180;
		const c = Math.cos(r);
		const s = Math.sin(r);
		return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
	};
	var lerp = (a, b, k) => a + (b - a) * k;
	var lerpPt = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
	var dist = (a, b) => len$1(sub$1(a, b));
	/**
	* Two bones from `root` towards `target`: returns the middle joint and the end.
	* Too far: the limb points straight at it. `bend` picks the side the joint goes.
	*/
	function ik(root, target, l1, l2, bend, mid) {
		if (mid) {
			const j = add$1(root, mul$1(unit$1(sub$1(mid, root)), l1));
			return [j, add$1(j, mul$1(unit$1(sub$1(target, j)), l2))];
		}
		const d0 = dist(root, target);
		const d = Math.max(Math.abs(l1 - l2) + .01, Math.min(l1 + l2 - .01, d0));
		const u = unit$1(sub$1(target, root));
		const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
		const j = add$1(root, mul$1(rot(u, bend * (Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI)), l1));
		return [j, add$1(j, mul$1(unit$1(sub$1(add$1(root, mul$1(u, d)), j)), l2))];
	}
	function flatten(p) {
		const B = BONES;
		let h = p.h;
		if (!h) {
			const to = (p.kn && p.kn[0] && p.kn[1] ? lerpPt(p.kn[0], p.kn[1], .5) : null) ?? lerpPt(p.f[0], p.f[1], .5);
			h = add$1(p.s, mul$1(unit$1(sub$1(to, p.s)), B.torso));
		}
		const s = add$1(h, mul$1(unit$1(sub$1(p.s, h)), B.torso));
		const hands = p.a ? [p.a[0], p.a[1]] : p.ar ? [add$1(s, p.ar[0]), add$1(s, p.ar[1])] : [add$1(s, [2, 24]), add$1(s, [-1, 24])];
		return {
			h,
			s,
			hands,
			feet: [p.f[0], p.f[1]],
			kn: p.kn ? [p.kn[0], p.kn[1]] : [null, null],
			eb: p.eb ?? [1, 1],
			kb: p.kb ?? [-1, -1],
			ft: p.ft ?? [12, 12],
			bow: p.bow ?? 0,
			w: p.w ?? 0,
			hw: p.hw ?? 0,
			hd: p.hd ?? 0
		};
	}
	/** Where an arm (or leg) starts: the shoulders (hips), apart by w (hw) in a front view. */
	function roots(f) {
		const dir = unit$1(sub$1(f.s, f.h));
		const s = add$1(f.h, mul$1(dir, BONES.torso));
		const perp = rot(dir, 90);
		return {
			arm: [add$1(s, mul$1(perp, -f.w)), add$1(s, mul$1(perp, f.w))],
			leg: [add$1(f.h, mul$1(perp, -f.hw)), add$1(f.h, mul$1(perp, f.hw))]
		};
	}
	/**
	* A hand or foot between two poses. One that stays put (planted on the floor)
	* moves in a straight line; one that swings goes round its shoulder or hip,
	* so the arm doesn't fold up half-way.
	*/
	function limbTarget(ta, tb, ra, rb, r, k) {
		if (dist(ta, tb) < 4) return lerpPt(ta, tb, k);
		const va = sub$1(ta, ra);
		const vb = sub$1(tb, rb);
		const aa = Math.atan2(va[1], va[0]);
		let d = Math.atan2(vb[1], vb[0]) - aa;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		const ang = aa + d * k;
		const l = lerp(len$1(va), len$1(vb), k);
		const t = add$1(r, [Math.cos(ang) * l, Math.sin(ang) * l]);
		return [t[0], Math.min(t[1], Math.max(ta[1], tb[1]))];
	}
	function mix(a, b, k) {
		const both = (i) => a.kn[i] && b.kn[i] ? lerpPt(a.kn[i], b.kn[i], k) : k < .5 ? a.kn[i] : b.kn[i];
		const base = {
			h: lerpPt(a.h, b.h, k),
			s: lerpPt(a.s, b.s, k),
			w: lerp(a.w, b.w, k),
			hw: lerp(a.hw, b.hw, k)
		};
		const ra = roots(a);
		const rb = roots(b);
		const r = roots(base);
		return {
			...base,
			hands: [limbTarget(a.hands[0], b.hands[0], ra.arm[0], rb.arm[0], r.arm[0], k), limbTarget(a.hands[1], b.hands[1], ra.arm[1], rb.arm[1], r.arm[1], k)],
			feet: [limbTarget(a.feet[0], b.feet[0], ra.leg[0], rb.leg[0], r.leg[0], k), limbTarget(a.feet[1], b.feet[1], ra.leg[1], rb.leg[1], r.leg[1], k)],
			kn: [both(0), both(1)],
			eb: a.eb,
			kb: a.kb,
			ft: [lerp(a.ft[0], b.ft[0], k), lerp(a.ft[1], b.ft[1], k)],
			bow: lerp(a.bow, b.bow, k),
			hd: lerp(a.hd, b.hd, k)
		};
	}
	/** The points to draw for one worked-out pose. */
	function draw(f) {
		const B = BONES;
		const dir = unit$1(sub$1(f.s, f.h));
		const s = add$1(f.h, mul$1(dir, B.torso));
		const r = roots(f);
		const mid = add$1(lerpPt(f.h, s, .5), mul$1(rot(dir, -90), f.bow));
		const head = add$1(s, mul$1(unit$1(rot(f.bow ? sub$1(s, mid) : dir, f.hd)), B.neck + B.head));
		const arm = (i) => {
			const root = r.arm[i];
			const [el, hand] = ik(root, f.hands[i], B.upperArm, B.foreArm, f.eb[i]);
			return [
				root,
				el,
				hand
			];
		};
		const leg = (i) => {
			const root = r.leg[i];
			const [kn, ankle] = ik(root, f.feet[i], B.thigh, B.shin, f.kb[i], f.kn[i]);
			const t = add$1(ankle, mul$1(rot([1, 0], f.ft[i]), B.foot));
			return [
				root,
				kn,
				ankle,
				[t[0], Math.min(t[1], 84.5)]
			];
		};
		const legs = [leg(0), leg(1)];
		const lowest = Math.max(...legs.flatMap((l) => [l[2][1], l[3][1]]));
		const air = Math.max(0, 83 - lowest);
		return {
			torso: [
				f.h,
				mid,
				s
			],
			head,
			arms: [arm(0), arm(1)],
			legs,
			shadow: {
				x: (f.h[0] + s[0]) / 2,
				rx: Math.max(10, 26 - air * .8),
				o: Math.max(.25, 1 - air / 14)
			}
		};
	}
	var ease = (k) => .5 - Math.cos(Math.PI * k) / 2;
	/** One loop of the demo, in seconds. */
	function loopLength(anim) {
		return anim.keys.reduce((t, k) => t + k.t + (k.hold ?? 0), 0);
	}
	/** The figure `time` seconds into the demo (it loops). */
	function frameAt(anim, time) {
		const keys = anim.keys;
		const flat = keys.map((k) => flatten(k.p));
		if (keys.length === 1) return draw(flat[0]);
		const total = loopLength(anim);
		let t = (time % total + total) % total;
		const order = [...keys.keys()].slice(1).concat(0);
		t -= keys[0].hold ?? 0;
		if (t < 0) return draw(flat[0]);
		let from = 0;
		for (const i of order) {
			const k = keys[i];
			if (t < k.t) return draw(mix(flat[from], flat[i], ease(t / k.t)));
			t -= k.t;
			if (i !== 0) {
				if (t < (k.hold ?? 0)) return draw(flat[i]);
				t -= k.hold ?? 0;
			}
			from = i;
		}
		return draw(flat[0]);
	}
	/**
	* The box the whole demo fits in (every frame, its props, a little room),
	* as [x, y, width, height] for an SVG viewBox, at least `aspect` wide per
	* unit of height, at least `minH` tall (big stages use more so figures
	* don't look chunky) and never cutting off the floor. Lets small cards show the
	* figure as big as it can be.
	*/
	function boxOf(anim, aspect = 1.25, minH = 64, pad = 7) {
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -Infinity;
		let y1 = 86;
		const see = (p, r = 3) => {
			x0 = Math.min(x0, p[0] - r);
			x1 = Math.max(x1, p[0] + r);
			y0 = Math.min(y0, p[1] - r);
			y1 = Math.max(y1, p[1] + r);
		};
		const total = loopLength(anim);
		for (let i = 0; i < 48; i++) {
			const f = frameAt(anim, total * i / 48);
			see(f.head, BONES.head + 1);
			for (const l of [
				...f.arms,
				...f.legs,
				f.torso
			]) for (const p of l) see(p);
		}
		for (const p of anim.props ?? []) if (p.k === "box" || p.k === "table") {
			see([p.x, p.y], 2);
			see([p.x + p.w, 84], 2);
		} else see([p.x, y0], 2);
		x0 -= pad;
		x1 += pad;
		y0 -= pad;
		y1 += 3;
		if (y1 - y0 < minH) y0 = y1 - minH;
		let w = x1 - x0;
		let h = y1 - y0;
		if (w / h < aspect) {
			const nw = h * aspect;
			x0 -= (nw - w) / 2;
			w = nw;
		} else {
			const nh = w / aspect;
			y0 -= nh - h;
			h = nh;
		}
		const r = (n) => Math.round(n * 10) / 10;
		return [
			r(x0),
			r(y0),
			r(w),
			r(h)
		];
	}
	/** The still picture (a card that isn't playing). */
	function stillFrame(anim) {
		return draw(flatten(anim.keys[anim.still ?? 0].p));
	}
	// src/core/sportDraw.ts
	var f1 = (n) => (Math.round(n * 10) / 10).toString();
	var P = (p) => `${f1(p[0])} ${f1(p[1])}`;
	var sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
	var add = (a, b) => [a[0] + b[0], a[1] + b[1]];
	var mul = (a, k) => [a[0] * k, a[1] * k];
	var len = (a) => Math.hypot(a[0], a[1]);
	var unit = (a) => {
		const l = len(a);
		return l > 1e-6 ? [a[0] / l, a[1] / l] : [0, -1];
	};
	var perp = (a) => [-a[1], a[0]];
	/** A tapered capsule from p (radius r1) to q (radius r2), as one closed path. */
	function capsule(p, q, r1, r2) {
		const n = perp(unit(sub(q, p)));
		const a1 = add(p, mul(n, r1));
		const a2 = add(q, mul(n, r2));
		const b2 = add(q, mul(n, -r2));
		const b1 = add(p, mul(n, -r1));
		return `M${P(a1)}L${P(a2)}A${f1(r2)} ${f1(r2)} 0 0 0 ${P(b2)}L${P(b1)}A${f1(r1)} ${f1(r1)} 0 0 0 ${P(a1)}Z`;
	}
	var circle = (c, r) => `M${f1(c[0] - r)} ${f1(c[1])}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
	/** Limb thickness (radius) at each joint: shoulder, elbow, wrist / hip, knee, ankle. */
	var THICK = {
		shoulder: 3.3,
		elbow: 2.4,
		wrist: 1.8,
		hip: 4.2,
		knee: 3,
		ankle: 2.1
	};
	/** One arm: upper arm, forearm, a round hand. */
	function arm(pts) {
		const [s, e, h] = pts;
		const hand = add(h, mul(unit(sub(h, e)), 1.2));
		return capsule(s, e, THICK.shoulder, THICK.elbow) + capsule(e, h, THICK.elbow, THICK.wrist) + circle(hand, 2.1);
	}
	/** One leg: thigh, shin and a foot from the ankle to the toes (a heel behind). */
	function leg(pts) {
		const [hp, k, a, toe] = pts;
		const fd = unit(sub(toe, a));
		const heel = add(a, mul(fd, -1.6));
		const tip = add(toe, mul(fd, .6));
		return capsule(hp, k, THICK.hip, THICK.knee) + capsule(k, a, THICK.knee, THICK.ankle) + capsule(heel, tip, 1.9, 1.3);
	}
	/**
	* The torso: from the hips to the chest along the back's curve (hip, bend,
	* shoulders), wider at the chest than the waist, plus the neck.
	*/
	function torso(fr) {
		const [h, c, s] = fr.torso;
		const steps = 8;
		const L = [];
		const R = [];
		const half = (t) => t < .45 ? 4.3 - .9 * (t / .45) : 3.4 + 1.5 * Math.sin((t - .45) / .55 * Math.PI * .55);
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const p = [(1 - t) * (1 - t) * h[0] + 2 * (1 - t) * t * c[0] + t * t * s[0], (1 - t) * (1 - t) * h[1] + 2 * (1 - t) * t * c[1] + t * t * s[1]];
			const n = perp(unit([2 * (1 - t) * (c[0] - h[0]) + 2 * t * (s[0] - c[0]), 2 * (1 - t) * (c[1] - h[1]) + 2 * t * (s[1] - c[1])]));
			L.push(add(p, mul(n, half(t))));
			R.push(add(p, mul(n, -half(t))));
		}
		const cap = add(s, mul(unit(sub(s, c)), 2.2));
		return `M${P(L[0])}${L.slice(1).map((p) => `L${P(p)}`).join("")}Q${P(cap)} ${P(R[R.length - 1])}${R.slice(0, -1).reverse().map((p) => `L${P(p)}`).join("")}A4.3 4.3 0 0 1 ${P(L[0])}Z` + capsule(s, add(s, mul(unit(sub(fr.head, s)), 4.2)), 1.7, 1.5);
	}
	/** Everything to fill for one frame. */
	function figureShapes(fr) {
		const head = fr.head;
		return {
			armFar: arm(fr.arms[1]),
			legFar: leg(fr.legs[1]),
			torso: torso(fr),
			head: circle(head, 5.6),
			legNear: leg(fr.legs[0]),
			armNear: arm(fr.arms[0]),
			joints: circle(fr.legs[0][1], .9) + circle(fr.arms[0][1], .75)
		};
	}
	// src/core/sportMoves.ts
	var GROUPS = [
		{
			id: "push",
			name: "Push",
			blurb: "Chest, shoulders and arms"
		},
		{
			id: "pull",
			name: "Pull & back",
			blurb: "Back and grip, no bar needed"
		},
		{
			id: "core",
			name: "Core",
			blurb: "Abs and the middle of the body"
		},
		{
			id: "legs",
			name: "Legs",
			blurb: "Thighs, glutes and calves"
		},
		{
			id: "cardio",
			name: "Cardio",
			blurb: "Get the heart going"
		},
		{
			id: "mobility",
			name: "Mobility",
			blurb: "Stretch and cool down"
		}
	];
	/** Each family's ladder, easiest first. */
	var FAMILIES = {
		pushup: {
			name: "Push-ups",
			steps: [
				"incline_pushup",
				"knee_pushup",
				"pushup",
				"wide_pushup",
				"diamond_pushup",
				"decline_pushup",
				"archer_pushup",
				"planche_pushup"
			]
		},
		pike: {
			name: "Shoulder push",
			steps: ["pike_pushup", "elevated_pike"]
		},
		dips: {
			name: "Dips",
			steps: ["chair_dip"]
		},
		row: {
			name: "Rows",
			steps: [
				"door_row",
				"table_row_bent",
				"table_row"
			]
		},
		back: {
			name: "Back",
			steps: ["superman", "swimmer"]
		},
		core: {
			name: "Abs",
			steps: [
				"crunch",
				"situp",
				"leg_raise",
				"hollow_hold",
				"v_up",
				"dragon_flag"
			]
		},
		deadbug: {
			name: "Dead bug",
			steps: ["dead_bug"]
		},
		plank: {
			name: "Plank",
			steps: [
				"plank",
				"side_plank",
				"shoulder_taps",
				"plank_updown"
			]
		},
		squat: {
			name: "Squats",
			steps: [
				"squat",
				"jump_squat",
				"split_squat",
				"bulgarian_squat",
				"shrimp_squat",
				"pistol_squat"
			]
		},
		lunge: {
			name: "Lunges",
			steps: [
				"reverse_lunge",
				"lunge",
				"jump_lunge"
			]
		},
		bridge: {
			name: "Glute bridge",
			steps: ["glute_bridge", "single_leg_bridge"]
		},
		wallsit: {
			name: "Wall sit",
			steps: ["wall_sit"]
		},
		calf: {
			name: "Calves",
			steps: ["calf_raise", "single_calf_raise"]
		},
		jacks: {
			name: "Jumps",
			steps: ["jumping_jack", "star_jump"]
		},
		knees: {
			name: "High knees",
			steps: ["high_knees"]
		},
		climber: {
			name: "Mountain climbers",
			steps: ["mountain_climber", "cross_climber"]
		},
		burpee: {
			name: "Burpees",
			steps: [
				"half_burpee",
				"burpee",
				"pushup_burpee"
			]
		},
		catcow: {
			name: "Cat-cow",
			steps: ["cat_cow"]
		},
		dog: {
			name: "Downward dog",
			steps: ["down_dog"]
		},
		wgs: {
			name: "Lunge stretch",
			steps: ["worlds_greatest"]
		},
		circles: {
			name: "Arm circles",
			steps: ["arm_circles"]
		},
		child: {
			name: "Child's pose",
			steps: ["childs_pose"]
		},
		cobra: {
			name: "Cobra",
			steps: ["cobra"]
		},
		hinge: {
			name: "Good morning",
			steps: ["good_morning"]
		}
	};
	var D2R = Math.PI / 180;
	/** A point `r` away from `p` at `deg` degrees. */
	var at = (p, r, deg) => [+(p[0] + r * Math.cos(deg * D2R)).toFixed(2), +(p[1] + r * Math.sin(deg * D2R)).toFixed(2)];
	/** Shoulders of a straight body from the ankles (planks, push-ups): 25 torso + 36.5 leg. */
	var body = (ankle, deg, r = 61.5) => at(ankle, r, deg);
	var ST_ANKLES = [[62, 81.5], [57.5, 81.5]];
	/** Standing, facing right, arms down. */
	var stand = (o = {}) => ({
		h: [60, 46.5],
		s: [60.5, 21.5],
		a: [[63, 46], [59.5, 46.5]],
		f: ST_ANKLES,
		...o
	});
	/** Up by `dy` (calf raises, jumps). */
	var up = (p, dy) => {
		const m = (q) => [q[0], q[1] - dy];
		return {
			...p,
			h: p.h && m(p.h),
			s: m(p.s),
			a: p.a && [m(p.a[0]), m(p.a[1])],
			f: [m(p.f[0]), m(p.f[1])],
			kn: p.kn && [p.kn[0] && m(p.kn[0]), p.kn[1] && m(p.kn[1])]
		};
	};
	var PL_ANKLE = [24, 79.5];
	/** A straight-arm plank (push-up position): shoulders at `deg` from the ankles. */
	var plank = (deg, o = {}) => ({
		s: body(PL_ANKLE, deg),
		line: true,
		a: [[83, 82.5], [81, 82.5]],
		f: [PL_ANKLE, [25, 79.5]],
		ft: [68, 68],
		...o
	});
	/** Lying on the back, head to the right, knees bent and feet flat. */
	var backKnees = (o = {}) => ({
		h: [52, 79.5],
		s: [77, 79.5],
		f: [[33, 81.5], [34.5, 81.5]],
		kb: [1, 1],
		ft: [0, 0],
		a: [[58, 82.5], [56, 82.5]],
		...o
	});
	/** Crouched with hands on the floor (the start of a burpee). */
	var crouch = (o = {}) => ({
		h: [54, 66],
		s: at([54, 66], 25, -22),
		a: [[80, 82.5], [78, 82.5]],
		f: [[59, 80.5], [56, 80.5]],
		ft: [40, 40],
		...o
	});
	var jumpUp = (o = {}) => ({
		h: [60, 38],
		s: [60.5, 13],
		a: [[66, -3], [62, -2]],
		f: [[62, 74.5], [57, 73.5]],
		ft: [62, 62],
		eb: [-1, -1],
		...o
	});
	/** Seconds per pose change, and how long to stay. */
	var k = (p, t, hold = 0) => ({
		p,
		t,
		hold
	});
	var PU_TOP = -21;
	var PU_LOW = -8;
	var pushAnim = (o) => ({
		hands: o.hands ?? "normal",
		keys: [k(plank(o.top ?? PU_TOP, o.a ? { a: o.a } : {}), .9, .35), k(plank(o.low ?? PU_LOW, o.lowA ? { a: o.lowA } : o.a ? { a: o.a } : {}), 1, .12)]
	});
	var MOVES = [
		{
			id: "incline_pushup",
			name: "Incline push-ups",
			group: "push",
			family: "pushup",
			diff: 1,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Chest",
				"Triceps",
				"Shoulders"
			],
			steps: [
				"Put your hands on a sturdy chair, sofa or table, a little wider than your shoulders.",
				"Walk your feet back until your body is one straight line.",
				"Lower your chest to the edge, then push back up."
			],
			mistake: "Letting the hips sag: squeeze your glutes and keep the line straight.",
			alias: [
				"incline push up",
				"incline pushups",
				"wall pushups"
			],
			anim: {
				props: [{
					k: "box",
					x: 76,
					y: 60,
					w: 26
				}],
				keys: [k({
					s: body([40, 80.5], -44),
					line: true,
					a: [[89, 58.5], [87, 58.5]],
					f: [[40, 80.5], [41, 80.5]],
					ft: [55, 55]
				}, .9, .3), k({
					s: body([40, 80.5], -32.5),
					line: true,
					a: [[89, 58.5], [87, 58.5]],
					f: [[40, 80.5], [41, 80.5]],
					ft: [55, 55]
				}, 1, .1)]
			}
		},
		{
			id: "knee_pushup",
			name: "Knee push-ups",
			group: "push",
			family: "pushup",
			diff: 1,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Chest",
				"Triceps",
				"Shoulders"
			],
			steps: [
				"Start on your hands and knees, hands under your shoulders.",
				"Walk the hands forward so your body is straight from the knees to the head.",
				"Bend the elbows to bring your chest close to the floor, then push up."
			],
			mistake: "Bending at the hips: knees, hips and shoulders stay in one line.",
			alias: [
				"knee push up",
				"knee pushups",
				"kneeling pushups"
			],
			anim: { keys: [k({
				s: at([46, 82], 43.5, -32),
				line: true,
				kn: [[46, 82], [47, 82]],
				a: [[84, 82.5], [82, 82.5]],
				f: [[30, 71], [31, 70]],
				ft: [160, 160]
			}, .9, .3), k({
				s: at([46, 82], 43.5, -12),
				line: true,
				kn: [[46, 82], [47, 82]],
				a: [[84, 82.5], [82, 82.5]],
				f: [[30, 71], [31, 70]],
				ft: [160, 160]
			}, 1, .1)] }
		},
		{
			id: "pushup",
			name: "Push-ups",
			group: "push",
			family: "pushup",
			diff: 2,
			unit: "reps",
			start: 50,
			set: 12,
			muscles: [
				"Chest",
				"Triceps",
				"Shoulders",
				"Core"
			],
			steps: [
				"Hands on the floor under your shoulders, legs straight, on your toes.",
				"Lower your whole body as one until the chest is a fist above the floor.",
				"Push the floor away until your arms are straight."
			],
			mistake: "Elbows flaring straight out to the sides: keep them about 45° from your body.",
			alias: [
				"push ups",
				"pushups",
				"push-up",
				"press ups",
				"press-ups"
			],
			anim: pushAnim({})
		},
		{
			id: "wide_pushup",
			name: "Wide push-ups",
			group: "push",
			family: "pushup",
			diff: 2,
			unit: "reps",
			start: 40,
			set: 10,
			muscles: [
				"Chest",
				"Shoulders",
				"Triceps"
			],
			steps: [
				"Set your hands about one and a half shoulder widths apart.",
				"Lower slowly, elbows pointing out and back.",
				"Press up to straight arms; keep your body in one line."
			],
			mistake: "Going too wide: if your shoulders hurt, bring the hands in a little.",
			alias: ["wide grip pushups"],
			anim: pushAnim({
				hands: "wide",
				a: [[85, 82.5], [83, 82.5]]
			})
		},
		{
			id: "diamond_pushup",
			name: "Diamond push-ups",
			group: "push",
			family: "pushup",
			diff: 3,
			unit: "reps",
			start: 30,
			set: 8,
			muscles: [
				"Triceps",
				"Chest",
				"Shoulders"
			],
			steps: [
				"Put your hands together under your chest, thumbs and index fingers making a diamond.",
				"Lower your chest to your hands, elbows close to your sides.",
				"Push back up to straight arms."
			],
			mistake: "Hips piking up to make it easier: keep the line straight from heels to head.",
			alias: [
				"diamond pushups",
				"triangle pushups",
				"close grip pushups"
			],
			anim: pushAnim({
				hands: "diamond",
				a: [[79, 82.5], [78, 82.5]],
				low: -9
			})
		},
		{
			id: "decline_pushup",
			name: "Decline push-ups",
			group: "push",
			family: "pushup",
			diff: 3,
			unit: "reps",
			start: 30,
			set: 8,
			muscles: [
				"Upper chest",
				"Shoulders",
				"Triceps"
			],
			steps: [
				"Put your feet on a chair or the sofa, hands on the floor.",
				"Keep your body straight and lower your chest towards the floor.",
				"Push up until your arms are straight."
			],
			mistake: "Letting the lower back sag: brace your abs like someone will poke them.",
			alias: ["decline pushups", "feet elevated pushups"],
			anim: {
				props: [{
					k: "box",
					x: 8,
					y: 60,
					w: 30
				}],
				keys: [k({
					s: body([28, 57.5], 1.5),
					line: true,
					a: [[88, 82.5], [86, 82.5]],
					f: [[28, 57.5], [29, 57.5]],
					ft: [70, 70]
				}, .9, .3), k({
					s: body([28, 57.5], 13),
					line: true,
					a: [[88, 82.5], [86, 82.5]],
					f: [[28, 57.5], [29, 57.5]],
					ft: [70, 70]
				}, 1, .1)]
			}
		},
		{
			id: "archer_pushup",
			name: "Archer push-ups",
			group: "push",
			family: "pushup",
			diff: 4,
			unit: "reps",
			start: 16,
			set: 6,
			muscles: [
				"Chest",
				"Triceps",
				"Shoulders"
			],
			steps: [
				"Hands very wide, fingers turned out.",
				"Lower towards one hand while the other arm stays straight.",
				"Push back to the middle and do the other side."
			],
			mistake: "Rushing it: go slow, the straight arm only helps a little.",
			alias: ["archer pushups"],
			anim: pushAnim({
				hands: "archer",
				a: [[82, 82.5], [104, 82.5]],
				low: -7,
				lowA: [[82, 82.5], [104, 82.5]]
			})
		},
		{
			id: "planche_pushup",
			name: "Pseudo-planche push-ups",
			group: "push",
			family: "pushup",
			diff: 5,
			unit: "reps",
			start: 12,
			set: 5,
			muscles: [
				"Shoulders",
				"Chest",
				"Biceps",
				"Core"
			],
			steps: [
				"Hands by your waist, fingers turned out to the sides.",
				"Lean forward so your shoulders are well past your hands.",
				"Lower and push up while keeping that lean."
			],
			mistake: "Losing the lean on the way up: the shoulders stay in front of the hands.",
			alias: [
				"pseudo planche pushups",
				"planche pushups",
				"pseudo planche"
			],
			anim: pushAnim({
				hands: "narrow",
				a: [[70, 82.5], [68.5, 82.5]],
				top: -19,
				low: -7
			})
		},
		{
			id: "pike_pushup",
			name: "Pike push-ups",
			group: "push",
			family: "pike",
			diff: 3,
			unit: "reps",
			start: 24,
			set: 8,
			muscles: [
				"Shoulders",
				"Triceps",
				"Upper back"
			],
			steps: [
				"Start in a push-up and walk your feet in so your hips go up: an upside-down V.",
				"Bend the elbows to bring the top of your head towards the floor between your hands.",
				"Push back up to straight arms."
			],
			mistake: "Moving the head straight down: it goes a little forward of your hands, like a triangle.",
			alias: ["pike pushups", "pike push up"],
			anim: { keys: [k({
				h: [61, 43],
				s: at([61, 43], 25, 42),
				a: [[86, 82.5], [84, 82.5]],
				f: [[46, 80.5], [47, 80.5]],
				ft: [30, 30]
			}, .9, .3), k({
				h: [62, 47],
				s: at([62, 47], 25, 78),
				a: [[86, 82.5], [84, 82.5]],
				f: [[46, 80.5], [47, 80.5]],
				ft: [30, 30]
			}, 1, .1)] }
		},
		{
			id: "elevated_pike",
			name: "Feet-up pike push-ups",
			group: "push",
			family: "pike",
			diff: 4,
			unit: "reps",
			start: 16,
			set: 6,
			muscles: [
				"Shoulders",
				"Triceps",
				"Upper back"
			],
			steps: [
				"Put your feet on a chair and walk your hands back until your hips are over your shoulders.",
				"Lower your head towards the floor between your hands.",
				"Press back up, like a handstand push-up made easier."
			],
			mistake: "A rounded back: push the floor away and keep your hips high.",
			alias: ["elevated pike pushups", "feet elevated pike"],
			anim: {
				props: [{
					k: "box",
					x: 18,
					y: 58,
					w: 28
				}],
				keys: [k({
					h: [58, 37],
					s: at([58, 37], 25, 70),
					a: [[70, 82.5], [68.5, 82.5]],
					f: [[38, 55.5], [39, 55.5]],
					ft: [80, 80]
				}, .9, .3), k({
					h: [60, 43],
					s: at([60, 43], 25, 92),
					a: [[70, 82.5], [68.5, 82.5]],
					f: [[38, 55.5], [39, 55.5]],
					ft: [80, 80]
				}, 1, .1)]
			}
		},
		{
			id: "chair_dip",
			name: "Chair dips",
			group: "push",
			family: "dips",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Triceps",
				"Shoulders",
				"Chest"
			],
			steps: [
				"Sit on the edge of a sturdy chair, hands next to your hips, and slide off it.",
				"Bend your elbows straight back to lower your hips towards the floor.",
				"Push up until your arms are straight."
			],
			mistake: "Shrugging the shoulders up to the ears: keep them down and back.",
			alias: [
				"dips",
				"bench dips",
				"tricep dips",
				"triceps dips"
			],
			anim: {
				props: [{
					k: "box",
					x: 20,
					y: 58,
					w: 28
				}],
				keys: [k({
					h: [52, 55],
					s: [50, 30.5],
					a: [[47, 56.5], [45.5, 56.5]],
					f: [[74, 81.5], [72, 81.5]]
				}, .9, .3), k({
					h: [53, 68],
					s: [51, 43.5],
					a: [[47, 56.5], [45.5, 56.5]],
					f: [[74, 81.5], [72, 81.5]]
				}, 1, .1)]
			}
		},
		{
			id: "door_row",
			name: "Doorway rows",
			group: "pull",
			family: "row",
			diff: 1,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Upper back",
				"Biceps",
				"Rear shoulders"
			],
			steps: [
				"Stand in an open doorway and hold both sides of the frame at chest height.",
				"Walk your feet in and lean back with straight arms, body straight.",
				"Pull your chest to the frame, squeezing your shoulder blades, then lower slowly."
			],
			mistake: "Pulling with the arms only: start each rep by squeezing your shoulder blades together.",
			alias: [
				"door rows",
				"door frame rows",
				"towel rows"
			],
			anim: {
				props: [{
					k: "door",
					x: 92
				}],
				keys: [k({
					s: at([82, 81.5], 61.5, -110),
					line: true,
					a: [[89.5, 27], [88.5, 28]],
					f: [[82, 81.5], [80, 81.5]]
				}, .9, .3), k({
					s: at([82, 81.5], 61.5, -98),
					line: true,
					a: [[89.5, 27], [88.5, 28]],
					f: [[82, 81.5], [80, 81.5]]
				}, .9, .3)]
			}
		},
		{
			id: "table_row_bent",
			name: "Table rows, knees bent",
			group: "pull",
			family: "row",
			diff: 2,
			unit: "reps",
			start: 24,
			set: 8,
			muscles: [
				"Back",
				"Biceps",
				"Rear shoulders"
			],
			steps: [
				"Lie under a sturdy table and hold its edge with both hands.",
				"Bend your knees, feet flat, and lift your hips so your body is straight.",
				"Pull your chest up to the table, then lower with control."
			],
			mistake: "Using a table that can tip: test it first, or use a low bar or the edge of a solid desk.",
			alias: [
				"table rows",
				"inverted rows bent knees",
				"bodyweight rows"
			],
			anim: {
				props: [{
					k: "table",
					x: 66,
					y: 40,
					w: 50
				}],
				keys: [k({
					s: [86, 68],
					line: true,
					kn: [[44, 63], [45, 63.5]],
					a: [[86, 42], [85, 42]],
					f: [[36, 80.5], [37, 80.5]],
					eb: [1, 1],
					ft: [0, 0]
				}, .9, .3), k({
					s: [86, 52.5],
					line: true,
					kn: [[44, 63], [45, 63.5]],
					a: [[86, 42], [85, 42]],
					f: [[36, 80.5], [37, 80.5]],
					eb: [1, 1],
					ft: [0, 0]
				}, .9, .3)]
			}
		},
		{
			id: "table_row",
			name: "Table rows",
			group: "pull",
			family: "row",
			diff: 3,
			unit: "reps",
			start: 20,
			set: 8,
			muscles: [
				"Back",
				"Biceps",
				"Rear shoulders",
				"Core"
			],
			steps: [
				"Lie under a sturdy table and hold its edge.",
				"Straighten your legs, heels on the floor, body like a plank.",
				"Pull your chest to the edge, pause, and lower slowly."
			],
			mistake: "Hips dropping on the way up: keep the body one straight line.",
			alias: [
				"inverted rows",
				"australian pullups",
				"australian pull ups"
			],
			anim: {
				props: [{
					k: "table",
					x: 66,
					y: 40,
					w: 50
				}],
				keys: [k({
					s: body([26, 79], -10.3),
					line: true,
					a: [[86, 42], [85, 42]],
					f: [[26, 79], [27, 79]],
					eb: [1, 1],
					ft: [-62, -62]
				}, .9, .3), k({
					s: body([26, 79], -24),
					line: true,
					a: [[86, 42], [85, 42]],
					f: [[26, 79], [27, 79]],
					eb: [1, 1],
					ft: [-62, -62]
				}, .9, .3)]
			}
		},
		{
			id: "superman",
			name: "Superman",
			group: "pull",
			family: "back",
			diff: 1,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Lower back",
				"Glutes",
				"Upper back"
			],
			steps: [
				"Lie face down, arms stretched out in front of you.",
				"Lift your arms, chest and legs a few centimetres off the floor.",
				"Hold for a breath, then lower slowly."
			],
			mistake: "Cranking the neck up: look at the floor just in front of you.",
			alias: [
				"supermans",
				"superman hold",
				"back extensions"
			],
			anim: { keys: [k({
				h: [56, 79.5],
				s: [81, 79.5],
				a: [[106, 80.5], [105, 80.5]],
				f: [[20, 80.5], [21, 80.5]],
				ft: [175, 175],
				hd: 8
			}, .8, .3), k({
				h: [56, 79.5],
				s: [80.5, 74.5],
				a: [[104, 69], [103, 70]],
				f: [[21, 73], [22, 74]],
				ft: [170, 170],
				hd: -4
			}, .8, .6)] }
		},
		{
			id: "swimmer",
			name: "Swimmers",
			group: "pull",
			family: "back",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 12,
			muscles: [
				"Lower back",
				"Upper back",
				"Glutes",
				"Shoulders"
			],
			steps: [
				"Lie face down and lift your arms, chest and legs a little, like a superman.",
				"Lift the right arm and left leg higher, then switch, like slow swimming.",
				"Keep switching without touching down."
			],
			mistake: "Kicking fast: slow, small and controlled works the back more.",
			alias: ["swimmers", "flutter swimmers"],
			anim: { keys: [k({
				h: [56, 79.5],
				s: [80.5, 75],
				a: [[104, 68], [104.5, 76]],
				f: [[21, 77], [22, 71]],
				ft: [170, 170],
				hd: -4
			}, .55), k({
				h: [56, 79.5],
				s: [80.5, 75],
				a: [[104.5, 76], [104, 68]],
				f: [[21, 71], [22, 77]],
				ft: [170, 170],
				hd: -4
			}, .55)] }
		},
		{
			id: "crunch",
			name: "Crunches",
			group: "core",
			family: "core",
			diff: 1,
			unit: "reps",
			start: 40,
			set: 15,
			muscles: ["Abs"],
			steps: [
				"Lie on your back, knees bent, feet flat, fingertips behind your ears.",
				"Curl your shoulders off the floor, pressing your lower back down.",
				"Lower slowly, without resting on the floor."
			],
			mistake: "Pulling on your head: the hands only touch it, the abs do the work.",
			alias: [
				"crunches",
				"press",
				"abs",
				"ab crunches",
				"pres"
			],
			anim: { keys: [k(backKnees({
				ar: [[7, -5], [6, -4]],
				eb: [1, 1]
			}), .7, .2), k(backKnees({
				s: at([52, 79.5], 25, -27),
				ar: [[7, -5], [6, -4]],
				eb: [1, 1],
				bow: 2
			}), .7, .25)] }
		},
		{
			id: "situp",
			name: "Sit-ups",
			group: "core",
			family: "core",
			diff: 2,
			unit: "reps",
			start: 40,
			set: 15,
			muscles: ["Abs", "Hip flexors"],
			steps: [
				"Lie on your back, knees bent, feet flat or tucked under something.",
				"Cross your arms on your chest and sit all the way up.",
				"Roll back down one part of the spine at a time."
			],
			mistake: "Throwing yourself up with momentum: come up and down at the same steady speed.",
			alias: [
				"sit ups",
				"situps",
				"sit-up"
			],
			anim: { keys: [k(backKnees({ ar: [[3, 6], [1, 5]] }), .9, .15), k(backKnees({
				s: at([52, 79.5], 25, -72),
				ar: [[8, 6], [7, 5]],
				bow: 3
			}), .9, .2)] }
		},
		{
			id: "leg_raise",
			name: "Leg raises",
			group: "core",
			family: "core",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: ["Lower abs", "Hip flexors"],
			steps: [
				"Lie on your back, legs straight, hands flat by your hips.",
				"Keep the legs straight and lift them until they point at the ceiling.",
				"Lower them slowly and stop just above the floor."
			],
			mistake: "The lower back arching off the floor: lower only as far as you can keep it down.",
			alias: [
				"leg raises",
				"lying leg raises",
				"leg lifts"
			],
			anim: { keys: [k({
				h: [58, 79.5],
				s: [83, 79.5],
				a: [[64, 82.5], [62, 82.5]],
				f: [[22, 78.5], [23, 78.5]],
				ft: [-95, -95]
			}, 1, .15), k({
				h: [58, 79.5],
				s: [83, 79.5],
				a: [[64, 82.5], [62, 82.5]],
				f: [at([58, 79.5], 36.3, -97), at([58, 79.5], 36.3, -95)],
				ft: [-185, -185]
			}, 1.1, .25)] }
		},
		{
			id: "hollow_hold",
			name: "Hollow hold",
			group: "core",
			family: "core",
			diff: 3,
			unit: "sec",
			start: 60,
			set: 20,
			muscles: [
				"Abs",
				"Hip flexors",
				"Core"
			],
			steps: [
				"Lie on your back and press your lower back into the floor.",
				"Lift your shoulders, arms and straight legs a little off the floor, like a banana.",
				"Hold it and keep breathing."
			],
			mistake: "The lower back lifting: raise the legs higher or bend the knees until it stays down.",
			alias: [
				"hollow body hold",
				"hollow body",
				"hollow"
			],
			anim: { keys: [k({
				h: [58, 79.5],
				s: [82.5, 74],
				a: [[107, 67], [106, 68]],
				f: [[23, 72], [24, 73]],
				ft: [-150, -150],
				bow: -2
			}, 1.6), k({
				h: [58, 79.5],
				s: [82.5, 75],
				a: [[107, 68.5], [106, 69.5]],
				f: [[23, 73.5], [24, 74.5]],
				ft: [-150, -150],
				bow: -2
			}, 1.6)] }
		},
		{
			id: "v_up",
			name: "V-ups",
			group: "core",
			family: "core",
			diff: 3,
			unit: "reps",
			start: 24,
			set: 8,
			muscles: ["Abs", "Hip flexors"],
			steps: [
				"Lie flat, arms stretched over your head.",
				"Lift your arms and straight legs at the same time and reach for your toes.",
				"Lower both slowly back to the floor."
			],
			mistake: "Bending the knees a lot to cheat: keep the legs as straight as you can.",
			alias: [
				"v ups",
				"vups",
				"v-up",
				"jackknife"
			],
			anim: { keys: [k({
				h: [60, 80],
				s: [85, 79.5],
				a: [[110, 78.5], [109, 79]],
				f: [[24, 79], [25, 79]],
				ft: [-95, -95]
			}, .8, .15), k({
				h: [60, 80],
				s: at([60, 80], 25, -55),
				a: [[47, 51], [48, 52]],
				f: [at([60, 80], 36.3, -124), at([60, 80], 36.3, -123)],
				ft: [-160, -160],
				bow: 3
			}, .75, .2)] }
		},
		{
			id: "dragon_flag",
			name: "Dragon flag (lowering)",
			group: "core",
			family: "core",
			diff: 5,
			unit: "reps",
			start: 10,
			set: 3,
			muscles: [
				"Abs",
				"Core",
				"Lats"
			],
			steps: [
				"Lie on a bench or the floor and hold something solid behind your head.",
				"Swing your body up onto your upper back, straight from shoulders to toes.",
				"Lower the straight body as slowly as you can."
			],
			mistake: "Bending at the hips: if you fold, bend the knees and lower that way first.",
			alias: ["dragon flags", "dragon flag negatives"],
			anim: {
				props: [{
					k: "box",
					x: 44,
					y: 72,
					w: 62
				}],
				keys: [k({
					s: [80, 68],
					line: true,
					a: [[100, 71], [99, 71]],
					f: [at([80, 68], 61.5, -125), at([80, 68], 61.5, -124)],
					eb: [-1, -1],
					ft: [-125, -124]
				}, .9, .3), k({
					s: [80, 68],
					line: true,
					a: [[100, 71], [99, 71]],
					f: [at([80, 68], 61.5, -165), at([80, 68], 61.5, -164)],
					eb: [-1, -1],
					ft: [-165, -164]
				}, 2.4, .2)]
			}
		},
		{
			id: "dead_bug",
			name: "Dead bug",
			group: "core",
			family: "deadbug",
			diff: 1,
			unit: "reps",
			start: 20,
			set: 10,
			muscles: ["Abs", "Core"],
			steps: [
				"Lie on your back, arms pointing at the ceiling, knees bent at 90° above your hips.",
				"Lower one arm behind you and the opposite leg towards the floor.",
				"Come back and switch sides, lower back flat on the floor."
			],
			mistake: "Moving fast: slow reps, and breathe out as you reach.",
			alias: ["dead bugs", "deadbug"],
			anim: { keys: [
				k({
					h: [58, 79.5],
					s: [83, 79.5],
					a: [[84, 54], [83, 55]],
					f: [[40, 61], [41, 61.5]],
					kn: [[58, 61], [59, 61.5]],
					ft: [-90, -90]
				}, .8, .15),
				k({
					h: [58, 79.5],
					s: [83, 79.5],
					a: [[108, 77], [83, 55]],
					f: [[40, 61], [22.5, 75.5]],
					kn: [[58, 61], [40, 77.5]],
					ft: [-90, -110]
				}, .9, .2),
				k({
					h: [58, 79.5],
					s: [83, 79.5],
					a: [[84, 54], [83, 55]],
					f: [[40, 61], [41, 61.5]],
					kn: [[58, 61], [59, 61.5]],
					ft: [-90, -90]
				}, .8, .15),
				k({
					h: [58, 79.5],
					s: [83, 79.5],
					a: [[84, 54], [108, 77]],
					f: [[22.5, 75.5], [41, 61.5]],
					kn: [[40, 77.5], [59, 61.5]],
					ft: [-110, -90]
				}, .9, .2)
			] }
		},
		{
			id: "plank",
			name: "Plank",
			group: "core",
			family: "plank",
			diff: 1,
			unit: "sec",
			start: 90,
			set: 30,
			muscles: [
				"Core",
				"Shoulders",
				"Glutes"
			],
			steps: [
				"Forearms on the floor, elbows under your shoulders.",
				"Lift your body on your toes, straight from heels to head.",
				"Squeeze glutes and abs and hold, breathing slowly."
			],
			mistake: "Hips too high or sagging: imagine a broom stick along your back.",
			alias: [
				"planks",
				"forearm plank",
				"elbow plank"
			],
			anim: { keys: [k({
				s: [80, 69.5],
				line: true,
				a: [[93, 83], [92, 83]],
				f: [[19, 79.5], [20, 79.5]],
				ft: [68, 68]
			}, 1.8), k({
				s: [80, 68.8],
				line: true,
				a: [[93, 83], [92, 83]],
				f: [[19, 79.5], [20, 79.5]],
				ft: [68, 68]
			}, 1.8)] }
		},
		{
			id: "side_plank",
			name: "Side plank",
			group: "core",
			family: "plank",
			diff: 2,
			unit: "sec",
			start: 60,
			set: 20,
			muscles: [
				"Side abs (obliques)",
				"Core",
				"Shoulders"
			],
			steps: [
				"Lie on your side, elbow under your shoulder, feet stacked.",
				"Lift your hips until your body is a straight line.",
				"Hold; reach the top arm up. Then the other side."
			],
			mistake: "Letting the hips drop towards the floor: push them up and keep them there.",
			alias: ["side planks"],
			anim: { keys: [k({
				s: [78, 62],
				line: true,
				a: [[88, 83], [77, 36]],
				f: [[21, 80.5], [22, 79.5]],
				ft: [20, 20]
			}, 1.6), k({
				s: [78, 63.5],
				h: [53.5, 70],
				a: [[88, 83], [77, 37]],
				f: [[21, 80.5], [22, 79.5]],
				ft: [20, 20]
			}, 1.6)] }
		},
		{
			id: "shoulder_taps",
			name: "Plank shoulder taps",
			group: "core",
			family: "plank",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 12,
			muscles: [
				"Core",
				"Shoulders",
				"Chest"
			],
			steps: [
				"Start at the top of a push-up, feet a bit wider than usual.",
				"Lift one hand and tap the opposite shoulder.",
				"Put it back and tap with the other hand; keep the hips still."
			],
			mistake: "Hips rocking side to side: go slower and widen your feet.",
			alias: ["shoulder taps", "plank taps"],
			anim: { keys: [
				plank(PU_TOP, { a: [[83, 82.5], [81, 82.5]] }),
				plank(PU_TOP, {
					a: [[82, 62], [81, 82.5]],
					eb: [1, 1]
				}),
				plank(PU_TOP, { a: [[83, 82.5], [81, 82.5]] }),
				plank(PU_TOP, { a: [[83, 82.5], [82, 62]] })
			].map((p, i) => k(p, .35, i % 2 ? .15 : .05)) }
		},
		{
			id: "plank_updown",
			name: "Plank up-downs",
			group: "core",
			family: "plank",
			diff: 3,
			unit: "reps",
			start: 20,
			set: 8,
			muscles: [
				"Core",
				"Triceps",
				"Shoulders"
			],
			steps: [
				"Start in a forearm plank.",
				"Put one hand down, then the other, and push up into a push-up position.",
				"Lower back to the forearms one arm at a time. Switch the lead arm."
			],
			mistake: "Swinging the hips: keep them level the whole time.",
			alias: [
				"up downs",
				"up-downs",
				"plank walk ups",
				"commandos"
			],
			anim: { keys: [
				k({
					s: [80, 69.5],
					line: true,
					a: [[93, 83], [92, 83]],
					f: [[19, 79.5], [20, 79.5]],
					ft: [68, 68]
				}, .5, .2),
				k({
					s: [78.5, 64],
					line: true,
					a: [[81, 82.5], [92, 83]],
					f: [[19, 79.5], [20, 79.5]],
					ft: [68, 68]
				}, .45, .05),
				k({
					s: body([19, 79.5], -22),
					line: true,
					a: [[81, 82.5], [79.5, 82.5]],
					f: [[19, 79.5], [20, 79.5]],
					ft: [68, 68]
				}, .45, .2),
				k({
					s: [78.5, 64],
					line: true,
					a: [[81, 82.5], [92, 83]],
					f: [[19, 79.5], [20, 79.5]],
					ft: [68, 68]
				}, .45, .05)
			] }
		},
		{
			id: "squat",
			name: "Squats",
			group: "legs",
			family: "squat",
			diff: 1,
			unit: "reps",
			start: 50,
			set: 15,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Hamstrings"
			],
			steps: [
				"Feet shoulder-width apart, toes turned out a little.",
				"Sit back and down like into a chair, arms forward, chest up.",
				"Go until your thighs are level with the floor, then stand up."
			],
			mistake: "Knees falling inwards: push them out over your toes.",
			alias: [
				"squats",
				"air squats",
				"bodyweight squats",
				"sit ups chair"
			],
			anim: { keys: [k(stand(), .9, .3), k({
				h: [46, 62],
				s: at([46, 62], 25, -56),
				a: [[86, 38], [85, 39]],
				f: ST_ANKLES,
				eb: [-1, -1]
			}, 1, .1)] }
		},
		{
			id: "jump_squat",
			name: "Jump squats",
			group: "legs",
			family: "squat",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Calves"
			],
			steps: [
				"Squat down with your arms back.",
				"Jump up as high as you can, arms swinging up.",
				"Land softly on your toes and sink straight into the next squat."
			],
			mistake: "Landing with straight, stiff legs: land quietly with bent knees.",
			alias: ["squat jumps", "jumping squats"],
			anim: { keys: [
				k({
					h: [46, 62],
					s: at([46, 62], 25, -50),
					a: [[44, 60], [43, 60]],
					f: ST_ANKLES
				}, .6, .12),
				k(jumpUp(), .32, .06),
				k(stand({
					a: [[70, 33], [68, 34]],
					eb: [-1, -1]
				}), .3)
			] }
		},
		{
			id: "split_squat",
			name: "Split squats",
			group: "legs",
			family: "squat",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: ["Thighs (quads)", "Glutes"],
			steps: [
				"Take a long step forward and stay there, back heel up.",
				"Lower straight down until the back knee almost touches the floor.",
				"Push up through the front foot. Do all reps, then switch legs."
			],
			mistake: "The front knee shooting past the toes: step a bit longer and go straight down.",
			alias: ["split squat", "static lunges"],
			anim: { keys: [k({
				h: [58, 48],
				s: [59, 23],
				ar: [[6, 21], [4, 21]],
				f: [[77, 81.5], [40, 80.5]],
				ft: [12, 60]
			}, .9, .25), k({
				h: [58, 63],
				s: [59.5, 38],
				ar: [[6, 21], [4, 21]],
				f: [[77, 81.5], [40, 80.5]],
				ft: [12, 60]
			}, 1, .1)] }
		},
		{
			id: "bulgarian_squat",
			name: "Bulgarian split squats",
			group: "legs",
			family: "squat",
			diff: 3,
			unit: "reps",
			start: 24,
			set: 8,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Balance"
			],
			steps: [
				"Stand a big step in front of a chair, the top of your back foot on the seat.",
				"Lower straight down on the front leg.",
				"Push back up through the front heel. Then the other leg."
			],
			mistake: "Standing too close to the chair: you need room for the front shin to stay upright.",
			alias: [
				"bulgarian split squat",
				"bulgarians",
				"rear foot elevated split squat"
			],
			anim: {
				props: [{
					k: "box",
					x: 12,
					y: 66,
					w: 28
				}],
				keys: [k({
					h: [56, 49],
					s: [57.5, 24],
					ar: [[6, 21], [4, 21]],
					f: [[75, 81.5], [33, 63]],
					ft: [12, 175]
				}, .9, .25), k({
					h: [55, 63],
					s: [58, 38.5],
					ar: [[6, 21], [4, 21]],
					f: [[75, 81.5], [33, 63]],
					ft: [12, 175]
				}, 1, .1)]
			}
		},
		{
			id: "shrimp_squat",
			name: "Shrimp squats",
			group: "legs",
			family: "squat",
			diff: 4,
			unit: "reps",
			start: 16,
			set: 5,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Balance"
			],
			steps: [
				"Stand on one leg and bend the other knee so that foot is behind you.",
				"Lower on the standing leg until the back knee touches the floor.",
				"Stand back up without the back foot touching down."
			],
			mistake: "Leaning far forward to cheat: keep the chest up, use a wall for balance at first.",
			alias: ["shrimp squat"],
			anim: { keys: [k({
				h: [60, 47],
				s: [61.5, 22],
				a: [[86, 30], [52, 54]],
				f: [[62, 81.5], [41, 61]],
				kn: [null, [56, 64]],
				ft: [12, 190]
			}, .9, .3), k({
				h: [53, 66],
				s: at([53, 66], 25, -63),
				a: [[88, 45], [46, 70]],
				f: [[62, 81.5], [31, 79.5]],
				kn: [null, [48.5, 81.5]],
				ft: [12, 185]
			}, 1.1, .1)] }
		},
		{
			id: "pistol_squat",
			name: "Pistol squats",
			group: "legs",
			family: "squat",
			diff: 5,
			unit: "reps",
			start: 12,
			set: 4,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Balance",
				"Core"
			],
			steps: [
				"Stand on one leg, the other leg straight out in front, arms forward.",
				"Squat all the way down on the standing leg, the free leg off the floor.",
				"Stand back up. Hold a door frame at first if you need to."
			],
			mistake: "The standing heel lifting: keep the whole foot flat and go down slowly.",
			alias: [
				"pistol squat",
				"pistols",
				"one leg squat",
				"single leg squat"
			],
			anim: { keys: [k({
				h: [60, 46.5],
				s: [61, 21.5],
				a: [[86, 26], [85, 27]],
				f: [[62, 81.5], at([60, 46.5], 36.3, 38)],
				ft: [12, -45],
				eb: [-1, -1]
			}, 1, .3), k({
				h: [51, 69],
				s: at([51, 69], 25, -62),
				a: [[90, 47], [89, 48]],
				f: [[62, 81.5], at([51, 69], 36.3, -3)],
				ft: [12, -80],
				eb: [-1, -1]
			}, 1.2, .1)] }
		},
		{
			id: "reverse_lunge",
			name: "Reverse lunges",
			group: "legs",
			family: "lunge",
			diff: 1,
			unit: "reps",
			start: 30,
			set: 12,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Hamstrings"
			],
			steps: [
				"Stand tall, hands on your hips.",
				"Step one foot back and lower until both knees are bent about 90°.",
				"Push off the back foot to stand up. Switch legs each rep."
			],
			mistake: "Stepping too short: the back step should be long enough that the front knee stays over the ankle.",
			alias: ["reverse lunge", "back lunges"],
			anim: { keys: [
				k(stand({
					ar: [[6, 21], [4, 21]],
					a: void 0
				}), .7, .15),
				k({
					h: [53, 63],
					s: [54.5, 38],
					ar: [[6, 21], [4, 21]],
					f: [[64, 81.5], [33, 80.5]],
					ft: [12, 60]
				}, .8, .1),
				k(stand({
					ar: [[6, 21], [4, 21]],
					a: void 0
				}), .7, .15),
				k({
					h: [53, 63],
					s: [54.5, 38],
					ar: [[6, 21], [4, 21]],
					f: [[33, 80.5], [64, 81.5]],
					ft: [60, 12]
				}, .8, .1)
			] }
		},
		{
			id: "lunge",
			name: "Lunges",
			group: "legs",
			family: "lunge",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 12,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Balance"
			],
			steps: [
				"Stand tall with your hands on your hips.",
				"Take a long step forward and lower the back knee towards the floor.",
				"Push off the front foot back to standing. Switch legs."
			],
			mistake: "Leaning the body forward: keep the chest up and the body straight above the hips.",
			alias: [
				"lunges",
				"forward lunges",
				"walking lunges"
			],
			anim: { keys: [
				k(stand({
					h: [50, 46.5],
					s: [50.5, 21.5],
					ar: [[6, 21], [4, 21]],
					a: void 0,
					f: [[52, 81.5], [47.5, 81.5]]
				}), .7, .15),
				k({
					h: [62, 63],
					s: [63, 38],
					ar: [[6, 21], [4, 21]],
					f: [[80, 81.5], [45, 80.5]],
					ft: [12, 60]
				}, .8, .1),
				k(stand({
					h: [50, 46.5],
					s: [50.5, 21.5],
					ar: [[6, 21], [4, 21]],
					a: void 0,
					f: [[52, 81.5], [47.5, 81.5]]
				}), .7, .15),
				k({
					h: [62, 63],
					s: [63, 38],
					ar: [[6, 21], [4, 21]],
					f: [[45, 80.5], [80, 81.5]],
					ft: [60, 12]
				}, .8, .1)
			] }
		},
		{
			id: "jump_lunge",
			name: "Jump lunges",
			group: "legs",
			family: "lunge",
			diff: 4,
			unit: "reps",
			start: 20,
			set: 8,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Calves"
			],
			steps: [
				"Start in a lunge, one foot forward.",
				"Jump up and switch legs in the air.",
				"Land softly in a lunge with the other foot forward and keep going."
			],
			mistake: "Landing on a straight front leg: land softly with the knee bent.",
			alias: [
				"jumping lunges",
				"lunge jumps",
				"split jumps"
			],
			anim: { keys: [
				k({
					h: [62, 63],
					s: [63.5, 38],
					a: [[56, 55], [76, 44]],
					f: [[80, 81.5], [45, 80.5]],
					ft: [12, 60],
					eb: [1, -1]
				}, .35, .15),
				k({
					h: [62, 45],
					s: [63, 20],
					a: [[70, 32], [56, 38]],
					f: [[68, 73], [55, 72]],
					ft: [50, 50],
					eb: [-1, 1]
				}, .28),
				k({
					h: [62, 63],
					s: [63.5, 38],
					a: [[76, 44], [56, 55]],
					f: [[45, 80.5], [80, 81.5]],
					ft: [60, 12],
					eb: [-1, 1]
				}, .28, .15),
				k({
					h: [62, 45],
					s: [63, 20],
					a: [[56, 38], [70, 32]],
					f: [[55, 72], [68, 73]],
					ft: [50, 50],
					eb: [1, -1]
				}, .28)
			] }
		},
		{
			id: "glute_bridge",
			name: "Glute bridge",
			group: "legs",
			family: "bridge",
			diff: 1,
			unit: "reps",
			start: 30,
			set: 15,
			muscles: [
				"Glutes",
				"Hamstrings",
				"Lower back"
			],
			steps: [
				"Lie on your back, knees bent, feet flat near your hips.",
				"Push through your heels and lift your hips until knees, hips and shoulders line up.",
				"Squeeze your glutes at the top, then lower slowly."
			],
			mistake: "Arching the lower back at the top: the lift comes from the glutes, not the back.",
			alias: [
				"glute bridges",
				"hip bridge",
				"bridges",
				"hip thrusts"
			],
			anim: { keys: [k(backKnees({
				h: [56, 79.5],
				s: [81, 79.5],
				f: [[35, 81.5], [36, 81.5]],
				a: [[62, 82.5], [60, 82.5]]
			}), .8, .2), k(backKnees({
				h: [57, 64],
				s: [80.5, 76],
				f: [[35, 81.5], [36, 81.5]],
				a: [[64, 82.5], [62, 82.5]]
			}), .8, .4)] }
		},
		{
			id: "single_leg_bridge",
			name: "Single-leg glute bridge",
			group: "legs",
			family: "bridge",
			diff: 3,
			unit: "reps",
			start: 24,
			set: 10,
			muscles: [
				"Glutes",
				"Hamstrings",
				"Core"
			],
			steps: [
				"Lie on your back, one foot flat, the other leg straight up in the air.",
				"Push through the heel on the floor to lift your hips.",
				"Lower slowly. Do all reps, then the other leg."
			],
			mistake: "The hips tilting to one side: keep both hip bones level.",
			alias: [
				"single leg glute bridge",
				"one leg bridge",
				"single leg bridge"
			],
			anim: { keys: [k(backKnees({
				h: [56, 79.5],
				s: [81, 79.5],
				f: [[35, 81.5], at([56, 79.5], 36.3, -128)],
				kn: [null, null],
				a: [[62, 82.5], [60, 82.5]],
				ft: [0, -40]
			}), .8, .2), k(backKnees({
				h: [57, 64],
				s: [80.5, 76],
				f: [[35, 81.5], at([57, 64], 36.3, -160)],
				a: [[64, 82.5], [62, 82.5]],
				ft: [0, -70]
			}), .8, .4)] }
		},
		{
			id: "wall_sit",
			name: "Wall sit",
			group: "legs",
			family: "wallsit",
			diff: 2,
			unit: "sec",
			start: 90,
			set: 30,
			muscles: ["Thighs (quads)", "Glutes"],
			steps: [
				"Stand with your back flat against a wall.",
				"Slide down until your knees are bent at 90°, like sitting on an invisible chair.",
				"Hold, back on the wall, and keep breathing."
			],
			mistake: "Feet too close to the wall: your knees should be over your ankles, not past your toes.",
			alias: ["wall sits", "wall squat"],
			anim: {
				props: [{
					k: "wall",
					x: 34
				}],
				keys: [k({
					h: [40.5, 63],
					s: [40.5, 38],
					a: [[56, 60.5], [54, 61]],
					f: [[59.5, 81.5], [58, 81.5]],
					kn: [[59, 63], [57.5, 63.5]]
				}, 1.8), k({
					h: [40.5, 63],
					s: [40.5, 38.8],
					a: [[56, 61], [54, 61.5]],
					f: [[59.5, 81.5], [58, 81.5]],
					kn: [[59, 63], [57.5, 63.5]]
				}, 1.8)]
			}
		},
		{
			id: "calf_raise",
			name: "Calf raises",
			group: "legs",
			family: "calf",
			diff: 1,
			unit: "reps",
			start: 50,
			set: 20,
			muscles: ["Calves"],
			steps: [
				"Stand tall, feet hip-width apart; hold a wall for balance if you like.",
				"Rise onto the balls of your feet as high as you can.",
				"Pause at the top, then lower slowly."
			],
			mistake: "Bouncing fast: the slow lowering is what builds the calves.",
			alias: [
				"calf raises",
				"calves",
				"heel raises",
				"toe raises"
			],
			anim: { keys: [k(stand(), .6, .15), k(up(stand({ ft: [52, 52] }), 4), .6, .35)] }
		},
		{
			id: "single_calf_raise",
			name: "Single-leg calf raises",
			group: "legs",
			family: "calf",
			diff: 2,
			unit: "reps",
			start: 40,
			set: 15,
			muscles: ["Calves", "Balance"],
			steps: [
				"Stand on one foot, the other bent behind you, a hand on a wall.",
				"Rise as high as you can on the standing foot.",
				"Lower slowly. Then the other leg."
			],
			mistake: "Only going halfway: full height at the top, heel all the way down at the bottom.",
			alias: ["single leg calf raises", "one leg calf raises"],
			anim: { keys: [k(stand({
				f: [[61, 81.5], [48, 66]],
				ft: [12, 120]
			}), .6, .15), k(up(stand({
				f: [[61, 81.5], [48, 66]],
				ft: [52, 120]
			}), 4), .6, .35)] }
		},
		{
			id: "jumping_jack",
			name: "Jumping jacks",
			group: "cardio",
			family: "jacks",
			diff: 1,
			unit: "reps",
			start: 60,
			set: 30,
			muscles: [
				"Whole body",
				"Calves",
				"Shoulders"
			],
			steps: [
				"Stand with your feet together, arms by your sides.",
				"Jump your feet out wide while your arms swing up over your head.",
				"Jump back to the start and keep a steady rhythm."
			],
			mistake: "Landing flat-footed: stay light on the balls of your feet.",
			alias: [
				"jumping jacks",
				"star jumps easy",
				"jacks"
			],
			anim: {
				front: true,
				keys: [k({
					h: [60, 46.5],
					s: [60, 21.5],
					w: 6.5,
					hw: 3.5,
					a: [at([53.5, 21.5], 26.4, 95), at([66.5, 21.5], 26.4, 85)],
					f: [[57, 81.5], [63, 81.5]],
					ft: [170, 10]
				}, .3, .05), k({
					h: [60, 43.5],
					s: [60, 18.5],
					w: 6.5,
					hw: 3.5,
					a: [at([53.5, 18.5], 26.4, -114), at([66.5, 18.5], 26.4, -66)],
					f: [[46, 79.5], [74, 79.5]],
					ft: [170, 10]
				}, .3, .05)]
			}
		},
		{
			id: "star_jump",
			name: "Star jumps",
			group: "cardio",
			family: "jacks",
			diff: 3,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Whole body",
				"Thighs",
				"Calves"
			],
			steps: [
				"Squat down a little, hands near your knees.",
				"Explode up and spread your arms and legs wide like a star.",
				"Land softly with bent knees and go straight into the next one."
			],
			mistake: "Landing with locked knees: land softly and absorb it.",
			alias: ["star jumps", "star jump"],
			anim: {
				front: true,
				keys: [
					k({
						h: [60, 59],
						s: [60, 34.5],
						w: 6.5,
						hw: 3.5,
						a: [[53, 58], [67, 58]],
						f: [[53, 81.5], [67, 81.5]],
						ft: [170, 10],
						kb: [1, -1],
						eb: [1, -1]
					}, .4, .12),
					k({
						h: [60, 38],
						s: [60, 13],
						w: 6.5,
						hw: 3.5,
						a: [[39, -3], [81, -3]],
						f: [[40, 70], [80, 70]],
						ft: [160, 20],
						kb: [1, -1],
						eb: [1, -1]
					}, .32, .08),
					k({
						h: [60, 47.5],
						s: [60, 22.5],
						w: 6.5,
						hw: 3.5,
						a: [[52, 46.5], [68, 46.5]],
						f: [[55, 81.5], [65, 81.5]],
						ft: [170, 10],
						kb: [1, -1],
						eb: [1, -1]
					}, .3)
				]
			}
		},
		{
			id: "high_knees",
			name: "High knees",
			group: "cardio",
			family: "knees",
			diff: 2,
			unit: "reps",
			start: 60,
			set: 30,
			muscles: [
				"Hip flexors",
				"Thighs",
				"Calves"
			],
			steps: [
				"Run on the spot, bringing each knee up to hip height.",
				"Pump your arms like a sprinter.",
				"Stay on the balls of your feet and keep it quick."
			],
			mistake: "Leaning back: keep the body tall or slightly forward.",
			alias: [
				"high knee",
				"running in place",
				"run in place"
			],
			anim: { keys: [k({
				h: [60, 45.5],
				s: [61, 20.5],
				a: [[52, 36], [74, 29]],
				f: [[76, 63], [59, 80.5]],
				ft: [40, 55],
				eb: [1, -1]
			}, .25, .03), k({
				h: [60, 45.5],
				s: [61, 20.5],
				a: [[74, 29], [52, 36]],
				f: [[59, 80.5], [76, 63]],
				ft: [55, 40],
				eb: [-1, 1]
			}, .25, .03)] }
		},
		{
			id: "mountain_climber",
			name: "Mountain climbers",
			group: "cardio",
			family: "climber",
			diff: 2,
			unit: "reps",
			start: 60,
			set: 30,
			muscles: [
				"Core",
				"Shoulders",
				"Hip flexors"
			],
			steps: [
				"Start at the top of a push-up.",
				"Drive one knee towards your chest, then switch legs quickly.",
				"Keep your hips low and your hands under your shoulders."
			],
			mistake: "Hips bouncing up high: keep them in line with the shoulders.",
			alias: ["mountain climbers", "climbers"],
			anim: { keys: [k({
				h: [58, 65.5],
				s: body(PL_ANKLE, PU_TOP),
				a: [[83, 82.5], [81, 82.5]],
				f: [[57, 76], [25, 79.5]],
				ft: [55, 68]
			}, .22, .04), k({
				h: [58, 65.5],
				s: body(PL_ANKLE, PU_TOP),
				a: [[83, 82.5], [81, 82.5]],
				f: [[25, 79.5], [57, 76]],
				ft: [68, 55]
			}, .22, .04)] }
		},
		{
			id: "cross_climber",
			name: "Cross-body mountain climbers",
			group: "cardio",
			family: "climber",
			diff: 3,
			unit: "reps",
			start: 40,
			set: 20,
			muscles: [
				"Side abs (obliques)",
				"Core",
				"Shoulders"
			],
			steps: [
				"Start at the top of a push-up.",
				"Drive one knee across your body towards the opposite elbow.",
				"Switch legs quickly, hips low."
			],
			mistake: "Shoulders drifting back behind the hands: keep them stacked over the wrists.",
			alias: [
				"cross body mountain climbers",
				"cross climbers",
				"twisting mountain climbers"
			],
			anim: { keys: [k({
				h: [58, 66],
				s: body(PL_ANKLE, PU_TOP),
				a: [[83, 82.5], [81, 82.5]],
				f: [[63, 74.5], [25, 79.5]],
				ft: [55, 68],
				bow: 1.5
			}, .3, .06), k({
				h: [58, 66],
				s: body(PL_ANKLE, PU_TOP),
				a: [[83, 82.5], [81, 82.5]],
				f: [[25, 79.5], [63, 74.5]],
				ft: [68, 55],
				bow: 1.5
			}, .3, .06)] }
		},
		{
			id: "half_burpee",
			name: "Squat thrusts",
			group: "cardio",
			family: "burpee",
			diff: 2,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Whole body",
				"Core",
				"Thighs"
			],
			steps: [
				"Squat down and put your hands on the floor.",
				"Jump your feet back into a push-up position.",
				"Jump them back in to the squat, and repeat."
			],
			mistake: "Hips sagging when the feet land back: brace like a plank.",
			alias: [
				"squat thrust",
				"half burpees",
				"burpees no jump"
			],
			anim: { keys: [k(crouch(), .4, .12), k({
				s: body([22, 79.5], -21.5),
				line: true,
				a: [[80, 82.5], [78, 82.5]],
				f: [[22, 79.5], [23, 79.5]],
				ft: [68, 68]
			}, .35, .15)] }
		},
		{
			id: "burpee",
			name: "Burpees",
			group: "cardio",
			family: "burpee",
			diff: 3,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Whole body",
				"Chest",
				"Thighs"
			],
			steps: [
				"From standing, squat and put your hands on the floor.",
				"Jump your feet back to a plank, then jump them back in.",
				"Jump up with your arms over your head. Land softly and repeat."
			],
			mistake: "Collapsing in the plank: keep a straight line before jumping in.",
			alias: ["burpees", "burpee"],
			anim: {
				still: 1,
				keys: [
					k(stand({
						a: [[64, 36], [62, 37]],
						eb: [-1, -1]
					}), .3, .05),
					k(crouch(), .38, .05),
					k({
						s: body([22, 79.5], -21.5),
						line: true,
						a: [[80, 82.5], [78, 82.5]],
						f: [[22, 79.5], [23, 79.5]],
						ft: [68, 68]
					}, .32, .12),
					k(crouch(), .32, .05),
					k(jumpUp(), .38, .05)
				]
			}
		},
		{
			id: "pushup_burpee",
			name: "Push-up burpees",
			group: "cardio",
			family: "burpee",
			diff: 4,
			unit: "reps",
			start: 20,
			set: 8,
			muscles: [
				"Whole body",
				"Chest",
				"Triceps",
				"Thighs"
			],
			steps: [
				"Squat, hands down, and jump your feet back to a plank.",
				"Do one full push-up.",
				"Jump the feet in and jump up with your arms high."
			],
			mistake: "Half push-ups when tired: do fewer burpees, but full push-ups.",
			alias: [
				"burpees with pushup",
				"burpee pushups",
				"full burpees"
			],
			anim: {
				still: 2,
				keys: [
					k(stand({
						a: [[64, 36], [62, 37]],
						eb: [-1, -1]
					}), .3, .05),
					k(crouch(), .38, .05),
					k({
						s: body([22, 79.5], -21.5),
						line: true,
						a: [[80, 82.5], [78, 82.5]],
						f: [[22, 79.5], [23, 79.5]],
						ft: [68, 68]
					}, .32, .08),
					k({
						s: body([22, 79.5], -8),
						line: true,
						a: [[80, 82.5], [78, 82.5]],
						f: [[22, 79.5], [23, 79.5]],
						ft: [68, 68]
					}, .45, .05),
					k({
						s: body([22, 79.5], -21.5),
						line: true,
						a: [[80, 82.5], [78, 82.5]],
						f: [[22, 79.5], [23, 79.5]],
						ft: [68, 68]
					}, .42, .05),
					k(crouch(), .32, .05),
					k(jumpUp(), .38, .05)
				]
			}
		},
		{
			id: "cat_cow",
			name: "Cat-cow",
			group: "mobility",
			family: "catcow",
			diff: 1,
			unit: "reps",
			start: 10,
			set: 10,
			muscles: [
				"Spine",
				"Back",
				"Neck"
			],
			steps: [
				"On hands and knees, hands under shoulders, knees under hips.",
				"Breathe in: let the belly drop and look up (cow).",
				"Breathe out: round your back up and tuck the chin (cat)."
			],
			mistake: "Rushing: move slowly with your breath.",
			alias: ["cat cow", "cat camel"],
			anim: { keys: [k({
				h: [56, 64],
				s: [81, 57.5],
				a: [[82, 82.5], [81, 82.5]],
				kn: [[56, 82.5], [57, 82.5]],
				f: [[38, 82], [39, 82]],
				ft: [185, 185],
				bow: 5,
				hd: 35
			}, 1.4, .3), k({
				h: [56, 64],
				s: [81, 57.5],
				a: [[82, 82.5], [81, 82.5]],
				kn: [[56, 82.5], [57, 82.5]],
				f: [[38, 82], [39, 82]],
				ft: [185, 185],
				bow: -5,
				hd: -30
			}, 1.4, .3)] }
		},
		{
			id: "down_dog",
			name: "Downward dog",
			group: "mobility",
			family: "dog",
			diff: 1,
			unit: "sec",
			start: 60,
			set: 30,
			muscles: [
				"Hamstrings",
				"Calves",
				"Shoulders",
				"Back"
			],
			steps: [
				"From hands and knees, lift your hips up and back into an upside-down V.",
				"Push the floor away, long back, heels reaching down.",
				"Pedal your heels slowly and breathe."
			],
			mistake: "A round back to get the heels down: bend the knees a little and keep the back long.",
			alias: [
				"downward dog",
				"down dog",
				"downward facing dog"
			],
			anim: { keys: [k({
				h: [64, 46],
				s: at([64, 46], 25, 52),
				a: [[92, 83], [91, 83]],
				f: [[47.5, 80.5], [48, 79.5]],
				ft: [5, 45]
			}, .9, .3), k({
				h: [64, 46],
				s: at([64, 46], 25, 52),
				a: [[92, 83], [91, 83]],
				f: [[48, 79.5], [47.5, 80.5]],
				ft: [45, 5]
			}, .9, .3)] }
		},
		{
			id: "worlds_greatest",
			name: "Lunge with a twist",
			group: "mobility",
			family: "wgs",
			diff: 2,
			unit: "reps",
			start: 10,
			set: 10,
			muscles: [
				"Hips",
				"Hamstrings",
				"Upper back"
			],
			steps: [
				"Step into a long lunge and put both hands on the floor inside the front foot.",
				"Lift the arm on the front-leg side and twist it up to the ceiling.",
				"Bring it down and switch sides after a few."
			],
			mistake: "Letting the back knee carry you: keep the back leg long and strong.",
			alias: [
				"world's greatest stretch",
				"worlds greatest stretch",
				"lunge twist",
				"spiderman lunge"
			],
			anim: { keys: [k({
				h: [57, 66],
				s: at([57, 66], 25, -22),
				a: [[79, 82.5], [77, 82.5]],
				f: [[80, 81.5], [30, 79.5]],
				ft: [12, 60],
				hd: 20
			}, .9, .3), k({
				h: [57, 66],
				s: at([57, 66], 25, -30),
				a: [[76, 22], [77, 82.5]],
				f: [[80, 81.5], [30, 79.5]],
				ft: [12, 60],
				hd: -70,
				eb: [-1, 1]
			}, 1, .5)] }
		},
		{
			id: "arm_circles",
			name: "Arm circles",
			group: "mobility",
			family: "circles",
			diff: 1,
			unit: "reps",
			start: 20,
			set: 10,
			muscles: ["Shoulders", "Upper back"],
			steps: [
				"Stand tall with your arms straight.",
				"Draw big, slow circles with your arms, forward.",
				"After 10, change direction."
			],
			mistake: "Shrugging: keep the shoulders down away from your ears.",
			alias: ["arm circle", "shoulder circles"],
			anim: { keys: [
				0,
				-45,
				-90,
				-135,
				180,
				135,
				90,
				45
			].map((deg) => k(stand({
				a: [at([60.5, 21.5], 26, deg), at([60.5, 21.5], 26, deg - 12)],
				eb: [-1, -1]
			}), .28)) }
		},
		{
			id: "childs_pose",
			name: "Child's pose",
			group: "mobility",
			family: "child",
			diff: 1,
			unit: "sec",
			start: 60,
			set: 30,
			muscles: [
				"Lower back",
				"Hips",
				"Shoulders"
			],
			steps: [
				"Kneel and sit back on your heels.",
				"Fold forward and stretch your arms out in front on the floor.",
				"Rest your forehead down and breathe into your back."
			],
			mistake: "Holding your breath: slow breaths in and out through the nose.",
			alias: [
				"childs pose",
				"child pose",
				"rest pose"
			],
			anim: { keys: [k({
				h: [40, 70],
				s: at([40, 70], 25, 14),
				a: [[90, 82.5], [89, 82.5]],
				kn: [[57, 82.5], [58, 82.5]],
				f: [[38.5, 82.5], [39.5, 82.5]],
				ft: [180, 180],
				bow: 3,
				hd: 8
			}, 2), k({
				h: [40.5, 69],
				s: at([40.5, 69], 25, 12),
				a: [[90, 82.5], [89, 82.5]],
				kn: [[57, 82.5], [58, 82.5]],
				f: [[38.5, 82.5], [39.5, 82.5]],
				ft: [180, 180],
				bow: 4.5,
				hd: 8
			}, 2)] }
		},
		{
			id: "cobra",
			name: "Cobra stretch",
			group: "mobility",
			family: "cobra",
			diff: 1,
			unit: "reps",
			start: 10,
			set: 10,
			muscles: [
				"Abs",
				"Lower back",
				"Chest"
			],
			steps: [
				"Lie face down, hands under your shoulders.",
				"Press up slowly, lifting your chest, hips staying on the floor.",
				"Hold a breath at the top and lower down."
			],
			mistake: "Pushing too high and pinching the lower back: only go as far as feels good.",
			alias: [
				"cobra",
				"seal stretch",
				"upward dog"
			],
			anim: { keys: [k({
				h: [54, 80],
				s: [79, 79.5],
				a: [[80, 82.5], [79, 82.5]],
				f: [[18, 80.5], [19, 80.5]],
				ft: [178, 178],
				hd: 10
			}, 1.1, .3), k({
				h: [54, 80],
				s: at([54, 80], 25, -52),
				a: [[74, 82.5], [73, 82.5]],
				f: [[18, 80.5], [19, 80.5]],
				ft: [178, 178],
				bow: -3,
				hd: -25
			}, 1.1, .7)] }
		},
		{
			id: "good_morning",
			name: "Good mornings",
			group: "mobility",
			family: "hinge",
			diff: 1,
			unit: "reps",
			start: 20,
			set: 10,
			muscles: [
				"Hamstrings",
				"Glutes",
				"Lower back"
			],
			steps: [
				"Stand with feet hip-width, hands crossed on your chest.",
				"With soft knees and a flat back, push your hips back and lean forward.",
				"Stop when you feel the back of your legs, then stand tall."
			],
			mistake: "Rounding the back: the movement is at the hips, the back stays flat.",
			alias: [
				"good morning",
				"hip hinge",
				"hinges"
			],
			anim: { keys: [k(stand({
				ar: [[4, 6], [2, 6]],
				a: void 0
			}), 1, .2), k({
				h: [52, 49],
				s: at([52, 49], 25, -8),
				ar: [[4, 6], [2, 6]],
				f: ST_ANKLES
			}, 1.1, .3)] }
		}
	];
	var BY_ID = new Map(MOVES.map((m) => [m.id, m]));
	var moveById = (id) => id ? BY_ID.get(id) ?? null : null;
	/** "Push-ups", "pushups", "PRESS" → the library move it is, or null. */
	function matchMove(name) {
		const norm = (s) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
		const n = norm(String(name ?? ""));
		if (!n) return null;
		const squash = (s) => norm(s).replace(/ /g, "");
		const sq = n.replace(/ /g, "");
		for (const m of MOVES) {
			if (squash(m.name) === sq || squash(m.id) === sq) return m;
			if ((m.alias ?? []).some((a) => squash(a) === sq)) return m;
		}
		let best = null;
		let bestLen = 0;
		const words = ` ${n} `;
		for (const m of MOVES) for (const a of [m.name, ...m.alias ?? []]) {
			const s = norm(a);
			if (s.length >= 6 && words.includes(` ${s} `) && s.length > bestLen) {
				best = m;
				bestLen = s.length;
			}
		}
		return best;
	}
	// src/core/sportLadders.ts
	/** The library move an exercise is: the one it was added as, else by its name. */
	var moveOf = (ex) => moveById(ex.move) ?? matchMove(ex.name);
	/** Where a move sits on its ladder: level 3 of 8. */
	function levelOf(move) {
		const f = FAMILIES[move.family];
		return {
			level: (f ? f.steps.indexOf(move.id) : -1) + 1,
			of: f ? f.steps.length : 1,
			family: move.family,
			familyName: f?.name ?? move.name
		};
	}
	function nextStep(move) {
		const f = FAMILIES[move.family];
		const i = f ? f.steps.indexOf(move.id) : -1;
		return i >= 0 && i < f.steps.length - 1 ? moveById(f.steps[i + 1]) : null;
	}
	function prevStep(move) {
		const f = FAMILIES[move.family];
		const i = f ? f.steps.indexOf(move.id) : -1;
		return i > 0 ? moveById(f.steps[i - 1]) : null;
	}
	var roundTo = (n, step) => Math.max(step, Math.round(n / step) * step);
	/**
	* A fair daily target for the harder move: fewer reps the bigger the jump
	* (about 60% per difficulty point), never below one set or above its usual start.
	*/
	function startTarget(from, to, currentTarget) {
		if (!from || from.unit !== to.unit || !(currentTarget > 0)) return to.start;
		const gap = Math.max(1, to.diff - from.diff);
		const scaled = currentTarget * Math.pow(.6, gap);
		const step = to.unit === "sec" ? 10 : scaled >= 20 ? 5 : 1;
		return Math.min(Math.max(to.start, to.set), Math.max(to.set, roundTo(scaled, step)));
	}
	/**
	* Sessions in a row (newest first) where this exercise reached its target.
	* Days without that exercise are skipped; a session under 95% ends the run.
	*/
	function targetRun(days, exId, target, today) {
		let run = 0;
		for (const d of Object.keys(days).filter((d) => d <= today).sort().reverse()) {
			const v = Number(days[d]?.[exId]) || 0;
			if (v <= 0) continue;
			if (v >= target * .95) run++;
			else break;
		}
		return run;
	}
	/**
	* The harder moves you're ready for: an active exercise at its target `need`
	* sessions in a row, whose next step isn't in your routine yet and isn't on
	* "not yet" (`notYet[moveId]` = the day it may come back).
	*/
	function suggestHarder(input) {
		const need = input.need ?? 3;
		const inRoutine = new Set(input.exercises.filter((e) => e.active !== false).map((e) => moveOf(e)?.id).filter(Boolean));
		const out = [];
		for (const ex of input.exercises) {
			if (ex.active === false) continue;
			const from = moveOf(ex);
			const to = from && nextStep(from);
			if (!from || !to || inRoutine.has(to.id)) continue;
			const back = input.notYet?.[to.id];
			if (back && back > input.today) continue;
			const run = targetRun(input.days, ex.id, ex.target, input.today);
			if (run < need) continue;
			out.push({
				exId: ex.id,
				from,
				to,
				run,
				trySet: to.set,
				swapTarget: startTarget(from, to, ex.target)
			});
		}
		return out.sort((a, b) => b.run - a.run || a.to.diff - b.to.diff);
	}
	/** Library moves you have logged at least once (by the exercises they are). */
	function loggedMoves(days, exercises) {
		const byEx = new Map(exercises.map((e) => [e.id, moveOf(e)?.id]));
		const out = /* @__PURE__ */ new Set();
		for (const m of Object.values(days)) for (const [id, v] of Object.entries(m ?? {})) if (Number(v) > 0 && byEx.get(id)) out.add(byEx.get(id));
		return out;
	}
	/**
	* One family's ladder for you: the steps you've done (logged, or below
	* one you've logged), the one(s) in your routine, the next one, and later ones.
	*/
	function ladderOf(family, logged, current) {
		const steps = (FAMILIES[family]?.steps ?? []).map((id) => moveById(id)).filter(Boolean);
		const top = Math.max(-1, ...steps.map((m, i) => logged.has(m.id) || current.has(m.id) ? i : -1));
		return steps.map((move, i) => ({
			move,
			state: current.has(move.id) ? "current" : i <= top ? "done" : i === top + 1 ? "next" : "later"
		}));
	}
	// src/core/sportBadges.ts
	var shift$1 = (day, n) => {
		const d = /* @__PURE__ */ new Date(day + "T12:00:00Z");
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	};
	var weekday = (day) => ((/* @__PURE__ */ new Date(day + "T12:00:00Z")).getUTCDay() + 6) % 7;
	var monday = (day) => shift$1(day, -weekday(day));
	/** Days with any logged work, oldest first (the day log and your sessions). */
	function activeDays(input) {
		const s = /* @__PURE__ */ new Set();
		for (const [d, m] of Object.entries(input.days)) if (d <= input.today && Object.values(m ?? {}).some((v) => Number(v) > 0)) s.add(d);
		for (const x of input.sessions) if (x.day && x.day <= input.today) s.add(x.day);
		return [...s].sort();
	}
	/**
	* Your best run of training days: rest days you planned keep a run going but
	* don't add to it. Returns the length and the day it first reached `n`, for each n asked.
	*/
	function bestRun(active, rest, goals) {
		new Set(active);
		const off = new Set(rest);
		const reached = Object.fromEntries(goals.map((g) => [g, null]));
		let best = 0;
		let run = 0;
		let prev = null;
		for (const d of active) {
			let gapOk = false;
			if (prev) {
				let c = shift$1(d, -1);
				while (c > prev && off.has(c)) c = shift$1(c, -1);
				gapOk = c === prev;
			}
			run = gapOk ? run + 1 : 1;
			prev = d;
			best = Math.max(best, run);
			for (const g of goals) if (run >= g && !reached[g]) reached[g] = d;
		}
		return {
			best,
			reached
		};
	}
	/** Every badge, unlocked or not, with how far along you are. */
	function computeBadges(input) {
		const out = [];
		const add = (b) => out.push({
			...b,
			cur: Math.min(b.cur, b.goal),
			done: b.done ?? b.cur >= b.goal
		});
		const days = Object.keys(input.days).filter((d) => d <= input.today).sort();
		const active = activeDays(input);
		const exById = new Map(input.exercises.map((e) => [e.id, e]));
		const moveIdOf = (exId) => {
			const e = exById.get(exId);
			return e ? moveOf(e)?.id ?? null : null;
		};
		add({
			id: "first",
			name: "First workout",
			desc: "Log your first workout.",
			icon: "spark",
			tier: "bronze",
			cur: active.length ? 1 : 0,
			goal: 1,
			day: active[0] ?? null
		});
		const run = bestRun(active, input.restDays ?? [], [
			3,
			7,
			30
		]);
		add({
			id: "streak3",
			name: "3 days in a row",
			desc: "Train three days in a row (planned rest days keep it going).",
			icon: "flame",
			tier: "bronze",
			cur: run.best,
			goal: 3,
			day: run.reached[3]
		});
		add({
			id: "streak7",
			name: "A full week",
			desc: "Train seven days in a row.",
			icon: "flame",
			tier: "silver",
			cur: run.best,
			goal: 7,
			day: run.reached[7]
		});
		add({
			id: "streak30",
			name: "30-day streak",
			desc: "Thirty training days in a row.",
			icon: "flame",
			tier: "gold",
			cur: run.best,
			goal: 30,
			day: run.reached[30]
		});
		add({
			id: "sessions10",
			name: "10 workouts",
			desc: "Train on ten different days.",
			icon: "calendar",
			tier: "bronze",
			cur: active.length,
			goal: 10,
			day: active[9] ?? null
		});
		add({
			id: "sessions50",
			name: "50 workouts",
			desc: "Train on fifty different days.",
			icon: "calendar",
			tier: "silver",
			cur: active.length,
			goal: 50,
			day: active[49] ?? null
		});
		const totals = /* @__PURE__ */ new Map();
		const firstOver = /* @__PURE__ */ new Map();
		for (const d of days) for (const [id, v] of Object.entries(input.days[d] ?? {})) {
			const ex = exById.get(id);
			if (!ex || String(ex.unit ?? "reps") !== "reps" || !(Number(v) > 0)) continue;
			const t = (totals.get(id) ?? 0) + Number(v);
			totals.set(id, t);
			const f = firstOver.get(id) ?? {};
			for (const g of [
				100,
				1e3,
				1e4
			]) if (t >= g && !f[g]) f[g] = d;
			firstOver.set(id, f);
		}
		const topEx = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
		for (const [g, name, tier] of [
			[
				100,
				"100 club",
				"bronze"
			],
			[
				1e3,
				"1,000 club",
				"silver"
			],
			[
				1e4,
				"10k legend",
				"gold"
			]
		]) {
			const hit = [...firstOver.entries()].filter(([, f]) => f[g]).sort((a, b) => a[1][g].localeCompare(b[1][g]))[0];
			add({
				id: `reps${g}`,
				name,
				desc: `${g.toLocaleString("en")} reps of one exercise, all time.`,
				icon: "bolt",
				tier,
				cur: topEx?.[1] ?? 0,
				goal: g,
				day: hit ? hit[1][g] : null,
				what: (hit ? exById.get(hit[0]) : topEx ? exById.get(topEx[0]) : void 0)?.name
			});
		}
		const firstDay = /* @__PURE__ */ new Map();
		for (const d of days) for (const [id, v] of Object.entries(input.days[d] ?? {})) {
			const m = Number(v) > 0 ? moveIdOf(id) : null;
			if (m && !firstDay.has(m)) firstDay.set(m, d);
		}
		let levelDay = null;
		for (const [id, d] of firstDay) {
			const steps = FAMILY_STEPS(moveById(id).family);
			const i = steps.indexOf(id);
			if (steps.slice(0, i).some((low) => firstDay.has(low) && firstDay.get(low) < d) && (!levelDay || d < levelDay)) levelDay = d;
		}
		add({
			id: "levelup",
			name: "Level up",
			desc: "Do a harder version of a move you were already doing.",
			icon: "up",
			tier: "silver",
			cur: levelDay ? 1 : 0,
			goal: 1,
			day: levelDay
		});
		const hardDay = [...firstDay.entries()].filter(([id]) => moveById(id).diff >= 4).map(([, d]) => d).sort()[0] ?? null;
		add({
			id: "hardmode",
			name: "Hard mode",
			desc: "Log a move of difficulty 4 or 5.",
			icon: "mountain",
			tier: "gold",
			cur: hardDay ? 1 : 0,
			goal: 1,
			day: hardDay
		});
		const explored = [...firstDay.values()].sort();
		add({
			id: "explorer",
			name: "Explorer",
			desc: "Try 5 different moves from the library.",
			icon: "compass",
			tier: "bronze",
			cur: firstDay.size,
			goal: 5,
			day: explored[4] ?? null
		});
		const fullByWeek = /* @__PURE__ */ new Map();
		for (const s of input.sessions) if (s.full && s.day <= input.today) {
			const w = monday(s.day);
			fullByWeek.set(w, (fullByWeek.get(w) ?? /* @__PURE__ */ new Set()).add(s.day));
		}
		let perfect = 0;
		let perfectDay = null;
		for (const set of fullByWeek.values()) {
			perfect = Math.max(perfect, set.size);
			if (set.size >= 5) {
				const d = [...set].sort()[4];
				if (!perfectDay || d < perfectDay) perfectDay = d;
			}
		}
		add({
			id: "perfectweek",
			name: "Perfect week",
			desc: "Finish every exercise on 5 days in one week.",
			icon: "star",
			tier: "gold",
			cur: perfect,
			goal: 5,
			day: perfectDay
		});
		const groupsByWeek = /* @__PURE__ */ new Map();
		for (const d of days) for (const [id, v] of Object.entries(input.days[d] ?? {})) {
			const m = Number(v) > 0 ? moveById(moveIdOf(id)) : null;
			if (!m) continue;
			const w = monday(d);
			const g = groupsByWeek.get(w) ?? /* @__PURE__ */ new Map();
			if (!g.has(m.group)) g.set(m.group, d);
			groupsByWeek.set(w, g);
		}
		const need = [
			"push",
			"pull",
			"core",
			"legs"
		];
		let rounder = 0;
		let rounderDay = null;
		for (const g of groupsByWeek.values()) {
			const have = need.filter((x) => g.has(x));
			rounder = Math.max(rounder, have.length);
			if (have.length === 4) {
				const d = need.map((x) => g.get(x)).sort()[3];
				if (!rounderDay || d < rounderDay) rounderDay = d;
			}
		}
		add({
			id: "allrounder",
			name: "All-rounder",
			desc: `Train ${need.map((x) => GROUPS.find((g) => g.id === x).name.split(" ")[0].toLowerCase()).join(", ").replace(/, (\w+)$/, " and $1")} in one week.`,
			icon: "grid",
			tier: "silver",
			cur: rounder,
			goal: 4,
			day: rounderDay
		});
		let weekendDay = null;
		for (const d of active) if (weekday(d) === 6 && active.includes(shift$1(d, -1))) {
			weekendDay = d;
			break;
		}
		add({
			id: "weekend",
			name: "Weekend warrior",
			desc: "Train on both Saturday and Sunday of one weekend.",
			icon: "sun",
			tier: "bronze",
			cur: weekendDay ? 1 : 0,
			goal: 1,
			day: weekendDay
		});
		let comeback = null;
		for (let i = 1; i < active.length; i++) if (active[i] >= shift$1(active[i - 1], 8)) {
			comeback = active[i];
			break;
		}
		add({
			id: "comeback",
			name: "Comeback",
			desc: "Get back to training after a week or more off.",
			icon: "return",
			tier: "special",
			cur: comeback ? 1 : 0,
			goal: 1,
			day: comeback
		});
		const early = input.sessions.filter((s) => s.hour != null && s.hour >= 4 && s.hour < 8).map((s) => s.day).sort()[0] ?? null;
		add({
			id: "earlybird",
			name: "Early bird",
			desc: "Finish a workout before 08:00.",
			icon: "sunrise",
			tier: "special",
			cur: early ? 1 : 0,
			goal: 1,
			day: early
		});
		const late = input.sessions.filter((s) => s.hour != null && (s.hour >= 21 || s.hour < 4)).map((s) => s.day).sort()[0] ?? null;
		add({
			id: "nightowl",
			name: "Night owl",
			desc: "Finish a workout after 21:00.",
			icon: "moon",
			tier: "special",
			cur: late ? 1 : 0,
			goal: 1,
			day: late
		});
		let holdBest = 0;
		let holdDay = null;
		for (const d of days) {
			let sec = 0;
			for (const [id, v] of Object.entries(input.days[d] ?? {})) {
				const m = moveById(moveIdOf(id));
				const ex = exById.get(id);
				if (m && m.group === "core" && (ex?.unit === "sec" || m.unit === "sec")) sec += Number(v) || 0;
			}
			holdBest = Math.max(holdBest, sec);
			if (sec >= 120 && !holdDay) holdDay = d;
		}
		add({
			id: "ironcore",
			name: "Iron core",
			desc: "2 minutes of plank or hollow holds in one day.",
			icon: "shield",
			tier: "silver",
			cur: holdBest,
			goal: 120,
			day: holdDay
		});
		add({
			id: "record",
			name: "New record",
			desc: "Beat your best in one set (workout mode notices it).",
			icon: "trophy",
			tier: "silver",
			cur: input.records ?? 0,
			goal: 1,
			day: null
		});
		return out;
	}
	var FAMILY_STEPS = (family) => FAMILIES[family]?.steps ?? [];
	/** Badges earned that you haven't seen yet (`seen`: id → the day it was shown). */
	function newBadges(badges, seen) {
		return badges.filter((b) => b.done && !(seen && seen[b.id]));
	}
	// src/core/sportPhotos.ts
	var PHOTOS = {
		incline_pushup: {
			src: "Incline_Push-Up",
			crop: [
				.2,
				.2,
				.66
			]
		},
		pushup: {
			src: "Pushups",
			crop: [
				.17,
				.08,
				.8
			]
		},
		wide_pushup: {
			src: "Push-Up_Wide",
			crop: [
				0,
				.3,
				1
			]
		},
		diamond_pushup: {
			src: "Push-Ups_-_Close_Triceps_Position",
			crop: [
				.03,
				.05,
				.8
			]
		},
		decline_pushup: {
			src: "Push-Ups_With_Feet_Elevated",
			crop: [
				.16,
				0,
				.82
			]
		},
		chair_dip: {
			src: "Bench_Dips",
			crop: [
				.22,
				0,
				.76
			]
		},
		table_row: {
			src: "Inverted_Row",
			crop: [
				.1,
				0,
				.83
			]
		},
		superman: {
			src: "Superman",
			crop: [
				.1,
				.12,
				.8
			]
		},
		crunch: {
			src: "Crunches",
			crop: [
				.27,
				.27,
				.6
			]
		},
		situp: {
			src: "Sit-Up",
			crop: [
				.12,
				.03,
				.8
			]
		},
		leg_raise: {
			src: "Flat_Bench_Lying_Leg_Raise",
			crop: [
				.2,
				.08,
				.72
			]
		},
		v_up: {
			src: "Jackknife_Sit-Up",
			crop: [
				.18,
				.06,
				.78
			]
		},
		dead_bug: {
			src: "Dead_Bug",
			crop: [
				.1,
				0,
				.83
			]
		},
		plank: {
			src: "Plank",
			crop: [
				.2,
				.08,
				.76
			]
		},
		side_plank: {
			src: "Side_Bridge",
			crop: [
				.06,
				.04,
				.8
			]
		},
		squat: {
			src: "Bodyweight_Squat",
			crop: [
				.11,
				.03,
				.78
			]
		},
		split_squat: {
			src: "Split_Squats",
			crop: [
				.12,
				.02,
				.8
			]
		},
		lunge: {
			src: "Bodyweight_Walking_Lunge",
			crop: [
				0,
				.16,
				.7
			]
		},
		jump_lunge: {
			src: "Split_Jump",
			crop: [
				.13,
				.06,
				.76
			]
		},
		glute_bridge: {
			src: "Butt_Lift_Bridge",
			crop: [
				.1,
				.04,
				.82
			]
		},
		single_leg_bridge: {
			src: "Single_Leg_Glute_Bridge",
			crop: [
				.08,
				0,
				.82
			]
		},
		star_jump: {
			src: "Star_Jump",
			crop: [
				.12,
				0,
				.8
			]
		},
		mountain_climber: {
			src: "Mountain_Climbers",
			crop: [
				.06,
				0,
				.83
			]
		},
		cat_cow: {
			src: "Cat_Stretch",
			crop: [
				.04,
				.02,
				.82
			]
		},
		worlds_greatest: {
			src: "Worlds_Greatest_Stretch",
			crop: [
				.15,
				.02,
				.8
			]
		},
		arm_circles: {
			src: "Arm_Circles",
			crop: [
				.1,
				.02,
				.8
			]
		},
		childs_pose: {
			src: "Childs_Pose",
			crop: [
				.18,
				.1,
				.78
			]
		}
	};
	var PHOTO_SOURCE = {
		name: "Free Exercise DB",
		url: "https://github.com/yuhonas/free-exercise-db",
		license: "The Unlicense (public domain)"
	};
	/** The two frames of a move's photo demo (paths next to the Sport Track page), or null when it is drawn. */
	function photoOf(moveId) {
		if (!moveId || !Object.prototype.hasOwnProperty.call(PHOTOS, moveId)) return null;
		return {
			start: `photos/${moveId}-0.webp`,
			end: `photos/${moveId}-1.webp`
		};
	}
	// src/core/sportSets.ts
	var MUSCLES = [
		{
			id: "push",
			name: "Chest, shoulders, triceps",
			short: "Push"
		},
		{
			id: "pull",
			name: "Back and biceps",
			short: "Pull"
		},
		{
			id: "core",
			name: "Core",
			short: "Core"
		},
		{
			id: "legs",
			name: "Legs and glutes",
			short: "Legs"
		}
	];
	/** Hard sets a week per muscle group that grow muscle (about 10 to 20). */
	var WEEKLY_SETS = {
		lo: 10,
		hi: 20
	};
	/** Which muscle group a library group trains (cardio and stretches: none). */
	var muscleOf = (g) => g === "push" || g === "pull" || g === "core" || g === "legs" ? g : null;
	var clean = (n) => Math.max(0, Math.min(2e3, Math.round(Number(n) || 0)));
	/** The sets of one exercise on one day (a copy, only real ones). */
	function setsOn(log, day, exId) {
		const l = log?.[day]?.[exId];
		return Array.isArray(l) ? l.filter((s) => s && clean(s.reps) > 0) : [];
	}
	/** A set to store: whole numbers, an id and a time. */
	function makeSet(reps, now = Date.now(), kg = 0, salt = "") {
		const s = {
			reps: clean(reps),
			at: now,
			id: `${now.toString(36)}${salt || Math.random().toString(36).slice(2, 6)}`
		};
		if (kg > 0) s.kg = Math.round(kg * 2) / 2;
		return s;
	}
	/** Adds sets to a log (a new log; the old one is not changed). */
	function addSets(log, day, exId, reps, now = Date.now()) {
		const out = JSON.parse(JSON.stringify(log ?? {}));
		const list = (out[day] ?? (out[day] = {}))[exId] ?? [];
		reps.map(clean).filter((r) => r > 0).forEach((r, i) => list.push(makeSet(r, now + i, 0, `${i}${exId.length}`)));
		if (list.length) out[day][exId] = list;
		return out;
	}
	/**
	* Two devices' set logs as one: per day and exercise, sets with an id are
	* joined (each once); lists without ids keep the longer one.
	*/
	function mergeSets(a, b) {
		const out = {};
		for (const day of /* @__PURE__ */ new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
			const A = a?.[day] ?? {};
			const B = b?.[day] ?? {};
			for (const ex of /* @__PURE__ */ new Set([...Object.keys(A), ...Object.keys(B)])) {
				const x = Array.isArray(A[ex]) ? A[ex] : [];
				const y = Array.isArray(B[ex]) ? B[ex] : [];
				let list;
				if (x.every((s) => s?.id) && y.every((s) => s?.id)) {
					const seen = /* @__PURE__ */ new Map();
					for (const s of [...x, ...y]) if (!seen.has(s.id)) seen.set(s.id, s);
					list = [...seen.values()].sort((p, q) => (Number(p.at) || 0) - (Number(q.at) || 0));
				} else list = x.length >= y.length ? x : y;
				if (list.length) (out[day] ?? (out[day] = {}))[ex] = list;
			}
		}
		return out;
	}
	/** The days with sets of an exercise, oldest first (only up to `until`, if given). */
	function sessionsOf(log, exId, until) {
		return Object.keys(log ?? {}).filter((d) => !until || d <= until).sort().map((day) => ({
			day,
			reps: setsOn(log, day, exId).map((s) => clean(s.reps))
		})).filter((s) => s.reps.length > 0);
	}
	/** Your best single set of an exercise (reps or seconds), and the day; null without sets. */
	function bestSet(log, exId, until) {
		let best = null;
		for (const s of sessionsOf(log, exId, until)) for (const r of s.reps) if (!best || r > best.reps) best = {
			reps: r,
			day: s.day
		};
		return best;
	}
	/** Monday of the week a day is in. */
	function mondayOf(day) {
		const d = /* @__PURE__ */ new Date(day + "T12:00:00Z");
		d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
		return d.toISOString().slice(0, 10);
	}
	function shiftDay(day, n) {
		const d = /* @__PURE__ */ new Date(day + "T12:00:00Z");
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}
	/**
	* A hard set: one close to what you can do that day, at least 5 reps (or
	* 15 seconds) and at least 70% of the day's best set of that exercise.
	* (A warm-up or a few easy extra reps don't count.)
	*/
	function hardSets(reps, unit = "reps") {
		const top = Math.max(0, ...reps);
		const min = unit === "sec" ? 15 : 5;
		return reps.filter((r) => r >= min && r >= top * .7).length;
	}
	/** Hard sets per muscle group from `from` to `to` (inclusive). */
	function hardSetsByMuscle(log, exercises, from, to) {
		const out = {
			push: 0,
			pull: 0,
			core: 0,
			legs: 0
		};
		const byId = new Map(exercises.map((e) => [String(e.id), e]));
		for (const [day, m] of Object.entries(log ?? {})) {
			if (day < from || day > to) continue;
			for (const id of Object.keys(m ?? {})) {
				const ex = byId.get(id);
				const mv = ex ? moveOf(ex) : null;
				const mu = muscleOf(mv?.group);
				if (!mu) continue;
				out[mu] += hardSets(setsOn(log, day, id).map((s) => s.reps), mv?.unit ?? ex?.unit);
			}
		}
		return out;
	}
	/** Reps (or seconds) per week, the last `weeks` weeks up to `today`, oldest first: from the day totals, so old days count too. */
	function weeklyVolume(days, exIds, today, weeks = 8) {
		const ids = exIds ? new Set(exIds.map(String)) : null;
		const mon = mondayOf(today);
		return Array.from({ length: weeks }, (_, k) => {
			const monday = shiftDay(mon, -7 * (weeks - 1 - k));
			let total = 0;
			for (let d = 0; d < 7; d++) for (const [id, v] of Object.entries(days?.[shiftDay(monday, d)] ?? {})) if (!ids || ids.has(id)) total += Number(v) || 0;
			return {
				monday,
				total
			};
		});
	}
	/**
	* Sets from what was already saved, for days that have none yet: sessions
	* logged with sets (history items) and records ("15 in one set"). Day totals
	* are never turned into sets: they stay volume only.
	*/
	function importSets(st) {
		let out = JSON.parse(JSON.stringify(st.sets ?? {}));
		for (const h of Array.isArray(st.history) ? st.history : []) {
			const day = typeof h?.day === "string" ? h.day : null;
			if (!day || !Array.isArray(h.items)) continue;
			for (const it of h.items) {
				const id = String(it?.exerciseId ?? "");
				if (!id || !Array.isArray(it.sets) || !it.sets.length || setsOn(out, day, id).length) continue;
				const reps = it.sets.map((x) => clean(x?.reps)).filter((r) => r > 0);
				if (reps.length) out = addSets(out, day, id, reps, Number(h.id) > 0xe8d4a51000 ? Number(h.id) : Date.parse(day + "T12:00:00Z"));
			}
		}
		for (const [id, b] of Object.entries(st.best ?? {})) {
			const m = /^(\d+)\s*s?\s+in one set$/.exec(String(b?.label ?? ""));
			const day = b?.day;
			if (!m || !day || setsOn(out, day, id).length) continue;
			out = addSets(out, day, id, [Number(m[1])], Date.parse(day + "T12:00:00Z"));
		}
		return out;
	}
	/**
	* Sets in a message: "3x15 push-ups", "push-ups 3×15", "push-ups 15 14 12",
	* "pushups 15, 14, 12", "15 14 12 squats", "plank 3x45s", "plank 60s 45s".
	* One number alone ("50 pushups") is a total, not sets: null.
	*/
	function parseSets(text) {
		const t = String(text ?? "").trim().replace(/^\//, "").replace(/[×*]/g, "x").replace(/\s+/g, " ");
		if (!t || t.length > 80) return null;
		const name = (s) => s.replace(/[:,.\-–]+$/, "").replace(/^[:,.\-–]+/, "").trim();
		const isName = (s) => /^[a-zA-ZÀ-ž][a-zA-ZÀ-ž' _-]{1,40}$/.test(s.trim());
		const nx = /^(\d{1,2})\s?x\s?(\d{1,3})\s?(s|sec|secs|seconds)?\s+(.+)$/i.exec(t) ?? null;
		const xn = /^(.+?)\s+(\d{1,2})\s?x\s?(\d{1,3})\s?(s|sec|secs|seconds)?$/i.exec(t) ?? null;
		if (nx && isName(nx[4])) {
			const n = Number(nx[1]), r = Number(nx[2]);
			if (n >= 1 && n <= 12 && r >= 1) return {
				name: name(nx[4]),
				reps: Array(n).fill(r),
				unit: nx[3] ? "sec" : "reps"
			};
		}
		if (xn && isName(xn[1])) {
			const n = Number(xn[2]), r = Number(xn[3]);
			if (n >= 1 && n <= 12 && r >= 1) return {
				name: name(xn[1]),
				reps: Array(n).fill(r),
				unit: xn[4] ? "sec" : "reps"
			};
		}
		const nums = String.raw`((?:\d{1,3}\s?(?:s|sec)?\s?[,;/ ]\s?)+\d{1,3}\s?(?:s|sec)?)`;
		const after = new RegExp(String.raw`^(.+?)[: ]+${nums}$`, "i").exec(t);
		const before = new RegExp(String.raw`^${nums}\s+(.+)$`, "i").exec(t);
		const pick = after && isName(after[1]) ? {
			n: after[1],
			list: after[2]
		} : before && isName(before[2]) ? {
			n: before[2],
			list: before[1]
		} : null;
		if (!pick) return null;
		const parts = pick.list.split(/[,;/ ]+/).filter(Boolean);
		const vals = [];
		let sec = false;
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			if (/^(s|sec)$/i.test(p)) {
				sec = true;
				continue;
			}
			const m = /^(\d{1,3})(s|sec)?$/i.exec(p);
			if (!m) return null;
			if (m[2]) sec = true;
			vals.push(Number(m[1]));
		}
		if (vals.length < 2 || vals.length > 12 || vals.some((v) => v < 1)) return null;
		return {
			name: name(pick.n),
			reps: vals,
			unit: sec ? "sec" : "reps"
		};
	}
	/** "15 · 14 · 12" or "3 × 15" for a list of sets (with "s" for holds). */
	function setsText(reps, unit = "reps") {
		const u = unit === "sec" ? " s" : "";
		if (!reps.length) return "";
		if (reps.length > 1 && reps.every((r) => r === reps[0])) return `${reps.length} × ${reps[0]}${u}`;
		return reps.join(" · ") + u;
	}
	// src/core/sportProgress.ts
	/** Holds: how long a set should last, by move. */
	var HOLDS = {
		plank: [30, 60],
		side_plank: [20, 45],
		hollow_hold: [15, 40],
		wall_sit: [30, 75],
		down_dog: [30, 60],
		childs_pose: [30, 60]
	};
	/** The rep range for a move. */
	function rangeFor(move) {
		if (!move) return {
			lo: 8,
			hi: 15,
			sets: 3,
			unit: "reps"
		};
		if (move.unit === "sec") {
			const [lo, hi] = HOLDS[move.id] ?? [20, 60];
			return {
				lo,
				hi,
				sets: 3,
				unit: "sec"
			};
		}
		if (move.group === "push" || move.group === "pull") return {
			lo: move.diff >= 4 ? 5 : 8,
			hi: move.diff >= 4 ? 12 : 15,
			sets: 3,
			unit: "reps"
		};
		if (move.group === "legs" || move.group === "core") return {
			lo: move.diff >= 4 ? 6 : 10,
			hi: move.diff >= 4 ? 15 : 20,
			sets: 3,
			unit: "reps"
		};
		if (move.group === "cardio") return {
			lo: 15,
			hi: 30,
			sets: 3,
			unit: "reps"
		};
		return {
			lo: 8,
			hi: 12,
			sets: 2,
			unit: "reps"
		};
	}
	/** A session's working sets: the first `n` (a warm-up isn't logged as a set here). */
	var working = (s, n) => s.reps.slice(0, n);
	/** Every working set reached the top. */
	var atTop = (s, r) => s.reps.length >= r.sets && working(s, r.sets).every((x) => x >= r.hi);
	/** Not even one set reached the bottom. */
	var belowBottom = (s, r) => Math.max(...s.reps) < r.lo;
	var daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
	/** A long break: this many days without the move. */
	var BREAK_DAYS = 10;
	/** Sessions in a row at the top before the next step unlocks. */
	var NEED = 2;
	var clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	var u = (r) => r.unit === "sec" ? " s" : "";
	/**
	* Where an exercise stands and what to aim for today. `log` is every set
	* logged; `exId` the exercise; sessions before `today` set today's goal, and
	* today's own sets count for "ready" as soon as they're logged.
	*/
	function progressFor(input) {
		const { log, exId, move, today } = input;
		const r = rangeFor(move);
		const all = sessionsOf(log, exId, today);
		const past = all.filter((s) => s.day < today);
		const todays = all.find((s) => s.day === today) ?? null;
		const last = past[past.length - 1] ?? null;
		const daysSince = last ? daysBetween(last.day, today) : null;
		const next = move ? nextStep(move) : null;
		const prev = move ? prevStep(move) : null;
		const nextAt = `${r.sets}×${r.hi}${u(r)}`;
		const base = {
			range: r,
			sets: r.sets,
			nextAt,
			need: 2,
			daysSince,
			last,
			today: todays?.reps ?? [],
			next: null,
			prev: null
		};
		const recent = [...past, ...todays && todays.reps.length >= r.sets ? [todays] : []];
		let hits = 0;
		for (let i = recent.length - 1; i >= 0 && atTop(recent[i], r); i--) hits++;
		const first = recent.length === 1 && Math.max(...recent[0].reps) >= Math.ceil(r.hi * 1.5);
		if (hits >= 2 || first) {
			const n = Math.max(hits, first ? 2 : 0);
			return next ? {
				...base,
				status: "ready",
				goal: r.hi,
				hits: n,
				next,
				line: `Level up: ${next.name} is unlocked. Start it at ${r.sets}×${rangeFor(next).lo}${u(rangeFor(next))}.`
			} : {
				...base,
				status: "top",
				goal: r.hi,
				hits: n,
				line: `Top of the ladder. Add a 4th set, or go slower (3 seconds down).`
			};
		}
		if (!last) return {
			...base,
			status: "new",
			goal: r.lo,
			hits,
			line: `First time: ${r.sets} sets of ${r.lo}–${r.hi}${u(r)}. Stop 1–2 reps before you can't do another.`
		};
		const lastMin = Math.min(...working(last, r.sets));
		const peak = Math.max(...past.slice(-6).flatMap((s) => working(s, r.sets).length >= r.sets ? [Math.min(...working(s, r.sets))] : []), lastMin);
		if (daysSince !== null && daysSince >= 10) {
			const back = Math.round(peak * .7);
			if (back < r.lo && prev && daysSince >= 21) return {
				...base,
				status: "comeback",
				goal: r.lo,
				hits: 0,
				prev,
				line: `Welcome back after ${daysSince} days. Start one step easier (${prev.name}) or ${r.sets}×${r.lo}${u(r)}, and build up fast.`
			};
			return {
				...base,
				status: "comeback",
				goal: clamp(back, r.lo, r.hi),
				hits: 0,
				line: `Welcome back after ${daysSince} days: start at ${r.sets}×${clamp(back, r.lo, r.hi)}${u(r)} (about 70%), then build up fast.`
			};
		}
		const misses = past.slice(-2);
		if (misses.length === 2 && misses.every((s) => belowBottom(s, r))) return prev ? {
			...base,
			status: "stuck",
			goal: r.lo,
			hits: 0,
			prev,
			line: `Under ${r.lo}${u(r)} twice: step back to ${prev.name} for a while, or rest 2–3 minutes between sets.`
		} : {
			...base,
			status: "stuck",
			goal: r.lo,
			hits: 0,
			line: `Under ${r.lo}${u(r)} twice: rest 2–3 minutes between sets and sleep well. You'll get there.`
		};
		let breakAt = -1;
		for (let j = Math.max(1, past.length - 3); j < past.length; j++) if (daysBetween(past[j - 1].day, past[j].day) >= 10) breakAt = j;
		const mins = (list) => list.flatMap((s) => working(s, r.sets).length >= r.sets ? [Math.min(...working(s, r.sets))] : []);
		const oldPeak = breakAt > 0 ? Math.max(0, ...mins(past.slice(0, breakAt))) : 0;
		const step = r.unit === "sec" ? 5 : 1;
		const goal = clamp(breakAt > 0 && lastMin < oldPeak ? Math.min(oldPeak, lastMin + 3 * step) : lastMin + step, r.lo, r.hi);
		return {
			...base,
			status: "building",
			goal,
			hits,
			line: hits ? `${hits} of 2 sessions at the top. One more and the next level unlocks.` : `Aim for ${r.sets}×${goal}${u(r)} today. Next level at ${nextAt}.`
		};
	}
	/** The day's total this plan asks for (sets × goal): what the card's bar fills to. */
	var growTarget = (p) => p.sets * p.goal;
	/** "Endurance" (the old step-up): +5% to every target after 3 full days in a row. */
	function enduranceStep(targets) {
		return targets.map((t) => Math.max(t + 1, Math.round(t * 1.05)));
	}
	// src/core/sportStrength.ts
	/** How hard a move is compared with the first step of its ladder. */
	function loadOf(move) {
		const steps = FAMILIES[move.family]?.steps ?? [];
		const i = Math.max(0, steps.indexOf(move.id));
		return Math.pow(1.2, i);
	}
	/** One set's strength score: 100 × load × (1 + reps / 30). Holds count 3 seconds as a rep. */
	function setScore(move, reps) {
		const r = move.unit === "sec" ? reps / 3 : reps;
		return Math.round(100 * loadOf(move) * (1 + Math.max(0, r) / 30));
	}
	/** Exercises (by id) grouped by ladder family, from the library move each one is. */
	function byFamily(exercises) {
		const out = /* @__PURE__ */ new Map();
		for (const ex of exercises) {
			const move = moveOf(ex);
			if (!move) continue;
			const l = out.get(move.family) ?? [];
			l.push({
				ex,
				move
			});
			out.set(move.family, l);
		}
		return out;
	}
	/** The best set per session day for one ladder family (every step of it), oldest first. */
	function familySeries(log, exercises, family, until) {
		const list = byFamily(exercises).get(family) ?? [];
		const best = /* @__PURE__ */ new Map();
		for (const { ex, move } of list) for (const s of sessionsOf(log, String(ex.id), until)) {
			const top = Math.max(...s.reps);
			const score = setScore(move, top);
			const was = best.get(s.day);
			if (!was || score > was.score) best.set(s.day, {
				day: s.day,
				reps: top,
				move: move.id,
				score
			});
		}
		return [...best.values()].sort((a, b) => a.day.localeCompare(b.day));
	}
	/** The ladder families you have sets for. */
	function familiesWithSets(log, exercises) {
		return [...byFamily(exercises).keys()].filter((f) => familySeries(log, exercises, f).length > 0);
	}
	var bestIn = (pts, from, to) => pts.filter((p) => p.day >= from && p.day <= to).reduce((b, p) => !b || p.score > b.score ? p : b, null);
	/**
	* "You're 12% stronger than 4 weeks ago": per family, your best set in the
	* last 2 weeks against your best in the 2 weeks around 4 weeks ago (or your
	* first week of sets, when that's newer but at least a week old).
	*/
	function strengthChange(log, exercises, today, weeks = 4) {
		const nowFrom = shiftDay(today, -13);
		const fams = [];
		let since = null;
		for (const f of familiesWithSets(log, exercises)) {
			const pts = familySeries(log, exercises, f, today);
			const now = bestIn(pts, nowFrom, today);
			if (!now) continue;
			const thenTo = shiftDay(today, -7 * weeks + 7);
			let then = bestIn(pts, shiftDay(today, -7 * weeks - 7), thenTo);
			if (!then) {
				const first = pts[0];
				if (!first || first.day > shiftDay(today, -7)) continue;
				then = bestIn(pts, first.day, shiftDay(first.day, 6));
			}
			if (!then || then.day >= now.day) continue;
			if (!since || then.day < since) since = then.day;
			fams.push({
				family: f,
				name: FAMILIES[f]?.name ?? f,
				then,
				now,
				pct: Math.round((now.score / then.score - 1) * 100)
			});
		}
		return {
			pct: fams.length ? Math.round(fams.reduce((t, x) => t + x.pct, 0) / fams.length) : null,
			since,
			families: fams.sort((a, b) => b.pct - a.pct)
		};
	}
	/** Your strength score per muscle group (the best family's best set in the last 4 weeks) and in all. */
	function strengthScore(log, exercises, today) {
		const by = {
			push: 0,
			pull: 0,
			core: 0,
			legs: 0
		};
		const from = shiftDay(today, -27);
		for (const f of familiesWithSets(log, exercises)) {
			const best = bestIn(familySeries(log, exercises, f, today), from, today);
			const mu = muscleOf((best && moveById(best.move))?.group);
			if (best && mu) by[mu] = Math.max(by[mu], best.score);
		}
		return {
			total: by.push + by.pull + by.core + by.legs,
			by
		};
	}
	/**
	* A new record: a set (not logged yet) that beats every set logged before it
	* in the same family, by score. The very first set isn't a record.
	*/
	function isRecord(log, exercises, move, reps, day) {
		const prevBest = Math.max(0, ...familySeries(log, exercises, move.family, day).map((p) => p.score));
		return prevBest > 0 && setScore(move, reps) > prevBest;
	}
	// src/core/sportProgram.ts
	/** Families for each slot, the first you do wins (else the first step listed here). */
	var SLOTS = {
		push: {
			fams: ["pushup"],
			start: ["pushup"]
		},
		shoulders: {
			fams: ["pike", "dips"],
			start: ["pike_pushup", "chair_dip"]
		},
		pull: {
			fams: ["row"],
			start: ["table_row_bent"]
		},
		back: {
			fams: ["back"],
			start: ["superman"]
		},
		squat: {
			fams: ["squat"],
			start: ["squat"]
		},
		lunge: {
			fams: ["lunge"],
			start: ["reverse_lunge"]
		},
		hinge: {
			fams: ["bridge"],
			start: ["glute_bridge"]
		},
		calves: {
			fams: ["calf"],
			start: ["calf_raise"]
		},
		abs: {
			fams: ["core"],
			start: ["crunch"]
		},
		plank: {
			fams: ["plank", "deadbug"],
			start: ["plank"]
		}
	};
	/** The slots of each session, most important first (4 to 6 are used, by the time you have). */
	var SESSIONS = {
		full_a: {
			name: "Full body A",
			slots: [
				"push",
				"squat",
				"pull",
				"abs",
				"hinge",
				"shoulders"
			]
		},
		full_b: {
			name: "Full body B",
			slots: [
				"shoulders",
				"lunge",
				"pull",
				"plank",
				"push",
				"back"
			]
		},
		upper: {
			name: "Upper body",
			slots: [
				"push",
				"pull",
				"shoulders",
				"back",
				"abs",
				"plank"
			]
		},
		lower: {
			name: "Lower body",
			slots: [
				"squat",
				"lunge",
				"hinge",
				"plank",
				"calves",
				"abs"
			]
		}
	};
	/** Training days (0 = Monday) for 3 or 4 sessions a week, with rest days between. */
	var TRAIN_DAYS = {
		2: [0, 3],
		3: [
			0,
			2,
			4
		],
		4: [
			0,
			1,
			3,
			4
		],
		5: [
			0,
			1,
			2,
			4,
			5
		]
	};
	var WARMUP_MIN = 3;
	var COOLDOWN_MIN = 3;
	/** Seconds a rep takes (about 1 s up, 2 s down). */
	var REP_SEC = 3;
	var SWITCH_SEC = 20;
	/** The move for a slot: yours on that ladder (the hardest you do), else the library's start. */
	function pickMove(slot, mine, used) {
		const spec = SLOTS[slot];
		for (const f of spec.fams) {
			const have = mine.filter((m) => m.move.family === f && !used.has(m.move.id)).sort((a, b) => FAMILIES[f].steps.indexOf(b.move.id) - FAMILIES[f].steps.indexOf(a.move.id))[0];
			if (have) return {
				move: have.move,
				exId: String(have.ex.id)
			};
		}
		for (const id of spec.start) {
			const m = moveById(id);
			if (m && !used.has(m.id)) return {
				move: m,
				exId: null
			};
		}
		return null;
	}
	/** Seconds of work in one set of an item (the middle of its range). */
	var workSec = (it) => {
		const mid = (it.lo + it.hi) / 2;
		return it.unit === "sec" ? mid : mid * REP_SEC;
	};
	/** Estimated minutes for a list of items (pairs rest once per round), warm-up and cool-down included. */
	function estimateMinutes(items, warmup = WARMUP_MIN, cooldown = 0) {
		let sec = 0;
		for (let i = 0; i < items.length; i++) {
			const it = items[i];
			if (it.pairNext && items[i + 1]) {
				const b = items[i + 1];
				const rounds = Math.max(it.sets, b.sets);
				sec += rounds * (workSec(it) + SWITCH_SEC + workSec(b)) + (rounds - 1) * it.rest + 40;
				i++;
			} else sec += it.sets * workSec(it) + (it.sets - 1) * it.rest + 40;
		}
		return Math.round(sec / 60 + warmup + cooldown);
	}
	/** One session that fits `minutes`: as many exercises (4–6) and as much rest (60–120 s) as fit; pairs when time is short. */
	function buildSession(kind, exercises, prefs) {
		const mine = exercises.filter((e) => e.active !== false).map((ex) => ({
			ex,
			move: moveOf(ex)
		})).filter((x) => !!x.move);
		const used = /* @__PURE__ */ new Set();
		const picks = [];
		for (const slot of SESSIONS[kind].slots) {
			const p = pickMove(slot, mine, used);
			if (p) {
				picks.push(p);
				used.add(p.move.id);
			}
		}
		const cooldown = prefs.coolDown ? COOLDOWN_MIN : 0;
		const minutes = Math.max(15, Math.min(60, prefs.minutes || 30));
		const make = (n, rest, paired) => picks.slice(0, n).map((p, i, arr) => {
			const r = rangeFor(p.move);
			return {
				move: p.move,
				exId: p.exId,
				sets: 3,
				lo: r.lo,
				hi: r.hi,
				unit: r.unit,
				rest,
				...paired && i % 2 === 0 && i + 1 < arr.length ? { pairNext: true } : {}
			};
		});
		const tries = [];
		for (const n of [
			6,
			5,
			4
		]) for (const rest of [
			120,
			90,
			75,
			60
		]) tries.push([
			n,
			rest,
			false
		]);
		for (const n of [
			6,
			5,
			4
		]) for (const rest of [
			90,
			75,
			60
		]) tries.push([
			n,
			rest,
			true
		]);
		let items = make(4, 60, true);
		for (const [n, rest, paired] of tries) {
			if (n > picks.length) continue;
			const it = make(n, rest, paired);
			if (estimateMinutes(it, WARMUP_MIN, cooldown) <= minutes) {
				items = it;
				break;
			}
		}
		return {
			kind,
			name: SESSIONS[kind].name,
			items,
			warmup: WARMUP_MIN,
			cooldown,
			minutes: estimateMinutes(items, WARMUP_MIN, cooldown)
		};
	}
	/** The split to use: upper / lower with 4 or more sessions a week unless you chose full body. */
	var splitOf = (p) => p.split === "full" || p.split === "upper_lower" ? p.perWeek >= 4 ? p.split : "full" : p.perWeek >= 4 ? "upper_lower" : "full";
	/** This week (Monday to Sunday) with a session on the training days and rest on the others. */
	function weekPlan(exercises, prefs, today) {
		const per = Math.max(2, Math.min(5, Math.round(prefs.perWeek || 3)));
		const days = TRAIN_DAYS[per];
		const split = splitOf({
			...prefs,
			perWeek: per
		});
		const weekNo = Math.floor(Date.parse(mondayOf(today) + "T12:00:00Z") / 6048e5);
		const kinds = split === "upper_lower" ? ["upper", "lower"] : weekNo % 2 ? ["full_b", "full_a"] : ["full_a", "full_b"];
		const cache = /* @__PURE__ */ new Map();
		const mon = mondayOf(today);
		return Array.from({ length: 7 }, (_, dow) => {
			const k = days.indexOf(dow);
			const kind = k >= 0 ? kinds[k % 2] : null;
			if (kind && !cache.has(kind)) cache.set(kind, buildSession(kind, exercises, prefs));
			return {
				day: shiftDay(mon, dow),
				dow,
				session: kind ? cache.get(kind) : null
			};
		});
	}
	/** Today's session, or null on a rest day. */
	function todaysSession(exercises, prefs, today) {
		return weekPlan(exercises, prefs, today).find((d) => d.day === today)?.session ?? null;
	}
	/** Short tips for growing muscle at home (shown with the plan). */
	function growTips(weightKg) {
		const g = weightKg && weightKg >= 35 && weightKg <= 200 ? Math.round(weightKg * 1.6) : null;
		return [
			g ? `Protein: about 1.6 g per kg a day (${g} g for you), spread over 3–4 meals.` : "Protein: about 1.6 g per kg of body weight a day, spread over 3–4 meals.",
			"Go close to failure: stop each set when 1–2 more good reps would be the most you could do.",
			"Sleep 7–9 hours: muscle grows while you rest, not while you train.",
			"Same rest each time (60–120 s), and slow on the way down."
		];
	}
	// src/core/sportTelegramImport.ts
	var ENT = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: "\"",
		apos: "'",
		nbsp: " ",
		"#39": "'"
	};
	var decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
	var plain = (html) => decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ");
	/** "Push-ups", "push ups", "pushups" → "pushup" (one key per exercise). */
	var nameKey = (n) => n.toLowerCase().replace(/[^a-z]/g, "").replace(/([^s])s$/, "$1");
	var shift = (day, n) => {
		const d = /* @__PURE__ */ new Date(day + "T12:00:00Z");
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	};
	/** The messages in a Telegram Desktop HTML export (div.message.default with .date[title], .from_name, .text). */
	function readMessages(html) {
		const out = [];
		let from = "";
		const parts = String(html ?? "").split(/<div class="message default\b/).slice(1);
		for (const chunk of parts) {
			const date = /class="[^"]*\bdate\b[^"]*"\s+title="(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(chunk);
			if (!date) continue;
			const fn = /<div class="from_name">\s*([\s\S]*?)\s*<\/div>/.exec(chunk);
			if (fn) from = plain(fn[1]).trim();
			const tx = /<div class="text">([\s\S]*?)<\/div>/.exec(chunk);
			if (!tx) continue;
			let day = `${date[3]}-${date[2]}-${date[1]}`;
			if (Number(date[4]) < 4) day = shift(day, -1);
			out.push({
				day,
				from,
				text: plain(tx[1]).trim()
			});
		}
		return out;
	}
	var NAME = String.raw`([A-Za-z][A-Za-z' -]{0,28}[A-Za-z])`;
	/** "Push-ups (123/117 reps)", "Plank (60/60 sec)". */
	var CARD = new RegExp(String.raw`${NAME}\s*\(\s*(\d{1,4})\s*/\s*(\d{1,4})\s*(reps?|sec|s)?\s*\)`, "g");
	/** "press 0 / 35", "Push-ups 0 / 91 reps". */
	var SLASH = new RegExp(String.raw`${NAME}\s+(\d{1,4})\s*/\s*(\d{1,4})\s*(reps?|sec|s)?\b`, "g");
	/** Your own log: "103 push ups", "47pushups", "+20 squats". */
	var LOG = new RegExp(String.raw`^\+?(\d{1,4})\s*${NAME}$`);
	var WORDS = /^(today|still|time|done|left|target|workout|total|streak|day|days|water|of|reps|sec)$/i;
	var NOT_SPORT = /water|glass|sleep|spent|lei|focus|coffee|task|minute|hour|step/;
	var KNOWN = /press|pushup|situp|squat|pullup|dip|plank|lunge|crunch|burpee|abs/;
	/**
	* Counts per day from the messages: the bot's done/target lines (the highest
	* done that day) and your own logs (added up that day); the day's number is
	* the higher of the two. "Today's Workout (YYYY-MM-DD)" sets the day of its card.
	*/
	function parseTelegramExport(htmls) {
		const msgs = (Array.isArray(htmls) ? htmls : [htmls]).flatMap(readMessages);
		const card = {};
		const logs = {};
		const put = (to, day, c, add) => {
			const k = nameKey(c.name);
			if (!k || k.length < 3 || WORDS.test(c.name.trim()) || NOT_SPORT.test(k)) return;
			if (add && !matchMove(c.name) && !KNOWN.test(k)) return;
			const m = to[day] ?? (to[day] = {});
			const was = m[k];
			if (!was) m[k] = { ...c };
			else if (add) was.done += c.done;
			else {
				if (c.done > was.done) was.done = c.done;
				if (c.target != null) was.target = Math.max(was.target ?? 0, c.target);
				if (/^[A-Z]/.test(c.name) && !/^[A-Z]/.test(was.name)) was.name = c.name;
			}
		};
		for (const msg of msgs) {
			const dated = /\((\d{4}-\d{2}-\d{2})\)/.exec(msg.text);
			const day = dated && /workout/i.test(msg.text) ? dated[1] : msg.day;
			let found = false;
			for (const line of msg.text.split("\n")) {
				const l = line.replace(/[^\x20-\x7E]/g, " ").trim();
				if (!l) continue;
				let hit = false;
				for (const re of [CARD, SLASH]) {
					re.lastIndex = 0;
					let m;
					while (m = re.exec(l)) {
						hit = true;
						const unit = m[4] && /^s(ec)?$/i.test(m[4]) ? "sec" : "reps";
						put(card, day, {
							name: m[1].trim(),
							done: Number(m[2]),
							target: Number(m[3]),
							unit
						}, false);
					}
					if (hit) break;
				}
				if (hit) {
					found = true;
					continue;
				}
				const lg = LOG.exec(l);
				if (lg && !found) put(logs, msg.day, {
					name: lg[2].trim(),
					done: Number(lg[1]),
					target: null,
					unit: "reps"
				}, true);
			}
		}
		const days = JSON.parse(JSON.stringify(card));
		for (const [d, m] of Object.entries(logs)) for (const [k, c] of Object.entries(m)) {
			const t = days[d] ?? (days[d] = {});
			if (!t[k]) t[k] = c;
			else if (c.done > t[k].done) t[k].done = c.done;
		}
		for (const d of Object.keys(days)) {
			for (const k of Object.keys(days[d])) if (!(days[d][k].done > 0)) delete days[d][k];
			if (!Object.keys(days[d]).length) delete days[d];
		}
		const list = Object.keys(days).sort();
		return {
			days,
			first: list[0] ?? null,
			last: list[list.length - 1] ?? null,
			messages: msgs.length
		};
	}
	/** Which of your exercises a name is: the same name ("press" is your "press"), else the same library move, else null (a new one). */
	function matchExercise(name, exercises) {
		const k = nameKey(name);
		const same = exercises.find((e) => nameKey(e.name) === k || nameKey(String(e.id)) === k || nameKey(String(e.id).replace(/^ex_/, "")) === k);
		if (same) return same;
		const mv = matchMove(name);
		return mv && exercises.find((e) => moveOf(e)?.id === mv.id) || null;
	}
	/**
	* Adds the picked days to the sport state: the day log keeps the higher
	* number per exercise, and each day gets one history entry marked
	* source "telegram import" (a full day when every target was reached). Today
	* and later are skipped (only past days), and nothing here pays points.
	*/
	function mergeTelegramDays(st, days, pick, today, now = Date.now()) {
		const out = JSON.parse(JSON.stringify(st ?? {}));
		out.exercises = Array.isArray(out.exercises) ? out.exercises : [];
		out.days = out.days && typeof out.days === "object" ? out.days : {};
		out.history = Array.isArray(out.history) ? out.history : [];
		const added = [];
		const done = [];
		for (const day of [...new Set(pick)].sort()) {
			if (day >= today || !days[day]) continue;
			const items = [];
			let full = true;
			for (const c of Object.values(days[day])) {
				var _out$days;
				let ex = matchExercise(c.name, out.exercises);
				if (!ex) {
					const mv = matchMove(c.name);
					ex = {
						id: "ex_tg_" + nameKey(c.name),
						name: c.name,
						target: c.target ?? c.done,
						unit: c.unit,
						active: false,
						...mv ? { move: mv.id } : {}
					};
					out.exercises.push({
						...ex,
						doneToday: 0
					});
					added.push(c.name);
				}
				const id = String(ex.id);
				const m = (_out$days = out.days)[day] ?? (_out$days[day] = {});
				m[id] = Math.max(Number(m[id]) || 0, c.done);
				if (c.target != null && c.done < c.target) full = false;
				items.push({
					exerciseId: id,
					name: ex.name,
					unit: c.unit,
					amount: m[id]
				});
			}
			const summary = items.map((i) => `${i.amount} ${i.name}`).join(", ");
			const entry = {
				id: Date.parse(day + "T12:00:00Z"),
				day,
				category: "Calisthenics",
				title: `${full ? "Daily routine" : "Partial day"}: ${summary}`,
				amount: `${items.length} exercises`,
				source: "telegram import",
				imported: now,
				paid: 0,
				items
			};
			const at = out.history.findIndex((h) => h?.day === day && h?.source === "telegram import");
			if (at >= 0) out.history[at] = entry;
			else if (!out.history.some((h) => h?.day === day && /^Daily routine/.test(String(h?.title ?? "")))) out.history.push(entry);
			done.push(day);
		}
		out.history.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0));
		return {
			st: out,
			days: done,
			added
		};
	}
	// src/core/sportRoutine.ts
	/** Bump when a new routine migration is needed. */
	var ROUTINE_VERSION = 2;
	/**
	* One time: anyone whose Today turned into the plan (or an empty rest day) gets "My routine" back, with
	* their own exercises and the daily targets they had. A choice made on purpose is kept: "The plan" or
	* "Build muscle" picked after this version (they are stored as `true` / `'grow'` then).
	*/
	function migrateRoutine(state) {
		const ss = state.sportySettings ?? {};
		if (Number(ss.routineV) >= 2) return state;
		const exercises = (state.exercises ?? []).map((e) => ({ ...e }));
		const settings = {
			...ss,
			routineV: 2
		};
		if (settings.planFollow !== true) settings.planFollow = false;
		if (settings.progressMode == null || settings.progressMode === "grow") {
			settings.progressMode = "endurance";
			for (const e of exercises) if (e.endTarget != null) {
				e.target = e.endTarget;
				delete e.endTarget;
			}
		}
		if (!exercises.some((e) => e.active) && exercises.length) {
			for (const e of exercises) if (!e.plan) e.active = true;
		}
		return {
			...state,
			exercises,
			sportySettings: settings
		};
	}
	exports.BONES = BONES;
	exports.BREAK_DAYS = BREAK_DAYS;
	exports.FAMILIES = FAMILIES;
	exports.FLOOR = FLOOR;
	exports.GROUPS = GROUPS;
	exports.MOVES = MOVES;
	exports.MUSCLES = MUSCLES;
	exports.NEED = NEED;
	exports.PHOTOS = PHOTOS;
	exports.PHOTO_SOURCE = PHOTO_SOURCE;
	exports.ROUTINE_VERSION = ROUTINE_VERSION;
	exports.TRAIN_DAYS = TRAIN_DAYS;
	exports.WEEKLY_SETS = WEEKLY_SETS;
	exports.activeDays = activeDays;
	exports.addSets = addSets;
	exports.bestRun = bestRun;
	exports.bestSet = bestSet;
	exports.boxOf = boxOf;
	exports.buildSession = buildSession;
	exports.computeBadges = computeBadges;
	exports.enduranceStep = enduranceStep;
	exports.estimateMinutes = estimateMinutes;
	exports.familiesWithSets = familiesWithSets;
	exports.familySeries = familySeries;
	exports.figureShapes = figureShapes;
	exports.frameAt = frameAt;
	exports.growTarget = growTarget;
	exports.growTips = growTips;
	exports.hardSets = hardSets;
	exports.hardSetsByMuscle = hardSetsByMuscle;
	exports.importSets = importSets;
	exports.isRecord = isRecord;
	exports.ladderOf = ladderOf;
	exports.levelOf = levelOf;
	exports.loadOf = loadOf;
	exports.loggedMoves = loggedMoves;
	exports.loopLength = loopLength;
	exports.makeSet = makeSet;
	exports.matchExercise = matchExercise;
	exports.matchMove = matchMove;
	exports.mergeSets = mergeSets;
	exports.mergeTelegramDays = mergeTelegramDays;
	exports.migrateRoutine = migrateRoutine;
	exports.mondayOf = mondayOf;
	exports.moveById = moveById;
	exports.moveOf = moveOf;
	exports.muscleOf = muscleOf;
	exports.newBadges = newBadges;
	exports.nextStep = nextStep;
	exports.parseSets = parseSets;
	exports.parseTelegramExport = parseTelegramExport;
	exports.photoOf = photoOf;
	exports.prevStep = prevStep;
	exports.progressFor = progressFor;
	exports.rangeFor = rangeFor;
	exports.sessionsOf = sessionsOf;
	exports.setScore = setScore;
	exports.setsOn = setsOn;
	exports.setsText = setsText;
	exports.splitOf = splitOf;
	exports.startTarget = startTarget;
	exports.stillFrame = stillFrame;
	exports.strengthChange = strengthChange;
	exports.strengthScore = strengthScore;
	exports.suggestHarder = suggestHarder;
	exports.targetRun = targetRun;
	exports.todaysSession = todaysSession;
	exports.weekPlan = weekPlan;
	exports.weeklyVolume = weeklyVolume;
	return exports;
})({});
