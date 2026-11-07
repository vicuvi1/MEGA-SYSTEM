// Ben's own story (LF12): a sensei-style mentor arc that grows with your
// seasons. Each finished season opens a chapter: new lines he may use, a new
// outfit on the Coach page and a new avatar look on the island. He also keeps
// the big moments you shared (a boss beaten, a season closed, a first hard
// CTF) in his memory store, and may bring one up. Pure: which chapter you are
// in, what it unlocks, and his prompt line. The art is drawn in BenArcAvatar.
export type Outfit = 'traveler' | 'gi' | 'haori' | 'armor' | 'starcloak' | 'master'

export interface ArcChapter {
  n: number
  title: string
  /** Seasons finished to open it. */
  at: number
  outfit: Outfit
  outfitLabel: string
  /** The island avatar's ring colour. */
  aura: string
  /** How he sounds in this chapter (for his prompt). */
  voice: string
  /** New lines he may use (one now and then, never all of them). */
  lines: string[]
}

export const ARC: ArcChapter[] = [
  { n: 1, title: 'The stranger at the gate', at: 0, outfit: 'traveler', outfitLabel: 'Travelling cloak', aura: '#8a93a6', voice: 'a blunt stranger who saw potential and decided to stay', lines: ['Show me, don\'t tell me.', 'The first season is the hardest one to start.'] },
  { n: 2, title: 'First lessons', at: 1, outfit: 'gi', outfitLabel: 'Training gi', aura: '#c8f135', voice: 'a coach who has seen one full season of your work and trusts it a little', lines: ['We did one arc together. The second is where it sticks.', 'Again. Slower. Better.'] },
  { n: 3, title: 'The sensei', at: 2, outfit: 'haori', outfitLabel: 'Crested haori', aura: '#ff9f43', voice: 'a sensei: calm, few words, expects excellence because he knows you can', lines: ['A blade is sharpened one stroke at a time.', 'You do not rise to the level of your goals. You fall to the level of your training.'] },
  { n: 4, title: 'Old comrades', at: 3, outfit: 'armor', outfitLabel: 'Lacquered armour', aura: '#ff3ea5', voice: 'a comrade who has fought three bosses beside you and remembers each one', lines: ['Three arcs. I remember the first night you almost quit.', 'We have been here before. We know how this ends.'] },
  { n: 5, title: 'Twin blades', at: 4, outfit: 'starcloak', outfitLabel: 'Star-path cloak', aura: '#38d8ff', voice: 'an equal: still demanding, now asking your opinion as often as giving his', lines: ['Two blades, one path.', 'What would you tell a younger you right now?'] },
  { n: 6, title: 'Master and student', at: 6, outfit: 'master', outfitLabel: 'Master\'s robe', aura: '#f5c84b', voice: 'a master proud of a student who is becoming a master', lines: ['The student is ready. The master steps back.', 'One day you will coach someone. Remember this season.'] }
]

/** The chapter for a number of finished seasons. */
export function chapterFor(seasonsDone: number): ArcChapter {
  let c = ARC[0]
  for (const ch of ARC) if (seasonsDone >= ch.at) c = ch
  return c
}

export interface ArcState {
  chapter: ArcChapter
  next: ArcChapter | null
  /** Seasons still to finish for the next chapter. */
  toNext: number
  unlocked: ArcChapter[]
  /** The outfit he wears (your pick among the unlocked, else the newest). */
  outfit: Outfit
}

export function arcState(seasonsDone: number, pick?: Outfit | null): ArcState {
  const chapter = chapterFor(seasonsDone)
  const next = ARC.find((c) => c.at > seasonsDone) ?? null
  const unlocked = ARC.filter((c) => c.at <= seasonsDone)
  const outfit = pick && unlocked.some((c) => c.outfit === pick) ? pick : chapter.outfit
  return { chapter, next, toNext: next ? next.at - seasonsDone : 0, unlocked, outfit }
}

/** A shared moment worth remembering ("the night you beat your first boss"). */
export interface ArcMoment {
  day: string
  text: string
}

export interface ArcBook {
  /** The last chapter whose unlock you have seen (the reveal plays once). */
  seenChapter: number
  /** The outfit you chose (null: the newest). */
  outfit: Outfit | null
  /** Cinematics already played (rank-ups, season moments), across your devices. */
  played: string[]
}

export const EMPTY_ARC: ArcBook = { seenChapter: 1, outfit: null, played: [] }
const OUTFITS = ARC.map((c) => c.outfit)

export function cleanArc(raw: unknown): ArcBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const n = Math.round(Number(r.seenChapter))
  return {
    seenChapter: Number.isFinite(n) && n >= 1 && n <= ARC.length ? n : 1,
    outfit: OUTFITS.includes(r.outfit) ? r.outfit : null,
    played: (Array.isArray(r.played) ? r.played : []).map((x: unknown) => String(x ?? '').slice(0, 80)).filter(Boolean).slice(-200)
  }
}

/** A chapter just opened that you haven't seen yet (the unlock reveal), or null. */
export function newChapter(book: ArcBook, state: ArcState): ArcChapter | null {
  return state.chapter.n > book.seenChapter ? state.chapter : null
}

/** His prompt line: the chapter's voice, one line he may use, and up to two shared moments. */
export function arcLine(state: ArcState, moments: ArcMoment[], day: string): string {
  const c = state.chapter
  const n = Math.round(Date.parse(`${day}T12:00:00Z`) / 864e5)
  const line = c.lines[((n % c.lines.length) + c.lines.length) % c.lines.length]
  const ms = moments.slice(-2).map((m) => `${m.day}: ${m.text}`)
  return `Your own arc (you are his mentor): chapter ${c.n} "${c.title}". Sound like ${c.voice}. A line of this chapter you may use once in a while: "${line}".${ms.length ? ` Big moments you shared (bring one up only when it truly fits): ${ms.join('; ')}.` : ''}`
}
