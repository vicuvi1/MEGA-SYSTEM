// GitHub commits and CTFtime events: pure helpers (the job fetches, these count).

export interface CtfEvent {
  title: string
  start: string // ISO
  finish: string // ISO
  url: string
  format: string
  weight: number
}

export interface GithubData {
  user: string
  at: string
  lastCommit: string | null // YYYY-MM-DD
  /** Commits in the last 7 days (today included). */
  week: number
  repos: string[]
  ctfs: CtfEvent[]
}

const localDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE')

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400_000)

/** GitHub's events list → last commit day, commits this week and the repos touched. */
export function commitStats(events: any[], today: string): Pick<GithubData, 'lastCommit' | 'week' | 'repos'> {
  const pushes = (Array.isArray(events) ? events : []).filter((e) => e?.type === 'PushEvent' && typeof e.created_at === 'string')
  const weekFrom = addDays(today, -6)
  let lastCommit: string | null = null
  let week = 0
  const repos = new Set<string>()
  for (const e of pushes) {
    const day = localDay(e.created_at)
    if (day > today) continue
    if (!lastCommit || day > lastCommit) lastCommit = day
    if (day >= weekFrom) {
      const n = Number(e.payload?.size ?? e.payload?.distinct_size ?? e.payload?.commits?.length ?? 1)
      week += Number.isFinite(n) && n > 0 ? n : 1
      const name = String(e.repo?.name ?? '').split('/').pop()
      if (name) repos.add(name)
    }
  }
  return { lastCommit, week, repos: [...repos].slice(0, 5) }
}

/** CTFtime's list → the next online events (3 at most), soonest first. */
export function pickCtfs(list: any[], now: Date, max = 3): CtfEvent[] {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && !e.onsite && typeof e.title === 'string' && Date.parse(e.start) > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, max)
    .map((e) => ({ title: e.title.trim().slice(0, 80), start: String(e.start), finish: String(e.finish), url: String(e.ctftime_url || e.url || ''), format: String(e.format || ''), weight: Number(e.weight) || 0 }))
}

const dm = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const hours = (e: CtfEvent) => Math.round((Date.parse(e.finish) - Date.parse(e.start)) / 3600_000)

/** One line for what Ben knows. */
export function githubLine(d: GithubData, today: string): string {
  const since = d.lastCommit ? daysBetween(d.lastCommit, today) : null
  const commit =
    since == null ? `no commits seen lately` : since === 0 ? 'committed today' : `${since} day${since === 1 ? '' : 's'} without a commit (last ${d.lastCommit})`
  const week = `${d.week} commit${d.week === 1 ? '' : 's'} in the last 7 days${d.repos.length ? ` (${d.repos.join(', ')})` : ''}`
  const nudge = since != null && since >= 3 ? ' Nudge him: one small commit today.' : ''
  const ctf = d.ctfs.length ? ` Next CTFs (CTFtime, online): ${d.ctfs.map((e) => `${e.title} ${dm(e.start)}${e.format ? ` (${e.format}, ${hours(e)}h)` : ''}`).join('; ')}. Suggest one that fits his week.` : ''
  return `GitHub (${d.user}): ${commit}; ${week}.${nudge}${ctf}`
}

export const eventsUrl = (user: string) => `https://api.github.com/users/${encodeURIComponent(user)}/events?per_page=100`
export const ctftimeUrl = (now: Date, days = 30) => {
  const s = Math.floor(now.getTime() / 1000)
  return `https://ctftime.org/api/v1/events/?limit=20&start=${s}&finish=${s + days * 86400}`
}
/** A GitHub user name: letters, digits and single dashes. */
export const validUser = (u: string) => /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(u)
