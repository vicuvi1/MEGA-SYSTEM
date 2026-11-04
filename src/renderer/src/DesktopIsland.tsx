// The desktop island (its own little always-on-top window, Windows). Hidden as
// a thin line at the top of the screen; hover or click and it drops down with
// your plan now & next, must-dos, quick logs and Ben. While a timer runs (or
// a block is coming up) the collapsed pill shows it. New things from Ben, a
// block starting, or time up drop it down for a few seconds by themselves.
import { useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_ISLAND, clock, pill, type IslandAction, type IslandSnapshot } from '@core/islandModel'
import type { IslandPlacement } from '../../shared/desktop'
import './island.css'

const desk = () => window.desktop
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const minsText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`
}

function Ring({ pct, over, size = 22, stroke = 2.6 }: { pct: number; over?: boolean; size?: number; stroke?: number }) {
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  return (
    <svg className={`di-ring ${over ? 'over' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="bg" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

export function DesktopIsland() {
  const [s, setS] = useState<IslandSnapshot>(EMPTY_ISLAND)
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [alertOnly, setAlertOnly] = useState(false)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const closeT = useRef<number | null>(null)
  const alertT = useRef<number | null>(null)
  const seenAlert = useRef<string | null>(null)
  const over = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  const hoverRef = useRef<(on: boolean) => void>(() => {})
  const revealRef = useRef<() => void>(() => {})
  const toggleRef = useRef<() => void>(() => {})
  const [place, setPlace] = useState<IslandPlacement>('top')
  useEffect(() => {
    document.documentElement.classList.add('di-root')
    desk()?.onIslandState?.(setS)
    // The desktop watches the real pointer and says when it is over the island.
    desk()?.onIslandHover?.((on) => hoverRef.current(on))
    desk()?.onIslandPlacement?.(setPlace)
    // You touched its screen edge / pressed Ctrl+Alt+Space.
    desk()?.onIslandReveal?.(() => revealRef.current())
    desk()?.onIslandToggle?.(() => toggleRef.current())
    desk()?.islandReady?.()
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), s.running ? 1000 : 15_000)
    return () => clearInterval(t)
  }, [s.running])

  const p = useMemo(() => pill(s, now), [s, now])
  const hasPill = s.locked || p.kind !== 'idle' || p.dot
  const mode = open ? 'open' : hasPill ? 'pill' : 'hidden'
  const st = useRef({ open, pinned, alertOnly })
  st.current = { open, pinned, alertOnly }

  // The window grows before the island animates open (to the card's height),
  // and shrinks after it closed.
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'open') {
      const t = window.setTimeout(() => desk()?.islandMode?.(mode), 320)
      return () => clearTimeout(t)
    }
    desk()?.islandMode?.('open', 660)
    const el = card.current
    if (!el) return
    const fit = () => desk()?.islandMode?.('open', el.scrollHeight + 24)
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    const t = window.setTimeout(fit, 450)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [mode, alertOnly])

  // Tell the desktop where the visible shape is: clicks elsewhere pass through.
  useEffect(() => {
    const report = () => {
      const el = root.current?.firstElementChild as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      const fromTop = place === 'top'
      desk()?.islandHot?.({ x: Math.round(r.left), y: fromTop ? 0 : Math.round(r.top), width: Math.round(r.width), height: Math.round(fromTop ? r.bottom : r.height) })
    }
    report()
    const t1 = window.setTimeout(report, 120)
    const t2 = window.setTimeout(report, 500)
    const ro = new ResizeObserver(report)
    if (root.current?.firstElementChild) ro.observe(root.current.firstElementChild)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      ro.disconnect()
    }
  })

  const show = (alert = false) => {
    if (closeT.current) clearTimeout(closeT.current)
    setAlertOnly(alert)
    setOpen(true)
  }
  const hide = () => {
    setOpen(false)
    setPinned(false)
    setAlertOnly(false)
  }
  const scheduleHide = (ms = 450) => {
    if (closeT.current) clearTimeout(closeT.current)
    closeT.current = window.setTimeout(() => {
      if (st.current.pinned || over.current || document.activeElement === input.current) return
      hide()
    }, ms)
  }
  revealRef.current = () => {
    show(false)
    // Came out at the edge but you didn't move onto it: tuck it away again.
    window.setTimeout(() => {
      if (!over.current && !st.current.pinned && document.activeElement !== input.current) hide()
    }, 1800)
  }
  toggleRef.current = () => {
    if (st.current.open) hide()
    else {
      show(false)
      setPinned(true)
    }
  }
  hoverRef.current = (on: boolean) => {
    over.current = on
    if (closeT.current) clearTimeout(closeT.current)
    if (on) {
      if (!st.current.open) closeT.current = window.setTimeout(() => show(false), 140)
    } else if (st.current.open) scheduleHide(st.current.alertOnly ? 1500 : 450)
  }

  // Something new: drop down for 8 seconds (stays while the mouse is on it).
  useEffect(() => {
    const a = s.alert
    if (!a || a.id === seenAlert.current) return
    seenAlert.current = a.id
    if (open && !alertOnly) return
    show(true)
    if (alertT.current) clearTimeout(alertT.current)
    alertT.current = window.setTimeout(() => {
      if (!over.current && !st.current.pinned) hide()
    }, 8000)
  }, [s.alert]) // eslint-disable-line react-hooks/exhaustive-deps

  // Press and drag (pill or the open card's header) to move the island anywhere;
  // a plain click still opens it.
  const dragged = useRef(false)
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !desk()?.islandDrag) return
      const el = e.currentTarget
      const sx = e.screenX
      const sy = e.screenY
      let started = false
      dragged.current = false
      try { el.setPointerCapture(e.pointerId) } catch { /* fine */ }
      const move = (ev: PointerEvent) => {
        if (started || Math.hypot(ev.screenX - sx, ev.screenY - sy) < 5) return
        started = true
        dragged.current = true
        document.documentElement.classList.add('di-dragging')
        desk()?.islandDrag?.(true)
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        if (started) {
          document.documentElement.classList.remove('di-dragging')
          desk()?.islandDrag?.(false)
        }
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    }
  }

  const send = (a: IslandAction) => desk()?.islandAction?.(a)
  const tap = (a: IslandAction, label?: string) => {
    send(a)
    if (label === 'Reply') {
      setAlertOnly(false)
      setPinned(true)
      setTimeout(() => input.current?.focus(), 60)
      return
    }
    if (a.kind === 'open') {
      desk()?.showApp?.(a.page)
      hide()
    }
    if (a.kind === 'dismiss' || a.kind === 'start' || a.kind === 'stop') {
      if (alertOnly) hide()
    }
  }
  const chat = () => {
    const t = text.trim()
    if (!t || s.ben.busy) return
    setText('')
    send({ kind: 'chat', text: t })
  }

  const run = s.running
  const left = run ? (run.endsAt - now) / 1000 : 0
  const runOver = !!run && left < 0
  const runPct = run ? (now - run.startedAt) / Math.max(1, run.endsAt - run.startedAt) : 0
  const water = s.water
  const mustOpen = s.mustdos.filter((m) => !m.done).length

  return (
    <div
      ref={root}
      className={`di at-${place} ${mode} ${alertOnly ? 'alert-only' : ''} mood-${s.ben.mood} ${runOver ? 'is-over' : ''}`}
    >
      {/* Collapsed: a thin line, or the smart pill */}
      {!open && (
        <button
          className={`di-pill kind-${s.locked ? 'locked' : p.kind}`}
          {...dragProps}
          onClick={() => {
            if (dragged.current) return void (dragged.current = false)
            if (s.locked) desk()?.showApp?.()
            else (show(false), setPinned(true))
          }}
          aria-label="Open the island (drag to move it)"
          title="Click to open · drag to move"
        >
          {s.locked ? (
            <span className="di-pill-text">🔒 Open Life System</span>
          ) : p.kind === 'idle' ? (
            <span className="di-line" />
          ) : (
            <>
              {p.kind === 'timer' ? <Ring pct={p.pct} over={p.over} /> : p.kind === 'now' ? <Ring pct={p.pct} /> : <span className="di-face-sm">{s.ben.face}</span>}
              <span className="di-pill-text">{p.kind === 'timer' ? p.sub : p.kind === 'next' ? `Next: ${p.text}` : p.text}</span>
              <span className={`di-pill-time ${p.over ? 'over' : ''}`}>{p.kind === 'timer' ? p.text : p.sub}</span>
            </>
          )}
          {p.dot && <i className="di-dot" />}
        </button>
      )}

      {open && (
        <div ref={card} className="di-card" role="dialog" aria-label="Life System island">
          <header className="di-head" {...dragProps}>
            <span className={`di-face mood-${s.ben.mood}`}>{s.ben.face}</span>
            <div className="di-who">
              <b>Ben</b>
              <small>{s.ben.busy ? 'thinking…' : s.ben.why ? `${s.ben.mood} · ${s.ben.why}` : s.ben.mood}</small>
            </div>
            <button className={`di-icon ${pinned ? 'on' : ''}`} onClick={() => setPinned((x) => !x)} title={pinned ? 'Unpin' : 'Keep open'}>
              📌
            </button>
            <button className="di-icon" onClick={() => (desk()?.showApp?.(), hide())} title="Open Life System">
              ⤢
            </button>
            <button className="di-icon" onClick={hide} aria-label="Close">
              ✕
            </button>
          </header>

          {s.alert && (
            <section className={`di-alert kind-${s.alert.kind}`}>
              <div className="di-alert-top">
                <span>{s.alert.kind === 'ben' ? s.alert.face ?? s.ben.face : s.alert.kind === 'over' ? '⏰' : '▶'}</span>
                <b>{s.alert.title}</b>
              </div>
              <p>{s.alert.text}</p>
              <div className="di-actions">
                {s.alert.actions.map((a) => (
                  <button key={a.label} className={a.primary ? 'primary' : ''} onClick={() => tap(a.action, a.label)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {!alertOnly && (
            <>
              {run && (
                <section className="di-timer">
                  <Ring pct={runPct} over={runOver} size={58} stroke={4} />
                  <div className="di-timer-mid">
                    <span className={`di-clock ${runOver ? 'over' : ''}`}>{runOver ? '+' : ''}{clock(left)}</span>
                    <small>{run.subject}</small>
                  </div>
                  <div className="di-actions col">
                    <button className="primary" onClick={() => tap({ kind: 'stop' })}>Stop & log</button>
                    <button onClick={() => tap({ kind: 'extend', minutes: 5 })}>+5 min</button>
                  </div>
                </section>
              )}

              <section className="di-plan">
                <div className="di-row">
                  <span className="di-label">Now</span>
                  {s.now ? (
                    <div className="di-block">
                      <b>{s.now.title}</b>
                      <small>
                        {hhmm(s.now.start)}–{hhmm(s.now.end)} · {minsText(s.now.end - now)} left
                      </small>
                      <div className="di-bar"><i style={{ width: `${Math.min(100, ((now - s.now.start) / (s.now.end - s.now.start)) * 100)}%` }} /></div>
                    </div>
                  ) : (
                    <div className="di-block muted">
                      <b>{s.ben.move?.title ?? 'Free time'}</b>
                      <small>{s.ben.move?.sub ?? 'Nothing planned right now.'}</small>
                    </div>
                  )}
                  {!run && s.now && (
                    <button className="di-go" onClick={() => tap({ kind: 'start', subject: s.now!.title, minutes: Math.max(5, Math.min(90, Math.round((s.now!.end - now) / 60000))) })}>
                      Start
                    </button>
                  )}
                </div>
                {s.next && (
                  <div className="di-row">
                    <span className="di-label">Next</span>
                    <div className="di-block">
                      <b>{s.next.title}</b>
                      <small>
                        {hhmm(s.next.start)} · in {minsText(s.next.start - now)}
                      </small>
                    </div>
                  </div>
                )}
              </section>

              {!!s.mustdos.length && (
                <section className="di-must">
                  <span className="di-label">Must-dos · {mustOpen ? `${mustOpen} left` : 'all done 🎉'}</span>
                  {s.mustdos.map((m) => (
                    <button key={m.i} className={`di-check ${m.done ? 'done' : ''}`} onClick={() => tap({ kind: 'mustdo', i: m.i })}>
                      <i>{m.done ? '✓' : ''}</i>
                      <span>{m.text}</span>
                    </button>
                  ))}
                </section>
              )}

              <section className="di-logs">
                <div className="di-water">
                  <span>💧</span>
                  <div className="di-water-mid">
                    <small>
                      {(water.ml / 1000).toFixed(1)} / {(water.target / 1000).toFixed(1)} L
                    </small>
                    <div className="di-bar water"><i style={{ width: `${water.target ? Math.min(100, (water.ml / water.target) * 100) : 0}%` }} /></div>
                  </div>
                  <button onClick={() => tap({ kind: 'water', ml: 250 })}>+250</button>
                  <button onClick={() => tap({ kind: 'water', ml: 500 })}>+500</button>
                </div>
                {!!s.reps.length && (
                  <div className="di-reps">
                    {s.reps.map((r) => (
                      <button key={r.id} onClick={() => tap({ kind: 'reps', id: r.id, name: r.name, n: 10 })} title={`${r.done}/${r.target}`}>
                        <span>{r.name}</span>
                        <small>
                          {r.done}/{r.target}
                        </small>
                        <b>+10</b>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="di-ben">
                {s.ben.busy ? (
                  <p className="di-typing">
                    <i />
                    <i />
                    <i />
                    <em>{s.ben.steps[s.ben.steps.length - 1] ?? 'thinking'}…</em>
                  </p>
                ) : (
                  s.ben.last && <p className="di-last">{s.ben.last.text.replace(/<[^>]+>/g, '')}</p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    chat()
                  }}
                >
                  <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Ben…" onFocus={() => setPinned(true)} />
                  <button disabled={!text.trim() || s.ben.busy} aria-label="Send">↑</button>
                </form>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
