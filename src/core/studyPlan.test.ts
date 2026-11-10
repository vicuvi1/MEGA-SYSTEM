import { describe, expect, it } from 'vitest'
import { isStudyTask, parseLength, parseQuickAdd, pomosByBlock, quickAddBlock, todoistBlocks, todoistChoices, tomatoDots } from './studyPlan'
import { applyStudyOp, cleanStore, nextDue, reorderBlocks, saveBlock, type StudySession } from './studyTime'

const NOW = new Date(2026, 10, 13, 10, 0) // Fri 13 Nov 2026
const today = '2026-11-13'
const base = () => {
  let s = cleanStore(null)
  s = saveBlock(s, { id: 'a', name: 'Algebra', category: 'Math', tags: [], plannedMin: 50 }, NOW)
  s = saveBlock(s, { id: 'b', name: 'Essay', category: 'English', tags: [], plannedMin: null }, NOW)
  return s
}

describe('the quick add bar', () => {
  it('reads "Math lab 4 50m #practice tomorrow" into name, length, tags and day', () => {
    const q = parseQuickAdd('Math lab 4 50m #practice tomorrow', today, base())
    expect(q).toMatchObject({ name: 'Math lab 4', plannedMin: 50, tags: ['practice'], due: '2026-11-14', category: 'Math' })
    expect(q.parts.map((p) => p.kind)).toEqual(['length', 'tag', 'day', 'category'])
  })
  it('lengths, pomodoros, subjects, quick, repeats and days in many ways', () => {
    expect(parseLength('1h30')).toBe(90)
    expect(parseLength('1.5h')).toBe(90)
    expect(parseLength('45min')).toBe(45)
    expect(parseLength('lab')).toBeNull()
    expect(parseQuickAdd('Read 90 min', today).plannedMin).toBe(90)
    expect(parseQuickAdd('Essay draft 3p @English *', today, base())).toMatchObject({ name: 'Essay draft', estPomos: 3, category: 'English', quick: true })
    expect(parseQuickAdd('Vocab 15m daily', today)).toMatchObject({ name: 'Vocab', repeat: 'daily' })
    expect(parseQuickAdd('Lab report every monday', today)).toMatchObject({ name: 'Lab report', repeat: 'weekly', due: '2026-11-16' })
    expect(parseQuickAdd('Review weekdays', today).repeat).toBe('weekdays')
    expect(parseQuickAdd('Quiz prep wed', today).due).toBe('2026-11-18')
    expect(parseQuickAdd('Quiz prep friday', today).due).toBe(today)
    expect(parseQuickAdd('Project next week', today).due).toBe('2026-11-16')
    expect(parseQuickAdd('Project in 3 days', today).due).toBe('2026-11-16')
    expect(parseQuickAdd('Mock 2026-12-01', today).due).toBe('2026-12-01')
    // An upper-case word is a name, not a day ("SAT prep").
    expect(parseQuickAdd('SAT prep 2 pomos', today)).toMatchObject({ name: 'SAT prep', due: null, estPomos: 2 })
    expect(parseQuickAdd('@new_subject Notes', today).category).toBe('new subject')
  })
  it('the block it makes: pomodoros from the length, or the length from pomodoros', () => {
    const s = base()
    expect(quickAddBlock(parseQuickAdd('Proofs 50m', today), 'x', s)).toMatchObject({ plannedMin: 50, estPomos: 2 })
    expect(quickAddBlock(parseQuickAdd('Proofs 3p', today), 'x', s)).toMatchObject({ plannedMin: 75, estPomos: 3 })
    const up = applyStudyOp(s, { op: 'prefs', prefs: { mode: 'up' } }, NOW)
    expect(quickAddBlock(parseQuickAdd('Proofs 50m', today), 'x', up)).toMatchObject({ plannedMin: 50, estPomos: null })
  })
})

describe('repeat, order and the tomato dots', () => {
  it('a repeating block moves to its next day when done', () => {
    expect(nextDue('2026-11-13', 'daily', today)).toBe('2026-11-14')
    expect(nextDue('2026-11-13', 'weekdays', today)).toBe('2026-11-16') // Fri → Mon
    expect(nextDue('2026-11-10', 'weekly', today)).toBe('2026-11-17')
    expect(nextDue(null, 'weekly', today)).toBe('2026-11-20')
    let s = saveBlock(base(), { id: 'r', name: 'Vocab', repeat: 'daily', due: '2026-11-12' }, NOW)
    s = applyStudyOp(s, { op: 'done', id: 'r', done: true }, NOW, today)
    expect(s.blocks.find((b) => b.id === 'r')).toMatchObject({ done: false, due: '2026-11-14', lastDone: today })
  })
  it('drag to reorder: the moved blocks take the places they had; others stay', () => {
    let s = saveBlock(base(), { id: 'c', name: 'Chem' }, NOW)
    s = saveBlock(s, { id: 'd', name: 'Done one', done: true }, NOW)
    expect(reorderBlocks(s.blocks, ['c', 'a', 'b']).map((b) => b.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(reorderBlocks(s.blocks, ['b', 'a']).map((b) => b.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(applyStudyOp(s, { op: 'reorder', ids: ['zzz', 'c', 'a'] }, NOW).blocks.map((b) => b.id)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('pomodoros done per block: counted ones, else whole pomodoros of the minutes', () => {
    const s = base()
    const ses = (blockId: string, minutes: number, pomos?: number): StudySession => ({ id: 1, day: today, blockId, subject: '', minutes, breakMin: 0, startedAt: '', endedAt: '', source: 'timer', ...(pomos ? { pomos } : {}) })
    const m = pomosByBlock([ses('a', 60), ses('a', 50, 2), ses('b', 10)], s)
    expect(m.get('a')).toBe(4)
    expect(m.has('b')).toBe(false)
    expect(tomatoDots(4, 1)).toEqual({ done: 1, left: 3, extra: 0 })
    expect(tomatoDots(2, 5)).toEqual({ done: 5, left: 0, extra: 0 })
    expect(tomatoDots(null, 0)).toEqual({ done: 0, left: 0, extra: 0 })
  })
})

describe('Todoist study tasks as blocks', () => {
  const tasks = [
    { id: '1', content: 'Physics sheet 3', due: '2026-11-14', project: 'University', section: 'Physics', labels: ['exam'], duration: 45 },
    { id: '2', content: 'Flashcards', due: null, project: 'Inbox', labels: ['study'] },
    { id: '3', content: 'Buy milk', due: null, project: 'Home', labels: [] }
  ]
  it('picks tasks by project or label; nothing without a choice', () => {
    expect(isStudyTask(tasks[0], { projects: ['university'], labels: [] })).toBe(true)
    expect(isStudyTask(tasks[1], { projects: [], labels: ['study'] })).toBe(true)
    expect(isStudyTask(tasks[2], { projects: ['university'], labels: ['study'] })).toBe(false)
    expect(todoistBlocks(base(), tasks, NOW).blocks).toHaveLength(2)
    expect(todoistChoices(tasks)).toEqual({ projects: ['Home', 'Inbox', 'University'], labels: ['exam', 'study'] })
  })
  it('new tasks become linked blocks; renamed ones follow; a task done in Todoist is done here', () => {
    const s = applyStudyOp(base(), { op: 'prefs', prefs: { todoist: { projects: ['University'], labels: ['@Study'] } } }, NOW)
    const a = todoistBlocks(s, tasks, NOW)
    expect(a.blocks.filter((b) => b.fromTodoist).map((b) => [b.name, b.category, b.tags.join(','), b.plannedMin, b.due])).toEqual([
      ['Physics sheet 3', 'Physics', 'exam', 45, '2026-11-14'],
      ['Flashcards', 'Inbox', '', null, null]
    ])
    const b = todoistBlocks(a, [{ ...tasks[0], content: 'Physics sheet 3 (all)', due: '2026-11-15' }], NOW)
    expect(b.blocks.find((x) => x.taskId === '1')).toMatchObject({ name: 'Physics sheet 3 (all)', due: '2026-11-15', done: false })
    expect(b.blocks.find((x) => x.taskId === '2')!.done).toBe(true)
    // A recurring task back open with a new day opens its block again.
    const c = applyStudyOp(b, { op: 'done', id: 'td-1', done: true }, NOW)
    const d = todoistBlocks(c, [{ ...tasks[0], recurring: true, due: '2026-11-22' }], NOW)
    expect(d.blocks.find((x) => x.taskId === '1')).toMatchObject({ done: false, due: '2026-11-22' })
  })
})
