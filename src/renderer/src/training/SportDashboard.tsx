// Sport Track → Dashboard (the approved design, docs/design/sport-track/Main.dc.html):
// one screen that answers "what do I do today and am I growing?". A greeting with
// an "Am I growing?" chip and 4 number tiles (streak, workouts this week, hard sets
// this week, weight over 4 weeks) beside the ONE level (the Growth level, the same
// as the header chip); Today's workout with a large real photo demo (two frames
// cross-fading), every move with a thumbnail and a Change › button (the swap
// sheet) and one big Start; the Coach; the main chain's path (5 steps) with what
// the next step needs; This week; and the Body / Food / 12-week program tiles
// (Food has "Paste from AI ›"). Every number is real data; anything not logged
// shows one friendly line with a button. Nothing here pays points.
import { useMemo } from 'react'
import { coachLine, DOSE_LABEL, programPhases, requirementsOf, stepWindow, weekBars } from '@core/sportTrain'
import { doneSessions, sessionItems, trainOf } from '@core/trainLog'
import { allowed, gearSummary } from '@core/trainGear'
import { moveName, type LadderId } from '@core/trainLadders'
import { TYPE_NAME } from '@core/trainWeek'
import { shiftDay } from '@core/sportSets'
import { sessionsPerWeek, trainStreak } from '@core/trainStreak'
import { useBodyComp } from '../body/progress/BodyCompPanel'
import { useGrowth } from '../body/progress/useGrowth'
import { DemoPic, MovePic } from './MovePic'
import { useTodayFood } from './useTrainHome'
import type { SportTrain } from './useSportTrain'
import { Ring, sign } from './sportBits'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const greeting = (h: number) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')
const sum = (h: Record<string, number>) => Object.values(h).reduce((a, b) => a + b, 0)
const chainName = (n: string) => n.replace(/ \(.*\)$/, '')

export function SportDashboard({
  t,
  onStart,
  onSection,
  onBodyFood,
  onGrowing,
  onSwap,
  onGear
}: {
  t: SportTrain
  onStart: () => void
  onSection: (s: 'workout' | 'exercises' | 'progress') => void
  onBodyFood: (tab: 'today' | 'food' | 'progress' | 'growth') => void
  /** Opens "Am I really growing?" (the verdict and the six signs). */
  onGrowing: () => void
  onSwap: (ladder: LadderId) => void
  onGear: () => void
}) {
  const { v, st, today } = t
  const data = useMemo(() => trainOf(st), [st])
  const done = useMemo(() => doneSessions(data.log), [data])
  const streak = useMemo(() => trainStreak(data.week, done, today), [data, done, today])
  const thisWeek = useMemo(() => sessionsPerWeek(data.week, done, today, 1)[0] ?? { done: 0, planned: 0 }, [data, done, today])
  const week = useMemo(() => weekBars(st, today), [st, today])
  const lastWeek = useMemo(() => weekBars(st, shiftDay(today, -7)), [st, today])
  const program = useMemo(() => programPhases(st, today), [st, today])
  const comp = useBodyComp()
  const food = useTodayFood()
  const growth = useGrowth()
  const lvl = growth?.level ?? null
  const four = comp?.fourWeeks ?? null
  const hard = sum(week.hard)
  const hardDelta = hard - sum(lastWeek.hard)
  const toGo = Math.max(0, thisWeek.planned - thisWeek.done)

  return (
    <div className="sp-dash" data-tg="home">
      <section className="sp-hero" data-sp="hero">
        <div className="sp-hero-main">
          <h2 className="sp-hello">{greeting(new Date().getHours())}</h2>
          <p className="sp-hello-sub">{v.stage === 'rest' ? 'Rest day: muscles grow while you rest.' : v.stage === 'done' ? 'Done for today. Eat well and sleep: that is when muscle grows.' : `${TYPE_NAME[v.type]} today. One rep more than last time is a win.`}</p>
          <button type="button" className="sp-grow-chip" onClick={onGrowing} data-sp="growing">
            <span className="sp-grow-dot" aria-hidden="true" />
            Am I growing? {lvl ? `${lvl.name} · ${fmt(lvl.xp)} XP` : 'See your Growth'} ›
          </button>
          <div className="sp-kpis">
            <Kpi label="Streak" value={streak.sessions ? `${streak.sessions}` : '0'} unit={streak.sessions === 1 ? 'session' : 'sessions'} note={streak.since ? `since ${new Date(`${streak.since}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'your next session starts one'} data="streak" />
            <Kpi label="Workouts this week" value={`${thisWeek.done} / ${thisWeek.planned}`} note={toGo ? `${toGo} to go` : thisWeek.planned ? 'all done' : 'a rest week'} data="workouts" />
            <Kpi label="Hard sets this week" value={`${hard}`} note={lastWeek.done || hardDelta ? `${hardDelta >= 0 ? '+' : '−'}${Math.abs(hardDelta)} vs last week` : 'first week on record'} data="sets" />
            <Kpi label="Weight this month" value={four ? `${sign(four.kg)} kg` : '—'} note={four ? `over ${four.weeks} weeks` : 'no weigh-ins yet'} data="weight" />
          </div>
        </div>
        <button type="button" className="sp-level" onClick={() => onBodyFood('growth')} data-sp="level" title="Your one level: it grows from real progress you log (workouts, steps up a chain, weigh-ins, food). Open Growth">
          <Ring value={lvl?.progress ?? 0} size={112} stroke={10}>
            <small>Level</small>
            <b className="num">{lvl ? lvl.index + 1 : '—'}</b>
          </Ring>
          <span className="sp-level-text">
            <b>{lvl?.name ?? 'Your level'}</b>
            <small>{lvl ? (lvl.next ? `${fmt(lvl.toNext)} XP to ${lvl.next.name}` : 'The top level') : 'Loading…'}</small>
            <span className="sp-level-note">XP comes only from what you really log.</span>
          </span>
        </button>
      </section>

      <div className="sp-dash-row a">
        <TodayCard t={t} onStart={onStart} onCustomize={() => onSection('workout')} onSwap={onSwap} onGear={onGear} />
        <CoachCard t={t} />
      </div>
      <div className="sp-dash-row b">
        <PathCard t={t} onAll={() => onSection('exercises')} onGear={onGear} />
        <WeekCard week={week} done={thisWeek.done} planned={thisWeek.planned} weekly={v.weekly} />
      </div>
      <div className="sp-dash-tiles">
        <BodyTile comp={comp} onOpen={() => onBodyFood('progress')} />
        <FoodTile food={food} onOpen={() => onBodyFood('food')} onPaste={() => {
          try {
            localStorage.setItem('life_food_open', 'paste')
          } catch {
            /* private window: the Food tab opens on its first page */
          }
          onBodyFood('food')
        }} />
        <ProgramTile program={program} onOpen={() => onSection('progress')} />
      </div>
    </div>
  )
}

function Kpi({ label, value, unit, note, data }: { label: string; value: string; unit?: string; note: string; data: string }) {
  return (
    <div className="sp-kpi" data-kpi={data}>
      <small>{label}</small>
      <b className="num">
        {value}
        {unit && <span> {unit}</span>}
      </b>
      <span className="sp-kpi-note">{note}</span>
    </div>
  )
}

// ---------------------------------------------------------------- Today's workout

function TodayCard({ t, onStart, onCustomize, onSwap, onGear }: { t: SportTrain; onStart: () => void; onCustomize: () => void; onSwap: (l: LadderId) => void; onGear: () => void }) {
  const { v } = t
  const data = useMemo(() => trainOf(t.st), [t.st])
  if (v.stage === 'rest')
    return (
      <section className="sp-card sp-today rest" data-tg="plan">
        <div className="sp-today-body">
          <DemoPic move={v.mobility[0]?.id ?? 'cat_cow'} className="sp-today-demo" label={v.mobility[0] ? `Mobility: ${v.mobility[0].name}` : undefined} />
          <div className="sp-today-main">
            <div className="sp-today-top">
              <div>
                <small className="sp-eyebrow">Today</small>
                <h3 className="sp-today-title" data-tg="plan-title">
                  {v.title}
                </h3>
              </div>
              <span className="sp-today-meta">{v.skipped ? 'You said you can’t train today' : 'Rest day · 8 minutes of mobility'}</span>
            </div>
            <p className="sp-line" data-tg="plan-line">
              {v.line}
            </p>
            <ul className="sp-moves" data-tg="mobility">
              {v.mobility.map((m) => (
                <li key={m.id}>
                  <span className="sp-mv-static">
                    <MovePic move={m.id} size="md" />
                    <span className="sp-move-name">{m.name}</span>
                    <b className="num">
                      {m.set} {m.unit === 'sec' ? 's' : m.unit}
                    </b>
                  </span>
                </li>
              ))}
            </ul>
            <div className="sp-actions">
              {v.anyway && (
                <button type="button" className="sp-btn primary big grow" onClick={() => t.trainAnyway(v.anyway)} data-tg="anyway">
                  Train anyway: {TYPE_NAME[v.anyway]}
                </button>
              )}
              {v.skipped && (
                <button type="button" className="sp-btn big" onClick={() => void t.restToday(false)} data-tg="skip-back">
                  I can train after all
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  const first = v.items.find((it) => it.done.length < it.sets) ?? v.items[0]
  return (
    <section className="sp-card sp-today" data-tg="plan">
      <div className="sp-today-body">
        {first && <DemoPic move={first.level.move} className="sp-today-demo" label={`First up: ${first.name}`} />}
        <div className="sp-today-main">
          <div className="sp-today-top">
            <div>
              <small className="sp-eyebrow">Today&rsquo;s workout</small>
              <h3 className="sp-today-title" data-tg="plan-title">
                {v.title}
              </h3>
            </div>
            <span className="sp-today-meta">
              ≈ {v.minutes} min · {DOSE_LABEL[v.dose]} · {gearSummary(data.gear)} ·{' '}
              <button type="button" className="sp-link inline" onClick={onGear} data-sp="edit-gear">
                edit gear
              </button>
            </span>
          </div>
          {v.byChoice && (
            <button type="button" className="sp-link" onClick={() => t.trainAnyway(null)}>
              Take the rest day back
            </button>
          )}
          <ul className="sp-moves" data-tg="moves">
            {v.items.map((it) => {
              const full = it.done.length >= it.sets
              return (
                <li key={it.ladder.id} className={full ? 'done' : ''} data-ladder={it.ladder.id}>
                  <button type="button" className="sp-mv" onClick={() => onSwap(it.ladder.id)} title="Tap to pick easier or harder" data-tg="change">
                    <MovePic move={it.level.move} size="md" />
                    <span className="sp-move-name">
                      {it.name}
                      <small>
                        {chainName(it.ladder.name)} · {it.levelText}
                        {it.needs !== 'floor' ? ` · ${it.needs}` : ''}
                        {it.picked ? ' · today only' : ''}
                        {it.done.length ? ` · ${it.done.length} of ${it.sets} sets done` : ''}
                      </small>
                    </span>
                    <b className="num" data-tg="target">
                      {it.target}
                    </b>
                    <span className="sp-change">Change ›</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="sp-actions">
            {v.stage !== 'done' ? (
              <button type="button" className="sp-btn primary big grow" onClick={onStart} data-tg="start">
                {v.stage === 'going' ? 'Continue workout' : 'Start workout'}
              </button>
            ) : (
              <span className="sp-done grow" data-tg="done">
                Done for today · {v.setsDone} sets
              </span>
            )}
            <button type="button" className="sp-btn big" onClick={onCustomize} data-tg="customize-btn">
              Customize
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Coach

function CoachCard({ t }: { t: SportTrain }) {
  const { v, readiness, thin, skip } = t
  const line = coachLine(v, readiness)
  const offer = v.items.find((it) => it.offer)
  const canShift = v.type !== 'rest' && v.stage !== 'done'
  return (
    <aside className="sp-card sp-coach" data-tg="coach">
      <small className="sp-eyebrow">Coach</small>
      <p className="sp-coach-line" data-tg="coach-line">
        {line}
      </p>
      <p className="sp-coach-sub" data-tg="readiness">
        {readiness != null ? (
          <>
            Readiness <b className="num">{readiness}</b> · today is {DOSE_LABEL[v.dose]}
          </>
        ) : thin ? (
          'Readiness: log sleep or tap soreness (Body & Food → Today) for a real score.'
        ) : (
          `Today is ${DOSE_LABEL[v.dose]}.`
        )}
      </p>
      {offer?.offer && (
        <div className="sp-actions tight">
          <button type="button" className="sp-btn primary" onClick={() => t.apply(offer.ladder.id)} data-tg="coach-apply">
            Apply: {offer.offer.name}
          </button>
          <button type="button" className="sp-btn" onClick={() => t.keep(offer.ladder.id)} data-tg="coach-keep">
            Keep
          </button>
        </div>
      )}
      <div className="sp-coach-btns">
        <button type="button" className="sp-btn big" onClick={() => t.shiftAll(1)} disabled={!canShift} data-tg="harder-all">
          Make it harder
        </button>
        <button type="button" className="sp-btn big" onClick={() => t.shiftAll(-1)} disabled={!canShift} data-tg="easier-all">
          Make it easier
        </button>
        <button type="button" className="sp-btn big" onClick={() => void t.restToday(!skip)} disabled={v.stage === 'going' || v.stage === 'done'} data-tg="cant-train">
          {skip ? 'I can train today after all' : "I can't train today"}
        </button>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------- the main chain's path

const STATE_TEXT = { done: 'Done', current: 'You are here', next: 'Next', locked: 'Locked' }

function PathCard({ t, onAll, onGear }: { t: SportTrain; onAll: () => void; onGear: () => void }) {
  const { st, today, v } = t
  const data = useMemo(() => trainOf(st), [st])
  // The main chain: today's first move's chain (Push on a rest day).
  const chain: LadderId = (v.items[0]?.ladder.id as LadderId) ?? 'push'
  const ladder = data.ladders.find((l) => l.id === chain) ?? data.ladders[0]
  const it = useMemo(() => (ladder ? sessionItems(st, data, ladder.type, today).find((x) => x.ladder.id === ladder.id) ?? null : null), [st, data, ladder, today])
  if (!ladder || !it) return null
  // Steps that need gear you don't own are not shown.
  const steps = ladder.levels.map((lv, i) => ({ lv, i })).filter((x) => allowed(x.lv.move, data.gear))
  const pos = steps.findIndex((x) => x.i === it.index)
  const [from, to] = stepWindow(steps.length, Math.max(0, pos), 5)
  const req = requirementsOf(it)
  const next = it.next
  const name = chainName(ladder.name)
  return (
    <section className="sp-card sp-path" data-tg="path">
      <div className="sp-path-top">
        <div>
          <h3>{name} path</h3>
          <p>
            {it.alt ? `Using ${it.name} for your gear` : `Step ${it.index + 1} of ${ladder.levels.length}`} · the other paths are in Exercises
          </p>
        </div>
        <button type="button" className="sp-link" onClick={onAll} data-sp="all-chains">
          All paths
        </button>
      </div>
      <ol className="sp-steps" data-tg="steps" style={{ ['--n' as string]: to - from }}>
        {steps.slice(from, to).map(({ lv, i }) => {
          const state = it.alt ? (i < it.index ? 'done' : 'locked') : i < it.index ? 'done' : i === it.index ? 'current' : next && lv.move === next.move ? 'next' : 'locked'
          return (
            <li key={lv.move} className={state} data-state={state}>
              <small>Step {i + 1}</small>
              <b>{moveName(lv.move)}</b>
              <small className="st">{STATE_TEXT[state]}</small>
            </li>
          )
        })}
      </ol>
      <div className="sp-next" data-tg="next-level">
        {it.alt ? (
          <p className="sp-next-title">
            <b>{it.name}</b> stands in for a step your gear can&rsquo;t do.{' '}
            <button type="button" className="sp-link inline" onClick={onGear}>
              Edit gear
            </button>
          </p>
        ) : next ? (
          <>
            <p className="sp-next-title">
              {it.offer ? 'Ready to unlock' : 'To unlock'} <b>{moveName(next.move)}</b>
            </p>
            <ul className="sp-req" data-tg="requirements">
              {req.map((r) => (
                <li key={r.id} className={r.done ? 'ok' : ''} data-req={r.id} data-done={r.done ? '1' : '0'}>
                  <span>
                    {r.label}: <b>{r.done ? 'done' : r.detail}</b>
                  </span>
                </li>
              ))}
            </ul>
            {it.offer && (
              <div className="sp-actions tight">
                <button type="button" className="sp-btn primary" onClick={() => t.apply(ladder.id, ladder.type)} data-tg="path-apply">
                  Apply: {it.offer.name}
                </button>
                <button type="button" className="sp-btn" onClick={() => t.keep(ladder.id, ladder.type)}>
                  Keep {it.name} for now
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="sp-next-title">
            <b>Top of this path with your gear.</b> <span>Slow the tempo (3 s down, 1 s pause) to keep growing.</span>
          </p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Weekly bars

function WeekCard({ week, done, planned, weekly }: { week: ReturnType<typeof weekBars>; done: number; planned: number; weekly: Record<'push' | 'pull' | 'legs' | 'core', number> }) {
  return (
    <section className="sp-card sp-week" data-tg="week">
      <div className="sp-week-top">
        <h3>This week</h3>
        <span className="sp-week-n" data-tg="week-pct">
          {planned ? `${done} of ${planned} workouts` : 'a rest week'}
        </span>
      </div>
      <div className="sp-bars" role="img" aria-label={`This week: ${week.done} of ${week.planned} planned sets`}>
        {week.days.map((d) => (
          <div key={d.day} className={`sp-bar${d.today ? ' today' : ''}${d.type === 'rest' ? ' rest' : ''}`} title={`${d.short}: ${d.type === 'rest' ? 'rest' : `${d.done} of ${d.planned} sets`}`}>
            <span className="sp-bar-track">
              <span className="sp-bar-fill" style={{ transform: `scaleY(${d.pct})` }} />
            </span>
            <small>{d.short}</small>
          </div>
        ))}
      </div>
      <ul className="sp-musc" data-tg="week-muscles">
        {(['push', 'pull', 'legs', 'core'] as const).map((m) => (
          <li key={m}>
            <span>{m[0].toUpperCase() + m.slice(1)}</span>
            <b className="num">
              {week.hard[m]} / {weekly[m]}
            </b>
          </li>
        ))}
      </ul>
      <p className="sp-small" data-tg="week-line">
        Hard sets per muscle. 10–20 a week grows muscle.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- Body, Food and Program tiles

function BodyTile({ comp, onOpen }: { comp: ReturnType<typeof useBodyComp>; onOpen: () => void }) {
  const l = comp?.latest
  const four = comp?.fourWeeks
  return (
    <button type="button" className="sp-card sp-tile" onClick={onOpen} data-tg="body">
      <small className="sp-eyebrow">Body</small>
      {!l ? (
        <>
          <b className="sp-tile-big" data-tg="body-empty">
            No weigh-ins yet
          </b>
          <span className="sp-tile-sub">Log your weight in Body &amp; Food</span>
        </>
      ) : (
        <>
          <b className="sp-tile-big num">{l.weight_kg.toFixed(1)} kg</b>
          <span className="sp-tile-sub accent num">{four ? `${sign(four.kg)} kg over ${four.weeks} weeks` : 'Last weigh-in'}</span>
        </>
      )}
    </button>
  )
}

function FoodTile({ food, onOpen, onPaste }: { food: ReturnType<typeof useTodayFood>; onOpen: () => void; onPaste: () => void }) {
  const p = food?.progress.protein
  const k = food?.progress.kcal
  const left = p ? Math.max(0, Math.round(p.goal - p.eaten)) : 0
  return (
    <section className="sp-card sp-tile sp-food" data-tg="food">
      <button type="button" className="sp-tile-open" onClick={onOpen} aria-label="Open Food in Body & Food">
        <small className="sp-eyebrow">Food today</small>
        {!food || !p || !k ? (
          <>
            <b className="sp-tile-big">Nothing logged yet</b>
            <span className="sp-tile-sub">The food counter is in Body &amp; Food</span>
          </>
        ) : (
          <>
            <b className="sp-tile-big num" data-tg="kcal">
              {fmt(p.eaten)} / {fmt(p.goal)} g protein
            </b>
            <span className="sp-tile-sub num">
              {fmt(k.eaten)} / {fmt(k.goal)} kcal{p.goal ? ` · ${left} g left` : ''}
            </span>
          </>
        )}
      </button>
      <button type="button" className="sp-paste" onClick={onPaste} data-sp="paste-ai">
        Paste from AI ›
      </button>
    </section>
  )
}

function ProgramTile({ program, onOpen }: { program: ReturnType<typeof programPhases>; onOpen: () => void }) {
  const i = program.phases.findIndex((p) => p.state === 'current')
  const cur = i >= 0 ? program.phases[i] : null
  const nxt = i >= 0 ? program.phases[i + 1] : program.phases[0]
  return (
    <button type="button" className="sp-card sp-tile" onClick={onOpen} data-tg="roadmap">
      <small className="sp-eyebrow">12-week program</small>
      <b className="sp-tile-big">{cur && program.week ? `${cur.name} · week ${program.week}` : 'Starts with your first workout'}</b>
      <span className="sp-tile-sub">{nxt ? `Next: ${nxt.name} (weeks ${nxt.weeks[0]}–${nxt.weeks[1]})` : 'A new round of the same rules'}</span>
    </button>
  )
}
