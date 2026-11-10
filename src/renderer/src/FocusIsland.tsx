// The focus island: a small pill at the top of the app (under the camera, like
// the iPhone's Dynamic Island) on every page. Running: a progress ring, the
// subject and a live countdown; hover to open it: stop & log, +5 / +15,
// cancel, what's next, water, a promise the coach is waiting on. Nothing
// running: a dot (or nothing until you move the mouse to the top), and a
// quick start. Time up: it flashes and chimes. Everything is customizable
// (gear inside), saved on this device only.
import { focusEndsAt } from '@core/focus'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import type { FocusState } from '@shared/api'
import { life } from './bridge'
import { useLive } from './live'
import { useTodayEvents } from './todayEvents'
import { useFocusSound } from './focusSound'
import { useAction } from './ui'

export interface IslandPrefs {
  on: boolean
  pos: 'top' | 'top-left' | 'top-right' | 'bottom'
  look: 'black' | 'glass' | 'accent'
  size: 'compact' | 'large'
  idle: 'hidden' | 'dot' | 'peek'
  seconds: boolean
  tabTitle: boolean
  chime: boolean
  showNext: boolean
  showWater: boolean
  showPromise: boolean
  /** AF19: dim the rest of the app while a timer runs. */
  dim: boolean
  presets: number[]
}

const KEY = 'ls.island'
export const DEFAULT_ISLAND: IslandPrefs = { on: true, pos: 'top', look: 'black', size: 'compact', idle: 'dot', seconds: true, tabTitle: true, chime: true, showNext: true, showWater: true, showPromise: true, dim: true, presets: [25, 50, 90] }

function loadPrefs(): IslandPrefs {
  try {
    return { ...DEFAULT_ISLAND, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return DEFAULT_ISLAND
  }
}

const two = (n: number) => String(n).padStart(2, '0')
/** 16:24, 1:05:09, or 16m without seconds. */
export function clockText(sec: number, seconds = true): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (!seconds) return h ? `${h}h ${two(m)}m` : `${m}m`
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

function Ring({ pct, over, size = 22 }: { pct: number; over: boolean; size?: number }) {
  const r = size / 2 - 2.5
  const c = 2 * Math.PI * r
  return (
    <svg className={`isl-ring ${over ? 'over' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

/** `hideNext`: the page already shows what's next (Today's "Next" line), so the pill doesn't repeat it. */
export function FocusIsland({ hideNext = false, noDim = false }: { hideNext?: boolean; /** The Study Time page is the timer's own page: never dimmed. */ noDim?: boolean } = {}) {
  const reduce = useReducedMotion()
  const act = useAction()
  const [prefs, setPrefsState] = useState<IslandPrefs>(loadPrefs)
  const [undimmed, setUndimmed] = useState<string | null>(null)
  const setPrefs = (p: Partial<IslandPrefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* private window */
      }
      return next
    })
  useEffect(() => {
    const on = () => setPrefsState(loadPrefs())
    window.addEventListener('life-island-prefs', on)
    return () => window.removeEventListener('life-island-prefs', on)
  }, [])
  const [focus, setFocus] = useState<FocusState | null>(null)
  const [extra, setExtra] = useState<{ waterMl: number; waterTarget: number; promise: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [gear, setGear] = useState(false)
  const [flash, setFlash] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [subject, setSubject] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const chimed = useRef<string | null>(null)
  const closeT = useRef<number | null>(null)
  const { events } = useTodayEvents()

  const load = useCallback(() => {
    life.focus.state().then(setFocus).catch(() => {})
  }, [])
  const loadExtra = useCallback(() => {
    life.coach
      ?.status?.()
      .then((s) => setExtra({ waterMl: s.today.waterMl, waterTarget: s.today.waterTarget, promise: s.promises.awaiting[s.promises.awaiting.length - 1] ?? null }))
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    loadExtra()
    const onFocus = () => load()
    window.addEventListener('life-focus-changed', onFocus)
    const t = setInterval(loadExtra, 60_000)
    return () => {
      window.removeEventListener('life-focus-changed', onFocus)
      clearInterval(t)
    }
  }, [load, loadExtra])
  useLive(() => {
    load()
    loadExtra()
  })

  const run = focus?.running ?? null
  const startMs = run ? Date.parse(run.startedAt) : 0
  // IC1: a paused timer ends later by its pauses; while paused its clock stands still.
  const pausedAt = run?.pausedAt ? Date.parse(run.pausedAt) : null
  const endMs = run ? focusEndsAt(run) : 0
  // A second tick while running (a slow one otherwise, for "next block in …").
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), run ? 1000 : 30_000)
    return () => clearInterval(t)
  }, [run])

  const at = pausedAt ?? now
  const leftSec = run ? (endMs - at) / 1000 : 0
  const over = !!run && leftSec < 0
  const pct = run ? Math.min(1, (at - startMs) / (endMs - startMs)) : 0

  // Time's up: flash, open for a moment, chime once per session.
  useEffect(() => {
    if (!run || !over || chimed.current === run.startedAt) return
    chimed.current = run.startedAt
    setFlash(true)
    setOpen(true)
    const t = window.setTimeout(() => {
      setFlash(false)
      if (!pinned) setOpen(false)
    }, 8000)
    return () => clearTimeout(t)
  }, [run, over, pinned])
  // Its sounds: the swell, your background, the last 10 seconds and the gong.
  useFocusSound(run ? { startedAt: startMs, endsAt: endMs } : null, prefs.chime)

  // The countdown in the tab title, so you see it from other tabs too.
  const baseTitle = useRef<string>(typeof document !== 'undefined' ? document.title : 'Life System')
  useEffect(() => {
    if (!run || !prefs.tabTitle) {
      if (document.title.startsWith('⏱')) document.title = baseTitle.current
      return
    }
    if (!document.title.startsWith('⏱')) baseTitle.current = document.title
    document.title = `⏱ ${over ? '+' : ''}${clockText(Math.abs(leftSec), true)} · ${run.subject}`
  }, [run, prefs.tabTitle, leftSec, over])
  useEffect(() => () => void (document.title.startsWith('⏱') && (document.title = baseTitle.current)), [])

  const next = useMemo(() => {
    const upcoming = events.filter((e) => !e.allDay && Date.parse(e.start) > now).sort((a, b) => a.start.localeCompare(b.start))[0]
    if (!upcoming) return null
    const mins = Math.round((Date.parse(upcoming.start) - now) / 60000)
    return { title: upcoming.title, at: new Date(upcoming.start).toTimeString().slice(0, 5), mins }
  }, [events, now])
  // A notification card about the same event is on screen: the pill steps aside until it closes.
  const [toastTitles, setToastTitles] = useState<string[]>([])
  useEffect(() => {
    const on = (e: Event) => setToastTitles(((e as CustomEvent).detail as string[]) ?? [])
    window.addEventListener('life-toasts', on)
    return () => window.removeEventListener('life-toasts', on)
  }, [])
  const saidElsewhere = hideNext || (!!next && toastTitles.some((t) => t.includes(next.title)))
  const soonBlock = next && next.mins <= 10 && !saidElsewhere ? next : null

  const subjects = useMemo(() => [...new Set([...(focus?.goals ?? []).map((g) => g.subject), ...(focus?.plan.items.filter((x) => !x.done).map((x) => x.text.split(/\s+/).slice(0, 3).join(' ')) ?? []), ...(focus?.subjects ?? [])])].slice(0, 6), [focus])

  // AF19: while a timer runs the rest of the app dims (opacity only); a click
  // or Esc brings it back for this session.
  const dimOn = !!run && prefs.dim && !noDim && undimmed !== run.startedAt
  useEffect(() => {
    if (!dimOn || !run) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setUndimmed(run.startedAt)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [dimOn, run])

  if (!prefs.on || !focus) return null

  const enter = () => {
    if (closeT.current) clearTimeout(closeT.current)
    setOpen(true)
  }
  const leave = () => {
    if (pinned) return
    closeT.current = window.setTimeout(() => {
      setOpen(false)
      setGear(false)
      setConfirmCancel(false)
    }, 350)
  }

  const start = async (minutes: number) => {
    const subj = (subject || subjects[0] || 'Focus').trim()
    const r = await act(() => life.focus.start(subj, minutes, null), `Focus started: ${subj} · ${minutes} min`)
    if (r) {
      setFocus(r)
      setSubject('')
    }
  }
  const stop = async () => {
    const r = await act(() => life.focus.stop(), 'Logged')
    if (r) {
      setFocus(r.state)
      setPinned(false)
      setOpen(false)
    }
  }
  const pauseOrGo = async () => {
    const f = pausedAt ? life.focus.resume : life.focus.pause
    if (!f) return
    const r = await act(() => f(), pausedAt ? 'Going on' : "Paused · this time doesn't count")
    if (r) setFocus(r)
  }
  const extend = async (m: number) => {
    if (!life.focus.extend) return
    const r = await act(() => life.focus.extend!(m), `+${m} min`)
    if (r) {
      setFocus(r)
      chimed.current = null
    }
  }
  const cancel = async () => {
    if (!confirmCancel) return setConfirmCancel(true)
    const r = await act(() => life.focus.cancel(), 'Timer cancelled')
    if (r) {
      setFocus(r)
      setConfirmCancel(false)
      setPinned(false)
      setOpen(false)
    }
  }

  // What the closed pill says.
  const idleText = soonBlock ? `📚 ${soonBlock.title} in ${soonBlock.mins} min` : prefs.showPromise && extra?.promise ? `🤝 ${extra.promise}` : next && prefs.idle === 'peek' && !saidElsewhere ? `Next: ${next.title} ${next.at}` : 'Ready to focus'
  const showIdlePill = prefs.idle !== 'hidden' || open || !!soonBlock
  const cls = ['isl', `pos-${prefs.pos}`, `look-${prefs.look}`, `size-${prefs.size}`, run ? 'running' : 'idle', open ? 'open' : '', over ? 'over' : '', flash ? 'flash' : '', !run && prefs.idle === 'dot' && !soonBlock ? 'isl-dotmode' : ''].filter(Boolean).join(' ')

  return (
    <>
      {run && prefs.dim && <div className={`focus-dim ${dimOn ? 'on' : ''}`} onClick={() => setUndimmed(run.startedAt)} title="Click to bring everything back" aria-hidden />}
      {/* The hot zone: move the mouse to the top (under the camera) and it opens. */}
      <div className={`isl-zone pos-${prefs.pos}`} onMouseEnter={enter} onMouseLeave={leave} aria-hidden />
      {(run || showIdlePill) && (
        <div
          className={cls}
          onMouseEnter={enter}
          onMouseLeave={leave}
          role="region"
          aria-label="Focus island"
          style={{ borderRadius: open ? 28 : 22 }}
        >
          <button className="isl-pill" onClick={() => (setPinned((p) => !p), setOpen(true))} aria-expanded={open} title={pinned ? 'Unpin' : 'Pin open'}>
            {run ? (
              <>
                <Ring pct={pct} over={over} size={prefs.size === 'large' ? 26 : 20} />
                <span className="isl-subj">{pausedAt ? `⏸ ${run.subject}` : run.subject}</span>
                <span className="isl-time">
                  {over ? '+' : ''}
                  {clockText(Math.abs(leftSec), prefs.seconds)}
                </span>
              </>
            ) : prefs.idle === 'dot' && !open && !soonBlock ? (
              <i className="isl-dot" />
            ) : (
              <span className="isl-idle">{idleText}</span>
            )}
          </button>

          <AnimatePresence initial={false}>
          {open && (
            <m.div
              key="body"
              className="isl-body"
              initial={reduce ? false : { opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? { duration: 0 } : { delay: 0.05, duration: 0.22 } }}
              exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            >
              {gear ? (
                <IslandSettings prefs={prefs} setPrefs={setPrefs} onBack={() => setGear(false)} />
              ) : run ? (
                <>
                  <div className="isl-big">
                    <Ring pct={pct} over={over} size={64} />
                    <div>
                      <small>{pausedAt ? 'Paused' : over ? 'Time is up: log it' : 'Focus'}</small>
                      <b>{run.subject}</b>
                      <span className="isl-bigtime">
                        {over ? '+' : ''}
                        {clockText(Math.abs(leftSec), true)}
                      </span>
                      <em>
                        {run.planned} min · ends {new Date(endMs).toTimeString().slice(0, 5)}
                      </em>
                    </div>
                  </div>
                  <div className="isl-actions">
                    <button className="btn primary small" onClick={() => void stop()}>
                      ⏹ Stop & log
                    </button>
                    {life.focus.pause && (
                      <button className="btn ghost small" onClick={() => void pauseOrGo()} title={pausedAt ? 'Go on with the timer' : "Pause: this time doesn't count"}>
                        {pausedAt ? '▶ Resume' : '⏸ Pause'}
                      </button>
                    )}
                    {life.focus.extend && (
                      <>
                        <button className="btn ghost small" onClick={() => void extend(5)}>
                          +5
                        </button>
                        <button className="btn ghost small" onClick={() => void extend(15)}>
                          +15
                        </button>
                      </>
                    )}
                    <button className={`btn ghost small ${confirmCancel ? 'danger' : ''}`} onClick={() => void cancel()} title="Drop it without logging">
                      {confirmCancel ? 'Sure? Cancel' : 'Cancel'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="isl-start">
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={subjects[0] ? `Focus on… (${subjects[0]})` : 'Focus on…'} list="isl-subjects" onKeyDown={(e) => e.key === 'Enter' && void start(prefs.presets[0] ?? 25)} />
                    <datalist id="isl-subjects">
                      {subjects.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                    <div className="isl-presets">
                      {prefs.presets.map((m) => (
                        <button key={m} className="btn primary small" onClick={() => void start(m)}>
                          ▶ {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  {subjects.length > 0 && (
                    <div className="isl-chips">
                      {subjects.map((s) => (
                        <button key={s} className={`chip ${subject === s ? 'on' : ''}`} onClick={() => setSubject(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!gear && (
                <div className="isl-lines">
                  {prefs.showNext && next && (
                    <span>
                      🗓 {next.title} · {next.at} <em>in {next.mins >= 60 ? `${Math.floor(next.mins / 60)}h ${next.mins % 60}m` : `${next.mins} min`}</em>
                    </span>
                  )}
                  {prefs.showWater && extra && extra.waterTarget > 0 && (
                    <span>
                      💧 {(extra.waterMl / 1000).toFixed(1)} / {(extra.waterTarget / 1000).toFixed(1)} L
                      <i className="isl-water">
                        <i style={{ width: `${Math.min(100, (extra.waterMl / extra.waterTarget) * 100)}%` }} />
                      </i>
                    </span>
                  )}
                  {prefs.showPromise && extra?.promise && <span>🤝 Waiting: {extra.promise}</span>}
                  <span className="isl-foot">
                    Today {focus.todayMin} min focus
                    <button className="isl-gear" onClick={() => setGear(true)} aria-label="Customize the island" title="Customize">
                      ⚙
                    </button>
                    <button className="isl-gear" onClick={() => setPinned((p) => !p)} aria-label={pinned ? 'Unpin' : 'Keep open'} title={pinned ? 'Unpin' : 'Keep open'}>
                      {pinned ? '📌' : '📍'}
                    </button>
                  </span>
                </div>
              )}
            </m.div>
          )}
          </AnimatePresence>
        </div>
      )}
    </>
  )
}

function IslandSettings({ prefs, setPrefs, onBack }: { prefs: IslandPrefs; setPrefs: (p: Partial<IslandPrefs>) => void; onBack: () => void }) {
  const seg = <K extends keyof IslandPrefs>(key: K, opts: [IslandPrefs[K], string][]) => (
    <div className="isl-seg">
      {opts.map(([v, label]) => (
        <button key={String(v)} className={prefs[key] === v ? 'on' : ''} onClick={() => setPrefs({ [key]: v } as Partial<IslandPrefs>)}>
          {label}
        </button>
      ))}
    </div>
  )
  const check = (key: keyof IslandPrefs, label: string) => (
    <label className="isl-check">
      <input type="checkbox" checked={!!prefs[key]} onChange={(e) => setPrefs({ [key]: e.target.checked } as Partial<IslandPrefs>)} /> {label}
    </label>
  )
  return (
    <div className="isl-settings">
      <div className="isl-set-head">
        <b>Customize the island</b>
        <button className="btn ghost small" onClick={onBack}>
          Done
        </button>
      </div>
      <small>Where</small>
      {seg('pos', [
        ['top-left', 'Top left'],
        ['top', 'Top'],
        ['top-right', 'Top right'],
        ['bottom', 'Bottom']
      ])}
      <small>Look</small>
      {seg('look', [
        ['black', 'Black'],
        ['glass', 'Glass'],
        ['accent', 'Accent']
      ])}
      <small>Size</small>
      {seg('size', [
        ['compact', 'Compact'],
        ['large', 'Large']
      ])}
      <small>When nothing runs</small>
      {seg('idle', [
        ['hidden', 'Hide (mouse to top)'],
        ['dot', 'Small dot'],
        ['peek', "What's next"]
      ])}
      <small>Quick-start buttons (minutes)</small>
      <input
        className="isl-presets-in"
        defaultValue={prefs.presets.join(', ')}
        onBlur={(e) => {
          const list = e.target.value
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => n >= 5 && n <= 180)
            .slice(0, 4)
          if (list.length) setPrefs({ presets: list })
        }}
      />
      <div className="isl-checks">
        {check('seconds', 'Show seconds')}
        {check('tabTitle', 'Timer in the tab title')}
        {check('chime', 'Chime when time is up')}
        {check('dim', 'Dim the rest while focusing')}
        {check('showNext', 'Next calendar block')}
        {check('showWater', 'Water')}
        {check('showPromise', 'Promise the coach is waiting on')}
      </div>
      <button className="btn ghost small isl-off" onClick={() => setPrefs({ on: false })}>
        Turn the island off (Settings → Look brings it back)
      </button>
    </div>
  )
}
