// LF5: this week's side quest (one small offline adventure, fitted to your
// fun money, the weather and free evenings), the "Did it" log with an
// optional photo that stays on this device, and the Adventures trail map.
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { trailPoint, type Adventure } from '@core/sideQuest'
import type { SagaView } from '../web/sagaStore'
import { advPhoto, setAdvPhoto, smallPicture } from './useSaga'

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const PAGE = 20

export function AdventuresTab({ v }: { v: SagaView }) {
  const act = useAction()
  const [did, setDid] = useState(false)
  const [open, setOpen] = useState<Adventure | null>(null)
  const p = v.sidePick
  const status = v.sideStatus
  return (
    <div className="sg-adv">
      <section className={`sg-side ${status}`}>
        <div className="sg-side-emoji" aria-hidden="true">{status === 'done' ? '🏅' : p?.quest.emoji ?? '🧭'}</div>
        <div className="sg-side-body">
          <span className="sg-kicker">This week's side quest</span>
          {status === 'done' ? (
            <>
              <h2>Done this week. A memory, not a point.</h2>
              <p className="sg-muted">A new one comes on Monday.</p>
            </>
          ) : status === 'skipped' ? (
            <>
              <h2>Skipped this week</h2>
              <p className="sg-muted">That's fine. A new one comes on Monday.</p>
            </>
          ) : p ? (
            <>
              <h2>{p.quest.title}</h2>
              <p className="sg-side-tip">💡 {p.quest.tip}</p>
              <div className="sg-chips">
                <span className="sg-chip static">{p.quest.cost ? `~${p.quest.cost} lei` : 'Free'}</span>
                <span className="sg-chip static">⏱ {p.quest.minutes >= 120 ? `${Math.round(p.quest.minutes / 60)} h` : `${p.quest.minutes} min`}</span>
                <span className="sg-chip static">{p.quest.when === 'evening' ? '🌆 An evening' : p.quest.when === 'morning' ? '🌅 Early morning' : '☀️ A free day'}</span>
                <span className="sg-chip static">{p.quest.outdoor ? '🌳 Outside' : '🏠 Inside'}</span>
              </div>
              <p className="sg-side-why">{p.why}</p>
              <div className="sg-side-actions">
                <button className="btn primary" onClick={() => setDid(true)}>✓ Did it</button>
                <button className="btn" onClick={() => act(() => life.saga!.passSide(p.quest.id))}>Another one</button>
                <button className="btn ghost" onClick={() => act(() => life.saga!.skipSide())}>Skip this week</button>
              </div>
            </>
          ) : (
            <>
              <h2>Nothing fits this week</h2>
              <p className="sg-muted">Money or time is tight. Log any adventure you had anyway.</p>
              <button className="btn" onClick={() => setDid(true)}>Log an adventure</button>
            </>
          )}
        </div>
        <div className="sg-side-stats">
          <div><b>{v.sideStats.total}</b><small>adventures</small></div>
          <div><b>{v.sideStats.weeksInARow}</b><small>weeks in a row</small></div>
          <div><b>{v.sideStats.thisYear}</b><small>this year</small></div>
        </div>
      </section>

      <section className="sg-adv-grid">
        <TrailMap log={v.side.log} onOpen={setOpen} />
        <div className="sg-adv-list">
          <header><span className="sg-kicker">Adventures</span><button className="sg-link" onClick={() => setDid(true)}>＋ Log one</button></header>
          {v.side.log.length ? (
            <ul>
              {[...v.side.log].reverse().slice(0, 30).map((a) => (
                <li key={a.id}>
                  <button onClick={() => setOpen(a)}>
                    <span className="sg-adv-e" aria-hidden="true">{a.emoji}</span>
                    <span className="sg-adv-t"><b>{a.title}</b><small>{fmtDay(a.day)}{a.place ? ` · ${a.place}` : ''}</small></span>
                    {a.photo && <span className="sg-adv-cam" title="Photo on this device">📷</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sg-muted">Your first adventure starts the trail.</p>
          )}
        </div>
      </section>
      {did && <DidIt v={v} onClose={() => setDid(false)} />}
      {open && <AdventureSheet a={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** The drawn map: hills, a river and a dotted trail with one stop per adventure (the last 20). */
function TrailMap({ log, onOpen }: { log: Adventure[]; onOpen: (a: Adventure) => void }) {
  const shown = log.slice(-PAGE)
  const from = log.length - shown.length
  const pts = useMemo(() => Array.from({ length: Math.max(shown.length + 1, 4) }, (_, i) => trailPoint(i, 'trail')), [shown.length])
  const W = 600
  const H = 400
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * W).toFixed(1)} ${(p.y * H).toFixed(1)}`).join(' ')
  return (
    <div className="sg-map" aria-label={`Adventure map: ${log.length} stops`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="sgMapSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#13233a" />
            <stop offset="1" stopColor="#0b1422" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#sgMapSky)" className="sg-map-bg" />
        <g className="sg-map-land">
          <path d="M0 330 Q120 290 220 320 T420 300 T600 320 V400 H0Z" />
          <path d="M0 250 Q90 220 170 240 T330 230 T600 250 V300 Q500 280 400 300 T200 300 T0 300Z" opacity="0.7" />
          <path d="M60 140 l40 -50 40 50Z M120 150 l50 -70 50 70Z M440 120 l45 -60 45 60Z M500 130 l35 -40 35 40Z" opacity="0.8" />
        </g>
        <path className="sg-map-river" d="M600 40 C520 80 540 150 460 170 S330 200 300 260 S200 330 120 400" />
        <g className="sg-map-trees">{[[40, 210], [250, 190], [380, 360], [540, 270], [90, 370], [320, 120]].map(([x, y], i) => <path key={i} d={`M${x} ${y} l9 -22 9 22Z`} />)}</g>
        <path className="sg-map-trail" d={path} />
        {/* the next stop, waiting */}
        <circle className="sg-map-next" cx={pts[shown.length].x * W} cy={pts[shown.length].y * H} r="9" />
      </svg>
      {shown.map((a, i) => (
        <button key={a.id} className="sg-pin" style={{ left: `${pts[i].x * 100}%`, top: `${pts[i].y * 100}%`, animationDelay: `${i * 40}ms` } as CSSProperties} onClick={() => onOpen(a)} title={`${a.title} · ${fmtDay(a.day)}`} aria-label={`Stop ${from + i + 1}: ${a.title}`}>
          <span>{a.emoji}</span>
          <small>{from + i + 1}</small>
        </button>
      ))}
      <span className="sg-map-label">{log.length ? `${log.length} stop${log.length === 1 ? '' : 's'} on your trail` : 'Your trail starts here'}</span>
    </div>
  )
}

function DidIt({ v, onClose }: { v: SagaView; onClose: () => void }) {
  const act = useAction()
  const p = v.sidePick
  const [title, setTitle] = useState(v.sideStatus === 'open' && p ? p.quest.title : '')
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const isPick = !!p && v.sideStatus === 'open' && title === p.quest.title
  const save = async () => {
    const id = await act(() => life.saga!.didSide({ questId: isPick ? p!.quest.id : null, title: title.trim(), place: place.trim(), note: note.trim(), photo: !!photo }), 'Added to your adventures')
    if (id && photo && !setAdvPhoto(id, photo)) await act(async () => { throw new Error('The photo could not be kept on this device (storage is full)') })
    if (id) onClose()
  }
  return (
    <div className="sheet sg-sheet" role="dialog" aria-modal="true" aria-label="Did it" onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card sg-sheet-card">
        <header className="sg-sheet-head">
          <b>🏅 Did it</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sg-form">
          <label>What you did<input value={title} maxLength={90} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="Sunrise walk to the hill" /></label>
          <label>Where (optional)<input value={place} maxLength={60} onChange={(e) => setPlace(e.target.value)} placeholder="The old water tower" /></label>
          <label>One line to remember it (optional)<textarea value={note} maxLength={280} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Fog below, sun above. Worth the 5:40 alarm." /></label>
          <div className="sg-row">
            <button className="btn" onClick={() => file.current?.click()}>{photo ? 'Change photo' : '📷 Add a photo'}</button>
            {photo && <img className="sg-photo-thumb" src={photo} alt="Your photo" />}
            <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await act(async () => setPhoto(await smallPicture(f, 900, 220_000))) }} />
          </div>
          <small className="sg-muted">Photos stay on this device only.</small>
          <footer className="sg-sheet-foot">
            <button className="btn primary" disabled={!title.trim()} onClick={() => void save()}>Add to my adventures</button>
          </footer>
        </div>
      </div>
    </div>
  )
}

function AdventureSheet({ a, onClose }: { a: Adventure; onClose: () => void }) {
  const act = useAction()
  const photo = a.photo ? advPhoto(a.id) : null
  return (
    <div className="sheet sg-sheet" role="dialog" aria-modal="true" aria-label={a.title} onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card sg-sheet-card">
        <header className="sg-sheet-head">
          <b>{a.emoji} {a.title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {photo ? <img className="sg-adv-photo" src={photo} alt={a.title} /> : a.photo ? <p className="sg-muted">The photo is on another device.</p> : null}
        <p><b>{fmtDay(a.day)}</b>{a.place ? ` · ${a.place}` : ''}</p>
        {a.note && <p className="sg-adv-note">“{a.note}”</p>}
        <footer className="sg-sheet-foot">
          <button className="btn ghost danger" onClick={async () => { await act(() => life.saga!.removeAdventure(a.id)); setAdvPhoto(a.id, null); onClose() }}>Remove</button>
        </footer>
      </div>
    </div>
  )
}
