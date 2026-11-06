// System page on the island (BrimDeck style): CPU total and per core, GPU,
// memory, network with a small line, the busiest apps (Close asks Allow /
// Deny first and never touches Windows itself), drives, temperatures, power
// and the battery. Asks the desktop once a second only while this page is
// shown (the pager mounts only the page you see) and the window is visible.
import { useEffect, useRef, useState } from 'react'
import type { IslandAction } from '@core/islandModel'
import { fmtBytes, fmtRate, pushHistory, sparkPath, type SysSample } from '@core/sysmon'
import { barFill } from '../motionKit'
import { tp } from '../islandTap'
import { saveSysmonPrefs, useSysmonPrefs } from './sysmonFeed'

const level = (pct: number) => (pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok')

export function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <span className={`sm-bar pbar ${level(pct)} ${className}`}>
      <i style={barFill(pct / 100)} />
    </span>
  )
}

function Spark({ values, max, className }: { values: number[]; max?: number; className?: string }) {
  if (values.length < 2) return <svg className={`sm-spark ${className ?? ''}`} viewBox="0 0 100 24" aria-hidden />
  return (
    <svg className={`sm-spark ${className ?? ''}`} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <path d={sparkPath(values, 100, 22, max)} transform="translate(0 1)" />
    </svg>
  )
}

interface Hist { cpu: number[]; down: number[]; up: number[]; power: number[] }

/** The page itself (data in, no polling): also used by the screenshots and tests. */
export function SystemView({ s, hist, topBy, onClose, onSort }: { s: SysSample | null; hist: Hist; topBy: 'cpu' | 'mem'; onClose: (app: string) => void; onSort: (by: 'cpu' | 'mem') => void }) {
  if (!s) return <div className="ip-empty sm-wait"><b>🖥 System</b><small>Reading this PC…</small></div>
  const memPct = s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0
  const temps = ([['CPU', s.temps.cpu], ['GPU', s.temps.gpu], ['SSD', s.temps.ssd]] as const).filter(([, v]) => v != null)
  return (
    <div className="sm-page">
      <section className="sm-card sm-cpu">
        <header>
          <b>CPU</b>
          <span className="sm-big">{s.cpu.total}%</span>
          <Spark values={hist.cpu} max={100} className="cpu" />
        </header>
        <div className="sm-cores" style={{ ['--n' as string]: Math.min(16, s.cpu.cores.length) }} aria-label={`${s.cpu.cores.length} cores`}>
          {s.cpu.cores.slice(0, 32).map((c, i) => (
            <span key={i} className={`sm-core ${level(c)}`} title={`Core ${i + 1}: ${c}%`}>
              <i style={{ transform: `scaleY(${Math.max(0.04, c / 100)})` }} />
            </span>
          ))}
        </div>
        {s.cpu.model && <small className="sm-sub">{s.cpu.model}</small>}
      </section>

      <div className="sm-tiles">
        <section className="sm-card">
          <b>Memory</b>
          <span className="sm-num">{Math.round(memPct)}%</span>
          <Bar pct={memPct} />
          <small className="sm-sub">{fmtBytes(s.mem.used)} of {fmtBytes(s.mem.total)}</small>
        </section>
        {s.gpu != null && (
          <section className="sm-card">
            <b>GPU</b>
            <span className="sm-num">{Math.round(s.gpu)}%</span>
            <Bar pct={s.gpu} />
          </section>
        )}
        {s.net && (
          <section className="sm-card sm-net">
            <b>Network</b>
            <span className="sm-num sm-netnum">
              <em>↓ {fmtRate(s.net.down)}</em>
              <em>↑ {fmtRate(s.net.up)}</em>
            </span>
            <span className="sm-sparks">
              <Spark values={hist.down} className="down" />
              <Spark values={hist.up} max={Math.max(...hist.down, ...hist.up)} className="up" />
            </span>
          </section>
        )}
      </div>

      {(temps.length > 0 || s.power != null || s.battery) && (
        <div className="sm-tiles">
          {temps.length > 0 && (
            <section className="sm-card">
              <b>Temperature</b>
              <span className="sm-temps">
                {temps.map(([k, v]) => (
                  <em key={k} className={v! >= 90 ? 'crit' : v! >= 75 ? 'warn' : ''}>
                    {k} {v}°
                  </em>
                ))}
              </span>
            </section>
          )}
          {s.power != null && (
            <section className="sm-card">
              <b>Power</b>
              <span className="sm-num">{s.power.toFixed(s.power < 10 ? 1 : 0)} W</span>
              <Spark values={hist.power} className="power" />
            </section>
          )}
          {s.battery && (
            <section className="sm-card">
              <b>Battery</b>
              <span className="sm-num">{s.battery.pct}%{s.battery.charging ? ' ⚡' : ''}</span>
              <Bar pct={100 - s.battery.pct} className="inv" />
              <small className="sm-sub">{s.battery.charging ? 'Charging' : s.battery.minutesLeft ? `${Math.floor(s.battery.minutesLeft / 60)}h ${s.battery.minutesLeft % 60}m left` : 'On battery'}</small>
            </section>
          )}
        </div>
      )}

      {s.apps.length > 0 && (
        <section className="sm-card sm-apps">
          <header>
            <b>Busiest apps</b>
            <span className="sm-sort" role="radiogroup" aria-label="Sort by">
              <button role="radio" aria-checked={topBy === 'cpu'} className={topBy === 'cpu' ? 'on' : ''} {...tp('sm-sort-cpu', () => onSort('cpu'))}>CPU</button>
              <button role="radio" aria-checked={topBy === 'mem'} className={topBy === 'mem' ? 'on' : ''} {...tp('sm-sort-mem', () => onSort('mem'))}>RAM</button>
            </span>
          </header>
          <ul>
            {s.apps.map((a) => (
              <li key={a.name}>
                <span className="sm-app-name" title={a.count > 1 ? `${a.count} processes` : undefined}>{a.name}</span>
                <span className="sm-app-num">{a.cpu.toFixed(a.cpu < 10 ? 1 : 0)}%</span>
                <span className="sm-app-num">{fmtBytes(a.mem)}</span>
                {a.system ? (
                  <span className="sm-app-sys" title="Part of Windows (or this app): never closed">system</span>
                ) : (
                  <button className="sm-close" aria-label={`Close ${a.name}`} {...tp(`sm-close-${a.name}`, () => onClose(a.name))}>Close</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.drives.length > 0 && (
        <section className="sm-card sm-drives">
          <b>Drives</b>
          {s.drives.map((d) => {
            const used = d.size ? ((d.size - d.free) / d.size) * 100 : 0
            return (
              <div key={d.name} className="sm-drive">
                <span>{d.name}{d.label ? ` ${d.label}` : ''}</span>
                <Bar pct={used} />
                <small>{fmtBytes(d.free)} free of {fmtBytes(d.size)}</small>
              </div>
            )
          })}
        </section>
      )}
      {!s.windows && <small className="sm-foot">GPU, network, apps, drives, temperatures and power are read on Windows.</small>}
    </div>
  )
}

const EMPTY: Hist = { cpu: [], down: [], up: [], power: [] }

/** The live page: asks the desktop once a second while shown. */
export function SystemPage({ tap }: { tap: (a: IslandAction, label?: string) => void }) {
  const p = useSysmonPrefs()
  const [s, setS] = useState<SysSample | null>(null)
  const [hist, setHist] = useState<Hist>(EMPTY)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    let t: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (!alive.current) return
      if (!document.hidden) {
        const r: SysSample | null = await window.desktop?.sysmon?.('sample').catch(() => null)
        if (!alive.current) return
        if (r) {
          setS(r)
          setHist((h) => ({ cpu: pushHistory(h.cpu, r.cpu.total), down: r.net ? pushHistory(h.down, r.net.down) : h.down, up: r.net ? pushHistory(h.up, r.net.up) : h.up, power: r.power != null ? pushHistory(h.power, r.power) : h.power }))
        }
      }
      t = setTimeout(tick, 1000)
    }
    void tick()
    return () => {
      alive.current = false
      if (t) clearTimeout(t)
      void window.desktop?.sysmon?.('stop').catch(() => {})
    }
  }, [])
  return <SystemView s={s} hist={hist} topBy={p?.topBy ?? 'cpu'} onSort={(by) => void saveSysmonPrefs({ topBy: by })} onClose={(app) => tap({ kind: 'pcClose', app }, `Close ${app}?`)} />
}
