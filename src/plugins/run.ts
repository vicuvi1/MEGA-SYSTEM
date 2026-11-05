// Runs the plugins' server jobs from the tick: each plugin's morning job once
// a day after 05:00, its evening job once after 19:00, and its tick job every
// `tickEvery` minutes. "Refresh now" in Settings runs the morning jobs at once
// (without sending messages). Each run leaves a status line for Settings.
import type { Plugin, PluginJob, PluginJobCtx, PluginJobResult } from './types'

export interface PluginStatus {
  at: string
  ok: boolean
  note?: string
  need?: string[]
}

export interface RunDeps {
  plugins: Plugin[]
  /** Is this plugin switched on? */
  on(id: string): boolean
  /** True when this caller wins the slot (at most once per gapMs). */
  claim(key: string, gapMs: number): Promise<boolean>
  ctx: PluginJobCtx
  saveStatus(id: string, st: PluginStatus): Promise<void>
  send?(text: string): Promise<unknown>
}

const H20 = 20 * 3600_000

/** Which job is due now for a plugin (at most one per tick). */
async function dueJob(p: Plugin, deps: RunDeps, hour: number, force: boolean): Promise<{ name: string; job: PluginJob } | null> {
  const j = p.jobs
  if (!j) return null
  if (force) {
    const job = j.morning ?? j.tick ?? j.evening
    return job ? { name: 'now', job } : null
  }
  if (j.morning && hour >= 5 && (await deps.claim(`plugin:${p.id}:morning`, H20))) return { name: 'morning', job: j.morning }
  if (j.evening && hour >= 19 && (await deps.claim(`plugin:${p.id}:evening`, H20))) return { name: 'evening', job: j.evening }
  if (j.tick && (await deps.claim(`plugin:${p.id}:tick`, Math.max(10, j.tickEvery ?? 60) * 60_000))) return { name: 'tick', job: j.tick }
  return null
}

/** Returns what ran ("weather:morning"), for the logs. */
export async function runPluginJobs(deps: RunDeps, opts: { force?: boolean; only?: string } = {}): Promise<string[]> {
  const ran: string[] = []
  const hour = deps.ctx.now.getHours()
  for (const p of deps.plugins) {
    if (!p.jobs || !deps.on(p.id) || (opts.only && opts.only !== p.id)) continue
    const due = await dueJob(p, deps, hour, !!opts.force)
    if (!due) continue
    let res: PluginJobResult | void
    try {
      res = await due.job(deps.ctx)
      await deps.saveStatus(p.id, { at: deps.ctx.now.toISOString(), ok: true, ...(res?.note ? { note: res.note } : {}), ...(res?.need?.length ? { need: res.need } : {}) })
    } catch (e) {
      await deps.saveStatus(p.id, { at: deps.ctx.now.toISOString(), ok: false, note: String((e as Error)?.message ?? e).slice(0, 200) }).catch(() => null)
      ran.push(`${p.id}:${due.name}:failed`)
      continue
    }
    ran.push(`${p.id}:${due.name}`)
    if (res?.message && !opts.force && deps.send) await deps.send(res.message).catch(() => null)
  }
  return ran
}
