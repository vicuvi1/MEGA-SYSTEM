import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  DEFAULT_CALENDAR_CONFIG,
  filterEventsForDay,
  formatCalendarSummaryForAi,
  parseIcs,
  type CalendarConfig,
  type CalendarEvent
} from '@core/calendar'

export class CalendarService {
  private configFile: string
  private cacheFile: string
  private events: CalendarEvent[] = []
  private customFetch: typeof fetch

  constructor(
    storageDir?: string,
    fetchFn: typeof fetch = fetch
  ) {
    this.customFetch = fetchFn
    let baseDir: string
    try {
      baseDir = storageDir ?? app.getPath('userData')
    } catch {
      baseDir = storageDir ?? process.cwd()
    }
    this.configFile = join(baseDir, 'calendar_config.bin')
    this.cacheFile = join(baseDir, 'calendar_cache.json')
    this.loadCache()
  }

  private loadCache(): void {
    try {
      if (existsSync(this.cacheFile)) {
        const raw = readFileSync(this.cacheFile, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.events = parsed
        }
      }
    } catch {
      this.events = []
    }
  }

  private saveCache(): void {
    try {
      writeFileSync(this.cacheFile, JSON.stringify(this.events, null, 2), 'utf8')
    } catch {
      // Ignore cache write error
    }
  }

  getConfig(): CalendarConfig {
    if (!existsSync(this.configFile)) return { ...DEFAULT_CALENDAR_CONFIG }
    try {
      const buf = readFileSync(this.configFile)
      if (!buf || !buf.length) return { ...DEFAULT_CALENDAR_CONFIG }
      let str = ''
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        str = safeStorage.decryptString(buf)
      } else {
        str = buf.toString('utf8')
      }
      return { ...DEFAULT_CALENDAR_CONFIG, ...JSON.parse(str) }
    } catch {
      return { ...DEFAULT_CALENDAR_CONFIG }
    }
  }

  saveConfig(patch: Partial<CalendarConfig>): CalendarConfig {
    const cur = this.getConfig()
    const next: CalendarConfig = {
      ...cur,
      ...patch,
      feedUrl: patch.feedUrl !== undefined ? patch.feedUrl.trim() : cur.feedUrl
    }
    const json = JSON.stringify(next)
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      writeFileSync(this.configFile, safeStorage.encryptString(json))
    } else {
      writeFileSync(this.configFile, Buffer.from(json, 'utf8'))
    }
    return next
  }

  async sync(): Promise<{ events: CalendarEvent[]; count: number; error?: string }> {
    const cfg = this.getConfig()
    if (!cfg.feedUrl) {
      return { events: this.events, count: this.events.length, error: 'No Google Calendar feed URL configured' }
    }

    try {
      // Normalize webcal:// to https://
      let url = cfg.feedUrl.trim()
      if (url.startsWith('webcal://')) {
        url = 'https://' + url.slice('webcal://'.length)
      }

      const res = await this.customFetch(url, {
        headers: {
          'User-Agent': 'LifeSystem/1.3.0 (+https://github.com/vicuvi1/MEGA-SYSTEM)',
          Accept: 'text/calendar, text/plain, */*'
        },
        signal: AbortSignal.timeout(15000)
      })

      if (!res.ok) {
        const err = `Failed to fetch calendar: HTTP ${res.status} ${res.statusText}`
        this.saveConfig({ lastError: err })
        return { events: this.events, count: this.events.length, error: err }
      }

      const icsText = await res.text()
      const parsed = parseIcs(icsText)

      this.events = parsed
      this.saveCache()
      this.saveConfig({
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        cachedEventsCount: parsed.length
      })

      return { events: this.events, count: this.events.length }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to sync calendar feed'
      this.saveConfig({ lastError: errMsg })
      return { events: this.events, count: this.events.length, error: errMsg }
    }
  }

  getEvents(day?: string): CalendarEvent[] {
    if (day) {
      return filterEventsForDay(this.events, day)
    }
    return this.events
  }

  getEventsForAi(day?: string): string {
    const evts = this.getEvents(day)
    return formatCalendarSummaryForAi(evts, day)
  }

  clear(): void {
    this.events = []
    this.saveCache()
    this.saveConfig({ lastSyncAt: null, lastError: null, cachedEventsCount: 0 })
  }
}
