// Instant save, sync later (pure, tested in quickQueue.test.ts). A quick add
// shows as done the moment you press Enter; the real write runs right after,
// in the background, through the app's existing path (which saves on this
// device first and uploads next). Each item has its own id from the start, and
// every try sends that same id, so a retry never counts twice.
//
//  saving    → the write is on its way (the toast already says what happened)
//  saved     → the write went through
//  will-sync → the write failed; it is kept (also across a reload) and tried
//              again with backoff. Never dropped silently.
//  unsure    → after a reload we can't tell whether it saved, and sending it
//              again could add it twice (a task, a focus timer, a note): shown
//              so you can check, never sent again by itself.
//  refused   → the app said no for a reason a retry can't fix (Todoist not
//              connected, a focus timer already running): shown, not retried.
//  undone    → Undo within the toast's 5 s (or it never left this device).
export type QStatus = 'saving' | 'saved' | 'will-sync' | 'unsure' | 'refused' | 'undone'

/** An error a retry can't fix: the item shows it and is not sent again. */
export class QuickRefused extends Error {
  readonly refused = true
}

export interface QItem<R> {
  id: string
  route: R
  /** The toast's line ("50 push-ups logged"). */
  said: string
  at: number
  status: QStatus
  tries: number
  /** What the write returned (needed to take it back). */
  result?: unknown
  error?: string
  /** Undo was pressed while the write was still on its way. */
  undoAsked?: boolean
}

export interface QueueDeps<R> {
  /** Does the write; resolves with what Undo needs. Called again with the same id on a retry. */
  run(route: R, id: string): Promise<unknown>
  /** Takes back a write that went through. */
  undo(route: R, id: string, result: unknown): Promise<void>
  /** Safe to send again after a reload (the write ignores a second copy of the same id). */
  canReplay?(route: R): boolean
  now?(): number
  newId?(): string
  schedule?(fn: () => void, ms: number): void
  /** Where items still waiting are kept (localStorage in the app). */
  store?: { get(): string | null; set(v: string): void }
  /** Waits between tries, in ms; the last one repeats. */
  retryMs?: number[]
  /** How long Undo is offered, in ms. */
  undoMs?: number
}

export const UNDO_MS = 5000
const RETRY_MS = [2000, 5000, 15000, 60000]
const KEEP = 30

export function createQuickQueue<R>(deps: QueueDeps<R>) {
  const now = deps.now ?? (() => Date.now())
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))
  const retryMs = deps.retryMs?.length ? deps.retryMs : RETRY_MS
  const undoMs = deps.undoMs ?? UNDO_MS
  let seq = 0
  const newId = deps.newId ?? (() => `q${now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  let items: QItem<R>[] = []
  const subs = new Set<(list: QItem<R>[]) => void>()
  const running = new Set<string>()

  const persist = () => {
    if (!deps.store) return
    try {
      deps.store.set(JSON.stringify(items.filter((i) => i.status === 'saving' || i.status === 'will-sync' || i.status === 'unsure')))
    } catch {
      /* storage full or blocked: the items still live in this page */
    }
  }
  const emit = () => {
    const list = items.slice()
    for (const fn of subs) {
      try {
        fn(list)
      } catch {
        /* one listener's problem stays there */
      }
    }
  }
  const patch = (id: string, p: Partial<QItem<R>>) => {
    items = items.map((i) => (i.id === id ? { ...i, ...p } : i))
    persist()
    emit()
  }
  const get = (id: string) => items.find((i) => i.id === id)

  async function attempt(id: string): Promise<void> {
    const it = get(id)
    if (!it || running.has(id) || it.status === 'undone' || it.status === 'saved') return
    running.add(id)
    try {
      const result = await deps.run(it.route, id)
      running.delete(id)
      const cur = get(id)
      if (cur?.undoAsked) {
        // Undo was pressed while it was on its way: take it back now.
        await deps.undo(cur.route, id, result).catch(() => {})
        return patch(id, { status: 'undone', result, tries: (cur.tries ?? 0) + 1, error: undefined })
      }
      patch(id, { status: 'saved', result, tries: (cur?.tries ?? 0) + 1, error: undefined })
    } catch (e) {
      running.delete(id)
      const cur = get(id)
      if (!cur) return
      // Undone before it ever went through: nothing to send.
      if (cur.undoAsked) return patch(id, { status: 'undone', error: undefined })
      const tries = cur.tries + 1
      if ((e as { refused?: boolean })?.refused) return patch(id, { status: 'refused', tries, error: (e as Error).message })
      patch(id, { status: 'will-sync', tries, error: (e as Error)?.message || 'Not saved yet' })
      schedule(() => void attempt(id), retryMs[Math.min(tries - 1, retryMs.length - 1)])
    }
  }

  function trim() {
    if (items.length <= KEEP) return
    const waiting = items.filter((i) => i.status === 'saving' || i.status === 'will-sync' || i.status === 'unsure')
    const done = items.filter((i) => !waiting.includes(i)).slice(-Math.max(0, KEEP - waiting.length))
    items = items.filter((i) => waiting.includes(i) || done.includes(i))
  }

  return {
    /**
     * Shows it as done right away (listeners hear it before this returns), then
     * writes in the background. Returns the item with its id.
     */
    submit(route: R, said: string, id?: string): QItem<R> {
      const it: QItem<R> = { id: id || newId(), route, said, at: now(), status: 'saving', tries: 0 }
      if (get(it.id)) return get(it.id)!
      items = [...items, it]
      trim()
      persist()
      emit()
      queueMicrotask(() => void attempt(it.id))
      return it
    },

    /** Takes it back. False when the Undo time is over, or it is already undone. */
    async undo(id: string): Promise<boolean> {
      const it = get(id)
      if (!it || it.status === 'undone' || now() - it.at > undoMs) return false
      if (it.status === 'saving' && running.has(id)) {
        // Still on its way: shown as undone now, taken back when it lands.
        patch(id, { undoAsked: true, status: 'undone' })
        return true
      }
      if (it.status === 'will-sync' || it.status === 'saving' || it.status === 'unsure') {
        // It never went through: cancel it (no write to take back).
        patch(id, { undoAsked: true, status: 'undone', error: undefined })
        return true
      }
      try {
        await deps.undo(it.route, id, it.result)
        patch(id, { status: 'undone' })
        return true
      } catch (e) {
        patch(id, { error: (e as Error)?.message || "Couldn't undo" })
        return false
      }
    },

    /** Send a "will sync" item again now. */
    retry(id: string): void {
      const it = get(id)
      if (it && it.status === 'will-sync') void attempt(id)
    },

    /** Forget an "unsure" item once you checked it. */
    dismiss(id: string): void {
      const it = get(id)
      if (!it) return
      items = items.filter((i) => i.id !== id)
      persist()
      emit()
    },

    items(): QItem<R>[] {
      return items.slice()
    },
    waiting(): number {
      return items.filter((i) => i.status === 'will-sync' || i.status === 'saving').length
    },

    subscribe(fn: (list: QItem<R>[]) => void): () => void {
      subs.add(fn)
      return () => void subs.delete(fn)
    },

    /**
     * After a reload: items that were still waiting are sent again with the
     * same id when that is safe, or shown as "unsure" when it is not.
     */
    restore(): void {
      if (!deps.store) return
      let saved: QItem<R>[] = []
      try {
        const raw = JSON.parse(deps.store.get() || '[]')
        saved = Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string' && x.route) : []
      } catch {
        saved = []
      }
      for (const s of saved) {
        if (get(s.id)) continue
        const replay = s.status !== 'unsure' && (deps.canReplay ? deps.canReplay(s.route) : false)
        items = [...items, { ...s, undoAsked: false, status: replay ? 'will-sync' : 'unsure', error: replay ? s.error : 'Not sure this was saved. Check it.' }]
      }
      persist()
      emit()
      for (const it of items) if (it.status === 'will-sync') queueMicrotask(() => void attempt(it.id))
    }
  }
}

export type QuickQueue<R> = ReturnType<typeof createQuickQueue<R>>
