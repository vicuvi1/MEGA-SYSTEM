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
}

export function createChangeWatch(ask: (token: string) => Promise<ChangeAnswer>) {
  let token: string | null = null
  let off = false
  return {
    /** True when Todoist changed since the last check (the first check only starts the count). */
    async check(): Promise<boolean> {
      if (off) return false
      try {
        const j = await ask(token ?? '*')
        const first = token === null
        token = String(j.token || '') || null
        return !first && Number(j.changed) > 0
      } catch {
        return false
      }
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
