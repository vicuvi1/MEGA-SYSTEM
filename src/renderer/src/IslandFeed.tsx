// Desktop only: the app window (it keeps running hidden in the tray) feeds the
// desktop island its snapshot and does what the island's buttons ask. The
// island window itself never opens your data, so there is one owner of it.
import { useCallback, useEffect, useRef } from 'react'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { EMPTY_ISLAND, blocksFromPlan, nowNext, pickAlert, type IslandAction, type IslandBlock, type IslandSnapshot } from '@core/islandModel'
import { life } from './bridge'
import { useLive } from './live'
import { findExercise, readSport, updateSport } from './sportTrack'

const SEEN = 'ls.coachSeen'
const DISMISSED = 'ls.islandDismissed'
const get = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const put = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}

async function todayBlocks(): Promise<IslandBlock[]> {
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const on = !!(await life.google?.status().catch(() => null))?.connected
  if (on) {
    const events = await life.google!.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => [])
    const blocks = events.filter((e) => !e.allDay).map((e) => ({ title: e.title, start: Date.parse(e.start), end: Date.parse(e.end) })).filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    if (blocks.length) return blocks
  }
  const rh = await life.coach?.rhythm?.('state').catch(() => null)
  const plan = rh?.state?.briefing?.plan?.blocks ?? []
  return blocksFromPlan(plan, d)
}

let listening = false

export const ISLAND_LOG = 'ls.islandLog'
export interface IslandLogEntry { at: string; kind: string; ok: boolean; error?: string }
function logIsland(e: IslandLogEntry) {
  try {
    const list: IslandLogEntry[] = JSON.parse(localStorage.getItem(ISLAND_LOG) || '[]')
    localStorage.setItem(ISLAND_LOG, JSON.stringify([...list, e].slice(-30)))
  } catch {
    /* fine */
  }
}

export function IslandFeed() {
  const desk = window.desktop
  const busy = useRef<{ on: boolean; steps: string[] }>({ on: false, steps: [] })
  const last = useRef<IslandSnapshot>(EMPTY_ISLAND)
  const blocks = useRef<{ at: number; list: IslandBlock[] }>({ at: 0, list: [] })

  const build = useCallback(async (): Promise<IslandSnapshot> => {
    const now = Date.now()
    if (!life.coach?.status) return { ...EMPTY_ISLAND, at: now }
    const [status, focus, log] = await Promise.all([life.coach.status(), life.focus.state(), life.coach.log().catch(() => [])])
    if (now - blocks.current.at > 60_000) blocks.current = { at: now, list: await todayBlocks().catch(() => blocks.current.list) }
    const run = focus.running
    const running = run ? { subject: run.subject, startedAt: Date.parse(run.startedAt), endsAt: Date.parse(run.startedAt) + run.planned * 60000 } : null
    const seen = get<number>(SEEN, 0) || now
    const faceOf = (m?: string) => (m && MOOD_FACE[m as Mood]) || status.face
    const coach = log.filter((e) => e.role === 'coach')
    const newest = coach[coach.length - 1]
    const unread = coach.filter((e) => e.via !== 'app' && Date.parse(e.at) > seen).length
    const sport = readSport()
    const reps = (Array.isArray(sport?.exercises) ? sport.exercises : [])
      .filter((e: any) => !e.archived && Number(e.target) > 0)
      .slice(0, 3)
      .map((e: any) => ({ id: String(e.id ?? e.name), name: String(e.name), done: Number(e.doneToday) || 0, target: Number(e.target) || 0 }))
    const localWater = Number(sport?.water?.currentMl) || 0
    const { now: cur, next } = nowNext(blocks.current.list, now)
    const dismissed = get<Record<string, number>>(DISMISSED, {})
    return {
      at: now,
      locked: false,
      ben: {
        face: status.face,
        mood: status.mood,
        why: status.why,
        move: status.move.kind === 'ask' ? null : { title: status.move.title, sub: status.move.sub },
        last: newest ? { text: newest.text, at: newest.at, face: faceOf(newest.mood) } : null,
        unread,
        busy: busy.current.on,
        steps: busy.current.steps
      },
      running,
      now: cur,
      next,
      mustdos: status.mustdos,
      water: { ml: Math.max(status.today.waterMl, localWater), target: status.today.waterTarget || Number(sport?.water?.targetMl) || 2700 },
      reps,
      alert: pickAlert({ now, running, blocks: blocks.current.list, log: log.map((e) => ({ ...e, face: faceOf(e.mood) })), seenBen: seen, dismissed })
    }
  }, [])

  const send = useCallback(async () => {
    if (!desk?.islandState) return
    try {
      last.current = await build()
    } catch {
      last.current = { ...last.current, at: Date.now(), locked: true }
    }
    desk.islandState(last.current)
  }, [build, desk])

  const act = useCallback(
    async (a: IslandAction) => {
      let error: string | null = null
      try {
        // Locked (PIN) or still loading: say so instead of doing nothing.
        if (last.current.locked && a.kind !== 'open' && a.kind !== 'dismiss') throw new Error('Life System is locked: open it and enter your PIN')
        switch (a.kind) {
          case 'water': {
            // The shared log (Ben, Sporty, Telegram see it), and Sport Track's copy here.
            await life.coach?.water?.(a.ml)
            updateSport((d) => {
              if (d.water) d.water.currentMl = (Number(d.water.currentMl) || 0) + a.ml
            })
            window.dispatchEvent(new CustomEvent('life-body-changed'))
            break
          }
          case 'reps': {
            updateSport((d) => {
              const ex = findExercise(d, a.id) ?? findExercise(d, a.name)
              if (ex) ex.doneToday = (Number(ex.doneToday) || 0) + a.n
            })
            await life.body.logWorkout({ title: `${a.name} (+${a.n})`, items: [{ exerciseId: a.id, name: a.name, amount: a.n, unit: 'reps' as any }], note: 'Logged from the desktop island' })
            window.dispatchEvent(new CustomEvent('life-body-changed'))
            break
          }
          case 'mustdo':
            await life.focus.togglePlan(a.i)
            break
          case 'start':
            await life.focus.start(a.subject, a.minutes, null)
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'stop':
            await life.focus.stop()
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'extend':
            await life.focus.extend?.(a.minutes)
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'dismiss': {
            const d = get<Record<string, number>>(DISMISSED, {})
            const now = Date.now()
            for (const k of Object.keys(d)) if (d[k] < now) delete d[k]
            d[a.id] = a.snoozeMin ? now + a.snoozeMin * 60000 : now + 7 * 864e5
            put(DISMISSED, d)
            // Seeing Ben's message counts as read.
            if (a.id.startsWith('ben:')) put(SEEN, Math.max(get<number>(SEEN, 0), Date.parse(a.id.slice(4)) || now))
            break
          }
          case 'open':
            if (a.page === 'coach') put(SEEN, Date.now())
            if (a.page) window.dispatchEvent(new CustomEvent('life-open-page', { detail: a.page }))
            break
          case 'chat': {
            if (!life.coach) throw new Error('Ben is not available here')
            if (busy.current.on) throw new Error('Ben is still answering your last message')
            busy.current = { on: true, steps: [] }
            void send()
            try {
              await life.coach.chat(a.text, (st) => {
                if (!busy.current.steps.includes(st)) busy.current.steps = [...busy.current.steps, st]
                void send()
              })
            } finally {
              busy.current = { on: false, steps: [] }
              put(SEEN, Date.now())
            }
            break
          }
        }
      } catch (e) {
        error = (e as Error)?.message || 'It did not work'
      }
      // The island shows ✓ or the reason; the log (Settings → Island log) keeps it.
      if (a.id) desk?.islandAck?.({ id: a.id, ok: !error, ...(error ? { error } : {}) })
      logIsland({ at: new Date().toISOString(), kind: a.kind, ok: !error, error: error ?? undefined })
      if (error) void life.system?.logError('island', `${a.kind}: ${error}`).catch(() => {})
      await send()
    },
    [send]
  )

  const actRef = useRef(act)
  actRef.current = act
  useEffect(() => {
    if (!desk?.islandState) return
    // IPC listeners can't be removed through the bridge: add them once per window.
    if (!listening) {
      listening = true
      desk.onIslandAction?.((a) => void actRef.current(a))
      desk.onNavigate?.((page) => window.dispatchEvent(new CustomEvent('life-open-page', { detail: page })))
    }
    void send()
    const t = setInterval(() => void send(), 15_000)
    const on = () => void send()
    window.addEventListener('life-focus-changed', on)
    window.addEventListener('life-sport-changed', on)
    return () => {
      clearInterval(t)
      window.removeEventListener('life-focus-changed', on)
      window.removeEventListener('life-sport-changed', on)
    }
  }, [act, desk, send])
  useLive(() => void send())
  return null
}
