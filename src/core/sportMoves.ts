// Sport Track's exercise library: real bodyweight moves you can do at home
// with no equipment (a chair, a table or a door at most), each with how to
// do it, the common mistake, the muscles, a difficulty from 1 to 5 and an
// animated demo (sportFigure.ts draws it). Moves in a family form a ladder
// from easier to harder (sportLadders.ts suggests the next step).
import { FLOOR, type Anim, type Pose, type Pt } from './sportFigure'

export type Group = 'push' | 'pull' | 'core' | 'legs' | 'cardio' | 'mobility'
export type Unit = 'reps' | 'sec'

export interface Move {
  id: string
  name: string
  group: Group
  /** Moves in the same family are one ladder, easiest first (see FAMILIES). */
  family: string
  /** 1 (anyone) … 5 (very hard). */
  diff: 1 | 2 | 3 | 4 | 5
  unit: Unit
  /** A daily target to start with, and one set. */
  start: number
  set: number
  muscles: string[]
  steps: string[]
  mistake: string
  /** Other names people type ("pushups", "press"…). */
  alias?: string[]
  anim: Anim
}

export const GROUPS: { id: Group; name: string; blurb: string }[] = [
  { id: 'push', name: 'Push', blurb: 'Chest, shoulders and arms' },
  { id: 'pull', name: 'Pull & back', blurb: 'Back and grip, no bar needed' },
  { id: 'core', name: 'Core', blurb: 'Abs and the middle of the body' },
  { id: 'legs', name: 'Legs', blurb: 'Thighs, glutes and calves' },
  { id: 'cardio', name: 'Cardio', blurb: 'Get the heart going' },
  { id: 'mobility', name: 'Mobility', blurb: 'Stretch and cool down' }
]

/** Each family's ladder, easiest first. */
export const FAMILIES: Record<string, { name: string; steps: string[] }> = {
  pushup: { name: 'Push-ups', steps: ['incline_pushup', 'knee_pushup', 'pushup', 'wide_pushup', 'diamond_pushup', 'decline_pushup', 'archer_pushup', 'planche_pushup'] },
  pike: { name: 'Shoulder push', steps: ['pike_pushup', 'elevated_pike'] },
  dips: { name: 'Dips', steps: ['chair_dip'] },
  row: { name: 'Rows', steps: ['door_row', 'table_row_bent', 'table_row'] },
  back: { name: 'Back', steps: ['superman', 'swimmer'] },
  core: { name: 'Abs', steps: ['crunch', 'situp', 'leg_raise', 'hollow_hold', 'v_up', 'dragon_flag'] },
  deadbug: { name: 'Dead bug', steps: ['dead_bug'] },
  plank: { name: 'Plank', steps: ['plank', 'side_plank', 'shoulder_taps', 'plank_updown'] },
  squat: { name: 'Squats', steps: ['squat', 'jump_squat', 'split_squat', 'bulgarian_squat', 'shrimp_squat', 'pistol_squat'] },
  lunge: { name: 'Lunges', steps: ['reverse_lunge', 'lunge', 'jump_lunge'] },
  bridge: { name: 'Glute bridge', steps: ['glute_bridge', 'single_leg_bridge'] },
  wallsit: { name: 'Wall sit', steps: ['wall_sit'] },
  calf: { name: 'Calves', steps: ['calf_raise', 'single_calf_raise'] },
  jacks: { name: 'Jumps', steps: ['jumping_jack', 'star_jump'] },
  knees: { name: 'High knees', steps: ['high_knees'] },
  climber: { name: 'Mountain climbers', steps: ['mountain_climber', 'cross_climber'] },
  burpee: { name: 'Burpees', steps: ['half_burpee', 'burpee', 'pushup_burpee'] },
  catcow: { name: 'Cat-cow', steps: ['cat_cow'] },
  dog: { name: 'Downward dog', steps: ['down_dog'] },
  wgs: { name: 'Lunge stretch', steps: ['worlds_greatest'] },
  circles: { name: 'Arm circles', steps: ['arm_circles'] },
  child: { name: "Child's pose", steps: ['childs_pose'] },
  cobra: { name: 'Cobra', steps: ['cobra'] },
  hinge: { name: 'Good morning', steps: ['good_morning'] }
}

// ---------- pose helpers ----------
const G = FLOOR
const D2R = Math.PI / 180
/** A point `r` away from `p` at `deg` degrees. */
const at = (p: Pt, r: number, deg: number): Pt => [+(p[0] + r * Math.cos(deg * D2R)).toFixed(2), +(p[1] + r * Math.sin(deg * D2R)).toFixed(2)]
/** Shoulders of a straight body from the ankles (planks, push-ups): 25 torso + 36.5 leg. */
const body = (ankle: Pt, deg: number, r = 61.5): Pt => at(ankle, r, deg)
const ST_ANKLES: [Pt, Pt] = [[62, 81.5], [57.5, 81.5]]
/** Standing, facing right, arms down. */
const stand = (o: Partial<Pose> = {}): Pose => ({ h: [60, 46.5], s: [60.5, 21.5], a: [[63, 46], [59.5, 46.5]], f: ST_ANKLES, ...o })
/** Up by `dy` (calf raises, jumps). */
const up = (p: Pose, dy: number): Pose => {
  const m = (q: Pt): Pt => [q[0], q[1] - dy]
  return { ...p, h: p.h && m(p.h), s: m(p.s), a: p.a && [m(p.a[0]), m(p.a[1])], f: [m(p.f[0]), m(p.f[1])], kn: p.kn && [p.kn[0] && m(p.kn[0]), p.kn[1] && m(p.kn[1])] }
}
const PL_ANKLE: Pt = [24, 79.5]
/** A straight-arm plank (push-up position): shoulders at `deg` from the ankles. */
const plank = (deg: number, o: Partial<Pose> = {}): Pose => ({ s: body(PL_ANKLE, deg), line: true, a: [[83, 82.5], [81, 82.5]], f: [PL_ANKLE, [25, 79.5]], ft: [68, 68], ...o })
/** Lying on the back, head to the right, knees bent and feet flat. */
const backKnees = (o: Partial<Pose> = {}): Pose => ({ h: [52, 79.5], s: [77, 79.5], f: [[33, 81.5], [34.5, 81.5]], kb: [1, 1], ft: [0, 0], a: [[58, 82.5], [56, 82.5]], ...o })
/** Crouched with hands on the floor (the start of a burpee). */
const crouch = (o: Partial<Pose> = {}): Pose => ({ h: [54, 66], s: at([54, 66], 25, -22), a: [[80, 82.5], [78, 82.5]], f: [[59, 80.5], [56, 80.5]], ft: [40, 40], ...o })
const jumpUp = (o: Partial<Pose> = {}): Pose => ({ h: [60, 38], s: [60.5, 13], a: [[66, -3], [62, -2]], f: [[62, 74.5], [57, 73.5]], ft: [62, 62], eb: [-1, -1], ...o })

/** Seconds per pose change, and how long to stay. */
const k = (p: Pose, t: number, hold = 0) => ({ p, t, hold })

// Push-ups: the ladder shares one body; the hands and angles change.
const PU_TOP = -21
const PU_LOW = -8
const pushAnim = (o: { hands?: Anim['hands']; a?: [Pt, Pt]; low?: number; lowA?: [Pt, Pt]; top?: number }): Anim => ({
  hands: o.hands ?? 'normal',
  keys: [k(plank(o.top ?? PU_TOP, o.a ? { a: o.a } : {}), 0.9, 0.35), k(plank(o.low ?? PU_LOW, o.lowA ? { a: o.lowA } : o.a ? { a: o.a } : {}), 1.0, 0.12)]
})

export const MOVES: Move[] = [
  // ---------------- PUSH ----------------
  {
    id: 'incline_pushup', name: 'Incline push-ups', group: 'push', family: 'pushup', diff: 1, unit: 'reps', start: 30, set: 10,
    muscles: ['Chest', 'Triceps', 'Shoulders'],
    steps: ['Put your hands on a sturdy chair, sofa or table, a little wider than your shoulders.', 'Walk your feet back until your body is one straight line.', 'Lower your chest to the edge, then push back up.'],
    mistake: 'Letting the hips sag: squeeze your glutes and keep the line straight.',
    alias: ['incline push up', 'incline pushups', 'wall pushups'],
    anim: {
      props: [{ k: 'box', x: 76, y: 60, w: 26 }],
      keys: [
        k({ s: body([40, 80.5], -44), line: true, a: [[89, 58.5], [87, 58.5]], f: [[40, 80.5], [41, 80.5]], ft: [55, 55] }, 0.9, 0.3),
        k({ s: body([40, 80.5], -32.5), line: true, a: [[89, 58.5], [87, 58.5]], f: [[40, 80.5], [41, 80.5]], ft: [55, 55] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'knee_pushup', name: 'Knee push-ups', group: 'push', family: 'pushup', diff: 1, unit: 'reps', start: 30, set: 10,
    muscles: ['Chest', 'Triceps', 'Shoulders'],
    steps: ['Start on your hands and knees, hands under your shoulders.', 'Walk the hands forward so your body is straight from the knees to the head.', 'Bend the elbows to bring your chest close to the floor, then push up.'],
    mistake: 'Bending at the hips: knees, hips and shoulders stay in one line.',
    alias: ['knee push up', 'knee pushups', 'kneeling pushups'],
    anim: {
      keys: [
        k({ s: at([46, 82], 43.5, -32), line: true, kn: [[46, 82], [47, 82]], a: [[84, 82.5], [82, 82.5]], f: [[30, 71], [31, 70]], ft: [160, 160] }, 0.9, 0.3),
        k({ s: at([46, 82], 43.5, -12), line: true, kn: [[46, 82], [47, 82]], a: [[84, 82.5], [82, 82.5]], f: [[30, 71], [31, 70]], ft: [160, 160] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'pushup', name: 'Push-ups', group: 'push', family: 'pushup', diff: 2, unit: 'reps', start: 50, set: 12,
    muscles: ['Chest', 'Triceps', 'Shoulders', 'Core'],
    steps: ['Hands on the floor under your shoulders, legs straight, on your toes.', 'Lower your whole body as one until the chest is a fist above the floor.', 'Push the floor away until your arms are straight.'],
    mistake: 'Elbows flaring straight out to the sides: keep them about 45° from your body.',
    alias: ['push ups', 'pushups', 'push-up', 'press ups', 'press-ups'],
    anim: pushAnim({})
  },
  {
    id: 'wide_pushup', name: 'Wide push-ups', group: 'push', family: 'pushup', diff: 2, unit: 'reps', start: 40, set: 10,
    muscles: ['Chest', 'Shoulders', 'Triceps'],
    steps: ['Set your hands about one and a half shoulder widths apart.', 'Lower slowly, elbows pointing out and back.', 'Press up to straight arms; keep your body in one line.'],
    mistake: 'Going too wide: if your shoulders hurt, bring the hands in a little.',
    alias: ['wide grip pushups'],
    anim: pushAnim({ hands: 'wide', a: [[85, 82.5], [83, 82.5]] })
  },
  {
    id: 'diamond_pushup', name: 'Diamond push-ups', group: 'push', family: 'pushup', diff: 3, unit: 'reps', start: 30, set: 8,
    muscles: ['Triceps', 'Chest', 'Shoulders'],
    steps: ['Put your hands together under your chest, thumbs and index fingers making a diamond.', 'Lower your chest to your hands, elbows close to your sides.', 'Push back up to straight arms.'],
    mistake: 'Hips piking up to make it easier: keep the line straight from heels to head.',
    alias: ['diamond pushups', 'triangle pushups', 'close grip pushups'],
    anim: pushAnim({ hands: 'diamond', a: [[79, 82.5], [78, 82.5]], low: -9 })
  },
  {
    id: 'decline_pushup', name: 'Decline push-ups', group: 'push', family: 'pushup', diff: 3, unit: 'reps', start: 30, set: 8,
    muscles: ['Upper chest', 'Shoulders', 'Triceps'],
    steps: ['Put your feet on a chair or the sofa, hands on the floor.', 'Keep your body straight and lower your chest towards the floor.', 'Push up until your arms are straight.'],
    mistake: 'Letting the lower back sag: brace your abs like someone will poke them.',
    alias: ['decline pushups', 'feet elevated pushups'],
    anim: {
      props: [{ k: 'box', x: 8, y: 60, w: 30 }],
      keys: [
        k({ s: body([28, 57.5], 1.5), line: true, a: [[88, 82.5], [86, 82.5]], f: [[28, 57.5], [29, 57.5]], ft: [70, 70] }, 0.9, 0.3),
        k({ s: body([28, 57.5], 13), line: true, a: [[88, 82.5], [86, 82.5]], f: [[28, 57.5], [29, 57.5]], ft: [70, 70] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'archer_pushup', name: 'Archer push-ups', group: 'push', family: 'pushup', diff: 4, unit: 'reps', start: 16, set: 6,
    muscles: ['Chest', 'Triceps', 'Shoulders'],
    steps: ['Hands very wide, fingers turned out.', 'Lower towards one hand while the other arm stays straight.', 'Push back to the middle and do the other side.'],
    mistake: 'Rushing it: go slow, the straight arm only helps a little.',
    alias: ['archer pushups'],
    anim: pushAnim({ hands: 'archer', a: [[82, 82.5], [104, 82.5]], low: -7, lowA: [[82, 82.5], [104, 82.5]] })
  },
  {
    id: 'planche_pushup', name: 'Pseudo-planche push-ups', group: 'push', family: 'pushup', diff: 5, unit: 'reps', start: 12, set: 5,
    muscles: ['Shoulders', 'Chest', 'Biceps', 'Core'],
    steps: ['Hands by your waist, fingers turned out to the sides.', 'Lean forward so your shoulders are well past your hands.', 'Lower and push up while keeping that lean.'],
    mistake: 'Losing the lean on the way up: the shoulders stay in front of the hands.',
    alias: ['pseudo planche pushups', 'planche pushups', 'pseudo planche'],
    anim: pushAnim({ hands: 'narrow', a: [[70, 82.5], [68.5, 82.5]], top: -19, low: -7 })
  },
  {
    id: 'pike_pushup', name: 'Pike push-ups', group: 'push', family: 'pike', diff: 3, unit: 'reps', start: 24, set: 8,
    muscles: ['Shoulders', 'Triceps', 'Upper back'],
    steps: ['Start in a push-up and walk your feet in so your hips go up: an upside-down V.', 'Bend the elbows to bring the top of your head towards the floor between your hands.', 'Push back up to straight arms.'],
    mistake: 'Moving the head straight down: it goes a little forward of your hands, like a triangle.',
    alias: ['pike pushups', 'pike push up'],
    anim: {
      keys: [
        k({ h: [61, 43], s: at([61, 43], 25, 42), a: [[86, 82.5], [84, 82.5]], f: [[46, 80.5], [47, 80.5]], ft: [30, 30] }, 0.9, 0.3),
        k({ h: [62, 47], s: at([62, 47], 25, 78), a: [[86, 82.5], [84, 82.5]], f: [[46, 80.5], [47, 80.5]], ft: [30, 30] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'elevated_pike', name: 'Feet-up pike push-ups', group: 'push', family: 'pike', diff: 4, unit: 'reps', start: 16, set: 6,
    muscles: ['Shoulders', 'Triceps', 'Upper back'],
    steps: ['Put your feet on a chair and walk your hands back until your hips are over your shoulders.', 'Lower your head towards the floor between your hands.', 'Press back up, like a handstand push-up made easier.'],
    mistake: 'A rounded back: push the floor away and keep your hips high.',
    alias: ['elevated pike pushups', 'feet elevated pike'],
    anim: {
      props: [{ k: 'box', x: 18, y: 58, w: 28 }],
      keys: [
        k({ h: [58, 37], s: at([58, 37], 25, 70), a: [[70, 82.5], [68.5, 82.5]], f: [[38, 55.5], [39, 55.5]], ft: [80, 80] }, 0.9, 0.3),
        k({ h: [60, 43], s: at([60, 43], 25, 92), a: [[70, 82.5], [68.5, 82.5]], f: [[38, 55.5], [39, 55.5]], ft: [80, 80] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'chair_dip', name: 'Chair dips', group: 'push', family: 'dips', diff: 2, unit: 'reps', start: 30, set: 10,
    muscles: ['Triceps', 'Shoulders', 'Chest'],
    steps: ['Sit on the edge of a sturdy chair, hands next to your hips, and slide off it.', 'Bend your elbows straight back to lower your hips towards the floor.', 'Push up until your arms are straight.'],
    mistake: 'Shrugging the shoulders up to the ears: keep them down and back.',
    alias: ['dips', 'bench dips', 'tricep dips', 'triceps dips'],
    anim: {
      props: [{ k: 'box', x: 20, y: 58, w: 28 }],
      keys: [
        k({ h: [52, 55], s: [50, 30.5], a: [[47, 56.5], [45.5, 56.5]], f: [[74, 81.5], [72, 81.5]] }, 0.9, 0.3),
        k({ h: [53, 68], s: [51, 43.5], a: [[47, 56.5], [45.5, 56.5]], f: [[74, 81.5], [72, 81.5]] }, 1.0, 0.1)
      ]
    }
  },
  // ---------------- PULL & BACK ----------------
  {
    id: 'door_row', name: 'Doorway rows', group: 'pull', family: 'row', diff: 1, unit: 'reps', start: 30, set: 10,
    muscles: ['Upper back', 'Biceps', 'Rear shoulders'],
    steps: ['Stand in an open doorway and hold both sides of the frame at chest height.', 'Walk your feet in and lean back with straight arms, body straight.', 'Pull your chest to the frame, squeezing your shoulder blades, then lower slowly.'],
    mistake: 'Pulling with the arms only: start each rep by squeezing your shoulder blades together.',
    alias: ['door rows', 'door frame rows', 'towel rows'],
    anim: {
      props: [{ k: 'door', x: 92 }],
      keys: [
        k({ s: at([82, 81.5], 61.5, -110), line: true, a: [[89.5, 27], [88.5, 28]], f: [[82, 81.5], [80, 81.5]] }, 0.9, 0.3),
        k({ s: at([82, 81.5], 61.5, -98), line: true, a: [[89.5, 27], [88.5, 28]], f: [[82, 81.5], [80, 81.5]] }, 0.9, 0.3)
      ]
    }
  },
  {
    id: 'table_row_bent', name: 'Table rows, knees bent', group: 'pull', family: 'row', diff: 2, unit: 'reps', start: 24, set: 8,
    muscles: ['Back', 'Biceps', 'Rear shoulders'],
    steps: ['Lie under a sturdy table and hold its edge with both hands.', 'Bend your knees, feet flat, and lift your hips so your body is straight.', 'Pull your chest up to the table, then lower with control.'],
    mistake: 'Using a table that can tip: test it first, or use a low bar or the edge of a solid desk.',
    alias: ['table rows', 'inverted rows bent knees', 'bodyweight rows'],
    anim: {
      props: [{ k: 'table', x: 66, y: 40, w: 50 }],
      keys: [
        k({ s: [86, 68], line: true, kn: [[44, 63], [45, 63.5]], a: [[86, 42], [85, 42]], f: [[36, 80.5], [37, 80.5]], eb: [1, 1], ft: [0, 0] }, 0.9, 0.3),
        k({ s: [86, 52.5], line: true, kn: [[44, 63], [45, 63.5]], a: [[86, 42], [85, 42]], f: [[36, 80.5], [37, 80.5]], eb: [1, 1], ft: [0, 0] }, 0.9, 0.3)
      ]
    }
  },
  {
    id: 'table_row', name: 'Table rows', group: 'pull', family: 'row', diff: 3, unit: 'reps', start: 20, set: 8,
    muscles: ['Back', 'Biceps', 'Rear shoulders', 'Core'],
    steps: ['Lie under a sturdy table and hold its edge.', 'Straighten your legs, heels on the floor, body like a plank.', 'Pull your chest to the edge, pause, and lower slowly.'],
    mistake: 'Hips dropping on the way up: keep the body one straight line.',
    alias: ['inverted rows', 'australian pullups', 'australian pull ups'],
    anim: {
      props: [{ k: 'table', x: 66, y: 40, w: 50 }],
      keys: [
        k({ s: body([26, 79], -10.3), line: true, a: [[86, 42], [85, 42]], f: [[26, 79], [27, 79]], eb: [1, 1], ft: [-62, -62] }, 0.9, 0.3),
        k({ s: body([26, 79], -24), line: true, a: [[86, 42], [85, 42]], f: [[26, 79], [27, 79]], eb: [1, 1], ft: [-62, -62] }, 0.9, 0.3)
      ]
    }
  },
  {
    id: 'superman', name: 'Superman', group: 'pull', family: 'back', diff: 1, unit: 'reps', start: 30, set: 10,
    muscles: ['Lower back', 'Glutes', 'Upper back'],
    steps: ['Lie face down, arms stretched out in front of you.', 'Lift your arms, chest and legs a few centimetres off the floor.', 'Hold for a breath, then lower slowly.'],
    mistake: 'Cranking the neck up: look at the floor just in front of you.',
    alias: ['supermans', 'superman hold', 'back extensions'],
    anim: {
      keys: [
        k({ h: [56, 79.5], s: [81, 79.5], a: [[106, 80.5], [105, 80.5]], f: [[20, 80.5], [21, 80.5]], ft: [175, 175], hd: 8 }, 0.8, 0.3),
        k({ h: [56, 79.5], s: [80.5, 74.5], a: [[104, 69], [103, 70]], f: [[21, 73], [22, 74]], ft: [170, 170], hd: -4 }, 0.8, 0.6)
      ]
    }
  },
  {
    id: 'swimmer', name: 'Swimmers', group: 'pull', family: 'back', diff: 2, unit: 'reps', start: 30, set: 12,
    muscles: ['Lower back', 'Upper back', 'Glutes', 'Shoulders'],
    steps: ['Lie face down and lift your arms, chest and legs a little, like a superman.', 'Lift the right arm and left leg higher, then switch, like slow swimming.', 'Keep switching without touching down.'],
    mistake: 'Kicking fast: slow, small and controlled works the back more.',
    alias: ['swimmers', 'flutter swimmers'],
    anim: {
      keys: [
        k({ h: [56, 79.5], s: [80.5, 75], a: [[104, 68], [104.5, 76]], f: [[21, 77], [22, 71]], ft: [170, 170], hd: -4 }, 0.55),
        k({ h: [56, 79.5], s: [80.5, 75], a: [[104.5, 76], [104, 68]], f: [[21, 71], [22, 77]], ft: [170, 170], hd: -4 }, 0.55)
      ]
    }
  },
  // ---------------- CORE ----------------
  {
    id: 'crunch', name: 'Crunches', group: 'core', family: 'core', diff: 1, unit: 'reps', start: 40, set: 15,
    muscles: ['Abs'],
    steps: ['Lie on your back, knees bent, feet flat, fingertips behind your ears.', 'Curl your shoulders off the floor, pressing your lower back down.', 'Lower slowly, without resting on the floor.'],
    mistake: 'Pulling on your head: the hands only touch it, the abs do the work.',
    alias: ['crunches', 'press', 'abs', 'ab crunches', 'pres'],
    anim: {
      keys: [
        k(backKnees({ ar: [[7, -5], [6, -4]], eb: [1, 1] }), 0.7, 0.2),
        k(backKnees({ s: at([52, 79.5], 25, -27), ar: [[7, -5], [6, -4]], eb: [1, 1], bow: 2 }), 0.7, 0.25)
      ]
    }
  },
  {
    id: 'situp', name: 'Sit-ups', group: 'core', family: 'core', diff: 2, unit: 'reps', start: 40, set: 15,
    muscles: ['Abs', 'Hip flexors'],
    steps: ['Lie on your back, knees bent, feet flat or tucked under something.', 'Cross your arms on your chest and sit all the way up.', 'Roll back down one part of the spine at a time.'],
    mistake: 'Throwing yourself up with momentum: come up and down at the same steady speed.',
    alias: ['sit ups', 'situps', 'sit-up'],
    anim: {
      keys: [
        k(backKnees({ ar: [[3, 6], [1, 5]] }), 0.9, 0.15),
        k(backKnees({ s: at([52, 79.5], 25, -72), ar: [[8, 6], [7, 5]], bow: 3 }), 0.9, 0.2)
      ]
    }
  },
  {
    id: 'leg_raise', name: 'Leg raises', group: 'core', family: 'core', diff: 2, unit: 'reps', start: 30, set: 10,
    muscles: ['Lower abs', 'Hip flexors'],
    steps: ['Lie on your back, legs straight, hands flat by your hips.', 'Keep the legs straight and lift them until they point at the ceiling.', 'Lower them slowly and stop just above the floor.'],
    mistake: 'The lower back arching off the floor: lower only as far as you can keep it down.',
    alias: ['leg raises', 'lying leg raises', 'leg lifts'],
    anim: {
      keys: [
        k({ h: [58, 79.5], s: [83, 79.5], a: [[64, 82.5], [62, 82.5]], f: [[22, 78.5], [23, 78.5]], ft: [-95, -95] }, 1.0, 0.15),
        k({ h: [58, 79.5], s: [83, 79.5], a: [[64, 82.5], [62, 82.5]], f: [at([58, 79.5], 36.3, -97), at([58, 79.5], 36.3, -95)], ft: [-185, -185] }, 1.1, 0.25)
      ]
    }
  },
  {
    id: 'hollow_hold', name: 'Hollow hold', group: 'core', family: 'core', diff: 3, unit: 'sec', start: 60, set: 20,
    muscles: ['Abs', 'Hip flexors', 'Core'],
    steps: ['Lie on your back and press your lower back into the floor.', 'Lift your shoulders, arms and straight legs a little off the floor, like a banana.', 'Hold it and keep breathing.'],
    mistake: 'The lower back lifting: raise the legs higher or bend the knees until it stays down.',
    alias: ['hollow body hold', 'hollow body', 'hollow'],
    anim: {
      keys: [
        k({ h: [58, 79.5], s: [82.5, 74], a: [[107, 67], [106, 68]], f: [[23, 72], [24, 73]], ft: [-150, -150], bow: -2 }, 1.6),
        k({ h: [58, 79.5], s: [82.5, 75], a: [[107, 68.5], [106, 69.5]], f: [[23, 73.5], [24, 74.5]], ft: [-150, -150], bow: -2 }, 1.6)
      ]
    }
  },
  {
    id: 'v_up', name: 'V-ups', group: 'core', family: 'core', diff: 3, unit: 'reps', start: 24, set: 8,
    muscles: ['Abs', 'Hip flexors'],
    steps: ['Lie flat, arms stretched over your head.', 'Lift your arms and straight legs at the same time and reach for your toes.', 'Lower both slowly back to the floor.'],
    mistake: 'Bending the knees a lot to cheat: keep the legs as straight as you can.',
    alias: ['v ups', 'vups', 'v-up', 'jackknife'],
    anim: {
      keys: [
        k({ h: [60, 80], s: [85, 79.5], a: [[110, 78.5], [109, 79]], f: [[24, 79], [25, 79]], ft: [-95, -95] }, 0.8, 0.15),
        k({ h: [60, 80], s: at([60, 80], 25, -55), a: [[47, 51], [48, 52]], f: [at([60, 80], 36.3, -124), at([60, 80], 36.3, -123)], ft: [-160, -160], bow: 3 }, 0.75, 0.2)
      ]
    }
  },
  {
    id: 'dragon_flag', name: 'Dragon flag (lowering)', group: 'core', family: 'core', diff: 5, unit: 'reps', start: 10, set: 3,
    muscles: ['Abs', 'Core', 'Lats'],
    steps: ['Lie on a bench or the floor and hold something solid behind your head.', 'Swing your body up onto your upper back, straight from shoulders to toes.', 'Lower the straight body as slowly as you can.'],
    mistake: 'Bending at the hips: if you fold, bend the knees and lower that way first.',
    alias: ['dragon flags', 'dragon flag negatives'],
    anim: {
      props: [{ k: 'box', x: 44, y: 72, w: 62 }],
      keys: [
        k({ s: [80, 68], line: true, a: [[100, 71], [99, 71]], f: [at([80, 68], 61.5, -125), at([80, 68], 61.5, -124)], eb: [-1, -1], ft: [-125, -124] }, 0.9, 0.3),
        k({ s: [80, 68], line: true, a: [[100, 71], [99, 71]], f: [at([80, 68], 61.5, -165), at([80, 68], 61.5, -164)], eb: [-1, -1], ft: [-165, -164] }, 2.4, 0.2)
      ]
    }
  },
  {
    id: 'dead_bug', name: 'Dead bug', group: 'core', family: 'deadbug', diff: 1, unit: 'reps', start: 20, set: 10,
    muscles: ['Abs', 'Core'],
    steps: ['Lie on your back, arms pointing at the ceiling, knees bent at 90° above your hips.', 'Lower one arm behind you and the opposite leg towards the floor.', 'Come back and switch sides, lower back flat on the floor.'],
    mistake: 'Moving fast: slow reps, and breathe out as you reach.',
    alias: ['dead bugs', 'deadbug'],
    anim: {
      keys: [
        k({ h: [58, 79.5], s: [83, 79.5], a: [[84, 54], [83, 55]], f: [[40, 61], [41, 61.5]], kn: [[58, 61], [59, 61.5]], ft: [-90, -90] }, 0.8, 0.15),
        k({ h: [58, 79.5], s: [83, 79.5], a: [[108, 77], [83, 55]], f: [[40, 61], [22.5, 75.5]], kn: [[58, 61], [40, 77.5]], ft: [-90, -110] }, 0.9, 0.2),
        k({ h: [58, 79.5], s: [83, 79.5], a: [[84, 54], [83, 55]], f: [[40, 61], [41, 61.5]], kn: [[58, 61], [59, 61.5]], ft: [-90, -90] }, 0.8, 0.15),
        k({ h: [58, 79.5], s: [83, 79.5], a: [[84, 54], [108, 77]], f: [[22.5, 75.5], [41, 61.5]], kn: [[40, 77.5], [59, 61.5]], ft: [-110, -90] }, 0.9, 0.2)
      ]
    }
  },
  {
    id: 'plank', name: 'Plank', group: 'core', family: 'plank', diff: 1, unit: 'sec', start: 90, set: 30,
    muscles: ['Core', 'Shoulders', 'Glutes'],
    steps: ['Forearms on the floor, elbows under your shoulders.', 'Lift your body on your toes, straight from heels to head.', 'Squeeze glutes and abs and hold, breathing slowly.'],
    mistake: 'Hips too high or sagging: imagine a broom stick along your back.',
    alias: ['planks', 'forearm plank', 'elbow plank'],
    anim: {
      keys: [
        k({ s: [80, 69.5], line: true, a: [[93, 83], [92, 83]], f: [[19, 79.5], [20, 79.5]], ft: [68, 68] }, 1.8),
        k({ s: [80, 68.8], line: true, a: [[93, 83], [92, 83]], f: [[19, 79.5], [20, 79.5]], ft: [68, 68] }, 1.8)
      ]
    }
  },
  {
    id: 'side_plank', name: 'Side plank', group: 'core', family: 'plank', diff: 2, unit: 'sec', start: 60, set: 20,
    muscles: ['Side abs (obliques)', 'Core', 'Shoulders'],
    steps: ['Lie on your side, elbow under your shoulder, feet stacked.', 'Lift your hips until your body is a straight line.', 'Hold; reach the top arm up. Then the other side.'],
    mistake: 'Letting the hips drop towards the floor: push them up and keep them there.',
    alias: ['side planks'],
    anim: {
      keys: [
        k({ s: [78, 62], line: true, a: [[88, 83], [77, 36]], f: [[21, 80.5], [22, 79.5]], ft: [20, 20] }, 1.6),
        k({ s: [78, 63.5], h: [53.5, 70], a: [[88, 83], [77, 37]], f: [[21, 80.5], [22, 79.5]], ft: [20, 20] }, 1.6)
      ]
    }
  },
  {
    id: 'shoulder_taps', name: 'Plank shoulder taps', group: 'core', family: 'plank', diff: 2, unit: 'reps', start: 30, set: 12,
    muscles: ['Core', 'Shoulders', 'Chest'],
    steps: ['Start at the top of a push-up, feet a bit wider than usual.', 'Lift one hand and tap the opposite shoulder.', 'Put it back and tap with the other hand; keep the hips still.'],
    mistake: 'Hips rocking side to side: go slower and widen your feet.',
    alias: ['shoulder taps', 'plank taps'],
    anim: {
      keys: [
        plank(PU_TOP, { a: [[83, 82.5], [81, 82.5]] }),
        plank(PU_TOP, { a: [[82, 62], [81, 82.5]], eb: [1, 1] }),
        plank(PU_TOP, { a: [[83, 82.5], [81, 82.5]] }),
        plank(PU_TOP, { a: [[83, 82.5], [82, 62]] })
      ].map((p, i) => k(p, 0.35, i % 2 ? 0.15 : 0.05))
    }
  },
  {
    id: 'plank_updown', name: 'Plank up-downs', group: 'core', family: 'plank', diff: 3, unit: 'reps', start: 20, set: 8,
    muscles: ['Core', 'Triceps', 'Shoulders'],
    steps: ['Start in a forearm plank.', 'Put one hand down, then the other, and push up into a push-up position.', 'Lower back to the forearms one arm at a time. Switch the lead arm.'],
    mistake: 'Swinging the hips: keep them level the whole time.',
    alias: ['up downs', 'up-downs', 'plank walk ups', 'commandos'],
    anim: {
      keys: [
        k({ s: [80, 69.5], line: true, a: [[93, 83], [92, 83]], f: [[19, 79.5], [20, 79.5]], ft: [68, 68] }, 0.5, 0.2),
        k({ s: [78.5, 64], line: true, a: [[81, 82.5], [92, 83]], f: [[19, 79.5], [20, 79.5]], ft: [68, 68] }, 0.45, 0.05),
        k({ s: body([19, 79.5], -22), line: true, a: [[81, 82.5], [79.5, 82.5]], f: [[19, 79.5], [20, 79.5]], ft: [68, 68] }, 0.45, 0.2),
        k({ s: [78.5, 64], line: true, a: [[81, 82.5], [92, 83]], f: [[19, 79.5], [20, 79.5]], ft: [68, 68] }, 0.45, 0.05)
      ]
    }
  },
  // ---------------- LEGS ----------------
  {
    id: 'squat', name: 'Squats', group: 'legs', family: 'squat', diff: 1, unit: 'reps', start: 50, set: 15,
    muscles: ['Thighs (quads)', 'Glutes', 'Hamstrings'],
    steps: ['Feet shoulder-width apart, toes turned out a little.', 'Sit back and down like into a chair, arms forward, chest up.', 'Go until your thighs are level with the floor, then stand up.'],
    mistake: 'Knees falling inwards: push them out over your toes.',
    alias: ['squats', 'air squats', 'bodyweight squats', 'sit ups chair'],
    anim: {
      keys: [
        k(stand(), 0.9, 0.3),
        k({ h: [46, 62], s: at([46, 62], 25, -56), a: [[86, 38], [85, 39]], f: ST_ANKLES, eb: [-1, -1] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'jump_squat', name: 'Jump squats', group: 'legs', family: 'squat', diff: 2, unit: 'reps', start: 30, set: 10,
    muscles: ['Thighs (quads)', 'Glutes', 'Calves'],
    steps: ['Squat down with your arms back.', 'Jump up as high as you can, arms swinging up.', 'Land softly on your toes and sink straight into the next squat.'],
    mistake: 'Landing with straight, stiff legs: land quietly with bent knees.',
    alias: ['squat jumps', 'jumping squats'],
    anim: {
      keys: [
        k({ h: [46, 62], s: at([46, 62], 25, -50), a: [[44, 60], [43, 60]], f: ST_ANKLES }, 0.6, 0.12),
        k(jumpUp(), 0.32, 0.06),
        k(stand({ a: [[70, 33], [68, 34]], eb: [-1, -1] }), 0.3)
      ]
    }
  },
  {
    id: 'split_squat', name: 'Split squats', group: 'legs', family: 'squat', diff: 2, unit: 'reps', start: 30, set: 10,
    muscles: ['Thighs (quads)', 'Glutes'],
    steps: ['Take a long step forward and stay there, back heel up.', 'Lower straight down until the back knee almost touches the floor.', 'Push up through the front foot. Do all reps, then switch legs.'],
    mistake: 'The front knee shooting past the toes: step a bit longer and go straight down.',
    alias: ['split squat', 'static lunges'],
    anim: {
      keys: [
        k({ h: [58, 48], s: [59, 23], ar: [[6, 21], [4, 21]], f: [[77, 81.5], [40, 80.5]], ft: [12, 60] }, 0.9, 0.25),
        k({ h: [58, 63], s: [59.5, 38], ar: [[6, 21], [4, 21]], f: [[77, 81.5], [40, 80.5]], ft: [12, 60] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'bulgarian_squat', name: 'Bulgarian split squats', group: 'legs', family: 'squat', diff: 3, unit: 'reps', start: 24, set: 8,
    muscles: ['Thighs (quads)', 'Glutes', 'Balance'],
    steps: ['Stand a big step in front of a chair, the top of your back foot on the seat.', 'Lower straight down on the front leg.', 'Push back up through the front heel. Then the other leg.'],
    mistake: 'Standing too close to the chair: you need room for the front shin to stay upright.',
    alias: ['bulgarian split squat', 'bulgarians', 'rear foot elevated split squat'],
    anim: {
      props: [{ k: 'box', x: 12, y: 66, w: 28 }],
      keys: [
        k({ h: [56, 49], s: [57.5, 24], ar: [[6, 21], [4, 21]], f: [[75, 81.5], [33, 63]], ft: [12, 175] }, 0.9, 0.25),
        k({ h: [55, 63], s: [58, 38.5], ar: [[6, 21], [4, 21]], f: [[75, 81.5], [33, 63]], ft: [12, 175] }, 1.0, 0.1)
      ]
    }
  },
  {
    id: 'shrimp_squat', name: 'Shrimp squats', group: 'legs', family: 'squat', diff: 4, unit: 'reps', start: 16, set: 5,
    muscles: ['Thighs (quads)', 'Glutes', 'Balance'],
    steps: ['Stand on one leg and bend the other knee so that foot is behind you.', 'Lower on the standing leg until the back knee touches the floor.', 'Stand back up without the back foot touching down.'],
    mistake: 'Leaning far forward to cheat: keep the chest up, use a wall for balance at first.',
    alias: ['shrimp squat'],
    anim: {
      keys: [
        k({ h: [60, 47], s: [61.5, 22], a: [[86, 30], [52, 54]], f: [[62, 81.5], [41, 61]], kn: [null, [56, 64]], ft: [12, 190] }, 0.9, 0.3),
        k({ h: [53, 66], s: at([53, 66], 25, -63), a: [[88, 45], [46, 70]], f: [[62, 81.5], [31, 79.5]], kn: [null, [48.5, 81.5]], ft: [12, 185] }, 1.1, 0.1)
      ]
    }
  },
  {
    id: 'pistol_squat', name: 'Pistol squats', group: 'legs', family: 'squat', diff: 5, unit: 'reps', start: 12, set: 4,
    muscles: ['Thighs (quads)', 'Glutes', 'Balance', 'Core'],
    steps: ['Stand on one leg, the other leg straight out in front, arms forward.', 'Squat all the way down on the standing leg, the free leg off the floor.', 'Stand back up. Hold a door frame at first if you need to.'],
    mistake: 'The standing heel lifting: keep the whole foot flat and go down slowly.',
    alias: ['pistol squat', 'pistols', 'one leg squat', 'single leg squat'],
    anim: {
      keys: [
        k({ h: [60, 46.5], s: [61, 21.5], a: [[86, 26], [85, 27]], f: [[62, 81.5], at([60, 46.5], 36.3, 38)], ft: [12, -45], eb: [-1, -1] }, 1.0, 0.3),
        k({ h: [51, 69], s: at([51, 69], 25, -62), a: [[90, 47], [89, 48]], f: [[62, 81.5], at([51, 69], 36.3, -3)], ft: [12, -80], eb: [-1, -1] }, 1.2, 0.1)
      ]
    }
  },
  {
    id: 'reverse_lunge', name: 'Reverse lunges', group: 'legs', family: 'lunge', diff: 1, unit: 'reps', start: 30, set: 12,
    muscles: ['Thighs (quads)', 'Glutes', 'Hamstrings'],
    steps: ['Stand tall, hands on your hips.', 'Step one foot back and lower until both knees are bent about 90°.', 'Push off the back foot to stand up. Switch legs each rep.'],
    mistake: 'Stepping too short: the back step should be long enough that the front knee stays over the ankle.',
    alias: ['reverse lunge', 'back lunges'],
    anim: {
      keys: [
        k(stand({ ar: [[6, 21], [4, 21]], a: undefined }), 0.7, 0.15),
        k({ h: [53, 63], s: [54.5, 38], ar: [[6, 21], [4, 21]], f: [[64, 81.5], [33, 80.5]], ft: [12, 60] }, 0.8, 0.1),
        k(stand({ ar: [[6, 21], [4, 21]], a: undefined }), 0.7, 0.15),
        k({ h: [53, 63], s: [54.5, 38], ar: [[6, 21], [4, 21]], f: [[33, 80.5], [64, 81.5]], ft: [60, 12] }, 0.8, 0.1)
      ]
    }
  },
  {
    id: 'lunge', name: 'Lunges', group: 'legs', family: 'lunge', diff: 2, unit: 'reps', start: 30, set: 12,
    muscles: ['Thighs (quads)', 'Glutes', 'Balance'],
    steps: ['Stand tall with your hands on your hips.', 'Take a long step forward and lower the back knee towards the floor.', 'Push off the front foot back to standing. Switch legs.'],
    mistake: 'Leaning the body forward: keep the chest up and the body straight above the hips.',
    alias: ['lunges', 'forward lunges', 'walking lunges'],
    anim: {
      keys: [
        k(stand({ h: [50, 46.5], s: [50.5, 21.5], ar: [[6, 21], [4, 21]], a: undefined, f: [[52, 81.5], [47.5, 81.5]] }), 0.7, 0.15),
        k({ h: [62, 63], s: [63, 38], ar: [[6, 21], [4, 21]], f: [[80, 81.5], [45, 80.5]], ft: [12, 60] }, 0.8, 0.1),
        k(stand({ h: [50, 46.5], s: [50.5, 21.5], ar: [[6, 21], [4, 21]], a: undefined, f: [[52, 81.5], [47.5, 81.5]] }), 0.7, 0.15),
        k({ h: [62, 63], s: [63, 38], ar: [[6, 21], [4, 21]], f: [[45, 80.5], [80, 81.5]], ft: [60, 12] }, 0.8, 0.1)
      ]
    }
  },
  {
    id: 'jump_lunge', name: 'Jump lunges', group: 'legs', family: 'lunge', diff: 4, unit: 'reps', start: 20, set: 8,
    muscles: ['Thighs (quads)', 'Glutes', 'Calves'],
    steps: ['Start in a lunge, one foot forward.', 'Jump up and switch legs in the air.', 'Land softly in a lunge with the other foot forward and keep going.'],
    mistake: 'Landing on a straight front leg: land softly with the knee bent.',
    alias: ['jumping lunges', 'lunge jumps', 'split jumps'],
    anim: {
      keys: [
        k({ h: [62, 63], s: [63.5, 38], a: [[56, 55], [76, 44]], f: [[80, 81.5], [45, 80.5]], ft: [12, 60], eb: [1, -1] }, 0.35, 0.15),
        k({ h: [62, 45], s: [63, 20], a: [[70, 32], [56, 38]], f: [[68, 73], [55, 72]], ft: [50, 50], eb: [-1, 1] }, 0.28),
        k({ h: [62, 63], s: [63.5, 38], a: [[76, 44], [56, 55]], f: [[45, 80.5], [80, 81.5]], ft: [60, 12], eb: [-1, 1] }, 0.28, 0.15),
        k({ h: [62, 45], s: [63, 20], a: [[56, 38], [70, 32]], f: [[55, 72], [68, 73]], ft: [50, 50], eb: [1, -1] }, 0.28)
      ]
    }
  },
  {
    id: 'glute_bridge', name: 'Glute bridge', group: 'legs', family: 'bridge', diff: 1, unit: 'reps', start: 30, set: 15,
    muscles: ['Glutes', 'Hamstrings', 'Lower back'],
    steps: ['Lie on your back, knees bent, feet flat near your hips.', 'Push through your heels and lift your hips until knees, hips and shoulders line up.', 'Squeeze your glutes at the top, then lower slowly.'],
    mistake: 'Arching the lower back at the top: the lift comes from the glutes, not the back.',
    alias: ['glute bridges', 'hip bridge', 'bridges', 'hip thrusts'],
    anim: {
      keys: [
        k(backKnees({ h: [56, 79.5], s: [81, 79.5], f: [[35, 81.5], [36, 81.5]], a: [[62, 82.5], [60, 82.5]] }), 0.8, 0.2),
        k(backKnees({ h: [57, 64], s: [80.5, 76], f: [[35, 81.5], [36, 81.5]], a: [[64, 82.5], [62, 82.5]] }), 0.8, 0.4)
      ]
    }
  },
  {
    id: 'single_leg_bridge', name: 'Single-leg glute bridge', group: 'legs', family: 'bridge', diff: 3, unit: 'reps', start: 24, set: 10,
    muscles: ['Glutes', 'Hamstrings', 'Core'],
    steps: ['Lie on your back, one foot flat, the other leg straight up in the air.', 'Push through the heel on the floor to lift your hips.', 'Lower slowly. Do all reps, then the other leg.'],
    mistake: 'The hips tilting to one side: keep both hip bones level.',
    alias: ['single leg glute bridge', 'one leg bridge', 'single leg bridge'],
    anim: {
      keys: [
        k(backKnees({ h: [56, 79.5], s: [81, 79.5], f: [[35, 81.5], at([56, 79.5], 36.3, -128)], kn: [null, null], a: [[62, 82.5], [60, 82.5]], ft: [0, -40] }), 0.8, 0.2),
        k(backKnees({ h: [57, 64], s: [80.5, 76], f: [[35, 81.5], at([57, 64], 36.3, -160)], a: [[64, 82.5], [62, 82.5]], ft: [0, -70] }), 0.8, 0.4)
      ]
    }
  },
  {
    id: 'wall_sit', name: 'Wall sit', group: 'legs', family: 'wallsit', diff: 2, unit: 'sec', start: 90, set: 30,
    muscles: ['Thighs (quads)', 'Glutes'],
    steps: ['Stand with your back flat against a wall.', 'Slide down until your knees are bent at 90°, like sitting on an invisible chair.', 'Hold, back on the wall, and keep breathing.'],
    mistake: 'Feet too close to the wall: your knees should be over your ankles, not past your toes.',
    alias: ['wall sits', 'wall squat'],
    anim: {
      props: [{ k: 'wall', x: 34 }],
      keys: [
        k({ h: [40.5, 63], s: [40.5, 38], a: [[56, 60.5], [54, 61]], f: [[59.5, 81.5], [58, 81.5]], kn: [[59, 63], [57.5, 63.5]] }, 1.8),
        k({ h: [40.5, 63], s: [40.5, 38.8], a: [[56, 61], [54, 61.5]], f: [[59.5, 81.5], [58, 81.5]], kn: [[59, 63], [57.5, 63.5]] }, 1.8)
      ]
    }
  },
  {
    id: 'calf_raise', name: 'Calf raises', group: 'legs', family: 'calf', diff: 1, unit: 'reps', start: 50, set: 20,
    muscles: ['Calves'],
    steps: ['Stand tall, feet hip-width apart; hold a wall for balance if you like.', 'Rise onto the balls of your feet as high as you can.', 'Pause at the top, then lower slowly.'],
    mistake: 'Bouncing fast: the slow lowering is what builds the calves.',
    alias: ['calf raises', 'calves', 'heel raises', 'toe raises'],
    anim: {
      keys: [
        k(stand(), 0.6, 0.15),
        k(up(stand({ ft: [52, 52] }), 4), 0.6, 0.35)
      ]
    }
  },
  {
    id: 'single_calf_raise', name: 'Single-leg calf raises', group: 'legs', family: 'calf', diff: 2, unit: 'reps', start: 40, set: 15,
    muscles: ['Calves', 'Balance'],
    steps: ['Stand on one foot, the other bent behind you, a hand on a wall.', 'Rise as high as you can on the standing foot.', 'Lower slowly. Then the other leg.'],
    mistake: 'Only going halfway: full height at the top, heel all the way down at the bottom.',
    alias: ['single leg calf raises', 'one leg calf raises'],
    anim: {
      keys: [
        k(stand({ f: [[61, 81.5], [48, 66]], ft: [12, 120] }), 0.6, 0.15),
        k(up(stand({ f: [[61, 81.5], [48, 66]], ft: [52, 120] }), 4), 0.6, 0.35)
      ]
    }
  },
  // ---------------- CARDIO ----------------
  {
    id: 'jumping_jack', name: 'Jumping jacks', group: 'cardio', family: 'jacks', diff: 1, unit: 'reps', start: 60, set: 30,
    muscles: ['Whole body', 'Calves', 'Shoulders'],
    steps: ['Stand with your feet together, arms by your sides.', 'Jump your feet out wide while your arms swing up over your head.', 'Jump back to the start and keep a steady rhythm.'],
    mistake: 'Landing flat-footed: stay light on the balls of your feet.',
    alias: ['jumping jacks', 'star jumps easy', 'jacks'],
    anim: {
      front: true,
      keys: [
        k({ h: [60, 46.5], s: [60, 21.5], w: 6.5, hw: 3.5, a: [at([53.5, 21.5], 26.4, 95), at([66.5, 21.5], 26.4, 85)], f: [[57, 81.5], [63, 81.5]], ft: [170, 10] }, 0.3, 0.05),
        k({ h: [60, 43.5], s: [60, 18.5], w: 6.5, hw: 3.5, a: [at([53.5, 18.5], 26.4, -114), at([66.5, 18.5], 26.4, -66)], f: [[46, 79.5], [74, 79.5]], ft: [170, 10] }, 0.3, 0.05)
      ]
    }
  },
  {
    id: 'star_jump', name: 'Star jumps', group: 'cardio', family: 'jacks', diff: 3, unit: 'reps', start: 30, set: 10,
    muscles: ['Whole body', 'Thighs', 'Calves'],
    steps: ['Squat down a little, hands near your knees.', 'Explode up and spread your arms and legs wide like a star.', 'Land softly with bent knees and go straight into the next one.'],
    mistake: 'Landing with locked knees: land softly and absorb it.',
    alias: ['star jumps', 'star jump'],
    anim: {
      front: true,
      keys: [
        k({ h: [60, 59], s: [60, 34.5], w: 6.5, hw: 3.5, a: [[53, 58], [67, 58]], f: [[53, 81.5], [67, 81.5]], ft: [170, 10], kb: [1, -1], eb: [1, -1] }, 0.4, 0.12),
        k({ h: [60, 38], s: [60, 13], w: 6.5, hw: 3.5, a: [[39, -3], [81, -3]], f: [[40, 70], [80, 70]], ft: [160, 20], kb: [1, -1], eb: [1, -1] }, 0.32, 0.08),
        k({ h: [60, 47.5], s: [60, 22.5], w: 6.5, hw: 3.5, a: [[52, 46.5], [68, 46.5]], f: [[55, 81.5], [65, 81.5]], ft: [170, 10], kb: [1, -1], eb: [1, -1] }, 0.3)
      ]
    }
  },
  {
    id: 'high_knees', name: 'High knees', group: 'cardio', family: 'knees', diff: 2, unit: 'reps', start: 60, set: 30,
    muscles: ['Hip flexors', 'Thighs', 'Calves'],
    steps: ['Run on the spot, bringing each knee up to hip height.', 'Pump your arms like a sprinter.', 'Stay on the balls of your feet and keep it quick.'],
    mistake: 'Leaning back: keep the body tall or slightly forward.',
    alias: ['high knee', 'running in place', 'run in place'],
    anim: {
      keys: [
        k({ h: [60, 45.5], s: [61, 20.5], a: [[52, 36], [74, 29]], f: [[76, 63], [59, 80.5]], ft: [40, 55], eb: [1, -1] }, 0.25, 0.03),
        k({ h: [60, 45.5], s: [61, 20.5], a: [[74, 29], [52, 36]], f: [[59, 80.5], [76, 63]], ft: [55, 40], eb: [-1, 1] }, 0.25, 0.03)
      ]
    }
  },
  {
    id: 'mountain_climber', name: 'Mountain climbers', group: 'cardio', family: 'climber', diff: 2, unit: 'reps', start: 60, set: 30,
    muscles: ['Core', 'Shoulders', 'Hip flexors'],
    steps: ['Start at the top of a push-up.', 'Drive one knee towards your chest, then switch legs quickly.', 'Keep your hips low and your hands under your shoulders.'],
    mistake: 'Hips bouncing up high: keep them in line with the shoulders.',
    alias: ['mountain climbers', 'climbers'],
    anim: {
      keys: [
        k({ h: [58, 65.5], s: body(PL_ANKLE, PU_TOP), a: [[83, 82.5], [81, 82.5]], f: [[57, 76], [25, 79.5]], ft: [55, 68] }, 0.22, 0.04),
        k({ h: [58, 65.5], s: body(PL_ANKLE, PU_TOP), a: [[83, 82.5], [81, 82.5]], f: [[25, 79.5], [57, 76]], ft: [68, 55] }, 0.22, 0.04)
      ]
    }
  },
  {
    id: 'cross_climber', name: 'Cross-body mountain climbers', group: 'cardio', family: 'climber', diff: 3, unit: 'reps', start: 40, set: 20,
    muscles: ['Side abs (obliques)', 'Core', 'Shoulders'],
    steps: ['Start at the top of a push-up.', 'Drive one knee across your body towards the opposite elbow.', 'Switch legs quickly, hips low.'],
    mistake: 'Shoulders drifting back behind the hands: keep them stacked over the wrists.',
    alias: ['cross body mountain climbers', 'cross climbers', 'twisting mountain climbers'],
    anim: {
      keys: [
        k({ h: [58, 66], s: body(PL_ANKLE, PU_TOP), a: [[83, 82.5], [81, 82.5]], f: [[63, 74.5], [25, 79.5]], ft: [55, 68], bow: 1.5 }, 0.3, 0.06),
        k({ h: [58, 66], s: body(PL_ANKLE, PU_TOP), a: [[83, 82.5], [81, 82.5]], f: [[25, 79.5], [63, 74.5]], ft: [68, 55], bow: 1.5 }, 0.3, 0.06)
      ]
    }
  },
  {
    id: 'half_burpee', name: 'Squat thrusts', group: 'cardio', family: 'burpee', diff: 2, unit: 'reps', start: 30, set: 10,
    muscles: ['Whole body', 'Core', 'Thighs'],
    steps: ['Squat down and put your hands on the floor.', 'Jump your feet back into a push-up position.', 'Jump them back in to the squat, and repeat.'],
    mistake: 'Hips sagging when the feet land back: brace like a plank.',
    alias: ['squat thrust', 'half burpees', 'burpees no jump'],
    anim: {
      keys: [
        k(crouch(), 0.4, 0.12),
        k({ s: body([22, 79.5], -21.5), line: true, a: [[80, 82.5], [78, 82.5]], f: [[22, 79.5], [23, 79.5]], ft: [68, 68] }, 0.35, 0.15)
      ]
    }
  },
  {
    id: 'burpee', name: 'Burpees', group: 'cardio', family: 'burpee', diff: 3, unit: 'reps', start: 30, set: 10,
    muscles: ['Whole body', 'Chest', 'Thighs'],
    steps: ['From standing, squat and put your hands on the floor.', 'Jump your feet back to a plank, then jump them back in.', 'Jump up with your arms over your head. Land softly and repeat.'],
    mistake: 'Collapsing in the plank: keep a straight line before jumping in.',
    alias: ['burpees', 'burpee'],
    anim: {
      still: 1,
      keys: [
        k(stand({ a: [[64, 36], [62, 37]], eb: [-1, -1] }), 0.3, 0.05),
        k(crouch(), 0.38, 0.05),
        k({ s: body([22, 79.5], -21.5), line: true, a: [[80, 82.5], [78, 82.5]], f: [[22, 79.5], [23, 79.5]], ft: [68, 68] }, 0.32, 0.12),
        k(crouch(), 0.32, 0.05),
        k(jumpUp(), 0.38, 0.05)
      ]
    }
  },
  {
    id: 'pushup_burpee', name: 'Push-up burpees', group: 'cardio', family: 'burpee', diff: 4, unit: 'reps', start: 20, set: 8,
    muscles: ['Whole body', 'Chest', 'Triceps', 'Thighs'],
    steps: ['Squat, hands down, and jump your feet back to a plank.', 'Do one full push-up.', 'Jump the feet in and jump up with your arms high.'],
    mistake: 'Half push-ups when tired: do fewer burpees, but full push-ups.',
    alias: ['burpees with pushup', 'burpee pushups', 'full burpees'],
    anim: {
      still: 2,
      keys: [
        k(stand({ a: [[64, 36], [62, 37]], eb: [-1, -1] }), 0.3, 0.05),
        k(crouch(), 0.38, 0.05),
        k({ s: body([22, 79.5], -21.5), line: true, a: [[80, 82.5], [78, 82.5]], f: [[22, 79.5], [23, 79.5]], ft: [68, 68] }, 0.32, 0.08),
        k({ s: body([22, 79.5], -8), line: true, a: [[80, 82.5], [78, 82.5]], f: [[22, 79.5], [23, 79.5]], ft: [68, 68] }, 0.45, 0.05),
        k({ s: body([22, 79.5], -21.5), line: true, a: [[80, 82.5], [78, 82.5]], f: [[22, 79.5], [23, 79.5]], ft: [68, 68] }, 0.42, 0.05),
        k(crouch(), 0.32, 0.05),
        k(jumpUp(), 0.38, 0.05)
      ]
    }
  },
  // ---------------- MOBILITY ----------------
  {
    id: 'cat_cow', name: 'Cat-cow', group: 'mobility', family: 'catcow', diff: 1, unit: 'reps', start: 10, set: 10,
    muscles: ['Spine', 'Back', 'Neck'],
    steps: ['On hands and knees, hands under shoulders, knees under hips.', 'Breathe in: let the belly drop and look up (cow).', 'Breathe out: round your back up and tuck the chin (cat).'],
    mistake: 'Rushing: move slowly with your breath.',
    alias: ['cat cow', 'cat camel'],
    anim: {
      keys: [
        k({ h: [56, 64], s: [81, 57.5], a: [[82, 82.5], [81, 82.5]], kn: [[56, 82.5], [57, 82.5]], f: [[38, 82], [39, 82]], ft: [185, 185], bow: 5, hd: 35 }, 1.4, 0.3),
        k({ h: [56, 64], s: [81, 57.5], a: [[82, 82.5], [81, 82.5]], kn: [[56, 82.5], [57, 82.5]], f: [[38, 82], [39, 82]], ft: [185, 185], bow: -5, hd: -30 }, 1.4, 0.3)
      ]
    }
  },
  {
    id: 'down_dog', name: 'Downward dog', group: 'mobility', family: 'dog', diff: 1, unit: 'sec', start: 60, set: 30,
    muscles: ['Hamstrings', 'Calves', 'Shoulders', 'Back'],
    steps: ['From hands and knees, lift your hips up and back into an upside-down V.', 'Push the floor away, long back, heels reaching down.', 'Pedal your heels slowly and breathe.'],
    mistake: 'A round back to get the heels down: bend the knees a little and keep the back long.',
    alias: ['downward dog', 'down dog', 'downward facing dog'],
    anim: {
      keys: [
        k({ h: [64, 46], s: at([64, 46], 25, 52), a: [[92, 83], [91, 83]], f: [[47.5, 80.5], [48, 79.5]], ft: [5, 45] }, 0.9, 0.3),
        k({ h: [64, 46], s: at([64, 46], 25, 52), a: [[92, 83], [91, 83]], f: [[48, 79.5], [47.5, 80.5]], ft: [45, 5] }, 0.9, 0.3)
      ]
    }
  },
  {
    id: 'worlds_greatest', name: 'Lunge with a twist', group: 'mobility', family: 'wgs', diff: 2, unit: 'reps', start: 10, set: 10,
    muscles: ['Hips', 'Hamstrings', 'Upper back'],
    steps: ['Step into a long lunge and put both hands on the floor inside the front foot.', 'Lift the arm on the front-leg side and twist it up to the ceiling.', 'Bring it down and switch sides after a few.'],
    mistake: 'Letting the back knee carry you: keep the back leg long and strong.',
    alias: ["world's greatest stretch", 'worlds greatest stretch', 'lunge twist', 'spiderman lunge'],
    anim: {
      keys: [
        k({ h: [57, 66], s: at([57, 66], 25, -22), a: [[79, 82.5], [77, 82.5]], f: [[80, 81.5], [30, 79.5]], ft: [12, 60], hd: 20 }, 0.9, 0.3),
        k({ h: [57, 66], s: at([57, 66], 25, -30), a: [[76, 22], [77, 82.5]], f: [[80, 81.5], [30, 79.5]], ft: [12, 60], hd: -70, eb: [-1, 1] }, 1.0, 0.5)
      ]
    }
  },
  {
    id: 'arm_circles', name: 'Arm circles', group: 'mobility', family: 'circles', diff: 1, unit: 'reps', start: 20, set: 10,
    muscles: ['Shoulders', 'Upper back'],
    steps: ['Stand tall with your arms straight.', 'Draw big, slow circles with your arms, forward.', 'After 10, change direction.'],
    mistake: 'Shrugging: keep the shoulders down away from your ears.',
    alias: ['arm circle', 'shoulder circles'],
    anim: {
      keys: [0, -45, -90, -135, 180, 135, 90, 45].map((deg) => k(stand({ a: [at([60.5, 21.5], 26, deg), at([60.5, 21.5], 26, deg - 12)], eb: [-1, -1] }), 0.28))
    }
  },
  {
    id: 'childs_pose', name: "Child's pose", group: 'mobility', family: 'child', diff: 1, unit: 'sec', start: 60, set: 30,
    muscles: ['Lower back', 'Hips', 'Shoulders'],
    steps: ['Kneel and sit back on your heels.', 'Fold forward and stretch your arms out in front on the floor.', 'Rest your forehead down and breathe into your back.'],
    mistake: 'Holding your breath: slow breaths in and out through the nose.',
    alias: ['childs pose', 'child pose', 'rest pose'],
    anim: {
      keys: [
        k({ h: [40, 70], s: at([40, 70], 25, 14), a: [[90, 82.5], [89, 82.5]], kn: [[57, 82.5], [58, 82.5]], f: [[38.5, 82.5], [39.5, 82.5]], ft: [180, 180], bow: 3, hd: 8 }, 2),
        k({ h: [40.5, 69], s: at([40.5, 69], 25, 12), a: [[90, 82.5], [89, 82.5]], kn: [[57, 82.5], [58, 82.5]], f: [[38.5, 82.5], [39.5, 82.5]], ft: [180, 180], bow: 4.5, hd: 8 }, 2)
      ]
    }
  },
  {
    id: 'cobra', name: 'Cobra stretch', group: 'mobility', family: 'cobra', diff: 1, unit: 'reps', start: 10, set: 10,
    muscles: ['Abs', 'Lower back', 'Chest'],
    steps: ['Lie face down, hands under your shoulders.', 'Press up slowly, lifting your chest, hips staying on the floor.', 'Hold a breath at the top and lower down.'],
    mistake: 'Pushing too high and pinching the lower back: only go as far as feels good.',
    alias: ['cobra', 'seal stretch', 'upward dog'],
    anim: {
      keys: [
        k({ h: [54, 80], s: [79, 79.5], a: [[80, 82.5], [79, 82.5]], f: [[18, 80.5], [19, 80.5]], ft: [178, 178], hd: 10 }, 1.1, 0.3),
        k({ h: [54, 80], s: at([54, 80], 25, -52), a: [[74, 82.5], [73, 82.5]], f: [[18, 80.5], [19, 80.5]], ft: [178, 178], bow: -3, hd: -25 }, 1.1, 0.7)
      ]
    }
  },
  {
    id: 'good_morning', name: 'Good mornings', group: 'mobility', family: 'hinge', diff: 1, unit: 'reps', start: 20, set: 10,
    muscles: ['Hamstrings', 'Glutes', 'Lower back'],
    steps: ['Stand with feet hip-width, hands crossed on your chest.', 'With soft knees and a flat back, push your hips back and lean forward.', 'Stop when you feel the back of your legs, then stand tall.'],
    mistake: 'Rounding the back: the movement is at the hips, the back stays flat.',
    alias: ['good morning', 'hip hinge', 'hinges'],
    anim: {
      keys: [
        k(stand({ ar: [[4, 6], [2, 6]], a: undefined }), 1.0, 0.2),
        k({ h: [52, 49], s: at([52, 49], 25, -8), ar: [[4, 6], [2, 6]], f: ST_ANKLES }, 1.1, 0.3)
      ]
    }
  }
]

const BY_ID = new Map(MOVES.map((m) => [m.id, m]))
export const moveById = (id: string | null | undefined): Move | null => (id ? BY_ID.get(id) ?? null : null)

/** "Push-ups", "pushups", "PRESS" → the library move it is, or null. */
export function matchMove(name: string | null | undefined): Move | null {
  const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const n = norm(String(name ?? ''))
  if (!n) return null
  const squash = (s: string) => norm(s).replace(/ /g, '')
  const sq = n.replace(/ /g, '')
  for (const m of MOVES) {
    if (squash(m.name) === sq || squash(m.id) === sq) return m
    if ((m.alias ?? []).some((a) => squash(a) === sq)) return m
  }
  // "Pushups (slow)", "my squats": the longest name or alias inside it, as
  // whole words (so "Bench press" isn't the "press" of crunches).
  let best: Move | null = null
  let bestLen = 0
  const words = ` ${n} `
  for (const m of MOVES) {
    for (const a of [m.name, ...(m.alias ?? [])]) {
      const s = norm(a)
      if (s.length >= 6 && words.includes(` ${s} `) && s.length > bestLen) {
        best = m
        bestLen = s.length
      }
    }
  }
  return best
}
