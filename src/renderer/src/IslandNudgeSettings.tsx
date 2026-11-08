// Settings → Desktop island → Nudges (Island 2): how long you sit before a
// move break, which nudges are on, the people to call, the movement ring,
// Ben's daily challenge and what the island learned about your breaks.
import { useEffect, useState } from 'react'
import { betterHour, learnedLevel, NUDGE_KINDS, NUDGE_LABEL, type NudgeKind, type NudgePerson, type NudgePrefs, type NudgeStore } from '@core/islandNudges'
import { nudgePrefs, onNudges, resetNudgeLearning, setNudgePrefs } from './islandNudgesFeed'
import { Row, Segmented, Switch } from './settingsUi'
import { EYE_BREAKS_DEFAULT } from '@core/islandReminderSound'

const EYES = 'ls.eyeBreaks'
// On unless you turned them off (nothing saved: on).
const eyesOn = () => {
  try {
    const v = localStorage.getItem(EYES)
    return v == null ? EYE_BREAKS_DEFAULT : JSON.parse(v) === true
  } catch {
    return EYE_BREAKS_DEFAULT
  }
}

export function IslandNudgeSettings({ onSaved }: { onSaved?: () => void }) {
  const [s, setS] = useState<NudgeStore | null>(null)
  const [eyes, setEyes] = useState(eyesOn)
  const [name, setName] = useState('')
  const [every, setEvery] = useState(7)
  useEffect(() => {
    void nudgePrefs().then(setS)
    return onNudges(setS)
  }, [])
  if (!s) return null
  const p = s.prefs
  const save = async (patch: Partial<NudgePrefs>) => {
    setS(await setNudgePrefs(patch))
    onSaved?.()
  }
  const setOn = (k: NudgeKind, v: boolean) => {
    if (k === 'eyes') {
      try {
        localStorage.setItem(EYES, JSON.stringify(v))
      } catch {
        /* fine */
      }
      setEyes(v)
    }
    void save({ on: { ...p.on, [k]: v } })
  }
  const people = (list: NudgePerson[]) => void save({ people: list })
  const add = () => {
    const n = name.trim()
    if (!n) return
    people([...p.people, { id: `p${Date.now().toString(36)}`, name: n, everyDays: every, last: null }])
    setName('')
  }
  const learnt = NUDGE_KINDS.map((k) => ({ k, level: learnedLevel(s.stats, k), hour: betterHour(s.stats, k) })).filter((x) => x.level !== 'peek')

  return (
    <>
      <h3 className="is-sec">Nudges</h3>
      <Row title="Sitting before a move break" hint={`After ${p.sitMin} minutes at the PC without a 5-minute pause: a dot first, then it drops down, then a sound, then Ben gets firmer at 90 min. It never locks the PC without asking.`}>
        <input className="sx-range" type="range" min={20} max={120} step={5} value={p.sitMin} onChange={(e) => void save({ sitMin: Number(e.target.value) })} aria-label="Sitting minutes" />
      </Row>
      {NUDGE_KINDS.map((k) => (
        <Row key={k} title={NUDGE_LABEL[k]} hint={k === 'eyes' ? 'Every 20 min at the screen: a real 20-second countdown on the pill' : k === 'move' ? 'Pick the exercise and the count; +3 points for each break you log, at most 5 a day' : undefined}>
          <Switch label={NUDGE_LABEL[k]} on={k === 'eyes' ? p.on.eyes && eyes : p.on[k]} onChange={(v) => setOn(k, v)} />
        </Row>
      ))}
      <Row title="Ben's daily challenge" hint="A daily goal from your Sport Track targets, like 100 push-ups in breaks, with a bar on the pill and one bonus when it's done">
        <Switch label="Ben's daily challenge" on={p.challenge} onChange={(v) => void save({ challenge: v })} />
      </Row>
      <Row title="Movement ring" hint={`The small ring on the pill: ${p.ringGoal} ${p.ringUnit === 'min' ? 'minutes' : 'reps'} a day`}>
        <span className="is-slider">
          <input className="sx-input" type="number" min={5} max={1000} value={p.ringGoal} aria-label="Ring goal" style={{ width: 80 }} onChange={(e) => void save({ ringGoal: Number(e.target.value) })} />
          <Segmented label="Ring unit" value={p.ringUnit} options={[['reps', 'Reps'], ['min', 'Minutes']]} onChange={(v) => void save({ ringUnit: v })} />
        </span>
      </Row>
      <Row title="Breathing" hint="Box: in 4, hold 4, out 4, hold 4. 4-7-8: in 4, hold 7, out 8">
        <Segmented label="Breathing" value={p.breath} options={[['box', 'Box'], ['478', '4-7-8']]} onChange={(v) => void save({ breath: v })} />
      </Row>
      <Row title="People to call" hint="A gentle reminder when it's been a while. Done notes today's date.">
        <span />
      </Row>
      {p.people.map((x) => (
        <div key={x.id} className="sx-row">
          <div className="sx-label">
            <b>{x.name}</b>
            <small>Every {x.everyDays} days{x.last ? ` · last call ${x.last}` : ' · no call noted yet'}</small>
          </div>
          <span className="is-slider">
            <input className="sx-input" type="number" min={1} max={90} value={x.everyDays} aria-label={`Every how many days: ${x.name}`} style={{ width: 64 }} onChange={(e) => people(p.people.map((y) => (y.id === x.id ? { ...y, everyDays: Number(e.target.value) } : y)))} />
            <button type="button" className="btn small ghost" aria-label={`Remove ${x.name}`} onClick={() => people(p.people.filter((y) => y.id !== x.id))}>
              ✕
            </button>
          </span>
        </div>
      ))}
      {p.people.length < 12 && (
        <div className="sx-row">
          <div className="sx-label">
            <input className="sx-input" value={name} maxLength={30} placeholder="Name, e.g. Mom or Alex" aria-label="Name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </div>
          <span className="is-slider">
            <input className="sx-input" type="number" min={1} max={90} value={every} aria-label="Every how many days" style={{ width: 64 }} onChange={(e) => setEvery(Number(e.target.value) || 7)} />
            <button type="button" className="btn small ghost" disabled={!name.trim()} onClick={add}>
              Add
            </button>
          </span>
        </div>
      )}
      {learnt.length > 0 && (
        <Row title="What the island learned" hint={learnt.map((x) => `${NUDGE_LABEL[x.k]}: ${x.level === 'dot' ? 'only a dot now (you skipped it a lot)' : 'resting'}${x.hour != null ? `, you take it most around ${String(x.hour).padStart(2, '0')}:00` : ''}`).join(' · ')}>
          <button type="button" className="btn small ghost" onClick={() => void resetNudgeLearning().then(setS)}>
            Start over
          </button>
        </Row>
      )}
    </>
  )
}
