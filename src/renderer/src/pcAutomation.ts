// Settings → PC & automation, the app window's side (desktop app only).
// - AU7: Ben's asks ("open Spotify") become a card on the island with Allow /
//   Deny; Allow runs it in the desktop (checked again there), Deny logs it.
// - AU2: every 10 minutes, if you share it, the last hour as a short summary
//   (app names, sites, minutes) for Ben: from ActivityWatch when it runs,
//   else from the Smart island's own feed.
// - Tells the synced setting that this PC can answer Ben's asks (every 15 min
//   while "Ben can do things on this PC" is on), so Ben knows when to say
//   "that needs the PC".
import type { IslandAction, IslandAlert } from '@core/islandModel'
import { nextAsk, pcActText, type PcAsk, type PcState } from '@core/pcActions'
import { streamSummary, type LastHour } from '@core/pcLastHour'
import type { PcExtraPrefs } from '@core/pcExtra'
import { life } from './bridge'
import { recentEvents } from './smartIsland'

let prefs: PcExtraPrefs | null = null
let prefsAt = 0
let state: PcState | null = null
let stateAt = 0
let lastHourAt = 0
let deskAt = 0
let deskOn: boolean | null = null

const desk = () => window.desktop
async function loadPrefs(now: number, force = false) {
  if (!force && now - prefsAt < 60_000) return prefs
  prefsAt = now
  const r = await desk()?.pcx?.('prefs').catch(() => null)
  prefs = r?.prefs ?? null
  return prefs
}

/** On every island build (every ~15 s): cheap reads; the slow parts run on their own clocks. */
export async function pcAutoTick(now = Date.now()): Promise<void> {
  if (!desk()?.pcx || !life.pcAuto) return
  const p = await loadPrefs(now)
  if (!p) return
  // Ben's asks, read from this device's copy of the database (no server call).
  if (p.benActions && now - stateAt > 10_000) {
    stateAt = now
    state = await life.pcAuto.state().catch(() => state)
  } else if (!p.benActions) state = null
  // "This PC can answer": only when it changes, or every 15 minutes.
  if (deskOn !== p.benActions || (p.benActions && now - deskAt > 15 * 60_000)) {
    const was = deskOn
    deskOn = p.benActions
    deskAt = now
    if (p.benActions || was) void life.pcAuto.desk(p.benActions).catch(() => {})
  }
  // AU2: the last hour, every 10 minutes, only while you share it.
  if (p.shareLastHour && now - lastHourAt > 10 * 60_000) {
    lastHourAt = now
    void (async () => {
      let h: LastHour | null = p.activityWatch ? await desk()!.pcx!('lastHour').catch(() => null) : null
      if (!h || !h.items.length) h = streamSummary(recentEvents(), now - 3600_000, now)
      if (h.items.length) await life.pcAuto!.lastHour(h).catch(() => {})
    })()
  }
}

/** Settings changed: read them again now. */
export const pcAutoRefresh = () => void loadPrefs(Date.now(), true)

// System page: "Close" on a busy app asks here first, with the same Allow /
// Deny card and the same checks in the desktop (never a part of Windows).
// Kept on this PC only, for 2 minutes.
let mine: PcAsk | null = null
export function askClose(app: string, now = Date.now()) {
  mine = { id: `mc${now.toString(36)}`, at: now, act: { kind: 'close', arg: String(app).slice(0, 40) }, status: 'waiting' }
}

/** AU7: the card for Ben's oldest waiting ask (nothing runs without your tap). */
export function pcAskAlert(now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (mine && mine.status === 'waiting' && now - mine.at < 2 * 60_000 && !((dismissed[`pcask:${mine.id}`] ?? 0) > now)) {
    const id = `pcask:${mine.id}`
    return {
      id,
      kind: 'ben',
      title: 'Close this app?',
      text: `${pcActText(mine.act)} on this PC (it can still ask to save)`,
      face: '🖥',
      actions: [
        { label: 'Allow', primary: true, action: { kind: 'pcAsk', askId: mine.id, answer: 'allow', alertId: id } },
        { label: 'Deny', action: { kind: 'pcAsk', askId: mine.id, answer: 'deny', alertId: id } }
      ]
    }
  }
  if (!prefs?.benActions || !state) return null
  const a = nextAsk(state.asks, now)
  if (!a) return null
  const id = `pcask:${a.id}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'ben',
    title: 'Ben wants to',
    text: `${pcActText(a.act)} on this PC`,
    face: '🖥',
    actions: [
      { label: 'Allow', primary: true, action: { kind: 'pcAsk', askId: a.id, answer: 'allow', alertId: id } },
      { label: 'Deny', action: { kind: 'pcAsk', askId: a.id, answer: 'deny', alertId: id } }
    ]
  }
}

/** Your tap on the card: run it (the desktop checks it again) or say no. Returns what to show. */
export async function pcAskAct(a: Extract<IslandAction, { kind: 'pcAsk' }>): Promise<string> {
  if (mine && a.askId === mine.id) {
    const ask = mine
    mine = null
    if (ask.status !== 'waiting') throw new Error('That is gone')
    if (a.answer === 'deny') {
      await desk()?.pcx?.('deny', ask.act).catch(() => null)
      return 'Left it open'
    }
    const r = await desk()?.pcx?.('run', { ...ask.act, mine: true }).catch((e: Error) => ({ ok: false, why: e.message }))
    if (!r?.ok) throw new Error(r?.why ?? 'That did not work')
    return `Done: ${pcActText(ask.act)}`
  }
  const ask: PcAsk | undefined = state?.asks.find((x) => x.id === a.askId)
  if (!ask || ask.status !== 'waiting') throw new Error('That ask is gone (it waits 10 minutes)')
  const mark = (status: PcAsk['status'], why?: string) => {
    ask.status = status
    return life.pcAuto?.answer(ask.id, status, why).catch(() => {})
  }
  if (a.answer === 'deny') {
    await desk()?.pcx?.('deny', ask.act).catch(() => null)
    await mark('denied')
    return 'Told Ben no'
  }
  await mark('allowed')
  const r = await desk()?.pcx?.('run', ask.act).catch((e: Error) => ({ ok: false, why: e.message }))
  if (!r?.ok) {
    await mark('failed', r?.why ?? 'failed')
    throw new Error(r?.why ?? 'That did not work')
  }
  await mark('done')
  return `Done: ${pcActText(ask.act)}`
}
