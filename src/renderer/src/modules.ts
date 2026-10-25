import type { IconName } from './Icon'

export type PageId =
  | 'today' | 'tasks' | 'schedule' | 'sleep' | 'discipline' | 'body' | 'money' | 'shop' | 'journey'
  | 'history' | 'rules' | 'connected' | 'settings'

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
  { id: 'tasks', label: 'Tasks', icon: 'check', color: '#7CC4FF', phase: 0, blurb: 'To-dos by category: Body, Face, Finance, University, Life' },
  { id: 'schedule', label: 'Schedule', icon: 'calendar', color: '#B892FF', phase: 0, blurb: 'Day timeline with study blocks that pay out or cost coins' },
  { id: 'sleep', label: 'Sleep', icon: 'moon', color: '#6EE7D8', phase: 0, blurb: 'Wake-ups and bedtimes from Waky' },
  { id: 'discipline', label: 'Discipline', icon: 'shield', color: '#FF8A3D', phase: 0, blurb: 'Private streak, urge crusher and honest resets' },
  { id: 'body', label: 'Body', icon: 'bolt', color: '#FF6B8B', phase: 5, blurb: 'Workouts and body logs' },
  { id: 'money', label: 'Money', icon: 'coin', color: '#F5C84B', phase: 0, blurb: 'Daily spending from Finance Helper, turned into coins' },
  { id: 'shop', label: 'Shop', icon: 'gift', color: '#F5C84B', phase: 0, blurb: 'Spend coins on real rewards, inside a real-money budget' },
  { id: 'journey', label: 'Journey', icon: 'trophy', color: 'var(--lime)', phase: 6, blurb: 'Levels, ranks and weekly recaps' }
]

export const SYSTEM_PAGES: ModuleDef[] = [
  { id: 'history', label: 'History', icon: 'list', color: 'var(--muted)', phase: 0, blurb: 'Every coin in and out' },
  { id: 'rules', label: 'Point rules', icon: 'sliders', color: 'var(--muted)', phase: 0, blurb: 'What earns and what costs' },
  { id: 'connected', label: 'Connected apps', icon: 'link', color: 'var(--muted)', phase: 0, blurb: 'Waky, Finance Helper and MAN' },
  { id: 'settings', label: 'Settings', icon: 'gear', color: 'var(--muted)', phase: 0, blurb: 'PIN and backups' }
]

export const MODULE_LABEL: Record<string, string> = {
  sleep: 'Sleep', schedule: 'Schedule', discipline: 'Discipline', body: 'Body', tasks: 'Tasks', money: 'Money', shop: 'Shop'
}
