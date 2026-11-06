// The urge crusher: one focused screen. Breathe with the circle, watch the
// ten-minute wave pass, swap the urge for something real, read your why, and
// log "urge beaten" at the end. The log is honest: it opens after the same
// minimum the app has always asked for (URGE_SECONDS), and push-ups are
// logged only after you say how many you did.
import { useEffect, useRef, useState } from 'react'
import { m } from 'framer-motion'
import { URGE_SECONDS } from '@core/discipline'
import { BREATHING, breathAt, URGE_WAVE_SECONDS, type BreathingKind } from '@core/disciplineView'
import { pickUrgeAction, type UrgeActionKind } from '@core/urgeAction'
import { TRIGGERS } from '@core/urgePatterns'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { reducedMotion } from '../motionKit'
import { mmss } from './planUi'
import { Ring } from './disciplineArt'

type Swap = UrgeActionKind | 'call' | 'coach'
const SWAPS: { id: Swap; emoji: string; title: string; how: string }[] = [
  { id: 'pushups', emoji: '💪', title: 'Push-ups', how: 'Hard and fast, then log what you did.' },
  { id: 'cold', emoji: '💧', title: 'Cold water', how: 'Splash your face. Phone in another room.' },
  { id: 'walk', emoji: '🚶', title: 'Walk outside', how: 'Shoes on, around the block, 10 minutes.' },
  { id: 'call', emoji: '📞', title: 'Call someone', how: 'A friend, family. Say hi, nothing more.' },
  { id: 'focus', emoji: '⏱️', title: 'Focus block', how: '25 minutes on one small task.' },
  { id: 'coach', emoji: '🧭', title: 'Talk to Ben', how: 'Open the coach. The timer keeps going.' }
]

const BREATH_KEY = 'ls.urge.breath'

interface Props {
  startedAt: string | null
  why: string | null
  onStart: () => void
  onCancel: () => void
  onFinish: () => void
  onClose: () => void
  onWhy: (text: string) => Promise<unknown>
}

export function UrgeCrusher({ startedAt, why, onStart, onCancel, onFinish, onClose, onWhy }: Props) {
  useEffect(() => {
    if (!startedAt) onStart()
    // Only when the crusher opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // A quick clock for the breathing circle (4 times a second).
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [])
  const opened = useRef(Date.now())
  const [kind, setKind] = useState<BreathingKind>(() => {
    try {
      return localStorage.getItem(BREATH_KEY) === '478' ? '478' : 'box'
    } catch {
      return 'box'
    }
  })
  const pickKind = (k: BreathingKind) => {
    setKind(k)
    opened.current = Date.now()
    try {
      localStorage.setItem(BREATH_KEY, k)
    } catch {
      /* no storage */
    }
  }
  const calm = reducedMotion()
  const breath = breathAt(kind, now - opened.current)
  const first = now - opened.current < 200 // start small, then grow with the first breath
  const target = first ? 0 : breath.label === 'Breathe in' ? 1 : breath.label === 'Breathe out' ? 0 : breath.fill
  const elapsed = startedAt ? Math.max(0, now - Date.parse(startedAt)) : 0
  const left = Math.max(0, URGE_WAVE_SECONDS * 1000 - elapsed)
  const unlockIn = Math.max(0, URGE_SECONDS * 1000 - elapsed)
  const canFinish = !!startedAt && unlockIn === 0

  const [before, setBefore] = useState<number | null>(null)
  const [after, setAfter] = useState<number | null>(null)
  const [trigger, setTrigger] = useState<string | null>(null)
  const [usual, setUsual] = useState<string | null>(null)
  useEffect(() => {
    life.discipline.patterns?.().then((p) => setUsual(p.triggers[0] ?? null)).catch(() => {})
  }, [])
  const suggested = pickUrgeAction(trigger ?? usual).kind
  const [swap, setSwap] = useState<Swap | null>(null)
  const [did, setDid] = useState<Partial<Record<Swap, string>>>({})
  const [reps, setReps] = useState(20)
  const [failed, setFailed] = useState<string | null>(null)
  const [whyDraft, setWhyDraft] = useState(why ?? '')
  const [editWhy, setEditWhy] = useState(!why)

  const doSwap = async (s: Swap) => {
    setFailed(null)
    try {
      if (s === 'pushups') {
        const n = Math.max(1, Math.min(500, Math.round(reps) || 0))
        await life.body.logWorkout({ title: 'Push-ups (urge crusher)', items: [{ exerciseId: 'pushups', name: 'Push-ups', unit: 'reps', amount: n }], note: 'Urge crusher' })
        window.dispatchEvent(new CustomEvent('life-body-changed'))
        setDid((d) => ({ ...d, pushups: `${n} push-ups saved in Sport Track` }))
      } else if (s === 'focus') {
        await life.focus.start('Urge → focus', 25, null)
        setDid((d) => ({ ...d, focus: '25-minute focus started' }))
      } else if (s === 'coach') {
        onClose()
        window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'coach' }))
      } else {
        setDid((d) => ({ ...d, [s]: 'Done. Good.' }))
      }
    } catch (e) {
      setFailed(`Couldn't save it: ${(e as Error).message}`)
    }
  }

  const finish = () => {
    // Only a trigger you picked is saved (not a guess from your usual one).
    void life.discipline
      .note?.('urge', trigger ?? 'Other', { ...(before != null ? { before } : {}), ...(after != null ? { after } : {}), action: swap ?? suggested })
      .catch(() => {})
    onFinish()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const active = SWAPS.find((s) => s.id === swap)

  return (
    <m.div className="urge dx-urge" role="dialog" aria-modal="true" aria-label="Urge crusher" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="dx-urge-shell">
        <header className="dx-urge-head">
          <span className="dx-kicker">
            <Icon name="bolt" size={14} /> Urge crusher
          </span>
          <div className="dx-seg" role="radiogroup" aria-label="Breathing pattern">
            {(Object.keys(BREATHING) as BreathingKind[]).map((k) => (
              <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => pickKind(k)}>
                {BREATHING[k].name}
              </button>
            ))}
          </div>
          <button className="btn ghost small dx-urge-x" onClick={onClose} aria-label="Close (the timer keeps going)" title="Close (the timer keeps going)">
            ✕
          </button>
        </header>

        <div className="dx-urge-body">
          <section className="dx-urge-left">
            <div className={`dx-breath ${calm ? 'calm' : ''}`} aria-live="polite">
              <div
                className="dx-breath-orb"
                style={calm ? undefined : { transform: `scale(${0.55 + 0.45 * target})`, transitionDuration: `${breath.label === 'Hold' ? 0.3 : breath.stepSeconds}s` }}
              />
              <div className="dx-breath-text">
                <b>{breath.label}</b>
                <span>{breath.secondsLeft}</span>
              </div>
            </div>
            <div className="dx-wave">
              <Ring size={92} stroke={7} pct={startedAt ? left / (URGE_WAVE_SECONDS * 1000) : 1} className="dx-wave-ring">
                <span className="dx-wave-t">{mmss(left)}</span>
              </Ring>
              <p>
                The urge is a wave: it rises, peaks and passes, usually within ten minutes.
                <br />
                <small>{canFinish ? 'You can log it as beaten now.' : `“Urge beaten” opens in ${mmss(unlockIn)}.`}</small>
              </p>
            </div>
          </section>

          <section className="dx-urge-right">
            <div className="dx-step">
              <h4>How strong is it?</h4>
              <Scale value={before} onPick={setBefore} label="How strong is it, 1 to 10" />
            </div>
            <div className="dx-step">
              <h4>What set it off?</h4>
              <div className="dx-chips" role="radiogroup" aria-label="What set it off?">
                {TRIGGERS.map((t) => (
                  <button key={t} role="radio" aria-checked={trigger === t} className={`${trigger === t ? 'on' : ''} ${t === usual ? 'usual' : ''}`} onClick={() => setTrigger(trigger === t ? null : t)} title={t === usual ? 'Your most common one' : undefined}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="dx-step">
              <h4>Swap it for something</h4>
              <div className="dx-swaps">
                {SWAPS.map((s) => (
                  <button key={s.id} className={`dx-swap ${swap === s.id ? 'on' : ''} ${did[s.id] ? 'did' : ''}`} onClick={() => setSwap(s.id)} aria-pressed={swap === s.id}>
                    <span className="dx-swap-e" aria-hidden="true">{did[s.id] ? '✓' : s.emoji}</span>
                    <b>{s.title}</b>
                    {s.id === suggested && <em>Suggested</em>}
                  </button>
                ))}
              </div>
              {active && (
                <div className="dx-swap-do">
                  <p>{active.how}</p>
                  {did[active.id] ? (
                    <span className="dx-ok">✓ {did[active.id]}</span>
                  ) : active.id === 'pushups' ? (
                    <div className="row">
                      <label className="hint">
                        I did{' '}
                        <input type="number" min={1} max={500} value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 70 }} aria-label="Push-ups you did" />
                      </label>
                      <button className="btn small" onClick={() => void doSwap('pushups')}>
                        Log them
                      </button>
                    </div>
                  ) : (
                    <button className="btn small" onClick={() => void doSwap(active.id)}>
                      {active.id === 'focus' ? 'Start 25 min' : active.id === 'coach' ? 'Open the coach' : 'I did it'}
                    </button>
                  )}
                  {failed && <p className="hint danger-text">{failed}</p>}
                </div>
              )}
            </div>
            <div className="dx-step dx-why-step">
              <h4>Your why</h4>
              {editWhy ? (
                <div className="dx-why-edit">
                  <textarea rows={2} maxLength={300} value={whyDraft} placeholder="Why does this streak matter to you? One sentence." onChange={(e) => setWhyDraft(e.target.value)} aria-label="Your why" />
                  <button
                    className="btn small"
                    disabled={!whyDraft.trim()}
                    onClick={async () => {
                      await onWhy(whyDraft)
                      setEditWhy(false)
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <blockquote className="dx-why" onClick={() => setEditWhy(true)} title="Click to change">
                  {why ?? whyDraft}
                </blockquote>
              )}
            </div>
          </section>
        </div>

        <footer className="dx-urge-foot">
          {canFinish && <Scale value={after} onPick={setAfter} label="And now, 1 to 10" short="And now?" />}
          <div className="dx-urge-btns">
            <button className="btn primary dx-beaten" disabled={!canFinish} onClick={finish}>
              <Icon name="check" size={16} /> {canFinish ? 'Urge beaten' : `Urge beaten · ${mmss(unlockIn)}`}
            </button>
            <button className="btn ghost" onClick={onCancel}>
              Stop the timer
            </button>
          </div>
        </footer>
      </div>
    </m.div>
  )
}

function Scale({ value, onPick, label, short }: { value: number | null; onPick: (n: number) => void; label: string; short?: string }) {
  return (
    <div className="urge-scale dx-scale" role="radiogroup" aria-label={label}>
      {short && <small>{short}</small>}
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onPick(n)}>
          {n}
        </button>
      ))}
    </div>
  )
}
