// Settings → Connections, at a glance: one card per connection with its
// state (working / needs you / off), one line, and the button that fixes it.
import { useCallback, useEffect, useState } from 'react'
import { connectionCards, connectionSummary, type ConnCard } from '@core/connections'
import { life } from './bridge'
import { useAction } from './ui'

const MARK = { ok: '✓', needs: '!', off: '–' } as const
const WORD = { ok: 'Working', needs: 'Needs you', off: 'Off' } as const

export function ConnectionsOverview({ onGo }: { onGo?: (p: 'bots' | 'coach') => void }) {
  const act = useAction()
  const [cards, setCards] = useState<ConnCard[] | null>(null)
  const load = useCallback(async () => {
    const [h, g, t] = await Promise.all([
      life.system?.health().catch(() => null) ?? Promise.resolve(null),
      life.google?.status().catch(() => null) ?? Promise.resolve(null),
      life.todoist?.status().then((x) => !!x.connected).catch(() => null) ?? Promise.resolve(null)
    ])
    setCards(connectionCards({ checks: h?.checks ?? [], google: g as any, todoist: t }))
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  if (!cards) return <p className="muted cx-loading">Checking your connections…</p>
  const fix = (c: ConnCard) => {
    const f = c.fix
    if (!f) return null
    const run = () => {
      if (f.kind === 'google') void act(() => life.google!.connect())
      else if (f.kind === 'link') window.open(f.href, '_blank', 'noopener')
      else onGo?.(f.page)
    }
    if (f.kind === 'page' && !onGo) return null
    return (
      <button className={`btn small ${c.state === 'ok' ? 'ghost' : 'primary'}`} onClick={run}>
        {f.label}
      </button>
    )
  }
  return (
    <section className="cn">
      <header className="cn-head">
        <b>{connectionSummary(cards)}</b>
        <button className="btn small ghost" onClick={() => void load()}>
          Check again
        </button>
      </header>
      <div className="cn-grid">
        {cards.map((c) => (
          <article key={c.id} className={`cn-card ${c.state}`}>
            <div className="cn-top">
              <span className={`cn-mark ${c.state}`} aria-hidden>
                {MARK[c.state]}
              </span>
              <div>
                <b>{c.name}</b>
                <small>{c.what}</small>
              </div>
              <span className={`cn-state ${c.state}`}>{WORD[c.state]}</span>
            </div>
            <p className="cn-line">{c.line}</p>
            {c.steps && c.state !== 'ok' && (
              <ol className="cn-steps">
                {c.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            )}
            <div className="cn-actions">{fix(c)}</div>
          </article>
        ))}
      </div>
    </section>
  )
}
