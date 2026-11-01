import { describe, expect, it } from 'vitest'
import { cleanupPrompt, localCleanup, parseCleanup } from './todoistClean'
import type { Area, TodoTask } from './todoist'

const areas: Area[] = [
  { key: 's:1', name: '🎓 University', kind: 'section', id: '1', projectId: 'in' },
  { key: 's:2', name: '🛡️ Cyber', kind: 'section', id: '2', projectId: 'in' },
  { key: 'p:in', name: 'Inbox', kind: 'project', id: 'in', projectId: 'in' }
]
const task = (id: string, content: string, over: Partial<TodoTask> = {}): TodoTask => ({ id, content, priority: 1, due: null, dueTime: null, project: 'Inbox', recurring: false, projectId: 'in', sectionId: null, ...over })
const tasks = [task('a', 'lern rust ownrship'), task('b', 'URGENT fix report tables, also the contents page must be bold says the tutor', { sectionId: '1', priority: 1 }), task('c', 'learn rust ownership', { sectionId: '2' }), task('d', 'water plants', { recurring: true, due: '2026-09-01' })]

describe('todoist clean-up', () => {
  it('numbers tasks in the prompt and lists the areas', () => {
    const p = cleanupPrompt(tasks, areas, '2026-11-01')
    expect(p).toContain('Areas: University, Cyber, Inbox')
    expect(p).toContain('"i":0,"t":"lern rust ownrship","a":"Inbox","p":"P4"')
    expect(p).not.toContain('"id"') // Todoist ids never leak
  })

  it('parses and checks the model answer', () => {
    const text = '```json\n{"changes":[{"i":0,"title":"Learn Rust ownership","area":"Cyber","why":"typos; it is cyber"},{"i":1,"title":"Fix report tables","details":"Make the contents page bold (tutor)","priority":"P1","why":"shorter"},{"i":2,"remove":"duplicate","dup":0,"why":"same as 0"},{"i":3,"due":"tomorrow","why":"late"},{"i":9,"title":"ghost"},{"i":1,"title":"again"}]}\n```'
    const c = parseCleanup(text, tasks, areas)
    expect(c).toHaveLength(3)
    expect(c[0]).toMatchObject({ id: 'a', title: 'Learn Rust ownership', area: 's:2' })
    expect(c[1]).toMatchObject({ id: 'b', title: 'Fix report tables', details: 'Make the contents page bold (tutor)', priority: 4 })
    expect(c[2]).toMatchObject({ id: 'c', remove: 'duplicate', duplicateOf: 'lern rust ownrship' })
    // a repeating task's date is never changed, so its change is empty and dropped
    expect(c.find((x) => x.id === 'd')).toBeUndefined()
  })

  it('survives junk', () => {
    expect(parseCleanup('sorry, no', tasks, areas)).toEqual([])
    expect(parseCleanup('{"changes":[{"i":0}]}', tasks, areas)).toEqual([])
  })

  it('finds exact duplicates and long-overdue tasks without AI', () => {
    const c = localCleanup([task('x', 'Call mom'), task('y', 'call  MOM!'), task('z', 'old thing', { due: '2026-09-01' }), task('w', 'recent', { due: '2026-10-25' })], '2026-11-01')
    expect(c).toEqual([
      { id: 'y', before: 'call  MOM!', remove: 'duplicate', duplicateOf: 'Call mom', why: 'Same task twice' },
      { id: 'z', before: 'old thing', due: 'no date', why: 'Overdue since 2026-09-01: give it a real date or drop it' }
    ])
  })
})
