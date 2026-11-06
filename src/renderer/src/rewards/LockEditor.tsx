// Reward locks (FT21): a reward opens only when a goal is done or a streak is
// reached. Points still count; only the buy waits.
import { useEffect, useState } from 'react'
import { STREAK_LABEL, type StreakId, type Unlock } from '@core/unlocks'
import type { UnlocksView } from '../web/lifeExtras'
import { life } from '../bridge'
import { useAction } from '../ui'
import { Select } from '../Select'

export function useUnlocks(): [UnlocksView | null, () => void] {
  const [v, setV] = useState<UnlocksView | null>(null)
  const load = () => void life.extras?.unlocks().then(setV).catch(() => {})
  useEffect(load, [])
  return [v, load]
}

export function LockEditor({ rewardId, view, onDone }: { rewardId: number; view: UnlocksView | null; onDone: () => void }) {
  const act = useAction()
  const cur = view?.locks[String(rewardId)]
  const openGoals = (view?.goals ?? []).filter((g) => !g.done)
  const [kind, setKind] = useState<'goal' | 'streak'>(cur?.kind ?? (openGoals.length ? 'goal' : 'streak'))
  const [goalId, setGoalId] = useState<number>(cur?.kind === 'goal' ? cur.goalId : openGoals[0]?.id ?? 0)
  const [streak, setStreak] = useState<StreakId>(cur?.kind === 'streak' ? cur.streak : 'workout')
  const [days, setDays] = useState<number>(cur?.kind === 'streak' ? cur.days : 14)
  const save = async (u: Unlock | null) => {
    if (await act(() => life.extras!.setUnlock(rewardId, u), u ? 'Lock saved: points still count, the buy waits for it' : 'Lock removed')) onDone()
  }
  return (
    <div className="rw-lock-edit rx-lock-edit">
      <div className="row">
        <Select value={kind} onChange={(e) => setKind(e.target.value as 'goal' | 'streak')} aria-label="Unlock with">
          <option value="goal">When a goal is done</option>
          <option value="streak">At a streak</option>
        </Select>
        {kind === 'goal' ? (
          <Select value={goalId} onChange={(e) => setGoalId(Number(e.target.value))} aria-label="Goal">
            {!openGoals.length && <option value={0}>No open goals: add one on the Goals page</option>}
            {openGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} aria-label="Days" />
            <Select value={streak} onChange={(e) => setStreak(e.target.value as StreakId)} aria-label="Streak">
              {(Object.keys(STREAK_LABEL) as StreakId[]).map((k) => (
                <option key={k} value={k}>
                  day {STREAK_LABEL[k]} streak
                </option>
              ))}
            </Select>
          </>
        )}
      </div>
      <div className="row">
        <button
          type="button"
          className="rx-btn primary small"
          disabled={kind === 'goal' && !goalId}
          onClick={() => void save(kind === 'goal' ? { kind: 'goal', goalId, title: openGoals.find((g) => g.id === goalId)?.title ?? 'goal' } : { kind: 'streak', streak, days })}
        >
          Save lock
        </button>
        {cur && (
          <button type="button" className="rx-btn small" onClick={() => void save(null)}>
            Remove lock
          </button>
        )}
        <button type="button" className="rx-btn small ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
