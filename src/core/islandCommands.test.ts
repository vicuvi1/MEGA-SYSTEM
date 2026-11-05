import { describe, expect, it } from 'vitest'
import { activities, DEFAULT_ISLAND_PREFS, EMPTY_ISLAND, type IslandSnapshot } from './islandModel'
import {
  applyExpected, canUndo, classifyDrop, commandPreview, DROP_MAX_BYTES, expectPatch, keyMove, menuFor, moveChoice, quickButtons, ringItems, ringLayout, ringPick,
  settleExpected, timerAdjust, typingFade, waterPick, wheelSteps, type PreviewCtx
} from './islandCommands'

const NOW = new Date(2026, 10, 4, 10, 0).getTime()
const MIN = 60_000
const chips = DEFAULT_ISLAND_PREFS.chips
const snap = (p: Partial<IslandSnapshot> = {}): IslandSnapshot => ({
  ...EMPTY_ISLAND,
  at: NOW,
  locked: false,
  mustdos: [{ i: 0, text: 'Call the bank', done: false }],
  water: { ml: 500, target: 2000 },
  reps: [{ id: 'push', name: 'Pushups', done: 10, target: 50 }],
  ...p
})
const run = { subject: 'Essay', startedAt: NOW - 5 * MIN, endsAt: NOW + 20 * MIN }

describe('IC1: quick buttons for the live thing', () => {
  it('timer: pause, +5, done; paused: resume', () => {
    const s = snap({ running: run })
    const a = activities(s, NOW)[0]
    expect(quickButtons(a, s, chips, NOW).map((b) => b.action.kind)).toEqual(['pause', 'extend', 'stop'])
    const p = snap({ running: { ...run, pausedAt: NOW - MIN } })
    const b = quickButtons(activities(p, NOW)[0], p, chips, NOW)
    expect(b[0].action.kind).toBe('resume')
    expect(b[0].primary).toBe(true)
  })
  it('a break: skip it or +5', () => {
    const s = snap({ running: { ...run, brk: true, next: { subject: 'Math', minutes: 50 } } })
    const b = quickButtons(activities(s, NOW)[0], s, chips, NOW)
    expect(b.map((x) => x.label)).toEqual(['▶ Math', '+5', '⏹ End'])
    expect(b[0].action).toEqual({ kind: 'start', subject: 'Math', minutes: 50, flow: true })
  })
  it('water: your first two amounts', () => {
    const s = snap()
    const a = activities(s, NOW).find((x) => x.kind === 'water')!
    expect(quickButtons(a, s, chips, NOW).map((b) => b.action)).toEqual([{ kind: 'water', ml: 250 }, { kind: 'water', ml: 500 }])
  })
  it('must-do: its tick box; next: join or start early', () => {
    const s = snap({ next: { title: 'Standup', start: NOW + 5 * MIN, end: NOW + 20 * MIN, call: true, meet: 'https://meet.example.com/abc' } })
    const acts = activities(s, NOW, [...DEFAULT_ISLAND_PREFS.pillOrder.map((x) => ({ ...x, on: true }))])
    const m = quickButtons(acts.find((x) => x.kind === 'mustdos')!, s, chips, NOW)
    expect(m).toEqual([expect.objectContaining({ check: true, action: { kind: 'mustdo', i: 0 } })])
    expect(quickButtons(acts.find((x) => x.kind === 'next')!, s, chips, NOW)[0].action).toEqual({ kind: 'join', url: 'https://meet.example.com/abc' })
    const plain = snap({ next: { title: 'Read', start: NOW + 5 * MIN, end: NOW + 45 * MIN } })
    const n = quickButtons(activities(plain, NOW).find((x) => x.kind === 'next')!, plain, chips, NOW)[0]
    expect(n.action).toEqual({ kind: 'start', subject: 'Read', minutes: 45, flow: true })
  })
  it('locked or nothing: no buttons', () => {
    expect(quickButtons(null, snap(), chips, NOW)).toEqual([])
    const s = snap({ locked: true, running: run })
    expect(quickButtons(activities(s, NOW)[0], s, chips, NOW)).toEqual([])
  })
  it('paused: the pill says Paused and the time stands still', () => {
    const s = snap({ running: { ...run, pausedAt: NOW - 2 * MIN } })
    const a = activities(s, NOW)[0]
    expect(a.sub).toBe('Paused · Essay')
    expect(a.text).toBe('22:00')
    expect(activities(s, NOW + 5 * MIN)[0].text).toBe('22:00')
  })
})

describe('IC2: what a tap is expected to change', () => {
  it('water, reps, must-dos, tasks', () => {
    const s = snap({ tasks: [{ id: 't1', content: 'Pay rent', time: null }] })
    expect(expectPatch(s, { kind: 'water', ml: 250 }, NOW).water.ml).toBe(750)
    expect(expectPatch(s, { kind: 'reps', id: 'tap123', ex: 'push', name: 'Pushups', n: 10 }, NOW).reps[0].done).toBe(20)
    expect(expectPatch(s, { kind: 'mustdo', i: 0 }, NOW).mustdos[0].done).toBe(true)
    expect(expectPatch(s, { kind: 'todoDone', id: 't1', content: 'Pay rent' }, NOW).tasks).toEqual([])
  })
  it('the timer: pause freezes, resume moves the end, stop clears, start starts', () => {
    const s = snap({ running: run })
    const p = expectPatch(s, { kind: 'pause' }, NOW)
    expect(p.running?.pausedAt).toBe(NOW)
    const r = expectPatch(p, { kind: 'resume' }, NOW + 3 * MIN)
    expect(r.running).toEqual(expect.objectContaining({ pausedAt: null, endsAt: run.endsAt + 3 * MIN }))
    expect(expectPatch(s, { kind: 'extend', minutes: 5 }, NOW).running?.endsAt).toBe(run.endsAt + 5 * MIN)
    expect(expectPatch(s, { kind: 'stop' }, NOW).running).toBeNull()
    expect(expectPatch(snap(), { kind: 'start', subject: 'Read', minutes: 25 }, NOW).running).toEqual({ subject: 'Read', startedAt: NOW, endsAt: NOW + 25 * MIN })
  })
  it('several in order; answered ones go with the next snapshot, old ones after 15 s', () => {
    const list = [
      { id: 'a', action: { kind: 'water' as const, ml: 250 }, at: NOW },
      { id: 'b', action: { kind: 'water' as const, ml: 500 }, at: NOW, ackedAt: NOW + 100 },
      { id: 'c', action: { kind: 'water' as const, ml: 100 }, at: NOW - 20_000 }
    ]
    expect(applyExpected(snap(), list).water.ml).toBe(1350)
    expect(settleExpected(list, NOW + 200).map((e) => e.id)).toEqual(['a'])
  })
})

describe('IC3: the round menu', () => {
  it('six actions from your chips', () => {
    const items = ringItems(snap(), chips)
    expect(items.map((i) => i.id)).toEqual(['ring:focus', 'ring:water', 'ring:reps', 'ring:must', 'ring:ask', 'ring:quiet'])
    expect(items[0].act).toEqual({ kind: 'start', subject: 'Focus', minutes: 25, flow: true })
    expect(items[2].act).toEqual({ kind: 'reps', id: 'push', ex: 'push', name: 'Pushups', n: 10 })
    expect(ringItems(snap({ running: run }), chips)[0].act).toEqual({ kind: 'pause' })
  })
  it('lays them around a circle and picks by angle', () => {
    const pts = ringLayout(6, 60)
    expect(pts[0]).toEqual({ x: 0, y: -60 })
    expect(pts[3]).toEqual({ x: 0, y: 60 })
    expect(ringPick(0, -50, 6)).toBe(0)
    expect(ringPick(52, -30, 6)).toBe(1)
    expect(ringPick(0, 50, 6)).toBe(3)
    expect(ringPick(-52, -30, 6)).toBe(5)
    expect(ringPick(5, 5, 6)).toBe(-1)
    // Half: a fan below the pill, left → bottom → right; pointing up picks nothing.
    const half = ringLayout(6, 90, true)
    expect(half[0]).toEqual({ x: -90, y: 0 })
    expect(half[5]).toEqual({ x: 90, y: 0 })
    expect(half.every((p) => p.y >= 0)).toBe(true)
    expect(ringPick(-80, 5, 6, 22, true)).toBe(0)
    expect(ringPick(80, 5, 6, 22, true)).toBe(5)
    expect(ringPick(half[2].x, half[2].y, 6, 22, true)).toBe(2)
    expect(ringPick(0, -60, 6, 22, true)).toBe(-1)
  })
})

describe('IC4: live suggestions in the command bar', () => {
  const ctx: PreviewCtx = { now: NOW, running: null, tasks: [{ id: 't9', content: 'Write the lab report' }], meet: 'https://meet.example.com/x', chips, reps: snap().reps, subject: 'Focus' }
  it('water 500 → log 500 ml first', () => {
    const s = commandPreview('water 500', ctx)
    expect(s[0]).toEqual(expect.objectContaining({ icon: '💧', label: 'Log 500 ml', action: { kind: 'water', ml: 500 } }))
    expect(s[s.length - 1].id).toBe('ben')
  })
  it('focus → 25 / 50 / 90; focus 50 algebra → that', () => {
    expect(commandPreview('focus', ctx).filter((x) => x.action.kind === 'start').map((x) => (x.action as any).minutes)).toEqual([25, 50, 90])
    expect(commandPreview('focus 50 algebra', ctx)[0].action).toEqual({ kind: 'start', subject: 'algebra', minutes: 50, flow: true })
    expect(commandPreview('focus History', ctx)[0].label).toBe('Focus 25 min · History')
  })
  it('bed, join, money, reps, your tasks', () => {
    expect(commandPreview('bed', ctx)[0].action).toEqual({ kind: 'bed' })
    expect(commandPreview('bed 23:40', ctx)[0].action).toEqual({ kind: 'bed', time: '23:40' })
    expect(commandPreview('join', ctx)[0].action).toEqual({ kind: 'join', url: 'https://meet.example.com/x' })
    expect(commandPreview('spent 40 taxi', ctx)[0].label).toBe('Spent 40 · taxi')
    expect(commandPreview('30 pushups', ctx)[0].label).toBe('Log 30 Pushups')
    const t = commandPreview('lab report', ctx)
    expect(t[0].action).toEqual({ kind: 'todoDone', id: 't9', content: 'Write the lab report' })
    expect(t[1].action).toEqual(expect.objectContaining({ kind: 'start', task: { kind: 'todoist', ref: 't9', title: 'Write the lab report' } }))
  })
  it('the running timer: pause, stop, +10', () => {
    const r = { ...ctx, running: run }
    expect(commandPreview('pause', r)[0].action).toEqual({ kind: 'pause' })
    expect(commandPreview('done', r)[0].action).toEqual({ kind: 'stop' })
    expect(commandPreview('+10', r)[0].action).toEqual({ kind: 'extend', minutes: 10 })
  })
  it('anything else goes to Ben; empty: nothing', () => {
    expect(commandPreview('how was my week?', ctx)).toEqual([expect.objectContaining({ id: 'ben', action: { kind: 'chat', text: 'how was my week?' } })])
    expect(commandPreview('   ', ctx)).toEqual([])
    expect(moveChoice(-1, 3, 1)).toBe(0)
    expect(moveChoice(0, 3, -1)).toBe(2)
  })
})

describe('IC6: scroll to adjust', () => {
  it('notches add up; up is more', () => {
    expect(wheelSteps(0, -100)).toEqual({ steps: 2, acc: 0 })
    expect(wheelSteps(0, 30)).toEqual({ steps: -0, acc: 30 })
    expect(wheelSteps(30, 30).steps).toBe(-1)
  })
  it('water in 50 ml steps; the timer never ends in the past', () => {
    expect(waterPick(250, 3)).toBe(400)
    expect(waterPick(100, -5)).toBe(50)
    expect(timerAdjust(NOW + 10 * MIN, -20, NOW)).toBe(-9)
    expect(timerAdjust(NOW + 10 * MIN, 3, NOW)).toBe(3)
  })
})

describe('IC7: the menu for this', () => {
  it('timer, meeting, water', () => {
    const s = snap({ running: run })
    expect(menuFor(activities(s, NOW)[0], s, chips, false).map((m) => m.label)).toEqual(['⏸ Pause', '+5 min', '+15 min', '⏹ Stop & log', '✎ Rename'])
    const m = snap({ now: { title: 'Call', start: NOW - MIN, end: NOW + 30 * MIN, call: true, meet: 'https://meet.example.com/q' } })
    expect(menuFor(activities(m, NOW)[0], m, chips, false).map((x) => x.act)).toEqual([{ kind: 'join', url: 'https://meet.example.com/q' }, 'copyLink', 'mute'])
    const w = snap()
    const wm = menuFor(activities(w, NOW).find((x) => x.kind === 'water')!, w, chips, true)
    expect(wm.map((x) => x.label)).toEqual(['💧 +250 ml', '💧 +500 ml', '💧 +750 ml', '↶ Undo last'])
    expect(wm[3].disabled).toBe(false)
  })
})

describe('IC8: drops', () => {
  it('a Todoist link, a link, an image, too big, other files', () => {
    expect(classifyDrop({ uris: ['https://app.todoist.com/app/task/write-lab-report-6Xc9F2'] })).toEqual({ kind: 'todoist', taskId: '6Xc9F2', url: 'https://app.todoist.com/app/task/write-lab-report-6Xc9F2' })
    expect(classifyDrop({ uris: ['https://todoist.com/showTask?id=123456'] })).toEqual(expect.objectContaining({ kind: 'todoist', taskId: '123456' }))
    expect(classifyDrop({ uris: ['# comment', 'https://example.com/a'] })).toEqual({ kind: 'link', url: 'https://example.com/a' })
    expect(classifyDrop({ text: 'https://example.com/b' })).toEqual({ kind: 'link', url: 'https://example.com/b' })
    expect(classifyDrop({ files: [{ name: 'shot.png', type: 'image/png', size: 2000 }] })).toEqual({ kind: 'file', name: 'shot.png', mime: 'image/png', size: 2000 })
    expect(classifyDrop({ files: [{ name: 'big.pdf', type: 'application/pdf', size: DROP_MAX_BYTES + 1 }] }).kind).toBe('refuse')
    expect(classifyDrop({ files: [{ name: 'a.exe', type: 'application/x-msdownload', size: 10 }] }).kind).toBe('refuse')
    expect(classifyDrop({ uris: ['file:///C:/x.txt'] }).kind).toBe('refuse')
    expect(classifyDrop({ text: 'call mom 15 min' })).toEqual({ kind: 'text', text: 'call mom 15 min' })
  })
})

describe('IC9, IC10, IC19', () => {
  it('keys: arrows wrap, numbers fire chips, / goes to the command bar', () => {
    expect(keyMove('ArrowDown', -1, 4)).toEqual({ focus: 0 })
    expect(keyMove('ArrowDown', 3, 4)).toEqual({ focus: 0 })
    expect(keyMove('ArrowUp', 0, 4)).toEqual({ focus: 3 })
    expect(keyMove('3', 0, 4)).toEqual({ chip: 2 })
    expect(keyMove('/', 0, 4)).toEqual({ command: true })
    expect(keyMove('x', 0, 4)).toBeNull()
  })
  it('only logs can be undone', () => {
    expect(canUndo({ kind: 'water', ml: 250 })).toBe(true)
    expect(canUndo({ kind: 'chat', text: 'hi' })).toBe(false)
    expect(canUndo({ kind: 'stop' })).toBe(false)
  })
  it('fades while you type far away, back when you stop or come near', () => {
    expect(typingFade({ idleMs: 200, cursorDist: 600, faded: false, islandActive: false })).toBe(true)
    expect(typingFade({ idleMs: 200, cursorDist: 80, faded: true, islandActive: false })).toBe(false)
    expect(typingFade({ idleMs: 1500, cursorDist: 600, faded: true, islandActive: false })).toBe(true)
    expect(typingFade({ idleMs: 2500, cursorDist: 600, faded: true, islandActive: false })).toBe(false)
    expect(typingFade({ idleMs: 100, cursorDist: 600, faded: false, islandActive: true })).toBe(false)
  })
})
