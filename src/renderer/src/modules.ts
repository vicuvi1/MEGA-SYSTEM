import type { IconName } from './Icon'

export type PageId =
  | 'today' | 'focus' | 'progress' | 'goals' | 'calendar' | 'coach' | 'tasks' | 'schedule' | 'sleep' | 'discipline' | 'body' | 'money' | 'shop' | 'journey'
  | 'history' | 'rules' | 'connected' | 'settings' | 'bots' | 'notebook'

export interface ModuleDef {
  id: PageId
  label: string
  icon: IconName
  color: string
  /** Phase from the build plan; 0 means ready now. */
  phase: number
  blurb: string
}

// The sidebar is built from this list; a new section is one entry plus its page.
export const MODULES: ModuleDef[] = [
  { id: 'today', label: 'Today', icon: 'home', color: 'var(--lime)', phase: 0, blurb: 'Your day at a glance' },
  { id: 'coach', label: 'Coach', icon: 'spark', color: 'var(--lime)', phase: 0, blurb: 'Talk to your coach; your goals, rules and what it remembers' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', color: '#B892FF', phase: 0, blurb: 'Your Google Calendar and timed tasks, by week or day' },
  { id: 'goals', label: 'Goals', icon: 'trophy', color: 'var(--lime)', phase: 0, blurb: 'Every goal in one list: deadline, hours left, this week, today, and your cyber security path' },
  { id: 'progress', label: 'Insights', icon: 'chart', color: 'var(--lime)', phase: 0, blurb: 'Am I improving? Week score, streaks, your year and focus goals' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', color: '#7CC4FF', phase: 0, blurb: 'Your Todoist, by area' },
  { id: 'sleep', label: 'Sleep', icon: 'moon', color: '#6EE7D8', phase: 0, blurb: 'Wake-ups and bedtimes from Waky' },
  { id: 'discipline', label: 'Discipline', icon: 'shield', color: '#FF8A3D', phase: 0, blurb: 'Private streak, urge crusher and honest resets' },
  { id: 'body', label: 'Sport Track', icon: 'bolt', color: '#00F2FE', phase: 0, blurb: 'Workouts and body metrics' },
  { id: 'money', label: 'Money', icon: 'coin', color: '#F5C84B', phase: 0, blurb: 'Your money, from Finance Helper' },
  { id: 'shop', label: 'Rewards', icon: 'gift', color: '#F5C84B', phase: 0, blurb: 'Spend your points: guilt-free fun time and real rewards' },
]

export const SYSTEM_PAGES: ModuleDef[] = [
  { id: 'notebook', label: 'Notebook', icon: 'book', color: 'var(--lime)', phase: 0, blurb: 'Your notes and Ben\'s: what he knows about you, your journal' },
  { id: 'history', label: 'History', icon: 'list', color: 'var(--muted)', phase: 0, blurb: 'Every point in and out' },
  { id: 'connected', label: 'Connected apps', icon: 'link', color: 'var(--muted)', phase: 0, blurb: 'Waky, Finance Helper and MAN' },
  { id: 'bots', label: 'Telegram bots', icon: 'bot', color: '#00D2FF', phase: 0, blurb: 'Your Telegram bots: Mega, Finance and Waky' },
  { id: 'settings', label: 'Settings', icon: 'gear', color: 'var(--muted)', phase: 0, blurb: 'PIN, bots, connections, backups and look' }
]

export const MODULE_LABEL: Record<string, string> = {
  sleep: 'Sleep', schedule: 'Schedule', quests: 'Quests', discipline: 'Discipline', body: 'Body', tasks: 'Tasks', money: 'Money', shop: 'Shop'
}

/** A section name for any module: known ones by name, others readable, never a stray code like "x". */
export function moduleLabel(m: string | null | undefined): string {
  const k = String(m ?? '').trim()
  if (MODULE_LABEL[k]) return MODULE_LABEL[k]
  if (k.length < 3 || !/^[a-z][a-z0-9_.-]*$/i.test(k)) return 'Other'
  const words = k.replace(/[_.-]+/g, ' ')
  return words[0].toUpperCase() + words.slice(1)
}
