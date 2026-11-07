// Page tabs (the one switch long pages use): which tab to show, deep links
// from the address bar, and the tabs Ctrl+K can open directly. Pure, no DOM.

/** Where this device remembers a page's last tab. */
export const tabKey = (page: string) => `ls.tab.${page}`

/** The tab to show: the one asked for when it is offered now, else the fallback, else the first. */
export function pickTab(want: string | null | undefined, ids: string[], fallback?: string): string {
  if (want && ids.includes(want)) return want
  if (fallback && ids.includes(fallback)) return fallback
  return ids[0] ?? ''
}

/** ?tab=body (with ?page=today, or no page: Today) opens that tab once. */
export function tabFromUrl(search: string, page: string): string | null {
  const q = new URLSearchParams(search)
  const tab = q.get('tab')
  if (!tab || !/^[a-z0-9-]{1,24}$/.test(tab)) return null
  return (q.get('page') ?? 'today') === page ? tab : null
}

export interface TabLink {
  page: string
  tab: string
  /** What Ctrl+K shows (and searches). */
  label: string
  hint: string
}

/**
 * Tabs worth reaching straight from Ctrl+K: type "water" and Today opens on
 * Body. The pages that own these tabs must offer the same ids (a test checks).
 */
export const TAB_LINKS: TabLink[] = [
  { page: 'today', tab: 'now', label: 'Today: now and must-dos', hint: "Today → Now: what's on, must-dos, habits" },
  { page: 'today', tab: 'plan', label: "Ben's plan for today", hint: 'Today → Plan: blocks and must-dos to approve' },
  { page: 'today', tab: 'tasks', label: "Today's tasks", hint: 'Today → Tasks: everything else today and coming up' },
  { page: 'today', tab: 'body', label: 'Water, reps and sleep', hint: 'Today → Body: reps, water, sleep, healthy day' },
  { page: 'today', tab: 'week', label: 'This week and week score', hint: 'Today → Week: focus chart, week score, quick log' },
  { page: 'progress', tab: 'areas', label: 'Insights: each area', hint: 'Insights → Areas: focus, wake-ups, workouts, spent…' },
  { page: 'progress', tab: 'streaks', label: 'Streaks and your year', hint: 'Insights → Streaks: records, milestones, the year map' },
  { page: 'progress', tab: 'focus', label: 'Focus this week', hint: 'Insights → Focus: hours by subject, goals with a deadline' },
  { page: 'progress', tab: 'look', label: 'Month and year review', hint: 'Insights → Look back' },
  { page: 'goals', tab: 'hours', label: 'Hours to put in', hint: "Goals → Hours: hour goals and this week's big 3" },
  { page: 'goals', tab: 'path', label: 'Cyber security path', hint: 'Goals → Path: CTFs, Rust, crypto' },
  { page: 'season', tab: 'vision', label: 'Vision board and word of the year', hint: 'Season → Vision' },
  { page: 'season', tab: 'identity', label: 'Identity votes: who I am becoming', hint: 'Season → Identity' },
  { page: 'season', tab: 'wins', label: 'Wins wall', hint: 'Season → Wins: your proof, kind deeds, nice messages' },
  { page: 'season', tab: 'adventures', label: 'Side quest and adventures', hint: "Season → Adventures: this week's side quest" },
  { page: 'season', tab: 'wheel', label: 'Life wheel', hint: 'Season → Life wheel: rate the quarter' },
  { page: 'money', tab: 'month', label: 'Where money goes', hint: 'Money → Month: categories and forecast' },
  { page: 'money', tab: 'goals', label: 'Savings goals and fun budget', hint: 'Money → Goals' },
  { page: 'music', tab: 'library', label: 'Music stations and favourites', hint: 'Music → Library' },
  { page: 'shop', tab: 'earn', label: 'Daily quests and badges', hint: 'Rewards → Earn: where points came from, quests, challenge, badges' },
  { page: 'shop', tab: 'unlock', label: 'Rewards you unlock by doing', hint: 'Rewards → Unlock by doing: streaks, focus hours, nights on time' }
]
