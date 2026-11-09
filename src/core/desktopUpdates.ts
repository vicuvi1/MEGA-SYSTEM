// "Desktop updates" health check: is the Windows release workflow still
// building? For ~15 pushes it failed unseen and the PC app could not update.
// The server asks GitHub's public API (no token) at most once an hour, keeps
// the answer in sys_health (note:desktopupdates) and Settings → System health
// and the usual once-a-day alert show it. Pure judging + one fetch; tested.
export const RELEASE_RUNS_URL = 'https://api.github.com/repos/vicuvi1/MEGA-SYSTEM/actions/workflows/release.yml/runs?per_page=5&branch=main'
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/vicuvi1/MEGA-SYSTEM/releases/latest'
export const DESKTOP_REFRESH_MS = 60 * 60000
/** This many completed runs in a row failing means the build is broken. */
export const DESKTOP_FAILS = 2

export interface WorkflowRun { status?: string; conclusion?: string | null; html_url?: string; created_at?: string }

/** What is kept in sys_health note "desktopupdates". */
export interface DesktopNote {
  /** Last time GitHub was asked (success or not): the once-an-hour cache. */
  triedAt: string
  /** Last time it answered. Missing: never known. */
  okAt?: string
  broken?: boolean
  /** Failed runs in a row at the top (completed ones, cancelled ignored). */
  failed?: number
  runUrl?: string | null
  /** When it was first seen broken (for the "30 minutes" rule). */
  brokenSince?: string
  version?: string | null
  builtAt?: string | null
}

/** Judges the newest runs (newest first): cancelled and unfinished runs are ignored. */
export function judgeRuns(runs: WorkflowRun[]): { broken: boolean; failed: number; runUrl: string | null } {
  const done = runs.filter((r) => r.status === 'completed' && r.conclusion && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
  let failed = 0
  while (failed < done.length && done[failed].conclusion === 'failure') failed++
  return { broken: failed >= DESKTOP_FAILS, failed, runUrl: failed ? done[0].html_url ?? null : null }
}

/** Asks GitHub unless asked within the last hour; an error keeps the old answer ("unknown", never broken). */
export async function refreshDesktopUpdates(prev: DesktopNote | null | undefined, now: Date, fetchImpl: typeof fetch = fetch): Promise<DesktopNote> {
  if (prev?.triedAt && now.getTime() - Date.parse(prev.triedAt) < DESKTOP_REFRESH_MS) return prev
  const base: DesktopNote = { ...(prev ?? {}), triedAt: now.toISOString() }
  const get = async (url: string) => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': 'life-system', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`GitHub ${r.status}`)
    return r.json() as Promise<any>
  }
  try {
    const runs = await get(RELEASE_RUNS_URL)
    const j = judgeRuns(Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [])
    const rel = await get(LATEST_RELEASE_URL).catch(() => null)
    return {
      ...base,
      okAt: now.toISOString(),
      broken: j.broken,
      failed: j.failed,
      runUrl: j.runUrl,
      brokenSince: j.broken ? prev?.brokenSince && prev.broken ? prev.brokenSince : now.toISOString() : undefined,
      version: rel?.tag_name ? String(rel.tag_name).replace(/^v/, '') : base.version ?? null,
      builtAt: rel?.published_at ?? rel?.created_at ?? base.builtAt ?? null
    }
  } catch {
    return base
  }
}

/** Is the running version the newest release while the build is red? (for the app's update panel) */
export const newerChangesBlocked = (n: DesktopNote | null | undefined) => !!n?.broken

export const DESKTOP_ALERT_HELP =
  'Open the failed run (link above) on GitHub → Actions, or tell your helper to fix the Windows release build. Nothing on your PC is lost; it just stays on the current version until then.'
