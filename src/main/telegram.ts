import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
  morningBriefing: boolean
  eveningNudge: boolean
}

const DEFAULT_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  enabled: false,
  morningBriefing: true,
  eveningNudge: true
}

export class TelegramNotifier {
  private file: string

  constructor(filePath?: string) {
    this.file = filePath ?? join(app.getPath('userData'), 'telegram_notify.bin')
  }

  getConfig(): TelegramConfig {
    if (!existsSync(this.file)) return { ...DEFAULT_CONFIG }
    try {
      const buf = readFileSync(this.file)
      if (!buf || !buf.length) return { ...DEFAULT_CONFIG }
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const str = safeStorage.decryptString(buf)
        return { ...DEFAULT_CONFIG, ...JSON.parse(str) }
      }
      return { ...DEFAULT_CONFIG, ...JSON.parse(buf.toString('utf8')) }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  saveConfig(patch: Partial<TelegramConfig>): TelegramConfig {
    const cur = this.getConfig()
    const next = { ...cur, ...patch }
    const json = JSON.stringify(next)
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      writeFileSync(this.file, safeStorage.encryptString(json))
    } else {
      writeFileSync(this.file, Buffer.from(json, 'utf8'))
    }
    return next
  }

  async sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getConfig()
    if (!cfg.botToken || !cfg.chatId) {
      return { ok: false, error: 'Telegram Bot Token or Chat ID is missing' }
    }

    try {
      const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text,
          parse_mode: 'HTML'
        }),
        signal: AbortSignal.timeout(10000)
      })

      const json = (await res.json()) as { ok: boolean; description?: string }
      if (!json.ok) {
        return { ok: false, error: json.description ?? 'Telegram API error' }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    return this.sendMessage(
      '⚡ <b>Life System Connected!</b>\n\nYour desktop app is successfully paired. You will receive daily check-in reminders and evening recaps here.'
    )
  }

  async sendMorningBriefing(data: {
    today: string
    streak: number
    tasksCount: number
    blocksCount: number
  }): Promise<void> {
    const cfg = this.getConfig()
    if (!cfg.enabled || !cfg.morningBriefing) return
    const text = [
      `🌅 <b>Life System: Morning Kickoff</b>`,
      `📅 ${data.today} · Streak: <b>${data.streak} days</b>`,
      ``,
      data.tasksCount > 0 ? `📋 <b>${data.tasksCount}</b> tasks waiting today` : `📋 No tasks scheduled today`,
      data.blocksCount > 0 ? `⏱ <b>${data.blocksCount}</b> focus blocks scheduled` : `⏱ No focus blocks scheduled`,
      ``,
      `<i>Win the morning, win the day!</i>`
    ].join('\n')
    await this.sendMessage(text)
  }

  async sendEveningNudge(data: {
    today: string
    coinsToday: number
    openItems: string[]
  }): Promise<void> {
    const cfg = this.getConfig()
    if (!cfg.enabled || !cfg.eveningNudge) return
    const text = [
      `🌙 <b>Life System: Evening Recap</b>`,
      `🪙 Coins earned today: <b>+${data.coinsToday}</b>`,
      ``,
      data.openItems.length > 0
        ? `⚠️ <b>Still open before midnight:</b>\n• ${data.openItems.join('\n• ')}`
        : `✅ <b>All daily tasks and check-ins complete! Fantastic work.</b>`
    ].join('\n')
    await this.sendMessage(text)
  }
}
