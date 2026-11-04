// Sporty (the Python bot on your server) updates itself from GitHub. Every
// minute it "polls" here with the version it runs and how many new changes
// wait on GitHub; the Update Sporty button in Settings leaves a request that
// the next poll picks up. Pure and tested.

export const SPORTY_STATUS = 'sporty_status'
export const SPORTY_REQUEST = 'sporty_update_request'

export interface SportyStatus {
  version: string
  behind: number
  latest: string
  /** Last poll. */
  at: string
  /** The request (its `at`) last handed to Sporty, so it runs once. */
  sentRequest?: string
  lastUpdate?: { at: string; ok: boolean; updated: boolean; version?: string; error?: string; changes?: string[] }
}

export interface SportyRequest {
  at: string
}

export function parseJson<T>(raw: string | null | undefined): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** What a poll changes: the new status, whether to update now, whether to save (rarely, to spare writes). */
export function pollSporty(prev: SportyStatus | null, req: SportyRequest | null, input: { version?: unknown; behind?: unknown; latest?: unknown }, now: Date): { status: SportyStatus; update: boolean; save: boolean } {
  const version = String(input.version ?? '').slice(0, 40) || 'unknown'
  const behind = Math.max(0, Math.min(9999, Math.round(Number(input.behind) || 0)))
  const latest = String(input.latest ?? '').slice(0, 40)
  const update = !!req?.at && req.at !== prev?.sentRequest && (!prev?.lastUpdate || req.at > prev.lastUpdate.at)
  const status: SportyStatus = { ...(prev ?? {}), version, behind, latest, at: now.toISOString(), ...(update ? { sentRequest: req!.at } : {}) }
  const stale = !prev || now.getTime() - Date.parse(prev.at) > 5 * 60_000
  const changed = !prev || prev.version !== version || prev.behind !== behind || prev.latest !== latest
  return { status, update, save: update || stale || changed }
}

/** Sporty reports how the update went. */
export function sportyUpdated(prev: SportyStatus | null, r: { ok?: unknown; updated?: unknown; version?: unknown; error?: unknown; changes?: unknown }, now: Date): SportyStatus {
  const base: SportyStatus = prev ?? { version: 'unknown', behind: 0, latest: '', at: now.toISOString() }
  const ok = !!r.ok
  const updated = !!r.updated
  const version = r.version ? String(r.version).slice(0, 40) : undefined
  return {
    ...base,
    ...(ok && version ? { version } : {}),
    ...(ok && updated ? { behind: 0 } : {}),
    lastUpdate: {
      at: now.toISOString(),
      ok,
      updated,
      ...(version ? { version } : {}),
      ...(r.error ? { error: String(r.error).slice(0, 300) } : {}),
      changes: Array.isArray(r.changes) ? r.changes.slice(0, 8).map((c) => String(c).slice(0, 120)) : [],
    },
  }
}

export interface SportyView {
  /** Sporty talked to us in the last 3 minutes (it polls every minute). */
  online: boolean
  /** Ever connected (sync or poll). */
  connected: boolean
  lastSeen: string | null
  version: string | null
  behind: number
  /** Waiting for Sporty to pick up the request. */
  pending: boolean
  lastUpdate: SportyStatus['lastUpdate'] | null
  /** Polls are new: an old Sporty syncs but can't update itself yet. */
  canUpdate: boolean
}

export function sportyView(status: SportyStatus | null, seen: { at: string } | null, req: SportyRequest | null, now: Date): SportyView {
  const last = [status?.at, seen?.at].filter(Boolean).sort().pop() ?? null
  const online = !!status?.at && now.getTime() - Date.parse(status.at) < 3 * 60_000
  const pending = !!req?.at && (!status?.lastUpdate || req.at > status.lastUpdate.at) && now.getTime() - Date.parse(req.at) < 15 * 60_000
  return { online, connected: !!last, lastSeen: last, version: status?.version ?? null, behind: status?.behind ?? 0, pending, lastUpdate: status?.lastUpdate ?? null, canUpdate: !!status }
}
