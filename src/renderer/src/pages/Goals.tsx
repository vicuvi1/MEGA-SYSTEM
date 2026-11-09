// One Goals page: goals of every kind (a number by a date, habits, do-less
// limits, every-month repeats, projects with steps) as cards with a ring that
// fills, the pace line in words and today's one step with a button that does
// it; a focus goal shown bigger; filters by area; Ben's weekly check-in; the
// hour goals planned backward into focus blocks; and the cyber security path
// (no points itself). Celebrations at 25/50/75/100 % and for every week a
// habit makes. A guided sheet makes a clear goal in a minute.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { m } from 'framer-motion'
import { life } from '../bridge'
import { useLive } from '../live'
import { useAction } from '../ui'
import { useTodayEvents } from '../todayEvents'
import type { PageId } from '../modules'
import type { GoalsView } from '../web/lifeExtras'
import type { BoardGoal } from '@core/goalsBoard'
import type { GoalCard } from '@core/goals'
import { shortDay, STATUS_TEXT } from '@core/goals'
import type { GoalTemplate } from '@core/goalsText'
import { freshMilestones, moveInOrder, perWord, type Level } from '@core/goalKinds'
import { weeklyGoalLines } from '@core/goalsBen'
import { TRACKS, TRACK_IDS, type LearnTrack } from '@core/learnPath'
import { PageSkeleton } from '../blocks'
import { GoalCardView, GoalDetail, GoalsAmbient, Ring, TemplateGrid, WeekDots, areaIcon, goalEmoji, headline, toneOf, type Tone } from '../goalsUi'
import { GoalSheet, formFromCard } from '../goalSheet'
import { Celebration, ClimbArt } from '../goalsFx'
import { BenAvatar } from '../BenAvatar'
import '../lifeExtras.css'
import '../goals.css'
import { Select } from '../Select'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { QuarterTab } from '../ladder/QuarterTab'

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min} min`)
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const STATUS: Record<BoardGoal['status'], string> = { done: 'Done', ahead: 'Ahead', 'on track': 'On track', behind: 'Behind', late: 'Deadline passed', tracked: 'Ben tracks it' }
const SEEN = 'ls.goalSeen'

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
const readSeen = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SEEN) || '{}') ?? {}
  } catch {
    return {}
  }
}
const writeSeen = (s: Record<string, string>) => {
  try {
    localStorage.setItem(SEEN, JSON.stringify(s))
  } catch {
    /* private window: celebrations may repeat, nothing breaks */
  }
}

export function Goals({ onGo }: { onGo?: (p: PageId) => void }) {
  const act = useAction()
  const { events } = useTodayEvents()
  const [v, setV] = useState<GoalsView | null>(null)
  const [tab, setTab] = usePageTab('goals', ['quarter', 'goals', 'week', 'hours', 'path'], 'quarter')
  const [filter, setFilter] = useState<string>('all')
  const [detail, setDetail] = useState<number | null>(null)
  const [party, setParty] = useState<{ card: GoalCard; level: Level }[]>([])
  const [sheet, setSheet] = useState<Sheet>(() => {
    const words = takeDraft()
    return words ? { kind: 'new', words } : null
  })
  const load = useCallback(() => {
    life.extras?.goals(events).then(setV).catch(() => {})
  }, [events])
  useEffect(load, [load])
  useLive(load)
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
  // New milestones since this device last looked: one celebration at a time.
  useEffect(() => {
    if (!v) return
    const r = freshMilestones(v.measures.filter((c) => !c.paused), readSeen())
    writeSeen(r.seen)
    if (r.celebrate.length) setParty((q) => [...q, ...r.celebrate.filter((x) => !q.some((y) => y.card.goal.id === x.card.goal.id && y.level === x.level))])
  }, [v])

  const measures = useMemo(() => (v ? v.measures.filter((c) => c.status !== 'missed' || c.daysLeft === 0) : []), [v])
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
  const move = async (c: GoalCard, dir: -1 | 1) => {
    const ids = measures.map((x) => x.goal.id)
    const next = moveInOrder(ids, c.goal.id, dir)
    if (next !== ids && (await act(() => life.extras!.goalReorder(next)))) load()
  }

  const live = measures.filter((c) => !c.paused)
  const openMeasures = live.filter((c) => c.status !== 'done')
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
  const empty = !measures.length && !hourGoals.length && !aims.length
  const areas = [...new Set(measures.map((c) => c.goal.area))]
  const shown = measures.filter((c) => (filter === 'all' ? true : filter === 'reached' ? c.status === 'done' : filter === 'paused' ? c.paused : c.goal.area === filter))
  const heroId = (shown.find((c) => c.pinned) ?? (shown.length >= 3 ? shown.find((c) => !c.paused && c.status !== 'done') : null))?.goal.id ?? null
  const steps = openMeasures.filter((c) => c.todayStep).slice(0, 3)
  const detailCard = detail != null ? (measures.find((c) => c.goal.id === detail) ?? null) : null
  const behind = openMeasures.filter((c) => c.status === 'behind' || c.status === 'at risk')

  return (
    <div className="gx">
      <GoalsAmbient />
      <m.section className={`gx-hero${empty ? ' is-empty' : ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
        <Ring pct={avg} tone={tone} size={108} stroke={10} roll>
          <b className="num">{total ? `${good}/${total}` : '0'}</b>
          <small>{total ? 'on track' : 'goals'}</small>
        </Ring>
        <div className="gx-hero-text">
          <span className="gx-kicker">Your goals</span>
          <h2>{empty ? 'Set a goal you can measure' : !total ? `All ${reached} reached 🏆` : good === total ? `On track: all ${total} 😎` : `On track: ${good} of ${total}`}</h2>
          <p>
            {empty
              ? 'A number by a date, a habit, something to do less of, or steps to finish. Ben keeps the pace line, nudges you on your rhythm and tells you what today takes.'
              : due.length
                ? `${due.length} check-in${due.length === 1 ? '' : 's'} due: ${due.map((c) => c.goal.title).slice(0, 2).join(', ')}.`
                : behind.length
                  ? `Push this one today: ${behind[0].goal.title}. ${behind[0].pace}.`
                  : 'Everything is on the line. Keep the streaks alive.'}
          </p>
          {!empty && (
            <div className="gx-chips">
              {due.length > 0 && <span className="gx-chip due">✓ {due.length} to check in</span>}
              {best > 1 && <span className="gx-chip">🔥 best streak {best}</span>}
              {reached > 0 && <span className="gx-chip">🏆 {reached} reached</span>}
              {openHours.length > 0 && (
                <span className="gx-chip">
                  ⏱ {openHours.length} hour goal{openHours.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
        {steps.length > 0 && (
          <div className="gx-steps-today" aria-label="Today's steps">
            <span className="gx-kicker">Today's steps</span>
            <ul>
              {steps.map((c) => (
                <li key={c.goal.id}>
                  <button onClick={() => setDetail(c.goal.id)} className={`t-${toneOf(c.status)}`}>
                    <span aria-hidden>{goalEmoji(c)}</span>
                    <span className="t">{c.todayStep}</span>
                    <small>{c.goal.title}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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

      <PageTabs
        page="goals"
        label="Goals views"
        tabs={[
          { id: 'quarter', label: 'This quarter', title: 'Up to 3 critical goals for the 12 weeks: milestones, this week and the reviews (1)' },
          { id: 'goals', label: 'Goals', count: measures.length || undefined, title: 'Your goals: numbers, habits, limits and projects (2)' },
          { id: 'week', label: 'This week', count: due.length || undefined, title: "Ben's weekly check-in and your records (3)" },
          { id: 'hours', label: 'Hours', title: "Hours to put in and this week's big 3 (4)" },
          { id: 'path', label: 'Cyber path', title: 'CTFs, Rust and crypto: what you finished (5)' }
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabPanel page="goals" id="quarter" value={tab}>
        {tab === 'quarter' && <QuarterTab onSeason={() => onGo?.('season')} />}
      </TabPanel>
      <TabPanel page="goals" id="goals" value={tab}>
        {empty ? (
          <EmptyGoals v={v} onPick={(words) => setSheet({ kind: 'new', words })} onTemplate={(t) => setSheet({ kind: 'new', template: t })} onType={() => setSheet({ kind: 'new' })} />
        ) : (
          <div className="gx-board">
            {measures.length > 1 && (
              <div className="gx-filters" role="radiogroup" aria-label="Show">
                {['all', ...areas, ...(measures.some((c) => c.paused) ? ['paused'] : []), ...(measures.some((c) => c.status === 'done') ? ['reached'] : [])].map((a) => {
                  const n = a === 'all' ? measures.length : a === 'reached' ? measures.filter((c) => c.status === 'done').length : a === 'paused' ? measures.filter((c) => c.paused).length : measures.filter((c) => c.goal.area === a).length
                  return (
                    <button key={a} role="radio" aria-checked={filter === a} className={filter === a ? 'on' : ''} onClick={() => setFilter(a)}>
                      {a === 'all' ? 'All' : a === 'reached' ? '🏆 Reached' : a === 'paused' ? '⏸ Paused' : `${areaIcon(a)} ${a}`}
                      <small>{n}</small>
                    </button>
                  )
                })}
              </div>
            )}
            {shown.length > 0 ? (
              <div className="gx-grid">
                {shown.map((c, i) => (
                  <GoalCardView
                    key={c.goal.id}
                    card={c}
                    today={v.today}
                    index={i}
                    hero={c.goal.id === heroId}
                    first={i === 0}
                    last={i === shown.length - 1}
                    onChanged={load}
                    onOpen={(card) => setDetail(card.goal.id)}
                    onEdit={(card) => setSheet({ kind: 'edit', card })}
                    onMove={filter === 'all' ? (card, d) => void move(card, d) : undefined}
                    onAskBen={askBen}
                  />
                ))}
                <button className="gx-add-card" onClick={() => setSheet({ kind: 'new' })}>
                  <span aria-hidden>＋</span>
                  <b>Add a goal</b>
                  <small>a number, a habit, a limit or steps</small>
                </button>
              </div>
            ) : (
              <p className="hint gx-none">Nothing here yet.</p>
            )}
          </div>
        )}
      </TabPanel>
      <TabPanel page="goals" id="week" value={tab}>
        <WeekCheckin v={v} cards={openMeasures} onAskBen={askBen} onOpen={(c) => setDetail(c.goal.id)} />
      </TabPanel>
      <TabPanel page="goals" id="hours" value={tab}>
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
                    <Ring pct={g.source === 'aim' ? 0 : pct} tone={t} size={64} stroke={7} roll>
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

        {!hourGoals.length && !aims.length && !v.week.length && <p className="hint gx-none">No hour goals yet. A goal like “20 hours of Rust by December” shows here, planned backward into focus blocks.</p>}
      </TabPanel>
      <TabPanel page="goals" id="path" value={tab}>
        <LearningPath v={v} onChange={setV} />
      </TabPanel>

      {detailCard && !sheet && (
        <GoalDetail
          card={detailCard}
          today={v.today}
          onClose={() => setDetail(null)}
          onEdit={() => setSheet({ kind: 'edit', card: detailCard })}
          onChanged={load}
          onAskBen={askBen}
          onGo={(p) => onGo?.(p === 'rewards' ? 'shop' : (p as PageId))}
        />
      )}
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
      {party.length > 0 && !sheet && <Celebration key={`${party[0].card.goal.id}:${party[0].level}`} card={party[0].card} level={party[0].level} onClose={() => setParty((q) => q.slice(1))} onGo={() => onGo?.('shop')} />}
    </div>
  )
}

/** The empty page: a small climbing picture, three starters that fit your data, templates, or type it. */
function EmptyGoals({ v, onPick, onTemplate, onType }: { v: GoalsView; onPick: (words: string) => void; onTemplate: (t: GoalTemplate) => void; onType: () => void }) {
  return (
    <section className="gx-empty">
      <div className="gx-empty-top">
        <ClimbArt />
        <div>
          <h3>Start with one</h3>
          <p className="hint">Pick a starter that fits what you already track. It counts itself where it can, and you can change anything later.</p>
        </div>
      </div>
      <div className="gx-starters">
        {v.starters.map((s, i) => (
          <m.button key={s.id} className="gx-starter" onClick={() => onPick(s.words)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 + i * 0.06 }}>
            <span className="e" aria-hidden>
              {s.icon}
            </span>
            <b>{s.title}</b>
            <small>{s.why}</small>
            <em>Set it up →</em>
          </m.button>
        ))}
      </div>
      <details className="gx-more-tpl">
        <summary>More ideas</summary>
        <TemplateGrid onPick={onTemplate} compact />
      </details>
      <button className="gx-type" onClick={onType}>
        Or type it: <em>“raise profit to 5000 lei by 31 Dec”, “at most 5h of gaming a week”</em>
      </button>
    </section>
  )
}

/** Ben's weekly check-in: every goal's week in one place, what he'd say, and one tap to talk it through. */
function WeekCheckin({ v, cards, onAskBen, onOpen }: { v: GoalsView; cards: GoalCard[]; onAskBen: (t: string) => void; onOpen: (c: GoalCard) => void }) {
  const lines = weeklyGoalLines(cards, v.today)
  const good = cards.filter((c) => c.status === 'ahead' || c.status === 'on track').length
  const worst = cards.find((c) => c.status === 'at risk') ?? cards.find((c) => c.status === 'behind')
  const flames = cards.filter((c) => c.streak > 1).sort((a, b) => b.streak - a.streak)
  const bests = cards.filter((c) => c.best)
  const say = !cards.length ? 'No goals yet. Give me one number to chase and I will hold you to it.' : worst ? `${good} of ${cards.length} on the line. ${worst.goal.title} is the one: ${(worst.pace ?? '').toLowerCase()}. Do today's step before anything fun.` : `${good} of ${cards.length} on the line. Good week so far 😎 Don't let Sunday slip.`
  return (
    <div className="gx-weekly">
      <section className="gx-sec gx-ben">
        <header className="gx-ben-head">
          <BenAvatar size={44} ring />
          <div>
            <span className="gx-kicker">Ben's weekly check-in</span>
            <p className="gx-ben-say">{say}</p>
          </div>
        </header>
        <ul className="gx-week-rows">
          {cards.map((c) => {
            const h = headline(c)
            const t = toneOf(c.status)
            return (
              <li key={c.goal.id}>
                <button onClick={() => onOpen(c)} className={`t-${t}`}>
                  <span className="e" aria-hidden>
                    {goalEmoji(c)}
                  </span>
                  <span className="mid">
                    <b>{c.goal.title}</b>
                    <small>
                      {h.big} {h.small}
                      {c.period ? '' : ` · by ${shortDay(c.goal.deadline)}`}
                    </small>
                  </span>
                  {c.kind === 'habit' && c.period?.per === 'week' ? <WeekDots card={c} /> : <span className="gx-mini-bar"><i style={{ transform: `translateX(${c.pct - 100}%)` }} /></span>}
                  <span className={`gx-pill t-${t}`}>{c.due ? 'Check in' : c.period && c.status === 'ahead' && c.kind !== 'limit' ? 'Done ✓' : STATUS_TEXT[c.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="gx-ben-act">
          <button className="btn primary" disabled={!lines.length} onClick={() => onAskBen(`My goals this week:\n${lines.join('\n')}\nHow did I do, and what's my one push for next week?`)}>
            Send my week to Ben
          </button>
          <button className="btn ghost" disabled={!cards.length} onClick={() => onAskBen(`Plan next week around my goals: ${cards.map((c) => `${c.goal.title} (${c.pace})`).join('; ')}. Give me a block for each one that's behind.`)}>
            Plan next week with Ben
          </button>
        </div>
      </section>
      <section className="gx-sec gx-records">
        <header className="gx-sec-head">
          <h3>Records</h3>
          <small>streaks and best weeks</small>
        </header>
        {flames.length || bests.length ? (
          <ul>
            {flames.slice(0, 4).map((c) => (
              <li key={`f${c.goal.id}`}>
                <span className="big">🔥 {c.streak}</span>
                <span>
                  <b>{c.goal.title}</b>
                  <small>{c.period ? `${perWord(c.period.per)}s in a row` : 'check-ins in a row'}</small>
                </span>
              </li>
            ))}
            {bests.slice(0, 4).map((c) => (
              <li key={`b${c.goal.id}`}>
                <span className="big">🏆</span>
                <span>
                  <b>{c.goal.title}</b>
                  <small>{c.best}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Your streaks and best weeks show here after a week or two.</p>
        )}
      </section>
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
  const keep = (r: GoalsView) => ({ ...r, measures: v.measures, checkins: v.checkins, hourTotals: v.hourTotals, goals: v.goals, week: v.week, starters: v.starters })
  const add = async () => {
    const r = await act(() => life.extras!.addLearning({ track, title, tag, link: link || null }), `Logged: ${title.trim()}`)
    if (r) {
      onChange(keep(r))
      setTitle('')
      setTag('')
      setLink('')
    }
  }
  const remove = async (id: string) => {
    const r = await act(() => life.extras!.removeLearning(id))
    if (r) onChange(keep(r))
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
        <Select value={track} onChange={(e) => setTrack(e.target.value as LearnTrack)} aria-label="Track">
          {TRACK_IDS.map((t) => (
            <option key={t} value={t}>
              {TRACKS[t].label}
            </option>
          ))}
        </Select>
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
