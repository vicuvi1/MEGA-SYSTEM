// The island's errors in plain words (IS19): never a raw server message.
// Pure, so it's tested.

/** Server and network errors in plain words (IS19). */
export function plainError(e?: string): string {
  const m = (e ?? '').trim()
  if (!m) return 'It did not work'
  if (/failed to fetch|networkerror|network request|load failed|offline|timed? ?out|aborted/i.test(m)) return "Couldn't reach the internet — try again in a moment"
  if (/\b5\d\d\b|internal server|bad gateway|service unavailable|turso|sqlite|database/i.test(m)) return 'The server had a hiccup — try again in a moment'
  if (/\b401\b|unauthori[sz]ed|session/i.test(m)) return 'Life System needs your PIN again: open it from the tray'
  if (/^\s*\{|\bat \w+ \(|TypeError|ReferenceError|undefined is not|cannot read/i.test(m)) return 'Something went wrong — it was noted in the log'
  return m.length > 140 ? m.slice(0, 139) + '…' : m
}

/** A Todoist error in plain words (IS19). */
export function todoistErrorText(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? '')
  if (/404|not found|already|completed|closed|gone/i.test(m)) return 'That task was already done or moved — refreshing'
  if (/401|403|token|unauthor|forbidden/i.test(m)) return 'Todoist needs to be connected again (Settings → Todoist)'
  if (/429|rate|too many/i.test(m)) return 'Todoist is busy right now — try again in a minute'
  if (/network|fetch|offline|timeout|timed out|5\d\d/i.test(m)) return "Couldn't reach Todoist — check the internet and try again"
  return "Todoist didn't take it — refreshing the list"
}
