// MC14 Phone health numbers by Shortcut: your phone sends weight, steps and
// sleep hours to /api/cron?job=health with a key you make in Settings (the
// server keeps only its hash). Weight goes to Body; steps and sleep to a
// daily record Ben reads. No points: these numbers arrive by themselves.
import { definePlugin } from '../types'
import { readData, writeData } from '../store'
import { healthLine, mergeDay, parseSteps, type HealthData } from './health'

export const HEALTH = 'health'
const dayOf = (d: Date) => d.toLocaleDateString('sv-SE')

export default definePlugin({
  id: HEALTH,
  title: 'Phone health numbers',
  icon: 'chart',
  about: 'An iOS Shortcut or Android automation sends weight, steps and sleep. Weight goes to Body; Ben sees steps and sleep.',
  context(db, now) {
    return healthLine(readData<HealthData>(db, HEALTH), dayOf(now))
  },
  actions: {
    steps: {
      help: '"steps: <number> [| YYYY-MM-DD]" saves his step count when he tells you it (no points).',
      parse: parseSteps,
      run({ db, now }, a: { steps: number; day?: string }) {
        const today = dayOf(now)
        const day = a.day && a.day <= today ? a.day : today
        const data = readData<HealthData>(db, HEALTH)
        const before = data?.days[day]?.steps ?? null
        writeData(db, HEALTH, mergeDay(data, { day, steps: a.steps }, now.toISOString()))
        return { line: `👟 Steps ${day === today ? 'today' : day.slice(5)}: ${a.steps.toLocaleString('en-US')}`, undo: { day, before } }
      },
      undo({ db, now }, u: any) {
        const data = readData<HealthData>(db, HEALTH)
        const rec = data?.days[u?.day]
        if (!data || !rec) return '⚠️ That step count is already gone'
        const next = { ...rec, at: now.toISOString() }
        if (u.before == null) delete next.steps
        else next.steps = u.before
        writeData(db, HEALTH, { days: { ...data.days, [u.day]: next } })
        return u.before == null ? '↩ Steps removed' : `↩ Steps back to ${u.before}`
      }
    }
  },
  commands: {
    steps: {
      help: 'Steps and sleep from your phone, last 7 days',
      run({ db, now }) {
        const data = readData<HealthData>(db, HEALTH)
        const days = Object.keys(data?.days ?? {}).sort().reverse().slice(0, 7)
        if (!days.length) return '👟 Nothing from your phone yet. Set up the Shortcut in Settings → Plugins.'
        return ['👟 <b>From your phone</b>', ...days.map((d) => `${d.slice(5)}: ${data!.days[d].steps != null ? `${data!.days[d].steps} steps` : '—'}${data!.days[d].sleepHours != null ? ` · slept ${data!.days[d].sleepHours} h` : ''}`), healthLine(data, dayOf(now))?.replace(/^From his phone: /, '') ?? ''].filter(Boolean).join('\n')
      }
    }
  },
  mcpTools: [
    {
      name: 'phone_health',
      description: 'Steps and sleep hours per day sent from the phone (last 60 days).',
      inputSchema: { type: 'object', properties: {} },
      run: ({ db }) => readData<HealthData>(db, HEALTH)
    }
  ]
})
