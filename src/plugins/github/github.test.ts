import { describe, expect, it } from 'vitest'
import { commitStats, githubLine, pickCtfs, validUser } from './github'

const push = (iso: string, repo: string, size = 1) => ({ type: 'PushEvent', created_at: iso, repo: { name: `someone/${repo}` }, payload: { size } })

describe('GitHub plugin', () => {
  it('counts commits of the last 7 days and finds the last commit day', () => {
    const events = [push('2026-11-02T10:00:00', 'ctf-notes', 3), push('2026-10-31T10:00:00', 'rust-crypto', 2), push('2026-10-20T10:00:00', 'old', 5), { type: 'WatchEvent', created_at: '2026-11-04T10:00:00' }]
    expect(commitStats(events, '2026-11-05')).toEqual({ lastCommit: '2026-11-02', week: 5, repos: ['ctf-notes', 'rust-crypto'] })
    expect(commitStats([], '2026-11-05')).toEqual({ lastCommit: null, week: 0, repos: [] })
  })

  it('picks the next online CTFs, soonest first', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    const list = [
      { title: 'Later CTF', start: '2026-11-20T10:00:00+00:00', finish: '2026-11-22T10:00:00+00:00', onsite: false, format: 'Jeopardy', ctftime_url: 'https://ctftime.example/1', weight: 20 },
      { title: 'Onsite Finals', start: '2026-11-08T10:00:00+00:00', finish: '2026-11-09T10:00:00+00:00', onsite: true },
      { title: 'Soon CTF', start: '2026-11-07T10:00:00+00:00', finish: '2026-11-08T10:00:00+00:00', onsite: false, format: 'Attack-Defense', url: 'https://soon.example' },
      { title: 'Past CTF', start: '2026-11-01T10:00:00+00:00', finish: '2026-11-02T10:00:00+00:00', onsite: false }
    ]
    expect(pickCtfs(list, now).map((e) => e.title)).toEqual(['Soon CTF', 'Later CTF'])
  })

  it('tells Ben about a streak break and the next CTF', () => {
    const line = githubLine({ user: 'someone', at: '', lastCommit: '2026-11-02', week: 5, repos: ['ctf-notes'], ctfs: [{ title: 'Soon CTF', start: '2026-11-07T10:00:00Z', finish: '2026-11-09T10:00:00Z', url: '', format: 'Jeopardy', weight: 0 }] }, '2026-11-05')
    expect(line).toContain('3 days without a commit (last 2026-11-02)')
    expect(line).toContain('Nudge him')
    expect(line).toContain('Soon CTF 7 Nov (Jeopardy, 48h)')
    expect(githubLine({ user: 'someone', at: '', lastCommit: '2026-11-05', week: 1, repos: [], ctfs: [] }, '2026-11-05')).toBe('GitHub (someone): committed today; 1 commit in the last 7 days.')
  })

  it('checks user names', () => {
    expect(validUser('some-one')).toBe(true)
    expect(validUser('-bad')).toBe(false)
    expect(validUser('a/b')).toBe(false)
  })
})
