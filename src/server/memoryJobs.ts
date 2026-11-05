// Ben's memory jobs, run by the tick (src/server/telegramBot.ts):
// - BR1: every 20 minutes, new or changed pieces of memory get their
//   embeddings (one batch call, only what changed; nothing when nothing did);
// - BR2: once a night (03:00–05:00 local, one slot a day), the tidy-up: the
//   day's new facts and similar old ones go to the model once, which answers
//   ADD / UPDATE / DELETE / NOOP; the answer is checked and applied, logged
//   (Settings → Ben's notes about you → Recent memory changes, with undo).
//   No new facts: no call.
import { addDays } from '@core/dates'
import { applyTidy, factDocId, keywordRecall, memoryDocs, parseTidy, tidyPrompt } from '@core/benMemory'
import type { Fact } from '@core/factTypes'
import type { Mirror } from '../renderer/src/web/mirror'
import { MAX_FACTS, loadMemory, saveMemory } from '../renderer/src/web/botBrain'
import { addMemLog, docsFrom } from '../renderer/src/web/memoryStore'
import type { AskModel } from '../renderer/src/web/webBots'
import type { MemoryVectors } from './memoryVectors'

export interface MemoryJobDeps {
  mirror: Mirror
  vectors: MemoryVectors | null
  model?: AskModel
  /** One slot per key and gap (sys_kv), atomically. */
  claim: (key: string, gapMs: number) => Promise<boolean>
  /** Open Todoist tasks (titles worth finding by meaning), when connected. */
  tasks?: () => Promise<{ id: string; content: string; due?: string | null }[]>
  now: Date
}

/** Runs what is due; the names of the jobs that ran. Never throws. */
export async function memoryJobs(d: MemoryJobDeps): Promise<string[]> {
  const ran: string[] = []
  const hour = d.now.getHours()
  try {
    if (d.model && hour >= 3 && hour < 5 && (await d.claim('mem_tidy_at', 20 * 3600_000))) {
      const r = await tidyMemory(d)
      ran.push(`tidy:${r}`)
    }
  } catch (e) {
    console.error('memory tidy:', e)
  }
  try {
    if (d.vectors && (await d.claim('mem_embed_at', 20 * 60_000))) {
      // Task titles every 3 hours (the rest of the time the stored ones stay).
      const fresh = d.tasks && (await d.claim('mem_tasks_at', 3 * 3600_000))
      const tasks = fresh ? await d.tasks!().catch(() => null) : null
      const docs = await d.mirror.read((db) => docsFrom(db, (tasks ?? []).map((t) => ({ id: t.id, content: t.content, due: t.due ?? null }))))
      // Without a fresh task list the stored task pieces are kept as they are.
      const keep = tasks ? docs : docs.concat(await d.vectors.stored('task').catch(() => []))
      const r = await d.vectors.sync(keep, 60)
      if (r.embedded || r.dropped) ran.push(`embed:${r.embedded}/-${r.dropped}`)
    }
  } catch (e) {
    console.error('memory embed:', e)
  }
  return ran
}

/** The nightly tidy-up: 'skip' (nothing new), 'none' (nothing to change) or the number of changes. */
export async function tidyMemory(d: Pick<MemoryJobDeps, 'mirror' | 'vectors' | 'model' | 'now'>): Promise<string> {
  if (!d.model) return 'skip'
  const today = d.now.toISOString().slice(0, 10)
  const since = addDays(today, -1)
  const facts = await d.mirror.read((db) => loadMemory(db).facts)
  const fresh = facts.filter((f) => f.at >= since && !f.pin).slice(-20)
  if (!fresh.length) return 'skip'
  // Similar old facts: by meaning when embeddings work, else by shared words.
  const old = facts.filter((f) => !fresh.includes(f))
  const similar = new Set<Fact>()
  const byId = new Map(old.map((f) => [factDocId(f), f]))
  for (const f of fresh) {
    let hits: { id: string }[] = []
    if (d.vectors) hits = await d.vectors.search(f.t, 5, ['fact']).catch(() => [])
    if (!hits.length) hits = keywordRecall(memoryDocs({ facts: old }), f.t, 4)
    for (const h of hits) {
      const o = byId.get(h.id)
      if (o) similar.add(o)
    }
  }
  const { prompt, ids } = tidyPrompt(fresh, [...similar].slice(0, 40), today)
  const decisions = parseTidy(await d.model(prompt, { json: true, kind: 'tidy' }), ids)
  if (!decisions.length) return 'none'
  const n = await d.mirror.write((db) => {
    const m = loadMemory(db)
    const r = applyTidy(m.facts, decisions, ids, MAX_FACTS, d.now)
    if (!r.changes.length) return 0
    saveMemory(db, { ...m, facts: r.facts })
    addMemLog(db, r.changes)
    return r.changes.length
  })
  return n ? String(n) : 'none'
}
