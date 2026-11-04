import { describe, expect, it } from 'vitest'
import { addBlockTask, blockTasks, removeBlockTask, setBlockTaskDone } from './blockTasks'

describe('tasks grouped into a calendar block', () => {
  it('adds once, keeps your notes, ticks and removes', () => {
    let n = addBlockTask('Bring the laptop', { id: '123', text: 'meet 1' })
    n = addBlockTask(n, { id: '456', text: 'set the expenses' })
    n = addBlockTask(n, { id: '123', text: 'meet 1' })
    expect(n).toBe('Bring the laptop\n\nTasks:\n☐ meet 1 · todoist:123\n☐ set the expenses · todoist:456')
    expect(blockTasks(n)).toEqual([
      { id: '123', text: 'meet 1', done: false },
      { id: '456', text: 'set the expenses', done: false }
    ])
    n = setBlockTaskDone(n, '456', true)
    expect(blockTasks(n)[1].done).toBe(true)
    n = removeBlockTask(n, '123')
    expect(blockTasks(n).map((t) => t.id)).toEqual(['456'])
    expect(removeBlockTask(n, '456')).toBe('Bring the laptop')
  })
  it('empty notes, and notes without tasks', () => {
    expect(addBlockTask(null, { id: '1', text: 'a' })).toBe('Tasks:\n☐ a · todoist:1')
    expect(blockTasks('just notes\n• not a task')).toEqual([])
  })
})
