// The evening check-in card (on Today → Now and Body → Today from 20:30, or
// when asked for from the coach card; once saved it folds away on the next look):
// what the logs already say (food against the goal, the workout, the weigh-in,
// last night's sleep), then 3 quick taps: energy 1–5, soreness 1–5, sleep
// (prefilled from the sleep log). Saved through life.coach.today.checkinSave;
// the coach answers with 1–2 sentences (rules, the AI only phrases them).
// No points.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { useLive } from '../live'
import { sleepChoices } from '@core/coachTalk'
import { sportNow } from './useCoach'
import type { CheckinView } from './coachApi'

/** From 20:30 until the app day turns at 04:00. Before that it shows only when asked for. */
export const checkinTime = (d = new Date()) => {
  const m = d.getHours() * 60 + d.getMinutes()
  return m >= 20 * 60 + 30 || m < 4 * 60
}

const ENERGY = ['Empty', 'Low', 'OK', 'Good', 'Great']
const SORE = ['None', 'A bit', 'Some', 'Sore', 'Very']

function Taps({ label, value, set, words, name }: { label: string; value: number | null; set: (n: number) => void; words: string[]; name: string }) {
  return (
    <div className="ck-row" role="radiogroup" aria-label={label} data-ck={name}>
      <span className="ck-label">{label}</span>
      <div className="ck-taps">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={`ck-tap${value === n ? ' on' : ''}`} title={words[n - 1]} onClick={() => set(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

export function CoachCheckin({ open = false }: { open?: boolean }) {
  const act = useAction()
  const [v, setV] = useState<CheckinView | null>(null)
  // Saved just now: the answer stays in view. Saved earlier: nothing to show unless asked for.
  const [justSaved, setJustSaved] = useState(false)
  const [energy, setEnergy] = useState<number | null>(null)
  const [sore, setSore] = useState<number | null>(null)
  const [sleep, setSleep] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => {
    const api = life.coach?.today
    if (!api?.checkinView) return
    void api
      .checkinView(sportNow())
      .then((x) => {
        setV(x)
        setSleep((cur) => cur ?? (x.facts.sleepH != null ? Math.round(x.facts.sleepH * 2) / 2 : null))
      })
      .catch(() => {})
  }, [])
  useEffect(reload, [reload])
  useLive(reload)
  useEffect(() => {
    window.addEventListener('life-coach-changed', reload)
    return () => window.removeEventListener('life-coach-changed', reload)
  }, [reload])
  if (!v) return null
  if (v.done && !justSaved && !open) return null
  const save = async () => {
    if (energy == null || sore == null) return
    setBusy(true)
    const out = await act(() => life.coach!.today!.checkinSave({ energy, soreness: sore, sleep }, sportNow()))
    setBusy(false)
    if (out) {
      setJustSaved(true)
      setV(out)
    }
  }
  return (
    <section className="ct-card ck-card" aria-label="Evening check-in" data-coach="checkin">
      <header className="ct-head">
        <div className="ct-title">
          <span className="ct-kicker">Evening check-in</span>
          <p className="ct-line">{v.done ? 'Done for today.' : 'How was today? 3 taps.'}</p>
        </div>
      </header>
      <ul className="ck-facts">
        {v.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {v.done ? (
        <>
          <p className="ck-sum">
            Energy {v.done.energy}/5 · Soreness {v.done.soreness}/5{v.done.sleep != null ? ` · Sleep ${v.done.sleep} h` : ''}
          </p>
          {v.done.reply && (
            <p className="ck-reply" data-ck="reply">
              <span aria-hidden>💬</span> {v.done.reply}
            </p>
          )}
        </>
      ) : (
        <>
          <Taps label="Energy" name="energy" value={energy} set={setEnergy} words={ENERGY} />
          <Taps label="Soreness" name="soreness" value={sore} set={setSore} words={SORE} />
          <div className="ck-row" role="radiogroup" aria-label="Sleep last night" data-ck="sleep">
            <span className="ck-label">Sleep</span>
            <div className="ck-taps">
              {sleepChoices(v.facts.sleepH).map((h) => (
                <button key={h} type="button" role="radio" aria-checked={sleep === h} className={`ck-tap wide${sleep === h ? ' on' : ''}`} onClick={() => setSleep(h)}>
                  {h} h
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn primary ck-save" disabled={busy || energy == null || sore == null} onClick={() => void save()}>
            Save check-in
          </button>
        </>
      )}
    </section>
  )
}
