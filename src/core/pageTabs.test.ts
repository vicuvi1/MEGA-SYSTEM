import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickTab, TAB_LINKS, tabFromUrl, tabKey } from './pageTabs'

describe('page tabs', () => {
  it('shows the tab asked for only when it is offered now', () => {
    expect(pickTab('body', ['now', 'body'])).toBe('body')
    // The Day tab is only offered on a narrow screen: fall back, don't break.
    expect(pickTab('day', ['now', 'plan', 'tasks'], 'now')).toBe('now')
    expect(pickTab(null, ['a', 'b'])).toBe('a')
    expect(pickTab('x', ['a', 'b'], 'b')).toBe('b')
    expect(pickTab('x', [], 'b')).toBe('')
  })

  it('reads ?tab= for the page the address opens (Today when no page)', () => {
    expect(tabFromUrl('?tab=body', 'today')).toBe('body')
    expect(tabFromUrl('?page=money&tab=month', 'money')).toBe('month')
    expect(tabFromUrl('?page=money&tab=month', 'today')).toBeNull()
    expect(tabFromUrl('?tab=<script>', 'today')).toBeNull()
    expect(tabFromUrl('', 'today')).toBeNull()
  })

  it('remembers per page on this device', () => {
    expect(tabKey('today')).toBe('ls.tab.today')
    expect(tabKey('settings.ben')).toBe('ls.tab.settings.ben')
  })

  it('every Ctrl+K tab link points at a tab its page really has', () => {
    const file: Record<string, string> = {
      today: 'pages/Today.tsx',
      progress: 'pages/Progress.tsx',
      goals: 'pages/Goals.tsx',
      money: 'pages/Money.tsx',
      discipline: 'pages/Discipline.tsx',
      music: 'pages/Music.tsx',
      shop: 'pages/Rewards.tsx'
    }
    for (const l of TAB_LINKS) {
      expect(file[l.page], l.page).toBeTruthy()
      const src = readFileSync(join(__dirname, '..', 'renderer', 'src', file[l.page]), 'utf8')
      expect(src.includes(`id: '${l.tab}'`), `${l.page} has a "${l.tab}" tab`).toBe(true)
    }
    // Water opens Body (the teacher's example).
    expect(TAB_LINKS.find((l) => /water/i.test(l.label))).toMatchObject({ page: 'today', tab: 'body' })
  })
})
