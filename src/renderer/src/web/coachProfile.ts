// "What I know about you": everything the coach knows, in one view, read
// from this device's copy (instant). Edited through the coach bridge.
import { REMINDERS, type Reminder } from '@core/coachKit'
import { COACH_HISTORY, cleanHistory } from '@core/coachImpact'
import { findPatterns, type CoachMind } from '@core/coachMind'
import { addDays } from '@core/dates'
import { financeSpending } from '@core/progress'
import { getSetting } from '../../../main/settings'
import { financeStateFrom, loadLetters, loadMind, type Letter } from './botBrain'
import type { Services } from './webServices'

export interface ProfileView {
  mind: CoachMind
  /** What his own last 8 weeks show (found from the data, not guessed). */
  dataPatterns: string[]
  promises: { text: string; at: string; state: 'kept' | 'broken' | 'ignored' | 'answered' | 'open' }[]
  wins: { day: string; text: string }[]
  letters: Letter[]
}

export function profileView(s: Services, now = new Date()): ProfileView {
  const db = s.db
  const today = s.wallet.today(now)
  let reminders: Reminder[] = []
  try {
    reminders = JSON.parse(getSetting(db, REMINDERS) || '[]')
  } catch {
    reminders = []
  }
  const promises = reminders
    .filter((r) => r.kind === 'checkin' && Date.parse(r.createdAt) > now.getTime() - 14 * 86400000)
    .reverse()
    .map((r) => ({ text: r.text, at: r.createdAt, state: (r.outcome ?? (r.ignored ? 'ignored' : r.answeredAt ? 'answered' : 'open')) as ProfileView['promises'][number]['state'] }))
  const input = s.progress.input(financeSpending(financeStateFrom(db, null)), now, 60)
  let logs: any[] = []
  try {
    logs = s.sleep.logs()
  } catch {
    logs = []
  }
  const dataPatterns = findPatterns({
    today,
    focus: input.focus,
    sleep: logs.map((l) => ({ day: l.day, onTime: !!l.onTime, bedOnTime: l.bedOnTime ?? null, quality: l.quality ?? null })),
    workouts: input.workouts,
    spending: input.spending
  })
  // Wins: the best scored days, and the best focus day of the last 30.
  let hist = cleanHistory(null)
  try {
    hist = cleanHistory(JSON.parse(getSetting(db, COACH_HISTORY) || 'null'))
  } catch {
    /* none yet */
  }
  const wins: ProfileView['wins'] = Object.entries(hist.days)
    .filter(([, d]) => (d.score ?? 0) >= 70)
    .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))
    .slice(0, 4)
    .map(([day, d]) => ({ day, text: `Day score ${d.score}/100${d.mustdos ? ` · ${d.mustdos[0]}/${d.mustdos[1]} must-dos` : ''}${d.kept ? ` · ${d.kept} promise${d.kept === 1 ? '' : 's'} kept` : ''}` }))
  const byDay = new Map<string, number>()
  for (const f of input.focus) if (f.day >= addDays(today, -30)) byDay.set(f.day, (byDay.get(f.day) ?? 0) + f.minutes)
  const best = [...byDay].sort((a, b) => b[1] - a[1])[0]
  if (best && best[1] >= 60) wins.unshift({ day: best[0], text: `Best focus day this month: ${Math.floor(best[1] / 60)}h ${best[1] % 60}m` })
  return { mind: loadMind(db), dataPatterns, promises, wins: wins.slice(0, 5), letters: loadLetters(db) }
}
