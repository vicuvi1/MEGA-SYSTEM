// The island's Study page (CR3, CR4): during your shift, a 10–25 minute pack
// for the quiet bits (Start runs it as a focus timer, so it counts as focus
// time), and one quick flashcard: tap to see the answer, then grade it.
// The data comes in the snapshot (snap.study); taps go back to the app window.
import { useState } from 'react'
import type { IslandAction } from '@core/islandModel'
import { PACK_ICON, type IslandStudy } from '@core/career/studyPack'
import { registerIslandPage } from './widgets/islandPages'
import { tp } from './islandTap'
import './island-study.css'

const GRADES = [
  ['again', 'Again'],
  ['hard', 'Hard'],
  ['good', 'Good'],
  ['easy', 'Easy']
] as const

export function IslandStudyPage({ study, tap }: { study: IslandStudy | null | undefined; tap: (a: IslandAction, label?: string) => void }) {
  const [shown, setShown] = useState<string | null>(null)
  if (!study)
    return (
      <div className="ip-empty">
        <b>Study kit</b>
        <small>Flashcards and study packs live on the Career page.</small>
        <button className="ig-open" {...tp('study:open', () => tap({ kind: 'open', page: 'career' }))}>Open Career</button>
      </div>
    )
  const { pack, card } = study
  return (
    <div className="is-study">
      <section className={`is-pack${study.shift ? ' live' : ''}`} aria-label="Study pack">
        <header>
          <b>{study.shift ? 'Quiet moment at work?' : 'Study pack'}</b>
          <small>
            {pack.minutes} min{study.packsWeek ? ` · ${study.packsWeek} this week` : ''}
          </small>
        </header>
        <ul>
          {pack.items.map((i, n) => (
            <li key={n}>
              <span aria-hidden>{PACK_ICON[i.kind]}</span>
              <span className="t">{i.text}</span>
              <small>{i.minutes}m</small>
            </li>
          ))}
        </ul>
        <div className="is-row">
          <button className="is-go" {...tp('study:start', () => tap({ kind: 'study', op: 'start', minutes: pack.minutes }, `Study pack · ${pack.minutes} min`))}>
            ▶ Start {pack.minutes} min
          </button>
          <button className="is-ghost" {...tp('study:next', () => tap({ kind: 'study', op: 'next' }, 'Another pack'))}>Another</button>
        </div>
      </section>
      {card ? (
        <section className="is-card" aria-label="Quick flashcard">
          <small className="is-deck">
            🃏 {card.deck} · {card.left} due
          </small>
          <button className="is-face" aria-expanded={shown === card.id} {...tp(`study:show:${card.id}`, () => setShown(card.id))}>
            <b>{card.front}</b>
            {shown === card.id ? <span className="is-back">{card.back}</span> : <small>Tap to see the answer</small>}
          </button>
          {shown === card.id && (
            <div className="is-grades" role="group" aria-label="How well did you know it?">
              {GRADES.map(([g, label]) => (
                <button key={g} className={g} {...tp(`study:${card.id}:${g}`, () => (setShown(null), tap({ kind: 'study', op: 'grade', cardId: card.id, grade: g }, label)))}>
                  {label}
                  <small>{card.ivls[g]}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <p className="is-none">🎉 No flashcards due today.</p>
      )}
    </div>
  )
}

registerIslandPage({ id: 'study', title: 'Study', icon: '📚', order: 18, render: (ctx) => <IslandStudyPage study={ctx.snap.study} tap={ctx.tap} /> })
