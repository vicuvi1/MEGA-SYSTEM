// Tasks grouped into a calendar block ("Admin hour: meet 1, meet 2, set the
// expenses"), kept as a checklist in the block's Google Calendar notes, so
// you see it on your phone too. Pure and tested.
//   ☐ meet 1 · todoist:123
//   ☑ set the expenses · todoist:456

export interface BlockTask {
  id: string
  text: string
  done: boolean
}

const LINE = /^([☐☑])\s+(.*?)\s+·\s+todoist:([\w-]+)\s*$/

export function blockTasks(notes: string | null | undefined): BlockTask[] {
  return String(notes ?? '')
    .split('\n')
    .map((l) => LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: m[3], text: m[2], done: m[1] === '☑' }))
}

const line = (t: BlockTask) => `${t.done ? '☑' : '☐'} ${t.text.replace(/\s*·\s*todoist:.*/g, '').replace(/\n/g, ' ').slice(0, 120)} · todoist:${t.id}`

/** Adds a task to the notes' checklist (once), keeping everything else. */
export function addBlockTask(notes: string | null | undefined, t: { id: string; text: string }): string {
  const text = String(notes ?? '')
  if (blockTasks(text).some((x) => x.id === t.id)) return text
  const lines = text.split('\n').filter((l, i, all) => !(i === all.length - 1 && l.trim() === ''))
  const lastTask = lines.map((l) => LINE.test(l.trim())).lastIndexOf(true)
  const add = line({ id: t.id, text: t.text, done: false })
  if (lastTask >= 0) lines.splice(lastTask + 1, 0, add)
  else lines.push(...(lines.length && lines.some((l) => l.trim()) ? ['', 'Tasks:', add] : ['Tasks:', add]))
  return lines.join('\n')
}

export function setBlockTaskDone(notes: string, id: string, done: boolean): string {
  return notes
    .split('\n')
    .map((l) => {
      const m = LINE.exec(l.trim())
      return m && m[3] === id ? line({ id, text: m[2], done }) : l
    })
    .join('\n')
}

export function removeBlockTask(notes: string, id: string): string {
  const out = notes.split('\n').filter((l) => {
    const m = LINE.exec(l.trim())
    return !(m && m[3] === id)
  })
  // No tasks left: drop the "Tasks:" heading too.
  if (!out.some((l) => LINE.test(l.trim()))) return out.filter((l) => l.trim() !== 'Tasks:').join('\n').trim()
  return out.join('\n')
}
