// Ben's log: every message he sent, held back (and why) or failed to send,
// next to every AI call and what it cost. One timeline, newest first.
import { useEffect, useMemo, useState } from 'react'
import { life } from './bridge'
import { currentSession } from './web/session'
import { mergeLog, type AiCall, type BenLogEntry } from '@core/benLog'

type Filter = 'all' | 'sent' | 'skipped' | 'failed' | 'ai'

export const usd = (n: number | null) => (n == null ? 'free' : n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const ICON: Record<BenLogEntry['status'], string> = { sent: '✉️', skipped: '🤫', failed: '⚠️' }
const short = (m: string) => m.split('/').pop() ?? m

export function BenLog() {
  const [msgs, setMsgs] = useState<(BenLogEntry & { at: string })[] | null>(null)
  const [calls, setCalls] = useState<AiCall[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const load = () => {
    life.system?.benLog?.().then(setMsgs).catch(() => setMsgs([]))
    fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession() ?? ''}`, 'Content-Type': 'application/json' }, body: '{"op":"usage"}' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCalls(Array.isArray(j?.recent) ? j.recent : []))
      .catch(() => setCalls([]))
  }
  useEffect(load, [])
  const rows = useMemo(() => mergeLog(msgs ?? [], calls).filter((r) => filter === 'all' || (filter === 'ai' ? r.type === 'ai' : r.type === 'msg' && r.e.status === filter)), [msgs, calls, filter])
  const weekCost = calls.filter((c) => Date.now() - Date.parse(c.at) < 7 * 86400_000).reduce((s, c) => s + (c.cost ?? 0), 0)
  const count = (s: BenLogEntry['status']) => (msgs ?? []).filter((m) => m.status === s).length
  if (!life.system?.benLog) return <p className="hint">Ben's log is on the website and desktop app once the server is connected.</p>
  return (
    <section className="panel ben-log">
      <header className="panel-head">
        <h2>Ben's log</h2>
        <button className="btn small ghost" onClick={load}>
          ⟳ Refresh
        </button>
      </header>
      <p className="hint small">
        Every message Ben sent or held back, and why, plus what each AI call cost. {count('sent')} sent · {count('skipped')} held back · {count('failed')} failed · AI calls
        shown cost {usd(weekCost)} this week.
      </p>
      <div className="seg" role="tablist" aria-label="Show">
        {(['all', 'sent', 'skipped', 'failed', 'ai'] as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'sent' ? 'Sent' : f === 'skipped' ? 'Held back' : f === 'failed' ? 'Failed' : 'AI calls'}
          </button>
        ))}
      </div>
      {msgs === null ? (
        <p className="hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="hint">Nothing here yet. Ben writes here from his next check (every few minutes).</p>
      ) : (
        <ul className="bl-list">
          {rows.slice(0, 150).map((r, i) =>
            r.type === 'msg' ? (
              <li key={i} className={`bl-${r.e.status}`}>
                <span className="bl-ic" aria-hidden>
                  {ICON[r.e.status]}
                </span>
                <div>
                  <b>{r.e.status === 'sent' ? 'Sent' : r.e.status === 'skipped' ? 'Held back' : 'Failed'}</b> <small>{r.e.kind}</small>
                  {r.e.reason && <div className="bl-why">{r.e.reason}</div>}
                  {r.e.text && <div className="bl-text">{r.e.text}</div>}
                </div>
                <time>{when(r.at)}</time>
              </li>
            ) : (
              <li key={i} className="bl-ai">
                <span className="bl-ic" aria-hidden>
                  🧠
                </span>
                <div>
                  <b>AI call</b> <small>{r.c.kind ?? 'chat'}</small>
                  <div className="bl-why">
                    {short(r.c.model)}
                    {r.c.prompt != null ? ` · ${((r.c.prompt + (r.c.completion ?? 0)) / 1000).toFixed(1)}k tokens` : ''} · {usd(r.c.cost)}
                  </div>
                </div>
                <time>{when(r.at)}</time>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  )
}
