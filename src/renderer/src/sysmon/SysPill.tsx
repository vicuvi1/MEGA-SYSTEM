// On the closed island (the pill): small usage rings with a letter inside
// ("C" Claude, "X" Codex, "B" Ben) and CPU / memory beside them, each only
// when switched on. At 70% (warning) and 90% (critical) a 5-second notice
// shows in the pill ("Claude 5-hour 91% used"), once per window.
// CPU / memory are read every 30 s; usage every 2 minutes (Ben every 15).
import { useEffect, useState } from 'react'
import { usageAlert, type ToolUsage, type UsageNotice } from '@core/aiUsage'
import { aiOn, readTold, saveTold, usageColumns, useSysmonPrefs } from './sysmonFeed'
import { UsageRing } from './AiUsagePage'

export function SysPill() {
  const p = useSysmonPrefs()
  const [cpu, setCpu] = useState<{ cpu: number; mem: number } | null>(null)
  const [tools, setTools] = useState<ToolUsage[]>([])
  const [notice, setNotice] = useState<UsageNotice | null>(null)

  const cpuOn = !!p?.readings.cpuRam
  useEffect(() => {
    if (!cpuOn) return void setCpu(null)
    let alive = true
    const read = async () => {
      if (document.hidden) return
      const r = await window.desktop?.sysmon?.('light').catch(() => null)
      if (alive) setCpu(r ?? null)
    }
    void read()
    const t = setInterval(() => void read(), 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [cpuOn])

  const usageOn = !!p && aiOn(p) && (p.readings.rings || p.alerts.on)
  const key = p ? JSON.stringify([p.tools, p.limits, p.alerts, p.readings.rings, p.pages.ai]) : ''
  useEffect(() => {
    if (!p || !usageOn) return void setTools([])
    let alive = true
    const read = async () => {
      if (document.hidden) return
      const r = await usageColumns(p, { benMaxAge: 15 * 60_000 })
      if (!alive) return
      setTools(r.tools)
      const a = usageAlert(r.tools, readTold(), p.alerts)
      saveTold(a.told)
      if (a.notice) setNotice(a.notice)
    }
    void read()
    const t = setInterval(() => void read(), 2 * 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [usageOn, key])

  // The notice stays 5 seconds.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  if (!p) return null
  const rings = p.readings.rings ? tools.filter((t) => t.pct != null) : []
  if (!notice && !rings.length && !cpu) return null
  return (
    <span className="sm-pill" aria-live="polite">
      {rings.map((t) => (
        <UsageRing key={t.tool} pct={t.pct} letter={t.letter} size={20} stroke={2.4} warn={p.alerts.warn} crit={p.alerts.crit} />
      ))}
      {cpu && (
        <span className="sm-pill-cpu" title="CPU and memory (every 30 s)">
          <em>CPU {cpu.cpu}%</em>
          <em>RAM {cpu.mem}%</em>
        </span>
      )}
      {/* The notice covers the pill for 5 s (the pill keeps its size). */}
      {notice && (
        <span className={`sm-notice ${notice.level}`}>
          {notice.level === 'crit' ? '⚠️ ' : ''}
          {notice.text}
        </span>
      )}
    </span>
  )
}
