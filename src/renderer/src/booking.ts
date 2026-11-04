// Booking a Todoist task into Google Calendar, the one way the app does it:
// never without Google connected, and all-or-nothing (if Todoist refuses the
// new date, the calendar block is taken back out: no orphan blocks).
import type { TodoTask } from '@core/todoist'
import { life } from './bridge'

/** The length a task books for: its own Todoist duration, else 50 minutes. */
export const bookMinutes = (t: Pick<TodoTask, 'duration'>) => (t.duration && t.duration >= 10 ? Math.min(t.duration, 240) : 50)

export async function bookTask(t: TodoTask, day: string, start: string, end: string, description = 'Todoist task · planned in Life System'): Promise<void> {
  if (!life.google) throw new Error('Connect Google Calendar in Settings to book tasks')
  const at = (hm: string) => new Date(`${day}T${hm}:00`).toISOString()
  const ev = await life.google.create({ title: t.content, start: at(start), end: at(end), description })
  if (!life.todoist?.update) return
  const minutes = Math.max(10, Math.round((Date.parse(at(end)) - Date.parse(at(start))) / 60000))
  try {
    await life.todoist.update(t.id, { due: `${day} ${start}`, duration: minutes } as any)
  } catch (e) {
    await life.google.remove(ev.calendarId, ev.id).catch(() => null)
    throw new Error(`Todoist didn't take the new time (${(e as Error).message}); the calendar block was taken back out`)
  }
}
