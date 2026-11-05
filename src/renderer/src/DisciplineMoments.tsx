// The two discipline moments that teach Ben your patterns:
// - an urge you just beat: "What set it off?" (one tap);
// - an honest reset: the same question, your best streak stays, and Ben
//   writes a concrete 72-hour plan right here.
// Opens on 'life-urge-won' / 'life-discipline-reset-done' (Discipline page or MAN).
import { useEffect, useState } from 'react'
import { TRIGGERS } from '@core/urgePatterns'
import { life } from './bridge'

type Moment = { kind: 'urge' | 'reset'; best: number; day: number }

export function DisciplineMoments({ onOpenChat }: { onOpenChat: () => void }) {
  const [m, setM] = useState<Moment | null>(null)
  const [step, setStep] = useState<'ask' | 'plan' | 'done'>('ask')
  const [plan, setPlan] = useState<string>('')
  const [steps, setSteps] = useState<string[]>([])

  useEffect(() => {
    const open = (kind: Moment['kind']) => async (e?: Event) => {
      if ((e as CustomEvent | undefined)?.detail?.noted) return // already asked (MN9)
      const d = await life.discipline.state().catch(() => null)
      setM({ kind, best: d?.best ?? 0, day: d?.day ?? d?.current ?? 0 })
      setStep('ask')
      setPlan('')
      setSteps([])
    }
    const urge = open('urge')
    const reset = open('reset')
    window.addEventListener('life-urge-won', urge)
    window.addEventListener('life-discipline-reset-done', reset)
    return () => {
      window.removeEventListener('life-urge-won', urge)
      window.removeEventListener('life-discipline-reset-done', reset)
    }
  }, [])
  if (!m) return null

  const close = () => setM(null)
  const pick = async (trigger: string) => {
    await life.discipline.note?.(m.kind, trigger).catch(() => {})
    if (m.kind === 'urge') return close()
    setStep('plan')
    if (!life.coach) return setStep('done')
    try {
      const seen: string[] = []
      const r = await life.coach.chat(
        `I just did an honest reset of my clean streak (best so far: ${m.best} days). What set it off: ${trigger}. ` +
          `Give me a concrete 72-hour plan to get back on track: what I do tonight, tomorrow and the day after, built around my danger times and this trigger. Short, specific, no lecture.`,
        (st) => {
          if (!seen.includes(st)) {
            seen.push(st)
            setSteps([...seen])
          }
        }
      )
      setPlan(r.reply)
    } catch (e) {
      setPlan(`Ben couldn't answer right now (${(e as Error).message}). Ask him in the chat.`)
    }
    setStep('done')
  }

  return (
    <div className="dm-scrim" role="dialog" aria-label={m.kind === 'urge' ? 'Urge beaten' : 'Honest reset'} onClick={(e) => e.target === e.currentTarget && step !== 'plan' && close()}>
      <div className="dm-card">
        {m.kind === 'urge' ? (
          <>
            <span className="dm-emoji">💪</span>
            <h3>You beat that one.</h3>
            <p>What set it off? Ben learns your risky times from this and warns you before them.</p>
          </>
        ) : step === 'ask' ? (
          <>
            <span className="dm-emoji">🛡️</span>
            <h3>Honest reset. Day 0, not zero progress.</h3>
            <p>
              Your best stays <b>{m.best} days</b>. One question, then Ben gives you a 72-hour plan: what set it off?
            </p>
          </>
        ) : (
          <>
            <span className="dm-emoji">🧭</span>
            <h3>Your next 72 hours</h3>
          </>
        )}

        {step === 'ask' && (
          <div className="dm-chips">
            {TRIGGERS.map((t) => (
              <button key={t} onClick={() => void pick(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        {step === 'plan' && <p className="dm-wait">{steps[steps.length - 1] ?? 'Ben is making your plan'}…</p>}
        {step === 'done' && plan && <div className="dm-plan">{plan}</div>}

        <div className="dm-actions">
          {step === 'done' && (
            <button className="btn ghost" onClick={() => (close(), onOpenChat())}>
              Open the chat
            </button>
          )}
          {step !== 'plan' && (
            <button className="btn ghost" onClick={close}>
              {step === 'done' ? 'Got it' : 'Skip'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
