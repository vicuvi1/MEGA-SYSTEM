// LT4: one "what day is it" everywhere. The app day turns at 04:00 (dayKey);
// the calendar date turns at midnight (calendarDay). Nothing else in src/
// builds a YYYY-MM-DD by hand, so the two can't drift apart again.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calendarDay, dayKey } from './dates'

describe('dayKey and calendarDay', () => {
  it('the app day turns at 04:00, the calendar date at midnight', () => {
    const late = new Date('2026-03-10T01:30:00Z')
    expect(dayKey(late, 'UTC')).toBe('2026-03-09')
    expect(calendarDay(late, 'UTC')).toBe('2026-03-10')
    expect(dayKey(new Date('2026-03-10T04:00:00Z'), 'UTC')).toBe('2026-03-10')
  })
  it('a time zone given explicitly wins over the machine clock', () => {
    // 22:30 UTC is already 00:30 the next day in Chisinau (UTC+2 in March).
    const at = new Date('2026-03-09T22:30:00Z')
    expect(calendarDay(at, 'Europe/Chisinau')).toBe('2026-03-10')
    expect(dayKey(at, 'Europe/Chisinau')).toBe('2026-03-09')
    expect(calendarDay(at, 'UTC')).toBe('2026-03-09')
  })
  it('takes an ISO string too', () => {
    expect(calendarDay('2026-07-01T12:00:00Z', 'UTC')).toBe('2026-07-01')
  })
  it('with no zone it follows the local clock, even one changed at runtime (the server sets TZ per request)', () => {
    const before = process.env.TZ
    try {
      const at = new Date('2026-03-09T22:30:00Z')
      process.env.TZ = 'UTC'
      expect(calendarDay(at)).toBe('2026-03-09')
      process.env.TZ = 'Europe/Chisinau'
      expect(calendarDay(at)).toBe('2026-03-10')
      expect(dayKey(at)).toBe('2026-03-09')
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })
})

const SRC = join(__dirname, '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

// Truly needed exceptions. Keep this short and say why.
const ALLOW: Record<string, string> = {
  // Local date-TIME strings ("YYYY-MM-DDTHH:MM", with an offset for Google), not a day.
  'server/benEval.ts': 'local date-time for the eval checks',
  'server/googleCalendar.ts': 'local date-time with offset for the Google API'
}

describe('one way to get a day (LT4)', () => {
  const files = walk(SRC).filter((f) => !f.endsWith(join('core', 'dates.ts')))
  it("no toLocaleDateString('sv-SE') (it turns at midnight and hides which day you meant)", () => {
    const bad = files.filter((f) => readFileSync(f, 'utf8').includes("'sv-SE'")).map((f) => relative(SRC, f))
    expect(bad, 'use dayKey (app day, 04:00) or calendarDay (midnight) from src/core/dates.ts').toEqual([])
  })
  it('no YYYY-MM-DD built by hand from getMonth() + 1', () => {
    const re = /getMonth\(\)\s*\+\s*1\)\.padStart|\bp(?:ad)?\(\w+\.getMonth\(\)\s*\+\s*1\)/
    const bad = files.map((f) => relative(SRC, f).split('\\').join('/')).filter((f) => !ALLOW[f] && re.test(readFileSync(join(SRC, f), 'utf8')))
    expect(bad, 'use dayKey or calendarDay from src/core/dates.ts').toEqual([])
  })
})
