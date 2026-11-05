import { describe, expect, it } from 'vitest'
import { addContextRule, cleanContextRules, inferContext, matchWord, vsCodeRepo } from './activityContext'

describe('what am I doing (SI2)', () => {
  it('reads VS Code titles for the repo, and only your words become the detail', () => {
    expect(vsCodeRepo('main.rs — rusty-notes — Visual Studio Code')).toBe('rusty-notes')
    const g = inferContext({ proc: 'Code.exe', title: 'main.rs — rusty-notes — Visual Studio Code', words: ['Rusty-notes', 'Algorithms'] })
    expect(g).toMatchObject({ kind: 'coding', detail: 'Rusty-notes' })
    expect(g.conf).toBeGreaterThan(0.8)
    // A repo that isn't one of your words never crosses.
    expect(inferContext({ proc: 'code', title: 'x.ts — secret-client-work — Visual Studio Code', words: ['Algorithms'] }).detail).toBeUndefined()
  })
  it('PDF + course words is study; a PDF alone is a weaker guess', () => {
    expect(inferContext({ proc: 'AcroRd32', title: 'Lecture 5 - graphs.pdf', words: [] })).toMatchObject({ kind: 'study', conf: 0.85 })
    expect(inferContext({ proc: 'SumatraPDF', title: 'Algorithms ch3.pdf', words: ['Algorithms'] })).toMatchObject({ kind: 'study', detail: 'Algorithms' })
    expect(inferContext({ proc: 'SumatraPDF', title: 'flat-lease.pdf', words: [] })).toMatchObject({ kind: 'study', conf: 0.55 })
  })
  it('VMs, WSL and security tools are CTF work; a plain terminal is coding', () => {
    expect(inferContext({ proc: 'VirtualBoxVM', title: null }).kind).toBe('ctf')
    expect(inferContext({ proc: 'wsl' }).kind).toBe('ctf')
    expect(inferContext({ proc: 'chrome', title: 'Machines - Hack The Box' }).kind).toBe('ctf')
    expect(inferContext({ proc: 'WindowsTerminal', title: 'ssh kali@10.0.0.5' }).kind).toBe('ctf')
    expect(inferContext({ proc: 'WindowsTerminal', title: 'npm test' }).kind).toBe('coding')
  })
  it('mail, meetings, games, video and social', () => {
    expect(inferContext({ proc: 'OUTLOOK' }).kind).toBe('email')
    expect(inferContext({ proc: 'chrome', title: 'Inbox (3) - someone@example.com - Gmail' }).kind).toBe('email')
    expect(inferContext({ proc: 'Zoom', meeting: true })).toMatchObject({ kind: 'meeting', conf: 0.95 })
    expect(inferContext({ proc: 'msedge', title: 'Meet - abc-defg-hij · meet.google.com' }).kind).toBe('meeting')
    expect(inferContext({ proc: 'steam' }).kind).toBe('gaming')
    expect(inferContext({ proc: 'cs2' }).kind).toBe('gaming')
    expect(inferContext({ proc: 'chrome', title: 'Funny cats - YouTube' }).kind).toBe('video')
    expect(inferContext({ proc: 'chrome', title: 'Graph algorithms lecture - YouTube' }).kind).toBe('study')
    expect(inferContext({ proc: 'Discord' }).kind).toBe('social')
    expect(inferContext({ proc: 'firefox', title: 'r/aww - Reddit' }).kind).toBe('social')
  })
  it('without titles a browser is just browsing (steady on a quick look away from work)', () => {
    expect(inferContext({ proc: 'chrome', title: null })).toMatchObject({ kind: 'browsing', conf: 0.4 })
    expect(inferContext({ proc: 'chrome', title: null, recent: ['coding', 'coding'] }).kind).toBe('coding')
  })
  it('your bank sites (titles on) are "money", nothing more', () => {
    expect(inferContext({ proc: 'chrome', title: 'MyBank online - Accounts', bankWords: ['mybank'] })).toEqual({ kind: 'money', conf: 0.8 })
    expect(inferContext({ proc: 'chrome', title: 'MyBank online - Accounts', bankWords: [] }).kind).toBe('browsing')
  })
  it('"That\'s not right": your fix wins and is kept per app', () => {
    const rules = addContextRule([], 'Obsidian', 'study')
    expect(inferContext({ proc: 'obsidian', rules }).kind).toBe('study')
    expect(inferContext({ proc: 'obsidian', rules }).conf).toBe(1)
    const again = addContextRule(rules, 'obsidian.exe', 'writing')
    expect(again).toEqual([{ app: 'obsidian', kind: 'writing' }])
    expect(cleanContextRules([{ app: 'x', kind: 'nope' }, { app: 'Steam', kind: 'ctf' }, null])).toEqual([{ app: 'steam', kind: 'ctf' }])
  })
  it('matches the longest of your words, in your spelling', () => {
    expect(matchWord('intro to graph algorithms', ['algo', 'Graph Algorithms'])).toBe('Graph Algorithms')
    expect(matchWord('anything', ['ab'])).toBeUndefined()
  })
  it('no process: away', () => {
    expect(inferContext({ proc: '' }).kind).toBe('idle')
  })
})
