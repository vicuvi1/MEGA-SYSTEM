// "Coach today": the one card that says what to do today, from ONE source (the
// training split in core/coachPlan.ts): today's session with Start (or "Rest
// day", with what the page passes in `rest`, e.g. mobility and Train anyway),
// an optional readiness line, the meal checklist (a tap logs your usual meal),
// the weigh-in and bed ticks, and the day's line + tip; the morning routine is
// folded. On Today → Now it is one slim strip (training + Start, the next
// meal, weigh-in, bed; "Open" shows the whole card); on Body → Today it is
// full. The evening check-in shows only from 20:30 (or when you tap "Evening
// check-in") and folds away once saved. Ticks pay nothing.
import { useState, type ReactNode } from 'react'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import { openTab } from '../PageTabs'
import { requestSportStart } from '../sportStart'
import type { PlanCheck, PlanMeal } from '@core/coachPlan'
import { useCoach, sportNow } from './useCoach'
import { CoachSettings } from './CoachSettings'
import { WeeklyReviewFlow } from './WeeklyReview'
import { CoachCheckin, checkinTime } from './CoachCheckin'
import './coach.css'
import './coach-full.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x)

export function CoachToday({ compact = false, moves = true, onStart, readiness, rest }: { compact?: boolean; moves?: boolean; onStart?: () => void; readiness?: ReactNode; rest?: ReactNode }) {
  const { v, set } = useCoach()
  const act = useAction()
  const toast = useToast()
  const [more, setMore] = useState(false)
  const [settings, setSettings] = useState(false)
  const [review, setReview] = useState(false)
  const [askCheckin, setAskCheckin] = useState(false)
  if (!v) return null
  // The evening check-in comes under the coach card from 20:30 (core/coachTalk.ts), or when asked for.
  const evening = checkinTime() || askCheckin ? <CoachCheckin open={askCheckin} /> : null
  const { plan, ticks } = v
  const api = life.coach!.today!
  const t = plan.training
  const done = Object.values(ticks).filter(Boolean).length
  const start = () => {
    if (onStart) return onStart()
    requestSportStart()
    openTab('body', 'training')
  }
  const tapMeal = async (m: PlanMeal) => {
    const id = `meal:${m.id}`
    const tick = ticks[id]
    if (tick === 'auto') return toast(`${m.label} is logged in Food.`, 'info')
    if (tick === 'manual' || !m.id.startsWith('ds-')) {
      const out = await act(() => api.tick(id, sportNow()))
      if (out) set(out)
      return
    }
    // Your usual meal for this slot, logged for real (the tick follows the log).
    const out = await act(() => api.logMeal(m.id, sportNow()))
    if (!out) return
    set(out.view)
    toast(`${m.label} logged: ${fmt(m.kcal)} kcal, ${m.protein} g protein.`, 'good', {
      label: 'Undo',
      run: () => void act(() => api.undoMeal(out.ids, sportNow())).then((x) => x && set(x))
    })
  }
  const ateOther = async (m: PlanMeal) => {
    const out = await act(() => api.tick(`meal:${m.id}`, sportNow()), 'Ticked. Log what you ate in Food when you can.')
    if (out) set(out)
  }
  const tapCheck = async (c: PlanCheck) => {
    if (c.kind === 'weigh') {
      if (ticks.weigh) return toast('Weigh-in logged today.', 'info')
      return openTab('body', 'today')
    }
    if (c.kind === 'workout') return ticks.workout ? toast('Workout logged today.', 'info') : start()
    if (ticks[c.id] === 'auto') return
    const out = await act(() => api.tick(c.id, sportNow()))
    if (out) set(out)
  }
  const other = plan.checks.filter((c) => c.kind === 'weigh' || c.kind === 'bed')
  const weekday = new Date(`${v.today}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC'
  })
  const nextMeal = plan.food.meals.find((m) => !ticks[`meal:${m.id}`]) ?? null
  const mealsDone = plan.food.meals.length - plan.food.meals.filter((m) => !ticks[`meal:${m.id}`]).length
  const sheets = (
    <>
      {settings && <CoachSettings onClose={() => setSettings(false)} />}
      {review && <WeeklyReviewFlow onClose={() => setReview(false)} />}
    </>
  )
  const checkButtons = (short: boolean) =>
    other.map((c) => (
      <button key={c.id} type="button" className={`ct-check${ticks[c.id] ? ' on' : ''}`} aria-pressed={!!ticks[c.id]} data-check={c.id} title={c.label} onClick={() => void tapCheck(c)}>
        <i aria-hidden>{ticks[c.id] ? '✓' : ''}</i>
        {short && c.kind === 'bed' ? 'Bed' : c.label}
      </button>
    ))

  // Today → Now: one slim strip; "Open" shows the whole card in place.
  if (compact && !more)
    return (
      <>
        <section className="ct-card ct-strip" aria-label="Coach today" data-coach="today">
        <div className={`ct-strip-train ct-${t.kind}`} data-ct="train" title={v.line.line}>
          <b>{t.kind === 'session' ? `${t.title} · ${t.minutes} min` : t.kind === 'rest' ? 'Rest day · walk 20 min' : t.title}</b>
          {t.kind === 'session' && !ticks.workout && (
            <button type="button" className="btn small primary ct-start" onClick={start}>
              Start
            </button>
          )}
          {(t.kind === 'done' || ticks.workout) && <span className="ct-done">✓</span>}
        </div>
        <div className="ct-checks">
          {nextMeal ? (
            <button
              type="button"
              className="ct-check"
              data-meal={nextMeal.id}
              aria-label={nextMeal.id.startsWith('ds-') ? `Log ${nextMeal.label}` : `Tick ${nextMeal.label}`}
              title="Tap when you ate it (your usual meal is logged in Food)"
              onClick={() => void tapMeal(nextMeal)}
            >
              <i aria-hidden />
              {nextMeal.label}
              <small>
                {mealsDone}/{plan.food.meals.length}
              </small>
            </button>
          ) : (
            <span className="ct-check on">
              <i aria-hidden>✓</i>All meals
            </span>
          )}
          {checkButtons(true)}
        </div>
        <button type="button" className="ct-icon ct-open" aria-expanded={false} aria-label="Open the coach card" title="Moves, all meals, morning routine and tip" onClick={() => setMore(true)}>
          ⌄
        </button>
        {sheets}
        </section>
        {evening}
      </>
    )

  return (
    <>
    <section className="ct-card ct-full" aria-label="Coach today" data-coach="today">
      <header className="ct-head">
        <div className="ct-title">
          <span className="ct-kicker">Your plan · {weekday}</span>
          <p className="ct-line">{v.line.line}</p>
        </div>
        <span className="ct-count" title="Ticks today (no points: just your day)">
          {done}/{plan.checks.length}
        </span>
        <button type="button" className="ct-icon" aria-label="Coach settings" onClick={() => setSettings(true)}>
          ⚙
        </button>
        {compact && (
          <button type="button" className="ct-icon" aria-expanded aria-label="Fold the coach card" onClick={() => setMore(false)}>
            ⌃
          </button>
        )}
      </header>

      {/* Two columns on a wide card (training, ticks, tip | food), one on a phone. */}
      <div className="ct-cols">
        <div className="ct-a">
          <div className={`ct-train ct-${t.kind}`} data-ct="train">
            <div className="ct-train-text">
              <span className="ct-sec">{t.kind === 'rest' ? 'Training' : t.kind === 'done' ? 'Training · done' : 'Training'}</span>
              <b>{t.kind === 'session' ? `${t.title} · ${t.minutes} min` : t.title}</b>
              {/* "Rest day" is already the title: the line says only what to do. */}
              <small>{t.kind === 'rest' ? cap(t.line.replace(/^Rest day:\s*/i, '')) : t.line}</small>
            </div>
            {t.kind === 'session' && !ticks.workout && (
              <button type="button" className="btn primary ct-start" onClick={start}>
                Start
              </button>
            )}
            {(t.kind === 'done' || ticks.workout) && <span className="ct-done">✓ Done</span>}
          </div>
          {readiness}
          {t.kind === 'rest' && rest}
          {moves && t.kind === 'session' && t.moves.length > 0 && (
            <ul className="ct-moves">
              {t.moves.map((m) => (
                <li key={m.name}>
                  <b>{m.name}</b> <span>{m.sets} sets</span>
                  <small>{m.last}</small>
                </li>
              ))}
            </ul>
          )}
          <div className="ct-checks">{checkButtons(false)}</div>
        </div>

        <div className="ct-food">
          <div className="ct-food-head">
            <span className="ct-sec">Meals</span>
            <b className="num">
              {fmt(plan.food.kcal)} kcal · {plan.food.protein} g protein
            </b>
            {plan.food.ramp && <span className="ct-chip">Ramp-up week {plan.food.ramp} of 2</span>}
          </div>
          <ul className="ct-meals" aria-label="Meals">
            {plan.food.meals.map((m) => {
              const tick = ticks[`meal:${m.id}`]
              const usual = m.id.startsWith('ds-')
              return (
                <li key={m.id} className={tick ? 'on' : ''} data-meal={m.id}>
                  <button type="button" className="ct-tick" aria-pressed={!!tick} aria-label={tick ? `${m.label}: done` : usual ? `Log ${m.label}` : `Tick ${m.label}`} onClick={() => void tapMeal(m)}>
                    {tick ? '✓' : ''}
                  </button>
                  <span className="ct-meal-text">
                    <b>{m.label}</b>
                    {m.items && <small>{m.items}</small>}
                    {!tick && usual && (
                      <button type="button" className="ct-other" title="You ate something else: tick it without logging the usual meal" onClick={() => void ateOther(m)}>
                        Ate something else
                      </button>
                    )}
                  </span>
                  {!tick && (
                    <button type="button" className="ct-log" tabIndex={-1} aria-hidden="true" onClick={() => void tapMeal(m)}>
                      {usual ? 'Log' : 'Tick'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {(plan.food.extras.length > 0 || plan.food.change) && (
            <p className="ct-extras">
              {plan.food.change ? <b>{plan.food.change}. </b> : null}
              {plan.food.extras.length > 0 && <span>To reach your goal: {plan.food.extras.join(' · ')}</span>}
            </p>
          )}
        </div>

        <div className="ct-tipbox">
          <p className="ct-tip">
            <span aria-hidden>💡</span> {v.line.tip}
          </p>
          {plan.notes.map((n) => (
            <p key={n.id} className={`ct-note ct-note-${n.id}`} role="note">
              {n.text}
              {n.id === 'blood' && (
                <button type="button" className="ct-link" onClick={() => void act(() => api.dismissBlood())}>
                  Got it
                </button>
              )}
            </p>
          ))}
        </div>

        <div className="ct-foot">
          <details className="ct-routine-fold">
            <summary>Morning routine</summary>
            <ol className="ct-routine" aria-label="Morning routine">
              {plan.morning.map((s) => (
                <li key={s.id}>
                  <span>{s.label}</span>
                  {s.min ? <small>{s.min} min</small> : null}
                </li>
              ))}
            </ol>
          </details>
          <button type="button" className={`ct-link ct-week-open${v.weekDue ? ' due' : ''}`} onClick={() => setReview(true)}>
            Weekly review
          </button>
          {!evening && (
            <button type="button" className="ct-link ct-checkin-open" onClick={() => setAskCheckin(true)}>
              Evening check-in
            </button>
          )}
        </div>
      </div>

      {sheets}
    </section>
    {evening}
    </>
  )
}
