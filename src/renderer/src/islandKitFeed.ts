// Island 2, the app window's part: it reads your island kit (synced
// settings) for the island's snapshot and saves what the island's edit mode
// changed. The island window itself never opens your data.
import { bumpCount, cleanKit, safeHttps, type IslandKit } from '@core/islandTiles'
import type { IslandAction, IslandBlock } from '@core/islandModel'
import { calendarDay } from '@core/dates'
import { life } from './bridge'

let cache: { at: number; kit: IslandKit | null } = { at: 0, kit: null }
let pause: { at: number; on: boolean } = { at: 0, on: false }

async function kitNow(): Promise<IslandKit | null> {
  if (!life.islandKit) return null
  if (cache.kit && Date.now() - cache.at < 30_000) return cache.kit
  const kit = await life.islandKit.get().catch(() => cache.kit)
  cache = { at: Date.now(), kit }
  return kit
}

/** The snapshot's Island 2 part: the kit, today's blocks, and the music's focus pause (AU1's switch). */
export async function kitForIsland(day: IslandBlock[]): Promise<{ kit?: IslandKit; day?: IslandBlock[]; musicPause?: boolean }> {
  const kit = await kitNow()
  if (Date.now() - pause.at > 60_000) {
    pause.at = Date.now()
    const r = await window.desktop?.pcx?.('prefs').catch(() => null)
    pause.on = !!r?.prefs?.pauseMusic
  }
  return { ...(kit ? { kit } : {}), day: day.slice(0, 24), musicPause: pause.on }
}

/** What the island asked: save the kit, count a counter, open a link. */
export async function kitAct(a: IslandAction): Promise<string | null> {
  if (a.kind === 'kitLink') {
    const url = safeHttps(a.url)
    if (!url) throw new Error('Only https links open from the island')
    window.open(url, '_blank', 'noopener')
    return '🔗 Opening the link'
  }
  if (!life.islandKit) throw new Error('This version cannot save island tiles yet')
  if (a.kind === 'kit') {
    cache = { at: Date.now(), kit: await life.islandKit.save(cleanKit(a.kit)) }
    return null
  }
  if (a.kind === 'kitCount') {
    const kit = await life.islandKit.get()
    const next = bumpCount(kit, a.tile, Math.max(-100, Math.min(100, Math.round(a.by) || 0)), calendarDay(new Date()))
    cache = { at: Date.now(), kit: await life.islandKit.save(next) }
    return null
  }
  return null
}
