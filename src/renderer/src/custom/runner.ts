// Custom Center: doing things. Counter taps go through `counterRoute` to the
// app's own logs (water → addWater, reps → Sport Track's reps and its usual
// workout log, custom → custom_state): no points are paid here, only by the
// real log's own rules. Actions run their whitelisted steps through the app's
// existing operations (runSafe for the focus timer, quiet time and Do Not
// Disturb, which logs them with a 10-minute Undo; the music player's station
// event; the page and mode switches).
import { addLocal, counterRoute, planAction, runSummary, type CounterWidget, type CustomAction, type RealNumbers } from '@core/custom'
import { life } from '../bridge'
import { addWater, readWater } from '../water'
import { findExercise, readSport, updateSport } from '../sportTrack'
import { runSafe, undoAutomation } from '../smartIsland'
import { readAutoLog } from '../islandLog'
import { changeSetup, changeState, getCustom } from './customStore'

/** Today's real numbers for counters that track them, and a running focus timer. */
export async function readReal(): Promise<RealNumbers> {
  const reps: Record<string, number> = {}
  const s = readSport()
  for (const e of Array.isArray(s?.exercises) ? s.exercises : []) {
    const n = Number(e.doneToday) || 0
    if (e.id != null) reps[String(e.id)] = n
    if (e.name) reps[String(e.name).toLowerCase()] = n
  }
  const [water, focus] = await Promise.all([readWater().catch(() => null), life.focus?.state().catch(() => null)])
  const run = focus?.running
  return {
    waterMl: water?.ml ?? 0,
    reps,
    focus: run && !run.pausedAt ? { endsAt: Date.parse(run.startedAt) + (run.pausedMs ?? 0) + run.planned * 60_000, subject: run.subject } : null
  }
}

/** Adds to a counter by its route. Returns a short line and how to take it back. */
export async function tapCounter(w: CounterWidget, amount: number): Promise<{ said: string; undo: () => Promise<void> }> {
  const r = counterRoute(w, amount)
  if (r.to === 'water') {
    await addWater(r.ml, { source: 'custom' })
    return { said: `${r.ml > 0 ? '+' : ''}${r.ml} ml water`, undo: async () => void (await addWater(-r.ml, { source: 'custom' })) }
  }
  if (r.to === 'reps') {
    let id = r.exercise
    let found = false
    updateSport((d) => {
      const ex = findExercise(d, r.exercise)
      if (ex) {
        ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) + r.amount)
        id = String(ex.id)
        found = true
      }
    }, { source: 'custom' })
    if (!found) throw new Error(`Sport Track has no exercise called “${r.exercise}”. Add it there, or make this a custom counter`)
    // The usual workout log (its own rules decide any points, same as the Sport Track checklist).
    const w2 = r.amount > 0 ? await life.body.logWorkout({ title: `${w.title} (+${r.amount})`, items: [{ exerciseId: id, name: w.title, amount: r.amount, unit: 'reps' as any }], note: 'From Custom Center' }).catch(() => null) : null
    window.dispatchEvent(new CustomEvent('life-body-changed'))
    return {
      said: `${r.amount > 0 ? '+' : ''}${r.amount} ${w.title}`,
      undo: async () => {
        updateSport((d) => {
          const ex = findExercise(d, id) ?? findExercise(d, r.exercise)
          if (ex) ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) - r.amount)
        }, { source: 'custom' })
        if (w2?.workout?.id != null && life.body.takeBackSet) await life.body.takeBackSet(w2.workout.id, w.title, r.amount).catch(() => {})
        window.dispatchEvent(new CustomEvent('life-body-changed'))
      }
    }
  }
  const now = Date.now()
  await changeState((s) => addLocal(s, w, r.amount, now))
  return { said: `${r.amount > 0 ? '+' : ''}${r.amount} ${w.title}`, undo: () => changeState((s) => addLocal(s, w, -r.amount, Date.now())) }
}

/** Runs an action's steps in order. Returns one plain line and an Undo (or null when nothing can be taken back). */
export async function runAction(a: CustomAction): Promise<{ said: string; undo: (() => Promise<void>) | null }> {
  const setup = getCustom().setup
  const focus = await life.focus?.state().catch(() => null)
  const planned = planAction(a, { desktop: !!window.desktop, focusRunning: !!focus?.running, setup })
  const failed: string[] = []
  const undos: (() => Promise<void>)[] = []
  const safe: Parameters<typeof runSafe>[0] = []
  for (const p of planned) {
    if (p.skip) continue
    const s = p.step
    try {
      switch (s.do) {
        case 'focus':
          safe.push({ do: 'focus', subject: s.subject, minutes: s.minutes })
          break
        case 'stopFocus':
          safe.push({ do: 'stopFocus' })
          break
        case 'quiet':
          safe.push({ do: 'quiet', minutes: s.minutes })
          break
        case 'dnd':
          safe.push({ do: 'dnd' })
          break
        case 'open':
          safe.push({ do: 'open', page: s.page as any })
          break
        case 'music': {
          // The music player's station (the same event the automations use).
          const m = (window as any).lifeMusic
          if (typeof m?.playStation === 'function') await m.playStation(s.station)
          else window.dispatchEvent(new CustomEvent('life-music-station', { detail: { station: s.station } }))
          break
        }
        case 'mode': {
          const before = getCustom().setup.manual
          await changeSetup((x) => ({ ...x, manual: { mode: s.mode, at: Date.now(), until: null } }), false)
          undos.push(async () => void (await changeSetup((x) => ({ ...x, manual: before }), false)))
          break
        }
        case 'count': {
          const w = setup.widgets.find((x) => x.id === s.widget)
          if (w?.kind === 'counter') undos.push((await tapCounter(w, s.amount)).undo)
          break
        }
      }
    } catch {
      failed.push(p.label)
    }
  }
  if (safe.length) {
    const before = new Set(readAutoLog().map((e) => e.id))
    await runSafe(safe, a.name, `custom-${a.id}`)
    const logged = readAutoLog().find((e) => !before.has(e.id))
    if (logged?.undo.length) undos.push(async () => void (await undoAutomation(logged.id)))
  }
  return { said: `${a.name}: ${runSummary(planned, failed)}`, undo: undos.length ? async () => { for (const u of undos.reverse()) await u().catch(() => {}) } : null }
}
