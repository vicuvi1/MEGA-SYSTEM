// BD11 Desk mobility snacks (pure, tested in deskMobility.test.ts): the
// island's posture nudge can turn into a 60-second drill of four moves that
// open up what long PC hours close (neck, chest, hips, upper back): chin
// tucks, a doorway chest stretch, a half-kneeling hip-flexor stretch and wall
// angels, 15 seconds each.
//
// The figures use Sport Track's demo engine (sportFigure.ts poses → joints,
// sportDraw.ts → shapes): none of these four moves is in Sport Track's list,
// so they're drawn here with the same body, the same box and the same props
// (a wall, a door frame). The drill is logged only when you tap "Done" at the
// end (the island never logs it by itself), and it pays nothing.
import { frameAt, type Anim, type Frame, type Pose, type Pt } from './sportFigure'

export interface DrillMove {
  id: string
  name: string
  /** What to do, in one short line (shown under the figure). */
  cue: string
  seconds: number
  anim: Anim
}

const D2R = Math.PI / 180
const at = (p: Pt, r: number, deg: number): Pt => [+(p[0] + r * Math.cos(deg * D2R)).toFixed(2), +(p[1] + r * Math.sin(deg * D2R)).toFixed(2)]
const k = (p: Pose, t: number, hold = 0) => ({ p, t, hold })
/** Standing, facing right, arms down (Sport Track's standing body). */
const stand = (o: Partial<Pose> = {}): Pose => ({ h: [60, 46.5], s: [60.5, 21.5], a: [[63, 46], [59.5, 46.5]], f: [[62, 81.5], [57.5, 81.5]], ...o })
/** Seen from the front against a wall: shoulders and hips apart. */
const front = (o: Partial<Pose> = {}): Pose => ({ h: [60, 46.5], s: [60, 21.5], w: 6.5, hw: 3.5, f: [[56, 81.5], [64, 81.5]], ft: [170, 10], ...o })

export const DRILL: DrillMove[] = [
  {
    id: 'chin_tuck',
    name: 'Chin tucks',
    cue: 'Slide your head straight back (a double chin), hold 2 s, let go.',
    seconds: 15,
    anim: {
      keys: [k(stand({ s: [62, 21.8], hd: 16 }), 0.8, 0.4), k(stand({ s: [60, 21.5], hd: -10 }), 0.8, 1.4)]
    }
  },
  {
    id: 'door_chest',
    name: 'Doorway chest stretch',
    cue: 'Forearm on the door frame at shoulder height, step through until the chest opens.',
    seconds: 15,
    anim: {
      props: [{ k: 'door', x: 47 }],
      keys: [
        k(stand({ a: [[49, 10], [50.5, 11]], eb: [1, 1] }), 0.9, 0.3),
        k(stand({ h: [65, 46.5], s: [67.5, 21.8], a: [[49, 10], [50.5, 11]], eb: [1, 1], f: [[76, 81.5], [57.5, 81.5]] }), 1.2, 1.6)
      ]
    }
  },
  {
    id: 'hip_flexor',
    name: 'Hip-flexor stretch',
    cue: 'Half-kneel, squeeze the back glute and shift forward: feel the front of the back hip.',
    seconds: 15,
    anim: {
      keys: [
        k({ h: [50, 66], s: at([50, 66], 25, -90), a: [[66, 62], [64, 62.5]], kn: [null, [44, 82.5]], f: [[72, 81.5], [27, 82]], ft: [12, 185] }, 0.9, 0.4),
        k({ h: [55, 67.5], s: at([55, 67.5], 25, -96), a: [[56, 18], [57, 19]], eb: [-1, -1], kn: [null, [44, 82.5]], f: [[72, 81.5], [27, 82]], ft: [12, 185] }, 1.3, 1.6)
      ]
    }
  },
  {
    id: 'wall_angel',
    name: 'Wall angels',
    cue: 'Back, head and arms on the wall: slide the arms up into a Y and back to a W, slowly.',
    seconds: 15,
    anim: {
      front: true,
      props: [{ k: 'wall', x: 30 }],
      keys: [
        k(front({ a: [[46.5, 17], [73.5, 17]], eb: [-1, 1] }), 1.2, 0.3),
        k(front({ a: [at([53.5, 21.5], 26, -118), at([66.5, 21.5], 26, -62)], eb: [-1, 1] }), 1.4, 0.4)
      ]
    }
  }
]

export const DRILL_SECONDS = DRILL.reduce((t, m) => t + m.seconds, 0)

export interface DrillNow {
  index: number
  move: DrillMove
  /** Seconds left in this move. */
  left: number
  /** Seconds left in the whole drill. */
  total: number
  done: boolean
  /** The figure now. */
  frame: Frame
}

/** Where the drill is `t` seconds in (the figure loops its own move). */
export function drillAt(t: number, moves: DrillMove[] = DRILL): DrillNow {
  const all = moves.reduce((s, m) => s + m.seconds, 0)
  const tt = Math.max(0, t)
  let rest = Math.min(tt, all - 1e-6)
  let index = 0
  while (index < moves.length - 1 && rest >= moves[index].seconds) {
    rest -= moves[index].seconds
    index++
  }
  const move = moves[index]
  return { index, move, left: Math.max(0, Math.ceil(move.seconds - rest)), total: Math.max(0, Math.ceil(all - tt)), done: tt >= all, frame: frameAt(move.anim, rest) }
}

/** The posture card's line when it offers the drill. */
export const DRILL_LINE = '60 s: chin tucks, chest, hips, wall angels'
