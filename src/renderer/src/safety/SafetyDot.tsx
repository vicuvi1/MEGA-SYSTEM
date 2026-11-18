// Today: a small dot next to the title, only when something about your data
// needs a look (2026-11-12): red when a backup is red or a store of data is
// nearly full, amber when one passed its warning level (Data center,
// 2026-11-18). It opens the Data center. Nothing shows while everything is
// fine, so it never takes room.
import { useEffect, useState } from 'react'
import { warningLine, type Meter } from '@core/dataCenter'
import { quickWarnings } from '../datacenter/usage'
import { loadSafety, onSafety, type SafetyState } from './safetyState'

const redOf = (s: SafetyState) => (s.red ? s.rows.filter((r) => r.light === 'red').map((r) => r.label) : [])

export function SafetyDot({ onOpen }: { onOpen: () => void }) {
  const [red, setRed] = useState<string[]>([])
  const [full, setFull] = useState<Meter[]>([])
  useEffect(() => {
    let live = true
    const check = () => {
      void loadSafety()
        .then((s) => live && setRed(redOf(s)))
        .catch(() => {})
      void quickWarnings()
        .then((w) => live && setFull(w))
        .catch(() => {})
    }
    const first = window.setTimeout(check, 3000)
    const t = window.setInterval(check, 60 * 60_000)
    const off = onSafety((s) => setRed(redOf(s)))
    return () => {
      live = false
      clearTimeout(first)
      clearInterval(t)
      off()
    }
  }, [])
  if (!red.length && !full.length) return null
  const why = [...red, ...full.map(warningLine)].join(', ')
  const level = red.length || full.some((m) => m.level === 'red') ? 'red' : 'warn'
  return <button type="button" className={`safety-dot ${level}`} data-testid="safety-dot" data-level={level} aria-label={`Your data needs a look (${why}): open the Data center`} title={`${why}: open the Data center`} onClick={onOpen} />
}
