import { describe, expect, it } from 'vitest'
import {
  ALL_ON,
  DEFAULT_MODULES,
  MODULE_IDS,
  MODULE_LIST,
  OFF_REPLY,
  altPage,
  commandModule,
  islandOff,
  isOn,
  jobOn,
  menuPages,
  notifOn,
  offReply,
  pageModule,
  pageOn,
  readModules,
  setModule,
  writeModules,
  islandWithout
} from './modules'
import { isSettingKey } from './settingsKeys'
import { slotNotifId } from './notifyBudget'

const SIDEBAR = ['today', 'calendar', 'tasks', 'study', 'coach', 'goals', 'season', 'career', 'progress', 'shop', 'sleep', 'body', 'locker', 'money', 'discipline', 'music', 'custom']

describe('module switch', () => {
  it("the owner's default: Today, Money, Sleep, Sport Track and Discipline on, everything else off", () => {
    const m = readModules(null)
    expect(MODULE_IDS.filter((id) => m[id])).toEqual(['today', 'money', 'sleep', 'sport', 'discipline'])
    expect(readModules('not json')).toEqual(DEFAULT_MODULES)
    for (const id of ['study', 'calendar', 'tasks', 'coach', 'goals', 'season', 'career', 'insights', 'rewards', 'locker', 'music', 'custom', 'focusBoost', 'island', 'growth', 'notebook', 'plugins'] as const) expect(m[id]).toBe(false)
  })

  it('every module records its pages, island sections, jobs, bot commands and settings, and no page, job or command has two owners', () => {
    const seen = { page: new Map<string, string>(), job: new Map<string, string>(), cmd: new Map<string, string>(), island: new Map<string, string>() }
    for (const m of MODULE_LIST) {
      expect(m.line.length).toBeGreaterThan(10)
      for (const [kind, list] of [['page', m.pages], ['job', [...m.desktop, ...m.server]], ['cmd', m.bot], ['island', m.island]] as const) {
        for (const x of list) {
          const had = seen[kind].get(x)
          expect(had, `${kind} ${x} in ${had} and ${m.id}`).toBeUndefined()
          seen[kind].set(x, m.id)
        }
      }
      for (const k of m.settings) expect(isSettingKey(k), `${m.id}: ${k}`).toBe(true)
    }
    // Every page of the sidebar belongs to a module.
    for (const p of SIDEBAR) expect(pageModule(p), p).not.toBeNull()
  })

  it('a stored choice wins over the default; Today cannot be switched off; a later module starts at its default', () => {
    const m = readModules({ on: { study: true, money: false, today: false, nope: true } })
    expect(m.study).toBe(true)
    expect(m.money).toBe(false)
    expect(m.today).toBe(true)
    expect(m.calendar).toBe(false)
    expect(readModules(writeModules(m))).toEqual(m)
    expect(setModule(m, 'today', false).today).toBe(true)
    expect(setModule(m, 'coach', true).coach).toBe(true)
  })

  it('the menu has only the pages of modules that are on, in module order; turning one on brings it back', () => {
    expect(menuPages(DEFAULT_MODULES, SIDEBAR)).toEqual(['today', 'money', 'sleep', 'body', 'discipline'])
    expect(menuPages(setModule(DEFAULT_MODULES, 'study', true), SIDEBAR)).toEqual(['today', 'money', 'sleep', 'body', 'discipline', 'study'])
    expect(menuPages(DEFAULT_MODULES, SIDEBAR, ['sleep'])).toEqual(['today', 'money', 'body', 'discipline'])
    expect(menuPages(ALL_ON, SIDEBAR)).toHaveLength(SIDEBAR.length)
  })

  it('Alt+number is the n-th page of the menu, never a page that is off', () => {
    expect(altPage(DEFAULT_MODULES, SIDEBAR, [], 1)).toBe('today')
    expect(altPage(DEFAULT_MODULES, SIDEBAR, [], 2)).toBe('money')
    expect(altPage(DEFAULT_MODULES, SIDEBAR, [], 5)).toBe('discipline')
    expect(altPage(DEFAULT_MODULES, SIDEBAR, [], 6)).toBeNull()
  })

  it('pages: system pages always work, an off page does not', () => {
    expect(pageOn(DEFAULT_MODULES, 'settings')).toBe(true)
    expect(pageOn(DEFAULT_MODULES, 'money')).toBe(true)
    expect(pageOn(DEFAULT_MODULES, 'calendar')).toBe(false)
    expect(pageOn(DEFAULT_MODULES, 'history')).toBe(false)
  })

  it('background jobs of an off module do not run; jobs of no module (backups, health) always do', () => {
    for (const j of ['tick.rhythm', 'tick.career', 'tick.goals', 'tick.plugins', 'tick.calendarWatch', 'studyAlarm', 'driveSync', 'benBubble', 'musicHost', 'focusBoost', 'customBackground', 'todoistWatch']) expect(jobOn(DEFAULT_MODULES, j), j).toBe(false)
    for (const j of ['tick.budget', 'tick.winddown', 'daily.night', 'foodInbox', 'awayBedtime', 'backup', 'health']) expect(jobOn(DEFAULT_MODULES, j), j).toBe(true)
    expect(jobOn(ALL_ON, 'tick.rhythm')).toBe(true)
  })

  it('bot commands: an off module answers the switched-off line, an on one and free text pass', () => {
    expect(commandModule('/quiz')).toBe('career')
    expect(commandModule('/todo@LifeBot')).toBe('tasks')
    expect(commandModule('/done 2')).toBe('tasks')
    expect(commandModule('spent 40 taxi')).toBeNull()
    expect(offReply(DEFAULT_MODULES, '/quiz')).toBe(`Career: ${OFF_REPLY}`)
    expect(offReply(DEFAULT_MODULES, '/todo')).toContain('Settings → Modules')
    expect(offReply(DEFAULT_MODULES, '/water')).toBeNull()
    expect(offReply(DEFAULT_MODULES, '/balance')).toBeNull()
    expect(offReply(DEFAULT_MODULES, '/checkin')).toBeNull()
    expect(offReply(DEFAULT_MODULES, '/wake')).toBeNull()
    expect(offReply(DEFAULT_MODULES, 'hello')).toBeNull()
    expect(offReply(ALL_ON, '/quiz')).toBeNull()
  })

  it('notifications: the daily pushes stay (Today and Sleep), those of off modules go', () => {
    expect(notifOn(DEFAULT_MODULES, { id: 'budget:morning:2026-11-12', kind: 'plan' })).toBe(true)
    expect(notifOn(DEFAULT_MODULES, { id: 'budget:weekly:2026-11-15', kind: 'ben' })).toBe(true)
    expect(notifOn(DEFAULT_MODULES, { id: 'budget:winddown:2026-11-12', kind: 'ben' })).toBe(true)
    expect(notifOn(DEFAULT_MODULES, { id: 'night:2026-11-12', kind: 'bedtime' })).toBe(true)
    // The real ids from the push budget (so the two never drift apart).
    for (const s of ['morning', 'afternoon', 'plan', 'weekly', 'winddown'] as const) expect(notifOn(DEFAULT_MODULES, { id: slotNotifId(s, '2026-11-15'), kind: 'ben' }), s).toBe(true)
    expect(notifOn(setModule(DEFAULT_MODULES, 'sleep', false), { id: slotNotifId('winddown', '2026-11-15'), kind: 'ben' })).toBe(false)
    expect(notifOn(DEFAULT_MODULES, { id: 'x', kind: 'ben' })).toBe(false)
    expect(notifOn(DEFAULT_MODULES, { id: 'x', kind: 'event' })).toBe(false)
    expect(notifOn(DEFAULT_MODULES, { id: 'x', kind: 'water' })).toBe(true)
    expect(notifOn(DEFAULT_MODULES, { id: 'x', kind: 'other', action: { kind: 'page', page: 'career' } })).toBe(false)
    expect(notifOn(DEFAULT_MODULES, { id: 'x', kind: 'health' })).toBe(true)
  })

  it('island: the sections of off modules are emptied, the ON ones stay', () => {
    const off = islandOff(DEFAULT_MODULES)
    for (const k of ['ben', 'studyTime', 'tasks', 'goals', 'points', 'saga', 'center', 'next']) expect(off, k).toContain(k)
    for (const k of ['mustdos', 'running', 'water', 'sleep', 'money', 'protein']) expect(off, k).not.toContain(k)
    expect(islandOff(ALL_ON)).toEqual([])
  })

  it('is a registered setting, and Today is on in every reading', () => {
    expect(isSettingKey('modules_on')).toBe(true)
    expect(isOn(readModules({ on: { today: false } }), 'today')).toBe(true)
  })
})

describe('island without the off modules', () => {
  it('empties their sections and keeps the ON ones as they are', () => {
    const snap = { ben: { unread: 3, move: { title: 'x' }, last: { text: 'hi' }, face: '🙂' }, now: { title: 'Class' }, next: { title: 'Gym' }, tasks: [{ id: '1' }], points: { balance: 5 }, studyTime: { todayMin: 20 }, mustdos: [{ i: 0 }], water: { ml: 500, target: 2000 }, money: { left: 40 } }
    const out = islandWithout(snap, DEFAULT_MODULES)
    expect(out.ben).toEqual({ unread: 0, move: null, last: null, face: '🙂' })
    expect(out.now).toBeNull()
    expect(out.next).toBeNull()
    expect(out.tasks).toEqual([])
    expect('points' in out).toBe(false)
    expect('studyTime' in out).toBe(false)
    expect(out.mustdos).toEqual(snap.mustdos)
    expect(out.water).toEqual(snap.water)
    expect(out.money).toEqual(snap.money)
    expect((out as any).off).toContain('coach')
    expect(islandWithout(snap, ALL_ON)).toBe(snap)
    expect(islandWithout(snap, setModule(DEFAULT_MODULES, 'sport', false)).water).toEqual({ ml: 0, target: 0 })
  })
})
