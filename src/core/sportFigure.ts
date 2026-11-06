// The animated exercise demos in Sport Track: a figure drawn from a few key
// poses. A pose says where the hips, shoulders, hands and feet are; elbows and
// knees are worked out (two-bone IK), so limbs keep their length while the
// figure moves smoothly from pose to pose. Pure math, no DOM: the page draws
// the points this returns (apps/sport/index.html, through sportkit.js).
//
// Coordinates: a 120 × 96 box (viewBox "0 -6 120 96"), the floor at y = 84,
// y grows downwards, angles in degrees (0 = right, 90 = down, -90 = up).
// Side view figures face right unless a pose says otherwise.

export type Pt = [number, number]

export const FLOOR = 84
export const BONES = { torso: 25, upperArm: 13.5, foreArm: 13, thigh: 18.5, shin: 18, neck: 3, head: 6, foot: 5.5 }

export interface Pose {
  /** Hip (the root). Left out with `line`: worked out on the line from the shoulders to the knees or feet. */
  h?: Pt
  /** Shoulders (the torso keeps its length: only the direction from the hip counts). */
  s: Pt
  /** The body is one straight line from the shoulders to the knees (if given) or feet: planks, push-ups. */
  line?: boolean
  /** Hands [near, far], where they are. */
  a?: [Pt, Pt]
  /** Hands [near, far], relative to the shoulders (they move with the torso). */
  ar?: [Pt, Pt]
  /** Ankles [near, far]. */
  f: [Pt, Pt]
  /** Knees [near, far] where they must be (kneeling), else worked out. */
  kn?: [Pt | null, Pt | null]
  /** Which way elbows bend [near, far]: 1 or -1 (default 1: backwards for a figure facing right). */
  eb?: [number, number]
  /** Which way knees bend [near, far] (default -1: forwards for a figure facing right). */
  kb?: [number, number]
  /** Foot angles [near, far] (default 12: flat, toes to the right). */
  ft?: [number, number]
  /** A round (+) or arched (-) back, in px. */
  bow?: number
  /** Front view: half the width of the shoulders and the hips. */
  w?: number
  hw?: number
  /** The head turned from the line of the torso, degrees. */
  hd?: number
}

export interface Key {
  p: Pose
  /** Seconds to move into this pose from the one before (the last one loops to the first). */
  t: number
  /** Seconds to stay in it. */
  hold?: number
}

export type Prop =
  | { k: 'box'; x: number; y: number; w: number } // a chair or a bench: its seat at y, from x, w wide
  | { k: 'wall'; x: number }
  | { k: 'door'; x: number }
  | { k: 'table'; x: number; y: number; w: number }

export interface Anim {
  keys: Key[]
  props?: Prop[]
  /** Seen from the front: both sides drawn the same. */
  front?: boolean
  /** A small top-down sketch of where the hands go (push-up variants). */
  hands?: 'normal' | 'wide' | 'diamond' | 'archer' | 'narrow'
  /** Which key is the still picture (default 0). */
  still?: number
}

/** A pose with everything worked out: hip, shoulders and the ends of each limb. */
interface Flat {
  h: Pt
  s: Pt
  hands: [Pt, Pt]
  feet: [Pt, Pt]
  kn: [Pt | null, Pt | null]
  eb: [number, number]
  kb: [number, number]
  ft: [number, number]
  bow: number
  w: number
  hw: number
  hd: number
}

/** What the page draws: each limb as a list of points, the head, the floor shadow. */
export interface Frame {
  torso: [Pt, Pt, Pt] // hip, bend point (for a curve), shoulders
  head: Pt
  arms: [Pt[], Pt[]] // [near, far]: shoulder, elbow, hand
  legs: [Pt[], Pt[]] // [near, far]: hip, knee, ankle, toe
  shadow: { x: number; rx: number; o: number }
}

const add = (p: Pt, q: Pt): Pt => [p[0] + q[0], p[1] + q[1]]
const sub = (p: Pt, q: Pt): Pt => [p[0] - q[0], p[1] - q[1]]
const mul = (p: Pt, k: number): Pt => [p[0] * k, p[1] * k]
const len = (p: Pt) => Math.hypot(p[0], p[1])
const unit = (p: Pt): Pt => {
  const l = len(p)
  return l > 1e-9 ? [p[0] / l, p[1] / l] : [0, -1]
}
const rot = (p: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpPt = (a: Pt, b: Pt, k: number): Pt => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)]
export const dist = (a: Pt, b: Pt) => len(sub(a, b))

/**
 * Two bones from `root` towards `target`: returns the middle joint and the end.
 * Too far: the limb points straight at it. `bend` picks the side the joint goes.
 */
export function ik(root: Pt, target: Pt, l1: number, l2: number, bend: number, mid?: Pt | null): [Pt, Pt] {
  if (mid) {
    const j = add(root, mul(unit(sub(mid, root)), l1))
    return [j, add(j, mul(unit(sub(target, j)), l2))]
  }
  const d0 = dist(root, target)
  const d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.01, d0))
  const u = unit(sub(target, root))
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
  const theta = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
  const j = add(root, mul(rot(u, bend * theta), l1))
  const end = add(root, mul(u, d))
  return [j, add(j, mul(unit(sub(end, j)), l2))]
}

function flatten(p: Pose): Flat {
  const B = BONES
  let h = p.h
  if (!h) {
    const kneesAt = p.kn && p.kn[0] && p.kn[1] ? lerpPt(p.kn[0], p.kn[1], 0.5) : null
    const to = kneesAt ?? lerpPt(p.f[0], p.f[1], 0.5)
    h = add(p.s, mul(unit(sub(to, p.s)), B.torso))
  }
  const s = add(h, mul(unit(sub(p.s, h)), B.torso))
  const hands: [Pt, Pt] = p.a ? [p.a[0], p.a[1]] : p.ar ? [add(s, p.ar[0]), add(s, p.ar[1])] : [add(s, [2, 24]), add(s, [-1, 24])]
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
  }
}

/** Where an arm (or leg) starts: the shoulders (hips), apart by w (hw) in a front view. */
function roots(f: Pick<Flat, 'h' | 's' | 'w' | 'hw'>): { arm: [Pt, Pt]; leg: [Pt, Pt] } {
  const dir = unit(sub(f.s, f.h))
  const s = add(f.h, mul(dir, BONES.torso))
  const perp = rot(dir, 90)
  return { arm: [add(s, mul(perp, -f.w)), add(s, mul(perp, f.w))], leg: [add(f.h, mul(perp, -f.hw)), add(f.h, mul(perp, f.hw))] }
}

/**
 * A hand or foot between two poses. One that stays put (planted on the floor)
 * moves in a straight line; one that swings goes round its shoulder or hip,
 * so the arm doesn't fold up half-way.
 */
function limbTarget(ta: Pt, tb: Pt, ra: Pt, rb: Pt, r: Pt, k: number): Pt {
  if (dist(ta, tb) < 4) return lerpPt(ta, tb, k)
  const va = sub(ta, ra)
  const vb = sub(tb, rb)
  const aa = Math.atan2(va[1], va[0])
  let d = Math.atan2(vb[1], vb[0]) - aa
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  const ang = aa + d * k
  const l = lerp(len(va), len(vb), k)
  const t = add(r, [Math.cos(ang) * l, Math.sin(ang) * l])
  // Never lower than where it starts or ends: a swinging foot doesn't go through the floor.
  return [t[0], Math.min(t[1], Math.max(ta[1], tb[1]))]
}

function mix(a: Flat, b: Flat, k: number): Flat {
  const both = (i: 0 | 1): Pt | null => (a.kn[i] && b.kn[i] ? lerpPt(a.kn[i]!, b.kn[i]!, k) : k < 0.5 ? a.kn[i] : b.kn[i])
  const base = { h: lerpPt(a.h, b.h, k), s: lerpPt(a.s, b.s, k), w: lerp(a.w, b.w, k), hw: lerp(a.hw, b.hw, k) }
  const ra = roots(a)
  const rb = roots(b)
  const r = roots(base)
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
  }
}

/** The points to draw for one worked-out pose. */
function draw(f: Flat): Frame {
  const B = BONES
  const dir = unit(sub(f.s, f.h))
  const s = add(f.h, mul(dir, B.torso))
  const r = roots(f)
  // The back's curve: a bend point off the middle of the torso.
  const mid = add(lerpPt(f.h, s, 0.5), mul(rot(dir, -90), f.bow))
  const neckDir = unit(rot(f.bow ? sub(s, mid) : dir, f.hd))
  const head = add(s, mul(neckDir, B.neck + B.head))
  const arm = (i: 0 | 1): Pt[] => {
    const root = r.arm[i]
    const [el, hand] = ik(root, f.hands[i], B.upperArm, B.foreArm, f.eb[i])
    return [root, el, hand]
  }
  const leg = (i: 0 | 1): Pt[] => {
    const root = r.leg[i]
    const [kn, ankle] = ik(root, f.feet[i], B.thigh, B.shin, f.kb[i], f.kn[i])
    const t = add(ankle, mul(rot([1, 0], f.ft[i]), B.foot))
    const toe: Pt = [t[0], Math.min(t[1], FLOOR + 0.5)]
    return [root, kn, ankle, toe]
  }
  const legs: [Pt[], Pt[]] = [leg(0), leg(1)]
  const lowest = Math.max(...legs.flatMap((l) => [l[2][1], l[3][1]]))
  const air = Math.max(0, FLOOR - 1 - lowest)
  return {
    torso: [f.h, mid, s],
    head,
    arms: [arm(0), arm(1)],
    legs,
    shadow: { x: (f.h[0] + s[0]) / 2, rx: Math.max(10, 26 - air * 0.8), o: Math.max(0.25, 1 - air / 14) }
  }
}

const ease = (k: number) => 0.5 - Math.cos(Math.PI * k) / 2

/** One loop of the demo, in seconds. */
export function loopLength(anim: Anim): number {
  return anim.keys.reduce((t, k) => t + k.t + (k.hold ?? 0), 0)
}

/** The figure `time` seconds into the demo (it loops). */
export function frameAt(anim: Anim, time: number): Frame {
  const keys = anim.keys
  const flat = keys.map((k) => flatten(k.p))
  if (keys.length === 1) return draw(flat[0])
  const total = loopLength(anim)
  let t = ((time % total) + total) % total
  // keys[0] is where the loop starts: hold it, then each later key; the last move goes back to keys[0].
  const order = [...keys.keys()].slice(1).concat(0)
  t -= keys[0].hold ?? 0
  if (t < 0) return draw(flat[0])
  let from = 0
  for (const i of order) {
    const k = keys[i]
    if (t < k.t) return draw(mix(flat[from], flat[i], ease(t / k.t)))
    t -= k.t
    if (i !== 0) {
      if (t < (k.hold ?? 0)) return draw(flat[i])
      t -= k.hold ?? 0
    }
    from = i
  }
  return draw(flat[0])
}

/**
 * The box the whole demo fits in (every frame, its props, a little room),
 * as [x, y, width, height] for an SVG viewBox, at least `aspect` wide per
 * unit of height, at least `minH` tall (big stages use more so figures
 * don't look chunky) and never cutting off the floor. Lets small cards show the
 * figure as big as it can be.
 */
export function boxOf(anim: Anim, aspect = 1.25, minH = 64, pad = 7): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = FLOOR + 2
  const see = (p: Pt, r = 3) => {
    x0 = Math.min(x0, p[0] - r)
    x1 = Math.max(x1, p[0] + r)
    y0 = Math.min(y0, p[1] - r)
    y1 = Math.max(y1, p[1] + r)
  }
  const total = loopLength(anim)
  for (let i = 0; i < 48; i++) {
    const f = frameAt(anim, (total * i) / 48)
    see(f.head, BONES.head + 1)
    for (const l of [...f.arms, ...f.legs, f.torso]) for (const p of l) see(p)
  }
  for (const p of anim.props ?? []) {
    if (p.k === 'box' || p.k === 'table') { see([p.x, p.y], 2); see([p.x + p.w, FLOOR], 2) }
    // A wall or a door frame only needs to show near the figure.
    else see([p.x, y0], 2)
  }
  x0 -= pad
  x1 += pad
  y0 -= pad
  y1 += 3
  // Never zoom in so far that a lying figure looks twice the size of a standing one.
  if (y1 - y0 < minH) y0 = y1 - minH
  let w = x1 - x0
  let h = y1 - y0
  // Keep the shape of the box it is shown in: widen or heighten around the middle.
  if (w / h < aspect) {
    const nw = h * aspect
    x0 -= (nw - w) / 2
    w = nw
  } else {
    const nh = w / aspect
    y0 -= nh - h // grow upwards: the floor stays at the bottom
    h = nh
  }
  const r = (n: number) => Math.round(n * 10) / 10
  return [r(x0), r(y0), r(w), r(h)]
}

/** The still picture (a card that isn't playing). */
export function stillFrame(anim: Anim): Frame {
  return draw(flatten(anim.keys[anim.still ?? 0].p))
}
