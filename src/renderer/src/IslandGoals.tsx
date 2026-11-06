// The island's Goals page: your top goals with a ring each (where you are,
// and a tick where the pace line says you should be), "need +44/day", and a
// one-tap check-in (−, Same, +) on goals you report yourself. The data comes
// in the snapshot (snap.goals); taps go back to the app window.
import type { IslandAction } from '@core/islandModel'
import type { IslandGoal } from '@core/goalsIsland'
import { registerIslandPage } from './widgets/islandPages'
import { tp } from './islandTap'
import './island-goals.css'

const TONE: Record<IslandGoal['status'], string> = { done: 'good', ahead: 'good', 'on track': 'good', behind: 'warn', 'at risk': 'bad', missed: 'bad', 'not started': '' }

export function GoalRing({ pct, expected, size = 44, tone }: { pct: number; expected: number; size?: number; tone: string }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const a = (Math.min(100, Math.max(0, expected)) / 100) * 2 * Math.PI - Math.PI / 2
  return (
    <svg className={`ig-ring ${tone}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeDasharray={`${(Math.min(100, pct) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <circle cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={2.4} className="pace" />
      <text x="50%" y="53%" dominantBaseline="middle" textAnchor="middle">{pct}%</text>
    </svg>
  )
}

export function IslandGoalsPage({ goals, tap }: { goals: IslandGoal[]; tap: (a: IslandAction, label?: string) => void }) {
  if (!goals.length)
    return (
      <div className="ip-empty">
        <b>No goals yet</b>
        <small>Add a clear one in Goals, or type "goal: save 2000 lei by 31 Dec" in the command bar.</small>
        <button className="ig-open" {...tp('goals:open', () => tap({ kind: 'open', page: 'goals' }))}>Open Goals</button>
      </div>
    )
  return (
    <div className="ig-list">
      {goals.map((g) => (
        <article key={g.id} className={`ig-row ${TONE[g.status]}${g.due ? ' due' : ''}`}>
          <GoalRing pct={g.pct} expected={g.expectedPct} tone={TONE[g.status]} />
          <div className="ig-mid">
            <b title={g.title}>{g.title}</b>
            <small>
              {g.value} · <em>{g.statusText}</em>
            </small>
            <small className="ig-need">{g.status === 'done' ? 'Reached 🏆' : `${g.daysLeft}d left${g.need ? ` · need ${g.need}` : ''}${g.auto ? ' · counts itself' : ''}`}</small>
          </div>
          {g.quick.length > 0 && (
            <div className="ig-quick" role="group" aria-label={`Check in: ${g.title}`}>
              {[g.quick[0], g.quick[2]].map((q) => (
                <button key={q.op} {...tp(`goals:${g.id}:${q.op}`, () => tap({ kind: 'goal', goalId: g.id, op: q.op }, `${g.title} ${q.label}`))}>
                  {q.label}
                </button>
              ))}
              <button className="same" title="Same as before" {...tp(`goals:${g.id}:s`, () => tap({ kind: 'goal', goalId: g.id, op: 's' }, `${g.title}: same`))}>
                =
              </button>
            </div>
          )}
        </article>
      ))}
      <button className="ig-open" {...tp('goals:open', () => tap({ kind: 'open', page: 'goals' }))}>All goals →</button>
    </div>
  )
}

registerIslandPage({ id: 'goals', title: 'Goals', icon: '🎯', order: 15, render: (ctx) => <IslandGoalsPage goals={ctx.snap.goals ?? []} tap={ctx.tap} /> })
