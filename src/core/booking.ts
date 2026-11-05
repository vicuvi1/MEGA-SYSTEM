// How long a task books for, the same everywhere (Today, the calendar, the
// island, the strips): its own Todoist duration (10–240 min), else 50 minutes.
export const DEFAULT_TASK_MIN = 50

export const bookMinutes = (t: { duration?: number | null }): number => (t.duration && t.duration >= 10 ? Math.min(t.duration, 240) : DEFAULT_TASK_MIN)
