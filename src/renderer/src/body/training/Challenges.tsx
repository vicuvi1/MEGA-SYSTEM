// Challenges: join one, see a ring fill from your real logs (from the day you
// joined, logged at the time), get a badge when it is done. No points, ever.
import { useState } from 'react'
import { CHALLENGES, challengeProgress, cleanCustom, defOf, type ChallengeDef, type CustomSpec, type Joined } from '@core/challenges'
import { FAMILIES } from '@core/sportMoves'
import { Select } from '../../Select'
import { useToast } from '../../ui'
import { Ring } from './Ring'
import { logOf, saveTraining, type HomeTraining } from './trainingStore'

const FAMS = ['any', 'pushup', 'squat', 'row', 'core', 'plank', 'lunge', 'pike', 'dips', 'bridge', 'calf', 'burpee']

function Card({ def, j, st, today, onLeave }: { def: ChallengeDef; j: Joined; st: any; today: string; onLeave: () => void }) {
  const pr = challengeProgress(def, j, logOf(st), today)
  const tone = pr.status === 'done' ? 'done' : pr.status === 'ended' ? 'ended' : undefined
  return (
    <li className={`bt-chal joined ${pr.status}`} data-chal={def.id}>
      <Ring pct={pr.pct} size={58} label={`${def.name}: ${pr.line}`} tone={tone}>
        {pr.status === 'done' ? '✓' : `${Math.round(pr.pct * 100)}%`}
      </Ring>
      <div className="bt-chal-text">
        <b>{def.name}</b>
        <small>{pr.line}</small>
        <small className="muted">
          {pr.status === 'done' ? `Done ${pr.doneOn} · badge: ${def.badge}` : pr.status === 'ended' ? `Ended ${pr.endsOn}` : `${pr.daysLeft} ${pr.daysLeft === 1 ? 'day' : 'days'} left`}
          {pr.today && pr.status === 'active' ? ` · today ${pr.today.done} / ${pr.today.target}` : ''}
        </small>
      </div>
      <button type="button" className="btn small ghost" onClick={onLeave} data-bt="leave">
        {pr.status === 'active' ? 'Leave' : 'Clear'}
      </button>
    </li>
  )
}

export function Challenges({ st, ht, today, onChanged }: { st: any; ht: HomeTraining; today: string; onChanged: () => void }) {
  const toast = useToast()
  const [custom, setCustom] = useState<CustomSpec>({ name: '', kind: 'reps', family: 'pushup', goal: 1000, days: 14 })
  const joinedIds = new Set(ht.challenges.map((j) => j.id))

  const join = (j: Joined, name: string) => {
    saveTraining((_s, h) => void (h.challenges = [...h.challenges.filter((x) => x.id !== j.id), j]))
    onChanged()
    toast(`Joined: ${name}. Only sets you log from today count.`, 'good')
  }
  const leave = (j: Joined) => {
    saveTraining((_s, h) => void (h.challenges = h.challenges.filter((x) => !(x.id === j.id && x.joinedOn === j.joinedOn))))
    onChanged()
  }
  const addCustom = () => {
    const c = cleanCustom(custom)
    join({ id: `custom:${Date.now().toString(36)}`, joinedOn: today, custom: c }, c.name)
  }

  const open = CHALLENGES.filter((c) => !joinedIds.has(c.id))
  return (
    <section className="card bt-challenges" aria-label="Challenges">
      <header className="card-head">
        <h2>Challenges</h2>
        <span className="hint small">Badges only, no points. Counts real sets from the day you join.</span>
      </header>

      {ht.challenges.length > 0 && (
        <ul className="bt-chal-list">
          {ht.challenges.map((j) => {
            const def = defOf(j)
            return def ? <Card key={j.id + j.joinedOn} def={def} j={j} st={st} today={today} onLeave={() => leave(j)} /> : null
          })}
        </ul>
      )}

      {open.length > 0 && (
        <ul className="bt-chal-list open">
          {open.map((c) => (
            <li key={c.id} className="bt-chal" data-chal={c.id}>
              <Ring pct={0} size={42} stroke={5} label={`${c.name}: not joined`} />
              <div className="bt-chal-text">
                <b>{c.name}</b>
                <small className="muted">{c.blurb}</small>
              </div>
              <button type="button" className="btn small" data-bt="join" onClick={() => join({ id: c.id, joinedOn: today }, c.name)}>
                Join
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="bt-custom">
        <summary>Make your own</summary>
        <div className="bt-custom-form">
          <label>
            <span className="bt-label">Name</span>
            <input className="input" value={custom.name} placeholder="Optional" maxLength={40} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          </label>
          <label>
            <span className="bt-label">Goal</span>
            <Select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value === 'days' ? 'days' : 'reps' })} aria-label="Goal type">
              <option value="reps">Total reps</option>
              <option value="days">Training days</option>
            </Select>
          </label>
          <label>
            <span className="bt-label">Exercise</span>
            <Select value={custom.family} onChange={(e) => setCustom({ ...custom, family: e.target.value })} aria-label="Exercise">
              {FAMS.map((f) => (
                <option key={f} value={f}>
                  {f === 'any' ? 'Anything' : FAMILIES[f].name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="bt-label">{custom.kind === 'days' ? 'Days to train' : 'Reps'}</span>
            <input className="input" type="number" min={1} value={custom.goal} onChange={(e) => setCustom({ ...custom, goal: Number(e.target.value) })} />
          </label>
          <label>
            <span className="bt-label">In days</span>
            <input className="input" type="number" min={3} max={90} value={custom.days} onChange={(e) => setCustom({ ...custom, days: Number(e.target.value) })} />
          </label>
          <button type="button" className="btn primary" data-bt="custom-add" onClick={addCustom}>
            Start it
          </button>
        </div>
      </details>

      <div className="bt-badges" aria-label="Badges">
        <h3>Badges</h3>
        {ht.badges.length ? (
          <ul>
            {ht.badges.map((b) => (
              <li key={b.key} className="bt-badge" title={`Earned ${b.day}`}>
                <span className="bt-medal" aria-hidden="true">★</span>
                <span>
                  <b>{b.name}</b>
                  <small>{b.day}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Finish a challenge to earn its badge.</p>
        )}
      </div>
    </section>
  )
}
