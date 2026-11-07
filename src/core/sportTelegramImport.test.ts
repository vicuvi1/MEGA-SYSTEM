import { describe, expect, it } from 'vitest'
import { matchExercise, mergeTelegramDays, nameKey, parseTelegramExport, readMessages } from './sportTelegramImport'

// A small made-up export in Telegram Desktop's HTML structure (fake dates and numbers).
const msg = (id: number, date: string, from: string | null, text: string) => `
 <div class="message default clearfix${from ? '' : ' joined'}" id="message${id}">
  <div class="body">
   <div class="pull_right date details" title="${date} UTC+03:00">${date.slice(11, 16)}</div>
   ${from ? `<div class="from_name">\n${from}\n</div>` : ''}
   <div class="text">
${text}
   </div>
  </div>
 </div>`
const SAMPLE = `<!DOCTYPE html><html><body><div class="history">
 <div class="message service" id="message1"><div class="body details">3 March 2031</div></div>
 ${msg(2, '03.03.2031 08:10:00', 'Test Bot', '&#x1F3CB;&#xFE0F; <strong>Today&apos;s Workout (2031-03-03)</strong><br>⚪ Push-ups 0 / 40 reps<br>⚪ Sit-ups 0 / 30 reps<br>⚪ press 0 / 20')}
 ${msg(3, '03.03.2031 12:00:00', 'Sam', '25 push ups')}
 ${msg(4, '03.03.2031 18:30:00', null, '20pushups')}
 ${msg(5, '03.03.2031 19:00:00', 'Test Bot', 'Still time today · Mon 3 Mar<br>✅ Push-ups (45/40 reps)<br>Sit-ups (12/30 reps)<br>press 20 / 20<br>Plank (45/60 sec)<br>Water (1500/2500 ml)')}
 ${msg(6, '04.03.2031 01:30:00', 'Sam', '30 sit ups')}
 ${msg(7, '05.03.2031 09:00:00', 'Sam', '2 glasses water')}
 ${msg(8, '05.03.2031 09:05:00', 'Sam', '33 pushups')}
 ${msg(9, '05.03.2031 21:00:00', 'Test Bot', '<strong>Today&apos;s Workout (2031-03-05)</strong><br>Push-ups (30/40 reps)<br>Squats (55/50 reps)')}
</div></body></html>`

describe('Telegram import', () => {
  it('reads the messages: date, sender (kept for joined messages), text', () => {
    const m = readMessages(SAMPLE)
    expect(m).toHaveLength(8)
    expect(m[0]).toMatchObject({ day: '2031-03-03', from: 'Test Bot' })
    expect(m[2]).toMatchObject({ from: 'Sam', text: '20pushups' })
    // 01:30 still counts for the evening before (the day turns at 04:00).
    expect(m[4].day).toBe('2031-03-03')
  })

  it('takes the highest count per exercise per day; your own logs add up', () => {
    const r = parseTelegramExport(SAMPLE)
    expect(r.first).toBe('2031-03-03')
    expect(r.last).toBe('2031-03-05')
    const d1 = r.days['2031-03-03']
    expect(d1.pushup).toMatchObject({ name: 'Push-ups', done: 45, target: 40 })
    expect(d1.situp.done).toBe(30) // 12 from the bot, 30 logged after midnight
    expect(d1.press).toMatchObject({ name: 'press', done: 20, target: 20 })
    expect(d1.plank).toMatchObject({ done: 45, unit: 'sec' })
    expect(d1.water).toBeUndefined()
    const d3 = r.days['2031-03-05']
    expect(d3.pushup.done).toBe(33)
    expect(d3.squat).toMatchObject({ done: 55, target: 50 })
    expect(Object.keys(d3)).not.toContain('glasseswater')
    expect(r.days['2031-03-04']).toBeUndefined()
  })

  it('several files at once', () => {
    const r = parseTelegramExport([SAMPLE.slice(0, SAMPLE.indexOf('id="message6"') - 40) + '</div>', SAMPLE.slice(SAMPLE.indexOf('id="message6"') - 40)])
    expect(Object.keys(r.days).sort()).toEqual(['2031-03-03', '2031-03-05'])
  })

  it('matches your exercises: the same name first ("press" is yours), then the library move', () => {
    const ex = [{ id: 'ex_pushups', name: 'Push-ups', target: 40 }, { id: 'ex_press', name: 'press', target: 20 }, { id: 'ex_9', name: 'My squats', target: 50, move: 'squat' }]
    expect(nameKey('Push ups')).toBe('pushup')
    expect(matchExercise('push ups', ex)?.id).toBe('ex_pushups')
    expect(matchExercise('press', ex)?.id).toBe('ex_press')
    expect(matchExercise('Squats', ex)?.id).toBe('ex_9')
    expect(matchExercise('Burpees', ex)).toBeNull()
  })

  it('merges past days without doubles, keeps the higher number, marks the source, never pays', () => {
    const r = parseTelegramExport(SAMPLE)
    const st = {
      exercises: [{ id: 'ex_pushups', name: 'Push-ups', target: 40, active: true }, { id: 'ex_press', name: 'press', target: 20, active: true }],
      days: { '2031-03-03': { ex_pushups: 60 } },
      history: []
    }
    const a = mergeTelegramDays(st, r.days, ['2031-03-03', '2031-03-05'], '2031-03-05', 1)
    expect(a.days).toEqual(['2031-03-03']) // today is never imported
    expect(a.st.days['2031-03-03'].ex_pushups).toBe(60)
    expect(a.st.days['2031-03-03'].ex_press).toBe(20)
    expect(a.added.sort()).toEqual(['Plank', 'Sit-ups'])
    expect(a.st.exercises.find((e: any) => e.name === 'Sit-ups').active).toBe(false)
    const h = a.st.history[0]
    expect(h).toMatchObject({ day: '2031-03-03', source: 'telegram import', paid: 0 })
    expect(h.title).toMatch(/^Partial day/) // plank 45 of 60
    expect(h.items.some((i: any) => i.sets)).toBe(false)
    // Again: one entry per day, still no doubles.
    const b = mergeTelegramDays(a.st, r.days, ['2031-03-03', '2031-03-05'], '2031-03-06', 2)
    expect(b.st.history.filter((x: any) => x.day === '2031-03-03')).toHaveLength(1)
    expect(b.st.history.find((x: any) => x.day === '2031-03-05').title).toMatch(/^Partial day/)
    expect(b.st.exercises.filter((e: any) => e.name === 'Sit-ups')).toHaveLength(1)
  })
})
