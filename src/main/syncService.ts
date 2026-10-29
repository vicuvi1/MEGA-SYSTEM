import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage, type BrowserWindow } from 'electron'
import {
  calculateStreakRestoration,
  deduplicateEvents,
  validateSyncEvent,
  type SyncEvent,
  type SyncResult
} from '@core/sync'
import type { Body } from './body'
import type { DB } from './db'
import type { Discipline } from './discipline'
import type { MoneyService } from './money'
import type { Tasks } from './planner'
import type { SleepService } from './sleep'
import type { Wallet } from './wallet'

export interface SyncConfig {
  syncUrl: string
  syncSecret: string
  autoSyncOnStartup: boolean
  syncIntervalMinutes: number
  lastSyncedAt: string | null
  lastSyncedCount: number
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  syncUrl: '',
  syncSecret: '',
  autoSyncOnStartup: true,
  syncIntervalMinutes: 15,
  lastSyncedAt: null,
  lastSyncedCount: 0
}

export class SyncService {
  private config: SyncConfig
  private intervalTimer: NodeJS.Timeout | null = null
  private win: BrowserWindow | null = null

  constructor(
    private db: DB,
    private wallet: Wallet,
    private discipline: Discipline,
    private moneyService: MoneyService,
    private body: Body,
    private planner: Tasks,
    private sleepService: SleepService
  ) {
    this.config = this.loadConfig()
  }

  setBrowserWindow(win: BrowserWindow): void {
    this.win = win
  }

  private configFilePath(): string {
    const userData = app?.getPath ? app.getPath('userData') : process.cwd()
    return join(userData, 'sync_config.bin')
  }

  private loadConfig(): SyncConfig {
    const path = this.configFilePath()
    if (!existsSync(path)) return { ...DEFAULT_SYNC_CONFIG }
    try {
      const encrypted = readFileSync(path)
      let decrypted: string
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        decrypted = safeStorage.decryptString(encrypted)
      } else {
        decrypted = encrypted.toString('utf-8')
      }
      return { ...DEFAULT_SYNC_CONFIG, ...JSON.parse(decrypted) }
    } catch {
      return { ...DEFAULT_SYNC_CONFIG }
    }
  }

  private saveConfigToDisk(cfg: SyncConfig): void {
    const path = this.configFilePath()
    const raw = JSON.stringify(cfg)
    try {
      let buf: Buffer
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        buf = safeStorage.encryptString(raw)
      } else {
        buf = Buffer.from(raw, 'utf-8')
      }
      writeFileSync(path, buf)
    } catch (err) {
      console.warn('SyncService safeStorage write fallback:', err)
      writeFileSync(path, Buffer.from(raw, 'utf-8'))
    }
  }

  getConfig(): SyncConfig {
    return { ...this.config }
  }

  saveConfig(patch: Partial<SyncConfig>): SyncConfig {
    this.config = {
      ...this.config,
      ...patch
    }
    this.saveConfigToDisk(this.config)
    this.restartInterval()
    return this.getConfig()
  }

  async testConnection(
    overrideUrl?: string,
    overrideSecret?: string
  ): Promise<{ success: boolean; latencyMs: number; message: string; count?: number }> {
    const targetUrl = (overrideUrl ?? this.config.syncUrl).trim().replace(/\/+$/, '')
    const targetSecret = (overrideSecret ?? this.config.syncSecret).trim()

    if (!targetUrl) {
      return { success: false, latencyMs: 0, message: 'Sync URL is required' }
    }

    const t0 = Date.now()
    try {
      const url = `${targetUrl}/api/sync?secret=${encodeURIComponent(targetSecret)}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${targetSecret}`
        },
        signal: AbortSignal.timeout(8000)
      })

      const latencyMs = Date.now() - t0
      if (!res.ok) {
        return {
          success: false,
          latencyMs,
          message: `Server returned HTTP ${res.status}: ${res.statusText}`
        }
      }

      const data = (await res.json()) as any
      return {
        success: true,
        latencyMs,
        message: `Connected successfully! 7-Day Cloud Buffer holds ${data.count ?? 0} events.`,
        count: data.count ?? 0
      }
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - t0,
        message: `Connection failed: ${err.message}`
      }
    }
  }

  async pullAndApply(): Promise<SyncResult> {
    const syncUrl = this.config.syncUrl.trim().replace(/\/+$/, '')
    const syncSecret = this.config.syncSecret.trim()

    if (!syncUrl) {
      return {
        eventsProcessed: 0,
        restoredDays: [],
        restoredStreak: 0,
        previousStreak: 0,
        errors: ['No Sync URL configured']
      }
    }

    let rawEvents: any[] = []
    try {
      const url = `${syncUrl}/api/sync?secret=${encodeURIComponent(syncSecret)}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${syncSecret}`
        },
        signal: AbortSignal.timeout(12000)
      })

      if (!res.ok) {
        throw new Error(`Sync pull failed with HTTP ${res.status}: ${res.statusText}`)
      }

      const body = (await res.json()) as any
      rawEvents = Array.isArray(body.events) ? body.events : []
    } catch (err: any) {
      return {
        eventsProcessed: 0,
        restoredDays: [],
        restoredStreak: 0,
        previousStreak: 0,
        errors: [`Pull error: ${err.message}`]
      }
    }

    if (rawEvents.length === 0) {
      return {
        eventsProcessed: 0,
        restoredDays: [],
        restoredStreak: 0,
        previousStreak: 0,
        errors: []
      }
    }

    // 1. Fetch all previously applied event IDs from SQLite
    const existingRows = this.db
      .prepare('SELECT id FROM applied_sync_events')
      .all() as { id: string }[]
    const existingIds = new Set(existingRows.map((r) => r.id))

    // 2. Validate and deduplicate events
    const validIncoming: SyncEvent[] = []
    for (const raw of rawEvents) {
      try {
        validIncoming.push(validateSyncEvent(raw))
      } catch (e: any) {
        console.warn('Skipping invalid incoming sync event:', e.message)
      }
    }

    const eventsToApply = deduplicateEvents(existingIds, validIncoming)
    if (eventsToApply.length === 0) {
      return {
        eventsProcessed: 0,
        restoredDays: [],
        restoredStreak: 0,
        previousStreak: 0,
        errors: []
      }
    }

    // 3. Existing check-in days for streak restoration math
    const checkinRows = this.db
      .prepare("SELECT day FROM discipline_events WHERE kind = 'checkin'")
      .all() as { day: string }[]
    const today = this.wallet.today(new Date())

    const streakMetrics = calculateStreakRestoration(
      checkinRows.map((r) => r.day),
      eventsToApply,
      today
    )

    const appliedIds: string[] = []
    const errors: string[] = []

    // 4. Apply each event chronologically inside a single SQLite transaction
    for (const ev of eventsToApply) {
      const evDate = new Date(ev.ts)
      try {
        switch (ev.type) {
          case 'checkin': {
            try {
              this.discipline.checkIn(evDate)
            } catch (checkinErr: any) {
              // Ignore if already checked in for that day
              if (!checkinErr?.message?.includes('Already checked in today')) {
                throw checkinErr
              }
            }
            break
          }

          case 'expense': {
            const amountBani = ev.payload?.amountBani || 0
            const category = ev.payload?.category || 'other'
            const note = ev.payload?.note || 'Telegram Mobile'
            if (amountBani > 0) {
              this.moneyService.addExpense(amountBani, category, note, evDate)
            }
            break
          }

          case 'workout': {
            const rawTitle = ev.payload?.raw || 'Mobile Workout'
            this.body.logWorkout({ title: rawTitle, items: [] }, evDate)
            break
          }

          case 'task_done': {
            const taskIndex = ev.payload?.taskIndex
            const taskId = ev.payload?.taskId
            if (typeof taskId === 'number') {
              this.planner.complete(taskId, evDate)
            } else if (typeof taskIndex === 'number') {
              const allTasks = this.planner.state(evDate).tasks
              const target = allTasks[taskIndex - 1]
              if (target && !target.done) {
                this.planner.complete(target.id, evDate)
              }
            }
            break
          }

          case 'wake': {
            if (ev.payload?.time) {
              this.sleepService.logWake(ev.payload.time, undefined, evDate)
            }
            break
          }

          case 'bed': {
            if (ev.payload?.time) {
              this.sleepService.logBed(ev.payload.time, evDate)
            }
            break
          }

          case 'oath': {
            try {
              this.discipline.oath(evDate)
            } catch {
              // Ignore if already sworn
            }
            break
          }
        }

        // Record in applied_sync_events
        this.db
          .prepare(
            `INSERT INTO applied_sync_events (id, type, day, ts, applied_at, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(ev.id, ev.type, ev.day, ev.ts, new Date().toISOString(), JSON.stringify(ev.payload))

        appliedIds.push(ev.id)
      } catch (applyErr: any) {
        errors.push(`Event ${ev.id} (${ev.type}): ${applyErr.message}`)
      }
    }

    // 5. Send ACK to Cloudflare Worker to prune acknowledged events
    if (appliedIds.length > 0) {
      try {
        const ackUrl = `${syncUrl}/api/ack?secret=${encodeURIComponent(syncSecret)}`
        await fetch(ackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${syncSecret}`
          },
          body: JSON.stringify({ ids: appliedIds }),
          signal: AbortSignal.timeout(8000)
        })
      } catch (ackErr: any) {
        console.warn('Sync ACK warning:', ackErr.message)
      }
    }

    // 6. Update local config status
    this.saveConfig({
      lastSyncedAt: new Date().toISOString(),
      lastSyncedCount: appliedIds.length
    })

    const result: SyncResult = {
      eventsProcessed: appliedIds.length,
      restoredDays: streakMetrics.restoredDays,
      restoredStreak: streakMetrics.restoredStreak,
      previousStreak: streakMetrics.previousStreak,
      errors
    }

    // 7. Notify renderer window to update all active views
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('sync:completed', result)
      this.win.webContents.send('wallet:changed')
    }

    return result
  }

  startBackgroundSync(win: BrowserWindow): void {
    this.setBrowserWindow(win)

    if (this.config.autoSyncOnStartup && this.config.syncUrl) {
      // Delay initial pull slightly (3s) to allow app window initialization
      setTimeout(() => {
        this.pullAndApply().catch((err) => console.warn('Startup sync failed:', err))
      }, 3000)
    }

    this.restartInterval()
  }

  private restartInterval(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }

    const minutes = Math.max(1, this.config.syncIntervalMinutes || 15)
    this.intervalTimer = setInterval(() => {
      if (this.config.syncUrl) {
        this.pullAndApply().catch((err) => console.warn('Periodic sync failed:', err))
      }
    }, minutes * 60 * 1000)
  }

  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
  }
}
