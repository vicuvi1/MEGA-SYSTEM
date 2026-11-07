// How a demo figure looks: a side-view mannequin with real proportions
// (sportFigure.ts says where the joints are; this turns them into shapes).
// Each limb is two tapered segments (thick at the body, thinner at the hand
// or foot) with round joints, the torso is a chest-to-hips shape that follows
// the back's curve, the head has a neck, and hands and feet have a shape.
// The page fills these paths (outlined, the far side a little darker).
// Pure: path strings only, no DOM.
import type { Frame, Pt } from './sportFigure'

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()
const P = (p: Pt) => `${f1(p[0])} ${f1(p[1])}`
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => {
  const l = len(a)
  return l > 1e-6 ? [a[0] / l, a[1] / l] : [0, -1]
}
const perp = (a: Pt): Pt => [-a[1], a[0]]

/** A tapered capsule from p (radius r1) to q (radius r2), as one closed path. */
export function capsule(p: Pt, q: Pt, r1: number, r2: number): string {
  const d = unit(sub(q, p))
  const n = perp(d)
  const a1 = add(p, mul(n, r1))
  const a2 = add(q, mul(n, r2))
  const b2 = add(q, mul(n, -r2))
  const b1 = add(p, mul(n, -r1))
  return `M${P(a1)}L${P(a2)}A${f1(r2)} ${f1(r2)} 0 0 0 ${P(b2)}L${P(b1)}A${f1(r1)} ${f1(r1)} 0 0 0 ${P(a1)}Z`
}

const circle = (c: Pt, r: number) => `M${f1(c[0] - r)} ${f1(c[1])}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`

/** Limb thickness (radius) at each joint: shoulder, elbow, wrist / hip, knee, ankle. */
export const THICK = { shoulder: 3.3, elbow: 2.4, wrist: 1.8, hip: 4.2, knee: 3.0, ankle: 2.1 }

export interface FigureShapes {
  /** Far arm and leg (drawn first, darker), torso + head, near leg and arm. */
  armFar: string
  legFar: string
  torso: string
  head: string
  legNear: string
  armNear: string
  /** Small circles at the near elbow and knee, for a "joint" highlight. */
  joints: string
}

/** One arm: upper arm, forearm, a round hand. */
function arm(pts: Pt[]): string {
  const [s, e, h] = pts
  const hand = add(h, mul(unit(sub(h, e)), 1.2))
  return capsule(s, e, THICK.shoulder, THICK.elbow) + capsule(e, h, THICK.elbow, THICK.wrist) + circle(hand, 2.1)
}

/** One leg: thigh, shin and a foot from the ankle to the toes (a heel behind). */
function leg(pts: Pt[]): string {
  const [hp, k, a, toe] = pts
  const fd = unit(sub(toe, a))
  const heel = add(a, mul(fd, -1.6))
  const tip = add(toe, mul(fd, 0.6))
  return capsule(hp, k, THICK.hip, THICK.knee) + capsule(k, a, THICK.knee, THICK.ankle) + capsule(heel, tip, 1.9, 1.3)
}

/**
 * The torso: from the hips to the chest along the back's curve (hip, bend,
 * shoulders), wider at the chest than the waist, plus the neck.
 */
function torso(fr: Frame): string {
  const [h, c, s] = fr.torso
  const steps = 8
  const L: Pt[] = []
  const R: Pt[] = []
  // Half-widths from the hips (0) to the shoulders (1): hips, waist, ribs, chest.
  const half = (t: number) => (t < 0.45 ? 4.3 - 0.9 * (t / 0.45) : 3.4 + 1.5 * Math.sin(((t - 0.45) / 0.55) * Math.PI * 0.55))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // A point on the quadratic curve and its direction.
    const p: Pt = [(1 - t) * (1 - t) * h[0] + 2 * (1 - t) * t * c[0] + t * t * s[0], (1 - t) * (1 - t) * h[1] + 2 * (1 - t) * t * c[1] + t * t * s[1]]
    const d = unit([2 * (1 - t) * (c[0] - h[0]) + 2 * t * (s[0] - c[0]), 2 * (1 - t) * (c[1] - h[1]) + 2 * t * (s[1] - c[1])])
    const n = perp(d)
    L.push(add(p, mul(n, half(t))))
    R.push(add(p, mul(n, -half(t))))
  }
  const top = unit(sub(s, c))
  const cap = add(s, mul(top, 2.2))
  const body = `M${P(L[0])}${L.slice(1).map((p) => `L${P(p)}`).join('')}Q${P(cap)} ${P(R[R.length - 1])}${R.slice(0, -1).reverse().map((p) => `L${P(p)}`).join('')}A4.3 4.3 0 0 1 ${P(L[0])}Z`
  const neck = capsule(s, add(s, mul(unit(sub(fr.head, s)), 4.2)), 1.7, 1.5)
  return body + neck
}

/** Everything to fill for one frame. */
export function figureShapes(fr: Frame): FigureShapes {
  const head = fr.head
  return {
    armFar: arm(fr.arms[1]),
    legFar: leg(fr.legs[1]),
    torso: torso(fr),
    head: circle(head, 5.6),
    legNear: leg(fr.legs[0]),
    armNear: arm(fr.arms[0]),
    joints: circle(fr.legs[0][1], 0.9) + circle(fr.arms[0][1], 0.75)
  }
}
