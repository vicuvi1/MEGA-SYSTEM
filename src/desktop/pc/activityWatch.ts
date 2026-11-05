// AU2: ActivityWatch (free, open source, https://activitywatch.net), if it runs
// on this PC: its local API on 127.0.0.1:5600 gives the last hour of the
// window and browser watchers. Only app names, site domains and minutes come
// out of here (pcLastHour.ts). Asked at most every few minutes, short timeout.
import { awBuckets, awSummary, type AwBuckets, type AwEvent, type LastHour } from '../../core/pcLastHour'

const BASE = 'http://127.0.0.1:5600/api/0'
let buckets: { at: number; window: string[]; web: string[] } | null = null

const get = async <T,>(path: string): Promise<T | null> => {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(2500) })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

/** The last hour from ActivityWatch, or null when it isn't running. */
export async function awLastHour(now = Date.now()): Promise<LastHour | null> {
  if (!buckets || now - buckets.at > 30 * 60_000) {
    const b = await get<AwBuckets>('/buckets/')
    if (!b) return null
    buckets = { at: now, ...awBuckets(b) }
  }
  if (!buckets.window.length) return null
  const from = now - 3600_000
  const q = `?start=${encodeURIComponent(new Date(from).toISOString())}&end=${encodeURIComponent(new Date(now).toISOString())}&limit=2000`
  const read = async (ids: string[]) => (await Promise.all(ids.slice(0, 3).map((id) => get<AwEvent[]>(`/buckets/${encodeURIComponent(id)}/events${q}`)))).flatMap((x) => (Array.isArray(x) ? x : []))
  const [win, web] = await Promise.all([read(buckets.window), read(buckets.web)])
  return awSummary(win, web, from, now)
}
