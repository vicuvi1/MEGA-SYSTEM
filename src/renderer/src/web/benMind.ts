// "Ben understands you and remembers" on the database (the pure parts live in
// core: benFacts, benConvo, benLearn, benPromise, benSmartRemind, benBreak,
// benTools). Shared by the browser and the server (the same mirror copy).
//
// Where it lives (all in the synced `settings` table, never in the repo):
// - `ben_know`: preferences (durations, default times, aliases) and the
//   memory offers waiting for Yes / No;
// - `coach_memory`: the facts (as before; an accepted offer is a confirmed
//   fact with its source);
// - `coach_mind`: people and goals (as before);
// - `ben_convo`: key points of past chats and the rolling summary;
// - `ben_learn`: the plan of each of the last 30 days (to learn real pace);
// - `ben_pushbacks`: when each open task was first due (to spot big tasks
//   that keep moving);
// - `coach_reminders`: promises and smart reminders, with the other check-ins.
import { getSetting, setSetting } from '../../../main/settings'
import { BEN_KNOW, addOffer, addPref, cleanKnow, forgetPlan, prefText, readCorrection, takeOffer, type Know, type Offer, type Pref, type Source } from '@core/benFacts'
import { BEN_CONVO, addMoment, addPoint, cleanConvo, rollSummary, searchPoints, type Convo, type ConvoPoint } from '@core/benConvo'
import { BEN_LEARN, cleanLearn, keepPlan, learnRhythm, plannedRows, type BlockResult, type Rhythm, type SessionRow } from '@core/benLearn'
import { BEN_PUSHBACKS, cleanPushbacks, notePushbacks, staleBig } from '@core/benBreak'
import { askedToBuy, pickByName, saidHabit, type ToolAction } from '@core/benTools'
import { addDays } from '@core/dates'
import { factType, type Fact } from '@core/factTypes'
import { cleanBlocks } from '@core/benMemory'
import { loadMemory, loadMind, saveMind, saveMemory } from './botBrain'
import { addMemLog, factChanges, loadBlocks, saveBlocks } from './memoryStore'
import { saveLifeFit } from './lifeFitStore'
import { DAY_LOG } from './dayLog'
import { habitsView, tapHabit, untapHabit } from './lifeExtras'
import type { Services } from './webServices'

const parse = (raw: string | null) => {
  try {
    return JSON.parse(raw || 'null')
  } catch {
    return null
  }
}

export const loadKnow = (db: any): Know => cleanKnow(parse(getSetting(db, BEN_KNOW)))
export const saveKnow = (db: any, k: Know): void => setSetting(db, BEN_KNOW, JSON.stringify(cleanKnow(k)))
export const loadConvo = (db: any): Convo => cleanConvo(parse(getSetting(db, BEN_CONVO)))
export const saveConvo = (db: any, c: Convo): void => setSetting(db, BEN_CONVO, JSON.stringify(cleanConvo(c)))

/** What one undo of a memory change puts back. */
export type KnowUndo = { k: 'pref'; id: string; prev: Pref | null } | { k: 'fact'; text: string }

// ---- LS6: a correction, saved at once ------------------------------------------

/** "no, curata camera takes 40 min" → saved; the result line and its undo, or null when it isn't one. */
export function saveCorrection(db: any, text: string, src: Source, now = new Date()): { line: string; undo: KnowUndo } | null {
  const c = readCorrection(text)
  if (!c) return null
  const r = addPref(loadKnow(db), c, src, now)
  saveKnow(db, r.know)
  return { line: `📌 Remembered: ${prefText(r.pref)}`, undo: { k: 'pref', id: r.pref.id, prev: r.prev } }
}

// ---- ME1: offers (Ben asks, Yes saves) ---------------------------------------

export function queueOffer(db: any, o: Pick<Offer, 'text' | 'kind' | 'work'>, src: Source, now = new Date()): Offer | null {
  const r = addOffer(loadKnow(db), o, src, now)
  if (r.offer) saveKnow(db, r.know)
  return r.offer
}

/** Yes: the fact is saved (a shift also goes into My life). No: it is dropped. The line for the chat. */
export function answerOffer(db: any, id: string, yes: boolean, now = new Date()): { line: string; undo: KnowUndo | null } {
  const r = takeOffer(loadKnow(db), id)
  if (!r.offer) return { line: '⚠️ That question is already answered', undo: null }
  saveKnow(db, r.know)
  if (!yes) return { line: `🙅 Not remembered: ${r.offer.text}`, undo: null }
  addFact(db, r.offer.text, r.offer.src, now)
  if (r.offer.work) saveLifeFit(db, { work: { on: true, from: r.offer.work.from, to: r.offer.work.to, ...(r.offer.work.days ? { days: r.offer.work.days } : {}) } } as any)
  return { line: `📌 Remembered: ${r.offer.text}${r.offer.work ? ' (also in My life)' : ''}`, undo: { k: 'fact', text: r.offer.text } }
}

/** A confirmed fact (he said yes, or wrote it on the memory page), with where it came from. */
export function addFact(db: any, text: string, src: string, now = new Date()): void {
  const m = loadMemory(db)
  const day = now.toISOString().slice(0, 10)
  const t = text.trim().slice(0, 200)
  const facts = [...m.facts.filter((f) => f.t.toLowerCase() !== t.toLowerCase()), { t, at: day, type: factType(t), conf: 1, seen: 1, src } as Fact]
  saveMemory(db, { ...m, facts })
  addMemLog(db, factChanges(m.facts, facts, src === 'you' ? 'you' : 'ben', now))
}

/** Takes back a memory change (Undo in the chat). */
export function undoKnow(db: any, op: KnowUndo): string {
  if (op.k === 'pref') {
    const k = loadKnow(db)
    const prefs = k.prefs.filter((p) => p.id !== op.id)
    saveKnow(db, { ...k, prefs: op.prev ? [...prefs, op.prev] : prefs })
    return op.prev ? `↩ Back to: ${prefText(op.prev)}` : '↩ Forgotten again'
  }
  const m = loadMemory(db)
  saveMemory(db, { ...m, facts: m.facts.filter((f) => f.t !== op.text) })
  return `↩ Forgotten: ${op.text}`
}

// ---- ME1: the "What Ben knows about me" page --------------------------------

export type KnowKind = 'fact' | 'preference' | 'habit' | 'goal' | 'person'
export interface KnowItem {
  id: string
  kind: KnowKind
  text: string
  /** Where it came from, in plain words. */
  source: string
  /** YYYY-MM-DD or ISO. */
  at: string
  pinned?: boolean
  editable: boolean
}
export interface KnowView {
  items: KnowItem[]
  offers: Offer[]
  convo: { summary: string; points: ConvoPoint[] }
}

const SRC: Record<string, string> = { app: 'Chat in the app', telegram: 'Telegram', you: 'You wrote it', ben: 'Ben noticed', learned: 'Learned from your logs', tidy: 'Night tidy-up', mcp: 'An AI app' }
const srcText = (s?: string) => (s ? (SRC[s] ?? s) : 'Ben noticed')
const hash = (t: string) => {
  let h = 0
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}

export function knowView(db: any): KnowView {
  const items: KnowItem[] = []
  for (const f of loadMemory(db).facts) {
    const kind: KnowKind = f.type === 'person' ? 'person' : f.type === 'goal' ? 'goal' : f.type === 'routine' ? 'habit' : f.type === 'preference' ? 'preference' : 'fact'
    items.push({ id: `f:${hash(f.t)}`, kind, text: f.t, source: srcText(f.src), at: f.at, ...(f.pin ? { pinned: true } : {}), editable: !f.pin })
  }
  for (const p of loadKnow(db).prefs) items.push({ id: `p:${p.id}`, kind: 'preference', text: prefText(p), source: srcText(p.src), at: p.at, editable: true })
  const mind = loadMind(db)
  for (const p of mind.people) items.push({ id: `pe:${hash(p.name)}`, kind: 'person', text: p.note ? `${p.name}: ${p.note}` : p.name, source: 'Ben noticed', at: p.at, editable: true })
  for (const g of mind.goals) items.push({ id: `g:${hash(g.title)}`, kind: 'goal', text: [g.title, g.deadline ? `by ${g.deadline}` : '', g.weekly ? `· ${g.weekly}/week` : ''].filter(Boolean).join(' '), source: 'Ben noticed', at: g.at, editable: true })
  const c = loadConvo(db)
  return { items: items.sort((a, b) => String(b.at).localeCompare(String(a.at))), offers: loadKnow(db).offers, convo: { summary: c.summary, points: c.points.slice(-30).reverse() } }
}

/** Changes one item's words (a preference is read again: "gym is always at 19"). */
export function editKnowItem(db: any, id: string, text: string, now = new Date()): KnowView {
  const t = text.trim()
  if (!t) return removeKnowItem(db, id)
  if (id.startsWith('f:')) {
    const m = loadMemory(db)
    const facts = m.facts.map((f) => (`f:${hash(f.t)}` === id && !f.pin ? { ...f, t: t.slice(0, 200), type: factType(t), at: now.toISOString().slice(0, 10), conf: 1, src: 'you' } : f))
    saveMemory(db, { ...m, facts })
    addMemLog(db, factChanges(m.facts, facts, 'you', now))
  } else if (id.startsWith('p:')) {
    const c = readCorrection(t)
    if (!c) throw new Error('Write it like "gym is always at 18" or "curata camera takes 40 min"')
    const k = loadKnow(db)
    const kept = { ...k, prefs: k.prefs.filter((p) => `p:${p.id}` !== id) }
    saveKnow(db, addPref(kept, c, 'you', now).know)
  } else if (id.startsWith('pe:')) {
    const mind = loadMind(db)
    const [name, ...note] = t.split(':')
    saveMind(db, { ...mind, people: mind.people.map((p) => (`pe:${hash(p.name)}` === id ? { ...p, name: name.trim(), note: note.join(':').trim(), at: now.toISOString().slice(0, 10) } : p)) })
  } else if (id.startsWith('g:')) {
    const mind = loadMind(db)
    saveMind(db, { ...mind, goals: mind.goals.map((g) => (`g:${hash(g.title)}` === id ? { ...g, title: t.slice(0, 120), at: now.toISOString().slice(0, 10) } : g)) })
  }
  return knowView(db)
}

export function removeKnowItem(db: any, id: string, now = new Date()): KnowView {
  if (id.startsWith('f:')) {
    const m = loadMemory(db)
    const facts = m.facts.filter((f) => f.pin || `f:${hash(f.t)}` !== id)
    saveMemory(db, { ...m, facts })
    addMemLog(db, factChanges(m.facts, facts, 'you', now))
  } else if (id.startsWith('p:')) {
    const k = loadKnow(db)
    saveKnow(db, { ...k, prefs: k.prefs.filter((p) => `p:${p.id}` !== id) })
  } else if (id.startsWith('pe:')) {
    const mind = loadMind(db)
    saveMind(db, { ...mind, people: mind.people.filter((p) => `pe:${hash(p.name)}` !== id) })
  } else if (id.startsWith('g:')) {
    const mind = loadMind(db)
    saveMind(db, { ...mind, goals: mind.goals.filter((g) => `g:${hash(g.title)}` !== id) })
  }
  return knowView(db)
}

/** "Forget everything about X": facts, preferences, offers, people, goals, lines of his notes, past-chat points. */
export function forgetAbout(db: any, about: string, now = new Date()): { removed: number; view: KnowView } {
  const m = loadMemory(db)
  const k = loadKnow(db)
  const mind = loadMind(db)
  const blocks = loadBlocks(db)
  const lines = blocks.filter((b) => !b.pinned).flatMap((b) => b.text.split('\n').map((line) => ({ block: b.name, line })))
  const plan = forgetPlan({ facts: m.facts, prefs: k.prefs, offers: k.offers, people: mind.people.map((p) => ({ name: p.name, who: p.note })), goals: mind.goals.map((g) => ({ text: g.title })), blockLines: lines }, about)
  const facts = m.facts.filter((f) => !plan.facts.includes(f.t))
  saveMemory(db, { ...m, facts })
  addMemLog(db, factChanges(m.facts, facts, 'you', now))
  saveKnow(db, { prefs: k.prefs.filter((p) => !plan.prefs.includes(p.id)), offers: k.offers.filter((o) => !plan.offers.includes(o.id)) })
  saveMind(db, { ...mind, people: mind.people.filter((p) => !plan.people.includes(p.name)), goals: mind.goals.filter((g) => !plan.goals.includes(g.title)) })
  if (plan.blockLines.length) saveBlocks(db, cleanBlocks(blocks.map((b) => (b.pinned ? b : { ...b, text: b.text.split('\n').filter((l) => !plan.blockLines.some((x) => x.block === b.name && x.line === l)).join('\n') }))))
  const c = loadConvo(db)
  const pts = c.points.filter((p) => !p.text.toLowerCase().includes(about.toLowerCase()))
  if (pts.length !== c.points.length) saveConvo(db, { ...c, points: pts })
  return { removed: plan.total + (c.points.length - pts.length), view: knowView(db) }
}

// ---- ME4: past chats -----------------------------------------------------------

/** His message's key point (if any) kept; the summary rebuilt once a day. */
export function notePast(db: any, text: string, day: string, now = new Date(), via?: string): void {
  const before = loadConvo(db)
  let c = addPoint(before, text, day, now, via)
  if (c.summaryDay !== day && c.points.length) c = rollSummary(c, day)
  if (c !== before) saveConvo(db, c)
}

/** LF12: a big shared moment (boss beaten, season closed) kept in his memory store for his arc. */
export function noteMoment(db: any, text: string, day: string, now = new Date()): void {
  const before = loadConvo(db)
  const c = addMoment(before, text, day, now)
  if (c !== before) saveConvo(db, c)
}

/** The store D's chat search reads: key points that fit the words, newest first. */
export function searchPast(db: any, q: string, k = 8): ConvoPoint[] {
  return searchPoints(loadConvo(db), q, k)
}

// ---- ME2: his real rhythm --------------------------------------------------------

/** Today's plan blocks kept for learning (called whenever Ben reads today's plan). */
export function notePlan(db: any, day: string, blocks: { title: string; start: string; minutes: number }[]): void {
  if (!blocks.length) return
  const s = cleanLearn(parse(getSetting(db, BEN_LEARN)))
  const same = JSON.stringify(s.plans[day] ?? null) === JSON.stringify(blocks.slice(0, 12).map((b) => ({ title: String(b.title).slice(0, 80), start: b.start, minutes: Number(b.minutes) || 0 })))
  if (!same) setSetting(db, BEN_LEARN, JSON.stringify(keepPlan(s, day, blocks)))
}

/** What his logs say about his pace, best hours and skipped hours (the last 30 days). */
export function learnedRhythm(db: any, today: string): Rhythm {
  const from = addDays(today, -30)
  let sessions: SessionRow[] = []
  try {
    sessions = (db.prepare('SELECT day, subject, minutes, started_at FROM focus_sessions WHERE day >= ? AND day < ?').all(from, today) as any[]).map((r) => ({ day: String(r.day), subject: String(r.subject), minutes: Number(r.minutes), startedAt: String(r.started_at) }))
  } catch {
    sessions = []
  }
  const log = (parse(getSetting(db, DAY_LOG)) ?? {}) as Record<string, { blocks?: { at: string; title: string; result: 'done' | 'half' | 'no' }[] }>
  const results: BlockResult[] = Object.entries(log)
    .filter(([d]) => d >= from && d < today)
    .flatMap(([day, x]) => (x.blocks ?? []).map((b) => ({ day, ...b })))
  const planned = plannedRows(cleanLearn(parse(getSetting(db, BEN_LEARN))), today).filter((p) => p.day >= from)
  return learnRhythm({ planned, sessions, results })
}

// ---- TL2: big tasks that keep moving ---------------------------------------------

/** Notes when each open task was first due; gives the big ones pushed back more than 2 days. */
export function pushedBack(db: any, open: { id?: string; content: string; duration?: number | null; priority?: number }[], today: string): string[] {
  const p = notePushbacks(cleanPushbacks(parse(getSetting(db, BEN_PUSHBACKS))), open, today)
  setSetting(db, BEN_PUSHBACKS, JSON.stringify(p))
  return staleBig(p, open, today)
}

// ---- TL1: buy a reward, tick his own habit -----------------------------------------

export type ToolUndo = { k: 'buy'; ledgerId: number } | { k: 'myhabit'; id: string }

/** Runs a tool action (honest rules: his own words, the shop's own limits). */
export function runTool(svc: Services, a: ToolAction, text: string, finance?: any): { line: string; undo: ToolUndo | null } {
  if (a.kind === 'buy') {
    if (!askedToBuy(text)) return { line: `⚠️ Not bought: say "buy ${a.title}" yourself and I will`, undo: null }
    const list = (svc.shop.state().rewards ?? []) as { id: number; title: string; price: number }[]
    const r = pickByName(a.title, list, (x) => x.title)
    if (!r) return { line: `⚠️ No reward called "${a.title}" in your shop`, undo: null }
    try {
      const ledgerId = svc.shop.redeem(r.id, new Date(), { finance })
      return { line: `🎁 Bought: ${r.title} · −${r.price} points`, undo: { k: 'buy', ledgerId } }
    } catch (e) {
      return { line: `⚠️ ${String((e as Error).message).replace(/^FUN_EMPTY:\s*/, '')}`, undo: null }
    }
  }
  const view = habitsView(svc)
  const h = pickByName(a.name, view.rows as { id: string; name: string; done?: boolean }[], (x) => x.name)
  if (!h) return { line: `⚠️ No habit called "${a.name}" on your list`, undo: null }
  if (!saidHabit(text, h.name)) return { line: `⚠️ Not ticked: tell me you did "${h.name}" and I will`, undo: null }
  const r = tapHabit(svc, h.id)
  return { line: `✅ Habit: ${h.name}${r.paid ? ` · +${r.paid}` : ' (already ticked today)'}`, undo: r.paid ? { k: 'myhabit', id: h.id } : null }
}

export function undoTool(svc: Services, op: ToolUndo): string {
  if (op.k === 'buy') {
    svc.shop.undoBuy(op.ledgerId)
    return '↩ Reward bought back: points returned'
  }
  untapHabit(svc, op.id)
  return '↩ Habit unticked'
}
