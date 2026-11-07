// Small shared pieces of the Career page: a ring, a stat tile, lei, dates,
// and saving a file from text.
import type { ReactNode } from 'react'
import type { CareerView } from '../web/career'

export type Run = (fn: () => Promise<CareerView>, success?: string) => Promise<void>

export const lei = (n: number) => `${Math.round(n).toLocaleString('en-US')} lei`
export const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min} min`)

export function CrRing({ pct, size = 84, stroke = 8, tone = 'good', children }: { pct: number | null; size?: number; stroke?: number; tone?: 'good' | 'warn' | 'calm' | 'gold'; children?: ReactNode }) {
  const r = (size - stroke) / 2 - 1
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct ?? 0))
  return (
    <div className={`cr-ring t-${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="bg" strokeWidth={stroke} />
        {p > 0 && <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeWidth={stroke} strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <div className="cr-ring-in">{children}</div>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className={`cr-stat${tone ? ` ${tone}` : ''}`}>
      <small>{label}</small>
      <b>{value}</b>
      {sub != null && <span>{sub}</span>}
    </div>
  )
}

/** Saves text as a file (markdown, a page) on this device. */
export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cr-empty">
      <b>{title}</b>
      {children && <small>{children}</small>}
    </div>
  )
}
