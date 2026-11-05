// Phone health numbers (weight, steps, sleep) sent by an iOS Shortcut or an
// Android automation. Pure helpers: checking what arrived, and the daily record.

export interface HealthDay {
  steps?: number
  sleepHours?: number
  at: string
}

export interface HealthData {
  days: Record<string, HealthDay>
}

export interface HealthInput {
  day: string
  weight?: number
  steps?: number
  sleepHours?: number
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const numOf = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Checks what the phone sent. A day may be up to 14 days back (never in the
 * future); numbers must be believable. Returns the clean input or an error.
 */
export function cleanHealth(body: any, today: string): { ok: true; input: HealthInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Send JSON: {"weight"?, "steps"?, "sleepHours"?, "day"?}' }
  const day = body.day == null || body.day === '' ? today : String(body.day).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || day < addDays(today, -14)) return { ok: false, error: 'day must be YYYY-MM-DD, within the last 14 days' }
  const input: HealthInput = { day }
  const w = numOf(body.weight)
  if (body.weight != null && body.weight !== '') {
    if (w == null || w < 25 || w > 300) return { ok: false, error: 'weight must be in kg (25–300)' }
    input.weight = Math.round(w * 10) / 10
  }
  const s = numOf(body.steps)
  if (body.steps != null && body.steps !== '') {
    if (s == null || s < 0 || s > 150000) return { ok: false, error: 'steps must be 0–150000' }
    input.steps = Math.round(s)
  }
  const h = numOf(body.sleepHours)
  if (body.sleepHours != null && body.sleepHours !== '') {
    if (h == null || h < 0 || h > 24) return { ok: false, error: 'sleepHours must be 0–24' }
    input.sleepHours = Math.round(h * 10) / 10
  }
  if (input.weight == null && input.steps == null && input.sleepHours == null) return { ok: false, error: 'Nothing to save: send weight, steps or sleepHours' }
  return { ok: true, input }
}

/** Adds a day's steps/sleep (a later number for the same day replaces the earlier one); keeps 60 days. */
export function mergeDay(data: HealthData | null, input: Pick<HealthInput, 'day' | 'steps' | 'sleepHours'>, at: string): HealthData {
  const days = { ...(data?.days ?? {}) }
  const prev = days[input.day]
  days[input.day] = { ...(prev ?? {}), ...(input.steps != null ? { steps: input.steps } : {}), ...(input.sleepHours != null ? { sleepHours: input.sleepHours } : {}), at }
  const keep = Object.keys(days).sort().slice(-60)
  return { days: Object.fromEntries(keep.map((k) => [k, days[k]])) }
}

/** One line for what Ben knows: today's steps, last night's sleep and the 7-day average. */
export function healthLine(data: HealthData | null, today: string): string | null {
  if (!data) return null
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -i))
  const t = data.days[today]
  const steps = week.map((d) => data.days[d]?.steps).filter((x): x is number => x != null)
  if (!t && !steps.length) return null
  const bits: string[] = []
  if (t?.steps != null) bits.push(`${t.steps.toLocaleString('en-US')} steps today`)
  if (t?.sleepHours != null) bits.push(`slept ${t.sleepHours} h last night`)
  if (steps.length >= 2) bits.push(`7-day average ${Math.round(steps.reduce((a, b) => a + b, 0) / steps.length).toLocaleString('en-US')} steps`)
  return bits.length ? `From his phone: ${bits.join('; ')}.` : null
}

/** "steps: 8000" or "steps: 8000 | 2026-11-04". */
export function parseSteps(arg: string): { steps: number; day?: string } | null {
  const [a, b] = arg.split('|').map((x) => x.trim())
  const steps = Math.round(Number(a.replace(/[\s,.]/g, '')))
  if (!Number.isFinite(steps) || steps <= 0 || steps > 150000) return null
  if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  return b ? { steps, day: b } : { steps }
}
