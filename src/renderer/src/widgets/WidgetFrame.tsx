// PL1 / PL2 / PL11: one widget in its box. The code is checked against the
// hash you installed, then runs in an iframe with sandbox="allow-scripts"
// only (an opaque origin: it can't touch this page, the database, the PIN or
// the session) from /widgets/frame.html (no network, its own strict policy).
// It talks only over a private MessagePort; every call is checked here
// (permission, host list, rate). The island pings it: a widget that keeps
// the PC busy is stopped and labelled "slowed down".
import { useEffect, useRef, useState } from 'react'
import { checkCall, readFrameMsg, type WidgetCall, type WidgetData, type WidgetGrants } from '@core/widgets/bridge'
import { budgetStep, dataDue, FRESH_BUDGET, PING_MS, type Budget } from '@core/widgets/budget'
import type { WidgetManifest } from '@core/widgets/manifest'
import { tp } from '../islandTap'
import { loadCode } from './registry'

export interface WidgetFrameProps {
  manifest: WidgetManifest
  sha256: string
  grants: WidgetGrants
  config: Record<string, string>
  /** The read-only data (already cut down to what "read" allows). */
  data: WidgetData
  /** A checked call: the host does it (asks you first for tasks and notes). */
  onCall: (call: WidgetCall) => Promise<unknown>
  /** Colours for inside the box. */
  theme?: Record<string, string>
}

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; text: string } | { kind: 'slowed'; why: string }

export function WidgetFrame(p: WidgetFrameProps) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [code, setCode] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const port = useRef<MessagePort | null>(null)
  const props = useRef(p)
  props.current = p
  const recent = useRef<Partial<Record<WidgetCall['op'], number[]>>>({})
  const budget = useRef<Budget>(FRESH_BUDGET)
  const lastData = useRef(0)

  // The code, only when it matches the pinned hash.
  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    setCode(null)
    void loadCode(p.manifest.id, p.sha256).then((r) => {
      if (!live) return
      if ('error' in r) setState({ kind: 'error', text: r.error })
      else setCode(r.code)
    })
    return () => void (live = false)
  }, [p.manifest.id, p.sha256])

  // The box: hello once, then only the port.
  useEffect(() => {
    const f = frame.current
    if (!code || !f) return
    let loads = 0
    let pingN = 0
    let pending: { n: number; at: number } | null = null
    let timer = 0
    budget.current = FRESH_BUDGET
    const slow = (b: Budget) => {
      budget.current = b
      if (b.slowed) {
        stop()
        setState({ kind: 'slowed', why: b.why })
      }
    }
    const stop = () => {
      clearInterval(timer)
      port.current?.close()
      port.current = null
    }
    const visible = () => document.visibilityState === 'visible'
    const onLoad = () => {
      loads++
      // A second load means the widget tried to leave its page: stop it.
      if (loads > 1) {
        stop()
        return setState({ kind: 'error', text: 'This widget tried to leave its box and was stopped.' })
      }
      const ch = new MessageChannel()
      port.current = ch.port1
      ch.port1.onmessage = (e) => {
        const m = readFrameMsg(e.data)
        if (!m) return
        if (m.t === 'ready') setState({ kind: 'ready' })
        else if (m.t === 'pong') {
          if (pending && m.n === pending.n) slow(budgetStep(budget.current, { kind: 'pong', lateMs: Math.max(0, Date.now() - pending.at - 50) }, Date.now()))
          pending = null
        } else if (m.t === 'busy') slow(budgetStep(budget.current, { kind: 'busy', ms: m.ms }, Date.now()))
        else if (m.t === 'call') {
          const now = Date.now()
          const reply = (ok: boolean, value?: unknown, error?: string) => port.current?.postMessage({ t: 'reply', id: m.id, ok, value, error })
          const c = checkCall(m.call, props.current.grants, recent.current, now)
          if (!c.ok) return reply(false, undefined, c.error)
          recent.current[c.call.op] = [...(recent.current[c.call.op] ?? []).filter((t) => now - t < 60_000), now]
          props.current.onCall(c.call).then((v) => reply(true, v), (err) => reply(false, undefined, String((err as Error)?.message ?? err).slice(0, 160)))
        }
      }
      lastData.current = Date.now()
      f.contentWindow?.postMessage({ t: 'hello', code, manifest: props.current.manifest, config: props.current.config, data: props.current.data, theme: props.current.theme ?? {} }, '*', [ch.port2])
      // The watchdog and the refresh, on one slow clock; nothing while hidden.
      timer = window.setInterval(() => {
        if (!port.current || !visible()) return
        const now = Date.now()
        if (pending) slow(budgetStep(budget.current, { kind: 'silent' }, now))
        pending = { n: ++pingN, at: now }
        port.current?.postMessage({ t: 'ping', n: pingN })
      }, PING_MS)
    }
    const onVis = () => port.current?.postMessage({ t: 'visible', on: visible() })
    f.addEventListener('load', onLoad)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      f.removeEventListener('load', onLoad)
      document.removeEventListener('visibilitychange', onVis)
      stop()
    }
  }, [code, run])

  // Fresh data at the widget's own rate (never faster than every 15 s, never while hidden).
  useEffect(() => {
    if (state.kind !== 'ready' || !port.current) return
    if (!dataDue(lastData.current, p.manifest.refresh, Date.now(), document.visibilityState === 'visible')) return
    lastData.current = Date.now()
    port.current.postMessage({ t: 'data', data: p.data })
  }, [p.data, state.kind, p.manifest.refresh])

  const retry = () => (setState({ kind: 'loading' }), setRun((x) => x + 1))
  if (state.kind === 'error') return <div className={`wf wf-${p.manifest.size} wf-msg`}><b>{p.manifest.name}</b><small>{state.text}</small></div>
  if (state.kind === 'slowed')
    return (
      <div className={`wf wf-${p.manifest.size} wf-msg wf-slowed`}>
        <b>{p.manifest.name} · slowed down</b>
        <small>{state.why}. It is paused to keep your PC light.</small>
        {/* On the island buttons fire on release (islandTap); elsewhere a normal click. */}
        <button type="button" {...tp(`wf:retry:${p.manifest.id}`, retry)} onClick={(e) => (document.documentElement.classList.contains('di-root') ? undefined : (e.preventDefault(), retry()))}>Try again</button>
      </div>
    )
  return (
    <div className={`wf wf-${p.manifest.size} ${state.kind === 'loading' ? 'is-loading' : ''}`}>
      {code && (
        <iframe
          key={run}
          ref={frame}
          title={p.manifest.name}
          src="/widgets/frame.html"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="eager"
          allow=""
        />
      )}
    </div>
  )
}
