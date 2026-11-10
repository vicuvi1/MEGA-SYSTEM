// Sport Track → Exercises (the approved design, docs/design/sport-track/Exercises.dc.html):
// left, a search and your paths with your step ("3 / 8") and a link to what you
// own (Gear); in the middle the chosen path as step cards, each with a real photo
// demo (two frames cross-fading; the drawn figure when a move has no photo; a
// locked step without a photo says "Demo opens when unlocked") and Mastered /
// You are here / Next / Locked; on the right the chosen move: a big demo, sets,
// reps, rest, your best, form tips and Make easier / Make harder (the swap
// sheet's engine, core/trainSwap.ts makeStep: your history stays). The older
// ladder editor and the home program builder stay reachable in one folded
// section below. Real data only; nothing here pays points.
import { useEffect, useMemo, useState } from 'react'
import { moveInfo, rangeText, type LadderId } from '@core/trainLadders'
import { gearSummary, needText, stepFrom } from '@core/trainGear'
import { ladderSets, trainOf } from '@core/trainLog'
import { restSecFor } from '@core/sportTrain'
import { moveBest, pathViews, repsText, type PathView, type StepCard } from '@core/trainProgress'
import { useToast } from '../ui'
import { Roadmap } from '../body/training/Roadmap'
import { ProgramBuilder } from '../body/training/ProgramBuilder'
import { useTraining } from '../body/training/trainingStore'
import { useTrainingSync } from './SportMore'
import { DemoPic, hasPhoto } from './MovePic'
import type { SportTrain } from './useSportTrain'

const LS = 'life_exercises_path'
const readPath = (): LadderId | null => {
  try {
    return (localStorage.getItem(LS) as LadderId | null) || null
  } catch {
    return null
  }
}

/** The step cards' demo: the real photo cross-fading, else the drawn figure, else (a locked step with no photo) a note. */
function StepDemo({ card }: { card: StepCard }) {
  if (card.state === 'locked' && !hasPhoto(card.move))
    return (
      <span className="sp-xdemo none" data-demo="locked">
        Demo opens when unlocked
      </span>
    )
  return <DemoPic move={card.move} className="sp-xdemo" fig={90} />
}

export function SportExercises({ t, onGear }: { t: SportTrain; onGear: () => void }) {
  const { st, today } = t
  const toast = useToast()
  const views = useMemo(() => pathViews(st, today), [st, today])
  const data = useMemo(() => trainOf(st), [st])
  const [path, setPath] = useState<LadderId>(() => readPath() ?? 'push')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Record<string, number>>({})

  const needle = q.trim().toLowerCase()
  const matches = (v: PathView) => (needle ? v.cards.filter((c) => c.name.toLowerCase().includes(needle)) : v.cards)
  const shown = needle ? views.filter((v) => matches(v).length || v.name.toLowerCase().includes(needle)) : views
  const cur = views.find((v) => v.id === path) ?? views[0]
  // Typing a move's name opens the first chain that has it.
  useEffect(() => {
    if (needle && cur && !shown.some((v) => v.id === cur.id) && shown[0]) setPath(shown[0].id)
  }, [needle, cur, shown])
  if (!cur) return null

  const choose = (id: LadderId) => {
    setPath(id)
    try {
      localStorage.setItem(LS, id)
    } catch {
      /* this session only */
    }
  }
  const selIdx = pick[cur.id] ?? cur.nowIndex
  const card = cur.cards[selIdx] ?? cur.cards[cur.nowIndex]
  const gear = data.gear
  const easierAt = stepFrom(cur.ladder, cur.nowIndex - 1, -1, gear)
  const harderAt = stepFrom(cur.ladder, cur.nowIndex + 1, 1, gear)
  const go = (to: number | null, why: string) => {
    if (to == null) return toast(why, 'info')
    const from = cur.cards[cur.nowIndex]?.name
    if (t.makeStep(cur.id, to)) {
      toast(`${from} → ${cur.cards[to].name}. Your history stays.`, 'good')
      setPick((p) => ({ ...p, [cur.id]: to }))
    }
  }
  const info = moveInfo(card.move)
  const level = cur.ladder.levels[card.index]
  const best = moveBest(data, card.move)
  const sets = ladderSets(data.week, data.ladders, cur.ladder)
  const needs = needText(card.move)
  const yours = card.index === cur.nowIndex
  const eyebrow = card.state === 'now' ? 'Your step now' : card.state === 'done' ? 'Mastered' : card.state === 'next' ? 'Next step' : 'Locked step'
  const visible = matches(cur)

  return (
    <div className="body-page sp-more sp-ex" data-sp="exercises">
      <header className="sp-sec-head">
        <h2>Exercises</h2>
        <p>Your paths, step by step. Tap a step to see how to do it, and to make it easier or harder.</p>
      </header>
      <div className="sp-ex-grid">
        <aside className="sp-ex-side" aria-label="Find a move">
          <label className="sp-sr" htmlFor="sp-ex-q">
            Search exercises
          </label>
          <input id="sp-ex-q" className="sp-search" type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} data-sp="ex-search" />
          <nav className="sp-ex-paths" aria-label="Paths">
            {shown.map((v) => (
              <button key={v.id} type="button" className={`sp-ex-path${v.id === cur.id ? ' on' : ''}`} aria-current={v.id === cur.id ? 'true' : undefined} onClick={() => choose(v.id)} data-path={v.id}>
                <span>{v.name}</span>
                <small className="num">{needle ? `${matches(v).length} found` : `${v.step} / ${v.of}`}</small>
              </button>
            ))}
            {!shown.length && <p className="sp-small">No move or path has &ldquo;{q.trim()}&rdquo; in its name.</p>}
          </nav>
          <section className="sp-ex-own" data-sp="gear-side">
            <h3>What you own</h3>
            <p>{gearSummary(data.gear)}</p>
            <p className="sp-small">Plans use only what is ticked.</p>
            <button type="button" className="sp-btn small" onClick={onGear} data-sp="edit-gear">
              Edit what you own ›
            </button>
          </section>
        </aside>

        <section className="sp-card sp-ex-path-card" data-sp="ex-path" data-path={cur.id}>
          <div className="sp-path-top">
            <div>
              <h3>{cur.name} path</h3>
              <p>
                {cur.muscles} · you are on step {cur.step} of {cur.of}
              </p>
            </div>
            <span className="sp-muted">≈ 2–4 weeks per step</span>
          </div>
          <ol className="sp-ex-steps" aria-label={`${cur.name} steps`}>
            {visible.map((c) => (
              <li key={c.index}>
                <button type="button" className={`sp-xstep ${c.state}${c.index === card.index ? ' sel' : ''}${c.gear ? ' gear' : ''}`} onClick={() => setPick((p) => ({ ...p, [cur.id]: c.index }))} aria-pressed={c.index === card.index} data-step={c.index} data-state={c.state}>
                  <StepDemo card={c} />
                  <small>
                    Step {c.n} · {c.range}
                  </small>
                  <b>{c.name}</b>
                  <span className="st">{c.gear ? `Needs ${needText(c.move)}` : c.text}</span>
                </button>
              </li>
            ))}
          </ol>
          {!visible.length && <p className="sp-small">No step on this path matches &ldquo;{q.trim()}&rdquo;.</p>}
        </section>

        <aside className="sp-card sp-ex-detail" aria-label={`About ${card.name}`} data-sp="ex-detail" data-move={card.move}>
          <DemoPic move={card.move} className="sp-ex-big" fig={200} />
          <div>
            <small className="sp-eyebrow acc">{eyebrow}</small>
            <h3 className="sp-ex-name" data-sp="ex-name">
              {card.name}
            </h3>
            <p className="sp-muted">
              {(info?.muscles ?? []).slice(0, 3).join(' · ') || cur.muscles}
              {needs ? ` · ${needs}` : ''}
            </p>
          </div>
          <div className="sp-ex-stats">
            <div>
              <b className="num">{sets}</b>
              <small>sets</small>
            </div>
            <div>
              <b className="num">{rangeText(level).replace(' s', '')}</b>
              <small>{level.unit === 'sec' ? 'seconds' : 'reps'}</small>
            </div>
            <div>
              <b className="num">{restSecFor(level)} s</b>
              <small>rest</small>
            </div>
          </div>
          <div>
            <h4>Your best</h4>
            <p className="sp-small ink" data-sp="ex-best">
              {best ? `${repsText(best.reps, best.unit)} (${best.when}) · ${best.sessions} ${best.sessions === 1 ? 'session' : 'sessions'}` : card.state === 'locked' || card.state === 'next' ? 'Not done yet. It opens when you reach this step.' : 'Not done yet. Log a set in a workout.'}
            </p>
          </div>
          <div>
            <h4>Form</h4>
            <ul className="sp-ex-tips">
              {(info?.steps ?? []).slice(0, 3).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {info?.mistake && <li className="warn">Common mistake: {info.mistake}</li>}
            </ul>
          </div>
          {!yours && !card.gear && (
            <button type="button" className="sp-btn small" onClick={() => go(card.index, '')} data-sp="ex-make-step">
              Make {card.name} my step
            </button>
          )}
          <div className="sp-ex-actions">
            <button type="button" className="sp-btn big grow" disabled={easierAt == null} onClick={() => go(easierAt, `${cur.cards[cur.nowIndex]?.name} is the easiest step.`)} data-sp="ex-easier" title={easierAt == null ? 'This is the easiest step your gear allows.' : `Your step becomes ${easierAt != null ? cur.cards[easierAt].name : ''}`}>
              Make easier
            </button>
            <button type="button" className="sp-btn primary big grow" disabled={harderAt == null} onClick={() => go(harderAt, `${cur.cards[cur.nowIndex]?.name} is the top of this path.`)} data-sp="ex-harder" title={harderAt == null ? 'This is the top step your gear allows.' : `Your step becomes ${harderAt != null ? cur.cards[harderAt].name : ''}`}>
              Make harder
            </button>
          </div>
        </aside>
      </div>
      <Advanced />
    </div>
  )
}

/** The old chain editor (Edit ladders, Move up / Not yet) and the home program builder: still here, folded. */
function Advanced() {
  const { st, ht, today, refresh } = useTraining()
  useTrainingSync(st, today, refresh)
  return (
    <details className="sp-fold" data-sp="ex-advanced">
      <summary>
        <b>Edit paths and the home program</b>
        <small>Change a path&rsquo;s steps and reps, move up or stay, build a program from your time and gear</small>
      </summary>
      <div className="bt">
        <Roadmap st={st ?? {}} today={today} refresh={refresh} />
        <ProgramBuilder st={st} ht={ht} today={today} onChanged={refresh} />
      </div>
    </details>
  )
}
