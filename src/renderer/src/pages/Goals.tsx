// One Goals page (FT3, now with measurable goals): goals you can measure
// ("profit 5,000 lei by 31 Dec") with a ring, a pace chart, what it takes
// and a check-in; the hour goals planned backward into focus blocks; goals
// Ben tracks with you; this week's big 3; and the cyber security path
// (FT8, no points itself). A guided sheet makes a clear goal in a minute.
import { useCallback, useEffect, useState } from 'react'
import { m } from 'framer-motion'
import { life } from '../bridge'
import { useLive } from '../live'
import { useAction } from '../ui'
import { useTodayEvents } from '../todayEvents'
import type { PageId } from '../modules'
import type { GoalsView } from '../web/lifeExtras'
import type { BoardGoal } from '@core/goalsBoard'
import type { GoalCard } from '@core/goals'
import type { GoalTemplate } from '@core/goalsText'
import { TRACKS, TRACK_IDS, type LearnTrack } from '@core/learnPath'
import { PageSkeleton } from '../blocks'
import { GoalCardView, GoalSheet, GoalsAmbient, Ring, TemplateGrid, formFromCard, type Tone } from '../goalsUi'
import '../lifeExtras.css'
import '../goals.css'

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min} min`)
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const STATUS: Record<BoardGoal['status'], string> = { done: 'Done', ahead: 'Ahead', 'on track': 'On track', behind: 'Behind', late: 'Deadline passed', tracked: 'Ben tracks it' }

type Sheet = { kind: 'new'; words?: string; template?: GoalTemplate | null } | { kind: 'edit'; card: GoalCard } | null

/** Words waiting from the island, Ctrl+K or Ben ("goal: …"), read once. */
const takeDraft = (): string | null => {
  try {
    const t = sessionStorage.getItem('ls.goalDraft')
    if (t) sessionStorage.removeItem('ls.goalDraft')
    return t
  } catch {
    return null
  }
}

export function Goals({ onGo }: { onGo?: (p: PageId) => void }) {
  const act = useAction()
  const { events } = useTodayEvents()
  const [v, setV] = useState<GoalsView | null>(null)
  const [sheet, setSheet] = useState<Sheet>(() => {
    const words = takeDraft()
    return words ? { kind: 'new', words } : null
  })
  const load = useCallback(() => {
    life.extras?.goals(events).then(setV).catch(() => {})
  }, [events])
  useEffect(load, [load])
  useLive(load)
  // Auto goals keep one number a day in their history (once when the page opens).
  useEffect(() => {
    void life.extras?.syncGoals?.().catch(() => null)
  }, [])
  useEffect(() => {
    const on = () => load()
    const draft = (e: Event) => {
      takeDraft()
      setSheet({ kind: 'new', words: String((e as CustomEvent).detail ?? '') })
    }
    window.addEventListener('life-goals-changed', on)
    window.addEventListener('life-goal-draft', draft)
    return () => {
      window.removeEventListener('life-goals-changed', on)
      window.removeEventListener('life-goal-draft', draft)
    }
  }, [load])
  if (!life.extras) return <p className="hint">Goals need the web app.</p>
  if (!v) return <PageSkeleton />

  const archive = async (g: BoardGoal) => {
    if (!g.id) return
    if (await act(() => life.focus.archiveGoal(g.id!), `${g.title}: off the list`)) load()
  }
  const focus = async (g: BoardGoal) => {
    const min = Math.max(25, Math.min(90, g.todayLeftMin || 50))
    if (await act(() => life.focus.start(g.subject ?? g.title, min), `Focus started: ${g.subject ?? g.title} · ${min} min`)) window.dispatchEvent(new CustomEvent('life-focus-changed'))
  }
  const askBen = (text: string) => {
    onGo?.('coach')
    void life.coach?.chat(text).catch(() => null)
  }

  const measures = v.measures.filter((c) => c.status !== 'missed' || c.daysLeft === 0)
  const openMeasures = measures.filter((c) => c.status !== 'done')
  const hourGoals = v.goals.filter((g) => g.source === 'goal')
  const aims = v.goals.filter((g) => g.source === 'aim')
  const openHours = hourGoals.filter((g) => g.status !== 'done')
  const total = openMeasures.length + openHours.length
  const good = openMeasures.filter((c) => c.status === 'ahead' || c.status === 'on track').length + openHours.filter((g) => g.onTrack).length
  const due = openMeasures.filter((c) => c.due)
  const reached = measures.filter((c) => c.status === 'done').length + hourGoals.filter((g) => g.status === 'done').length
  const avg = total ? Math.round((openMeasures.reduce((t, c) => t + c.pct, 0) + openHours.reduce((t, g) => t + hourPct(g, v), 0)) / total) : 0
  const tone: Tone = !total ? 'calm' : good === total ? 'good' : good >= total / 2 ? 'warn' : 'bad'
  const best = Math.max(0, ...openMeasures.map((c) => c.streak))
  const nextDeadline = [...openMeasures.map((c) => ({ t: c.goal.title, d: c.goal.deadline })), ...openHours.filter((g) => g.deadline).map((g) => ({ t: g.title, d: g.deadline! }))].sort((a, b) => a.d.localeCompare(b.d))[0]
  const empty = !measures.length && !hourGoals.length && !aims.length

  return (
    <div className="gx">
      <GoalsAmbient />
      <m.section className="gx-hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
        <Ring pct={avg} tone={tone} size={128} stroke={11}>
          <b className="num">{total ? `${good}/${total}` : '0'}</b>
          <small>{total ? 'on track' : 'goals'}</small>
        </Ring>
        <div className="gx-hero-text">
          <span className="gx-kicker">Your goals</span>
          <h2>{empty ? 'Set a goal you can measure' : !total ? `All ${reached} reached 🏆` : good === total ? `On track: all ${total} 😎` : `On track: ${good} of ${total}`}</h2>
          <p>
            {empty
              ? 'Pick a number and a date. Ben keeps the pace line, checks in on your rhythm and tells you what it takes.'
              : due.length
                ? `${due.length} check-in${due.length === 1 ? '' : 's'} due: ${due.map((c) => c.goal.title).slice(0, 2).join(', ')}.`
                : nextDeadline
                  ? `Next deadline: ${nextDeadline.t}, ${dayText(nextDeadline.d)}.`
                  : 'Everything is checked in.'}
          </p>
          {!empty && (
            <div className="gx-chips">
              {due.length > 0 && <span className="gx-chip due">✓ {due.length} to check in</span>}
              {best > 1 && <span className="gx-chip">🔥 {best} check-ins in a row</span>}
              {reached > 0 && <span className="gx-chip">🏆 {reached} reached</span>}
              <span className="gx-chip">⏱ {openHours.length} hour goal{openHours.length === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>
        <div className="gx-hero-act">
          <button className="btn primary" onClick={() => setSheet({ kind: 'new' })}>
            + New goal
          </button>
          {!empty && (
            <button className="btn ghost small" onClick={() => onGo?.('coach')} title="Ben knows your goals: ask him for a plan">
              Talk to Ben
            </button>
          )}
        </div>
      </m.section>

      {empty && (
        <section className="gx-empty">
          <h3>Start with one</h3>
          <TemplateGrid onPick={(t) => setSheet({ kind: 'new', template: t })} />
          <button className="gx-type" onClick={() => setSheet({ kind: 'new' })}>
            Or type it: <em>“raise profit to 5000 lei by 31 Dec”</em>
          </button>
        </section>
      )}

      {measures.length > 0 && (
        <div className="gx-grid">
          {measures.map((c, i) => (
            <GoalCardView key={c.goal.id} card={c} today={v.today} index={i} onChanged={load} onEdit={(card) => setSheet({ kind: 'edit', card })} onAskBen={askBen} />
          ))}
        </div>
      )}

      {(hourGoals.length > 0 || aims.length > 0) && (
        <section className="gx-sec">
          <header className="gx-sec-head">
            <h3>Hours to put in</h3>
            <small>planned backward into focus blocks · Ben books them</small>
          </header>
          <div className="gx-hours">
            {[...hourGoals, ...aims].map((g, i) => {
              const pct = hourPct(g, v)
              const t: Tone = g.status === 'done' || g.onTrack ? 'good' : g.status === 'behind' ? 'warn' : g.onTrack === null ? 'calm' : 'bad'
              return (
                <m.article key={g.key} className={`gx-hour t-${t}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: Math.min(i, 6) * 0.04 }}>
                  <Ring pct={g.source === 'aim' ? 0 : pct} tone={t} size={64} stroke={7}>
                    <b className="num small">{g.source === 'aim' ? '🎯' : `${pct}%`}</b>
                  </Ring>
                  <div className="gx-hour-mid">
                    <b title={g.title}>{g.title}</b>
                    <small>
                      {g.subject && g.subject.toLowerCase() !== g.title.toLowerCase() ? `${g.subject} · ` : ''}
                      {g.deadline ? `${dayText(g.deadline)}${g.daysLeft != null ? ` · ${g.daysLeft}d left` : ''}` : 'no deadline'}
                    </small>
                    {g.source === 'goal' ? (
                      <small className="gx-hour-nums">
                        {g.hoursLeft}h left · this week {g.weekLeftMin ? hm(g.weekLeftMin) : 'done'} · today {g.todayBlock ? `${g.todayBlock.start}–${g.todayBlock.end}` : g.todayLeftMin ? `${hm(g.todayLeftMin)} left` : 'done'}
                      </small>
                    ) : (
                      <small className="gx-hour-nums">{g.weekly ? `Weekly: ${g.weekly} · ` : ''}Ben tracks this one with you</small>
                    )}
                  </div>
                  <span className={`gx-pill t-${t}`}>
                    {STATUS[g.status]}
                    {g.status === 'behind' && g.aheadH ? ` ${Math.abs(g.aheadH)}h` : g.status === 'ahead' && g.aheadH ? ` ${g.aheadH}h` : ''}
                  </span>
                  {g.source === 'goal' && g.status !== 'done' && (
                    <div className="gx-hour-act">
                      {!!g.todayLeftMin && (
                        <button className="btn small primary" onClick={() => void focus(g)}>
                          ▶ {g.subject}
                        </button>
                      )}
                      {!g.todayBlock && !!g.todayLeftMin && (
                        <button className="btn small ghost" onClick={() => onGo?.('coach')} title="Ask Ben to book blocks for your goals">
                          Book blocks
                        </button>
                      )}
                      <button className="btn small ghost" onClick={() => void archive(g)} aria-label={`Remove ${g.title}`}>
                        ✕
                      </button>
                    </div>
                  )}
                  {g.source === 'goal' && g.status === 'done' && (
                    <div className="gx-hour-act">
                      <button className="btn small ghost" onClick={() => void archive(g)}>
                        Archive
                      </button>
                    </div>
                  )}
                </m.article>
              )
            })}
          </div>
        </section>
      )}

      {v.week.length > 0 && (
        <section className="gx-sec gx-week">
          <header className="gx-sec-head">
            <h3>This week's big 3</h3>
            <small>
              {v.week.filter((w) => w.done).length} of {v.week.length} done · from your week plan and Sunday call
            </small>
          </header>
          <ul>
            {v.week.map((w) => (
              <li key={w.text} className={w.done ? 'done' : ''}>
                <span className="gx-tick" aria-hidden>
                  {w.done ? '✓' : ''}
                </span>
                <span className="gx-week-text">{w.text}</span>
                <small>{w.from}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LearningPath v={v} onChange={setV} />

      {sheet && (
        <GoalSheet
          today={v.today}
          initial={sheet.kind === 'edit' ? formFromCard(sheet.card) : null}
          words={sheet.kind === 'new' ? sheet.words : undefined}
          template={sheet.kind === 'new' ? sheet.template : undefined}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/** An hour goal's share done (from its total hours). */
function hourPct(g: BoardGoal, v: GoalsView): number {
  const total = g.id != null ? v.hourTotals?.[g.id] : null
  if (g.status === 'done') return 100
  if (!total || g.hoursLeft == null) return 0
  return Math.max(0, Math.min(100, Math.round(((total - g.hoursLeft) / total) * 100)))
}

function LearningPath({ v, onChange }: { v: GoalsView; onChange: (v: GoalsView) => void }) {
  const act = useAction()
  const [track, setTrack] = useState<LearnTrack>('ctf')
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [link, setLink] = useState('')
  const add = async () => {
    const r = await act(() => life.extras!.addLearning({ track, title, tag, link: link || null }), `Logged: ${title.trim()}`)
    if (r) {
      onChange({ ...r, measures: v.measures, checkins: v.checkins, hourTotals: v.hourTotals, goals: v.goals, week: v.week })
      setTitle('')
      setTag('')
      setLink('')
    }
  }
  const remove = async (id: string) => {
    const r = await act(() => life.extras!.removeLearning(id))
    if (r) onChange({ ...r, measures: v.measures, checkins: v.checkins, hourTotals: v.hourTotals, goals: v.goals, week: v.week })
  }
  const start = async (subject: string) => {
    await act(() => life.focus.start(subject, 50), `Focus started: ${subject} · 50 min`)
  }
  return (
    <section className="gx-sec lp" aria-label="Cyber security path">
      <header className="gx-sec-head">
        <h3>Cyber security path</h3>
        <small className="hint">log what you finish; no points here, the focus timer pays for the time</small>
      </header>
      {v.learnNext && (
        <p className="lp-next">
          Next block: <b>{v.learnNext.subject}</b> <small className="hint">({v.learnNext.why})</small>
          <button className="btn small ghost" onClick={() => void start(v.learnNext!.subject)}>
            ▶ 50 min
          </button>
        </p>
      )}
      <div className="lp-grid">
        {v.learn.map((t) => (
          <div key={t.track} className="lp-track">
            <div className="sk-top">
              <b>{t.label}</b>
              <small>
                {t.count} {t.unit}
                {t.count === 1 ? '' : 's'}
              </small>
            </div>
            <div className="sk-steps" aria-hidden="true">
              {Array.from({ length: t.total }, (_, i) => (
                <i key={i} className={i < t.level ? 'on' : i === t.level ? 'now' : ''} />
              ))}
            </div>
            <p className="hint small">
              {t.current ? `Now: ${t.current}` : 'Not started'}
              {t.next ? ` · ${t.next.at - t.count} more to "${t.next.name}"` : ' · ladder complete 🏆'}
            </p>
            {t.recent.length > 0 && (
              <ul className="lp-recent">
                {t.recent.map((e) => (
                  <li key={e.id}>
                    {e.link ? (
                      <a href={e.link} target="_blank" rel="noreferrer noopener">
                        {e.title}
                      </a>
                    ) : (
                      <span>{e.title}</span>
                    )}
                    {e.tag && <small className="lp-tag">#{e.tag}</small>}
                    <button className="lp-x" onClick={() => void remove(e.id)} aria-label={`Remove ${e.title}`} title="Remove">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <form
        className="lp-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <select value={track} onChange={(e) => setTrack(e.target.value as LearnTrack)} aria-label="Track">
          {TRACK_IDS.map((t) => (
            <option key={t} value={t}>
              {TRACKS[t].label}
            </option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={TRACKS[track].placeholder} maxLength={120} aria-label="What you did" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag, e.g. web" maxLength={30} aria-label="Tag" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional)" maxLength={300} aria-label="Link" />
        <button className="btn small primary" disabled={!title.trim()}>
          Log it
        </button>
      </form>
    </section>
  )
}
