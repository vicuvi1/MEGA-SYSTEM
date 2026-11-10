// Sport Track → Gear: "What can you train with?" Tick what you really have;
// every workout uses only that. A table or desk (sturdy / too weak / none),
// then the rest. "Your plan with this" shows each chain's move for the gear
// you are ticking, live (the engine on a copy of your state). A wobbly desk is
// never used for rows; moves that need something you don't own are hidden from
// the plan and the swap sheet, never greyed out. Saved at once, synced with
// Sport Track's state. Nothing here pays points.
import { useMemo, useState } from 'react'
import { ALL_GEAR, GEAR_FLAGS, GEAR_TEXT, TABLE_TEXT, type Gear, type GearFlag, type TableKind } from '@core/trainGear'
import { gearPlan } from '@core/trainSwap'
import { Icon } from '../Icon'
import type { SportTrain } from './useSportTrain'

const TABLES: TableKind[] = ['sturdy', 'weak', 'none']

export function GearView({ t, onBack }: { t: SportTrain; onBack: () => void }) {
  const saved = useMemo(() => (t.st?.trainGear ? ({ ...ALL_GEAR, ...t.st.trainGear } as Gear) : null), [t.st])
  const [draft, setDraft] = useState<Gear>(() => saved ?? ALL_GEAR)
  const set = (next: Gear) => {
    setDraft(next)
    t.saveGear(next)
  }
  const plan = useMemo(() => gearPlan(t.st, draft, t.today), [t.st, draft, t.today])
  return (
    <div className="sp-gear" data-sp="gear">
      <section className="sp-gear-main">
        <button type="button" className="sp-link" onClick={onBack} data-sp="gear-back">
          ‹ Back to Sport Track
        </button>
        <div>
          <small className="sp-eyebrow">Settings · asked once at the start</small>
          <h2>What can you train with?</h2>
          <p className="sp-gear-sub">Tick what you really have. Every workout uses only these.</p>
        </div>
        <div>
          <h3>A table or desk for rows</h3>
          <div className="sp-gear-tiles" role="radiogroup" aria-label="Table or desk">
            {TABLES.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={draft.table === k} className={`sp-gear-tile${draft.table === k ? ' on' : ''}`} onClick={() => set({ ...draft, table: k })} data-gear-table={k}>
                <b>{TABLE_TEXT[k][0]}</b>
                <small>{TABLE_TEXT[k][1]}</small>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3>Everything else</h3>
          <div className="sp-gear-tiles" data-sp="gear-flags">
            {GEAR_FLAGS.map((k: GearFlag) => (
              <button key={k} type="button" aria-pressed={draft[k]} className={`sp-gear-tile${draft[k] ? ' on' : ''}`} onClick={() => set({ ...draft, [k]: !draft[k] })} data-gear={k}>
                <span className="sp-gear-row">
                  <b>{GEAR_TEXT[k][0]}</b>
                  <span className={`sp-gear-box${draft[k] ? ' on' : ''}`} aria-hidden="true">
                    {draft[k] ? <Icon name="check" size={14} /> : null}
                  </span>
                </span>
                <small>{GEAR_TEXT[k][1]}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
      <aside className="sp-gear-plan" aria-label="Your plan with this" data-sp="gear-plan">
        <h3>Your plan with this</h3>
        <p className="sp-small">Changes live as you tick.</p>
        <ul>
          {plan.map((r) => (
            <li key={r.ladder} data-ladder={r.ladder} data-move={r.move}>
              <span className="sp-gear-plan-top">
                <small>{r.path}</small>
                <small className="tag">{r.tag}</small>
              </span>
              <b>{r.name}</b>
            </li>
          ))}
        </ul>
        <p className="sp-small sp-gear-safe">Safety: a wobbly desk is never used for rows. Moves that need something you don&rsquo;t own are hidden, never just greyed out.</p>
      </aside>
    </div>
  )
}
