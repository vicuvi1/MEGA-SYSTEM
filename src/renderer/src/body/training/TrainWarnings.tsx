// Training: calm warnings from plain rules (core/trainWarnings.ts). A move
// weaker 2 sessions in a row, or "Hard" on every set for a week → an extra
// rest day or a lighter week (one tap: 70% for 7 days, the usual dose
// setting); too little food for 3 of the last 5 logged days → a link to Food.
// Each one can be dismissed for a week. Food is read only. No points.
import { useMemo } from 'react'
import { shiftDay } from '@core/sportSets'
import { doneSessions, trainOf } from '@core/trainLog'
import { dismissWarning, lighterOn, setLighter, trainWarnings, type WarnId } from '@core/trainWarnings'
import { life } from '../../bridge'
import { useToast } from '../../ui'
import { saveTraining } from './trainingStore'

/** This device: the day a lighter week last set the dose (once a day). */
export const LIGHT_DAY_KEY = 'life_train_light_day'

/** The food counter's last 7 days (kcal per day), read only; null without a food counter. */
export type FoodDays = { day: string; kcal: number }[] | null

export function TrainWarnings({ st, today, food, refresh }: { st: any; today: string; food: FoodDays; refresh: () => void }) {
  const toast = useToast()
  const list = useMemo(() => {
    const data = trainOf(st)
    const from = shiftDay(today, -6)
    const recent = doneSessions(data.log).filter((s) => s.date >= from && s.date <= today).length
    const perWeek = recent >= 2 ? recent : data.week.days.filter((d) => d !== 'rest').length
    return trainWarnings({
      log: st?.sets ?? {},
      exercises: Array.isArray(st?.exercises) ? st.exercises : [],
      today,
      perWeek,
      food,
      dismissed: st?.trainWarnDismiss ?? {},
      lighter: !!lighterOn(st, today)
    })
  }, [st, today, food])
  if (!list.length) return null

  const dismiss = (id: WarnId) => {
    saveTraining((s) => dismissWarning(s, id, today))
    refresh()
    toast('Hidden for a week.', 'info')
  }
  const lighter = () => {
    saveTraining((s) => setLighter(s, today, Date.now()))
    // Today's dose now (your tap is the pick); later days follow in TodaySession, once a day.
    void life.coach?.bodyPlus
      ?.setDose('light', null)
      .then(() => window.dispatchEvent(new CustomEvent('life-body-changed')))
      .catch(() => {})
    try {
      localStorage.setItem(LIGHT_DAY_KEY, today)
    } catch {
      /* private window */
    }
    refresh()
    toast('Lighter week: 70% of your usual reps for 7 days.', 'good')
  }
  const openFood = () =>
    window.dispatchEvent(
      new CustomEvent('life-open-tab', {
        detail: { page: 'body', tab: 'food' }
      })
    )

  return (
    <div className="tr-warns" aria-label="Training notes">
      {list.map((w) => (
        <section key={w.id} className="bdy-card tr-warn" data-warn={w.id} role="note">
          <div className="tr-warn-text">
            <b>{w.title}</b>
            <p className="bdy-note">{w.line}</p>
          </div>
          <div className="tr-warn-actions">
            {w.action === 'lighter' ? (
              <button type="button" className="bdy-btn primary" onClick={lighter} data-tr="warn-lighter">
                Lighter week (70%)
              </button>
            ) : (
              <button type="button" className="bdy-btn primary" onClick={openFood} data-tr="warn-food">
                Open Food
              </button>
            )}
            <button type="button" className="bdy-btn quiet" onClick={() => dismiss(w.id)} data-tr="warn-dismiss">
              Hide for a week
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
