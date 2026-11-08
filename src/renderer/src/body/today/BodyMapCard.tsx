// The body map (Body → Today): an original drawn front and back body (plain
// shapes, no copied art). Each muscle group lights up by this week's hard sets
// (Sport Track's sets, core/bodyMap.ts); 10–20 a week is the growth zone. Tap a
// muscle, on the drawing or in the list: its sets and the moves that train it.
import { useState, type CSSProperties } from 'react'
import { bodyMap, muscleDetail, REGIONS, ZONE_LABEL, type MapGroup } from '@core/bodyMap'
import { WEEKLY_SETS, type Muscle } from '@core/sportSets'
import { FigureSvg } from '../../DrillFigure'
import type { SportToday } from './useSportToday'

const W = 120
/** Mirrors an absolute path (M/L/Q/Z with x y pairs) across the body's middle. */
const mir = (d: string) => {
  let i = 0
  return d.replace(/-?\d+(\.\d+)?/g, (n) => String(i++ % 2 === 0 ? W - Number(n) : Number(n)))
}
const both = (d: string) => [d, mir(d)]

// The silhouette (drawn once for each side).
const SIL = [
  ...both('M60 37 Q44 38 34 44 Q26 47 23 58 L18 98 L13 136 L21 138 L27 102 L31 70 L36 118 L35 140 L41 198 L44 246 L55 246 L57 198 L59 142 L60 142 Z'),
  'M54 30 L66 30 L66 40 L54 40 Z'
]
const HEAD = { cx: 60, cy: 19, r: 12 }
const HANDS = [{ cx: 16, cy: 143 }, { cx: W - 16, cy: 143 }]

// Regions: id → shapes (front or back), each a path.
const SHAPES: Record<string, string[]> = {
  shoulders: both('M28 46 Q34 41 41 45 L38 57 Q30 58 26 55 Z'),
  chest: both('M42 49 Q51 45 59 49 L59 68 Q49 72 41 66 Z'),
  biceps: both('M25 60 Q30 58 32 63 L29 86 Q24 88 22 84 Z'),
  abs: ['M51 74 Q60 71 69 74 L68 116 Q60 119 52 116 Z'],
  obliques: both('M40 74 L49 76 L50 114 L42 116 Q39 96 40 74 Z'),
  quads: both('M38 144 L58 144 L56 190 Q49 194 43 190 Z'),
  'calves-f': both('M44 202 Q50 198 55 202 L54 230 Q49 233 46 230 Z'),
  'upper-back': ['M43 45 Q60 39 77 45 L72 66 Q60 70 48 66 Z'],
  lats: both('M36 60 L48 70 L50 102 Q41 98 38 90 Z'),
  triceps: both('M24 60 Q30 57 32 63 L30 88 Q25 90 22 85 Z'),
  'lower-back': ['M50 100 Q60 97 70 100 L70 120 Q60 123 50 120 Z'],
  glutes: both('M38 124 Q48 120 59 125 L59 144 Q47 148 37 142 Z'),
  hamstrings: both('M39 150 L58 150 L56 192 Q49 196 43 192 Z'),
  'calves-b': both('M43 200 Q50 195 56 200 L55 232 Q49 236 45 232 Z')
}

function Side({ side, groups, pick, onPick }: { side: 'front' | 'back'; groups: MapGroup[]; pick: Muscle | null; onPick: (m: Muscle) => void }) {
  const by = new Map(groups.map((g) => [g.muscle, g]))
  return (
    <figure className="bmap-side">
      <svg viewBox={`0 0 ${W} 252`} className="bmap-svg" role="group" aria-label={`${side === 'front' ? 'Front' : 'Back'} of the body`}>
        {SIL.map((d, i) => (
          <path key={i} className="bmap-sil" d={d} />
        ))}
        <circle className="bmap-sil" {...HEAD} />
        {HANDS.map((h, i) => (
          <circle key={i} className="bmap-sil" cx={h.cx} cy={h.cy} r={5} />
        ))}
        {REGIONS.filter((r) => r.side === side).map((r) => {
          const g = by.get(r.muscle)!
          const style = { ['--h' as any]: g.heat } as CSSProperties
          return (
            <g
              key={r.id}
              className={`bmap-region z-${g.zone}${pick === r.muscle ? ' on' : ''}`}
              data-region={r.id}
              data-muscle={r.muscle}
              style={style}
              onClick={() => onPick(r.muscle)}
            >
              <title>{`${r.name}: ${g.sets} hard sets this week`}</title>
              {SHAPES[r.id].map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          )
        })}
      </svg>
      <figcaption className="bdy-note">{side === 'front' ? 'Front' : 'Back'}</figcaption>
    </figure>
  )
}

export function BodyMapCard({ sport }: { sport: SportToday | null }) {
  const groups = bodyMap(sport?.week ?? {})
  const [pick, setPick] = useState<Muscle | null>(null)
  const sel = pick ?? groups.slice().sort((a, b) => a.sets - b.sets)[0]?.muscle ?? 'push'
  const d = muscleDetail(sel, groups.find((g) => g.muscle === sel)?.sets ?? 0, sport?.exercises ?? [])
  const top = WEEKLY_SETS.hi + 4
  return (
    <section className="bdy-card bmap-card" aria-label="Body map: hard sets per muscle this week">
      <div className="bdy-head">
        <h2 className="bdy-title">Body map</h2>
        <span className="bdy-note">Hard sets this week · aim {WEEKLY_SETS.lo}–{WEEKLY_SETS.hi} per muscle</span>
      </div>
      <div className="bmap-wrap">
        <div className="bmap-figures">
          <Side side="front" groups={groups} pick={sel} onPick={setPick} />
          <Side side="back" groups={groups} pick={sel} onPick={setPick} />
        </div>
        <div className="bmap-side-panel">
          <div className="bmap-list" role="radiogroup" aria-label="Muscle groups">
            {groups.map((g) => (
              <button key={g.muscle} type="button" role="radio" aria-checked={sel === g.muscle} className={`bmap-row z-${g.zone}${sel === g.muscle ? ' on' : ''}`} data-muscle={g.muscle} onClick={() => setPick(g.muscle)}>
                <span className="bmap-row-name">{g.name}</span>
                <span className="bdy-bar thin" aria-hidden="true">
                  <span className="bdy-zone" style={{ left: `${(WEEKLY_SETS.lo / top) * 100}%`, width: `${((WEEKLY_SETS.hi - WEEKLY_SETS.lo) / top) * 100}%` }} />
                  <i style={{ ['--p' as any]: Math.min(1, g.sets / top) }} />
                </span>
                <b className="bmap-row-num">{g.sets}</b>
              </button>
            ))}
          </div>
          <div className="bmap-detail" aria-live="polite">
            <div className="bdy-head">
              <b className="bmap-detail-name">{d.name}</b>
              <span className={`bmap-zone-tag z-${d.zone}`}>{ZONE_LABEL[d.zone]}</span>
            </div>
            <p className="bdy-sub">{d.line}</p>
            <p className="bdy-note">Trains your {d.parts}.</p>
            {d.yours.length > 0 && (
              <div className="bmap-moves">
                <span className="bdy-eyebrow">Your moves</span>
                <div className="bmap-chips">
                  {d.yours.map((y) => (
                    <span key={y.id} className="bdy-chip on">
                      {y.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {d.ideas.length > 0 && (
              <div className="bmap-moves">
                <span className="bdy-eyebrow">{d.yours.length ? 'Also good' : 'Moves for it'}</span>
                <ul className="bmap-ideas">
                  {d.ideas.map((m) => (
                    <li key={m.id}>
                      <FigureSvg anim={m.anim} size={36} />
                      <span>{m.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
