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
				"planche_pushup",
				"onearm_assist_pushup"
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
				"table_row",
				"feet_row",
				"onearm_row"
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
				"hollow_rock",
				"v_up",
				"dragon_neg",
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
				"plank_updown",
				"planche_lean"
			]
		},
		squat: {
			name: "Squats",
			steps: [
				"squat",
				"jump_squat",
				"split_squat",
				"bulgarian_squat",
				"box_pistol",
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
			alias: [
				"archer pushups",
				"archer",
				"archers",
				"archer push ups"
			],
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
			id: "onearm_assist_pushup",
			name: "One-arm-assisted push-ups",
			group: "push",
			family: "pushup",
			diff: 5,
			unit: "reps",
			start: 12,
			set: 4,
			muscles: [
				"Chest",
				"Triceps",
				"Shoulders",
				"Core"
			],
			steps: [
				"Put one hand on a box or thick book, a long reach to the side. The other hand is on the floor under your chest.",
				"Lower on the floor arm and use the other hand only as a light helper.",
				"Push up, then swap hands. Use the helper less and less each week."
			],
			mistake: "Pushing hard with the helper hand: it should only touch, like a fingertip on a table.",
			alias: [
				"one arm assisted pushups",
				"assisted one arm pushups",
				"one arm pushup progression"
			],
			anim: {
				props: [{
					k: "box",
					x: 94,
					y: 70,
					w: 24
				}],
				keys: [k(plank(PU_TOP, { a: [[80, 82.5], [104, 68.5]] }), .9, .35), k(plank(-6, { a: [[80, 82.5], [104, 68.5]] }), 1.2, .15)]
			}
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
			id: "feet_row",
			name: "Feet-elevated rows",
			group: "pull",
			family: "row",
			diff: 4,
			unit: "reps",
			start: 16,
			set: 6,
			muscles: [
				"Back",
				"Biceps",
				"Rear shoulders",
				"Core"
			],
			steps: [
				"Lie under a sturdy table, hold its edge, and put your heels on a chair or box.",
				"Keep the body one straight line, a little above flat.",
				"Pull your chest to the edge, pause, and lower for 2 seconds."
			],
			mistake: "Hips sagging as you tire: stop the set when the line breaks.",
			alias: [
				"feet elevated rows",
				"elevated feet rows",
				"feet up rows",
				"inverted rows feet elevated"
			],
			anim: {
				props: [{
					k: "table",
					x: 66,
					y: 40,
					w: 50
				}, {
					k: "box",
					x: 8,
					y: 64,
					w: 26
				}],
				keys: [k({
					s: body([26, 62.5], 5),
					line: true,
					a: [[86, 42], [85, 42]],
					f: [[26, 62.5], [27, 62.5]],
					eb: [1, 1],
					ft: [-62, -62]
				}, .9, .3), k({
					s: body([26, 62.5], -9.5),
					line: true,
					a: [[86, 42], [85, 42]],
					f: [[26, 62.5], [27, 62.5]],
					eb: [1, 1],
					ft: [-62, -62]
				}, .9, .3)]
			}
		},
		{
			id: "onearm_row",
			name: "One-arm rows (table or door)",
			group: "pull",
			family: "row",
			diff: 5,
			unit: "reps",
			start: 10,
			set: 4,
			muscles: [
				"Back",
				"Biceps",
				"Core",
				"Grip"
			],
			steps: [
				"Lie under a sturdy table or hold a door frame low, with one hand only. The other hand rests on your hip.",
				"Keep your hips square and your body straight.",
				"Pull your chest to the hand, lower slowly, finish one side, then swap."
			],
			mistake: "Twisting the body to cheat: the chest stays facing the ceiling.",
			alias: [
				"one arm rows",
				"one arm inverted row",
				"single arm rows",
				"one arm door row"
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
					a: [[86, 42], [74, 74]],
					f: [[26, 79], [27, 79]],
					ft: [-62, -62]
				}, .9, .3), k({
					s: body([26, 79], -24),
					line: true,
					a: [[86, 42], [72, 64]],
					f: [[26, 79], [27, 79]],
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
			id: "hollow_rock",
			name: "Hollow body rocks",
			group: "core",
			family: "core",
			diff: 3,
			unit: "reps",
			start: 30,
			set: 10,
			muscles: [
				"Abs",
				"Hip flexors",
				"Core"
			],
			steps: [
				"Get into the hollow hold: lower back pressed down, arms and straight legs a little off the floor.",
				"Rock back and forth like a boat, keeping the banana shape.",
				"Count one rep for each full rock. Stop if your lower back lifts."
			],
			mistake: "Letting the shape go loose: if the lower back lifts, make the rocks smaller.",
			alias: [
				"hollow rocks",
				"hollow body rock",
				"hollow rock"
			],
			anim: { keys: [k({
				h: [58, 78],
				s: [82.5, 72],
				a: [[107, 65], [106, 66]],
				f: [[23, 76.5], [24, 77.5]],
				ft: [-150, -150],
				bow: -2
			}, .7), k({
				h: [58, 80],
				s: [82.5, 76],
				a: [[107, 70], [106, 71]],
				f: [[23, 69], [24, 70]],
				ft: [-150, -150],
				bow: -2
			}, .7)] }
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
			id: "dragon_neg",
			name: "Dragon flag negatives",
			group: "core",
			family: "core",
			diff: 4,
			unit: "reps",
			start: 8,
			set: 3,
			muscles: [
				"Abs",
				"Core",
				"Lats"
			],
			steps: [
				"Lie on a bench or the floor and hold something solid behind your head.",
				"Get your straight body up on your upper back (kick up if you need to).",
				"Lower slowly for 5 seconds and stop a hand above the floor, then reset."
			],
			mistake: "Dropping fast or folding at the hips: slow and straight, or bend the knees.",
			alias: [
				"dragon flag negative",
				"dragon negatives",
				"dragon flag lowering"
			],
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
					f: [at([80, 68], 61.5, -150), at([80, 68], 61.5, -149)],
					eb: [-1, -1],
					ft: [-150, -149]
				}, 2, .2)]
			}
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
			alias: ["dragon flags", "full dragon flag"],
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
			id: "planche_lean",
			name: "Pseudo-planche leans",
			group: "core",
			family: "plank",
			diff: 4,
			unit: "sec",
			start: 40,
			set: 10,
			muscles: [
				"Shoulders",
				"Chest",
				"Core",
				"Wrists"
			],
			steps: [
				"Get in a push-up position with your hands by your waist, fingers turned out.",
				"Lean forward until your shoulders are well in front of your hands. Arms stay straight.",
				"Hold the lean and keep breathing. Warm up your wrists first."
			],
			mistake: "Bending the elbows or letting the hips pike up: straight arms, straight body.",
			alias: [
				"planche lean",
				"pseudo planche lean",
				"planche leans"
			],
			anim: { keys: [k(plank(-17, { a: [[66, 82.5], [64.5, 82.5]] }), 1.6), k(plank(-19, { a: [[66, 82.5], [64.5, 82.5]] }), 1.6)] }
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
			id: "box_pistol",
			name: "Box pistol squats",
			group: "legs",
			family: "squat",
			diff: 4,
			unit: "reps",
			start: 14,
			set: 5,
			muscles: [
				"Thighs (quads)",
				"Glutes",
				"Balance",
				"Core"
			],
			steps: [
				"Stand on one leg in front of a box or chair, the other leg straight out in front.",
				"Sit back onto the box slowly on the standing leg, free leg off the floor.",
				"Stand up without swinging. Use a lower box each week until it is a full pistol."
			],
			mistake: "Dropping onto the box: lower slowly, then stand without rocking.",
			alias: [
				"box pistol",
				"box pistols",
				"assisted pistol squat",
				"pistol to box"
			],
			anim: {
				props: [{
					k: "box",
					x: 34,
					y: 68,
					w: 26
				}],
				keys: [k({
					h: [60, 46.5],
					s: [61, 21.5],
					a: [[86, 26], [85, 27]],
					f: [[62, 81.5], at([60, 46.5], 36.3, 38)],
					ft: [12, -45],
					eb: [-1, -1]
				}, 1, .3), k({
					h: [51, 66],
					s: at([51, 66], 25, -62),
					a: [[90, 44], [89, 45]],
					f: [[62, 81.5], at([51, 66], 36.3, -3)],
					ft: [12, -80],
					eb: [-1, -1]
				}, 1.2, .2)]
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
		box_pistol: {
			src: "Single-Leg_High_Box_Squat",
			crop: [
				.1,
				0,
				.8
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
	function addSets(log, day, exId, reps, now = Date.now(), extra = {}) {
		const out = JSON.parse(JSON.stringify(log ?? {}));
		const list = (out[day] ?? (out[day] = {}))[exId] ?? [];
		reps.map(clean).filter((r) => r > 0).forEach((r, i) => {
			const e = makeSet(r, now + i, extra.kg ?? 0, `${i}${exId.length}`);
			if (extra.test) e.test = true;
			list.push(e);
		});
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
	var atTop$1 = (s, r) => s.reps.length >= r.sets && working(s, r.sets).every((x) => x >= r.hi);
	/** Not even one set reached the bottom. */
	var belowBottom = (s, r) => Math.max(...s.reps) < r.lo;
	var daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
	/** A long break: this many days without the move. */
	var BREAK_DAYS = 10;
	/** Sessions in a row at the top before the next step unlocks. */
	var NEED = 2;
	var clamp$4 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	var u$3 = (r) => r.unit === "sec" ? " s" : "";
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
		const nextAt = `${r.sets}×${r.hi}${u$3(r)}`;
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
		for (let i = recent.length - 1; i >= 0 && atTop$1(recent[i], r); i--) hits++;
		const first = recent.length === 1 && Math.max(...recent[0].reps) >= Math.ceil(r.hi * 1.5);
		if (hits >= 2 || first) {
			const n = Math.max(hits, first ? 2 : 0);
			return next ? {
				...base,
				status: "ready",
				goal: r.hi,
				hits: n,
				next,
				line: `Level up: ${next.name} is unlocked. Start it at ${r.sets}×${rangeFor(next).lo}${u$3(rangeFor(next))}.`
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
			line: `First time: ${r.sets} sets of ${r.lo}–${r.hi}${u$3(r)}. Stop 1–2 reps before you can't do another.`
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
				line: `Welcome back after ${daysSince} days. Start one step easier (${prev.name}) or ${r.sets}×${r.lo}${u$3(r)}, and build up fast.`
			};
			return {
				...base,
				status: "comeback",
				goal: clamp$4(back, r.lo, r.hi),
				hits: 0,
				line: `Welcome back after ${daysSince} days: start at ${r.sets}×${clamp$4(back, r.lo, r.hi)}${u$3(r)} (about 70%), then build up fast.`
			};
		}
		const misses = past.slice(-2);
		if (misses.length === 2 && misses.every((s) => belowBottom(s, r))) return prev ? {
			...base,
			status: "stuck",
			goal: r.lo,
			hits: 0,
			prev,
			line: `Under ${r.lo}${u$3(r)} twice: step back to ${prev.name} for a while, or rest 2–3 minutes between sets.`
		} : {
			...base,
			status: "stuck",
			goal: r.lo,
			hits: 0,
			line: `Under ${r.lo}${u$3(r)} twice: rest 2–3 minutes between sets and sleep well. You'll get there.`
		};
		let breakAt = -1;
		for (let j = Math.max(1, past.length - 3); j < past.length; j++) if (daysBetween(past[j - 1].day, past[j].day) >= 10) breakAt = j;
		const mins = (list) => list.flatMap((s) => working(s, r.sets).length >= r.sets ? [Math.min(...working(s, r.sets))] : []);
		const oldPeak = breakAt > 0 ? Math.max(0, ...mins(past.slice(0, breakAt))) : 0;
		const step = r.unit === "sec" ? 5 : 1;
		const goal = clamp$4(breakAt > 0 && lastMin < oldPeak ? Math.min(oldPeak, lastMin + 3 * step) : lastMin + step, r.lo, r.hi);
		return {
			...base,
			status: "building",
			goal,
			hits,
			line: hits ? `${hits} of 2 sessions at the top. One more and the next level unlocks.` : `Aim for ${r.sets}×${goal}${u$3(r)} today. Next level at ${nextAt}.`
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
		out.importedDays = out.importedDays && typeof out.importedDays === "object" ? out.importedDays : {};
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
				if (!out.sets?.[day]?.[id]?.length) {
					var _out$importedDays;
					const l = (_out$importedDays = out.importedDays)[day] ?? (_out$importedDays[day] = []);
					if (!l.includes(id)) l.push(id);
				}
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
	// src/core/sportSimple.ts
	var to5 = (n) => Math.max(5, Math.round(n / 5) * 5);
	/** How many reps "+1 set" adds: a third of the daily target, in fives (or the size you set). */
	var setSize = (ex) => Number(ex.setReps) > 0 ? Math.round(Number(ex.setReps)) : to5((Number(ex.target) || 0) / 3);
	function harderChoices(ex) {
		const t = Number(ex.target) || 0;
		const s = setSize(ex);
		const m = moveOf(ex);
		const nx = m ? nextStep(m) : null;
		return {
			reps: {
				by: 5,
				to: t + 5
			},
			set: {
				by: s,
				to: t + s
			},
			version: nx && m ? {
				moveId: nx.id,
				name: nx.name,
				target: startTarget(m, nx, t),
				unit: nx.unit
			} : null
		};
	}
	/** Make one exercise harder. Returns a new list; only that exercise (or its swap) changes. A version swap turns the old one off, never deletes it. */
	function makeHarder(exercises, id, kind, newId = `ex_${Date.now()}`) {
		const ex = exercises.find((e) => e.id === id);
		if (!ex) return null;
		const c = harderChoices(ex);
		const hist = [...ex.harder ?? []];
		if (kind === "reps" || kind === "set") {
			const step = kind === "reps" ? c.reps : c.set;
			const next = {
				...ex,
				target: step.to,
				harder: [...hist, {
					kind,
					by: step.by
				}]
			};
			return {
				exercises: exercises.map((e) => e.id === id ? next : e),
				id
			};
		}
		if (!c.version) return null;
		const fresh = {
			id: newId,
			name: c.version.name,
			target: c.version.target,
			unit: c.version.unit,
			active: ex.active !== false,
			doneToday: 0,
			move: c.version.moveId,
			harder: [...hist, {
				kind: "version",
				from: ex.id,
				fromTarget: Number(ex.target) || 0
			}]
		};
		const out = exercises.map((e) => e.id === id ? {
			...e,
			active: false
		} : e);
		const at = out.findIndex((e) => e.id === id);
		out.splice(at + 1, 0, fresh);
		return {
			exercises: out,
			id: fresh.id
		};
	}
	/** Go back one step (the last "Harder" you picked on this exercise). */
	function makeEasier(exercises, id) {
		const ex = exercises.find((e) => e.id === id);
		const hist = [...ex?.harder ?? []];
		const last = hist.pop();
		if (!ex || !last) return null;
		if (last.kind === "version") {
			if (!exercises.some((e) => e.id === last.from)) return null;
			return {
				exercises: exercises.map((e) => e.id === last.from ? {
					...e,
					active: true,
					target: last.fromTarget || e.target
				} : e.id === id ? {
					...e,
					active: false,
					harder: hist
				} : e),
				id: last.from
			};
		}
		const next = {
			...ex,
			target: Math.max(1, (Number(ex.target) || 0) - last.by),
			harder: hist
		};
		return {
			exercises: exercises.map((e) => e.id === id ? next : e),
			id
		};
	}
	/** The base moves of the best-set questions: a plain push-up, squat or sit-up is yours, not the coach's. */
	var BASE = /* @__PURE__ */ new Set([
		"pushup",
		"squat",
		"situp"
	]);
	var tsOf = (id) => {
		const m = /^ex_(\d{12,})/.exec(String(id));
		return m ? Number(m[1]) : 0;
	};
	/** Moves the coach added: marked, auto-switched, or created on/after best-set onboarding (other than a plain push-up, squat or sit-up). */
	function coachAdded(state) {
		const out = /* @__PURE__ */ new Set();
		const since = /^\d{4}-\d\d-\d\d$/.test(String(state.onboarded ?? "")) ? Date.parse(String(state.onboarded) + "T00:00:00Z") - 1296e5 : null;
		const auto = new Set((state.autoUp?.items ?? []).map((i) => i.newId));
		for (const e of state.exercises ?? []) {
			if (e.plan) continue;
			if (e.coach === true || auto.has(e.id)) out.add(e.id);
			else if (since != null && tsOf(e.id) >= since && !BASE.has(String(moveOf(e)?.id))) out.add(e.id);
		}
		return out;
	}
	/**
	* One time: your own routine is back. Coach-added moves are hidden (kept, with their history), your own moves the
	* coach turned off are on again, and your own daily targets (`endTarget`) are restored. Never empties the routine.
	*/
	function restoreOwnRoutine(state) {
		const list = (state.exercises ?? []).map((e) => ({ ...e }));
		const coach = coachAdded({
			...state,
			exercises: list
		});
		const fams = /* @__PURE__ */ new Set();
		for (const e of list) if (coach.has(e.id) && e.active) fams.add(String(moveOf(e)?.family ?? ""));
		fams.delete("");
		const on = [];
		const off = [];
		for (const e of list) if (coach.has(e.id)) {
			e.coach = true;
			if (e.active) on.push(e.id);
			e.active = false;
		}
		for (const f of fams) {
			const best = list.filter((e) => !coach.has(e.id) && !e.plan && !e.active && moveOf(e)?.family === f).sort((a, b) => (moveOf(a)?.diff ?? 0) - (moveOf(b)?.diff ?? 0)).pop();
			if (best) {
				best.active = true;
				off.push(best.id);
			}
		}
		for (const e of list) if (!coach.has(e.id) && e.endTarget != null) {
			e.target = e.endTarget;
			delete e.endTarget;
		}
		if (!list.some((e) => e.active) && list.length) {
			for (const e of list) if (e.coach && on.includes(e.id)) e.active = true;
			on.length = 0;
		}
		return {
			...state,
			exercises: list,
			coachHidden: {
				on,
				off,
				applied: false
			}
		};
	}
	/** Coach mode on: the coach's moves come back; off: your own routine again. Nothing is deleted either way. */
	function setCoachMode(state, on) {
		const ch = state.coachHidden ?? {
			on: [],
			off: [],
			applied: false
		};
		const ss = {
			...state.sportySettings ?? {},
			coachMode: on
		};
		const ex = state.exercises ?? [];
		if (on && !ch.applied && (ch.on.length || ch.off.length)) {
			const exercises = ex.map((e) => ch.on.includes(e.id) ? {
				...e,
				active: true
			} : ch.off.includes(e.id) ? {
				...e,
				active: false
			} : e);
			return {
				...state,
				exercises,
				sportySettings: ss,
				coachHidden: {
					...ch,
					applied: true
				}
			};
		}
		if (!on && ch.applied) {
			const exercises = ex.map((e) => ch.on.includes(e.id) ? {
				...e,
				active: false
			} : ch.off.includes(e.id) ? {
				...e,
				active: true
			} : e);
			return {
				...state,
				exercises,
				sportySettings: ss,
				coachHidden: {
					...ch,
					applied: false
				}
			};
		}
		return {
			...state,
			sportySettings: ss
		};
	}
	// src/core/sportRoutine.ts
	/** Bump when a new routine migration is needed. */
	var ROUTINE_VERSION = 5;
	/**
	* One time: anyone whose Today turned into the plan (or an empty rest day) gets "My routine" back, with
	* their own exercises and the daily targets they had. A choice made on purpose is kept: "The plan" or
	* "Build muscle" picked after this version (they are stored as `true` / `'grow'` then).
	*/
	function migrateRoutine(state) {
		return toV5(toV4(state));
	}
	function toV4(state) {
		const ss = state.sportySettings ?? {};
		if (Number(ss.routineV) >= 4) return state;
		const from = Number(ss.routineV) || 0;
		const exercises = (state.exercises ?? []).map((e) => ({ ...e }));
		const settings = {
			...ss,
			routineV: 4
		};
		if (from < 2) {
			if (settings.planFollow !== true) settings.planFollow = false;
			if (settings.progressMode == null || settings.progressMode === "grow") {
				settings.progressMode = "endurance";
				for (const e of exercises) if (e.endTarget != null) {
					e.target = e.endTarget;
					delete e.endTarget;
				}
			}
		}
		if (from < 3) settings.progressMode = "grow";
		if (from < 4 && settings.progressMode !== "endurance") settings.progressMode = "strength";
		if (!exercises.some((e) => e.active) && exercises.length) {
			for (const e of exercises) if (!e.plan) e.active = true;
		}
		return {
			...state,
			exercises,
			sportySettings: settings
		};
	}
	/**
	* v5: the owner wanted the simple way back. Simple mode is the default (`coachMode: false`), their own exercises and
	* targets come back, and the coach's moves are hidden, not deleted. Coach mode is a switch in the Plan tab.
	*/
	function toV5(state) {
		const ss = state.sportySettings ?? {};
		if (Number(ss.routineV) >= 5) return state;
		const restored = restoreOwnRoutine(state);
		restored.sportySettings = {
			...ss,
			routineV: 5,
			coachMode: false
		};
		return restored;
	}
	// src/core/sportLevels.ts
	var MEANING = [
		["Everyone starts here. Showing up is the hard part.", "You have started: that already beats most people."],
		["You are building the base. Your body is learning fast.", "Habits first, strength follows. You are on your way."],
		["Stronger than most beginners. This is real progress.", "People notice this level. Keep the rhythm."],
		["A solid, honest level. You train with control.", "You can trust your body here. Time to aim higher."],
		["Strong. Few people reach this without a gym.", "This is advanced home training. Be proud of it."],
		["Elite strength. You earned every single rep.", "The top of the ladder: legends are made of days like yours."]
	];
	var T = (family, rows) => [family, rows];
	var TABLES = [
		T("pushup", [
			[
				"Starting Line",
				"incline_pushup",
				3,
				6
			],
			[
				"Incline Climber",
				"incline_pushup",
				3,
				12
			],
			[
				"Kneeler",
				"knee_pushup",
				3,
				10
			],
			[
				"Knee Master",
				"knee_pushup",
				3,
				15
			],
			[
				"Floor Ready",
				"pushup",
				3,
				5
			],
			[
				"Solid",
				"pushup",
				3,
				10
			],
			[
				"Strong Chest",
				"pushup",
				3,
				15
			],
			[
				"Machine",
				"pushup",
				3,
				20
			],
			[
				"Wide Wings",
				"wide_pushup",
				3,
				15
			],
			[
				"Diamond Cutter",
				"diamond_pushup",
				3,
				10
			],
			[
				"Iron Chest",
				"diamond_pushup",
				3,
				15
			],
			[
				"Decline Drive",
				"decline_pushup",
				3,
				10
			],
			[
				"Archer",
				"archer_pushup",
				3,
				6
			],
			[
				"Archer Elite",
				"archer_pushup",
				3,
				10
			],
			[
				"One-arm Helper",
				"onearm_assist_pushup",
				3,
				5
			]
		]),
		T("squat", [
			[
				"Starting Line",
				"squat",
				3,
				8
			],
			[
				"Steady Legs",
				"squat",
				3,
				15
			],
			[
				"Squat Habit",
				"squat",
				3,
				20
			],
			[
				"Hundred Club",
				"squat",
				3,
				30
			],
			[
				"Springy",
				"jump_squat",
				3,
				10
			],
			[
				"Jump Master",
				"jump_squat",
				3,
				15
			],
			[
				"One Leg Forward",
				"split_squat",
				3,
				10
			],
			[
				"Split Strong",
				"split_squat",
				3,
				15
			],
			[
				"Bulgarian",
				"bulgarian_squat",
				3,
				8
			],
			[
				"Bulgarian Pro",
				"bulgarian_squat",
				3,
				12
			],
			[
				"Box Pistol",
				"box_pistol",
				3,
				6
			],
			[
				"Shrimp Starter",
				"shrimp_squat",
				3,
				4
			],
			[
				"Shrimp Master",
				"shrimp_squat",
				3,
				8
			],
			[
				"Pistol Path",
				"pistol_squat",
				3,
				2
			],
			[
				"Pistol",
				"pistol_squat",
				3,
				5
			]
		]),
		T("core", [
			[
				"Starting Line",
				"crunch",
				3,
				10
			],
			[
				"Crunch Rhythm",
				"crunch",
				3,
				20
			],
			[
				"Sit-up Start",
				"situp",
				3,
				10
			],
			[
				"Sit-up Strong",
				"situp",
				3,
				20
			],
			[
				"Raise Your Legs",
				"leg_raise",
				3,
				8
			],
			[
				"Leg Raise Pro",
				"leg_raise",
				3,
				15
			],
			[
				"Hollow Start",
				"hollow_hold",
				3,
				15
			],
			[
				"Hollow Strong",
				"hollow_hold",
				3,
				30
			],
			[
				"Hollow Rocker",
				"hollow_rock",
				3,
				15
			],
			[
				"V Shape",
				"v_up",
				3,
				8
			],
			[
				"V-up Pro",
				"v_up",
				3,
				15
			],
			[
				"Negative Start",
				"dragon_neg",
				3,
				3
			],
			[
				"Negative Strong",
				"dragon_neg",
				3,
				6
			],
			[
				"Dragon Start",
				"dragon_flag",
				3,
				2
			],
			[
				"Dragon Strong",
				"dragon_flag",
				3,
				5
			]
		]),
		T("plank", [
			[
				"Starting Line",
				"plank",
				3,
				15
			],
			[
				"Half Minute",
				"plank",
				3,
				30
			],
			[
				"Forty-five",
				"plank",
				3,
				45
			],
			[
				"Full Minute",
				"plank",
				3,
				60
			],
			[
				"Side Start",
				"side_plank",
				3,
				20
			],
			[
				"Side Steady",
				"side_plank",
				3,
				40
			],
			[
				"Tap Tap",
				"shoulder_taps",
				3,
				20
			],
			[
				"Tap Master",
				"shoulder_taps",
				3,
				40
			],
			[
				"Up and Down",
				"plank_updown",
				3,
				10
			],
			[
				"Up-down Pro",
				"plank_updown",
				3,
				20
			],
			[
				"Lean Start",
				"planche_lean",
				3,
				10
			],
			[
				"Lean Strong",
				"planche_lean",
				3,
				25
			]
		]),
		T("row", [
			[
				"Starting Line",
				"door_row",
				3,
				6
			],
			[
				"Door Puller",
				"door_row",
				3,
				12
			],
			[
				"Door Master",
				"door_row",
				3,
				18
			],
			[
				"Table Start",
				"table_row_bent",
				3,
				6
			],
			[
				"Bent Knee Rower",
				"table_row_bent",
				3,
				12
			],
			[
				"Bent Knee Master",
				"table_row_bent",
				3,
				18
			],
			[
				"Straight Legs",
				"table_row",
				3,
				5
			],
			[
				"Rower",
				"table_row",
				3,
				10
			],
			[
				"Strong Back",
				"table_row",
				3,
				15
			],
			[
				"Back of Steel",
				"table_row",
				3,
				20
			],
			[
				"Feet-up Rower",
				"feet_row",
				3,
				8
			],
			[
				"Feet-up Strong",
				"feet_row",
				3,
				12
			],
			[
				"One-arm Start",
				"onearm_row",
				3,
				4
			],
			[
				"One-arm Row Pro",
				"onearm_row",
				3,
				8
			]
		]),
		T("lunge", [
			[
				"Starting Line",
				"reverse_lunge",
				3,
				6
			],
			[
				"Backstep",
				"reverse_lunge",
				3,
				10
			],
			[
				"Backstep Strong",
				"reverse_lunge",
				3,
				14
			],
			[
				"Forward Lunge",
				"lunge",
				3,
				8
			],
			[
				"Lunge Steady",
				"lunge",
				3,
				12
			],
			[
				"Lunge Strong",
				"lunge",
				3,
				16
			],
			[
				"Lunge Master",
				"lunge",
				3,
				20
			],
			[
				"Jump Start",
				"jump_lunge",
				3,
				6
			],
			[
				"Jump Lunger",
				"jump_lunge",
				3,
				10
			],
			[
				"Spring Legs",
				"jump_lunge",
				3,
				15
			]
		]),
		T("bridge", [
			[
				"Starting Line",
				"glute_bridge",
				3,
				8
			],
			[
				"Bridge Builder",
				"glute_bridge",
				3,
				15
			],
			[
				"Bridge Strong",
				"glute_bridge",
				3,
				20
			],
			[
				"Bridge Master",
				"glute_bridge",
				3,
				30
			],
			[
				"One Leg Start",
				"single_leg_bridge",
				3,
				5
			],
			[
				"One Leg Steady",
				"single_leg_bridge",
				3,
				8
			],
			[
				"One Leg Strong",
				"single_leg_bridge",
				3,
				12
			],
			[
				"One Leg Pro",
				"single_leg_bridge",
				3,
				15
			],
			[
				"Glute Machine",
				"single_leg_bridge",
				3,
				20
			],
			[
				"Glute Legend",
				"single_leg_bridge",
				4,
				20
			]
		]),
		T("calf", [
			[
				"Starting Line",
				"calf_raise",
				3,
				10
			],
			[
				"Calf Habit",
				"calf_raise",
				3,
				20
			],
			[
				"Calf Strong",
				"calf_raise",
				3,
				30
			],
			[
				"Calf Master",
				"calf_raise",
				3,
				40
			],
			[
				"One Leg Start",
				"single_calf_raise",
				3,
				6
			],
			[
				"One Leg Steady",
				"single_calf_raise",
				3,
				10
			],
			[
				"One Leg Strong",
				"single_calf_raise",
				3,
				15
			],
			[
				"One Leg Pro",
				"single_calf_raise",
				3,
				20
			],
			[
				"Spring Steel",
				"single_calf_raise",
				3,
				25
			],
			[
				"Calf Legend",
				"single_calf_raise",
				3,
				30
			]
		]),
		T("dips", [
			[
				"Starting Line",
				"chair_dip",
				3,
				4
			],
			[
				"Dip Starter",
				"chair_dip",
				3,
				8
			],
			[
				"Dip Steady",
				"chair_dip",
				3,
				12
			],
			[
				"Dip Strong",
				"chair_dip",
				3,
				16
			],
			[
				"Dip Machine",
				"chair_dip",
				3,
				20
			],
			[
				"Dip Pro",
				"chair_dip",
				3,
				25
			],
			[
				"Triceps Tank",
				"chair_dip",
				4,
				20
			],
			[
				"Dip Elite",
				"chair_dip",
				4,
				25
			],
			[
				"Dip Master",
				"chair_dip",
				5,
				20
			],
			[
				"Dip Legend",
				"chair_dip",
				5,
				25
			]
		]),
		T("pike", [
			[
				"Starting Line",
				"pike_pushup",
				3,
				4
			],
			[
				"Pike Starter",
				"pike_pushup",
				3,
				8
			],
			[
				"Pike Steady",
				"pike_pushup",
				3,
				12
			],
			[
				"Pike Strong",
				"pike_pushup",
				3,
				15
			],
			[
				"Feet-up Start",
				"elevated_pike",
				3,
				4
			],
			[
				"Feet-up Steady",
				"elevated_pike",
				3,
				8
			],
			[
				"Feet-up Strong",
				"elevated_pike",
				3,
				12
			],
			[
				"Shoulder Tank",
				"elevated_pike",
				3,
				15
			],
			[
				"Shoulder Pro",
				"elevated_pike",
				4,
				15
			],
			[
				"Shoulder Legend",
				"elevated_pike",
				5,
				15
			]
		]),
		T("back", [
			[
				"Starting Line",
				"superman",
				3,
				6
			],
			[
				"Superman Steady",
				"superman",
				3,
				12
			],
			[
				"Superman Strong",
				"superman",
				3,
				18
			],
			[
				"Superman Master",
				"superman",
				3,
				24
			],
			[
				"Swimmer Start",
				"swimmer",
				3,
				10
			],
			[
				"Swimmer Steady",
				"swimmer",
				3,
				16
			],
			[
				"Swimmer Strong",
				"swimmer",
				3,
				24
			],
			[
				"Swimmer Pro",
				"swimmer",
				3,
				32
			],
			[
				"Back Tank",
				"swimmer",
				4,
				32
			],
			[
				"Back Legend",
				"swimmer",
				5,
				32
			]
		]),
		T("burpee", [
			[
				"Starting Line",
				"half_burpee",
				3,
				5
			],
			[
				"Thruster",
				"half_burpee",
				3,
				10
			],
			[
				"Thruster Strong",
				"half_burpee",
				3,
				15
			],
			[
				"Burpee Start",
				"burpee",
				3,
				5
			],
			[
				"Burpee Steady",
				"burpee",
				3,
				10
			],
			[
				"Burpee Strong",
				"burpee",
				3,
				15
			],
			[
				"Burpee Master",
				"burpee",
				3,
				20
			],
			[
				"Push-up Burpee",
				"pushup_burpee",
				3,
				6
			],
			[
				"Burpee Pro",
				"pushup_burpee",
				3,
				10
			],
			[
				"Burpee Legend",
				"pushup_burpee",
				3,
				15
			]
		])
	];
	var REP_LADDER = [
		6,
		10,
		15,
		20,
		25,
		30,
		40,
		50,
		60,
		80
	];
	/** Words after the ×: "push-ups", "seconds of plank". */
	var reqText = (m, sets, reps) => m.unit === "sec" ? `${sets}×${reps} s ${m.name.toLowerCase()}` : `${sets}×${reps} ${m.name.toLowerCase()}`;
	function build(family, group, name, rows) {
		const N = rows.length;
		return {
			family,
			name,
			group,
			levels: rows.map(([lname, move, sets, reps], i) => {
				const m = moveById(move);
				if (!m) throw new Error(`sportLevels: unknown move ${move}`);
				const tier = Math.min(MEANING.length - 1, Math.floor(i / N * MEANING.length));
				return {
					n: i + 1,
					name: lname,
					move,
					sets,
					reps,
					req: reqText(m, sets, reps),
					meaning: MEANING[tier][i % 2]
				};
			})
		};
	}
	/** A track for a family without a hand-made table: each step × a ladder of reps, 10 levels at least. */
	function generic(family) {
		const f = FAMILIES[family];
		const steps = (f?.steps ?? []).map((id) => moveById(id)).filter(Boolean);
		if (!steps.length) return null;
		const rows = [];
		const perStep = Math.max(3, Math.ceil(10 / steps.length));
		steps.forEach((m, si) => {
			const sec = m.unit === "sec";
			const base = sec ? [
				10,
				20,
				30,
				45,
				60,
				75,
				90
			] : REP_LADDER;
			const from = si === 0 ? 0 : 1;
			for (let k = 0; k < perStep; k++) {
				const r = base[Math.min(base.length - 1, from + k)];
				rows.push([
					`${m.name} ${k + 1}`,
					m.id,
					3,
					si === 0 || !sec ? Math.max(3, Math.round(r * (1 - Math.min(.5, si * .12)))) : r
				]);
			}
		});
		return build(family, steps[0].group, f.name, rows.slice(0, 15).map((r) => [
			r[0],
			r[1],
			r[2],
			r[3]
		]));
	}
	var CACHE = /* @__PURE__ */ new Map();
	function trackOf(family) {
		if (CACHE.has(family)) return CACHE.get(family);
		let t = null;
		const table = TABLES.find((x) => x[0] === family);
		if (table) t = build(family, moveById(table[1][0][1])?.group ?? "push", FAMILIES[family]?.name ?? family, table[1]);
		else t = generic(family);
		CACHE.set(family, t);
		return t;
	}
	/** The families with a hand-made table of levels. */
	var MAIN_FAMILIES = TABLES.map((t) => t[0]);
	var stepIdx = (move) => (FAMILIES[move.family]?.steps ?? []).indexOf(move.id);
	/** Working sets are about 60% of a max set. */
	var WORKING_OF_MAX = .6;
	/** Reps on a move that match `reps` on a move `steps` harder on its ladder. */
	var transferReps = (reps, steps) => reps * Math.pow(.7, Math.max(0, steps));
	/** How many sets a day total was probably done in. */
	function estimateSets(total, unit = "reps") {
		const t = Math.max(0, Math.round(total));
		if (t <= 0) return [];
		const n = unit === "sec" ? t > 180 ? 4 : 3 : Math.max(3, Math.min(6, Math.ceil(t / 25)));
		const base = Math.floor(t / n);
		const extra = t - base * n;
		return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
	}
	/** A day total that came from the Telegram import: it is never evidence for a level. */
	var isImported = (imp, day, exId) => !!imp?.[day]?.includes(exId);
	/** Per day, the entries of one family: real sets, else an estimate from the day total. */
	function dayEntries(input, family, until) {
		const out = /* @__PURE__ */ new Map();
		const exs = input.exercises.map((ex) => ({
			ex,
			move: moveOf(ex)
		})).filter((x) => x.move && x.move.family === family);
		const dayKeys = /* @__PURE__ */ new Set([...Object.keys(input.days ?? {}), ...Object.keys(input.sets ?? {})]);
		for (const day of dayKeys) {
			if (day > (until ?? input.today)) continue;
			for (const { ex, move } of exs) {
				const real = setsOn(input.sets, day, String(ex.id)).map((s) => s.reps);
				let entry = null;
				if (real.length) entry = {
					move,
					reps: real,
					est: false
				};
				else {
					const total = isImported(input.imported, day, String(ex.id)) ? 0 : Number(input.days?.[day]?.[String(ex.id)]) || 0;
					if (total > 0) entry = {
						move,
						reps: estimateSets(total, move.unit),
						est: true
					};
				}
				if (entry) (out.get(day) ?? out.set(day, []).get(day)).push(entry);
			}
		}
		const b = input.best?.[family];
		const bm = b && moveById(b.move);
		if (b && bm && b.reps > 0 && b.day <= (until ?? input.today)) {
			const w = Math.max(1, Math.round(b.reps * WORKING_OF_MAX));
			const mk = () => ({
				move: bm,
				reps: [
					w,
					w,
					w
				],
				est: true,
				transfer: true
			});
			for (const d of [b.day, shiftDay(b.day, -1)]) (out.get(d) ?? out.set(d, []).get(d)).push(mk());
		}
		return out;
	}
	/** How many sets of this entry count towards a level: the move at least as hard, 70% of the reps for a harder move. */
	function setsMeeting(entries, lv) {
		const lm = moveById(lv.move);
		if (!lm) return 0;
		const li = stepIdx(lm);
		let n = 0;
		for (const e of entries) {
			const hard = stepIdx(e.move);
			if (hard < li) {
				if (e.transfer) n += e.reps.filter((r) => transferReps(r, li - hard) >= lv.reps).length;
				continue;
			}
			const need = hard > li ? Math.ceil(lv.reps * .7) : lv.reps;
			n += e.reps.filter((r) => r >= need).length;
		}
		return n;
	}
	/** The highest level a day's entries reach (0: none). */
	function levelOfDay(track, entries) {
		for (let i = track.levels.length - 1; i >= 0; i--) if (setsMeeting(entries, track.levels[i]) >= track.levels[i].sets) return i + 1;
		return 0;
	}
	/** The day's level with the part of the way to the next one ("6.4"). */
	function valueOfDay(track, entries) {
		const L = levelOfDay(track, entries);
		const top = Math.max(0, ...entries.flatMap((e) => e.reps));
		if (L >= track.levels.length) return L;
		const cur = L ? track.levels[L - 1] : null;
		const next = track.levels[L];
		const nm = moveById(next.move);
		const best = Math.max(0, ...entries.filter((e) => stepIdx(e.move) >= stepIdx(nm)).flatMap((e) => e.reps), ...entries.flatMap((e) => e.reps).map((r) => r * .7));
		const lo = cur && cur.move === next.move ? cur.reps : 0;
		return L + Math.max(0, Math.min(.95, (Math.min(best, top) - lo) / Math.max(1, next.reps - lo)));
	}
	var dayDiff = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
	var COMEBACK_DAYS = 10;
	function core(input, track, until) {
		const rows = [...dayEntries(input, track.family, until).entries()].map(([day, es]) => ({
			day,
			es,
			level: levelOfDay(track, es),
			value: valueOfDay(track, es)
		})).sort((a, b) => a.day.localeCompare(b.day));
		const lastDay = rows.length ? rows[rows.length - 1].day : null;
		const of = track.levels.length;
		const base = {
			family: track.family,
			track,
			of,
			active30: 0,
			daysLogged: rows.length,
			trend: "new",
			lastDay,
			frac: 0,
			estimated: false
		};
		if (!rows.length) return {
			...base,
			level: 0,
			lv: null,
			next: track.levels[0],
			best: null,
			solid: 0
		};
		const win = (n) => rows.filter((r) => dayDiff(r.day, until) <= n);
		const w60 = win(60);
		const w45 = win(45);
		const pool = w60.length ? w60 : rows.slice(-1);
		let bestRow = pool[0];
		for (const r of pool) if (r.level > bestRow.level || r.level === bestRow.level && r.day > bestRow.day) bestRow = r;
		let solid = 0;
		for (let L = of; L >= 1; L--) if (w45.filter((r) => r.level >= L).length >= 2) {
			solid = L;
			break;
		}
		let level = pool.length <= 2 ? bestRow.level : Math.max(solid, Math.min(bestRow.level, solid + 1));
		const w21 = win(21);
		if (w21.length >= 2) {
			const recentMax = Math.max(...w21.map((r) => r.level));
			if (recentMax < level - 1) level = recentMax + 1;
		}
		level = Math.max(1, Math.min(of, level));
		const a = win(14);
		const b = rows.filter((r) => dayDiff(r.day, until) > 14 && dayDiff(r.day, until) <= 28);
		const avg = (l) => l.length ? l.reduce((t, r) => t + r.value, 0) / l.length : null;
		const va = avg(a);
		const vb = avg(b);
		const trend = va == null ? "down" : vb == null ? rows.length < 3 ? "new" : "steady" : va - vb > .3 ? "up" : va - vb < -.3 ? "down" : "steady";
		const top = Math.max(0, ...bestRow.es.flatMap((e) => e.reps));
		const topEntry = bestRow.es.find((e) => e.reps.includes(top));
		const recentBest = Math.max(0, ...win(10).map((r) => r.value));
		const frac = Math.max(0, Math.min(1, recentBest - Math.floor(recentBest))) * (recentBest >= level ? 1 : 0);
		return {
			...base,
			level,
			lv: track.levels[level - 1],
			next: track.levels[level] ?? null,
			best: {
				level: bestRow.level,
				day: bestRow.day,
				top,
				sets: topEntry.reps.length,
				est: bestRow.es.some((e) => e.est)
			},
			solid,
			active30: win(30).length,
			trend,
			frac,
			estimated: bestRow.es.every((e) => e.est)
		};
	}
	/** Where you stand on one family's track. `until` re-places you as you were on that day. */
	function placeFamily(input, family, until) {
		const track = trackOf(family);
		if (!track) return null;
		const day = until ?? input.today;
		const p = core(input, track, day);
		let comeback = null;
		let level = p.level;
		if (p.lastDay && p.level > 0) {
			const off = dayDiff(p.lastDay, day);
			if (off >= 10) {
				comeback = {
					from: p.level,
					hits: 0,
					need: 2,
					daysOff: off
				};
				level = Math.max(1, p.level - (off >= 21 ? 2 : 1));
			} else {
				const entries = [...dayEntries(input, family, day).keys()].sort();
				for (let i = entries.length - 1; i > 0; i--) {
					if (dayDiff(entries[i], day) > 35) break;
					const gap = dayDiff(entries[i - 1], entries[i]);
					if (gap >= 10) {
						const old = core(input, track, entries[i - 1]).level;
						const map = dayEntries(input, family, day);
						const hits = entries.slice(i).filter((d) => levelOfDay(track, map.get(d) ?? []) >= old).length;
						if (hits < 2 && old > 1) {
							comeback = {
								from: old,
								hits,
								need: 2,
								daysOff: gap
							};
							level = Math.min(p.level, Math.max(1, old - (gap >= 21 ? 2 : 1)));
						}
						break;
					}
				}
			}
		}
		const lv = level ? track.levels[level - 1] : null;
		const next = track.levels[level] ?? null;
		const bestTxt = p.best ? `best day ${p.best.sets}×${p.best.top}${p.estimated ? " (from your totals)" : ""}` : "nothing logged yet";
		const steady = p.active30 >= 12 ? "steady" : p.active30 >= 6 ? "regular" : p.active30 ? "on and off" : "quiet lately";
		const trendTxt = p.trend === "up" ? "trending up" : p.trend === "down" ? "a little down lately" : p.trend === "new" ? "just started" : "holding steady";
		const why = !level ? `${track.name}: nothing logged yet. Log one day (like "15 14 12") and your level appears.` : comeback && comeback.hits < comeback.need ? `${track.name}: Comeback level ${level} ${lv.name} after ${comeback.daysOff} days off. Hit Level ${comeback.from} (${track.levels[comeback.from - 1].req}) on ${comeback.need - comeback.hits} more ${comeback.need - comeback.hits === 1 ? "day" : "days"} to get it back.` : `${track.name}: ${bestTxt}, ${p.active30} ${p.active30 === 1 ? "day" : "days"} in 30 (${steady}), ${trendTxt} → Level ${level} ${lv.name}.${next ? ` Next: Level ${next.n} at ${next.req}.` : " You are at the top of this ladder."}`;
		return {
			...p,
			level,
			lv,
			next,
			comeback,
			why
		};
	}
	/** The families you log (from your exercises), with where you stand on each; most advanced first. */
	function placeAll(input, until) {
		const fams = /* @__PURE__ */ new Set();
		for (const ex of input.exercises) {
			const m = moveOf(ex);
			if (m) fams.add(m.family);
		}
		const out = [];
		for (const f of fams) {
			const p = placeFamily(input, f, until);
			if (p && p.level > 0) out.push(p);
		}
		return out.sort((a, b) => b.level / b.of - a.level / a.of);
	}
	/** One family, one point per logged day: best set, level, fractional level and the day's total. */
	function seriesOf(input, family, until) {
		const track = trackOf(family);
		if (!track) return [];
		return [...dayEntries(input, family, until).entries()].map(([day, es]) => ({
			day,
			top: Math.max(0, ...es.flatMap((e) => e.reps)),
			level: levelOfDay(track, es),
			value: valueOfDay(track, es),
			est: es.every((e) => e.est),
			total: es.reduce((t, e) => t + e.reps.reduce((a, b) => a + b, 0), 0)
		})).sort((a, b) => a.day.localeCompare(b.day));
	}
	/** The days a level went up (in the series: the first day each new top level was reached), for the chart marks. */
	function levelChanges(series) {
		const out = [];
		let top = 0;
		for (const p of series) if (p.level > top) {
			if (top > 0) out.push({
				day: p.day,
				level: p.level
			});
			top = p.level;
		}
		return out;
	}
	var RANKS = [
		{
			name: "Recruit",
			from: 0,
			line: "You signed up. Now show up."
		},
		{
			name: "Trainee",
			from: 10,
			line: "The habit is forming and the base is real."
		},
		{
			name: "Fighter",
			from: 25,
			line: "You are strong in more than one area."
		},
		{
			name: "Warrior",
			from: 45,
			line: "Strong all over: push, pull, core and legs."
		},
		{
			name: "Elite",
			from: 65,
			line: "Advanced moves and the discipline to match."
		},
		{
			name: "Legend",
			from: 85,
			line: "The top of the ladders. Few ever get here."
		}
	];
	/** Your strength rank from every group: the average of your best track per muscle group (0 for a group you do not train). */
	function overallRank(places) {
		const by = {
			push: 0,
			pull: 0,
			core: 0,
			legs: 0
		};
		const bestFam = {};
		for (const p of places) {
			const mu = muscleOf(p.track.group);
			if (!mu) continue;
			const pct = (p.level - 1 + p.frac) / p.of * 100;
			if (pct > by[mu]) {
				by[mu] = pct;
				bestFam[mu] = p;
			}
		}
		const score = Math.round((by.push + by.pull + by.core + by.legs) / 4);
		let index = 0;
		RANKS.forEach((r, i) => {
			if (score >= r.from) index = i;
		});
		const next = RANKS[index + 1] ?? null;
		const weakest = Object.keys(by).sort((a, b) => by[a] - by[b])[0];
		const names = {
			push: "pushing",
			pull: "pulling",
			core: "core",
			legs: "legs"
		};
		const wp = bestFam[weakest];
		const hint = !next ? "You are at the top. Keep it up." : wp?.next ? `Fastest way up: ${names[weakest]}. Reach Level ${wp.next.n} (${wp.next.req}).` : by[weakest] === 0 ? `Fastest way up: start training your ${names[weakest]}.` : `Fastest way up: raise your ${names[weakest]}.`;
		return {
			score,
			rank: RANKS[index],
			index,
			next,
			need: next ? Math.max(0, next.from - score) : 0,
			by,
			hint
		};
	}
	function compareThen(input, days = 30) {
		const out = [];
		const before = shiftDay(input.today, -days);
		const stat = (family, from, to) => {
			const s = seriesOf(input, family, to).filter((p) => p.day >= from);
			return {
				best: Math.max(0, ...s.map((p) => p.top)),
				total: s.reduce((t, p) => t + p.total, 0)
			};
		};
		for (const p of placeAll(input)) {
			const old = placeFamily(input, p.family, before);
			const a = old && old.level > 0 ? {
				level: old.level,
				...stat(p.family, shiftDay(before, -30), before)
			} : null;
			const b = {
				level: p.level,
				...stat(p.family, shiftDay(input.today, -30), input.today)
			};
			const line = a ? `Level ${a.level} → ${b.level}${b.level > a.level ? " (up!)" : b.level === a.level ? " (same)" : " (down a bit)"} · best set ${a.best} → ${b.best}` : `New since then: Level ${b.level}, best set ${b.best}`;
			out.push({
				family: p.family,
				name: p.track.name,
				then: a,
				now: b,
				line
			});
		}
		return out;
	}
	/** Fun titles for real feats: first 50 in one set, 100 squats club, Pistol unlocked… (no points). */
	function milestones(input) {
		const out = [];
		const famsOf = (f) => seriesOf(input, f);
		const firstWhere = (s, pred) => s.find(pred)?.day ?? null;
		const add = (id, title, line, day, progress) => out.push({
			id,
			title,
			line,
			day,
			...day || !progress ? {} : { progress }
		});
		const push = famsOf("pushup");
		const squat = famsOf("squat");
		const bestOf = (s) => Math.max(0, ...s.map((p) => p.top));
		for (const n of [
			10,
			25,
			50
		]) add(`pu${n}`, n === 50 ? "First 50 in one set" : `First ${n} push-ups in one set`, "Push-ups, all in a row, no stopping.", firstWhere(push.filter((p) => !p.est), (p) => p.top >= n), `best ${bestOf(push.filter((p) => !p.est))} of ${n}`);
		add("sq100", "100 squats club", "A hundred squats in one day.", firstWhere(squat, (p) => p.total >= 100), `best day ${Math.max(0, ...squat.map((p) => p.total))} of 100`);
		add("pu100", "100 push-ups day", "A hundred push-ups in one day.", firstWhere(push, (p) => p.total >= 100), `best day ${Math.max(0, ...push.map((p) => p.total))} of 100`);
		const plank = famsOf("plank").filter((p) => p.top > 0);
		add("plank60", "The minute hold", "Hold a plank for a full minute.", firstWhere(plank, (p) => p.top >= 60), `best ${bestOf(plank)} of 60 s`);
		const logged = /* @__PURE__ */ new Map();
		for (const ex of input.exercises) {
			const m = moveOf(ex);
			if (!m || m.diff < 4) continue;
			const days = [.../* @__PURE__ */ new Set([...Object.keys(input.days ?? {}).filter((d) => Number(input.days?.[d]?.[String(ex.id)]) > 0), ...Object.keys(input.sets ?? {}).filter((d) => setsOn(input.sets, d, String(ex.id)).length)])].sort();
			if (days.length && (!logged.has(m.id) || logged.get(m.id) > days[0])) logged.set(m.id, days[0]);
		}
		for (const [id, day] of logged) {
			const m = moveById(id);
			add(`un_${id}`, m.id === "pistol_squat" ? "Pistol unlocked" : `${m.name.replace(/ \(.*\)/, "")} unlocked`, "A hard move most people never try.", day);
		}
		if (!logged.has("pistol_squat")) add("un_pistol_squat", "Pistol unlocked", "Your first pistol squat.", null, "on the squat ladder");
		let total = 0;
		let day1k = null;
		let day10k = null;
		for (const d of Object.keys(input.days ?? {}).sort()) {
			for (const [id, v] of Object.entries(input.days?.[d] ?? {})) {
				const ex = input.exercises.find((e) => String(e.id) === id);
				if (ex && (moveOf(ex)?.unit ?? ex.unit) === "sec") continue;
				total += Number(v) || 0;
			}
			if (!day1k && total >= 1e3) day1k = d;
			if (!day10k && total >= 1e4) day10k = d;
		}
		add("reps1k", "1,000 reps club", "A thousand reps, one by one.", day1k, `${total} of 1,000`);
		add("reps10k", "10,000 reps club", "Ten thousand reps. Real dedication.", day10k, `${total} of 10,000`);
		return out;
	}
	// src/core/sportCoach.ts
	/** One exercise's sessions up to `until`, oldest first: real sets, else an estimate from the day total. */
	function sessionsFor(input, ex, until) {
		const move = moveOf(ex);
		const keys = /* @__PURE__ */ new Set([...Object.keys(input.days ?? {}), ...Object.keys(input.sets ?? {})]);
		const out = [];
		for (const day of [...keys].sort()) {
			if (day > until) continue;
			const real = setsOn(input.sets, day, String(ex.id)).map((s) => s.reps);
			if (real.length) out.push({
				day,
				reps: real,
				est: false
			});
			else {
				const t = isImported(input.imported, day, String(ex.id)) ? 0 : Number(input.days?.[day]?.[String(ex.id)]) || 0;
				if (t > 0) out.push({
					day,
					reps: estimateSets(t, move?.unit ?? (ex.unit === "sec" ? "sec" : "reps")),
					est: true
				});
			}
		}
		return out;
	}
	var clamp$3 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	var u$2 = (unit) => unit === "sec" ? " s" : "";
	var NEED_TOP = 2;
	var TIPS = {
		pushup: "Keep one straight line from head to heels, and lower your chest to a fist above the floor.",
		squat: "Push your knees out over your toes and keep your heels on the floor.",
		core: "Exhale as you curl up, and never pull on your neck.",
		plank: "Squeeze your glutes and tuck the ribs in: a short, tight plank beats a long sagging one.",
		row: "Pull your elbows back and squeeze your shoulder blades together at the top.",
		lunge: "Take a big step and keep your front knee over your ankle, your chest tall.",
		bridge: "Push through your heels and squeeze your glutes hard at the top for a second.",
		calf: "Pause one second at the top and lower slowly, all the way down.",
		dips: "Keep your back close to the chair and your elbows pointing straight back.",
		pike: "Make an upside-down V and lower the top of your head between your hands.",
		back: "Lift with your back, not your neck: look at the floor and move slowly.",
		burpee: "Land softly and keep your core tight when you drop to the floor."
	};
	/** A one-line form tip for a move: its family tip, else the common mistake. */
	function formTip(move) {
		return TIPS[move.family] ?? `Watch out: ${move.mistake.replace(/^./, (c) => c.toLowerCase())}`;
	}
	var workingSets = (s, n) => s.reps.slice(0, n);
	var atTop = (s, sets, hi) => s.reps.length >= sets && workingSets(s, sets).every((r) => r >= hi);
	var missed = (s, lo) => Math.max(...s.reps) < lo;
	function aimAfter(list, o) {
		const last = list[list.length - 1];
		if (!last) return o.start;
		const min = Math.min(...workingSets(last, o.sets));
		const eff = o.efforts?.[last.day];
		const base = o.unit === "sec" ? 5 : 1;
		const step = eff === "hard" ? 0 : eff === "easy" ? base * 2 : base;
		return clamp$3(o.deload ? min : min + step, o.lo, o.hi + (atTop(last, o.sets, o.hi) ? step : 0));
	}
	/** Where an exercise stands and what to aim for. Null for exercises that are not library moves. */
	function coachFor(input) {
		const ex = input.exercises.find((e) => String(e.id) === String(input.exId));
		const move = ex && moveOf(ex);
		if (!ex || !move) return null;
		const unit = move.unit;
		const track = trackOf(move.family);
		const place = placeFamily(input, move.family);
		const onMove = track ? track.levels.filter((l) => l.move === move.id) : [];
		const fallback = rangeFor(move);
		const strong = !!input.strength && move.unit === "reps";
		const lo = strong ? 5 : onMove[0]?.reps ?? fallback.lo;
		const hi = strong ? 8 : onMove.length ? onMove[onMove.length - 1].reps : fallback.hi;
		const mine = onMove.filter((l) => place && l.n <= place.level).pop() ?? onMove[0];
		const ov = input.override && input.override.day === input.today ? input.override : null;
		const sets = ov?.sets ? clamp$3(ov.sets, 1, 6) : clamp$3((strong ? input.deload ? 3 : 4 : input.deload ? (mine?.sets ?? 3) - 1 : mine?.sets ?? 3) || 3, 1, 5);
		const all = sessionsFor(input, ex, input.today);
		const past = all.filter((s) => s.day < input.today);
		const todays = all.find((s) => s.day === input.today) ?? null;
		const last = past[past.length - 1] ?? null;
		const o = {
			lo,
			hi,
			sets,
			unit,
			start: place && place.lv && place.lv.move === move.id ? place.lv.reps : clamp$3(Math.round((Number(ex.target) || lo * 3) / 3), lo, hi),
			deload: !!input.deload,
			efforts: input.efforts
		};
		let goal = ov ? Math.max(1, ov.goal) : aimAfter(past, o);
		const nextGoal = aimAfter(todays ? [...past, todays] : past, o);
		const recent = todays && todays.reps.length >= sets ? [...past, todays] : past;
		let status = last ? "building" : "new";
		let line = "";
		let ready = null;
		let stepBack = null;
		let tip = null;
		const topSets = strong ? 3 : sets;
		const needTop = strong ? 1 : 2;
		let run = 0;
		for (let i = recent.length - 1; i >= 0 && atTop(recent[i], topSets, hi); i--) run++;
		const lastTop = recent[recent.length - 1];
		if (!strong && run === 1 && lastTop && atTop(lastTop, topSets, hi) && input.efforts?.[lastTop.day] === "easy") run = 2;
		const harder = nextStep(move);
		const back = harder && input.notYet?.[harder.id];
		if (run >= needTop) {
			if (harder && !(back && back > input.today)) {
				ready = {
					to: harder,
					sets: 1,
					reps: (track?.levels.find((l) => l.move === harder.id))?.reps ?? harder.set,
					why: strong ? `${topSets}×${hi} reached` : run === 1 ? `${sets}×${hi}${u$2(unit)} and it felt easy` : `${sets}×${hi}${u$2(unit)} 2 sessions in a row`
				};
				status = "ready";
				tip = formTip(harder);
				line = `Ready for ${harder.name}? Try 1 set of ${ready.reps}${u$2(harder.unit)}. You did ${ready.why}.`;
			} else if (!harder) {
				status = "top";
				line = "Top of this ladder. Add a 4th set, or lower slowly (3 seconds down).";
			}
		}
		const lastTwo = recent.slice(-2);
		if (status !== "ready" && lastTwo.length === 2 && lastTwo.every((s) => missed(s, lo))) {
			const easier = prevStep(move);
			status = "stuck";
			goal = lo;
			stepBack = {
				to: easier,
				text: easier ? `Two tough sessions in a row is information, not failure. Smart training: go back to ${easier.name} for a week, or do ${sets}×${lo}${u$2(unit)} with 2–3 min rest.` : `Two tough sessions in a row is information, not failure. Smart training: do ${sets}×${lo}${u$2(unit)} with 2–3 min rest and sleep well.`
			};
			tip = formTip(move);
			line = stepBack.text;
		}
		if (status === "building" && place?.comeback && place.comeback.hits < place.comeback.need && last) {
			status = "comeback";
			const lastMin = Math.min(...workingSets(last, sets));
			goal = clamp$3(Math.round(lastMin * .75), lo, hi);
			const n = place.comeback.need - place.comeback.hits;
			line = `Welcome back. Start at ${sets}×${goal}${u$2(unit)} (a bit under your best) and build fast: hit your old level ${n} more ${n === 1 ? "time" : "times"}.`;
		}
		if (input.deload && status !== "ready" && status !== "stuck") {
			status = "deload";
			line = `Easy week: ${sets}×${goal}${u$2(unit)}, stop 3 reps before it gets hard. You grow while you recover.`;
		}
		if (status === "new") line = `First time: aim for ${sets}×${goal}${u$2(unit)} and stop 1–2 reps before you can't do another.`;
		if (status === "building") line = `Beat last time: ${sets}×${goal}${u$2(unit)}${last.est ? "" : ` (last: ${last.reps.join(" · ")})`}.`;
		const chips = (last ? last.reps.slice(0, Math.max(sets, 1)) : Array.from({ length: sets }, () => goal)).slice(0, 6);
		return {
			exId: String(ex.id),
			move,
			place,
			sets,
			goal,
			lo,
			hi,
			unit,
			label: `${sets}×${goal}${u$2(unit)}`,
			last,
			today: todays?.reps ?? [],
			next: {
				sets,
				goal: nextGoal,
				label: `${sets}×${nextGoal}${u$2(unit)}`
			},
			status,
			line,
			chips: chips.length ? chips : [goal],
			hits: run,
			ready,
			stepBack,
			tip
		};
	}
	/** One honest line right after you log. `input` already holds the sets just logged. */
	function feedbackFor(input) {
		const c = coachFor(input);
		if (!c || !c.today.length) return null;
		const unit = u$2(c.unit);
		const sum = (r) => r.reduce((a, b) => a + b, 0);
		const nextTxt = `Next: ${c.next.label}`;
		const mk = (tone, text, tip = null) => ({
			tone,
			text,
			next: nextTxt,
			tip
		});
		if (!c.last) return mk("first", `First log saved: this sets your level. Next time aim for ${c.next.label}.`);
		const t = sum(c.today);
		const l = sum(c.last.reps.slice(0, c.today.length));
		const diff = t - l;
		const left = c.sets - c.today.length;
		const more = left > 0 ? ` ${left} more ${left === 1 ? "set" : "sets"} to match the plan.` : "";
		const top = atTop({
			day: input.today,
			reps: c.today,
			est: false
		}, c.sets, c.hi);
		if (top && c.ready) return mk("top", `Hit the top of the range! ${c.ready.why}. Ready for ${c.ready.to.name}: try 1 set of ${c.ready.reps}${u$2(c.ready.to.unit)} next time.`, c.tip);
		if (top) return mk("top", `Hit the top of the range. Next time try ${c.sets}×${c.hi + (c.unit === "sec" ? 5 : 1)}${unit}.`);
		if (c.status === "stuck") return mk("ease", c.stepBack?.text ?? "A tougher day. Rest well.", c.tip);
		if (c.today.length >= c.sets && l > 0 && t >= l * 1.25) return mk("easy", `Easier than usual (${diff} more than last time): add a set next time, ${c.sets + 1}×${Math.min(...c.today)}${unit}.`);
		if (diff > 0) return mk("good", `Good, ${diff} more than last time.${more}`);
		if (diff === 0) return mk("same", `Same as last time: steady wins. Try ${c.next.goal}${unit} on your last set.${more}`);
		return mk("ease", `${-diff} fewer than last time. That happens: rest 2 minutes between sets and sleep well.${more}`);
	}
	var STARTERS = {
		legs: "squat",
		pull: "door_row",
		core: "plank",
		push: "pushup"
	};
	var ORDER = [
		"legs",
		"pull",
		"core",
		"push"
	];
	/** A muscle group with no exercise in your routine and no logs for 14 days: "Your legs have no training: add Squats?" */
	function missingGroups(input) {
		const covered = /* @__PURE__ */ new Set();
		for (const ex of input.exercises.filter((e) => e.active !== false)) {
			const mu = muscleOf(moveOf(ex)?.group);
			if (mu) covered.add(mu);
		}
		const from = (/* @__PURE__ */ new Date(Date.parse(input.today + "T12:00:00Z") - 11232e5)).toISOString().slice(0, 10);
		const recent = /* @__PURE__ */ new Set();
		for (const ex of input.exercises) {
			const mu = muscleOf(moveOf(ex)?.group);
			if (!mu) continue;
			for (const d of Object.keys(input.days ?? {})) if (d >= from && d <= input.today && Number(input.days?.[d]?.[String(ex.id)]) > 0) recent.add(mu);
		}
		const names = {
			legs: "legs",
			pull: "back and pulling muscles",
			core: "core",
			push: "chest and shoulders"
		};
		return ORDER.filter((m) => !covered.has(m) && !recent.has(m)).map((m) => {
			const mv = moveById(STARTERS[m]);
			return {
				muscle: m,
				move: mv,
				text: `Your ${names[m]} have no training: add ${mv.name}?`
			};
		}).filter((x) => !((input.notYet ?? {})["miss_" + x.muscle] > input.today));
	}
	// src/core/sportForecast.ts
	var dayNum = (d) => Math.round(Date.parse(d + "T12:00:00Z") / 864e5);
	/** Least-squares slope (per day) and the fitted value at `at`; null with fewer than 3 points or under a week of spread. */
	function trendLine(points, at) {
		if (points.length < 3) return null;
		const xs = points.map((p) => dayNum(p.day));
		if (Math.max(...xs) - Math.min(...xs) < 7) return null;
		const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
		const my = points.reduce((a, p) => a + p.v, 0) / points.length;
		let num = 0;
		let den = 0;
		points.forEach((p, i) => {
			num += (xs[i] - mx) * (p.v - my);
			den += (xs[i] - mx) ** 2;
		});
		if (!den) return null;
		const slope = num / den;
		return {
			slope,
			now: my + slope * (dayNum(at) - mx)
		};
	}
	/** Days until the next levels at your recent pace (last 28 days), per family. */
	function forecasts(input) {
		const out = [];
		for (const p of placeAll(input)) {
			if (!p.next) continue;
			const from = shiftDay(input.today, -28);
			const t = trendLine(seriesOf(input, p.family).filter((s) => s.day >= from).map((s) => ({
				day: s.day,
				v: s.value
			})), input.today);
			const steps = [p.next, p.track.levels[p.level + 1]].filter(Boolean).map((lv) => {
				let days = null;
				if (t && t.slope > .004) {
					const cur = Math.max(t.now, p.level + p.frac);
					days = Math.max(1, Math.round((lv.n - cur) / t.slope));
					if (days > 365) days = null;
				}
				return {
					level: lv.n,
					name: lv.name,
					req: lv.req,
					days
				};
			});
			const s0 = steps[0];
			const text = s0.days == null ? `${p.track.name}: keep logging. A few more sessions and I can forecast Level ${s0.level}.` : s0.days <= 2 ? `${p.track.name}: Level ${s0.level} is any day now.` : s0.days > 120 ? `${p.track.name}: Level ${s0.level} in a few months at this pace.` : `${p.track.name}: Level ${s0.level} in about ${s0.days} days.`;
			out.push({
				family: p.family,
				name: p.track.name,
				level: p.level,
				steps,
				text
			});
		}
		return out;
	}
	/** Pace to a goal "50 push-ups in one set by Dec 31": on pace, ahead or behind, and what to do today. */
	function goalPace(input, goal) {
		const ex = input.exercises.find((e) => String(e.id) === String(goal.exId));
		if (!ex) return null;
		const name = ex.name;
		const tops = sessionsFor(input, ex, input.today).map((s) => ({
			day: s.day,
			top: Math.max(...s.reps)
		}));
		const best = Math.max(0, ...tops.map((t) => t.top));
		const daysLeft = dayNum(goal.by) - dayNum(input.today);
		const unit = moveOf(ex)?.unit === "sec" || ex.unit === "sec" ? " s" : "";
		const base = {
			goal,
			name,
			best,
			daysLeft
		};
		if (best >= goal.reps) return {
			...base,
			status: "done",
			needPerWeek: 0,
			pacePerWeek: 0,
			eta: null,
			today: "Goal reached. Set a bigger one!",
			text: `Done! ${best}${unit} in one set. Goal was ${goal.reps}${unit}.`
		};
		const from = shiftDay(input.today, -28);
		const t = trendLine(tops.filter((x) => x.day >= from).map((x) => ({
			day: x.day,
			v: x.top
		})), input.today);
		const rate = t ? Math.max(0, t.slope) : 0;
		const left = goal.reps - best;
		const need = daysLeft > 0 ? left / daysLeft : left;
		const eta = rate > .01 ? shiftDay(input.today, Math.ceil(left / rate)) : null;
		const todayTxt = `Push one set to ${Math.min(goal.reps, best + Math.max(1, Math.ceil(need * 3)))}${unit} today (your best is ${best}${unit}).`;
		const needW = Math.round(need * 7 * 10) / 10;
		const paceW = Math.round(rate * 7 * 10) / 10;
		let status;
		if (daysLeft < 0) status = "late";
		else if (!t) status = "start";
		else if (rate >= need * 1.15) status = "ahead";
		else if (rate >= need * .85) status = "on";
		else status = "behind";
		const text = status === "late" ? `The date passed and you are at ${best}${unit}. Move the date, or keep going.` : status === "start" ? `You need about +${needW}${unit} a week. Log a few sessions and I will check your pace.` : status === "ahead" ? `Ahead of pace: +${paceW}${unit} a week, you need +${needW}${unit}.` : status === "on" ? `On pace: +${paceW}${unit} a week, you need +${needW}${unit}.` : `A bit behind: +${paceW}${unit} a week, you need +${needW}${unit}. Add a session or a set.`;
		return {
			...base,
			status,
			needPerWeek: needW,
			pacePerWeek: paceW,
			eta,
			today: todayTxt,
			text
		};
	}
	/** The week to tell about: on Sunday, this week; otherwise the last full week (Mon–Sun). */
	function storyWeek(today) {
		const sunday = (/* @__PURE__ */ new Date(today + "T12:00:00Z")).getUTCDay() === 0;
		const mon = sunday ? mondayOf(today) : shiftDay(mondayOf(today), -7);
		return {
			from: mon,
			to: shiftDay(mon, 6),
			label: sunday ? "This week" : "Last week"
		};
	}
	function weeklyStory(input, missing = []) {
		const w = storyWeek(input.today);
		const prevFrom = shiftDay(w.from, -7);
		const sumDay = (a, b) => {
			let t = 0;
			const active = /* @__PURE__ */ new Set();
			for (const [d, m] of Object.entries(input.days ?? {})) {
				if (d < a || d > b) continue;
				for (const [id, v] of Object.entries(m ?? {})) {
					const ex = input.exercises.find((e) => String(e.id) === id);
					if ((Number(v) || 0) > 0) active.add(d);
					if (ex && (moveOf(ex)?.unit ?? ex.unit) === "sec") continue;
					t += Number(v) || 0;
				}
			}
			return {
				t,
				active
			};
		};
		const cur = sumDay(w.from, w.to);
		const before = sumDay(prevFrom, shiftDay(w.from, -1));
		const gains = [];
		for (const ex of input.exercises) {
			const ss = sessionsFor(input, ex, w.to);
			const inWeek = ss.filter((s) => s.day >= w.from);
			if (!inWeek.length) continue;
			const earlier = ss.filter((s) => s.day < w.from);
			const prevBest = earlier.length ? Math.max(...earlier.map((s) => Math.max(...s.reps))) : Math.max(...inWeek[0].reps);
			const nowBest = Math.max(...inWeek.map((s) => Math.max(...s.reps)));
			if (prevBest && nowBest > prevBest) gains.push({
				name: ex.name,
				from: prevBest,
				to: nowBest,
				unit: moveOf(ex)?.unit ?? "reps"
			});
		}
		const levelUps = [];
		for (const p of placeAll({
			...input,
			today: w.to
		}, w.to)) {
			const old = placeFamily(input, p.family, shiftDay(w.from, -1));
			if (old && old.level > 0 && p.level > old.level) levelUps.push({
				name: p.track.name,
				from: old.level,
				to: p.level,
				levelName: p.lv.name
			});
		}
		const parts = [
			...gains.slice(0, 2).map((g) => `+${g.to - g.from} ${g.unit === "sec" ? "s" : "reps"} on ${g.name.toLowerCase()}`),
			...levelUps.slice(0, 2).map((l) => `Level up on ${l.name.toLowerCase()}`),
			`${cur.active.size} ${cur.active.size === 1 ? "session" : "sessions"}`
		];
		const any = cur.active.size > 0;
		const focus = missing.length ? `Next week: ${missing[0].replace(/\?$/, "")}.` : !any ? "Next week: start small. One short session on a day you choose." : cur.active.size < 3 ? "Next week: aim for one more session than this week." : gains.length ? "Next week: keep the same rhythm and beat last week by 1 rep per set." : "Next week: pick one exercise and add 1 rep to every set.";
		return {
			from: w.from,
			to: w.to,
			sessions: cur.active.size,
			totalReps: cur.t,
			vsBefore: before.t > 0 ? Math.round((cur.t / before.t - 1) * 100) : null,
			gains,
			levelUps,
			headline: `${w.label}: ${parts.join(", ")}`,
			focus,
			any
		};
	}
	/** All your bests with their dates: the best set and the best day of every exercise you have logged. */
	function recordsWall(input) {
		const out = [];
		for (const ex of input.exercises) {
			const mv = moveOf(ex);
			const ss = sessionsFor(input, ex, input.today);
			if (!ss.length) continue;
			let bs = {
				v: 0,
				d: "",
				est: false
			};
			let bd = {
				v: 0,
				d: ""
			};
			for (const s of ss) {
				const top = Math.max(...s.reps);
				const tot = s.reps.reduce((a, b) => a + b, 0);
				if (top > bs.v || top === bs.v && bs.est && !s.est) bs = {
					v: top,
					d: s.day,
					est: s.est
				};
				if (tot > bd.v) bd = {
					v: tot,
					d: s.day
				};
			}
			out.push({
				exId: String(ex.id),
				name: ex.name,
				moveId: mv?.id ?? "",
				bestSet: bs.v,
				bestSetDay: bs.d,
				est: bs.est,
				bestDay: bd.v,
				bestDayDay: bd.d,
				unit: mv?.unit ?? (ex.unit === "sec" ? "sec" : "reps"),
				fresh: bs.d >= shiftDay(input.today, -6) || bd.d >= shiftDay(input.today, -6)
			});
		}
		return out.sort((a, b) => b.bestSetDay > a.bestSetDay ? 1 : -1);
	}
	// src/core/sportPrograms.ts
	var S = (family, sets = 3, reps = 10, rest = 75) => ({
		family,
		sets,
		reps,
		rest
	});
	var PROGRAMS = [
		{
			id: "fullbody3",
			name: "Beginner full body, 3× a week",
			tagline: "Mon · Wed · Fri, about 30 minutes. Two workouts that take turns, so every muscle gets 3 hard days a week.",
			perWeek: 3,
			minutes: 30,
			days: [
				0,
				2,
				4
			],
			rotation: ["a", "b"],
			sessions: [{
				id: "a",
				name: "Workout A",
				slots: [
					S("squat", 3, 12),
					S("pushup", 3, 8),
					S("row", 3, 8),
					S("plank", 3, 30, 60),
					S("bridge", 3, 12)
				]
			}, {
				id: "b",
				name: "Workout B",
				slots: [
					S("lunge", 3, 10),
					S("pike", 3, 6),
					S("back", 3, 10),
					S("core", 3, 12, 60),
					S("calf", 3, 15, 45)
				]
			}]
		},
		{
			id: "ppl4",
			name: "Push / Pull / Legs, 4× a week",
			tagline: "Mon push · Tue pull · Thu legs · Fri upper + core, about 40 minutes. For when 3 days feels easy.",
			perWeek: 4,
			minutes: 40,
			days: [
				0,
				1,
				3,
				4
			],
			rotation: [
				"push",
				"pull",
				"legs",
				"upper"
			],
			sessions: [
				{
					id: "push",
					name: "Push day",
					slots: [
						S("pushup", 4, 10),
						S("pike", 3, 8),
						S("dips", 3, 10),
						S("plank", 3, 30, 60)
					]
				},
				{
					id: "pull",
					name: "Pull day",
					slots: [
						S("row", 4, 10),
						S("back", 3, 12),
						S("core", 3, 12, 60),
						S("dips", 2, 8)
					]
				},
				{
					id: "legs",
					name: "Legs day",
					slots: [
						S("squat", 4, 15),
						S("lunge", 3, 12),
						S("bridge", 3, 15),
						S("calf", 3, 20, 45)
					]
				},
				{
					id: "upper",
					name: "Upper + core day",
					slots: [
						S("pushup", 3, 10),
						S("row", 3, 10),
						S("pike", 2, 8),
						S("core", 3, 12, 60),
						S("plank", 2, 30, 60)
					]
				}
			]
		},
		{
			id: "core",
			name: "Abs + core finisher",
			tagline: "Every day, 6–8 minutes after your normal workout. Add it on top of any program.",
			perWeek: 7,
			minutes: 8,
			days: [
				0,
				1,
				2,
				3,
				4,
				5,
				6
			],
			rotation: ["finisher"],
			daily: true,
			sessions: [{
				id: "finisher",
				name: "Core finisher",
				slots: [
					S("core", 3, 12, 45),
					S("plank", 3, 30, 45),
					S("deadbug", 2, 10, 45)
				]
			}]
		}
	];
	var programById = (id) => PROGRAMS.find((p) => p.id === id) ?? null;
	/** Which session a program has on a day (null: a rest day for the program). The two-workout rotation continues week by week. */
	function sessionFor(program, day) {
		const dow = ((/* @__PURE__ */ new Date(day + "T12:00:00Z")).getUTCDay() + 6) % 7;
		const i = program.days.indexOf(dow);
		if (i < 0) return null;
		const n = (Math.floor(Date.parse(mondayOf(day) + "T12:00:00Z") / 6048e5) * program.days.length + i) % program.rotation.length;
		return program.sessions.find((s) => s.id === program.rotation[n]) ?? null;
	}
	/** The move for a slot: the one you already do in that family (if on), else your level's move, else a gentle start (level 3). */
	function slotMove(slot, exercises, places) {
		const track = trackOf(slot.family);
		const mine = exercises.filter((e) => e.active !== false).map((e) => moveOf(e)).find((m) => m && m.family === slot.family);
		const place = places.find((p) => p.family === slot.family);
		const lv = place?.lv ?? track?.levels[Math.min(2, (track?.levels.length ?? 1) - 1)] ?? null;
		const move = mine ?? moveById(lv?.move) ?? moveById(FAMILIES[slot.family]?.steps[0]);
		const onMove = track?.levels.filter((l) => l.move === move.id) ?? [];
		const here = onMove.filter((l) => !place || l.n <= place.level).pop() ?? onMove[0];
		return {
			move,
			reps: place?.lv && here ? Math.max(3, here.reps - 2) : slot.reps
		};
	}
	/** The program a state points at: a built-in one, or the one carried in the state. */
	var programOf = (p) => p ? p.custom && p.custom.id === p.id ? p.custom : programById(p.id) : null;
	/**
	* Picks a program. Adds its exercises (new ones are tagged with the program and the sessions they belong to);
	* an exercise of yours that is the same move is shared. With `replace`, your other active exercises are turned
	* off (not deleted) until you stop the program.
	*/
	function applyProgram(exercises, program, places, opts) {
		const list = exercises.map((e) => ({ ...e }));
		const added = [];
		const stamp = opts.today.replace(/-/g, "");
		for (const e of list) if (e.prog && e.prog !== program.id) {
			e.active = false;
			delete e.progSession;
		}
		for (const sess of program.sessions) for (const slot of sess.slots) {
			const { move, reps } = slotMove(slot, list, places);
			let ex = list.find((e) => e.active !== false && !e.prog && moveOf(e)?.id === move.id);
			if (ex) continue;
			ex = list.find((e) => e.prog === program.id && moveOf(e)?.id === move.id);
			if (ex) {
				ex.active = true;
				ex.progSession = [.../* @__PURE__ */ new Set([...ex.progSession ?? [], sess.id])];
				continue;
			}
			ex = {
				id: `ex_p_${program.id}_${move.id}_${stamp}`,
				name: move.name,
				target: slot.sets * reps,
				unit: move.unit,
				active: true,
				doneToday: 0,
				move: move.id,
				prog: program.id,
				progSession: [sess.id]
			};
			list.push(ex);
			added.push(move.name);
		}
		if (opts.replace) {
			for (const e of list) if (!e.prog && e.active !== false) {
				e.active = false;
				e.progOff = true;
			}
		}
		return {
			exercises: list,
			added
		};
	}
	/** Stops the program: its exercises go off (their history stays) and the ones it turned off come back. */
	function stopProgram(exercises) {
		return exercises.map((e) => {
			const x = { ...e };
			if (x.prog) {
				x.active = !!x.homeOwn;
				if (x.homeOwn && x.homeTarget != null) x.target = x.homeTarget;
				delete x.progSession;
				delete x.prog;
				delete x.homeOwn;
				delete x.homeTarget;
			}
			if (x.progOff) {
				x.active = true;
				delete x.progOff;
			}
			return x;
		});
	}
	/**
	* What Today shows: your own active exercises, plus the program's exercises that belong to today's session.
	* Never empty: on a rest day of a program that replaced your routine, your own (turned off) exercises show as an easy option.
	*/
	function todayRoutine(exercises, program, day) {
		const prog = programOf(program);
		const session = prog ? sessionFor(prog, day) : null;
		const mine = exercises.filter((e) => e.active !== false && (!e.prog || prog && e.prog === prog.id && !!session && (e.progSession ?? []).includes(session.id)));
		const extra = prog && prog.daily ? exercises.filter((e) => e.active !== false && e.prog === prog.id && !mine.includes(e)) : [];
		const list = [...mine, ...extra];
		if (list.length) return {
			list,
			restDay: !!prog && !session,
			session
		};
		const off = exercises.filter((e) => e.progOff);
		if (off.length) return {
			list: off,
			restDay: true,
			session
		};
		const any = exercises.filter((e) => !e.plan && !e.prog);
		return {
			list: any.length ? any : exercises.slice(0, 3),
			restDay: !!prog && !session,
			session
		};
	}
	var NAMES$1 = {
		push: "Push",
		pull: "Pull",
		core: "Core",
		legs: "Legs"
	};
	/**
	* Warns when a muscle group is missing from your routine, has no work yet this week (from Thursday on), or is over-trained
	* (more than 20 hard sets in a week, or twice as much as the group you train least).
	*/
	function balanceCheck(input) {
		const out = [];
		const active = input.exercises.filter((e) => e.active !== false);
		const inRoutine = /* @__PURE__ */ new Set();
		for (const e of active) {
			const g = moveOf(e)?.group;
			if (g === "push" || g === "pull" || g === "core" || g === "legs") inRoutine.add(g);
		}
		const mon = mondayOf(input.today);
		const hard = hardSetsByMuscle(input.sets, input.exercises, mon, input.today);
		const dow = ((/* @__PURE__ */ new Date(input.today + "T12:00:00Z")).getUTCDay() + 6) % 7;
		for (const m of MUSCLES) if (!inRoutine.has(m.id)) out.push({
			kind: "missing",
			muscle: m.id,
			text: `No ${NAMES$1[m.id].toLowerCase()} exercise in your routine. Add one so nothing gets left behind.`
		});
		else if (dow >= 3 && hard[m.id] === 0) out.push({
			kind: "under",
			muscle: m.id,
			text: `No ${NAMES$1[m.id].toLowerCase()} work yet this week. A short set today keeps the balance.`
		});
		const trained = MUSCLES.map((m) => hard[m.id]).filter((n) => n > 0);
		const least = trained.length > 1 ? Math.min(...trained) : 0;
		for (const m of MUSCLES) if (hard[m.id] > WEEKLY_SETS.hi || least > 0 && hard[m.id] >= 8 && hard[m.id] >= least * 2.5) out.push({
			kind: "over",
			muscle: m.id,
			text: `${NAMES$1[m.id]} has ${hard[m.id]} hard sets this week${hard[m.id] > WEEKLY_SETS.hi ? ` (over ${WEEKLY_SETS.hi})` : " (much more than the rest)"}. Ease off and give it 48 hours.`
		});
		return out;
	}
	var PLAN = "One easy week: one set less on every move, stop 3 reps before it gets hard, and no record attempts. Then you come back stronger.";
	/**
	* After 4–6 weeks of steady training with progress, suggest one lighter week. `lastDeload` is the Monday of your last easy
	* week; `until` the last day of an easy week that is running now.
	*/
	function deloadAdvice(input) {
		if (input.until && input.until >= input.today) return {
			state: "active",
			weeks: 0,
			text: `Easy week until ${input.until}: lighter sets, same days. Enjoy it.`,
			plan: PLAN
		};
		const weeks = weeklyVolume(input.days, null, input.today, 9).slice(0, -1);
		let run = 0;
		for (let i = weeks.length - 1; i >= 0; i--) {
			const w = weeks[i];
			if (input.lastDeload && w.monday <= input.lastDeload) break;
			if (w.total <= 0) break;
			run++;
		}
		let progress = 0;
		const last = weeks.slice(weeks.length - run);
		last.forEach((w, i) => {
			if (i === 0 || w.total >= last[i - 1].total * .95) progress++;
		});
		if (run >= 6) return {
			state: "overdue",
			weeks: run,
			text: `${run} weeks of training in a row. An easy week now is the smartest move: it keeps you growing.`,
			plan: PLAN
		};
		if (run >= 4 && progress >= 3) return {
			state: "suggest",
			weeks: run,
			text: `${run} weeks of steady progress. Time for one lighter week to recover and keep growing.`,
			plan: PLAN
		};
		return {
			state: "none",
			weeks: run,
			text: run ? `${run} ${run === 1 ? "week" : "weeks"} in a row. An easy week will make sense after 4–6.` : "Train 4 weeks in a row and I will tell you when an easy week makes sense.",
			plan: PLAN
		};
	}
	/** An easy week that starts today and lasts 7 days. */
	function deloadWeek(today) {
		return {
			from: today,
			to: shiftDay(today, 6)
		};
	}
	// src/core/sportBoost.ts
	var u$1 = (m) => m.unit === "sec" ? " s" : "";
	var clamp$2 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	var stepOf = (m) => (FAMILIES[m.family]?.steps ?? []).indexOf(m.id);
	/** "Trainee → Fighter, 8 pts" */
	function rankLine(r) {
		return r.next ? `${r.rank.name} → ${r.next.name}, ${r.need} ${r.need === 1 ? "pt" : "pts"}` : `${r.rank.name}, the top rank`;
	}
	function levelBadge(p, label) {
		const name = p.lv?.name ?? "";
		return {
			level: p.level,
			of: p.of,
			name,
			title: `${label} · Level ${p.level} of ${p.of} · ${name}`,
			frac: p.next ? p.frac : 1,
			nextLine: p.next ? `Next: Level ${p.next.n} ${p.next.name}, ${p.next.req}` : "Top of the ladder"
		};
	}
	/** Slow tempo and pauses: the difficulty you can add when the ladder has no harder step. */
	function tempoAdvice(move) {
		return move.unit === "sec" ? "Add a second hand or foot lift, or hold 10 s longer with a squeeze." : `Lower for 3 seconds, pause 1 second at the bottom, then press up fast. Same ${move.name.toLowerCase()}, much harder.`;
	}
	/**
	* The next harder variation to switch Today to, or null. It fires when the target is above the move's range
	* (more reps would only be endurance), when Strength mode hits 3×8, or when your best set says the move is far too easy.
	* It picks the hardest variation you could still do at the bottom of its range (about 70% of the reps per step).
	*/
	function autoVariation(input) {
		const ex = input.exercises.find((e) => String(e.id) === String(input.exId));
		const move = ex && moveOf(ex);
		if (!ex || !move || move.unit !== "reps") return null;
		const c = coachFor(input);
		if (!c) return null;
		const strength = !!input.strength;
		const lastMin = c.last && !c.last.est ? Math.min(...c.last.reps.slice(0, c.sets)) : 0;
		if (c.last && c.last.reps.length >= 3 && input.efforts?.[c.last.day] === "hard") return null;
		const b = input.best?.[move.family];
		const bm = b && moveById(b.move);
		const bestRef = b && bm && stepOf(bm) <= stepOf(move) ? transferReps(Math.round(b.reps * WORKING_OF_MAX), stepOf(move) - stepOf(bm)) : 0;
		const ref = Math.max(c.goal, lastMin, Math.round(bestRef));
		const over = c.goal > c.hi || lastMin > c.hi || bestRef > c.hi;
		const hitTop = strength && !!c.last && c.last.reps.length >= 3 && c.last.reps.slice(0, 3).every((r) => r >= c.hi);
		if (!over && !hitTop) return null;
		const free = (m) => m && !(input.notYet?.[m.id] && input.notYet[m.id] > input.today) && !input.exercises.some((e) => e.active !== false && e.id !== ex.id && moveOf(e)?.id === m.id);
		const need = strength ? 6 : 8;
		const maxSteps = bestRef > c.hi ? 4 : 2;
		let to = null;
		let steps = 0;
		let m = move;
		for (let k = 1; k <= maxSteps; k++) {
			m = m && nextStep(m);
			if (!m) break;
			if (k > 1 && transferReps(ref, k) < need) break;
			if (free(m)) {
				to = m;
				steps = k;
			}
		}
		if (!to) return null;
		const r = rangeFor(to);
		const eq = transferReps(ref, steps);
		const sets = strength ? 4 : 3;
		const reps = strength ? clamp$2(Math.round(eq * .7), 5, 8) : clamp$2(Math.floor(eq * .8), r.lo, r.hi);
		const was = `${c.sets}×${Math.max(c.goal, lastMin)}`;
		const nxt = nextStep(to);
		return {
			exId: String(ex.id),
			from: move,
			to,
			sets,
			reps,
			text: `Level up: ${to.name} ${sets}×${reps} (your ${was} ${move.name.toLowerCase()} are now your warm-up)`,
			after: nxt ? `${nxt.name} after ${strength ? "3×8" : `${sets}×${r.hi}`}` : "No harder step after this one: slow the tempo",
			tempo: nxt ? null : tempoAdvice(to)
		};
	}
	/** One tap on "Too easy" jumps a level (`taps` ≥ 2 in a week: two); "Too hard" steps one back. */
	function shiftLevel(input, dir, taps = 1) {
		const ex = input.exercises.find((e) => String(e.id) === String(input.exId));
		const move = ex && moveOf(ex);
		const track = move && trackOf(move.family);
		if (!ex || !move || !track) return null;
		const lv = track.levels;
		const first = lv.findIndex((l) => l.move === move.id) + 1;
		let last = 0;
		lv.forEach((l) => {
			if (l.move === move.id) last = l.n;
		});
		const placed = placeFamily(input, move.family)?.level ?? 0;
		const cur = dir === "easy" ? Math.max(placed, first) : last && last < placed ? last : first > placed ? first : placed;
		const n = clamp$2(dir === "easy" ? cur + (taps >= 2 ? 2 : 1) : cur - 1, 1, lv.length);
		if (n === cur && cur > 0) return null;
		const level = lv[n - 1];
		const to = moveById(level.move);
		const strength = !!input.strength && to.unit === "reps";
		const sets = strength ? 4 : level.sets;
		const reps = strength ? clamp$2(level.reps, 5, 8) : level.reps;
		return {
			level,
			to,
			sets,
			reps,
			sameMove: to.id === move.id,
			text: `${dir === "easy" ? taps >= 2 ? "Two levels up" : "Level up" : "One level back"}: Level ${n} ${level.name}, ${sets}×${reps}${u$1(to)} ${to.name.toLowerCase()}.`
		};
	}
	/** Three moves or fewer: a balanced 5–6 move set (push, pull with doorway rows, legs, core, a harder finisher). Empty when the routine is fine. */
	function balancedSet(exercises, strength = false) {
		const active = exercises.filter((e) => e.active !== false);
		if (active.length > 3) return [];
		const have = /* @__PURE__ */ new Set();
		const ids = /* @__PURE__ */ new Set();
		let best = null;
		for (const e of active) {
			const m = moveOf(e);
			if (!m) continue;
			ids.add(m.id);
			const mu = muscleOf(m.group);
			if (mu) have.add(mu);
			if (!best || m.diff > best.diff) best = m;
		}
		const slots = [
			{
				mu: "push",
				id: "pushup",
				why: "Push: chest, shoulders and arms."
			},
			{
				mu: "pull",
				id: "door_row",
				why: "Pull: your back (a towel round a doorknob works)."
			},
			{
				mu: "legs",
				id: "split_squat",
				why: "Legs: one leg at a time is harder than squats."
			},
			{
				mu: "core",
				id: "plank",
				why: "Core: a strong middle holds everything together."
			},
			{
				mu: null,
				id: "hollow_hold",
				why: "A second core move: the hollow hold is tough."
			},
			{
				mu: null,
				id: best && nextStep(best)?.id || "pike_pushup",
				why: `A harder finisher${best && nextStep(best) ? ` (one step past your ${best.name.toLowerCase()})` : ""}.`
			}
		];
		const out = [];
		for (const s of slots) {
			if (s.mu ? have.has(s.mu) : active.length + out.length >= 5) continue;
			const m = moveById(s.id);
			if (!m || ids.has(m.id)) continue;
			const r = rangeFor(m);
			out.push({
				move: m,
				sets: strength ? 4 : r.sets,
				reps: strength && m.unit === "reps" ? 5 : r.lo,
				why: s.why
			});
			ids.add(m.id);
			if (active.length + out.length >= 6) break;
		}
		return out;
	}
	// src/core/dates.ts
	function toUtc(day) {
		const [y, m, d] = day.split("-").map(Number);
		return Date.UTC(y, m - 1, d);
	}
	function addDays(day, n) {
		return new Date(toUtc(day) + n * 864e5).toISOString().slice(0, 10);
	}
	// src/core/benGround.ts
	var pad = (n) => String(n).padStart(2, "0");
	var TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
	var AMPM = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/gi;
	var EVENT = /\b(meetings?|appointments?|interviews?|lectures?|class(?:es)?|seminars?|exams?)\b/gi;
	var PROGRESS = /\b(?:nearly|almost|mostly|half(?:way)?|basically|practically)\s+(?:done|finished|through|complete|there)\b/i;
	var norm = (h, m) => `${pad(h)}:${pad(m)}`;
	/** Every clock time in a text, as "HH:MM" (am/pm turned into 24 h). */
	function timesIn(text) {
		const out = [];
		for (const m of text.matchAll(TIME)) out.push(norm(Number(m[1]), Number(m[2])));
		for (const m of text.matchAll(AMPM)) {
			let h = Number(m[1]) % 12;
			if (/pm/i.test(m[3])) h += 12;
			out.push(norm(h, Number(m[2] ?? 0)));
		}
		return out;
	}
	var stem = (w) => w.toLowerCase().replace(/(ss)es$/, "$1").replace(/([^s])s$/, "$1");
	/** What in one sentence isn't backed by the facts: invented times, events, progress. */
	function ungrounded(sentence, g) {
		const known = /* @__PURE__ */ new Set([...timesIn(g.facts), ...timesIn(g.said)]);
		const t = g.now;
		for (const d of [
			-1,
			0,
			1
		]) {
			const x = new Date(t.getTime() + d * 6e4);
			known.add(norm(x.getHours(), x.getMinutes()));
		}
		const times = timesIn(sentence).filter((x) => !known.has(x));
		const where = `${g.facts}\n${g.said}`.toLowerCase();
		return {
			times,
			events: [...sentence.matchAll(EVENT)].map((m) => m[1]).filter((w) => !where.includes(stem(w))),
			progress: PROGRESS.test(sentence) && !/\b(almost|nearly|half|halfway|most of|mostly)\b/i.test(g.said)
		};
	}
	var sentences = (text) => text.split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim());
	/** The reply with every invented time, event and progress claim taken out. `dropped` lists what went. */
	function groundReply(reply, g) {
		const text = String(reply ?? "").trim();
		if (!text) return {
			reply: text,
			dropped: []
		};
		const parts = sentences(text);
		const dropped = [];
		const kept = [];
		for (const s of parts) {
			const u = ungrounded(s, g);
			if (u.times.length || u.events.length) {
				dropped.push(s.trim());
				continue;
			}
			if (u.progress) {
				const clauses = s.split(/\s*(?:,|;|—|–| - )\s*/);
				const ok = clauses.filter((c) => !PROGRESS.test(c));
				dropped.push(...clauses.filter((c) => PROGRESS.test(c)).map((c) => c.trim()));
				if (ok.length) {
					const joined = ok.join(", ").replace(/\s+([.!?])/g, "$1");
					kept.push(/[.!?…]$/.test(joined) ? joined : `${joined}.`);
				}
				continue;
			}
			kept.push(s.trim());
		}
		if (!dropped.length) return {
			reply: text,
			dropped
		};
		if (kept.length) return {
			reply: kept.join(" ").trim(),
			dropped
		};
		let r = text;
		for (const s of parts) {
			const u = ungrounded(s, g);
			for (const x of u.times) r = r.replace(new RegExp(`\\s*\\b(?:at|until|till|by|from|before|after|around)?\\s*${x.replace(/^0/, "0?")}\\b`, "g"), "");
			for (const w of u.events) r = r.replace(new RegExp(`\\s*\\b(?:before|until|after)?\\s*(?:the|your|a)?\\s*(?:next\\s+)?${w}\\b`, "gi"), "");
		}
		r = r.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/,\s*\./g, ".").trim();
		return {
			reply: r || text,
			dropped
		};
	}
	// src/core/sportInsight.ts
	/** Moves with no rep gain in 2+ sessions in a row (needs 3 sessions; the last one within 14 days). */
	function stallsOf(log, exercises, today) {
		const out = [];
		for (const ex of exercises) {
			if (ex.active === false) continue;
			const s = sessionsOf(log, String(ex.id), today);
			if (s.length < 3 || s[s.length - 1].day < addDays(today, -14)) continue;
			const best = s.map((x) => Math.max(...x.reps));
			let n = 0;
			for (let i = best.length - 1; i >= 1; i--) if (best[i] <= Math.max(...best.slice(0, i))) n++;
			else break;
			if (n >= 2) out.push({
				name: moveOf(ex)?.name ?? ex.name,
				sessions: n,
				best: Math.max(...best)
			});
		}
		return out.sort((a, b) => b.sessions - a.sessions);
	}
	// src/core/sportCoachRules.ts
	var RULES = {
		setsLo: 10,
		setsHi: 20,
		minDays: 2,
		rir: "1–2 reps before you could not do another",
		protein: {
			lo: 1.6,
			hi: 2.2
		},
		sleepHours: 7,
		deloadWeeks: {
			lo: 4,
			hi: 6
		},
		/** Added weight steps (kg) when a ladder has no harder move. */
		kgFirst: 5,
		kgStep: 2
	};
	var clamp$1 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	var u = (m) => m.unit === "sec" ? " s" : "";
	/** What to say for each muscle: the move group and the body part. */
	var BODY_PART = {
		push: {
			work: "pushing",
			part: "chest and shoulders",
			start: "pushup"
		},
		pull: {
			work: "pulling",
			part: "back",
			start: "door_row"
		},
		legs: {
			work: "leg work",
			part: "legs",
			start: "split_squat"
		},
		core: {
			work: "core work",
			part: "core",
			start: "plank"
		}
	};
	/** Rule 4: seconds of rest for a set of `reps` (or seconds for a hold) on a move. */
	function restFor(move, reps) {
		if (move.unit === "sec") return 60;
		if (reps <= 8) return move.diff >= 4 ? 180 : 150;
		if (reps <= 12) return 105;
		if (reps <= 20) return 75;
		return 60;
	}
	var restText = (s) => s % 60 === 0 ? `${s / 60} min` : s >= 120 ? `${Math.floor(s / 60)}.${Math.round(s % 60 / 6)} min` : `${s} s`;
	function muscleLoad(ctx) {
		const from = shiftDay(ctx.today, -6);
		const sets = {
			push: 0,
			pull: 0,
			core: 0,
			legs: 0
		};
		const dset = {
			push: /* @__PURE__ */ new Set(),
			pull: /* @__PURE__ */ new Set(),
			core: /* @__PURE__ */ new Set(),
			legs: /* @__PURE__ */ new Set()
		};
		for (const ex of ctx.exercises) {
			const mv = moveOf(ex);
			const mu = muscleOf(mv?.group);
			if (!mu) continue;
			for (const day of Object.keys(ctx.sets ?? {})) {
				if (day < from || day > ctx.today) continue;
				const l = setsOn(ctx.sets, day, String(ex.id)).map((s) => s.reps);
				if (!l.length) continue;
				sets[mu] += hardSets(l, mv?.unit);
				dset[mu].add(day);
			}
		}
		const prog = ctx.program && ctx.program.week === mondayOf(ctx.today) ? ctx.program.target : null;
		return MUSCLES.map((m) => {
			const goal = clamp$1(prog?.[m.id] ?? RULES.setsLo, RULES.setsLo, RULES.setsHi);
			const n = sets[m.id];
			return {
				id: m.id,
				short: m.short,
				sets: n,
				days: dset[m.id].size,
				goal,
				status: n < RULES.setsLo ? "low" : n > RULES.setsHi ? "high" : "ok",
				freqLow: n > 0 && dset[m.id].size < RULES.minDays
			};
		});
	}
	/** Weeks in a row (counting back from this one) with training on 2+ days. */
	function trainedWeeks(log, today) {
		let n = 0;
		let mon = mondayOf(today);
		for (let i = 0; i < 12; i++, mon = shiftDay(mon, -7)) if (Object.keys(log ?? {}).filter((d) => d >= mon && d <= shiftDay(mon, 6) && Object.keys(log[d] ?? {}).length > 0).length >= 2) n++;
		else if (i === 0) continue;
		else break;
		return n;
	}
	function deloadCheck(ctx) {
		const weeks = trainedWeeks(ctx.sets, ctx.today);
		if (ctx.deload) return {
			due: false,
			weeks,
			why: "An easy week is already running."
		};
		const stalled = stallsOf(ctx.sets, ctx.exercises, ctx.today);
		if (weeks >= RULES.deloadWeeks.hi) return {
			due: true,
			weeks,
			why: `${weeks} hard weeks in a row: time for an easy week.`
		};
		if (weeks >= RULES.deloadWeeks.lo && stalled.length) return {
			due: true,
			weeks,
			why: `${weeks} hard weeks and ${stalled[0].name.toLowerCase()} stopped improving: an easy week brings it back.`
		};
		return {
			due: false,
			weeks,
			why: ""
		};
	}
	/** The kg you used last in this exercise (0: none). */
	function lastKg(log, exId, until) {
		for (const day of Object.keys(log ?? {}).filter((d) => d <= until).sort().reverse()) {
			const k = Math.max(0, ...setsOn(log, day, exId).map((s) => Number(s.kg) || 0));
			if (k > 0) return k;
		}
		return 0;
	}
	/** The next step for one exercise, in the fixed order: reps, then harder or weight, then back to the bottom. */
	function overload(ctx, exId) {
		const c = coachFor({
			...ctx,
			exId
		});
		if (!c) return null;
		const move = c.move;
		const kg = lastKg(ctx.sets, exId, ctx.today);
		const base = {
			move,
			sets: c.sets,
			reps: c.goal,
			kg,
			tempo: kg ? "2-0-1" : "2-0-1"
		};
		const eq = (n) => `${c.sets}×${n}${u(move)}${kg ? ` +${kg} kg` : ""}`;
		if (c.status === "deload") return {
			...base,
			kind: "deload",
			text: `Easy week: ${eq(c.goal)}, stop 3 reps before it gets hard.`
		};
		if (c.status === "new") return {
			...base,
			kind: "start",
			text: `First time: ${eq(c.goal)}, stop ${RULES.rir}.`
		};
		if (c.status === "stuck") {
			const back = c.stepBack?.to;
			return {
				...base,
				move: back ?? move,
				kind: "back",
				reps: c.lo,
				tempo: "3-1-1",
				text: back ? `Two tough sessions: go back to ${back.name.toLowerCase()} at ${c.sets}×${c.lo}${u(back)} and add a slow 3-1-1 tempo.` : `Two tough sessions: ${c.sets}×${c.lo}${u(move)}, 2–3 min rest and a slow 3-1-1 tempo.`
			};
		}
		const reset = c.ready ? ctx.strength && c.ready.to.unit === "reps" ? 5 : rangeFor(c.ready.to).lo : 0;
		if (c.status === "ready" && c.ready) return {
			...base,
			move: c.ready.to,
			kind: "harder",
			sets: c.sets,
			reps: reset,
			kg: 0,
			text: `You reached the top of the range, so the next step is ${c.ready.to.name.toLowerCase()} at ${c.sets}×${reset}${u(c.ready.to)} (back to the bottom of its range).`
		};
		if (c.status === "top") {
			const add = kg ? kg + RULES.kgStep : RULES.kgFirst;
			return {
				...base,
				kind: "weight",
				kg: add,
				reps: c.lo,
				text: `Top of the ladder and the top of the range: add weight. ${c.sets}×${c.lo}${u(move)} +${add} kg in a backpack, then climb back up.`
			};
		}
		return {
			...base,
			kind: "reps",
			text: `${eq(c.goal)}: one more rep than last time, stop ${RULES.rir}.`
		};
	}
	function bodyLines(b) {
		const lines = [];
		const low = [];
		const p = b?.protein;
		if (p && p.days > 0 && p.goal > 0) {
			if (p.avg / p.goal < .8) {
				lines.push(`Protein averaged ${p.avg} g against your ${p.goal} g goal (1.6–2.2 g per kg builds muscle).`);
				low.push("protein");
			}
		}
		const s = b?.sleep;
		if (s && s.avgMin != null && s.nights > 0 && s.avgMin < 420) {
			lines.push(`You slept ${Math.floor(s.avgMin / 60)}h${String(Math.round(s.avgMin % 60)).padStart(2, "0")} on average: muscle grows in sleep, aim for 7 h or more.`);
			low.push("sleep");
		}
		return {
			lines,
			low
		};
	}
	/** The single most important thing this week. */
	function priority(ctx, load = muscleLoad(ctx)) {
		if (!load.some((l) => l.sets > 0)) return {
			text: "Do today’s session and log every set: the coach learns from your numbers.",
			muscle: null,
			addSets: 0
		};
		const dl = deloadCheck(ctx);
		if (dl.due) return {
			text: `${dl.why} Cut each exercise by one set and stop 3 reps short for a week.`,
			muscle: null,
			addSets: 0
		};
		const low = [...load].filter((l) => l.status === "low").sort((a, b) => a.sets / a.goal - b.sets / b.goal)[0];
		if (low) {
			const add = clamp$1(low.goal - low.sets, 2, 4);
			const bp = BODY_PART[low.id];
			return {
				text: `Add ${add} sets of ${bp.work}: your ${bp.part} ${low.id === "legs" ? "are" : "is"} behind (${low.sets} of ${low.goal} hard sets this week).`,
				muscle: low.id,
				addSets: add
			};
		}
		const freq = load.find((l) => l.freqLow);
		if (freq) return {
			text: `Train your ${BODY_PART[freq.id].part} on 2 days a week, not 1: split its sets over two sessions.`,
			muscle: freq.id,
			addSets: 0
		};
		const b = bodyLines(ctx.body);
		if (b.low[0] === "protein") return {
			text: b.lines[0] + " Fix that first.",
			muscle: null,
			addSets: 0
		};
		if (b.low[0] === "sleep") return {
			text: b.lines[b.lines.length - 1] + " Fix that first.",
			muscle: null,
			addSets: 0
		};
		const high = load.find((l) => l.status === "high");
		if (high) return {
			text: `${BODY_PART[high.id].part[0].toUpperCase()}${BODY_PART[high.id].part.slice(1)} is over 20 hard sets: more will not grow it faster. Drop a set or two.`,
			muscle: high.id,
			addSets: 0
		};
		return {
			text: "Beat last time by one rep on every move, and stop 1–2 reps before failure.",
			muscle: null,
			addSets: 0
		};
	}
	/** Today's exact session: the active exercises with sets × reps, the variation, weight or tempo, rest, and volume added where a muscle is behind. */
	function sessionPlan(ctx, load = muscleLoad(ctx)) {
		const items = [];
		const active = ctx.exercises.filter((e) => e.active !== false && !e.plan);
		for (const ex of active) {
			const o = overload(ctx, String(ex.id));
			if (!o) continue;
			let sets = o.sets;
			let added = 0;
			const mu = muscleOf(o.move.group);
			const l = mu && load.find((x) => x.id === mu);
			if (l && l.status === "low" && !ctx.deload && o.kind !== "deload" && sets < 5) {
				added = 1;
				sets += 1;
			}
			const rest = restFor(o.move, o.reps);
			const slow = o.tempo !== "2-0-1" ? `, slow ${o.tempo}` : "";
			const weight = o.kg > 0 ? ` +${o.kg} kg` : "";
			items.push({
				exId: String(ex.id),
				name: ex.name,
				move: o.move,
				sets,
				reps: o.reps,
				kg: o.kg,
				tempo: o.tempo,
				rest,
				kind: o.kind,
				added,
				line: `${sets}×${o.reps}${u(o.move)} ${o.move.name.toLowerCase()}${weight}, rest ${restText(rest)}${slow}`
			});
		}
		return items;
	}
	function coachCard(ctx) {
		const load = muscleLoad(ctx);
		const focus = priority(ctx, load);
		const session = sessionPlan(ctx, load);
		const have = new Set(ctx.exercises.filter((e) => e.active !== false).map((e) => muscleOf(moveOf(e)?.group)));
		const missing = Object.keys(BODY_PART).filter((m) => !have.has(m)).map((m) => ({
			muscle: m,
			move: moveById(BODY_PART[m].start)
		}));
		const deload = deloadCheck(ctx);
		const kinds = new Set(session.map((s) => s.kind));
		return {
			focus,
			session,
			why: kinds.has("harder") ? "You hit the top of the range, so the move gets harder and the reps go back down: that is how muscle keeps growing." : kinds.has("weight") ? "You are at the top of the ladder, so the load goes up with a backpack." : kinds.has("back") ? "Two tough sessions means you need more recovery, not less effort: a step back now gives a bigger jump next week." : ctx.deload || kinds.has("deload") ? "An easy week: the same moves with fewer sets, so your body catches up." : `Each muscle needs ${RULES.setsLo}–${RULES.setsHi} hard sets a week on 2 or more days, ending 1–2 reps short of failure, and one more rep each time.`,
			body: bodyLines(ctx.body).lines,
			missing,
			deload,
			load
		};
	}
	// src/core/sportAdjust.ts
	/** What to change for next time, from the sets logged today (`ctx.today`). Only exercises with sets today. */
	function adjustAfterSession(ctx) {
		const adjustments = [];
		for (const ex of ctx.exercises) {
			const id = String(ex.id);
			if (!setsOn(ctx.sets, ctx.today, id).length) continue;
			const mv = moveOf(ex);
			if (!mv || !coachFor({
				...ctx,
				exId: id
			})) continue;
			const next = overload({
				...ctx,
				today: shiftDay(ctx.today, 1)
			}, id);
			if (!next) continue;
			const kind = next.move.id !== mv.id && next.kind === "back" ? "swap" : next.kind;
			adjustments.push({
				exId: id,
				name: ex.name,
				kind,
				toMove: next.move.id,
				next: {
					sets: next.sets,
					reps: next.reps,
					kg: next.kg
				},
				text: `${mv.name}: ${next.text} Rest ${restText(restFor(next.move, next.reps))}.`
			});
		}
		const volume = muscleLoad(ctx).filter((l) => l.status === "low" && l.sets > 0 && !ctx.deload).map((l) => ({
			muscle: l.id,
			have: l.sets,
			add: Math.min(3, RULES.setsLo - l.sets)
		}));
		for (const v of volume) {
			const a = adjustments.find((x) => muscleOf(moveOf({
				name: x.name,
				move: x.toMove
			})?.group) === v.muscle && x.next.sets < 5);
			if (a) {
				a.next.sets += 1;
				a.text += ` +1 set: your ${BODY_PART[v.muscle].part} has ${v.have} of ${RULES.setsLo} hard sets this week.`;
			}
		}
		return {
			adjustments,
			lines: adjustments.map((a) => a.text),
			volume
		};
	}
	// src/core/sportAsk.ts
	var TRAIN = /\b(train(?:ing)?|grow(?:ing|th)?|muscle|stronger|strength|sets?|reps?|rest|deload|plateau|stall(?:ed)?|progress(?:ion)?|volume|hypertrophy|push-?ups?|pull-?ups?|squats?|sit-?ups?|rows?|plank|archer|pistol|planche|dragon|protein|sport)\b/i;
	var QUESTION = /\?|^(?:why|how|what|should|is|are|do|does|can|when|which)\b/i;
	/** A question about training (not a log, not a command). */
	function isTrainingQuestion(text) {
		const t = String(text ?? "").trim();
		if (!t || t.startsWith("/") || t.length > 200) return false;
		return TRAIN.test(t) && QUESTION.test(t) && !/\b(spent|spend|euro|lei|todo|remind|meeting)\b/i.test(t);
	}
	var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
	/** The answer, or null when it is not a training question. */
	function answerTraining(text, ctx) {
		if (!isTrainingQuestion(text)) return null;
		const t = text.toLowerCase();
		const load = muscleLoad(ctx);
		const body = bodyLines(ctx.body);
		const stalled = stallsOf(ctx.sets, ctx.exercises, ctx.today);
		const dl = deloadCheck(ctx);
		const any = load.some((l) => l.sets > 0);
		const m = /(\d{1,2})\s*[x×]\s*(\d{1,3})/.exec(t);
		if (m && /enough|ok(?:ay)?|good|too (?:easy|little)|worth/.test(t)) {
			const sets = Number(m[1]);
			const reps = Number(m[2]);
			const mv = matchMove(t.replace(m[0], " ").replace(/\b(is|enough|ok|okay|good|worth|it|for|me|a|the|\?)\b/g, " ").trim());
			const mu = muscleOf(mv?.group);
			const l = mu ? load.find((x) => x.id === mu) : null;
			const parts = [];
			parts.push(`${sets}×${reps}${mv ? ` ${mv.name.toLowerCase()}` : ""} is ${sets * reps} reps; what grows muscle is hard sets.`);
			if (reps > 12 && mv?.unit === "reps") parts.push(`${reps} reps is above the 5–12 range where a set is hard: move to a harder variation instead of adding reps.`);
			else if (reps < 5) parts.push("Under 5 reps is more strength than size: go up to 5–8 on a variation you can hold for 4 sets.");
			else parts.push(`${reps} reps is a good range if you stop ${RULES.rir}. If you could do 3 or more extra, it is too easy: go to the next variation.`);
			if (l) parts.push(l.sets >= RULES.setsLo ? `Your ${BODY_PART[l.id].part} has ${l.sets} hard sets in the last 7 days, which is in the 10–20 zone.` : `Your ${BODY_PART[l.id].part} has ${l.sets} hard sets in the last 7 days; one session of ${sets} sets is not enough. Aim for 10–20 a week on 2 or more days.`);
			return parts.join(" ");
		}
		if (/rest|between sets/.test(t)) {
			const mv = matchMove(t.replace(/\b(how|long|much|should|i|rest|between|sets?|the|for|do|a|\?)\b/g, " ").trim());
			const lines = [`Rest suits the reps: 5–8 reps need 2.5–3 min, 9–12 reps about 1.75 min, 13–20 reps about 1.25 min, and holds 1 min.`];
			if (mv) lines.push(`For ${mv.name.toLowerCase()} at ${mv.set} reps: ${restText(restFor(mv, mv.set))}.`);
			return lines.join(" ");
		}
		if (/protein|eat|sleep/.test(t) && !/why/.test(t)) return [`Muscle needs protein of about ${RULES.protein.lo}–${RULES.protein.hi} g per kg of body weight and ${RULES.sleepHours}+ hours of sleep.`, ...body.lines.length ? body.lines : ["Nothing is low in your Body data right now."]].join(" ");
		if (/deload|easy week|recover/.test(t)) return dl.due ? `Yes: ${dl.why} Cut one set from every exercise and stop 3 reps short for a week.` : `Not yet. A deload comes every ${RULES.deloadWeeks.lo}–${RULES.deloadWeeks.hi} weeks, or sooner when progress stalls. You have trained ${dl.weeks} ${dl.weeks === 1 ? "week" : "weeks"} in a row.`;
		if (/how many sets|how much volume|how often/.test(t)) return `Each muscle group needs ${RULES.setsLo}–${RULES.setsHi} hard sets a week, spread over at least ${RULES.minDays} days. ${load.map((l) => `${l.short}: ${l.sets} in the last 7 days`).join(", ")}.`;
		if (!any) return "I have no sets from you in the last 7 days, so there is nothing to grow from yet. Log today’s session set by set and I will tell you exactly what to change.";
		const causes = [];
		const low = load.filter((l) => l.status === "low");
		if (low.length) causes.push(`Volume is low: ${low.map((l) => `${BODY_PART[l.id].part} ${l.sets}`).join(", ")} hard sets in the last 7 days (the goal is ${RULES.setsLo}–${RULES.setsHi} for each).`);
		for (const l of load) if (l.freqLow) causes.push(`${cap(BODY_PART[l.id].part)} was trained on ${l.days} day: split it over ${RULES.minDays} days.`);
		if (stalled.length) causes.push(`${stalled.map((s) => s.name).slice(0, 2).join(" and ")} stopped improving: ${ctx.exercises.length ? "try a slower 3-1-1 tempo or the next variation" : "change the move"}.`);
		causes.push(...body.lines);
		if (dl.due) causes.push(dl.why);
		const card = coachCard(ctx);
		if (!causes.length) return `Nothing looks wrong: your sets, protein and sleep are in the zone. Keep adding one rep or one harder variation each session, and stop ${RULES.rir}. This week's focus: ${card.focus.text}`;
		return `${causes.slice(0, 4).join(" ")} First fix: ${card.focus.text}`;
	}
	/** Today's session in plain words, for "what should I train today?". */
	function sessionText(ctx) {
		const card = coachCard(ctx);
		if (!card.session.length) return "There is no active exercise yet. Open Sport Track and answer the best-set questions so I can build your session.";
		return `Today: ${card.session.map((s) => s.line).join("; ")}. ${card.why} Most important this week: ${card.focus.text}`;
	}
	// src/core/sportReview.ts
	/** The facts the model gets (and the only numbers it may use). */
	function reviewFacts(ctx) {
		const load = muscleLoad(ctx);
		const stalled = stallsOf(ctx.sets, ctx.exercises, ctx.today);
		const change = strengthChange(ctx.sets, ctx.exercises, ctx.today);
		const b = ctx.body;
		const out = [];
		out.push("Hard sets in the last 7 days: " + load.map((l) => `${l.short} ${l.sets} sets on ${l.days} days`).join("; ") + ".");
		const bests = ctx.exercises.filter((e) => e.active !== false).map((e) => {
			const m = moveOf(e);
			const top = Math.max(0, ...Object.values(ctx.sets ?? {}).flatMap((d) => (d?.[String(e.id)] ?? []).map((s) => s.reps)));
			return m && top ? `${m.name} best set ${top}` : "";
		}).filter(Boolean);
		if (bests.length) out.push("Best sets: " + bests.join("; ") + ".");
		if (change.pct != null) out.push(`Strength change versus 4 weeks ago: ${change.pct} percent.`);
		out.push(stalled.length ? "Stalled: " + stalled.map((s) => `${s.name} (${s.sessions} sessions without a better set)`).join("; ") + "." : "Nothing stalled.");
		out.push(b?.protein && b.protein.days ? `Protein averaged ${b.protein.avg} g a day on ${b.protein.days} days, goal ${b.protein.goal} g.` : "Protein: not logged.");
		out.push(b?.sleep && b.sleep.avgMin != null ? `Sleep averaged ${Math.round(b.sleep.avgMin / 6) / 10} hours over ${b.sleep.nights} nights.` : "Sleep: not logged.");
		const dl = deloadCheck(ctx);
		out.push(`Training weeks in a row: ${dl.weeks}. Deload ${dl.due ? "is due" : "is not due"}.`);
		return out.join("\n");
	}
	/** The program the rules alone give: low muscles up to 10, the rest one more, a deload when due. */
	function baseProgram(ctx) {
		const load = muscleLoad(ctx);
		const dl = deloadCheck(ctx);
		const target = {};
		for (const l of load) target[l.id] = Math.max(RULES.setsLo, Math.min(RULES.setsHi, l.sets < RULES.setsLo ? RULES.setsLo : l.sets + 1));
		const lines = [];
		const low = load.filter((l) => l.status === "low" && l.sets > 0);
		if (low.length) lines.push(`Your ${low.map((l) => BODY_PART[l.id].part).join(" and ")} got under ${RULES.setsLo} hard sets, so this week each gets ${RULES.setsLo}.`);
		if (dl.due) lines.push(dl.why);
		lines.push(...bodyLines(ctx.body).lines.slice(0, 2));
		lines.push(`Every muscle is trained on ${RULES.minDays} or more days, and each set stops ${RULES.rir}.`);
		return {
			week: mondayOf(ctx.today),
			target,
			sessions: 3,
			deload: dl.due,
			lines: lines.slice(0, 4),
			source: "code"
		};
	}
	var NUM = /\d+(?:[.,]\d+)?/g;
	/** Keep only the sentences whose numbers are all in `allowed`. */
	function groundNumbers(text, allowed) {
		const ok = new Set((allowed.match(NUM) ?? []).map((n) => n.replace(",", ".")));
		return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean).filter((s) => (s.match(NUM) ?? []).every((n) => ok.has(n.replace(",", "."))));
	}
	/** The model's proposal, forced inside the rules. */
	function enforce(raw, ctx, facts, now) {
		const base = baseProgram(ctx);
		const p = raw && typeof raw === "object" ? raw : {};
		const target = { ...base.target };
		for (const m of MUSCLES) {
			const n = Math.round(Number(p.target?.[m.id]));
			if (Number.isFinite(n)) target[m.id] = Math.max(RULES.setsLo, Math.min(RULES.setsHi, n));
		}
		const sessions = Number.isFinite(Number(p.sessions)) ? Math.max(RULES.minDays, Math.min(5, Math.round(Number(p.sessions)))) : base.sessions;
		const dl = deloadCheck(ctx);
		const allowed = `${facts}\n${Object.values(target).join(" ")} ${sessions} ${RULES.setsLo} ${RULES.setsHi} ${RULES.minDays} ${RULES.sleepHours} 1 2 1.6 2.2`;
		let lines = groundNumbers((Array.isArray(p.lines) ? p.lines : String(p.lines ?? "").split("\n")).map(String).join("\n"), allowed);
		lines = groundReply(lines.join("\n"), {
			facts,
			said: "",
			now
		}).reply.split(/\n+/).map((s) => s.trim()).filter(Boolean);
		lines = lines.filter((l) => !/\b(skip|no|without)\b.*\bdeload\b/i.test(l) && !/\bto failure\b|\bfull failure\b/i.test(l));
		const ai = lines.length > 0;
		if (dl.due && !lines.some((l) => /easy week|deload/i.test(l))) lines.unshift(dl.why);
		return {
			week: base.week,
			target,
			sessions,
			deload: dl.due,
			lines: (ai ? lines : base.lines).slice(0, 4),
			source: ai ? "ai" : "code"
		};
	}
	function reviewPrompt(facts) {
		return [
			"You are BEN, a strength coach for a home bodyweight athlete. The goal is to grow as fast as possible.",
			"HARD RULES you cannot break: each muscle (push, pull, legs, core) gets 10 to 20 hard sets a week on at least 2 days; sets stop 1-2 reps short of failure; progress in this order: more reps, then a harder variation or added weight, then back to the bottom of the range; deload only when the facts say it is due; protein 1.6-2.2 g/kg and sleep 7+ hours.",
			"Use ONLY numbers that appear in the facts below. Never invent a time, an event or a number.",
			"Write this week's program. Answer ONLY with JSON: {\"target\":{\"push\":n,\"pull\":n,\"legs\":n,\"core\":n},\"sessions\":n,\"lines\":[3 or 4 short plain sentences that say what changes and why]}",
			"",
			"FACTS",
			facts
		].join("\n");
	}
	/** Once a week: ask the strong model, keep it inside the rules. `ask` null or failing gives the code's program. */
	async function weeklyReview(ctx, ask, now = /* @__PURE__ */ new Date()) {
		if (!ask) return baseProgram(ctx);
		const facts = reviewFacts(ctx);
		try {
			const raw = await ask(reviewPrompt(facts), {
				json: true,
				strong: true,
				think: true,
				kind: "weekly"
			});
			return enforce(JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? "{}"), ctx, facts, now);
		} catch {
			return baseProgram(ctx);
		}
	}
	/** True when there is no review for this week yet (one per Monday-to-Sunday week). */
	var reviewDue = (program, today) => !program || program.week < mondayOf(today);
	// src/core/sportOnboard.ts
	/** The questions: family, the move the answer is about, and the label. */
	var QUESTIONS = [
		{
			family: "pushup",
			move: "pushup",
			label: "Push-ups",
			unit: "reps",
			hint: "regular push-ups in one set"
		},
		{
			family: "squat",
			move: "squat",
			label: "Squats",
			unit: "reps",
			hint: "bodyweight squats in one set"
		},
		{
			family: "core",
			move: "situp",
			label: "Sit-ups / abs",
			unit: "reps",
			hint: "sit-ups in one set"
		},
		{
			family: "row",
			move: "table_row_bent",
			label: "Rows",
			unit: "reps",
			hint: "table rows, knees bent (0 if you cannot)"
		},
		{
			family: "plank",
			move: "plank",
			label: "Plank",
			unit: "sec",
			hint: "seconds in one plank"
		}
	];
	var clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
	/**
	* The variation where a set of about 9-14 reps is your max, so 4 sets of 5-8
	* are hard (holds: a max near 40 s or more, sets of 30 s or so). 50 push-ups
	* lands on archer push-ups; 20 on wide push-ups.
	*/
	function placeBest(family, baseMove, best) {
		const steps = FAMILIES[family]?.steps ?? [];
		const bi = steps.indexOf(baseMove);
		const n = Math.round(Number(best));
		if (bi < 0 || !Number.isFinite(n) || n < 0) return null;
		const hold = moveById(baseMove)?.unit === "sec";
		const floor = hold ? 40 : 10;
		const maxAt = (i) => i >= bi ? transferReps(n, i - bi) : n / Math.pow(.7, bi - i);
		let pick = 0;
		for (let i = 0; i < steps.length; i++) if (maxAt(i) >= floor) pick = i;
		const move = moveById(steps[pick]);
		const max = Math.max(1, Math.round(maxAt(pick)));
		const sets = hold ? 3 : 4;
		const reps = hold ? clamp(Math.round(max * .6 / 5) * 5, 15, 60) : clamp(Math.round(max * .6), 5, 8);
		const weighted = pick === steps.length - 1 && maxAt(pick) >= 20;
		const u = hold ? " s" : "";
		return {
			family,
			base: baseMove,
			best: n,
			move,
			sets,
			reps,
			max,
			weighted,
			text: `${n}${u} ${moveById(baseMove).name.toLowerCase()} in one set → start on ${move.name.toLowerCase()}, ${sets}×${reps}${u}.${weighted ? " You are at the top of the ladder: add weight or slow the tempo." : ""}`
		};
	}
	/** Place every answered question (blank answers are skipped). */
	function placeAll$1(answers) {
		const out = [];
		for (const q of QUESTIONS) {
			const raw = answers[q.family];
			if (raw == null || raw === "") continue;
			const p = placeBest(q.family, q.move, Number(raw));
			if (p) out.push(p);
		}
		return out;
	}
	var TEST_EVERY_DAYS = 7;
	/** Days with a test set logged on this exercise (sets flagged `test`). */
	function testDays(log) {
		const out = /* @__PURE__ */ new Set();
		for (const [day, m] of Object.entries(log ?? {})) for (const l of Object.values(m ?? {})) if ((l ?? []).some((s) => s?.test)) out.add(day);
		return [...out].sort();
	}
	/** The weekly test is offered when none was done in the last 7 days and you have trained at all. */
	function testDue(log, today) {
		if (!Object.keys(log ?? {}).length) return false;
		const last = testDays(log).pop();
		return !last || last <= shiftDay(today, -7);
	}
	/** "X% stronger than N weeks ago" from a family's best-set series (test sets and ordinary sets, never day totals). */
	function strongerThan(series, today) {
		if (series.length < 2) return null;
		const now = series.filter((p) => p.day >= shiftDay(today, -13)).sort((a, b) => b.score - a.score)[0];
		const first = series[0];
		if (!now || first.day >= now.day) return null;
		const weeks = Math.round((Date.parse(now.day) - Date.parse(first.day)) / 6048e5);
		if (weeks < 1) return null;
		const then = series.filter((p) => p.day <= shiftDay(first.day, 6)).sort((a, b) => b.score - a.score)[0];
		return {
			pct: Math.round((now.score / then.score - 1) * 100),
			weeks
		};
	}
	// src/core/sportShared.ts
	var key = (x) => String(x ?? "").toLowerCase().replace(/[^a-z]/g, "");
	/** The exercise "pushups", "Push-ups" or "push up" means. */
	function findSharedExercise(s, name) {
		const k = key(name).replace(/s$/, "");
		if (!k) return null;
		return (s.exercises ?? []).find((e) => {
			const id = key(e.id).replace(/s$/, "");
			const n = key(e.name).replace(/s$/, "");
			return id === k || n === k || id.includes(k) || n.includes(k) || n.length > 3 && k.includes(n);
		}) ?? null;
	}
	// src/core/sportBot.ts
	var KG = /\s*(?:\+|\bwith\s+|@\s*)\s*(\d{1,3}(?:[.,]\d)?)\s*kg\b/i;
	var NAMES = /^(press|pushups?|situps?|squats?|pullups?|dips?|plank|flotari|abdomene|genuflexiuni|tractiuni)$/i;
	/** A name Ben takes as sport: a library move or one of the plain old names. */
	var isSportName = (name) => !!matchMove(name) || NAMES.test(String(name).replace(/[^a-z]/gi, ""));
	/** "3x15 push-ups", "push-ups 15 14 12", "8 push-ups +10 kg", "plank 3x45s", "best set push-ups 50": what was said, or null. */
	function parseSportSay(text) {
		let t = String(text ?? "").trim().replace(/^\//, "");
		if (!t || t.length > 90) return null;
		let kg = 0;
		const k = KG.exec(t);
		if (k) {
			kg = Math.round(Number(k[1].replace(",", ".")) * 2) / 2;
			t = t.replace(KG, "").trim();
		}
		const best = /^(?:best(?:\s+set)?|max(?:\s+set)?|my\s+max|my\s+best(?:\s+set)?)[:\s-]+(.+?)\s+(\d{1,3})\s*(s|sec|secs|seconds)?$/i.exec(t) ?? /^(.+?)\s+(?:best(?:\s+set)?|max)[:\s-]+(\d{1,3})\s*(s|sec|secs|seconds)?$/i.exec(t);
		if (best && isSportName(best[1])) return {
			kind: "best",
			name: best[1].replace(/[:,.\-–]+$/, "").trim(),
			reps: [Number(best[2])],
			unit: best[3] ? "sec" : "reps",
			kg
		};
		const sets = parseSets(t);
		if (sets) return {
			kind: "sets",
			name: sets.name,
			reps: sets.reps,
			unit: sets.unit,
			kg
		};
		if (kg > 0) {
			const nameFirst = /^([a-zA-Z][a-zA-Z' _-]{1,40}?)\s+(\d{1,3})$/i.exec(t);
			const repsFirst = /^(\d{1,3})\s*(?:x\s*|reps?\s+(?:of\s+)?)?([a-zA-Z][a-zA-Z' _-]{1,40})$/i.exec(t);
			const one = repsFirst ? {
				1: repsFirst[1],
				2: repsFirst[2]
			} : nameFirst ? {
				1: nameFirst[2],
				2: nameFirst[1]
			} : null;
			if (one && Number(one[1]) >= 1 && isSportName(String(one[2]))) return {
				kind: "sets",
				name: String(one[2]).trim(),
				reps: [Number(one[1])],
				unit: "reps",
				kg
			};
		}
		return null;
	}
	/** "best set push-ups 50": remember it (the page places your level from it) and say where it puts you. */
	function declareBest(st, name, reps, day) {
		const s = st && typeof st === "object" ? JSON.parse(JSON.stringify(st)) : null;
		const ex = s && findSharedExercise(s, name);
		const move = ex && moveOf({
			name: String(ex.name ?? ""),
			move: ex.move
		});
		if (!ex || !move || !(reps >= 1 && reps <= 500)) return null;
		s.bestSets = {
			...s.bestSets ?? {},
			[move.family]: {
				move: move.id,
				reps: Math.round(reps),
				day
			}
		};
		const p = placeFamily({
			exercises: s.exercises,
			days: s.days,
			sets: s.sets,
			today: day,
			best: s.bestSets,
			imported: s.importedDays
		}, move.family);
		return {
			st: s,
			line: `🏆 Best set saved: <b>${Math.round(reps)}</b> ${move.name.toLowerCase()}.${p?.lv ? `\n📈 Level <b>${p.level}</b> of ${p.of}: ${p.lv.name}.` : ""}\nOpen Sport Track and use “Re-check my levels” to put every exercise on the right variation.`
		};
	}
	exports.BONES = BONES;
	exports.BREAK_DAYS = BREAK_DAYS;
	exports.COMEBACK_DAYS = COMEBACK_DAYS;
	exports.FAMILIES = FAMILIES;
	exports.FLOOR = FLOOR;
	exports.GROUPS = GROUPS;
	exports.MAIN_FAMILIES = MAIN_FAMILIES;
	exports.MOVES = MOVES;
	exports.MUSCLES = MUSCLES;
	exports.NEED = NEED;
	exports.NEED_TOP = NEED_TOP;
	exports.PHOTOS = PHOTOS;
	exports.PHOTO_SOURCE = PHOTO_SOURCE;
	exports.PROGRAMS = PROGRAMS;
	exports.QUESTIONS = QUESTIONS;
	exports.RANKS = RANKS;
	exports.ROUTINE_VERSION = ROUTINE_VERSION;
	exports.RULES = RULES;
	exports.TEST_EVERY_DAYS = TEST_EVERY_DAYS;
	exports.TRAIN_DAYS = TRAIN_DAYS;
	exports.WEEKLY_SETS = WEEKLY_SETS;
	exports.activeDays = activeDays;
	exports.addSets = addSets;
	exports.adjustAfterSession = adjustAfterSession;
	exports.answerTraining = answerTraining;
	exports.applyProgram = applyProgram;
	exports.autoVariation = autoVariation;
	exports.balanceCheck = balanceCheck;
	exports.balancedSet = balancedSet;
	exports.baseProgram = baseProgram;
	exports.bestRun = bestRun;
	exports.bestSet = bestSet;
	exports.bodyLines = bodyLines;
	exports.boxOf = boxOf;
	exports.buildSession = buildSession;
	exports.coachAdded = coachAdded;
	exports.coachCard = coachCard;
	exports.coachFor = coachFor;
	exports.compareThen = compareThen;
	exports.computeBadges = computeBadges;
	exports.declareBest = declareBest;
	exports.deloadAdvice = deloadAdvice;
	exports.deloadCheck = deloadCheck;
	exports.deloadWeek = deloadWeek;
	exports.enduranceStep = enduranceStep;
	exports.estimateMinutes = estimateMinutes;
	exports.estimateSets = estimateSets;
	exports.familiesWithSets = familiesWithSets;
	exports.familySeries = familySeries;
	exports.feedbackFor = feedbackFor;
	exports.figureShapes = figureShapes;
	exports.forecasts = forecasts;
	exports.formTip = formTip;
	exports.frameAt = frameAt;
	exports.goalPace = goalPace;
	exports.growTarget = growTarget;
	exports.growTips = growTips;
	exports.hardSets = hardSets;
	exports.hardSetsByMuscle = hardSetsByMuscle;
	exports.harderChoices = harderChoices;
	exports.importSets = importSets;
	exports.isRecord = isRecord;
	exports.isTrainingQuestion = isTrainingQuestion;
	exports.ladderOf = ladderOf;
	exports.lastKg = lastKg;
	exports.levelBadge = levelBadge;
	exports.levelChanges = levelChanges;
	exports.levelOf = levelOf;
	exports.loadOf = loadOf;
	exports.loggedMoves = loggedMoves;
	exports.loopLength = loopLength;
	exports.makeEasier = makeEasier;
	exports.makeHarder = makeHarder;
	exports.makeSet = makeSet;
	exports.matchExercise = matchExercise;
	exports.matchMove = matchMove;
	exports.mergeSets = mergeSets;
	exports.mergeTelegramDays = mergeTelegramDays;
	exports.migrateRoutine = migrateRoutine;
	exports.milestones = milestones;
	exports.missingGroups = missingGroups;
	exports.mondayOf = mondayOf;
	exports.moveById = moveById;
	exports.moveOf = moveOf;
	exports.muscleLoad = muscleLoad;
	exports.muscleOf = muscleOf;
	exports.newBadges = newBadges;
	exports.nextStep = nextStep;
	exports.overallRank = overallRank;
	exports.overload = overload;
	exports.parseSets = parseSets;
	exports.parseSportSay = parseSportSay;
	exports.parseTelegramExport = parseTelegramExport;
	exports.photoOf = photoOf;
	exports.placeAll = placeAll;
	exports.placeBest = placeBest;
	exports.placeBestAll = placeAll$1;
	exports.placeFamily = placeFamily;
	exports.prevStep = prevStep;
	exports.priority = priority;
	exports.programById = programById;
	exports.programOf = programOf;
	exports.progressFor = progressFor;
	exports.rangeFor = rangeFor;
	exports.rankLine = rankLine;
	exports.recordsWall = recordsWall;
	exports.restFor = restFor;
	exports.restText = restText;
	exports.restoreOwnRoutine = restoreOwnRoutine;
	exports.reviewDue = reviewDue;
	exports.seriesOf = seriesOf;
	exports.sessionFor = sessionFor;
	exports.sessionPlan = sessionPlan;
	exports.sessionText = sessionText;
	exports.sessionsFor = sessionsFor;
	exports.sessionsOf = sessionsOf;
	exports.setCoachMode = setCoachMode;
	exports.setScore = setScore;
	exports.setSize = setSize;
	exports.setsOn = setsOn;
	exports.setsText = setsText;
	exports.shiftLevel = shiftLevel;
	exports.slotMove = slotMove;
	exports.splitOf = splitOf;
	exports.startTarget = startTarget;
	exports.stillFrame = stillFrame;
	exports.stopProgram = stopProgram;
	exports.storyWeek = storyWeek;
	exports.strengthChange = strengthChange;
	exports.strengthScore = strengthScore;
	exports.strongerThan = strongerThan;
	exports.suggestHarder = suggestHarder;
	exports.targetRun = targetRun;
	exports.tempoAdvice = tempoAdvice;
	exports.testDays = testDays;
	exports.testDue = testDue;
	exports.todayRoutine = todayRoutine;
	exports.todaysSession = todaysSession;
	exports.trackOf = trackOf;
	exports.trainedWeeks = trainedWeeks;
	exports.trendLine = trendLine;
	exports.weekPlan = weekPlan;
	exports.weeklyReview = weeklyReview;
	exports.weeklyStory = weeklyStory;
	exports.weeklyVolume = weeklyVolume;
	return exports;
})({});
