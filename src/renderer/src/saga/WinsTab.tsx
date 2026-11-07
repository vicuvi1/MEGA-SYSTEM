// LF15: the wins wall. Real proof, most of it collected by itself; kind
// deeds and nice messages added by hand. On a low day one win is pulled to
// the top ("Remember this?").
import { useMemo, useState, type CSSProperties } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { WIN_KINDS, winCounts, type Win, type WinKind } from '@core/winsWall'
import type { SagaView } from '../web/sagaStore'

const kindOf = (k: WinKind) => WIN_KINDS.find((x) => x.id === k)!
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function WinsTab({ v }: { v: SagaView }) {
  const act = useAction()
  const [filter, setFilter] = useState<WinKind | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const counts = useMemo(() => winCounts(v.wins), [v.wins])
  const shown = filter === 'all' ? v.wins : v.wins.filter((w) => w.kind === filter)
  const month = v.wins.filter((w) => w.day >= v.today.slice(0, 7) + '-01').length
  return (
    <div className="sg-wins">
      <header className="sg-wins-head">
        <div>
          <span className="sg-kicker">Confidence bank</span>
          <h1 className="sg-title sm">{v.wins.length} wins of real proof</h1>
          <p className="sg-theme">{month} this month. Collected from what you logged, plus what you add by hand.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>＋ Add a win</button>
      </header>
      {v.low && v.winToday && (
        <div className="sg-remember" style={{ '--wk': kindOf(v.winToday.kind).color } as CSSProperties}>
          <span className="sg-kicker">Rough day? Remember this</span>
          <b>{kindOf(v.winToday.kind).icon} {v.winToday.title}</b>
          {v.winToday.detail && <small>{v.winToday.detail} · {fmtDay(v.winToday.day)}</small>}
        </div>
      )}
      <div className="sg-chips sg-win-filter" role="tablist" aria-label="Kinds of wins">
        <button className={`sg-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All {v.wins.length}</button>
        {WIN_KINDS.filter((k) => counts[k.id]).map((k) => (
          <button key={k.id} className={`sg-chip ${filter === k.id ? 'on' : ''}`} onClick={() => setFilter(k.id)}>{k.icon} {k.label} {counts[k.id]}</button>
        ))}
      </div>
      {shown.length ? (
        <div className="sg-wall">
          {shown.slice(0, 120).map((w, i) => <WinTile key={w.id} w={w} i={i} onRemove={() => act(() => life.saga!.removeWin(w.id), w.auto ? 'Taken off the wall' : 'Removed')} />)}
        </div>
      ) : (
        <p className="sg-empty-line">Your wall fills itself as you log workouts, nights on time, focus and goals. Add the things only you know: a flag captured, a kind deed, a message that made your day.</p>
      )}
      {adding && <AddWin onClose={() => setAdding(false)} />}
    </div>
  )
}

function WinTile({ w, i, onRemove }: { w: Win; i: number; onRemove: () => void }) {
  const k = kindOf(w.kind)
  return (
    <article className={`sg-win w${w.weight} k-${w.kind}`} style={{ '--wk': k.color, animationDelay: `${Math.min(i, 20) * 30}ms` } as CSSProperties}>
      <span className="sg-win-icon" aria-hidden="true">{k.icon}</span>
      <div className="sg-win-text">
        <small>{k.label} · {fmtDay(w.day)}</small>
        <b>{w.kind === 'message' && !/^["“]/.test(w.title) ? `“${w.title}”` : w.title}</b>
        {w.detail && <em>{w.detail}</em>}
      </div>
      <button className="sg-win-x" onClick={onRemove} aria-label={w.auto ? `Take "${w.title}" off the wall` : `Remove "${w.title}"`} title={w.auto ? 'Take off the wall' : 'Remove'}>✕</button>
    </article>
  )
}

function AddWin({ onClose }: { onClose: () => void }) {
  const act = useAction()
  const [kind, setKind] = useState<WinKind>('kind')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [weight, setWeight] = useState<1 | 2 | 3>(2)
  const ph: Partial<Record<WinKind, [string, string]>> = {
    ctf: ['Captured the flag on the web challenge', 'after 3 hours and two wrong ideas'],
    record: ['40 push-ups in one set', 'up from 28 in September'],
    kind: ['Helped my neighbour carry the shopping', ''],
    message: ['Thank you for explaining that, it finally clicked', 'from a classmate'],
    other: ['Spoke up in the seminar', '']
  }
  return (
    <div className="sheet sg-sheet" role="dialog" aria-modal="true" aria-label="Add a win" onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card sg-sheet-card">
        <header className="sg-sheet-head">
          <b>Add a win</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sg-form">
          <div className="sg-chips">
            {WIN_KINDS.filter((k) => k.manual).map((k) => (
              <button key={k.id} className={`sg-chip ${kind === k.id ? 'on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.icon} {k.label}</button>
            ))}
          </div>
          <label>{kind === 'message' ? 'What they said' : 'What happened'}<input value={title} maxLength={120} autoFocus placeholder={ph[kind]?.[0]} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>{kind === 'message' ? 'Who (optional)' : 'A detail (optional)'}<input value={detail} maxLength={280} placeholder={ph[kind]?.[1]} onChange={(e) => setDetail(e.target.value)} /></label>
          <div className="sg-chips">
            {([1, 2, 3] as const).map((n) => (
              <button key={n} className={`sg-chip ${weight === n ? 'on' : ''}`} onClick={() => setWeight(n)}>{n === 1 ? 'Small win' : n === 2 ? 'Good win' : 'Big win'}</button>
            ))}
          </div>
          <footer className="sg-sheet-foot">
            <button className="btn primary" disabled={!title.trim()} onClick={async () => { const ok = await act(() => life.saga!.addWin({ kind, title: title.trim(), detail: detail.trim(), weight }), 'On the wall'); if (ok) onClose() }}>Put it on the wall</button>
          </footer>
        </div>
      </div>
    </div>
  )
}
