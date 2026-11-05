// Small helpers the Today list shares (LT11: split out of DayFlow.tsx).
import { calendarDay } from '@core/dates'
import type { TodoTask } from '@core/todoist'

/** A short subject for the focus stats: the first words of a must-do. */
export const subjectOf = (text: string) => text.split(/\s+/).slice(0, 3).join(' ').slice(0, 40)

/** A Todoist task's area (its section or project, without the emoji), else its first words. */
export const todoSubject = (t: TodoTask) => {
  const area = (t.section || (t.project !== 'Inbox' ? t.project : '') || '').replace(/[^\p{L}\p{N}&\s-]/gu, '').trim()
  return area || subjectOf(t.content)
}

export const pad = (n: number) => String(n).padStart(2, '0')

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

export const tomorrowOf = (day: string) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return calendarDay(d)
}

export const storeGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

export const storeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // private window: the mode just shows again
  }
}
