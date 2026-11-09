// Training → Today card: how recovered each muscle group is (a small dot:
// red under 24 h, yellow 24–48 h, green 48 h+ since the last hard set) and one
// line on what is best to train today, agreeing with the weekly split. When a
// swap is better (a missed session, or today's muscles still red) one tap
// starts the other session. Reads only; core/recovery.ts holds the rules.
import { useMemo } from 'react'
import { agoText, recommend, recoveryMap, STATUS_LABEL } from '@core/recovery'
import { TYPE_NAME, type DoneSession, type SessionType, type TodayPlan, type TrainWeek } from '@core/trainWeek'

export function RecoveryPanel({
  st,
  plan,
  week,
  done,
  today,
  started,
  onSwap
}: {
  st: any
  plan: TodayPlan
  week: TrainWeek
  done: DoneSession[]
  today: string
  started: boolean
  onSwap: (t: SessionType) => void
}) {
  const rec = useMemo(() => recoveryMap(st, Date.now(), today), [st, today])
  const r = useMemo(() => recommend(plan, rec, week, done, today), [plan, rec, week, done, today])
  return (
    <div className="tr-rec" data-tr="recovery">
      <p className="tr-rec-line" data-tr="recommend">
        {r.line}
      </p>
      <ul className="tr-rec-list" aria-label="Muscle recovery">
        {rec.map((g) => (
          <li key={g.id} className={`tr-rec-item ${g.status}`} data-group={g.id} data-status={g.status} title={`${g.name}: ${STATUS_LABEL[g.status]}, last hard set ${agoText(g.hours)}`}>
            <i className="tr-rec-dot" aria-hidden="true" />
            <span className="tr-rec-name">{g.name}</span>
            <small className="sr-only">
              {STATUS_LABEL[g.status]}, {agoText(g.hours)}
            </small>
          </li>
        ))}
      </ul>
      {r.swap && !started && (
        <button type="button" className="bdy-btn tr-rec-swap" onClick={() => onSwap(r.swap!)} data-tr="swap">
          Swap: {TYPE_NAME[r.swap]} today
        </button>
      )}
    </div>
  )
}
