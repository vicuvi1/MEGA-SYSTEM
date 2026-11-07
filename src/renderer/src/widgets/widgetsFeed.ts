// The app window's part of widgets and the weather pill: it reads the
// weather plugin's saved forecast and your synced widget setting for the
// island's snapshot, keeps the island's pill order and look the same on
// every PC (PL8), and answers the widgets' asks (network through the
// allowlist, add a task or a note), checking each one again here. The
// island window never opens your data.
import { calendarDay } from '@core/dates'
import type { IslandAction, IslandAlert } from '@core/islandModel'
import { checkCall, type WidgetCall } from '@core/widgets/bridge'
import { checkScriptCall } from '@core/widgets/scriptRun'
import { cleanWidgets, mergeLayout, type WidgetsSetting } from '@core/widgets/settings'
import { daylightPeek, rainPeek, weatherForIsland, type IslandWeather } from '@core/widgets/weatherPill'
import type { WeatherData } from '../../../plugins/weather/weather'
import { life } from '../bridge'
import { MANIFESTS } from './registry'

let wx: { at: number; v: IslandWeather | null } = { at: 0, v: null }
let ws: { at: number; v: WidgetsSetting | null } = { at: 0, v: null }
let syncAt = 0
const SEEN = 'ls.islandLayoutSeen'

async function weatherNow(now: number): Promise<IslandWeather | null> {
  if (now - wx.at < 5 * 60_000 && (!wx.v || wx.v.day === calendarDay(new Date(now)))) return wx.v
  wx.at = now
  const p = life.plugins
  if (!p) return (wx.v = null)
  const on = await p.state().then((s) => s.on?.weather === true).catch(() => false)
  const data = on ? await p.data<WeatherData>('plugin_weather_data').catch(() => null) : null
  return (wx.v = weatherForIsland(data, calendarDay(new Date(now))))
}

/** Today's weather (the plugin's saved forecast) for sleep care: rain, sunrise, sunset, morning clouds. */
export const weatherToday = (now: number) => weatherNow(now)

/** Your widget setting (someone who never chose a look and already set up the island keeps today's capsule). */
export async function readWidgets(force = false): Promise<WidgetsSetting> {
  if (!force && ws.v && Date.now() - ws.at < 30_000) return ws.v
  const raw = await life.widgets?.get().catch(() => null)
  let fallback: 'notch' | 'capsule' = 'notch'
  if (!(raw as { look?: unknown } | null)?.look) {
    const kit = await life.islandKit?.get().catch(() => null)
    if (kit && (kit.tiles.length || kit.buttons.length || kit.music.stations.length)) fallback = 'capsule'
  }
  const v = cleanWidgets(raw, MANIFESTS, fallback)
  ws = { at: Date.now(), v }
  return v
}

export async function saveWidgets(v: WidgetsSetting): Promise<void> {
  if (!life.widgets) throw new Error('This version cannot save widgets yet')
  await life.widgets.save(v)
  ws = { at: Date.now(), v }
}

const readSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(SEEN) || 'null')
  } catch {
    return null
  }
}
const writeSeen = (v: unknown) => {
  try {
    localStorage.setItem(SEEN, JSON.stringify(v))
  } catch {
    /* fine */
  }
}

/** PL8: the pill order and the island look follow you; screen positions stay on this PC. */
async function syncLayout(s: WidgetsSetting, now: number): Promise<void> {
  const desk = window.desktop
  if (!desk?.getIslandPrefs || !desk.setIslandPrefs || now - syncAt < 60_000) return
  syncAt = now
  const p = await desk.getIslandPrefs().catch(() => null)
  if (!p) return
  const local = { pillOrder: p.pillOrder, look: p.look }
  const r = mergeLayout(local, s.layout, readSeen(), now)
  if (r.push) {
    await saveWidgets({ ...s, layout: r.push })
    writeSeen({ pillOrder: r.push.pillOrder, look: r.push.look })
  } else if (r.apply) {
    await desk.setIslandPrefs(r.apply as never).catch(() => null)
    writeSeen({ pillOrder: r.apply.pillOrder ?? local.pillOrder, look: r.apply.look ?? local.look })
  } else writeSeen(local)
}

/** The snapshot's widget part: your setting and today's weather. */
export async function widgetsForIsland(now: number): Promise<{ weather: IslandWeather | null; widgets?: WidgetsSetting }> {
  const weather = await weatherNow(now).catch(() => null)
  const widgets = await readWidgets().catch(() => null)
  if (widgets) await syncLayout(widgets, now).catch(() => {})
  return { weather, ...(widgets ? { widgets } : {}) }
}

// ---- Notices from script tiles (PL5) ----
let notices: { id: string; title: string; text: string; at: number }[] = []

/** LF1 / LF2 and script notices: rain in 30 minutes, the light going (once a day), a script's notify(). */
export function weatherAlert(now: number, dismissed: Record<string, number>, busy: boolean): IslandAlert | null {
  notices = notices.filter((n) => now - n.at < 30 * 60_000 && !((dismissed[n.id] ?? 0) > now))
  const n = notices[0]
  if (n) return { id: n.id, kind: 'widget', face: '✨', title: n.title, text: n.text, actions: [{ label: 'Got it', action: { kind: 'dismiss', id: n.id }, primary: true }] }
  return rainPeek(wx.v, now, dismissed) ?? daylightPeek(wx.v, now, dismissed, busy)
}

const recent = new Map<string, Partial<Record<WidgetCall['op'], number[]>>>()

/** A widget's or a script's call from the island, checked again here. Returns the island's answer text. */
export async function widgetAct(a: Extract<IslandAction, { kind: 'widget' }>): Promise<string> {
  const s = await readWidgets(true)
  const now = Date.now()
  let hosts: string[] = []
  let call: WidgetCall | null = null
  if (a.widget.startsWith('script:')) {
    const sc = s.scripts.find((x) => `script:${x.id}` === a.widget && x.on)
    if (!sc) throw new Error('That script is off or gone')
    if (a.op === 'notify') {
      const text = String(a.text ?? '').slice(0, 120).trim()
      if (text) notices = [...notices.filter((n) => n.id !== `script:${sc.id}`), { id: `script:${sc.id}:${now}`, title: sc.name, text, at: now }].slice(-3)
      return ''
    }
    const c = checkScriptCall(sc, { op: a.op, url: a.url, text: a.text })
    if (!c.ok) throw new Error(c.error)
    call = c.call
    hosts = sc.hosts
  } else {
    const w = s.installed.find((x) => x.id === a.widget)
    const m = MANIFESTS[a.widget]
    if (!w || !m) throw new Error('That widget isn’t installed')
    const r = recent.get(w.id) ?? {}
    const c = checkCall({ op: a.op, url: a.url, text: a.text }, w.grants, r, now)
    if (!c.ok) throw new Error(c.error)
    r[c.call.op] = [...(r[c.call.op] ?? []).filter((t) => now - t < 60_000), now]
    recent.set(w.id, r)
    call = c.call
    hosts = w.grants.network
  }
  if (call.op === 'fetch') {
    if (!window.desktop?.widgetFetch) throw new Error('Widget network works in the Windows app')
    return JSON.stringify(await window.desktop.widgetFetch(call.url, hosts))
  }
  if (call.op === 'addTask') {
    if (!life.todoist?.quickAdd) throw new Error('Connect Todoist first')
    const t = await life.todoist.quickAdd(call.text)
    return `➕ Todoist: ${t?.content ?? call.text}`
  }
  if (call.op === 'addNote') {
    if (!life.notes) throw new Error('The notebook isn’t ready')
    const notes = await life.notes.list()
    const inbox = notes.find((n) => n.title.toLowerCase() === 'inbox')
    const line = `- ${call.text} _(${calendarDay(new Date(now))})_`
    await life.notes.save(inbox ? { id: inbox.id, title: inbox.title, body: `${inbox.body.replace(/\s*$/, '')}\n${line}\n` } : { title: 'Inbox', body: `# Inbox\n\nThings you saved from the island.\n\n${line}\n` })
    return '📓 Saved in Notebook → Inbox'
  }
  throw new Error('Unknown call')
}
