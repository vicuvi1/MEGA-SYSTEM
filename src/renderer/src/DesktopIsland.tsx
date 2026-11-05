// The desktop island: a command center in its own always-on-top window
// (Windows). One black shape that springs between three states:
// - compact: the pill (what's running, what's next), always there;
// - peek: hold the mouse on it, or something new happens: a bigger pill with
//   one action (start/stop focus, the alert's buttons) and Ben's last line;
// - expanded: click, the shortcut or Reply: the command bar (quick logs or
//   Ben), focus, Ben's message, must-dos, water and the rest of your sections.
// The window never resizes (that made it jump): only the shape animates, with
// springs that can reverse halfway. States and timers live in islandStep
// (core/islandModel.ts), so nothing closes or opens behind your back.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { dayPart } from '@core/islandFeel'
import { DEFAULT_ISLAND_PREFS, EMPTY_ISLAND, ISLAND_SHAPE, ISLAND_UI, activities, clock, islandStep, pill, type Activity, type IslandAction, type IslandPrefs, type IslandSection, type IslandSnapshot, type IslandUi, type IslandUiEvent } from '@core/islandModel'
import type { IslandPlacement } from '../../shared/desktop'
import './island.css'

const desk = () => window.desktop

/** A soft two-note chime (no files): when the island drops down by itself. */
function chime() {
  try {
    const ctx = new AudioContext()
    ;[660, 880].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = ctx.currentTime + i * 0.12
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.4)
    })
    setTimeout(() => void ctx.close(), 900)
  } catch {
    /* no audio */
  }
}
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

function ActIcon({ a, face, small = false }: { a: Activity; face: string; small?: boolean }) {
  const size = small ? 20 : 22
  if (a.kind === 'timer' || a.kind === 'now') return <Ring pct={a.pct} over={a.over} size={size} />
  if (a.kind === 'water') return <span className="di-act-ico">💧</span>
  if (a.kind === 'bed') return <span className="di-act-ico di-moon-sm">🌙</span>
  if (a.kind === 'next') return <span className="di-act-ico">⏭</span>
  return <span className="di-face-sm">{face}</span>
}
/** The time, ticking on its own (the rest of the island doesn't re-render every second). */
function useNow(ms: number) {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

type Run = NonNullable<IslandSnapshot['running']>
function LiveTimer({ run, big = false, guard }: { run: Run; big?: boolean; guard?: IslandSnapshot['focusGuard'] }) {
  const now = useNow(1000)
  const left = (run.endsAt - now) / 1000
  const over = left < 0
  const pct = (now - run.startedAt) / Math.max(1, run.endsAt - run.startedAt)
  if (!big) return <span className={`di-pill-time ${over ? 'over' : ''}`}>{over ? '+' : ''}{clock(left)}</span>
  return (
    <>
      <Ring pct={pct} over={over} size={58} stroke={4} />
      <div className="di-timer-mid">
        <span className={`di-clock ${over ? 'over' : ''}`}>{over ? '+' : ''}{clock(left)}</span>
        <small>{run.subject}</small>
        {guard && (
          <small className={`di-guard ${guard.pct >= 85 ? 'good' : guard.pct < 60 ? 'low' : ''}`} title="How much of this session you've been at the PC (no mouse/keys for 2+ min counts as away)">
            🎯 {guard.pct}% at the PC{guard.idleMin ? ` · away ${guard.idleMin} min` : ''}
          </small>
        )}
      </div>
    </>
  )
}
function LiveRing({ run, size = 22 }: { run: Run; size?: number }) {
  const now = useNow(1000)
  return <Ring pct={(now - run.startedAt) / Math.max(1, run.endsAt - run.startedAt)} over={now > run.endsAt} size={size} />
}

const SPRING_OPEN = { type: 'spring', stiffness: 340, damping: 28, mass: 0.9 } as const
const SPRING_CLOSE = { type: 'spring', stiffness: 520, damping: 44, mass: 0.8 } as const
const PAD = 6 // the shape's distance from the window edge

export function DesktopIsland() {
  const [s, setS] = useState<IslandSnapshot>(EMPTY_ISLAND)
  const now = useNow(s.running ? 5000 : 15_000)
  const [place, setPlace] = useState<IslandPlacement>('top')
  const [prefs, setPrefs] = useState<IslandPrefs>(DEFAULT_ISLAND_PREFS)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()

  // ---- states: one reducer, one timer ----
  const [ui, setUi] = useState<IslandUi>(ISLAND_UI)
  const uiRef = useRef(ui)
  const timer = useRef<number | null>(null)
  const focusInput = useCallback(() => {
    desk()?.islandFocus?.()
    window.setTimeout(() => input.current?.focus(), 40)
  }, [])
  const dispatch = useCallback((e: IslandUiEvent) => {
    const step = islandStep(uiRef.current, e, prefsRef.current.hide)
    uiRef.current = step.ui
    setUi(step.ui)
    if (step.timer !== undefined) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (step.timer) {
        const next = step.timer.event
        timer.current = window.setTimeout(() => dispatch(next), step.timer.ms)
      }
    }
    if (step.focusInput) focusInput()
  }, [focusInput])
  const close = () => dispatch({ type: 'close' })

  useEffect(() => {
    document.documentElement.classList.add('di-root')
    desk()?.onIslandState?.(setS)
    // The desktop watches the real pointer and says when it is over the shape.
    desk()?.onIslandHover?.((on) => dispatch({ type: 'hover', on }))
    desk()?.onIslandPlacement?.(setPlace)
    desk()?.onIslandPrefs?.(setPrefs)
    desk()?.onIslandToggle?.(() => dispatch({ type: 'toggle' }))
    desk()?.onIslandBlur?.(() => dispatch({ type: 'blur' }))
    desk()?.islandReady?.()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && dispatch({ type: 'close' })
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [dispatch])
  // Not open any more: the keyboard goes back to your app.
  useEffect(() => {
    if (ui.view !== 'expanded') {
      input.current?.blur()
      desk()?.islandKeyboard?.(false)
    }
  }, [ui.view])

  // Something new: peek for a moment (only time-up gets through during a call).
  const seenAlert = useRef<string | null>(null)
  useEffect(() => {
    const a = s.alert
    if (!a || a.id === seenAlert.current) return
    if (s.call && a.kind !== 'over') return
    seenAlert.current = a.id
    dispatch({ type: 'alert' })
    if (prefsRef.current.sound && uiRef.current.view !== 'expanded') chime()
  }, [s.alert, s.call, dispatch])

  const p = useMemo(() => pill(s, now), [s, now])
  const acts = useMemo(() => activities(s, now), [s, now])
  const main: Activity | null = acts[0] ?? null
  const run = s.running

  // ---- the shape's size: measured from the view inside it, animated with a spring ----
  const shape = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 120, h: 30 })
  useLayoutEffect(() => {
    const el = shape.current?.querySelector<HTMLElement>(`[data-view="${ui.view}"]`)
    if (!el) return
    const fit = () => {
      const max = ISLAND_SHAPE.expanded.maxHeight
      setSize((o) => {
        const w = Math.ceil(el.offsetWidth)
        const h = Math.ceil(Math.min(max, el.offsetHeight))
        return o.w === w && o.h === h ? o : { w, h }
      })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ui.view])

  // Tell the desktop where the shape is: clicks elsewhere pass through.
  // While it grows, the bigger of now and the target; exact when it settles.
  const rectFor = useCallback((w: number, h: number) => {
    const W = window.innerWidth
    const x = place === 'left' ? PAD : place === 'right' ? W - PAD - w : (W - w) / 2
    const y = place === 'left' || place === 'right' ? 40 - 19 : PAD
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
  }, [place])
  const [moving, setMoving] = useState(false)
  const reportNow = () => {
    const r = shape.current?.getBoundingClientRect()
    if (r) desk()?.islandHot?.({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
  }
  const onStart = () => {
    setMoving(true)
    const r = shape.current?.getBoundingClientRect()
    const t = rectFor(size.w, size.h)
    if (!r) return desk()?.islandHot?.(t)
    const x = Math.min(r.left, t.x)
    const y = Math.min(r.top, t.y)
    desk()?.islandHot?.({ x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(r.right, t.x + t.width) - x), height: Math.round(Math.max(r.bottom, t.y + t.height) - y) })
  }
  const onDone = () => {
    setMoving(false)
    reportNow()
  }
  useEffect(() => {
    desk()?.islandHot?.(rectFor(size.w, size.h))
  }, [rectFor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- drag (the pill or the panel's header); a plain click still opens ----
  const dragged = useRef(false)
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !desk()?.islandDrag) return
      const hit = (e.target as HTMLElement).closest('button, input, textarea, a')
      if (hit && hit !== e.currentTarget) return
      const el = e.currentTarget
      const id = e.pointerId
      const sx = e.screenX
      const sy = e.screenY
      let started = false
      dragged.current = false
      const move = (ev: PointerEvent) => {
        if (started || Math.hypot(ev.screenX - sx, ev.screenY - sy) < 5) return
        started = true
        dragged.current = true
        try { el.setPointerCapture(id) } catch { /* fine */ }
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

  // ---- taps: every one shows what happened ("Saving…", then ✓ or why not) ----
  const [toast, setToast] = useState<{ id: string; state: 'busy' | 'ok' | 'err'; text: string } | null>(null)
  const toastT = useRef<number | null>(null)
  const label = (a: IslandAction): string | null =>
    a.kind === 'water' ? `+${a.ml} ml water`
    : a.kind === 'reps' ? `+${a.n} ${a.name}`
    : a.kind === 'mustdo' ? 'Must-do'
    : a.kind === 'chat' ? 'Sent to Ben'
    : a.kind === 'start' ? `Timer: ${a.subject}`
    : a.kind === 'stop' ? 'Logged'
    : a.kind === 'extend' ? `+${a.minutes} min`
    : a.kind === 'bed' ? (a.time ? `Bed at ${a.time} · Waky` : 'Good night 🌙 · logged in Waky')
    : a.kind === 'wake' ? 'Good morning ☀️ · wake-up logged'
    : a.kind === 'push' ? `${a.block.title}: moved ${a.minutes} min later`
    : a.kind === 'blockResult' ? (a.result === 'done' ? `✓ ${a.block.title}: done` : a.result === 'half' ? `½ ${a.block.title}: half done` : `${a.block.title}: not done, noted`)
    : a.kind === 'autoFocus' ? (a.on ? 'Focus starts by itself with each block' : 'Auto-start off')
    : a.kind === 'moveBreak' ? `💪 +${a.n} ${a.name} · nice break`
    : a.kind === 'eyeBreaks' ? (a.on ? 'Eye breaks on: every 20 min' : 'Eye breaks off')
    : a.kind === 'closeDay' ? 'Opening Close your day…'
    : a.kind === 'todoDone' ? `✓ ${a.content}`
    : a.kind === 'clipSave' ? (a.to === 'task' ? 'Adding to Todoist…' : 'Saving to Notebook…')
    : a.kind === 'book' ? 'Finding a free slot…'
    : a.kind === 'voice' ? '🎤 Sent to Ben'
    : null
  const clearToastLater = (ms: number) => {
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = window.setTimeout(() => setToast(null), ms)
  }
  useEffect(() => {
    desk()?.onIslandAck?.((ack) => {
      setToast((t) => (t && t.id === ack.id ? { ...t, state: ack.ok ? 'ok' : 'err', text: ack.ok ? (ack.text ?? `✓ ${t.text}`) : `⚠ ${ack.error ?? 'It did not work'}` } : t))
      clearToastLater(ack.ok ? (ack.text ? 4500 : 2200) : 7000)
    })
  }, [])
  const send = (a: IslandAction) => {
    const t = label(a)
    if (!t) return desk()?.islandAction?.(a)
    const id = Math.random().toString(36).slice(2, 10)
    setToast({ id, state: 'busy', text: t })
    if (toastT.current) clearTimeout(toastT.current)
    // No answer at all: the app window isn't running (or is stuck).
    toastT.current = window.setTimeout(
      () => setToast((x) => (x && x.id === id && x.state === 'busy' ? { id, state: 'err', text: "⚠ The app didn't answer. Is Life System running? Open it from the tray." } : x)),
      a.kind === 'chat' ? 120_000 : 12_000
    )
    desk()?.islandAction?.({ ...a, id })
  }
  const tap = (a: IslandAction, lbl?: string) => {
    if (lbl === 'Reply') {
      dispatch({ type: 'click' })
      focusInput()
      return send(a)
    }
    send(a)
    if (a.kind === 'open' || a.kind === 'closeDay') {
      desk()?.showApp?.(a.kind === 'open' ? a.page : 'today')
      close()
    }
    // Answered the thing that peeked: it goes back to the pill.
    if (uiRef.current.byAlert && ['dismiss', 'start', 'stop', 'push', 'blockResult', 'moveBreak', 'clipSave', 'water'].includes(a.kind)) close()
  }
  const chat = () => {
    const t = text.trim()
    if (!t || s.ben.busy) return
    setText('')
    dispatch({ type: 'typing', on: false })
    send({ kind: 'chat', text: t })
  }

  const water = s.water
  const mustOpen = s.mustdos.filter((m) => !m.done).length
  const [moon, setMoon] = useState(false)
  const goToBed = () => {
    setMoon(true)
    send({ kind: 'bed' })
    window.setTimeout(() => (setMoon(false), close()), 2600)
  }
  const pts = s.points
  // Points that pop from the pill; a reward unlocking gets confetti.
  const [pop, setPop] = useState<{ n: number; key: number } | null>(null)
  const prevPts = useRef<number | null>(null)
  useEffect(() => {
    const b = s.points?.balance
    if (b == null) return
    const before = prevPts.current
    prevPts.current = b
    if (before != null && b > before) {
      setPop({ n: b - before, key: Date.now() })
      const t = window.setTimeout(() => setPop(null), 1800)
      return () => clearTimeout(t)
    }
  }, [s.points?.balance])
  const confetti = s.alert?.kind === 'reward'
  // Hold 🎤 to talk to Ben (a voice note, like on Telegram).
  const [rec, setRec] = useState<{ r: MediaRecorder; parts: Blob[]; at: number } | null>(null)
  const startRec = async () => {
    if (rec || s.ben.busy) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      const parts: Blob[] = []
      r.ondataavailable = (e) => e.data.size && parts.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (Date.now() - started < 700) return
        const blob = new Blob(parts, { type: r.mimeType.split(';')[0] })
        const fr = new FileReader()
        fr.onload = () => send({ kind: 'voice', mime: blob.type || 'audio/webm', data: String(fr.result).split(',')[1] ?? '' })
        fr.readAsDataURL(blob)
      }
      const started = Date.now()
      r.start()
      setRec({ r, parts, at: started })
      dispatch({ type: 'typing', on: true })
    } catch {
      setToast({ id: 'mic', state: 'err', text: '⚠ No microphone (allow it for Life System in Windows privacy settings)' })
      clearToastLater(6000)
    }
  }
  const stopRec = () => {
    if (!rec) return
    rec.r.stop()
    setRec(null)
    dispatch({ type: 'typing', on: !!text.trim() })
  }
  // Drop a task (text) on the island: booked in the next free slot today.
  const [dropping, setDropping] = useState(false)
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.types].some((t) => t === 'text/plain')) {
        e.preventDefault()
        setDropping(true)
      }
    },
    onDragLeave: () => setDropping(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDropping(false)
      const t = e.dataTransfer.getData('text/plain').trim()
      if (t) send({ kind: 'book', text: t })
    }
  }

    const blocks: Record<IslandSection, ReactNode> = {
    tasks: s.tasks?.length ? (<section className="di-tasks">
                  <span className="di-label">Todoist · next up</span>
                  {s.tasks.map((t) => (
                    <button key={t.id} className="di-task" onClick={() => send({ kind: 'todoDone', id: t.id, content: t.content })} title="Done: tick it in Todoist">
                      <i />
                      <span>{t.content}</span>
                      {t.time && <small>{t.time}</small>}
                    </button>
                  ))}
                </section>) : null,
    sleep: s.sleep?.bed || s.sleep?.wake ? (<section className={`di-sleep ${s.sleep?.bed ? 'night' : 'day'} ${moon ? 'going' : ''}`}>
                  {s.sleep?.bed ? (
                    <>
                      <span className="di-moon" aria-hidden>🌙<i>✦</i><i>✦</i><i>✦</i></span>
                      <div className="di-sleep-mid">
                        <b>{moon ? 'Sleep well' : 'Bedtime'}</b>
                        <small>{moon ? 'Logged in Waky. See you tomorrow.' : s.windDown ? `Bed at ${s.windDown.bedAt} · ${s.windDown.minutesLeft} min to wind down` : `Target ${s.sleep.target ?? '23:00'} · one tap logs it in Waky`}</small>
                        {s.windDown && !moon && (
                          <ol className="di-steps">
                            <li><button onClick={() => tap({ kind: 'closeDay' })}>Tomorrow's top 3 + close the day</button></li>
                            <li>Screens off, phone away</li>
                            <li>Tap Going to bed</li>
                          </ol>
                        )}
                      </div>
                      <button className="primary" onClick={goToBed} disabled={moon}>🌙 Going to bed</button>
                    </>
                  ) : (
                    <>
                      <span className="di-sun" aria-hidden>☀️</span>
                      <div className="di-sleep-mid">
                        <b>Good morning</b>
                        <small>Log your wake-up in Waky</small>
                      </div>
                      <button className="primary" onClick={() => tap({ kind: 'wake' })}>☀️ I'm up</button>
                    </>
                  )}
                </section>) : null,
    points: pts ? (<section className="di-points">
                  <span className="di-pts">{pts.balance} pts</span>
                  {pts.goal ? (
                    <div className="di-pts-mid">
                      <div className="di-bar gold"><i style={{ width: `${Math.min(100, (pts.balance / pts.goal.price) * 100)}%` }} /></div>
                      <small>{pts.balance >= pts.goal.price ? `Ready: ${pts.goal.title} 🎉` : `${pts.goal.price - pts.balance} to ${pts.goal.title}`}</small>
                    </div>
                  ) : (
                    <small className="di-pts-mid">Add a reward to work toward</small>
                  )}
                  <button onClick={() => tap({ kind: 'open', page: 'shop' })}>Rewards</button>
                </section>) : null,

    timer: run ? (<section className="di-timer">
                  <LiveTimer run={run} big guard={s.focusGuard} />
                  <div className="di-actions col">
                    <button className="primary" onClick={() => tap({ kind: 'stop' })}>Stop & log</button>
                    <button onClick={() => tap({ kind: 'extend', minutes: 5 })}>+5 min</button>
                  </div>
                </section>) : null,
    plan: (<section className="di-plan">
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
                <label className="di-auto" title="When a block from your calendar begins, its focus timer starts by itself (not for calls)">
                  <input type="checkbox" checked={!!s.autoFocus} onChange={(e) => send({ kind: 'autoFocus', on: e.target.checked })} />
                  <span>⚡ Start focus by itself when a block begins</span>
                </label>
              </section>),
    mustdos: s.mustdos.length ? (<section className="di-must">
                  <span className="di-label">Must-dos · {mustOpen ? `${mustOpen} left` : 'all done 🎉'}</span>
                  {s.mustdos.map((m) => (
                    <button key={m.i} className={`di-check ${m.done ? 'done' : ''}`} onClick={() => tap({ kind: 'mustdo', i: m.i })}>
                      <i>{m.done ? '✓' : ''}</i>
                      <span>{m.text}</span>
                    </button>
                  ))}
                </section>) : null,
    logs: (<section className="di-logs">
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
                <label className="di-auto" title="Every 20 min at the screen: look at something 6 m away for 20 s">
                  <input type="checkbox" checked={!!s.eyeBreaks} onChange={(e) => send({ kind: 'eyeBreaks', on: e.target.checked })} />
                  <span>👁️ 20-20-20 eye breaks</span>
                </label>
              </section>),
    ben: s.ben.busy || s.ben.last ? (<section className="di-ben">
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
                {!s.ben.busy && <button className="di-reply" onClick={focusInput}>Reply</button>}
              </section>) : null
  }
  // ---- compact: the pill ----
  const pillTime = (a: Activity) => {
    if (a.kind === 'timer' && run) return <LiveTimer run={run} />
    const t = a.kind === 'water' ? '' : a.sub
    return <span className={`di-pill-time ${a.over ? 'over' : ''}`}>{place === 'left' || place === 'right' ? String(t ?? '').replace(/\s*left$/i, '') : t}</span>
  }
  const icon = (a: Activity) => (a.kind === 'timer' && run ? <LiveRing run={run} /> : <ActIcon a={a} face={s.ben.face} />)
  const compact = (
    <div
      className={`di-pill kind-${s.locked ? 'locked' : main?.kind ?? 'idle'}`}
      role="button"
      tabIndex={0}
      {...dragProps}
      onClick={() => {
        if (dragged.current) return void (dragged.current = false)
        if (s.locked) desk()?.showApp?.()
        else dispatch({ type: 'click' })
      }}
      onKeyDown={(e) => e.key === 'Enter' && dispatch({ type: 'click' })}
      aria-label="Open the island (drag to move it)"
    >
      {s.locked ? (
        <span className="di-pill-text">🔒 Open Life System</span>
      ) : !main ? (
        <>
          <span className="di-face-sm">{s.ben.face}</span>
          {s.streak && <span className={`di-flame ${s.streak.atRisk ? 'risk' : ''}`}>🔥<b>{s.streak.days}</b></span>}
        </>
      ) : (
        <>
          {icon(main)}
          <span className="di-pill-text">{main.kind === 'timer' ? main.sub : main.kind === 'next' ? `Next: ${main.text}` : main.text}</span>
          {pillTime(main)}
          {s.streak && <span className={`di-flame ${s.streak.atRisk ? 'risk' : ''}`} title={`${s.streak.days}-day ${s.streak.kind} streak${s.streak.atRisk ? ' · at risk today!' : ''}`}>🔥<b>{s.streak.days}</b></span>}
        </>
      )}
      {pop && <span key={pop.key} className="di-pop" aria-live="polite">+{pop.n} ⭐</span>}
      {p.dot && <i className="di-dot" />}
    </div>
  )

  // ---- peek: the alert, or what's on with one action and Ben's last line ----
  const a = s.alert
  const benLine = s.ben.last?.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const peek = a && (ui.byAlert || !main) ? (
    <div className={`di-peek alert kind-${a.kind}`} onClick={(e) => e.target === e.currentTarget && dispatch({ type: 'click' })}>
      <div className="di-peek-top">
        <span className="di-peek-face">{a.face ?? (a.kind === 'ben' ? s.ben.face : a.kind === 'over' ? '⏰' : '▶')}</span>
        <div className="di-peek-mid">
          <b>{a.title}</b>
          <small>{a.text}</small>
        </div>
      </div>
      {a.actions.length > 0 && (
        <div className="di-actions">
          {a.actions.slice(0, 3).map((x) => (
            <button key={x.label} className={x.primary ? 'primary' : ''} onClick={() => tap(x.action, x.label)}>{x.label}</button>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="di-peek" onClick={() => dispatch({ type: 'click' })} {...dragProps}>
      <div className="di-peek-top">
        {main ? (run && main.kind === 'timer' ? <LiveRing run={run} size={34} /> : <span className="di-peek-face">{main.kind === 'ben' ? s.ben.face : <ActIcon a={main} face={s.ben.face} />}</span>) : <span className="di-peek-face">{s.ben.face}</span>}
        <div className="di-peek-mid">
          <b>{main ? (main.kind === 'timer' ? main.sub : main.text) : s.ben.move?.title ?? 'Nothing running'}</b>
          <small>{main ? (main.kind === 'timer' && run ? <LiveTimer run={run} /> : main.sub) : s.ben.move?.sub ?? 'Click for the command center'}</small>
        </div>
        {run ? (
          <button className="primary" onClick={(e) => (e.stopPropagation(), tap({ kind: 'stop' }))}>Stop & log</button>
        ) : s.now ? (
          <button className="primary" onClick={(e) => (e.stopPropagation(), tap({ kind: 'start', subject: s.now!.title, minutes: Math.max(5, Math.min(90, Math.round((s.now!.end - now) / 60000))) }))}>▶ Start</button>
        ) : (
          <button className="primary" onClick={(e) => (e.stopPropagation(), tap({ kind: 'start', subject: 'Focus', minutes: 25 }))}>▶ Focus 25</button>
        )}
      </div>
      {benLine && <p className="di-peek-ben"><span>{s.ben.face}</span>{benLine}</p>}
    </div>
  )

  // ---- expanded: the command center ----
  const firstRep = s.reps[0]
  const expanded = (
    <div className="di-panel" role="dialog" aria-label="Life System command center">
      <header className="di-head" {...dragProps}>
        <span className={`di-face mood-${s.ben.mood}`}>{s.ben.face}</span>
        <div className="di-who">
          <b>Ben</b>
          <small>{s.ben.busy ? 'thinking…' : s.ben.why ? `${s.ben.mood} · ${s.ben.why}` : s.ben.mood}</small>
        </div>
        <button className={`di-icon ${ui.pinned ? 'on' : ''}`} onClick={() => dispatch({ type: 'pin' })} title={ui.pinned ? 'Unpin' : 'Keep open'}>📌</button>
        <button className="di-icon" onClick={() => (desk()?.showApp?.(), close())} title="Open Life System">⤢</button>
        <button className="di-icon" onClick={close} aria-label="Close" title="Close (Esc)">✕</button>
      </header>

      <form
        className="di-cmd"
        onSubmit={(e) => {
          e.preventDefault()
          chat()
        }}
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => (setText(e.target.value), uiRef.current.typing || dispatch({ type: 'typing', on: true }))}
          placeholder="spent 40 taxi · water 500 · 30 pushups · ask Ben"
          onPointerDown={() => desk()?.islandFocus?.()}
          onFocus={() => dispatch({ type: 'typing', on: true })}
          onBlur={() => dispatch({ type: 'typing', on: !!text.trim() })}
        />
        <button type="button" className={`di-mic ${rec ? 'on' : ''}`} aria-label="Hold to talk to Ben" title="Hold to talk to Ben" disabled={s.ben.busy} onPointerDown={(e) => (e.preventDefault(), void startRec())} onPointerUp={stopRec} onPointerLeave={stopRec}>
          {rec ? '●' : '🎤'}
        </button>
        <button className="di-send" disabled={!text.trim() || s.ben.busy} aria-label="Send">↑</button>
      </form>
      <div className="di-chips">
        <button onClick={() => tap({ kind: 'water', ml: 250 })}>💧 +250 ml</button>
        {firstRep && <button onClick={() => tap({ kind: 'reps', id: firstRep.id, name: firstRep.name, n: 10 })}>💪 +10 {firstRep.name}</button>}
        {!run && <button onClick={() => tap({ kind: 'start', subject: s.now?.title ?? 'Focus', minutes: 25 })}>▶ Focus 25</button>}
        {run && <button onClick={() => tap({ kind: 'extend', minutes: 5 })}>+5 min</button>}
      </div>

      {confetti && (
        <div className="di-confetti" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: String(i) }}>{['🎉', '⭐', '✨', '🎁'][i % 4]}</i>
          ))}
        </div>
      )}
      {a && (
        <section className={`di-alert kind-${a.kind}`}>
          <div className="di-alert-top">
            <span>{a.face ?? (a.kind === 'ben' ? s.ben.face : a.kind === 'over' ? '⏰' : '▶')}</span>
            <b>{a.title}</b>
          </div>
          <p>{a.text}</p>
          <div className="di-actions">
            {a.actions.map((x) => (
              <button key={x.label} className={x.primary ? 'primary' : ''} onClick={() => tap(x.action, x.label)}>{x.label}</button>
            ))}
          </div>
        </section>
      )}
      {prefs.sections.filter((x) => x.on).map((x) => <Fragment key={x.id}>{blocks[x.id]}</Fragment>)}
    </div>
  )

  const views = { compact, peek, expanded }
  const radius = ui.view === 'compact' ? (place === 'left' || place === 'right' ? 20 : ISLAND_SHAPE.compact.radius) : ui.view === 'peek' ? ISLAND_SHAPE.peek.radius : ISLAND_SHAPE.expanded.radius
  const transition = reduce ? { duration: 0 } : ui.view === 'compact' ? SPRING_CLOSE : SPRING_OPEN
  return (
    <div
      {...dropProps}
      style={{ ['--di-alpha' as string]: String(prefs.opacity) }}
      className={`di at-${place} look-${prefs.look} view-${ui.view} mood-${s.ben.mood} ${run ? 'has-timer' : ''} ${run && now > run.endsAt ? 'is-over' : ''} ${s.call ? 'in-call' : ''} ${s.windDown ? 'winddown' : ''} ${dropping ? 'dropping' : ''} ${moving ? 'moving' : ''} tod-${dayPart(now)} ${confetti ? 'confetti' : ''}`}
    >
      <motion.div
        ref={shape}
        className="di-shape"
        initial={false}
        animate={{ width: size.w, height: size.h, borderRadius: radius }}
        transition={transition}
        onAnimationStart={onStart}
        onAnimationComplete={onDone}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={ui.view}
            data-view={ui.view}
            className={`di-view di-v-${ui.view}`}
            initial={reduce ? false : { opacity: 0, scale: 0.94, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: reduce ? { duration: 0 } : { delay: 0.06, duration: 0.24, ease: [0.2, 0.8, 0.2, 1] } }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.97, filter: 'blur(4px)', transition: { duration: 0.12 } }}
          >
            {views[ui.view]}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {toast && (
          <motion.div key="toast" className={`di-toast ${toast.state}`} role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            {toast.state === 'busy' ? `${toast.text}…` : toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
