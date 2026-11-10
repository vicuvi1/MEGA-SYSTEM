// Body → Training: the progression roadmap. One level path per ladder (push,
// pull, shoulders, single-leg, hinge, core): levels done with the day you
// reached them, your level now with a bar toward the level-up, the next one,
// and "at your pace: ~3 weeks to …" from your real rep growth. A finished
// level (top of the range in every set, 2 sessions in a row) asks before it
// moves you up; missing the bottom twice offers to stay or step back. Tap a
// level for how to do it; "Edit ladders" changes levels and ranges. No points.
import { useMemo, useState } from 'react'
import { currentLevel, declineLevel, estimateLevelUp, ladderSets, levelStatus, moveSessions, setLevel, suggestNow, trainOf } from '@core/trainLog'
import { DEFAULT_LADDERS, laddersFor, moveName, movesFor, rangeText, type Ladder, type Level } from '@core/trainLadders'
import { celebrate } from '../../fx'
import { soundFanfare } from '../../soundKit'
import { useToast } from '../../ui'
import { MoveSheet } from './MoveSheet'
import { saveTraining } from './trainingStore'

const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function Roadmap({ st, today, refresh }: { st: any; today: string; refresh: () => void }) {
  const toast = useToast()
  const data = useMemo(() => trainOf(st), [st])
  const [sheet, setSheet] = useState<{ ladder: Ladder; index: number } | null>(null)
  const [editing, setEditing] = useState(false)

  const rows = useMemo(
    () =>
      data.ladders.map((ladder) => {
        const cur = currentLevel(st, data, ladder, today)
        const level = ladder.levels[cur.index]
        const sets = ladderSets(data.week, data.ladders, ladder)
        const sessions = moveSessions(st, level.move, today)
        const since = cur.since
        const status = levelStatus(sessions, level, sets, since)
        const next = ladder.levels[cur.index + 1] ?? null
        const est = estimateLevelUp(sessions, level, sets, next ? moveName(next.move) : null, since)
        const latest = sessions[sessions.length - 1] ?? null
        const show = suggestNow(status, latest, data.levels[ladder.id]?.declinedOn)
        return { ladder, cur, level, sets, status, next, est, show, reached: data.levels[ladder.id]?.reached ?? {} }
      }),
    [st, data, today]
  )

  const moveTo = (ladder: Ladder, index: number, why: 'up' | 'back' | 'pick') => {
    saveTraining((s) => setLevel(s, ladder.id, index, today, Date.now()))
    refresh()
    const name = moveName(ladder.levels[index].move)
    if (why === 'up') {
      celebrate(null, 'reward')
      soundFanfare()
      toast(`Level up: ${name}. Start at the bottom of its range.`, 'good')
    } else toast(why === 'back' ? `Back to ${name} for a while. Build up and come back stronger.` : `${name} is your level now.`, 'good')
  }
  const notYet = (ladder: Ladder, index: number) => {
    saveTraining((s) => declineLevel(s, ladder.id, index, today, Date.now()))
    refresh()
  }

  return (
    <section className="bdy-card tr-road" aria-label="Your progression roadmap" data-tr="roadmap">
      <header className="bdy-head">
        <div>
          <small className="bdy-eyebrow">Roadmap</small>
          <h2 className="bdy-title">Your levels</h2>
        </div>
        <button type="button" className="bdy-btn quiet" onClick={() => setEditing(true)} data-tr="edit-ladders">
          Edit ladders
        </button>
      </header>
      <p className="bdy-note">Hit the top of the range in every set, 2 sessions in a row, with no set tapped Hard: the next move unlocks. You choose Move up or Not yet.</p>
      <div className="tr-ladders">
        {rows.map(({ ladder, cur, level, status, next, est, show, reached }) => (
          <article key={ladder.id} className="tr-ladder" data-ladder={ladder.id} data-state={status.state}>
            <div className="tr-ladder-head">
              <div>
                <small className="bdy-eyebrow">{ladder.name}</small>
                <h3 data-tr="current">{moveName(level.move)}</h3>
              </div>
              <span className="tr-lvl">
                Level <b>{cur.index + 1}</b>/{ladder.levels.length}
              </span>
            </div>
            <div className="tr-prog">
              <div className="bdy-bar" style={{ ['--p' as string]: String(status.pct) }} aria-hidden>
                <i />
              </div>
              <span className="bdy-note" data-tr="progress">
                {status.topSets}/{status.needSets} top sets · {rangeText(level)}
              </span>
            </div>
            <p className="bdy-note tr-est" data-tr="estimate">
              {est.line}
            </p>
            {show && status.state === 'complete' && (
              <div className="tr-levelup" role="status" data-tr="levelup">
                <b>Level complete!</b>
                <span>{next ? `Ready for ${moveName(next.move)}?` : 'Top of this ladder: add a slow 3-second lowering, or a 4th set.'}</span>
                <div className="tr-levelup-actions">
                  {next && (
                    <button type="button" className="bdy-btn primary" onClick={() => moveTo(ladder, cur.index + 1, 'up')} data-tr="move-up">
                      Move up
                    </button>
                  )}
                  <button type="button" className="bdy-btn quiet" onClick={() => notYet(ladder, cur.index)}>
                    Not yet
                  </button>
                </div>
              </div>
            )}
            {show && status.state === 'struggling' && (
              <div className="tr-levelup back" role="status" data-tr="stepback">
                <span>{status.line}</span>
                <div className="tr-levelup-actions">
                  <button type="button" className="bdy-btn" onClick={() => notYet(ladder, cur.index)}>
                    Stay here
                  </button>
                  {cur.index > 0 && (
                    <button type="button" className="bdy-btn quiet" onClick={() => moveTo(ladder, cur.index - 1, 'back')}>
                      One level back
                    </button>
                  )}
                </div>
              </div>
            )}
            <ol className="tr-path" aria-label={`${ladder.name} levels`}>
              {ladder.levels.map((v, i) => {
                const st8 = i < cur.index ? 'done' : i === cur.index ? 'now' : i === cur.index + 1 ? 'next' : 'later'
                const when = reached[String(i)]
                return (
                  <li key={`${v.move}-${i}`} className={`tr-node ${st8}`}>
                    <button type="button" onClick={() => setSheet({ ladder, index: i })} aria-label={`Level ${i + 1}: ${moveName(v.move)}`}>
                      <span className="tr-dot" aria-hidden>
                        {st8 === 'done' ? '✓' : i + 1}
                      </span>
                      <span className="tr-node-text">
                        <b>{moveName(v.move)}</b>
                        <small>{st8 === 'done' ? (when ? `reached ${shortDate(when)}` : 'done') : st8 === 'now' ? `now · ${Math.round(status.pct * 100)}%` : rangeText(v)}</small>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </article>
        ))}
      </div>

      {sheet && (
        <MoveSheet level={sheet.ladder.levels[sheet.index]} title={`${sheet.ladder.name} · level ${sheet.index + 1} of ${sheet.ladder.levels.length}`} onClose={() => setSheet(null)}>
          {sheet.index !== rows.find((r) => r.ladder.id === sheet.ladder.id)?.cur.index && (
            <button
              type="button"
              className="bdy-btn"
              onClick={() => {
                moveTo(sheet.ladder, sheet.index, 'pick')
                setSheet(null)
              }}
            >
              Make this my level
            </button>
          )}
        </MoveSheet>
      )}
      {editing && (
        <LadderEditor
          ladders={data.ladders}
          onClose={() => setEditing(false)}
          onSave={(ladders) => {
            saveTraining((s) => void (s.trainLadders = { ladders, updatedAt: Date.now() }))
            setEditing(false)
            refresh()
            toast('Ladders saved.', 'good')
          }}
        />
      )}
    </section>
  )
}

/** Add, remove and reorder levels, and change their ranges. */
function LadderEditor({ ladders, onSave, onClose }: { ladders: Ladder[]; onSave: (l: Ladder[]) => void; onClose: () => void }) {
  const [list, setList] = useState<Ladder[]>(() => ladders.map((l) => ({ ...l, levels: l.levels.map((v) => ({ ...v })) })))
  const [tab, setTab] = useState(0)
  const [add, setAdd] = useState('')
  const lad = list[tab]
  const put = (levels: Level[]) => setList((ls) => ls.map((l, i) => (i === tab ? { ...l, levels } : l)))
  const move = (i: number, d: -1 | 1) => {
    const lv = [...lad.levels]
    const j = i + d
    if (j < 0 || j >= lv.length) return
    ;[lv[i], lv[j]] = [lv[j], lv[i]]
    put(lv)
  }
  const options = movesFor(lad.type)
  return (
    <div className="sheet tr-sheet" role="dialog" aria-modal="true" aria-label="Edit ladders" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card tr-sheet-card tr-editor" data-tr="ladder-editor">
        <h3 className="bdy-title">Edit ladders</h3>
        <div className="tr-tabs" role="tablist">
          {list.map((l, i) => (
            <button key={l.id} type="button" role="tab" aria-selected={i === tab} className={`bdy-chip${i === tab ? ' on' : ''}`} onClick={() => setTab(i)}>
              {l.name.split(' (')[0]}
            </button>
          ))}
        </div>
        <ol className="tr-edit-list">
          {lad.levels.map((v, i) => (
            <li key={`${v.move}-${i}`}>
              <span className="tr-edit-name">
                {i + 1}. {moveName(v.move)}
              </span>
              <label>
                <span className="sr-only">From</span>
                <input className="input tr-edit-num" type="number" inputMode="numeric" min={1} value={v.lo} onChange={(e) => put(lad.levels.map((x, k) => (k === i ? { ...x, lo: Number(e.currentTarget.value) || 1 } : x)))} aria-label={`${moveName(v.move)} lowest`} />
              </label>
              <span aria-hidden>–</span>
              <label>
                <span className="sr-only">To</span>
                <input className="input tr-edit-num" type="number" inputMode="numeric" min={1} value={v.hi} onChange={(e) => put(lad.levels.map((x, k) => (k === i ? { ...x, hi: Number(e.currentTarget.value) || 1 } : x)))} aria-label={`${moveName(v.move)} highest`} />
              </label>
              <span className="tr-edit-btns">
                <button type="button" className="tr-step sm" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="tr-step sm" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="tr-step sm" aria-label="Remove" disabled={lad.levels.length <= 2} onClick={() => put(lad.levels.filter((_, k) => k !== i))}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        <div className="tr-edit-add">
          <select className="input" value={add} onChange={(e) => setAdd(e.currentTarget.value)} aria-label="Move to add">
            <option value="">Add a level…</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bdy-btn"
            disabled={!add}
            onClick={() => {
              const m = options.find((o) => o.id === add)
              if (!m) return
              put([...lad.levels, { move: m.id, lo: m.unit === 'sec' ? 20 : 6, hi: m.unit === 'sec' ? 45 : 12, unit: m.unit }])
              setAdd('')
            }}
          >
            Add
          </button>
        </div>
        <div className="sheet-actions">
          <button type="button" className="bdy-btn quiet" onClick={() => setList((ls) => ls.map((l, i) => (i === tab ? DEFAULT_LADDERS.find((d) => d.id === l.id)! : l)))}>
            Reset this ladder
          </button>
          <button type="button" className="bdy-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bdy-btn primary" onClick={() => onSave(list.map((l) => ({ ...l, levels: l.levels.map((v) => ({ ...v, hi: Math.max(v.lo, v.hi) })) })))} data-tr="save-ladders">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
