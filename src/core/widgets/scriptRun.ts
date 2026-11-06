// PL5: one run of a user script in a fresh worker, ended after its time
// limit. The worker maker is passed in (a Web Worker from a blob in the
// island; a Node worker in the tests), so this part stays pure.
import { checkUrl } from './bridge'
import { FETCH_WAIT_MS, readResult, TIME_MS, workerSource, type ScriptResult, type UserScript } from './scripts'

export interface WorkerLike {
  postMessage(m: unknown): void
  onMessage(fn: (m: unknown) => void): void
  terminate(): void
}

export interface ScriptInput { now: number; hour: number; minute: number; weekday: number; today: unknown }

export interface RunDeps {
  makeWorker(source: string): WorkerLike
  /** The host does a checked call (a fetch through the allowlist, a task after you confirm). */
  onCall(call: { op: 'fetch'; url: string } | { op: 'addTask'; text: string }): Promise<unknown>
  timeMs?: number
  fetchWaitMs?: number
}

export type RunResult = ScriptResult & { timedOut?: boolean; ms: number }

/** The check on a script's call: only hosts you listed, tasks only when you allowed them. */
export function checkScriptCall(s: UserScript, m: any): { ok: true; call: { op: 'fetch'; url: string } | { op: 'addTask'; text: string } } | { ok: false; error: string } {
  if (m?.op === 'fetch') {
    if (!s.hosts.length) return { ok: false, error: 'Network is off for this script' }
    const u = checkUrl(m.url, s.hosts)
    return u.ok ? { ok: true, call: { op: 'fetch', url: u.url } } : u
  }
  if (m?.op === 'addTask') {
    if (!s.add) return { ok: false, error: 'Adding tasks is off for this script' }
    const text = typeof m.text === 'string' ? m.text.trim().slice(0, 200) : ''
    return text ? { ok: true, call: { op: 'addTask', text } } : { ok: false, error: 'Nothing to add' }
  }
  return { ok: false, error: 'Unknown call' }
}

export function runScript(s: UserScript, input: ScriptInput, deps: RunDeps): Promise<RunResult> {
  const started = Date.now()
  const limit = deps.timeMs ?? TIME_MS
  return new Promise((resolve) => {
    let w: WorkerLike
    try {
      w = deps.makeWorker(workerSource(s.code))
    } catch (e) {
      return resolve({ show: null, notify: null, error: String((e as Error)?.message ?? e).slice(0, 120), ms: 0 })
    }
    let done = false
    let calls = 0
    let extended = false
    const finish = (r: Omit<RunResult, 'ms'>) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        w.terminate()
      } catch {
        /* gone */
      }
      resolve({ ...r, ms: Date.now() - started })
    }
    const onTimeout = () => finish({ show: null, notify: null, error: `Stopped: it ran longer than ${extended ? limit + (deps.fetchWaitMs ?? FETCH_WAIT_MS) : limit} ms`, timedOut: true })
    let timer = setTimeout(onTimeout, limit)
    w.onMessage((raw) => {
      if (done) return
      const m = raw as any
      if (m?.t === 'done' || m?.t === 'fail') return finish(readResult({ ...m, error: m.t === 'fail' ? m.error : undefined }))
      if (m?.t !== 'call' || !Number.isInteger(m.id)) return
      if (++calls > 3) return finish({ show: null, notify: null, error: 'Too many calls in one run (3 at most)' })
      const c = checkScriptCall(s, m)
      if (!c.ok) return w.postMessage({ t: 'reply', id: m.id, ok: false, error: c.error })
      // Waiting on the host isn't the script's own time: one longer wait, once.
      if (!extended) {
        extended = true
        clearTimeout(timer)
        timer = setTimeout(onTimeout, limit + (deps.fetchWaitMs ?? FETCH_WAIT_MS) - (Date.now() - started))
      }
      deps.onCall(c.call).then(
        (value) => !done && w.postMessage({ t: 'reply', id: m.id, ok: true, value }),
        (e) => !done && w.postMessage({ t: 'reply', id: m.id, ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) })
      )
    })
    w.postMessage({ t: 'run', input })
  })
}
