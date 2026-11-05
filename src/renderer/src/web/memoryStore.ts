// Ben's memory blocks and the memory change log, stored in settings (synced
// to every device and the server, kept in backups): `coach_blocks` and
// `coach_memory_changes`. Shared by the app (Settings → Ben's notes about you),
// Ben's brain (webBots.ts) and the nightly tidy-up on the server.
import { BLOCK_CAP, applyBlockOp, cleanBlocks, logChanges, memoryDocs, readBlockOp, undoChange, changeId, type BlockOp, type MemBlock, type MemBy, type MemChange, type MemDoc, type MemoryView } from '@core/benMemory'
import { getSetting, setSetting } from '../../../main/settings'
import { loadLog, loadMemory, loadMind, loadStory, saveMemory } from './botBrain'
import { listNotes } from './notes'

export const BLOCKS_KEY = 'coach_blocks'
export const MEM_LOG_KEY = 'coach_memory_changes'

const parse = (raw: string | null) => {
  try {
    return JSON.parse(raw || 'null')
  } catch {
    return null
  }
}

export function loadBlocks(db: any): MemBlock[] {
  return cleanBlocks(parse(getSetting(db, BLOCKS_KEY)))
}
export function saveBlocks(db: any, blocks: MemBlock[]): void {
  setSetting(db, BLOCKS_KEY, JSON.stringify(cleanBlocks(blocks)))
}
export function loadMemLog(db: any): MemChange[] {
  return logChanges(parse(getSetting(db, MEM_LOG_KEY)), [])
}
export function addMemLog(db: any, add: (MemChange | null | undefined)[]): void {
  if (!add.some(Boolean)) return
  setSetting(db, MEM_LOG_KEY, JSON.stringify(logChanges(loadMemLog(db), add)))
}

/** Ben's block actions from one reply, applied in order; the ✅/⚠️ lines for the chat. */
export function runBlockOps(db: any, actions: string[], now = new Date()): string[] {
  const ops = actions.map(readBlockOp).filter((x): x is BlockOp => !!x)
  if (!ops.length) return []
  let blocks = loadBlocks(db)
  const changes: MemChange[] = []
  const lines: string[] = []
  for (const op of ops.slice(0, 6)) {
    const r = applyBlockOp(blocks, op, 'ben', now)
    blocks = r.blocks
    if (r.change) changes.push(r.change)
    if (r.line) lines.push(r.line)
  }
  if (changes.length) {
    saveBlocks(db, blocks)
    addMemLog(db, changes)
  }
  return [...new Set(lines)]
}

/** You edit a block (Settings): text and/or pin. Logged, so it can be undone. */
export function editBlock(db: any, name: string, patch: { text?: string; pinned?: boolean }, now = new Date()): MemBlock[] {
  let blocks = loadBlocks(db)
  const b = blocks.find((x) => x.name === name)
  if (!b) throw new Error('No such note')
  const changes: MemChange[] = []
  const text = typeof patch.text === 'string' ? patch.text.replace(/\r/g, '').trim() : null
  if (text != null && text !== b.text) {
    if (text.length > BLOCK_CAP) throw new Error(`Keep it under ${BLOCK_CAP} characters`)
    blocks = blocks.map((x) => (x === b ? { ...x, text, at: now.toISOString() } : x))
    changes.push({ id: changeId(now), at: now.toISOString(), by: 'you', what: 'block', name: b.name, before: b.text, after: text })
  }
  if (typeof patch.pinned === 'boolean') blocks = blocks.map((x) => (x.name === b.name ? { ...x, pinned: patch.pinned } : x))
  saveBlocks(db, blocks)
  addMemLog(db, changes)
  return loadBlocks(db)
}

/** You pin or unpin a remembered fact (pinned: never tidied away or changed). */
export function pinFact(db: any, text: string, on: boolean): void {
  const m = loadMemory(db)
  saveMemory(db, { ...m, facts: m.facts.map((f) => (f.t === text ? { ...f, pin: on || undefined } : f)) })
}

/** Takes one memory change back (Settings → Recent memory changes → Undo). */
export function undoMemory(db: any, id: string, now = new Date()): boolean {
  const m = loadMemory(db)
  const r = undoChange({ blocks: loadBlocks(db), facts: m.facts, log: loadMemLog(db) }, id, now)
  if (!r.ok) return false
  saveBlocks(db, r.blocks)
  saveMemory(db, { ...m, facts: r.facts })
  setSetting(db, MEM_LOG_KEY, JSON.stringify(r.log))
  return true
}

/** Logs facts Ben just learned (so they show in Recent changes and can be undone). */
export function factChanges(before: { t: string }[], after: { t: string }[], by: MemBy, now = new Date()): MemChange[] {
  const had = new Set(before.map((f) => f.t))
  return after.filter((f) => !had.has(f.t)).map((f) => ({ id: changeId(now), at: now.toISOString(), by, what: 'fact' as const, name: 'fact', before: null, after: f.t }))
}

/** Every piece of memory to find by meaning, from this copy of the database. */
export function docsFrom(db: any, tasks: { id: string; content: string; due?: string | null }[] = []): MemDoc[] {
  let notes: { id: string; title: string; body: string }[] = []
  try {
    notes = listNotes(db)
  } catch {
    notes = []
  }
  return memoryDocs({ facts: loadMemory(db).facts, mind: loadMind(db), notes, story: loadStory(db), log: loadLog(db), tasks, blocks: loadBlocks(db) })
}

/** Settings → Ben's notes about you: the blocks, the last 25 changes (newest first), the facts. */
export function memoryView(db: any): MemoryView {
  return { blocks: loadBlocks(db), changes: loadMemLog(db).slice(-25).reverse(), facts: loadMemory(db).facts }
}
