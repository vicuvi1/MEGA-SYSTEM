// Study Time's left half: the big timer with its round progress ring (it
// fills to the planned time and turns gold past it), the buttons (Pause,
// a break, +5 min, Switch, Stop with "What did you do?"), your timer and
// sound choices, and today's sessions under it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { dayKey } from '@core/dates'
import {
  STUDY_SOUNDS,
  STUDY_SOUND_LABEL,
  categoryColor,
  categoryEmoji,
  clockText,
  goalMin,
  hmText,
  isForgotten,
  pomoBreakLen,
  pomoPct,
  prefsOf,
  runNow,
  type StudyBlock,
  type StudyNoise,
  type StudyPrefs,
  type StudySession,
  type StudyStore
} from '@core/studyTime'
import { life } from '../bridge'
import { useAction } from '../ui'
import { play, soundSuccess, soundTick } from '../soundKit'
import { hhmm, useTick, type Running } from './studyData'

const GOLD = '#f5b83d'
const BREAK = '#34d399'

/** The round progress ring (SVG; only the stroke offset changes). */
export function Ring({ pct, color, over, size, children, label }: { pct: number; color: string; over?: boolean; size: number | string; children?: React.ReactNode; label?: string }) {
  const r = 44
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct))
  return (
    <div className={`sy-ring ${over ? 'over' : ''}`} style={{ width: size, height: size, ['--c' as string]: over ? GOLD : color }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="bg" cx="50" cy="50" r={r} />
        <circle className="fg" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 50 50)" />
      </svg>
      <div className="sy-ring-mid">{children}</div>
    </div>
  )
}

export function TimerPane({ store, sessions, run, today, selected, onSelect }: { store: StudyStore; sessions: StudySession[]; run: Running | null; today: string; selected: StudyBlock | null; onSelect: (id: string) => void }) {
  return (
    <div className="sy-half sy-left">
      <TimerCard store={store} run={run} selected={selected} onSelect={onSelect} />
      <TodaySessions store={store} sessions={sessions} today={today} />
    </div>
  )
}

function TimerCard({ store, run, selected, onSelect }: { store: StudyStore; run: Running | null; selected: StudyBlock | null; onSelect: (id: string) => void }) {
  const act = useAction()
  const now = useTick(!!run, 500)
  const p = prefsOf(store)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [switching, setSwitching] = useState(false)
  const [sounds, setSounds] = useState(false)
  const [endAt, setEndAt] = useState('')
  useEffect(() => {
    if (!run) setAsking(false)
  }, [run])
  const block = run?.blockId ? store.blocks.find((b) => b.id === run.blockId) ?? null : null
  const shown = run ? block : selected
  const color = categoryColor(store, shown?.category ?? '')
  const emoji = categoryEmoji(store, shown?.category ?? '')
  const ringSize = 'min(340px, 30vw, 44vh)'

  if (!run) {
    const planned = p.mode === 'pomodoro' ? p.work : selected?.plannedMin ?? null
    return (
      <section className="sy-card sy-timer idle" aria-label="Timer">
        <div className="sy-timer-top">
          <ModeSwitch prefs={p} />
          <button className={`btn small ghost sy-sound-btn ${sounds ? 'on' : ''}`} onClick={() => setSounds((x) => !x)} title="Pomodoro lengths, sounds and background noise" aria-expanded={sounds}>
            🔔 Timer & sounds
          </button>
        </div>
        {sounds && <SoundsPanel prefs={p} onClose={() => setSounds(false)} />}
        <Ring pct={0} color={color} size={ringSize} label="Timer, not running">
          <span className="sy-ring-emoji">{emoji || '⏱'}</span>
          <b className="sy-clock num" data-testid="study-clock">
            {planned ? clockText(planned * 60_000) : '0:00'}
          </b>
          <small className="sy-ring-sub">{p.mode === 'pomodoro' ? `Pomodoro ${p.work} / ${p.short}` : planned ? 'Count up to the plan' : 'Open stopwatch'}</small>
        </Ring>
        <div className="sy-picked" style={{ ['--c' as string]: color }}>
          {selected ? (
            <>
              <i />
              <b>{selected.name}</b>
              {selected.category && <small>{selected.category}</small>}
            </>
          ) : (
            <span className="sy-hint">Pick a block on the right, or add one.</span>
          )}
        </div>
        <div className="sy-actions">
          <button
            className="btn primary sy-go"
            data-testid="study-start"
            disabled={!selected}
            title={selected ? `Start ${selected.name}` : 'Pick a block first'}
            onClick={() =>
              selected &&
              void act(() => life.study!.start(selected), `Started: ${selected.name}`).then((r) => {
                if (r) soundSuccess()
              })
            }
          >
            ▶ Start
          </button>
        </div>
        <p className="sy-hint">One timer at a time: here, on the island and on your other devices. Breaks and pauses never count as study.</p>
      </section>
    )
  }

  const n = runNow(run, now)
  const goal = goalMin(run)
  const forgotten = isForgotten(run, now, (d) => dayKey(d))
  const over = goal != null && !n.onBreak && n.workedMs >= goal * 60_000
  const plainPause = n.onBreak && run.pauseKind === 'pause'
  const breakLeft = n.breakEndsAt ? Math.max(0, n.breakEndsAt - now) : null
  let pct: number
  let big: string
  let sub: string
  let ringColor = color
  if (n.onBreak && !plainPause) {
    const len = (run.breakMin ?? 0) * 60_000
    pct = len ? 1 - (breakLeft ?? 0) / len : 1
    big = breakLeft != null ? clockText(breakLeft) : clockText(now - Date.parse(run.pausedAt!))
    sub = breakLeft != null ? (breakLeft > 0 ? `Break · back at ${hhmm(n.breakEndsAt!)}` : "Break's over") : 'On a break'
    ringColor = BREAK
  } else if (run.pomo) {
    const target = run.pomo.at * 60_000
    const left = target - n.workedMs
    pct = over ? 1 : pomoPct(run.pomo, n.workedMs)
    big = left >= 0 ? clockText(left) : `+${clockText(-left)}`
    sub = `${plainPause ? 'Paused · ' : ''}Pomodoro ${run.pomo.done + 1} · studied ${clockText(n.workedMs)}`
  } else if (goal != null) {
    pct = n.workedMs / (goal * 60_000)
    big = clockText(n.workedMs)
    sub = `${plainPause ? 'Paused · ' : ''}${over ? `${hmText(n.workedMs / 60_000 - goal)} over the plan of ${hmText(goal)}` : `Plan ${hmText(goal)} · ${hmText(Math.max(0, goal - n.workedMs / 60_000))} to go`}`
  } else {
    pct = (n.workedMs % 3_600_000) / 3_600_000
    big = clockText(n.workedMs)
    sub = `${plainPause ? 'Paused · ' : ''}Open stopwatch (up to 4 h)`
  }
  const stop = async (withNote: boolean) => {
    const r = await act(() => life.study!.finish(withNote ? note : null), (x) => `Logged ${x.session.minutes} min${x.coins ? ` · +${x.coins} points` : ''}`)
    if (r) {
      soundSuccess()
      setNote('')
      setAsking(false)
    }
  }
  return (
    <section className={`sy-card sy-timer ${n.onBreak ? (plainPause ? 'paused' : 'on-break') : ''} ${over ? 'over' : ''}`} aria-label="Timer" style={{ ['--c' as string]: color }}>
      <div className="sy-timer-top">
        <div className="sy-tname">
          <span className="sy-badge" style={{ ['--c' as string]: color }}>{emoji || '⏱'}</span>
          <b>{run.subject}</b>
          {block?.category && <small>{block.category}</small>}
        </div>
        <button className={`btn small ghost sy-sound-btn ${sounds ? 'on' : ''}`} onClick={() => setSounds((x) => !x)} title="Pomodoro lengths, sounds and background noise" aria-expanded={sounds}>
          🔔 Sounds
        </button>
      </div>
      {sounds && <SoundsPanel prefs={p} onClose={() => setSounds(false)} />}
      <Ring pct={pct} color={ringColor} over={over} size={ringSize} label={`${big} ${sub}`}>
        <b className={`sy-clock num ${over ? 'gold' : ''}`} data-testid="study-clock" aria-live="off">
          {big}
        </b>
        <small className="sy-ring-sub" data-testid={n.onBreak ? (plainPause ? 'study-paused' : 'study-break') : undefined}>
          {sub}
        </small>
        {run.pomo && <PomoDots done={run.pomo.done} every={run.pomo.every} />}
      </Ring>
      {forgotten ? (
        <div className="sy-forgot" role="alert">
          <b>Still running since {new Date(run.startedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}?</b>
          <small>Say when you really stopped. A timer put right is saved without points.</small>
          <div className="sy-row">
            <input type="datetime-local" aria-label="When you stopped" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            <button className="btn small primary" disabled={!endAt} onClick={() => void act(() => life.study!.stopAt(new Date(endAt).toISOString()), (r) => `Saved ${r.session.minutes} min`)}>
              Save
            </button>
            <button className="btn small ghost" onClick={() => void act(() => life.focus.cancel(), 'Timer dropped')}>
              Drop it
            </button>
          </div>
        </div>
      ) : asking ? (
        <form
          className="sy-stopnote"
          onSubmit={(e) => {
            e.preventDefault()
            void stop(true)
          }}
        >
          <label htmlFor="sy-note">What did you do?</label>
          <input id="sy-note" autoFocus maxLength={140} placeholder="e.g. Chapter 4, exercises 1–12" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="sy-row">
            <button className="btn primary" type="submit" data-testid="study-stop-save">
              Save & stop
            </button>
            <button className="btn ghost" type="button" onClick={() => void stop(false)}>
              Stop without a note
            </button>
            <button className="btn ghost" type="button" onClick={() => setAsking(false)}>
              Keep going
            </button>
          </div>
        </form>
      ) : (
        <div className="sy-actions" role="group" aria-label="Timer buttons">
          {n.onBreak ? (
            <button className="btn primary" data-testid="study-resume" title={plainPause ? 'Go on with the timer' : 'End the break and go on'} onClick={() => void act(() => life.study!.resume(), plainPause ? 'Resumed' : 'Back to it')}>
              ▶ {plainPause ? 'Resume' : 'Back to it'}
            </button>
          ) : (
            <>
              <button className="btn" data-testid="study-pause" title="Pause the timer (no break length; resume any time)" onClick={() => void act(() => life.study!.pause())}>
                ❚❚ Pause
              </button>
              {run.pomo ? (
                <button className={`btn ${over ? 'primary' : ''}`} data-testid="study-pomo-break" title="Count this pomodoro and take its break" onClick={() => void act(() => life.study!.pomoBreak(), `☕ ${pomoBreakLen(run.pomo!)} min break`).then(() => soundTick())}>
                  ☕ Take {pomoBreakLen(run.pomo)}
                </button>
              ) : (
                [5, 10].map((m) => (
                  <button key={m} className="btn" title={`A ${m} minute break (it never counts as study)`} onClick={() => void act(() => life.study!.breakStart(m), `☕ ${m} min break`).then(() => soundTick())}>
                    ☕ Break {m}
                  </button>
                ))
              )}
              {run.pomo && over && (
                <button className="btn" title="Count this pomodoro and start the next one now" onClick={() => void act(() => life.study!.keepGoing(), 'Next pomodoro')}>
                  Keep going
                </button>
              )}
              {(run.pomo || goal != null) && (
                <button className="btn" data-testid="study-plus5" title="Add 5 minutes to this pomodoro or the plan" onClick={() => void act(() => life.study!.extend(5), '+5 min')}>
                  +5 min
                </button>
              )}
            </>
          )}
          <div className="sy-switch-wrap">
            <button className="btn" data-testid="study-switch" aria-expanded={switching} title="Switch to another block without stopping: the time so far goes to this one" onClick={() => setSwitching((x) => !x)}>
              ⇄ Switch
            </button>
            {switching && <SwitchList store={store} current={run.blockId ?? null} onPick={(b) => (setSwitching(false), onSelect(b.id), void act(() => life.study!.switchBlock(b), (r) => (r.logged ? `${r.logged.session.minutes} min to ${run.subject} · now ${b.name}` : `Now ${b.name}`)))} onClose={() => setSwitching(false)} />}
          </div>
          <button className="btn sy-stop" data-testid="study-stop" title="Stop and log it (you can add what you did)" onClick={() => setAsking(true)}>
            ■ Stop
          </button>
        </div>
      )}
    </section>
  )
}

function PomoDots({ done, every }: { done: number; every: number }) {
  const inCycle = done % every
  return (
    <span className="sy-pomodots" aria-label={`${done} pomodoros done`} title={`${done} pomodoros done in this session`}>
      {Array.from({ length: every }, (_, i) => (
        <i key={i} className={i < inCycle ? 'done' : i === inCycle ? 'now' : ''} />
      ))}
      {done >= every && <small>{done}</small>}
    </span>
  )
}

function ModeSwitch({ prefs }: { prefs: StudyPrefs }) {
  const act = useAction()
  const set = (mode: StudyPrefs['mode']) => void act(() => life.study!.change({ op: 'prefs', prefs: { mode } }))
  return (
    <div className="sy-seg" role="group" aria-label="Timer mode">
      <button className={prefs.mode === 'pomodoro' ? 'on' : ''} data-testid="study-mode-pomo" title={`Work ${prefs.work} min, then a ${prefs.short} min break (a ${prefs.long} min one after ${prefs.every})`} onClick={() => set('pomodoro')}>
        🍅 Pomodoro
      </button>
      <button className={prefs.mode === 'up' ? 'on' : ''} data-testid="study-mode-up" title="Count up to the block's planned length (or an open stopwatch)" onClick={() => set('up')}>
        ⏱ Count up
      </button>
    </div>
  )
}

/** Pick the block to switch to (searchable). */
export function SwitchList({ store, current, onPick, onClose }: { store: StudyStore; current: string | null; onPick: (b: StudyBlock) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    window.addEventListener('mousedown', out)
    return () => window.removeEventListener('mousedown', out)
  }, [onClose])
  const list = useMemo(() => store.blocks.filter((b) => !b.done && b.id !== current && `${b.name} ${b.category} ${b.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30), [store, current, q])
  return (
    <div className="sy-pop sy-switchlist" ref={ref} role="dialog" aria-label="Switch to">
      <input autoFocus placeholder="Switch to…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => (e.key === 'Escape' ? onClose() : e.key === 'Enter' && list[0] ? onPick(list[0]) : null)} aria-label="Find a block" />
      <ul>
        {list.map((b) => (
          <li key={b.id}>
            <button onClick={() => onPick(b)} style={{ ['--c' as string]: categoryColor(store, b.category) }}>
              <span className="sy-badge sm">{categoryEmoji(store, b.category) || '•'}</span>
              <span>{b.name}</span>
              <small>{b.category}</small>
            </button>
          </li>
        ))}
        {!list.length && <li className="sy-hint">No other block matches.</li>}
      </ul>
    </div>
  )
}

const NOISES: [StudyNoise, string][] = [
  ['off', 'Off'],
  ['white', 'White noise'],
  ['brown', 'Soft noise'],
  ['rain', 'Rain']
]

function SoundsPanel({ prefs, onClose }: { prefs: StudyPrefs; onClose: () => void }) {
  const act = useAction()
  const set = (patch: Partial<StudyPrefs>) => void act(() => life.study!.change({ op: 'prefs', prefs: patch }))
  const num = (k: 'work' | 'short' | 'long' | 'every', label: string, min: number, max: number, unit = 'min') => (
    <label className="sy-num">
      <span>{label}</span>
      <input type="number" min={min} max={max} defaultValue={prefs[k]} key={`${k}${prefs[k]}`} onBlur={(e) => Number(e.target.value) !== prefs[k] && set({ [k]: Number(e.target.value) })} aria-label={label} />
      <small>{unit}</small>
    </label>
  )
  return (
    <div className="sy-pop sy-sounds" role="dialog" aria-label="Timer and sounds">
      <header className="sy-head">
        <h2>Timer & sounds</h2>
        <button className="sy-icon" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </header>
      <div className="sy-nums">
        {num('work', 'Pomodoro', 5, 120)}
        {num('short', 'Short break', 1, 30)}
        {num('long', 'Long break', 5, 60)}
        {num('every', 'Long break after', 2, 8, 'pomodoros')}
      </div>
      {(
        [
          ['endSound', 'When a pomodoro or the plan ends'],
          ['breakSound', 'When a break is over']
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="sy-sndrow">
          <span>{label}</span>
          <select value={prefs[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<StudyPrefs>)} aria-label={label}>
            {STUDY_SOUNDS.map((s) => (
              <option key={s} value={s}>
                {STUDY_SOUND_LABEL[s]}
              </option>
            ))}
          </select>
          <button className="btn small ghost" type="button" title="Play it" onClick={() => play(prefs[k], { preview: true, ownSwitch: true })}>
            ▶ Try
          </button>
        </label>
      ))}
      <div className="sy-sndrow">
        <span>While you study</span>
        <div className="sy-seg small" role="group" aria-label="Background noise">
          {NOISES.map(([k, l]) => (
            <button key={k} className={prefs.noise === k ? 'on' : ''} onClick={() => set({ noise: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="sy-check">
        <input type="checkbox" checked={prefs.tick} onChange={(e) => set({ tick: e.target.checked })} /> A soft tick while you study
      </label>
      <label className="sy-check">
        <input type="checkbox" checked={prefs.nudges} onChange={(e) => set({ nudges: e.target.checked })} /> Gentle notices: a planned block waiting, a goal reached or behind
      </label>
      <p className="sy-hint">The island plays these. All sounds are made by the app (no recordings). Quiet hours and meetings keep them silent.</p>
    </div>
  )
}

function TodaySessions({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const act = useAction()
  const list = sessions.filter((s) => s.day === today).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  const total = list.reduce((t, s) => t + s.minutes, 0)
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const blocks = new Map(store.blocks.map((b) => [b.id, b]))
  return (
    <section className="sy-card sy-todaylist" aria-label="Today's sessions">
      <header className="sy-head">
        <h2>Today</h2>
        <span className="sy-hint">
          {list.length} session{list.length === 1 ? '' : 's'} · {hmText(total)}
        </span>
      </header>
      <ul className="sy-sesslist">
        {list.map((s) => {
          const b = s.blockId ? blocks.get(s.blockId) : undefined
          return (
            <li key={s.id} style={{ ['--c' as string]: b ? categoryColor(store, b.category) : '#64748b' }}>
              <span className="sy-time num">
                {hhmm(s.startedAt)}–{hhmm(s.endedAt)}
              </span>
              <span className="sy-badge sm">{(b && categoryEmoji(store, b.category)) || '•'}</span>
              <div className="sy-smain">
                <b>{b?.name ?? s.subject}</b>
                {editing === s.id ? (
                  <form
                    className="sy-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void act(() => life.study!.setNote(s.id, text), 'Note saved').then(() => setEditing(null))
                    }}
                  >
                    <input autoFocus maxLength={140} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you do?" aria-label="What did you do?" />
                    <button className="btn small primary">Save</button>
                  </form>
                ) : (
                  <button className="sy-notebtn" title="Add or change what you did" onClick={() => (setEditing(s.id), setText(s.note ?? ''))}>
                    {s.note ? <span>{s.note}</span> : <em>+ What did you do?</em>}
                  </button>
                )}
              </div>
              <span className="sy-smin num">
                {hmText(s.minutes)}
                {s.pomos ? <small> · {s.pomos}🍅</small> : null}
                {s.breakMin || s.pauseMin ? <small className="sy-hint"> · {[s.breakMin && `break ${s.breakMin}m`, s.pauseMin && `pause ${s.pauseMin}m`].filter(Boolean).join(', ')}</small> : null}
              </span>
            </li>
          )
        })}
        {!list.length && <li className="sy-hint sy-empty">Nothing yet today. Start a block and it shows up here.</li>}
      </ul>
    </section>
  )
}
