// Ben's memory, the pure part (BR1, BR2, BR4):
// - memory blocks: a few named notes Ben keeps about you ("About you",
//   "Goals now", "How to coach you", "People"), always in his prompt, each
//   with a size cap; he edits them with strict actions, you can edit, pin
//   (then he can't touch it) and undo;
// - the change log: every change to a block or a remembered fact (by Ben,
//   by you, by the nightly tidy-up), with what it was before, so it can be undone;
// - the nightly tidy-up (mem0 style): the day's new facts and similar old ones
//   go to the model once, it answers ADD / UPDATE / DELETE / NOOP, and the
//   answer is checked and applied here (pinned facts are never changed);
// - the pieces of memory worth finding by meaning (facts, notes, chat days,
//   tasks…) with a hash, so only new or changed ones get embedded, and a
//   keyword recall for when there are no embeddings.
import type { Fact } from './factTypes'
import { toRecord } from './factTypes'

// ---- Memory blocks -------------------------------------------------------

export const BLOCK_NAMES = ['About you', 'Goals now', 'How to coach you', 'People'] as const
export type BlockName = (typeof BLOCK_NAMES)[number]
/** Characters per block: small enough to stay in every prompt. */
export const BLOCK_CAP = 600
const ALIASES: Record<string, BlockName> = { about: 'About you', me: 'About you', you: 'About you', goals: 'Goals now', goal: 'Goals now', coach: 'How to coach you', coaching: 'How to coach you', how: 'How to coach you', people: 'People', person: 'People' }

export interface MemBlock {
  name: BlockName
  text: string
  /** Pinned by you: Ben reads it but can't change it. */
  pinned?: boolean
  at: string
}

const clean = (t: unknown, n: number) =>
  String(t ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, n)

/** Always the four blocks, in order, each within its cap. */
export function cleanBlocks(raw: unknown): MemBlock[] {
  const list = Array.isArray(raw) ? raw : []
  return BLOCK_NAMES.map((name) => {
    const b = list.find((x: any) => x && x.name === name) as any
    return { name, text: clean(b?.text, BLOCK_CAP), pinned: !!b?.pinned, at: typeof b?.at === 'string' ? b.at : '' }
  })
}

/** "about", "People", "how to coach you" → the block's name; null when it isn't one. */
export function blockName(raw: string): BlockName | null {
  const t = String(raw ?? '').trim().toLowerCase().replace(/^["'[]+|["'\]]+$/g, '')
  return BLOCK_NAMES.find((n) => n.toLowerCase() === t) ?? ALIASES[t] ?? null
}

/** The blocks for Ben's prompt (empty ones too, so he knows they're there). */
export function blocksText(blocks: MemBlock[]): string {
  return blocks.map((b) => `[${b.name}] (${b.text.length}/${BLOCK_CAP}${b.pinned ? ', pinned by him: read only' : ''})\n${b.text || '(empty)'}`).join('\n')
}

export type BlockOp =
  | { op: 'add'; name: BlockName; text: string }
  | { op: 'fix'; name: BlockName; old: string; text: string }
  | { op: 'set'; name: BlockName; text: string }

/**
 * Ben's block actions, read strictly:
 * "blockadd: <block> | <text>" adds a line; "blockfix: <block> | <old> => <new>"
 * replaces text that is there word for word (empty new text removes it);
 * "blockset: <block> | <text>" rewrites the whole block (to make room).
 */
export function readBlockOp(line: string): BlockOp | null {
  const m = /^\s*block(add|fix|set)\s*:\s*([^|]{1,40})\|([\s\S]*)$/i.exec(String(line ?? ''))
  if (!m) return null
  const name = blockName(m[2])
  if (!name) return null
  const op = m[1].toLowerCase()
  const rest = m[3]
  if (op === 'fix') {
    const i = rest.indexOf('=>')
    if (i < 0) return null
    const old = clean(rest.slice(0, i), BLOCK_CAP)
    if (!old) return null
    return { op: 'fix', name, old, text: clean(rest.slice(i + 2), BLOCK_CAP) }
  }
  const text = clean(rest, BLOCK_CAP + 1)
  if (!text || text.length > BLOCK_CAP) return null
  return op === 'add' ? { op: 'add', name, text } : { op: 'set', name, text }
}

export type MemBy = 'ben' | 'you' | 'tidy'

/** One change to Ben's memory, with what it was before (for undo). */
export interface MemChange {
  id: string
  at: string
  by: MemBy
  what: 'block' | 'fact'
  /** The block's name, or "fact". */
  name: string
  before: string | null
  after: string | null
  why?: string
  undone?: boolean
}
export const MEM_LOG_MAX = 80

let seq = 0
export const changeId = (now: Date) => `m${now.getTime().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`

/** Applies one block change; pinned blocks and full blocks are refused (Ben gets a ⚠️ line). */
export function applyBlockOp(blocks: MemBlock[], op: BlockOp, by: MemBy, now = new Date()): { blocks: MemBlock[]; change: MemChange | null; line: string } {
  const list = cleanBlocks(blocks)
  const b = list.find((x) => x.name === op.name)!
  if (b.pinned && by !== 'you') return { blocks: list, change: null, line: `⚠️ "${op.name}" is pinned: only you can change it` }
  let next: string
  if (op.op === 'add') {
    next = b.text ? `${b.text}\n${op.text}` : op.text
    if (b.text.toLowerCase().includes(op.text.toLowerCase())) return { blocks: list, change: null, line: '' }
  } else if (op.op === 'fix') {
    const i = b.text.toLowerCase().indexOf(op.old.toLowerCase())
    if (i < 0) return { blocks: list, change: null, line: `⚠️ "${op.old.slice(0, 40)}" isn't in "${op.name}"` }
    next = (b.text.slice(0, i) + op.text + b.text.slice(i + op.old.length)).replace(/\n{2,}/g, '\n').trim()
  } else next = op.text
  if (next.length > BLOCK_CAP) return { blocks: list, change: null, line: `⚠️ "${op.name}" is full (${BLOCK_CAP} characters): rewrite it shorter first` }
  if (next === b.text) return { blocks: list, change: null, line: '' }
  const at = now.toISOString()
  const change: MemChange = { id: changeId(now), at, by, what: 'block', name: op.name, before: b.text, after: next }
  return { blocks: list.map((x) => (x === b ? { ...x, text: next, at } : x)), change, line: `📝 ${by === 'ben' ? 'Updated my notes' : 'Notes changed'}: ${op.name}` }
}

/** Adds changes to the log (newest last, capped). */
export function logChanges(log: unknown, add: (MemChange | null | undefined)[]): MemChange[] {
  const prev = Array.isArray(log) ? (log as MemChange[]).filter((c) => c && typeof c.id === 'string') : []
  return [...prev, ...add.filter((c): c is MemChange => !!c)].slice(-MEM_LOG_MAX)
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Takes one change back: a block gets its old text, a fact added is removed,
 * a fact deleted comes back, a fact changed gets its old words. The undo is
 * logged too (by you), and the old change is marked undone.
 */
export function undoChange(state: { blocks: MemBlock[]; facts: Fact[]; log: MemChange[] }, id: string, now = new Date()): { blocks: MemBlock[]; facts: Fact[]; log: MemChange[]; ok: boolean } {
  const c = state.log.find((x) => x.id === id)
  if (!c || c.undone) return { ...state, ok: false }
  let blocks = cleanBlocks(state.blocks)
  let facts = state.facts.slice()
  const today = now.toISOString().slice(0, 10)
  if (c.what === 'block') {
    const name = blockName(c.name)
    if (!name) return { ...state, ok: false }
    blocks = blocks.map((b) => (b.name === name ? { ...b, text: c.before ?? '', at: now.toISOString() } : b))
  } else {
    const at = c.after != null ? facts.findIndex((f) => norm(f.t) === norm(c.after!)) : -1
    if (c.before == null) {
      if (at >= 0) facts.splice(at, 1)
    } else if (at >= 0) facts[at] = { ...facts[at], t: c.before }
    else if (!facts.some((f) => norm(f.t) === norm(c.before!))) facts.push({ ...toRecord(c.before, today), at: today })
  }
  const back: MemChange = { id: changeId(now), at: now.toISOString(), by: 'you', what: c.what, name: c.name, before: c.after, after: c.before, why: 'undo' }
  return { blocks, facts, log: logChanges(state.log.map((x) => (x === c ? { ...x, undone: true } : x)), [back]), ok: true }
}

/** What Settings → Ben's notes about you shows. */
export interface MemoryView {
  blocks: MemBlock[]
  /** Newest first. */
  changes: MemChange[]
  facts: Fact[]
}

// ---- Facts: pins and the size cap -----------------------------------------

/** Keeps at most `max` facts: pinned ones always stay; the weakest, oldest unpinned go first. */
export function capFacts(facts: Fact[], max: number): { facts: Fact[]; dropped: Fact[] } {
  if (facts.length <= max) return { facts, dropped: [] }
  const pos = new Map(facts.map((f, i) => [f, i]))
  const rank = (f: Fact) => (f.conf ?? 0.6) + Math.min(5, f.seen ?? 1) * 0.1 + (pos.get(f)! / facts.length) * 0.5
  const loose = facts.filter((f) => !f.pin).sort((a, b) => rank(a) - rank(b))
  const drop = new Set(loose.slice(0, Math.max(0, facts.length - max)))
  return { facts: facts.filter((f) => !drop.has(f)), dropped: facts.filter((f) => drop.has(f)) }
}

// ---- The nightly tidy-up (mem0 style) ---------------------------------------

export interface TidyDecision {
  op: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'
  /** F-number of an existing fact (UPDATE, DELETE). */
  id?: string
  text?: string
  why?: string
}

/** The facts the tidy-up looks at: the new ones (F-numbers first) and similar old ones. */
export function tidyPrompt(fresh: Fact[], similar: Fact[], today: string): { prompt: string; ids: Map<string, Fact> } {
  const ids = new Map<string, Fact>()
  const line = (f: Fact) => {
    const id = `F${ids.size + 1}`
    ids.set(id, f)
    return `${id}${f.pin ? ' (pinned: keep)' : ''}: ${f.t} (noted ${f.at})`
  }
  const a = fresh.map(line)
  const b = similar.filter((f) => !fresh.includes(f)).map(line)
  const prompt = [
    `You keep the long-term memory of a coach about one person (Victor). Today is ${today}.`,
    'Below are facts noted today and older facts that look similar. Make the memory clean: one fact per idea, current, short, with dates.',
    'For each problem answer one decision:',
    '- UPDATE an old fact when a new one changes or adds to it (merge into one line, newest truth wins), then DELETE the duplicate new one.',
    '- DELETE a fact that is a duplicate, wrong now, or a one-off log with no lasting value.',
    '- ADD only to merge or reword two facts into one better line (then DELETE both).',
    '- NOOP when a fact is fine as it is.',
    'Never UPDATE or DELETE a pinned fact. Keep every date, name and number that is still true. Max 200 characters per fact.',
    '',
    '== New today ==',
    a.join('\n') || '(none)',
    '',
    '== Similar older facts ==',
    b.join('\n') || '(none)',
    '',
    'Answer ONLY with JSON: {"decisions": [{"op": "ADD"|"UPDATE"|"DELETE"|"NOOP", "id": "F2", "text": "…", "why": "…"}]} (id for UPDATE/DELETE, text for ADD/UPDATE).'
  ].join('\n')
  return { prompt, ids }
}

/** Reads the model's decisions strictly: known ops, known ids, short text. Anything else is dropped. */
export function parseTidy(raw: string, ids: Map<string, unknown>): TidyDecision[] {
  let j: any
  try {
    j = JSON.parse(String(raw ?? '').match(/\{[\s\S]*\}/)?.[0] ?? 'null')
  } catch {
    return []
  }
  const list = Array.isArray(j?.decisions) ? j.decisions : Array.isArray(j) ? j : []
  const out: TidyDecision[] = []
  for (const d of list.slice(0, 40)) {
    const op = String(d?.op ?? '').toUpperCase()
    const id = typeof d?.id === 'string' ? d.id.trim().toUpperCase() : undefined
    const text = typeof d?.text === 'string' ? clean(d.text, 200) : undefined
    const why = typeof d?.why === 'string' ? clean(d.why, 120) : undefined
    if (op === 'NOOP') continue
    if ((op === 'UPDATE' || op === 'DELETE') && (!id || !ids.has(id))) continue
    if ((op === 'UPDATE' || op === 'ADD') && !text) continue
    if (op !== 'ADD' && op !== 'UPDATE' && op !== 'DELETE') continue
    out.push({ op, ...(id && op !== 'ADD' ? { id } : {}), ...(text && op !== 'DELETE' ? { text } : {}), ...(why ? { why } : {}) })
  }
  return out
}

/**
 * Applies the decisions to the facts as they are now (found by their words,
 * since the list may have changed while the model thought). Pinned facts are
 * never changed or deleted; at most one change per fact; then the cap.
 */
export function applyTidy(facts: Fact[], decisions: TidyDecision[], ids: Map<string, Fact>, max: number, now = new Date()): { facts: Fact[]; changes: MemChange[] } {
  const today = now.toISOString().slice(0, 10)
  let list = facts.slice()
  const changes: MemChange[] = []
  const touched = new Set<string>()
  const find = (id?: string) => {
    const f = id ? ids.get(id) : undefined
    return f ? list.findIndex((x) => norm(x.t) === norm(f.t)) : -1
  }
  const log = (before: string | null, after: string | null, why?: string) => changes.push({ id: changeId(now), at: now.toISOString(), by: 'tidy', what: 'fact', name: 'fact', before, after, ...(why ? { why } : {}) })
  for (const d of decisions) {
    if (d.op === 'ADD') {
      const t = d.text!
      if (list.some((x) => norm(x.t) === norm(t))) continue
      list.push(toRecord(t, today))
      log(null, t, d.why)
      continue
    }
    const i = find(d.id)
    if (i < 0) continue
    const f = list[i]
    if (f.pin || touched.has(norm(f.t))) continue
    touched.add(norm(f.t))
    if (d.op === 'DELETE') {
      list.splice(i, 1)
      log(f.t, null, d.why)
    } else if (d.op === 'UPDATE' && norm(d.text!) !== norm(f.t)) {
      const dup = list.findIndex((x, k) => k !== i && norm(x.t) === norm(d.text!))
      list[i] = { ...f, t: d.text!, at: today }
      touched.add(norm(d.text!))
      if (dup >= 0 && !list[dup].pin) list.splice(dup, 1)
      log(f.t, d.text!, d.why)
    }
  }
  const capped = capFacts(list, max)
  list = capped.facts
  for (const f of capped.dropped) log(f.t, null, 'memory full: the weakest, oldest fact goes')
  return { facts: list, changes }
}

// ---- Pieces of memory to find by meaning (BR1) --------------------------------

export type DocKind = 'fact' | 'mind' | 'note' | 'story' | 'chat' | 'task' | 'block'
export interface MemDoc {
  /** Stable: "fact:<hash of its words>", "note:<id>:<part>", "chat:<day>", "task:<id>"… */
  id: string
  kind: DocKind
  text: string
}

/** A short, stable hash (FNV-1a, hex) of a text. */
export function textHash(t: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The id of a fact's piece ("fact:<hash of its words>"). */
export const factDocId = (f: { t: string }) => `fact:${textHash(norm(f.t))}`

export interface DocSources {
  facts: Fact[]
  mind?: { people: { name: string; note: string }[]; goals: { title: string; deadline: string; weekly: string }[]; works: { t: string }[]; fails: { t: string }[]; patterns: { t: string }[] }
  notes?: { id: string; title: string; body: string }[]
  story?: { week: string; text: string } | null
  /** Ben's chat (coach_log): one piece per day. */
  log?: { role: 'me' | 'coach'; text: string; at: string }[]
  tasks?: { id: string; content: string; due?: string | null }[]
  blocks?: MemBlock[]
}

const NOTE_PART = 700
const MAX_DOCS = 600

/** Every piece of memory worth finding by meaning, at most 600 (newest kept). */
export function memoryDocs(s: DocSources): MemDoc[] {
  const out: MemDoc[] = []
  const add = (kind: DocKind, id: string, text: string) => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t.length >= 4) out.push({ id: `${kind}:${id}`, kind, text: t.slice(0, 1000) })
  }
  for (const f of s.facts) add('fact', factDocId(f).slice(5), `${f.t} (noted ${f.at})`)
  const m = s.mind
  if (m) {
    for (const p of m.people) add('mind', `p:${textHash(p.name.toLowerCase())}`, `${p.name}: ${p.note}`)
    for (const g of m.goals) add('mind', `g:${textHash(g.title.toLowerCase())}`, `Goal: ${g.title}${g.deadline ? ` by ${g.deadline}` : ''}${g.weekly ? `, ${g.weekly} a week` : ''}`)
    for (const x of m.works) add('mind', `w:${textHash(norm(x.t))}`, `Works for him: ${x.t}`)
    for (const x of m.fails) add('mind', `f:${textHash(norm(x.t))}`, `Doesn't work for him: ${x.t}`)
    for (const x of m.patterns) add('mind', `t:${textHash(norm(x.t))}`, `Pattern: ${x.t}`)
  }
  for (const n of s.notes ?? []) {
    const body = n.body.trim()
    if (!body) continue
    // Long notes in parts (by lines), each with the note's title.
    const parts: string[] = []
    let cur = ''
    for (const l of body.split('\n')) {
      if (cur && cur.length + l.length > NOTE_PART) {
        parts.push(cur)
        cur = ''
      }
      cur = cur ? `${cur}\n${l}` : l
    }
    if (cur) parts.push(cur)
    parts.slice(0, 20).forEach((p, i) => add('note', `${n.id}:${i}`, `Note "${n.title}": ${p}`))
  }
  if (s.story?.text) add('story', s.story.week, `Story of his weeks (${s.story.week}): ${s.story.text}`)
  if (s.log?.length) {
    const byDay = new Map<string, string[]>()
    for (const e of s.log) {
      const day = String(e.at).slice(0, 10)
      const t = String(e.text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (!t) continue
      byDay.set(day, [...(byDay.get(day) ?? []), `${e.role === 'me' ? 'Victor' : 'Ben'}: ${t.slice(0, e.role === 'me' ? 200 : 110)}`])
    }
    // A day's chat only once it is over (today's keeps changing).
    const days = [...byDay.keys()].sort()
    for (const day of days.slice(0, -1)) add('chat', day, `Chat on ${day}: ${byDay.get(day)!.join(' · ')}`)
  }
  for (const t of s.tasks ?? []) add('task', t.id, `Task: ${t.content}${t.due ? ` (due ${t.due})` : ''}`)
  for (const b of s.blocks ?? []) if (b.text) add('block', textHash(b.name), `${b.name}: ${b.text}`)
  // Unique ids (a later duplicate wins), newest kept.
  const seen = new Map<string, MemDoc>()
  for (const d of out) seen.set(d.id, d)
  return [...seen.values()].slice(-MAX_DOCS)
}

/** What to embed (new or changed, at most `limit`) and which stored pieces are gone. */
export function planSync(docs: MemDoc[], stored: Map<string, string>, limit = 60): { embed: MemDoc[]; drop: string[] } {
  const want = new Set(docs.map((d) => d.id))
  const changed = docs.filter((d) => stored.get(d.id) !== textHash(d.text))
  // Facts and Ben's notes first (they are what he recalls most), then the rest.
  const order: Record<DocKind, number> = { fact: 0, block: 0, mind: 1, note: 2, story: 2, task: 3, chat: 4 }
  changed.sort((a, b) => order[a.kind] - order[b.kind])
  return { embed: changed.slice(0, limit), drop: [...stored.keys()].filter((id) => !want.has(id)) }
}

const WORD = /[\p{L}\p{N}]{3,}/gu
const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'was', 'have', 'his', 'him', 'not', 'but', 'what', 'all', 'can', 'out', 'get', 'has', 'had', 'how', 'just', 'now', 'from', 'about', 'when', 'will', 'did', 'does', 'its', 'too'])
const stems = (t: string) => new Set((t.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)))

/** The keyword fallback: pieces sharing the most words with the question (rarer words count more). */
export function keywordRecall(docs: MemDoc[], query: string, k = 6): MemDoc[] {
  const q = stems(query)
  if (!q.size) return []
  const df = new Map<string, number>()
  const each = docs.map((d) => stems(d.text))
  for (const s of each) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1)
  return docs
    .map((d, i) => ({ d, s: [...q].reduce((t, w) => t + (each[i].has(w) ? Math.log(1 + docs.length / (df.get(w) ?? 1)) : 0), 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.d)
}

/** Recalled pieces as prompt lines ("- [note] …"), skipping what the prompt already has. */
export function recallText(hits: { kind: string; text: string }[], already = ''): string {
  const have = norm(already)
  return hits
    .filter((h) => !have.includes(norm(h.text).slice(0, 60)))
    .map((h) => `- [${h.kind}] ${h.text.slice(0, 300)}`)
    .join('\n')
}
