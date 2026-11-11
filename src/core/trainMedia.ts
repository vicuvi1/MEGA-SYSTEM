// Sport Track's exercise demos, as a typed manifest: for each move, the demos
// we may show, best first, each with where it comes from, its licence and
// what we changed. Only bundle-safe, checked sources (docs/design/sport-track/
// media-research.md): Wikimedia Commons videos under CC BY 3.0 (FitnessScape),
// public domain (US military) and CC BY-SA 4.0 (kept in media/by-sa/), plus
// the Free Exercise DB photo pairs (the Unlicense) already in apps/sport/photos.
// Credits: apps/sport/media/NOTICE.md and media/by-sa/NOTICE.md.
//
// Honest by design: nothing here is AI-made, and no demo is called "verified"
// until the owner says so ("Looks right" / "Wrong demo" in Workout mode, saved
// as `trainMediaOk` in Sport Track's synced state, the newer answer wins). A
// demo marked wrong is never shown again for that move; with no demo left the
// page says "No verified demo yet" and shows the written steps. Pure and tested
// (trainMedia.test.ts). Nothing here pays points.
import { moveInfo, type Level } from './trainLadders'

export type MediaLicence = 'CC BY 3.0' | 'CC BY-SA 4.0' | 'Public domain' | 'The Unlicense'

export interface MediaItem {
  /** Stable id: what the owner's verdict is saved under. */
  id: string
  kind: 'video' | 'frames'
  /** A video: one webm. Photo frames: the start and the end of the move. */
  src: string[]
  /** The source file's title. */
  title: string
  author: string
  licence: MediaLicence
  licenceUrl: string
  /** Where it came from (the file page). */
  sourceUrl: string
  source: 'Wikimedia Commons' | 'Free Exercise DB'
  /** CC BY-SA: share-alike, kept in its own folder with its own notice. */
  shareAlike: boolean
  /** exact: this very move · close: a close match (the note says how it differs). */
  match: 'exact' | 'close'
  /** "Barbell back squat: the same squat pattern, without the bar for you." */
  note?: string
  /** What we changed (for the credits). */
  changes: string
  /** Has the owner confirmed the technique? Always false in the manifest: only his "Looks right" sets it. */
  verifiedTechnique: false
}

const CC_BY_3 = 'https://creativecommons.org/licenses/by/3.0/'
const CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/'
const PD_US = 'https://commons.wikimedia.org/wiki/Template:PD-USGov'
const UNLICENSE = 'https://unlicense.org/'
const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file.replace(/ /g, '_')}`
const VIDEO_CHANGES = 'Scaled from 720p to 540p, 24 fps, re-encoded to VP9, no audio.'

const v = (id: string, file: string, title: string, author: string, licence: MediaLicence, match: MediaItem['match'], note?: string, changes = VIDEO_CHANGES): MediaItem => {
  const sa = licence === 'CC BY-SA 4.0'
  return {
    id,
    kind: 'video',
    src: [`/apps/sport/media/${sa ? 'by-sa/' : ''}${file}`],
    title,
    author,
    licence,
    licenceUrl: licence === 'CC BY 3.0' ? CC_BY_3 : sa ? CC_BY_SA_4 : PD_US,
    sourceUrl: commons(title),
    source: 'Wikimedia Commons',
    shareAlike: sa,
    match,
    ...(note ? { note } : {}),
    changes,
    verifiedTechnique: false
  }
}

/** The bundled videos (src/renderer/public/apps/sport/media). */
export const VIDEOS = {
  squat: v('v-squat-fs', 'squat-fitnessscape.webm', 'Squat - exercise demonstration video.webm', 'FitnessScape', 'CC BY 3.0', 'close', 'A barbell back squat: the same squat pattern. Do yours without the bar.'),
  pullup: v('v-pullup-fs', 'pullup-fitnessscape.webm', 'Pull-ups - exercise demonstration video.webm', 'FitnessScape', 'CC BY 3.0', 'exact'),
  hangingLegRaise: v('v-hlr-fs', 'hanging-leg-raise-fitnessscape.webm', 'Leg raises - exercise demonstration video.webm', 'FitnessScape', 'CC BY 3.0', 'exact'),
  hangingKneeRaise: v('v-hkr-fs', 'hanging-knee-raise-fitnessscape.webm', 'Hanging crunches - exercise demonstration video.webm', 'FitnessScape', 'CC BY 3.0', 'close', 'Knees bent: the easier way to start hanging leg raises.'),
  singleLegSquat: v('v-slsq-rb', 'single-leg-squat-bennison.webm', 'Basic single leg squat.webm', 'RickyBennison', 'CC BY-SA 4.0', 'close', 'A free single-leg squat with the back knee bent (like a shrimp squat).', 'Re-encoded to VP9 at 24 fps, audio removed. Size kept (480×640).'),
  pushup: v('v-pushup-navy', 'pushup-navy.webm', 'Navy-seal-buds-training-push-ups.ogv', 'United States Navy', 'Public domain', 'exact', undefined, 'Cut to 6.5 s, letterbox cropped, scaled to 400p, 24 fps, converted to VP9 webm, no audio.'),
  lunge: v('v-lunge-army', 'forward-lunge-army.webm', 'Strength Training Circuit- Forward Lunge.webm', 'U.S. Army (Army Combat Fitness Test)', 'Public domain', 'close', 'Holding kettlebells: the same lunge. Do yours with no weight.', 'Cut to 10 s, scaled to 480p, 24 fps, re-encoded to VP9, no audio.')
} satisfies Record<string, MediaItem>

/** Moves with the two Free Exercise DB photo frames in /apps/sport/photos (<move>-0.webp start, <move>-1.webp end). */
export const PHOTO_MOVES: ReadonlySet<string> = new Set([
  'arm_circles', 'box_pistol', 'cat_cow', 'chair_dip', 'childs_pose', 'crunch', 'dead_bug', 'decline_pushup', 'diamond_pushup', 'glute_bridge', 'incline_pushup', 'jump_lunge', 'leg_raise', 'lunge', 'mountain_climber', 'plank', 'pushup', 'side_plank', 'single_leg_bridge', 'situp', 'split_squat', 'squat', 'star_jump', 'superman', 'table_row', 'v_up', 'wide_pushup', 'worlds_greatest'
])

const photoItem = (move: string): MediaItem => ({
  id: `p-${move}`,
  kind: 'frames',
  src: [`/apps/sport/photos/${move}-0.webp`, `/apps/sport/photos/${move}-1.webp`],
  title: `${moveInfo(move)?.name ?? move} (start and end)`,
  author: 'Free Exercise DB contributors',
  licence: 'The Unlicense',
  licenceUrl: UNLICENSE,
  sourceUrl: 'https://github.com/yuhonas/free-exercise-db',
  source: 'Free Exercise DB',
  shareAlike: false,
  match: 'exact',
  changes: 'Cropped and resized to 480×384 WebP.',
  verifiedTechnique: false
})

/** Videos per move (a move may use a close match; the note says how it differs). */
const VIDEO_FOR: Record<string, MediaItem[]> = {
  squat: [VIDEOS.squat],
  pullup: [VIDEOS.pullup],
  neg_pullup: [{ ...VIDEOS.pullup, match: 'close', note: 'A full pull-up. For negatives, only do the slow way down (5 s).' }],
  band_pullup: [{ ...VIDEOS.pullup, match: 'close', note: 'A pull-up without the band: the same path for your chest and elbows.' }],
  weighted_chinup: [{ ...VIDEOS.pullup, match: 'close', note: 'A pull-up with palms away and no backpack: the same path.' }],
  hanging_leg_raise: [VIDEOS.hangingLegRaise, VIDEOS.hangingKneeRaise],
  box_pistol: [{ ...VIDEOS.singleLegSquat, note: 'A free single-leg squat. For a box pistol, sit back to a chair or bed and stand up.' }],
  shrimp_squat: [VIDEOS.singleLegSquat],
  pushup: [VIDEOS.pushup],
  lunge: [VIDEOS.lunge],
  split_squat: [{ ...VIDEOS.lunge, match: 'close', note: 'A forward lunge with kettlebells. In a split squat your feet stay where they are.' }]
}

/** Video files actually bundled (a move only lists a video whose file ships). Kept in step with apps/sport/media by trainMedia.test.ts. */
export const BUNDLED_VIDEOS = new Set<string>(['squat-fitnessscape.webm', 'pullup-fitnessscape.webm', 'hanging-leg-raise-fitnessscape.webm', 'hanging-knee-raise-fitnessscape.webm', 'pushup-navy.webm', 'forward-lunge-army.webm', 'by-sa/single-leg-squat-bennison.webm'])

const bundled = (m: MediaItem) => m.kind !== 'video' || BUNDLED_VIDEOS.has(m.src[0].replace('/apps/sport/media/', ''))

/** Every demo we have for a move, best first: videos, then the photo frames (empty: no demo). */
export function mediaList(move: string): MediaItem[] {
  const out = (VIDEO_FOR[move] ?? []).filter(bundled)
  if (PHOTO_MOVES.has(move)) out.push(photoItem(move))
  return out
}

/** The owner's answers: media id → { ok, at }. */
export type MediaVerdicts = Record<string, { ok: boolean; at: number }>

export function cleanVerdicts(x: unknown): MediaVerdicts {
  const out: MediaVerdicts = {}
  if (!x || typeof x !== 'object') return out
  for (const [k, val] of Object.entries<any>(x)) if (val && typeof val.ok === 'boolean') out[k] = { ok: val.ok, at: Number(val.at) || 0 }
  return out
}

/** The demos to show for a move: every listed demo except those the owner marked wrong. */
export function mediaFor(move: string, verdicts: MediaVerdicts = {}): MediaItem[] {
  return mediaList(move).filter((m) => verdicts[m.id]?.ok !== false)
}

/** Did the owner confirm this demo's technique? */
export const isVerified = (m: MediaItem, verdicts: MediaVerdicts = {}) => verdicts[m.id]?.ok === true

/** "Video · FitnessScape · CC BY 3.0": the small tag on every demo. */
export function mediaTag(m: MediaItem): string {
  const kind = m.kind === 'video' ? 'Video' : 'Photo frames'
  return `${kind} · ${m.source === 'Free Exercise DB' ? 'Free Exercise DB' : m.author} · ${m.licence === 'The Unlicense' ? 'public domain' : m.licence}${m.match === 'close' ? ' · close match' : ''}`
}

/** Saves the owner's answer ("Looks right" true, "Wrong demo" false) in Sport Track's state. */
export function setVerdict(st: any, id: string, ok: boolean, now: number): void {
  st.trainMediaOk = { ...cleanVerdicts(st.trainMediaOk), [id]: { ok, at: now } }
}
/** Takes an answer back. */
export function clearVerdict(st: any, id: string): void {
  const m = cleanVerdicts(st.trainMediaOk)
  delete m[id]
  st.trainMediaOk = m
}

/** Two devices' answers: per demo, the newer one wins. */
export function mergeVerdicts(a: unknown, b: unknown): MediaVerdicts {
  const x = cleanVerdicts(a)
  const out: MediaVerdicts = { ...cleanVerdicts(b) }
  for (const [k, val] of Object.entries(x)) if (!out[k] || val.at >= out[k].at) out[k] = val
  return out
}

/** Moves done slowly on the way down. */
const NEGATIVES = new Set(['neg_pullup', 'oap_neg', 'wall_hspu_neg', 'nordic_neg', 'dragon_neg'])

/** The tempo tag on the demo: "2 s down · 1 s up", "5 s down · reset", "hold still · breathe". */
export function tempoFor(level: Pick<Level, 'move' | 'unit'>): string {
  if (level.unit === 'sec') return 'Hold still · breathe'
  if (NEGATIVES.has(level.move)) return '5 s down · reset'
  return '2 s down · 1 s up'
}

/** Three short movement cues for the line under the demo. */
const CUES: Record<string, string[]> = {
  knee_pushup: ['Hands under shoulders', 'hips in line with knees', 'chest to a fist above the floor'],
  pushup: ['Body one straight line', 'elbows about 45°', 'chest to a fist above the floor'],
  wide_pushup: ['Hands wider than shoulders', 'body one line', 'chest low, then press'],
  diamond_pushup: ['Hands together under the chest', 'elbows close to the body', 'chest touches the hands'],
  decline_pushup: ['Feet on a steady chair or bed', 'body one line', 'chest to a fist above the floor'],
  archer_pushup: ['Hands very wide', 'shift over one arm', 'the other arm stays straight'],
  table_row: ['Body straight under the table', 'pull chest to the edge', 'lower slowly'],
  neg_pullup: ['Start with chin over the bar', '5 seconds down', 'straight arms at the bottom'],
  pullup: ['Start from straight arms', 'chin over the bar', 'no kicking'],
  pike_pushup: ['Hips high, an upside-down V', 'head between the hands', 'elbows back, not out'],
  squat: ['Feet shoulder-width', 'hips back and down', 'knees follow the toes'],
  split_squat: ['Feet a big step apart', 'back knee nearly touches the floor', 'torso tall'],
  bulgarian_squat: ['Front knee over the toes', 'back knee nearly touches the floor', 'torso tall'],
  reverse_lunge: ['Step back, not to the side', 'back knee nearly touches the floor', 'push through the front heel'],
  lunge: ['Step forward', 'both knees bend to about 90°', 'push back to standing'],
  box_pistol: ['Sit back to the box on one leg', 'knee over the toes', 'stand up without a bounce'],
  glute_bridge: ['Heels close to the hips', 'squeeze the glutes up', 'ribs down, no arching'],
  single_leg_bridge: ['One foot down, one leg up', 'hips stay level', 'squeeze at the top'],
  plank: ['Elbows under shoulders', 'squeeze glutes and belly', 'body one line'],
  knee_raise: ['Low back pressed down', 'knees to the chest', 'lower slowly'],
  leg_raise: ['Low back pressed down', 'legs straight up', '2 seconds down'],
  hanging_leg_raise: ['Active shoulders', 'legs to hip height', 'no swinging']
}
export function cuesFor(move: string): string[] {
  if (CUES[move]) return CUES[move]
  return (moveInfo(move)?.steps ?? []).slice(0, 3).map((s) => s.replace(/\.$/, ''))
}
