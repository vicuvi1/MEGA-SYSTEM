import { describe, expect, it } from 'vitest'
import { addJob, cleanJobs, followedUp, followUpsDue, funnel, jobsLine, mondayOf, moveJob, snoozeFollowUp, weekStats, type JobsBook } from './jobs'

const T = '2026-11-07' // a Saturday
const empty: JobsBook = { quota: 3, jobs: [] }

describe('job pipeline', () => {
  it('weeks start on Monday', () => {
    expect(mondayOf(T)).toBe('2026-11-02')
    expect(mondayOf('2026-11-02')).toBe('2026-11-02')
    expect(mondayOf('2026-11-08')).toBe('2026-11-02')
  })
  it('a found job has no follow-up; applying stamps the day and asks again in a week', () => {
    let b = addJob(empty, { company: 'Northwind Labs', role: 'SOC intern' }, '2026-11-03', 'j1')
    expect(b.jobs[0]).toMatchObject({ stage: 'found', applied: null, followUp: null })
    b = moveJob(b, 'j1', 'applied', '2026-11-04')
    expect(b.jobs[0]).toMatchObject({ stage: 'applied', applied: '2026-11-04', followUp: '2026-11-11' })
    b = moveJob(b, 'j1', 'interview', '2026-11-12')
    expect(b.jobs[0]).toMatchObject({ applied: '2026-11-04', followUp: '2026-11-14' })
    b = moveJob(b, 'j1', 'no', '2026-11-20')
    expect(b.jobs[0].followUp).toBeNull()
    expect(b.jobs[0].moves.map((m) => m.stage)).toEqual(['found', 'applied', 'interview', 'no'])
  })
  it('adding straight to applied counts for the week', () => {
    const b = addJob(empty, { company: 'Contoso', role: 'Junior pentester', stage: 'applied', link: 'not a link' }, T, 'j2')
    expect(b.jobs[0]).toMatchObject({ stage: 'applied', applied: T, link: null })
    expect(weekStats(b, T).sent).toBe(1)
  })
  it('follow-ups: due ones listed, two chases then it stops, snooze moves it', () => {
    let b = addJob(empty, { company: 'A', role: 'r', stage: 'applied' }, '2026-10-28', 'a')
    b = addJob(b, { company: 'B', role: 'r', stage: 'applied' }, '2026-11-05', 'b')
    expect(followUpsDue(b, T).map((j) => j.id)).toEqual(['a'])
    b = snoozeFollowUp(b, 'a', T)
    expect(followUpsDue(b, T)).toEqual([])
    b = followedUp(b, 'a', '2026-11-10')
    expect(b.jobs.find((j) => j.id === 'a')!.followUp).toBe('2026-11-17')
    b = followedUp(b, 'a', '2026-11-17')
    expect(b.jobs.find((j) => j.id === 'a')!.followUp).toBeNull()
  })
  it('week stats: sent, left, pace, streak of weeks that made the quota', () => {
    let b: JobsBook = { quota: 2, jobs: [] }
    let n = 0
    for (const d of ['2026-10-19', '2026-10-21', '2026-10-27', '2026-10-28', '2026-11-03']) b = addJob(b, { company: `C${n}`, role: 'r', stage: 'applied' }, d, `x${n++}`)
    const w = weekStats(b, '2026-11-04')
    expect(w).toMatchObject({ monday: '2026-11-02', sent: 1, quota: 2, left: 1, daysLeft: 5, paceNow: 1, onPace: true, streak: 2 })
    expect(w.history.at(-1)).toEqual({ monday: '2026-11-02', sent: 1 })
  })
  it('the funnel and the line Ben reads', () => {
    let b = addJob(empty, { company: 'Fabrikam', role: 'Intern', stage: 'applied' }, '2026-11-02', 'f')
    b = addJob(b, { company: 'Tailspin', role: 'Analyst', stage: 'applied' }, '2026-11-03', 't')
    b = moveJob(b, 't', 'interview', '2026-11-05')
    expect(funnel(b)).toMatchObject({ applied: 2, interviews: 1, offers: 0, responseRate: 0.5 })
    expect(jobsLine(b, T)).toBe('Job hunt: 2 of 3 applications this week (1 to go, 2 days left) · 1 interview open · follow up: Tailspin')
  })
  it('cleans saved data', () => {
    expect(cleanJobs({ quota: 99, jobs: [{ id: 'a', stage: 'applied', added: T, company: 'X' }, { id: 'b', stage: 'weird', added: T }] })).toMatchObject({ quota: 30, jobs: [{ id: 'a', stage: 'applied', role: '', applied: null }] })
    expect(cleanJobs(null)).toEqual({ quota: 3, jobs: [] })
  })
})
