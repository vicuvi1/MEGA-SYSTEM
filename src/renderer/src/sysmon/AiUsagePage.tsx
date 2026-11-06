// AI usage page on the island: one column per tool (up to 7) with a usage
// ring, when its 5-hour window resets, and tokens and cost for this window,
// today and 7 days. Claude Code and Codex are read from this PC's own log
// files (numbers only, nothing uploaded); Ben's AI shows this month against
// your budget. Off until switched on in Settings → Desktop island.
import { useEffect, useState } from 'react'
import { fmtLeft, fmtTokens, fmtUsd, type ToolUsage } from '@core/aiUsage'
import { tp } from '../islandTap'
import { usageColumns, useSysmonPrefs } from './sysmonFeed'

const level = (pct: number | null, warn = 70, crit = 90) => (pct == null ? 'none' : pct >= crit ? 'crit' : pct >= warn ? 'warn' : 'ok')

/** A usage ring with a letter (or the percent) inside. */
export function UsageRing({ pct, letter, size = 44, stroke = 4, showPct = false, warn, crit }: { pct: number | null; letter: string; size?: number; stroke?: number; showPct?: boolean; warn?: number; crit?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100
  return (
    <span className={`sm-ring ${level(pct, warn, crit)}`} style={{ width: size, height: size }} aria-label={`${letter}: ${pct == null ? 'no limit known' : `${pct}% used`}`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <circle className="bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={`${(c * f).toFixed(2)} ${c.toFixed(2)}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <b>{showPct && pct != null ? `${pct}` : letter}</b>
    </span>
  )
}

const BASIS: Record<ToolUsage['basis'], string> = { limit: 'of the 5-hour limit', busiest: 'of your busiest 5 hours', budget: 'of the month’s budget', none: 'no limit known yet' }

export function AiUsageView({ tools, now, warn, crit, empty }: { tools: ToolUsage[]; now: number; warn: number; crit: number; empty?: string | null }) {
  if (!tools.length) return <div className="ip-empty"><b>🤖 AI usage</b><small>{empty ?? 'Reading…'}</small></div>
  return (
    <div className="sm-page">
      <div className="sm-cols" style={{ ['--cols' as string]: Math.min(tools.length, 3) }}>
        {tools.map((t) => (
          <section key={t.tool} className="sm-card sm-col">
            <UsageRing pct={t.pct} letter={t.letter} size={52} stroke={5} showPct warn={warn} crit={crit} />
            <b className="sm-col-name">{t.label}</b>
            <small className="sm-sub">{t.pct == null ? BASIS.none : `${t.pct}% ${BASIS[t.basis]}`}</small>
            {t.resetsAt != null && <small className="sm-reset">{t.window === 'month' ? 'New month in ' : 'Resets in '}{fmtLeft(t.resetsAt - now)}</small>}
            <dl>
              {t.block && t.window === '5h' && (
                <>
                  <dt>This 5 h</dt>
                  <dd>{fmtTokens(t.block.tokens)} · {fmtUsd(t.block.cost)}</dd>
                </>
              )}
              {t.window === 'month' && t.block && (
                <>
                  <dt>Month</dt>
                  <dd>{fmtUsd(t.block.cost)}</dd>
                </>
              )}
              <dt>Today</dt>
              <dd>{fmtTokens(t.today.tokens)} · {fmtUsd(t.today.cost)}</dd>
              <dt>7 days</dt>
              <dd>{fmtTokens(t.week.tokens)} · {fmtUsd(t.week.cost)}</dd>
            </dl>
            {t.byModel.length > 0 && (
              <ul className="sm-models">
                {t.byModel.slice(0, 3).map((m) => (
                  <li key={m.label}>
                    <span>{m.label}</span>
                    <em>{fmtUsd(m.cost)}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <small className="sm-foot">Claude Code and Codex are read from this PC's log files, numbers only; nothing is uploaded. Their costs are estimates at API prices.</small>
    </div>
  )
}

export function AiUsagePage() {
  const p = useSysmonPrefs()
  const [tools, setTools] = useState<ToolUsage[] | null>(null)
  const [found, setFound] = useState<{ claude: boolean; codex: boolean } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [fresh, setFresh] = useState(0)
  useEffect(() => {
    if (!p) return
    let alive = true
    let t: ReturnType<typeof setTimeout> | null = null
    const load = async (forced: boolean) => {
      if (!document.hidden) {
        const r = await usageColumns(p, { fresh: forced, benMaxAge: forced ? 60_000 : 5 * 60_000 })
        if (!alive) return
        setTools(r.tools)
        setFound(r.found)
        setNow(Date.now())
      }
      t = setTimeout(() => void load(false), 60_000)
    }
    void load(fresh > 0)
    return () => {
      alive = false
      if (t) clearTimeout(t)
    }
  }, [p, fresh])
  if (!p) return null
  const empty = !p.tools.claude && !p.tools.codex && !p.tools.ben ? 'Pick the tools to show in Settings → Desktop island → AI usage.' : found && !found.claude && !found.codex && !p.tools.ben ? 'No Claude Code or Codex logs on this PC yet.' : null
  return (
    <>
      <AiUsageView tools={tools ?? []} now={now} warn={p.alerts.warn} crit={p.alerts.crit} empty={tools ? empty ?? 'Nothing used in the last 7 days.' : null} />
      <button className="sm-refresh" {...tp('sm-ai-refresh', () => setFresh((x) => x + 1))}>Refresh</button>
    </>
  )
}
