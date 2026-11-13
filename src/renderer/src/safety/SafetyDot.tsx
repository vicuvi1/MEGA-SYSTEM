// Today: a small red dot next to the title, only when something about your
// backups is red (2026-11-12). It opens Settings → Data safety. Nothing shows
// while everything is fine, so it never takes room.
import { useEffect, useState } from 'react'
import { loadSafety, onSafety } from './safetyState'

export function SafetyDot({ onOpen }: { onOpen: () => void }) {
  const [red, setRed] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    const check = () =>
      void loadSafety()
        .then((s) => live && setRed(s.red ? s.rows.filter((r) => r.light === 'red').map((r) => r.label) : null))
        .catch(() => {})
    const first = window.setTimeout(check, 3000)
    const t = window.setInterval(check, 60 * 60_000)
    const off = onSafety((s) => setRed(s.red ? s.rows.filter((r) => r.light === 'red').map((r) => r.label) : null))
    return () => {
      live = false
      clearTimeout(first)
      clearInterval(t)
      off()
    }
  }, [])
  if (!red) return null
  return <button type="button" className="safety-dot" data-testid="safety-dot" aria-label={`Your data needs a look (${red.join(', ')}): open Data safety`} title={`${red.join(', ')}: open Settings → Data safety`} onClick={onOpen} />
}
