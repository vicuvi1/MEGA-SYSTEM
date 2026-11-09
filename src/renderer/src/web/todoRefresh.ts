// Keeping today's Todoist tasks fresh (tested in todoRefresh.test.ts).
//
// - `createChangeWatch`: Todoist's cheap "anything new since token?" check. The
//   first answer only sets the starting point; after that, any change (a task
//   added on the phone, one done in Todoist) says "read the list again".
// - `createTodayList`: today's list as last read. A read that fails (Todoist
//   slow, the background reads paused) keeps the last good list instead of
//   showing an empty one, and every read asks Todoist again (no stale copy).
export interface ChangeAnswer {
  token: string
  changed: number
  /** Of those, changes made in Todoist itself (not this app's own edits coming back). */
  outside?: number
}

/** What the Sync line shows: when Todoist last answered, how many outside changes came in, the last problem. */
export interface WatchInfo {
  okAt: number
  failAt: number
  error: string | null
  /** Changes made in Todoist itself taken in since the last `take()`. */
  changes: number
}

export function createChangeWatch(ask: (token: string) => Promise<ChangeAnswer>, now: () => number = Date.now) {
  let token: string | null = null
  let off = false
  const info: WatchInfo = { okAt: 0, failAt: 0, error: null, changes: 0 }
  return {
    /** True when Todoist changed since the last check (the first check only starts the count). */
    async check(): Promise<boolean> {
      if (off) return false
      try {
        const j = await ask(token ?? '*')
        const first = token === null
        token = String(j.token || '') || null
        info.okAt = now()
        info.error = null
        if (!first) info.changes += Number(j.outside ?? j.changed) || 0
        return !first && Number(j.changed) > 0
      } catch (e) {
        info.failAt = now()
        info.error = String((e as Error)?.message || e || 'Todoist did not answer')
        return false
      }
    },
    /** Did the last check reach Todoist? */
    get ok(): boolean {
      return !info.error
    },
    info(): WatchInfo {
      return { ...info }
    },
    /** The outside changes counted since the last take (the Sync button's "2 changes from Todoist"). */
    take(): number {
      const n = info.changes
      info.changes = 0
      return n
    },
    /** Todoist is not connected: stop asking. */
    stop() {
      off = true
    },
    get started() {
      return token !== null
    }
  }
}

export function createTodayList<T>(read: () => Promise<T[]>) {
  let last: T[] | null = null
  let at = 0
  return {
    /** Reads Todoist now; on a failure, the last good list (or the error when there is none). */
    async refresh(): Promise<T[]> {
      try {
        last = await read()
        at = Date.now()
        return last
      } catch (e) {
        if (last) return last
        throw e
      }
    },
    get last() {
      return last
    },
    get at() {
      return at
    }
  }
}
