import { WEEKDAYS } from '@core/plan'

/** Mon..Sun toggle buttons over a weekday bitmask. */
export function WeekdayPicker({ value, onChange }: { value: number; onChange: (mask: number) => void }) {
  return (
    <div className="weekdays" role="group" aria-label="Weekdays">
      {WEEKDAYS.map((d, i) => {
        const on = (value & (1 << i)) !== 0
        return (
          <button key={d} type="button" className={`wd ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(value ^ (1 << i))}>
            {d.slice(0, 2)}
          </button>
        )
      })}
    </div>
  )
}

export function weekdayLabel(mask: number): string {
  if ((mask & 0b1111111) === 0b1111111) return 'Every day'
  if (mask === 0b0011111) return 'Weekdays'
  if (mask === 0b1100000) return 'Weekends'
  return WEEKDAYS.filter((_, i) => mask & (1 << i)).join(' ')
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
