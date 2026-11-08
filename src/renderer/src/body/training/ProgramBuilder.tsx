// The home program builder: minutes, days, what you own and a focus in; a
// 4-week block out (core/homeProgram.ts). "Use this program" makes Sport
// Track's Today follow it (state.program); nothing else in Sport Track changes.
import { useMemo, useState } from 'react'
import { EQUIPMENT, applyHomeProgram, buildHomeProgram, programLevels, stopHomeProgram, toTrackerProgram, type Equip, type Focus, type HomeItem, type HomePrefs, type HomeProgram } from '@core/homeProgram'
import { useToast } from '../../ui'
import { historyOf, saveTraining, type HomeTraining } from './trainingStore'

const restText = (s: number) => (s >= 120 ? `${Math.round((s / 60) * 2) / 2} min` : `${s} s`)
const rangeText = (it: HomeItem) => `${it.sets} × ${it.lo}–${it.hi}${it.unit === 'sec' ? ' s' : ''}`
const KIND: Record<HomeItem['kind'], string> = { strength: 'Strength', size: 'Size', hold: 'Hold' }

function Seg<T extends string | number>({ label, value, options, onChange, name }: { label: string; name: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="bt-field">
      <span className="bt-label" id={`bt-${name}`}>
        {label}
      </span>
      <div className="bt-seg" role="radiogroup" aria-labelledby={`bt-${name}`}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} data-bt={`${name}-${o.v}`} onClick={() => onChange(o.v)}>
            {o.t}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ProgramBuilder({ st, ht, today, onChanged }: { st: any; ht: HomeTraining; today: string; onChanged: () => void }) {
  const toast = useToast()
  const prefs = ht.prefs
  const program = useMemo(() => buildHomeProgram(prefs, historyOf(st, today)), [prefs, st, today])
  const inUse = ht.active ? JSON.stringify(ht.active.program.weeks) === JSON.stringify(program.weeks) && JSON.stringify(ht.active.program.prefs) === JSON.stringify(program.prefs) : false
  const [week, setWeek] = useState<number>(() => ht.active?.week ?? 1)
  const shown = program.weeks[Math.max(0, Math.min(3, week - 1))]
  const levels = programLevels(program)

  const setPrefs = (patch: Partial<HomePrefs>) => {
    saveTraining((_st, h) => void (h.prefs = { ...h.prefs, ...patch }))
    onChanged()
  }
  const toggleEquip = (id: Equip) => setPrefs({ equip: prefs.equip.includes(id) ? prefs.equip.filter((x) => x !== id) : [...prefs.equip, id] })

  const use = (p: HomeProgram) => {
    const out = saveTraining((s, h) => {
      s.exercises = applyHomeProgram(Array.isArray(s.exercises) ? s.exercises : [], p, 1, today)
      s.program = { id: 'home', startedOn: today, custom: toTrackerProgram(p, today), replaced: true }
      // The generated week plan would take over Today in Coach mode: this program is what Today follows now.
      s.sportySettings = { ...(s.sportySettings ?? {}), planFollow: false }
      h.active = { startedOn: today, week: 1, program: p }
    })
    setWeek(1)
    onChanged()
    toast(out ? 'Today now follows your home program. Your own exercises are paused, not deleted.' : 'Could not save the program on this device.', out ? 'good' : 'bad')
  }
  const stop = () => {
    saveTraining((s, h) => {
      s.exercises = stopHomeProgram(Array.isArray(s.exercises) ? s.exercises : [])
      if (s.program?.id === 'home') s.program = null
      h.active = null
    })
    onChanged()
    toast('Program stopped. Your own routine is back.', 'good')
  }

  return (
    <section className="card bt-builder" aria-label="Home program builder">
      <header className="card-head">
        <h2>Home program</h2>
        <span className="hint small">4 weeks: 3 build, 1 lighter. Moves start at your level.</span>
      </header>
      <div className="bt-controls">
        <Seg label="Minutes" name="min" value={prefs.minutes} options={[20, 30, 45].map((v) => ({ v: v as HomePrefs['minutes'], t: `${v}` }))} onChange={(v) => setPrefs({ minutes: v })} />
        <Seg label="Days a week" name="days" value={prefs.days} options={[3, 4, 5].map((v) => ({ v: v as HomePrefs['days'], t: `${v}` }))} onChange={(v) => setPrefs({ days: v })} />
        <Seg<Focus> label="Focus" name="focus" value={prefs.focus} options={[{ v: 'balanced', t: 'Balanced' }, { v: 'upper', t: 'Upper' }, { v: 'legs', t: 'Legs' }]} onChange={(v) => setPrefs({ focus: v })} />
        <div className="bt-field bt-equip">
          <span className="bt-label">I have</span>
          <div className="bt-chips">
            {EQUIPMENT.map((e) => (
              <button key={e.id} type="button" className={`chip-btn${prefs.equip.includes(e.id) ? ' on' : ''}`} aria-pressed={prefs.equip.includes(e.id)} data-bt={`eq-${e.id}`} onClick={() => toggleEquip(e.id)}>
                {e.label}
              </button>
            ))}
            {!prefs.equip.length && <small className="muted">Nothing: floor and a door only</small>}
          </div>
        </div>
      </div>

      {levels.length > 0 && (
        <p className="bt-levels">
          <b>Your levels:</b>{' '}
          {levels.map((l, i) => (
            <span key={l.name}>
              {i > 0 && ' · '}
              {l.name} {l.level ? (l.level.start ? <em className="muted">start</em> : `L${l.level.n}`) : ''}
            </span>
          ))}
        </p>
      )}

      <div className="bt-weeks" role="tablist" aria-label="Weeks of the block">
        {program.weeks.map((w) => (
          <button key={w.n} type="button" role="tab" aria-selected={w.n === shown.n} className={`${w.n === shown.n ? 'on' : ''}${w.light ? ' light' : ''}`} data-bt={`week-${w.n}`} onClick={() => setWeek(w.n)}>
            <b>Week {w.n}</b>
            <small>{w.light ? 'Lighter' : 'Build'}</small>
          </button>
        ))}
      </div>
      <p className="bt-aim">{shown.aim}</p>

      <div className="bt-sessions">
        {shown.sessions.map((s) => (
          <article key={s.id} className="bt-session">
            <header>
              <h3>{s.name}</h3>
              <span className="bt-min">~{s.minutes} min</span>
            </header>
            <p className="bt-warm">
              Warm-up {program.warmup.minutes} min: {program.warmup.steps.join(' · ')}
            </p>
            <ol className="bt-items">
              {s.items.map((it, i) => (
                <li key={it.move.id + i} className={it.pairNext ? 'paired' : ''}>
                  <span className={`bt-kind ${it.kind}`}>{KIND[it.kind]}</span>
                  <span className="bt-move">
                    <b>{it.move.name}</b>
                    <small>
                      {it.level ? (it.level.start ? 'start level · ' : `Level ${it.level.n} of ${it.level.of} · `) : ''}
                      rest {restText(it.rest)}
                      {it.pairNext ? ' after the next move' : ''}
                      {it.note ? ` · ${it.note}` : ''}
                      {it.move.how ? ` · ${it.move.how}` : ''}
                    </small>
                  </span>
                  <span className="bt-sets">{rangeText(it)}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <div className="bt-rules">
        <h3>How it moves up</h3>
        <ul>
          {program.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="bt-actions">
        {inUse ? (
          <span className="bt-inuse">In use since {ht.active!.startedOn} · Today follows it</span>
        ) : (
          <button type="button" className="btn primary" data-bt="use" onClick={() => use(program)}>
            {ht.active ? 'Use this new version' : 'Use this program'}
          </button>
        )}
        {ht.active && (
          <button type="button" className="btn ghost" data-bt="stop" onClick={stop}>
            Stop program
          </button>
        )}
      </div>
    </section>
  )
}
