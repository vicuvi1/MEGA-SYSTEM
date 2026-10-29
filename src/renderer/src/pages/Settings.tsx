function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

import { useEffect, useState } from 'react'
import type { AppPrefs, AuthStatus, BackupStatus, LogEntry, TelegramConfig, BotBridgeConfig, UpdateStatus, VerifyResult, AIConfig, CalendarConfig, SyncConfig, SyncResult } from '@shared/api'
import { POPULAR_MODELS, DEFAULT_AI_CONFIG } from '@core/ai'
import { DEFAULT_CALENDAR_CONFIG } from '@shared/api'
import { UpdatePanel } from '../updates'
import { useUiPrefs } from '../uiPrefs'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { timeAgo, useAction } from '../ui'
import { soundCoin, soundFanfare, soundMechanicalClick, soundSuccess, soundSystemOracle, soundWarning } from '../sound'

function openBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not supported'))
    const req = indexedDB.open('life_backup_db', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('handles')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openBackupDb()
    return new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly')
      const req = tx.objectStore('handles').get('backupFolder')
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openBackupDb()
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(handle, 'backupFolder')
  } catch {}
}

interface Props {
  auth: AuthStatus
  onAuth: (a: AuthStatus) => void
  backup: BackupStatus | null
  onBackup: (b: BackupStatus) => void
  onRestored: () => void
  update: UpdateStatus | null
  onUpdate: (s: UpdateStatus) => void
}

export function Settings({ auth, onAuth, backup, onBackup, onRestored, update, onUpdate }: Props) {
  const act = useAction()

  const [pass, setPass] = useState('')
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [restoreName, setRestoreName] = useState('')
  const [restorePass, setRestorePass] = useState('')
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [ui, setUi] = useUiPrefs()
  const [logs, setLogs] = useState<LogEntry[] | null>(null)
  const [backupFolderName, setBackupFolderName] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('life_backup_folder_name') : '') || ''
  })
  const [backupSchedule, setBackupSchedule] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('life_backup_schedule') : '') || 'daily'
  })
  const [lastBackupTime, setLastBackupTime] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('life_last_backup_time') : '') || ''
  })
  const [backupStatusMsg, setBackupStatusMsg] = useState<string>('')
  const [botCfg, setBotCfg] = useState<BotBridgeConfig>({
    botToken: '',
    chatId: '',
    enabled: true,
    pollingEnabled: false,
    morningBriefing: true,
    eveningNudge: true,
    sportBotToken: '',
    sportBotChatId: '',
    financeBotToken: '',
    financeBotChatId: '',
    manBotToken: '',
    manBotChatId: '',
    wakyBotToken: '',
    wakyBotChatId: '',
    plannerBotToken: '',
    plannerBotChatId: '',
    coachBotToken: '',
    coachBotChatId: '',
    financeSyncEnabled: true
  })
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({})
  const [testingBotKey, setTestingBotKey] = useState<string | null>(null)
  const [botTestResult, setBotTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSuccess, setPinSuccess] = useState<string | null>(null)
  const [isUpdatingPin, setIsUpdatingPin] = useState(false)

  async function handleUpdatePin(e: React.FormEvent) {
    e.preventDefault()
    setPinError(null)
    setPinSuccess(null)

    if (auth.pinSet && !currentPin) {
      setPinError('Please enter your current PIN (default is 2007)')
      soundWarning()
      return
    }

    if (!/^\d{4,12}$/.test(newPin)) {
      setPinError('New PIN must be between 4 and 12 numeric digits')
      soundWarning()
      return
    }

    if (newPin !== confirmPin) {
      setPinError('New PIN and Confirm PIN do not match')
      soundWarning()
      return
    }

    setIsUpdatingPin(true)
    try {
      const next = await life.auth.setPin(newPin, currentPin)
      onAuth(next)
      setPinSuccess('PIN updated successfully!')
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      soundFanfare()
    } catch (err: any) {
      setPinError(err.message || 'Failed to update PIN')
      soundWarning()
    } finally {
      setIsUpdatingPin(false)
    }
  }

  async function handleLockNow() {
    try {
      soundMechanicalClick()
      const next = await life.auth.lock()
      onAuth(next)
    } catch (err: any) {
      setPinError(err.message || 'Failed to lock app')
    }
  }

  useEffect(() => {
    life.bots.config().then((c) => {
      if (c) setBotCfg(c)
    }).catch(() => {})
  }, [])

  async function saveBotArmy() {
    const next = await act(() => life.bots.saveConfig(botCfg), 'Telegram Bot Army settings saved')
    if (next) setBotCfg(next)
  }

  async function testBotIndividual(botKey?: string) {
    setTestingBotKey(botKey || 'master')
    setBotTestResult(null)
    try {
      await life.bots.saveConfig(botCfg)
      const res = await life.bots.test(botKey)
      if (res.ok) {
        setBotTestResult({ ok: true, message: `Ping message delivered successfully${botKey ? ` to ${botKey} bot` : ''}!` })
      } else {
        setBotTestResult({ ok: false, message: res.error || 'Failed to ping bot' })
      }
    } catch (e: any) {
      setBotTestResult({ ok: false, message: e.message || 'Test delivery failed' })
    } finally {
      setTestingBotKey(null)
    }
  }

  const toggleTokenVisibility = (key: string) => {
    setShowTokens((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const BOTS_METADATA = [
    {
      key: 'master',
      tokenField: 'botToken' as const,
      chatField: 'chatId' as const,
      icon: '👑',
      name: 'Master / Central Life System Bot',
      badge: 'Hub Leader',
      desc: 'Central brain & orchestrator: executes /today status overview, /checkin streak confirmations, /vault surplus balance, /tasks, and emergency /panic protocols.'
    },
    {
      key: 'finance',
      tokenField: 'financeBotToken' as const,
      chatField: 'financeBotChatId' as const,
      icon: '💰',
      name: 'Finance & Money Bot',
      badge: 'Auto-Sync Active',
      desc: 'Fast natural expense logger: send "coffee 35", "taxi 50", "lunch 120", "+500 salary", or "/balance". Automatically synchronized with embedded Finance Helper App ledger!'
    },
    {
      key: 'sport',
      tokenField: 'sportBotToken' as const,
      chatField: 'sportBotChatId' as const,
      icon: '🏃',
      name: 'Body, Sport & Athlete Bot',
      badge: 'Hunter Power',
      desc: 'Athletic counter & metrics: logs /sport run 5km, /pushups 50, /bench 80kg, body composition (/weight 74.5, /waist 82), and Hunter PR records.'
    },
    {
      key: 'man',
      tokenField: 'manBotToken' as const,
      chatField: 'manBotChatId' as const,
      icon: '🛡️',
      name: 'MAN Spartan Discipline Bot',
      badge: 'Discipline Shield',
      desc: 'Discipline sentinel: morning warrior oath (/oath), clean streak affirmations (/checkin), and instant urge suppression protocols (/panic).'
    },
    {
      key: 'waky',
      tokenField: 'wakyBotToken' as const,
      chatField: 'wakyBotChatId' as const,
      icon: '🌙',
      name: 'Waky Sleep & Circadian Bot',
      badge: 'Circadian Guard',
      desc: 'Sleep optimizer: on-time wake check-in (/wake), bedtime streak logging (/bed), and circadian alignment monitoring.'
    },
    {
      key: 'planner',
      tokenField: 'plannerBotToken' as const,
      chatField: 'plannerBotChatId' as const,
      icon: '🎯',
      name: 'Task & Quest Execution Bot',
      badge: 'Quest Dispatcher',
      desc: 'Task command: lists active tasks (/tasks), completes to-dos remotely (/done 1), and tracks quest milestones.'
    },
    {
      key: 'coach',
      tokenField: 'coachBotToken' as const,
      chatField: 'coachBotChatId' as const,
      icon: '🤖',
      name: 'AI System Tactical Coach Bot',
      badge: 'Solo Leveling AI',
      desc: 'Tactical mentor: Hunter strategic advice, habit debriefs, and real-time motivational coaching directly in Telegram.'
    }
  ]

  const [aiCfg, setAiCfg] = useState<AIConfig>(DEFAULT_AI_CONFIG)
  const [showGemini, setShowGemini] = useState(false)
  const [showOr, setShowOr] = useState(false)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string; model: string } | null>(null)

  useEffect(() => {
    life.ai.config().then(setAiCfg).catch(() => {})
  }, [])

  async function saveAiConfig() {
    const next = await act(() => life.ai.saveConfig(aiCfg), 'AI configuration saved')
    if (next) setAiCfg(next)
  }

  async function testAiConnection(provider?: 'gemini' | 'openrouter') {
    setTestingProvider(provider || 'auto')
    setAiTestResult(null)
    try {
      const saved = await life.ai.saveConfig(aiCfg)
      if (saved) setAiCfg(saved)
      const res = await life.ai.test(provider)
      setAiTestResult(res)
    } catch (err: any) {
      setAiTestResult({ ok: false, message: err?.message || 'Connection failed', model: 'none' })
    } finally {
      setTestingProvider(null)
    }
  }

  const [calCfg, setCalCfg] = useState<CalendarConfig>(DEFAULT_CALENDAR_CONFIG)
  const [syncingCal, setSyncingCal] = useState(false)
  const [calSyncMsg, setCalSyncMsg] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    life.calendar.config().then(setCalCfg).catch(() => {})
  }, [])

  const [syncCfg, setSyncCfg] = useState<SyncConfig>({
    syncUrl: '',
    syncSecret: '',
    autoSyncOnStartup: true,
    syncIntervalMinutes: 15,
    lastSyncedAt: null,
    lastSyncedCount: 0
  })
  const [syncTestMsg, setSyncTestMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [syncingNow, setSyncingNow] = useState(false)
  const [showSyncSecret, setShowSyncSecret] = useState(false)
  const [syncInstructionsOpen, setSyncInstructionsOpen] = useState(false)

  useEffect(() => {
    life.sync.config().then(setSyncCfg).catch(() => {})
  }, [])

  async function saveSyncConfig() {
    const next = await act(() => life.sync.saveConfig(syncCfg), 'Mobile Cloud Sync settings saved')
    if (next) setSyncCfg(next)
  }

  async function testSyncConnection() {
    setSyncTestMsg(null)
    try {
      const res = await life.sync.test(syncCfg.syncUrl, syncCfg.syncSecret)
      setSyncTestMsg({ ok: res.success, message: `${res.message} (${res.latencyMs}ms)` })
      if (res.success) soundFanfare()
      else soundWarning()
    } catch (e: any) {
      setSyncTestMsg({ ok: false, message: e?.message || 'Connection test failed' })
      soundWarning()
    }
  }

  async function pullSyncNow() {
    setSyncingNow(true)
    setSyncTestMsg(null)
    try {
      const res = await life.sync.pull()
      if (res.errors.length > 0) {
        setSyncTestMsg({ ok: false, message: `Sync completed with warnings: ${res.errors.join('; ')}` })
      } else {
        const streakInfo = res.restoredStreak > res.previousStreak ? ` 🛡️ Streak healed: ${res.previousStreak} → ${res.restoredStreak} days!` : ''
        setSyncTestMsg({ ok: true, message: `Auto-Synced ${res.eventsProcessed} events from mobile!${streakInfo}` })
        soundCoin()
      }
      const updated = await life.sync.config()
      setSyncCfg(updated)
    } catch (e: any) {
      setSyncTestMsg({ ok: false, message: e?.message || 'Sync pull failed' })
    } finally {
      setSyncingNow(false)
    }
  }

  async function saveCalendarConfig() {
    const next = await act(() => life.calendar.saveConfig(calCfg), 'Calendar settings saved')
    if (next) setCalCfg(next)
  }

  async function syncCalendarNow() {
    setSyncingCal(true)
    setCalSyncMsg(null)
    try {
      const res = await life.calendar.sync()
      if (res.error) {
        setCalSyncMsg({ ok: false, message: res.error })
      } else {
        setCalSyncMsg({ ok: true, message: `Synced ${res.count} events from Google Calendar!` })
        const next = await life.calendar.config()
        setCalCfg(next)
      }
    } catch (e: any) {
      setCalSyncMsg({ ok: false, message: e?.message || 'Sync failed' })
    } finally {
      setSyncingCal(false)
    }
  }


  useEffect(() => {
    life.app.recentErrors().then(setLogs).catch(() => setLogs([]))
  }, [])

  useEffect(() => {
    life.app.prefs().then(setPrefs)
  }, [])

  async function changePrefs(p: Partial<AppPrefs>) {
    const next = await act(() => life.app.setPrefs(p))
    if (next) setPrefs(next)
  }

  useEffect(() => {
    life.backup.list().then((n) => {
      setNames(n.slice().reverse())
      setRestoreName(n[n.length - 1] ?? '')
    })
  }, [backup])

  useEffect(() => {
    const checkSchedule = async () => {
      const sched = localStorage.getItem('life_backup_schedule') || 'daily'
      if (sched === 'manual') return
      const last = localStorage.getItem('life_last_backup_time')
      const now = Date.now()
      let intervalMs = 24 * 3600 * 1000
      if (sched === '12h') intervalMs = 12 * 3600 * 1000
      else if (sched === 'session') intervalMs = 60 * 1000

      if (!last || now - new Date(last).getTime() > intervalMs) {
        const handle = await getStoredDirectoryHandle()
        if (handle) {
          try {
            await saveBackupToHandle(handle)
          } catch {}
        }
      }
    }
    checkSchedule()
  }, [])

  async function saveBackupToHandle(handle: FileSystemDirectoryHandle) {
    try {
      const dumpStr = await life.data.exportJson()
      const now = new Date()
      const filename = `life-system-backup-${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`
      const fileHandle = await (handle as any).getFileHandle(filename, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(dumpStr)
      await writable.close()
      const nowIso = now.toISOString()
      setLastBackupTime(nowIso)
      localStorage.setItem('life_last_backup_time', nowIso)
      setBackupStatusMsg(`✅ Saved fresh backup: ${filename} to ${handle.name}!`)
      soundCoin()
    } catch {
      await handleDownloadBackupFile()
    }
  }

  async function handleDownloadBackupFile() {
    try {
      const dumpStr = await life.data.exportJson()
      const now = new Date()
      const filename = `life-system-backup-${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`
      const blob = new Blob([dumpStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      const nowIso = now.toISOString()
      setLastBackupTime(nowIso)
      localStorage.setItem('life_last_backup_time', nowIso)
      setBackupStatusMsg(`✅ Downloaded: ${filename}!`)
      soundCoin()
    } catch (e: any) {
      setBackupStatusMsg('Error exporting backup: ' + (e as Error).message)
    }
  }

  async function handleSelectFolder() {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
        await storeDirectoryHandle(handle)
        setBackupFolderName(handle.name)
        localStorage.setItem('life_backup_folder_name', handle.name)
        setBackupStatusMsg(`📁 Selected folder: ${handle.name}. Automatic backups enabled!`)
        soundSuccess()
        await saveBackupToHandle(handle)
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setBackupStatusMsg('Could not access folder: ' + e.message)
        }
      }
    } else {
      const folder = window.prompt(
        'Enter your preferred local backup folder path on your PC (e.g. C:\\Users\\victo\\Documents\\LifeSystem Backups):',
        backupFolderName || 'C:\\Users\\victo\\Documents\\LifeSystem Backups'
      )
      if (folder) {
        setBackupFolderName(folder)
        localStorage.setItem('life_backup_folder_name', folder)
        setBackupStatusMsg(`📁 Folder set to: ${folder}. Backups will download to your computer on schedule!`)
        handleDownloadBackupFile()
      }
    }
  }

  async function handleSaveBackupNow() {
    const handle = await getStoredDirectoryHandle()
    if (handle) {
      try {
        const perm = await (handle as any).requestPermission({ mode: 'readwrite' })
        if (perm === 'granted') {
          await saveBackupToHandle(handle)
          return
        }
      } catch {}
    }
    await handleDownloadBackupFile()
  }

  async function handleFileRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.tables && !data.version && !data.settings) {
        throw new Error('Invalid backup file structure')
      }
      if (!window.confirm(`Restore data from "${file.name}"? This will update your cloud database and local state.`)) return

      if (data.financeState) {
        localStorage.setItem('finance-helper.state', JSON.stringify(data.financeState))
      }
      if (data.wakyState) {
        localStorage.setItem('waky_web_data_v2', JSON.stringify(data.wakyState))
      }
      setBackupStatusMsg(`🎉 Successfully restored backup from "${file.name}"! Reloading...`)
      soundSuccess()
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } catch (err: any) {
      setBackupStatusMsg('Failed to restore backup: ' + (err as Error).message)
      soundWarning()
    }
  }

  async function savePass() {
    const b = await act(() => life.backup.setPassphrase(pass), 'Passphrase saved. Backup written.')
    if (b) {
      onBackup(b)
      setPass('')
    }
  }

  async function restore() {
    if (!window.confirm(`Replace all current data with ${restoreName}? A backup of the current state is made first.`)) return
    const ok = await act(async () => {
      await life.backup.restore(restoreName, restorePass)
      return true
    }, 'Restored')
    if (ok) {
      setRestorePass('')
      onRestored()
    }
  }

  return (
    <div className="settings">
      <UpdatePanel status={update} onStatus={onUpdate} />

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="sun" /> Appearance
          </h2>
        </header>
        <div className="field">
          <span>Theme</span>
          <div className="seg">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} type="button" className={ui.theme === t ? 'on' : ''} onClick={() => setUi({ theme: t })}>
                {t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'Like Windows'}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Your name, for the greeting on Today</span>
          <input value={ui.name} maxLength={30} placeholder="e.g. Victor" onChange={(e) => setUi({ name: e.target.value })} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <label className="check toggle-row" style={{ margin: 0 }}>
            <input type="checkbox" checked={ui.sound} onChange={(e) => setUi({ sound: e.target.checked })} />
            <span>
              Cyberpunk & Solo Leveling Audio Effects
              <small>Rich, low-latency synthesized audio for rituals, tasks, coins, and system warnings.</small>
            </span>
          </label>

          {ui.sound && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Master SFX Volume</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: '#00d2ff', fontWeight: 700 }}>{ui.volume ?? 80}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={ui.volume ?? 80}
                onChange={(e) => setUi({ volume: Number(e.target.value) })}
                style={{ width: '100%', accentColor: '#00d2ff' }}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                <button type="button" className="btn small ghost" onClick={() => soundSystemOracle()}>
                  ⚔️ System Oracle
                </button>
                <button type="button" className="btn small ghost" onClick={() => soundCoin()}>
                  💰 Gold Clink
                </button>
                <button type="button" className="btn small ghost" onClick={() => soundMechanicalClick()}>
                  ⌨️ Mechanical Click
                </button>
                <button type="button" className="btn small ghost" onClick={() => soundFanfare()}>
                  🏆 Rank Fanfare
                </button>
                <button type="button" className="btn small ghost" onClick={() => soundWarning()}>
                  ⚠️ Conflict Alert
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="hint block">Size: Ctrl + and Ctrl − make everything bigger or smaller, Ctrl 0 resets. The apps inside keep their own dark look in the light theme.</p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="lock" /> Security & App PIN Lock
          </h2>
          <span className={`chip ${auth.pinSet ? 'ok' : 'warn'}`}>
            {auth.pinSet ? 'PIN Protected (Default: 2007)' : 'No PIN Set'}
          </span>
        </header>
        <p className="hint block">
          Secure your Life System cockpit against unauthorized access. The default master PIN is <strong>2007</strong>. You can change it below at any time.
        </p>

        <form onSubmit={handleUpdatePin} className="pin-settings-form">
          <div className="grid col-3 gap" style={{ gridTemplateColumns: auth.pinSet ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {auth.pinSet && (
              <div className="field">
                <span>Current PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="Current PIN (e.g. 2007)"
                  value={currentPin}
                  maxLength={12}
                  autoComplete="current-password"
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            )}
            <div className="field">
              <span>New PIN (4–12 digits)</span>
              <input
                type="password"
                inputMode="numeric"
                placeholder="New numeric PIN"
                value={newPin}
                maxLength={12}
                autoComplete="new-password"
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="field">
              <span>Confirm New PIN</span>
              <input
                type="password"
                inputMode="numeric"
                placeholder="Re-enter new PIN"
                value={confirmPin}
                maxLength={12}
                autoComplete="new-password"
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          {pinError && (
            <div className="err" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px' }}>
              ⚠️ {pinError}
            </div>
          )}
          {pinSuccess && (
            <div className="good" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '6px', color: 'var(--green, #22c55e)' }}>
              ✓ {pinSuccess}
            </div>
          )}

          <div className="row" style={{ marginTop: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="btn primary"
              disabled={isUpdatingPin || newPin.length < 4 || confirmPin.length < 4}
            >
              {isUpdatingPin ? 'Saving PIN...' : 'Update PIN'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={handleLockNow}
              title="Immediately lock the application and return to the PIN screen"
            >
              <Icon name="lock" size={15} /> Lock App Now
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="spark" /> AI Intelligence & Multi-Model Oracle
          </h2>
          <span className={`chip ${aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'ok' : 'muted'}`}>
            {aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'Oracle Active' : 'Not Configured'}
          </span>
        </header>
        <p className="hint block">
          Connect Google Gemini (official free API keys) or OpenRouter (DeepSeek V3/R1, Claude, GPT) to unlock AI dream reward generation, Solo Leveling performance reports, and tactical coaching.
        </p>

        <div className="field">
          <span>Official Google Gemini API Key (Free)</span>
          <div className="row">
            <input
              type={showGemini ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={aiCfg.geminiKey}
              onChange={(e) => setAiCfg({ ...aiCfg, geminiKey: e.target.value })}
            />
            <button className="btn ghost" type="button" onClick={() => setShowGemini(!showGemini)}>
              {showGemini ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!aiCfg.geminiKey || testingProvider === 'gemini'}
              onClick={() => testAiConnection('gemini')}
            >
              {testingProvider === 'gemini' ? 'Testing...' : 'Test Gemini'}
            </button>
          </div>
          <small className="hint">
            Get a free key instantly from <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a>. Free models: Gemini 3.5 Flash, 3.1 Flash Lite, 3.8 Flash.
          </small>
        </div>

        <div className="field">
          <span>OpenRouter API Key (DeepSeek V3 / DeepSeek R1 / Claude / GPT)</span>
          <div className="row">
            <input
              type={showOr ? 'text' : 'password'}
              placeholder="sk-or-v1-..."
              value={aiCfg.openRouterKey}
              onChange={(e) => setAiCfg({ ...aiCfg, openRouterKey: e.target.value })}
            />
            <button className="btn ghost" type="button" onClick={() => setShowOr(!showOr)}>
              {showOr ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!aiCfg.openRouterKey || testingProvider === 'openrouter'}
              onClick={() => testAiConnection('openrouter')}
            >
              {testingProvider === 'openrouter' ? 'Testing...' : 'Test OpenRouter'}
            </button>
          </div>
          <small className="hint">
            Connect to openrouter.ai to access DeepSeek V3, DeepSeek R1 reasoning models, and 100+ open models.
          </small>
        </div>

        <div className="field">
          <span>Model Routing Strategy</span>
          <select
            value={aiCfg.selectedModel}
            onChange={(e) => setAiCfg({ ...aiCfg, selectedModel: e.target.value })}
          >
            <option value="auto">⚡ Auto (Smart Task Routing: Flash for rewards, DeepSeek R1/Pro for strategy)</option>
            <optgroup label="Official Google Gemini (Direct / Free)">
              {POPULAR_MODELS.filter((m) => m.provider === 'gemini').map((m) => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="OpenRouter Models">
              {POPULAR_MODELS.filter((m) => m.provider === 'openrouter').map((m) => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        <label className="check toggle-row">
          <input
            type="checkbox"
            checked={aiCfg.enabled}
            onChange={(e) => setAiCfg({ ...aiCfg, enabled: e.target.checked })}
          />
          <span>
            Enable AI Systems
            <small>Allows the Shop to summon dream reward ideas and Journey to compile Solo Leveling tactical reports.</small>
          </span>
        </label>

        {aiTestResult && (
          <div className={`notice ${aiTestResult.ok ? 'ok' : 'warn'}`} style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}>
            <b>{aiTestResult.ok ? '✅ Connection Verified:' : '❌ Connection Problem:'}</b>{' '}
            {aiTestResult.message} {aiTestResult.model ? `(${aiTestResult.model})` : ''}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button className="btn primary" onClick={saveAiConfig}>
            Save AI Configuration
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={(!aiCfg.geminiKey && !aiCfg.openRouterKey) || testingProvider !== null}
            onClick={() => testAiConnection()}
          >
            {testingProvider === 'auto' ? 'Testing...' : 'Test Active Auto-Route'}
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="calendar" /> Google Calendar Integration
          </h2>
          <span className={`chip ${calCfg.enabled && calCfg.feedUrl ? 'ok' : 'ghost'}`}>
            {calCfg.enabled && calCfg.feedUrl ? 'Connected' : 'Disabled'}
          </span>
        </header>

        <p className="hint block">
          Connect your Google Calendar so the <b>Solo Leveling AI Oracle</b> and Hunter Coach can view your schedule, upcoming commitments, and daily agenda.
        </p>

        <div className="field">
          <span>Google Calendar iCal Feed URL (Private Secret Address)</span>
          <input
            type="url"
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            value={calCfg.feedUrl}
            onChange={(e) => setCalCfg({ ...calCfg, feedUrl: e.target.value })}
          />
          <small className="hint">
            <b>How to get it in 3 steps:</b> 1. Open Google Calendar (web) → 2. Click Settings ⚙️ → select your calendar under <i>Settings for my calendars</i> on the left → 3. Scroll down to <i>"Secret address in iCal format"</i>, copy the link, and paste here.
          </small>
        </div>

        <label className="check toggle-row">
          <input
            type="checkbox"
            checked={calCfg.enabled}
            onChange={(e) => setCalCfg({ ...calCfg, enabled: e.target.checked })}
          />
          <span>
            Enable Calendar Synchronization & AI Visibility
            <small>AI Oracle includes your daily agenda in strategic performance reports & coach chat.</small>
          </span>
        </label>

        {calCfg.lastSyncAt && (
          <dl className="facts" style={{ margin: '0.75rem 0' }}>
            <dt>Last Synced</dt>
            <dd>{timeAgo(calCfg.lastSyncAt)}</dd>
            <dt>Cached Events</dt>
            <dd>{calCfg.cachedEventsCount} events synchronized</dd>
            {calCfg.lastError && (
              <>
                <dt>Last Issue</dt>
                <dd className="warn-text">{calCfg.lastError}</dd>
              </>
            )}
          </dl>
        )}

        {calSyncMsg && (
          <div
            className={`notice ${calSyncMsg.ok ? 'ok' : 'warn'}`}
            style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}
          >
            {calSyncMsg.ok ? '✅ ' : '❌ '} {calSyncMsg.message}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button className="btn primary" onClick={saveCalendarConfig}>
            Save Calendar Settings
          </button>
          <button
            className="btn ghost"
            disabled={!calCfg.feedUrl || syncingCal}
            onClick={syncCalendarNow}
          >
            {syncingCal ? 'Syncing...' : 'Sync Calendar Now'}
          </button>
        </div>
      </section>

      
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="cloud" /> 24/7 Mobile Cloud Sync & Telegram Buffer
          </h2>
          <span className={`chip ${syncCfg.syncUrl ? 'ok' : 'ghost'}`}>
            {syncCfg.syncUrl ? 'Buffer Connected' : 'Setup Required'}
          </span>
        </header>

        <p className="hint block">
          Keep your streaks alive 24/7 even when your PC is off! Log habits, tasks, workouts, and expenses from your phone via Telegram, buffered in Cloudflare KV, and auto-synced to your PC on boot.
        </p>

        <div className="field">
          <span>Cloudflare Worker Sync URL</span>
          <input
            type="url"
            placeholder="https://life-system-sync.yourname.workers.dev"
            value={syncCfg.syncUrl}
            onChange={(e) => setSyncCfg({ ...syncCfg, syncUrl: e.target.value })}
          />
          <small className="hint">
            The public URL of your deployed 24/7 Cloudflare Worker.
          </small>
        </div>

        <div className="field">
          <span>Sync Secret Token</span>
          <div className="row" style={{ gap: '0.5rem' }}>
            <input
              type={showSyncSecret ? 'text' : 'password'}
              placeholder="Enter secret token"
              value={syncCfg.syncSecret}
              style={{ flex: 1 }}
              onChange={(e) => setSyncCfg({ ...syncCfg, syncSecret: e.target.value })}
            />
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowSyncSecret(!showSyncSecret)}
              style={{ padding: '0.4rem 0.8rem' }}
            >
              {showSyncSecret ? 'Hide' : 'Show'}
            </button>
          </div>
          <small className="hint">
            Bearer authentication token protecting your sync endpoint from unauthorized access.
          </small>
        </div>

        <div className="row" style={{ gap: '1.5rem', flexWrap: 'wrap' }}>
          <label className="check toggle-row" style={{ flex: 1, minWidth: '240px' }}>
            <input
              type="checkbox"
              checked={syncCfg.autoSyncOnStartup}
              onChange={(e) => setSyncCfg({ ...syncCfg, autoSyncOnStartup: e.target.checked })}
            />
            <span>
              Auto-Sync On PC Startup
              <small>Instantly pulls missed mobile logs and heals your streak whenever Life System launches.</small>
            </span>
          </label>

          <div className="field" style={{ minWidth: '160px' }}>
            <span>Auto-Sync Interval (minutes)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={syncCfg.syncIntervalMinutes}
              onChange={(e) => setSyncCfg({ ...syncCfg, syncIntervalMinutes: Math.max(1, parseInt(e.target.value, 10) || 15) })}
            />
          </div>
        </div>

        {syncCfg.lastSyncedAt && (
          <dl className="facts" style={{ margin: '0.75rem 0' }}>
            <dt>Last Synced</dt>
            <dd>{timeAgo(syncCfg.lastSyncedAt)}</dd>
            <dt>Last Sync Volume</dt>
            <dd>{syncCfg.lastSyncedCount} events applied</dd>
          </dl>
        )}

        {syncTestMsg && (
          <div
            className={`notice ${syncTestMsg.ok ? 'ok' : 'warn'}`}
            style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}
          >
            {syncTestMsg.ok ? '✅ ' : '❌ '} {syncTestMsg.message}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={saveSyncConfig}>
            Save Sync Settings
          </button>
          <button
            className="btn ghost"
            disabled={!syncCfg.syncUrl}
            onClick={testSyncConnection}
          >
            Test Connection
          </button>
          <button
            className="btn ghost"
            disabled={!syncCfg.syncUrl || syncingNow}
            onClick={pullSyncNow}
          >
            {syncingNow ? 'Syncing...' : 'Sync Now (Heal Streaks)'}
          </button>
        </div>

        <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
            onClick={() => setSyncInstructionsOpen(!syncInstructionsOpen)}
          >
            {syncInstructionsOpen ? '▲ Hide 3-Minute Cloudflare Setup Guide' : '▼ View 3-Minute Cloudflare Setup Guide'}
          </button>

          {syncInstructionsOpen && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.82rem', lineHeight: '1.5', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px' }}>
              <p style={{ margin: '0 0 0.5rem 0' }}><b>Quick 3-step setup (100% Free forever):</b></p>
              <ol style={{ paddingLeft: '1.2rem', margin: 0 }}>
                <li>In project folder <code>cloud/</code>, deploy the worker using <code>npx wrangler deploy</code> (or paste <code>cloud/worker.ts</code> into your Cloudflare dashboard).</li>
                <li>Link your Telegram Bot Webhook: open <code>https://api.telegram.org/bot&lt;BOT_TOKEN&gt;/setWebhook?url=&lt;WORKER_URL&gt;/webhook</code> in your browser.</li>
                <li>Copy the Worker URL &amp; Secret into this panel, click <b>Test Connection</b>, and you are ready! You can now message <code>/checkin</code>, <code>35 coffee</code>, or <code>/done 1</code> from your phone anytime.</li>
              </ol>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="bot" /> Telegram Multi-Bot Army & Tokens Hub
          </h2>
          <span className={`chip ${botCfg.enabled && botCfg.botToken ? 'ok' : 'muted'}`}>
            {botCfg.enabled && botCfg.botToken ? 'Army Active' : 'Setup Required'}
          </span>
        </header>

        <p className="hint block">
          Connect your dedicated Telegram bots individually. Each bot specializes in a specific life domain, while all data, streaks, and balances synchronize in real-time across your entire Life System and embedded Finance Helper app!
        </p>

        {/* 7 Individual Bot Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', margin: '1rem 0' }}>
          {BOTS_METADATA.map((b) => {
            const hasToken = !!botCfg[b.tokenField]
            const isRevealed = !!showTokens[b.key]
            const isTestingThis = testingBotKey === b.key
            return (
              <div
                key={b.key}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: hasToken ? '1px solid rgba(0, 210, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  boxShadow: hasToken ? '0 0 15px rgba(0, 210, 255, 0.05)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.4rem' }}>{b.icon}</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{b.name}</h3>
                      <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{b.badge}</small>
                    </div>
                  </div>
                  <span className={`chip small ${hasToken ? 'ok' : 'ghost'}`}>
                    {hasToken ? 'Connected' : 'Empty'}
                  </span>
                </div>

                <p style={{ margin: '0.2rem 0', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  {b.desc}
                </p>

                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Bot Token (from @BotFather)</label>
                  <div className="row" style={{ gap: '0.4rem' }}>
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      placeholder="123456789:AA..."
                      value={botCfg[b.tokenField] || ''}
                      onChange={(e) => setBotCfg({ ...botCfg, [b.tokenField]: e.target.value.trim() })}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                    />
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => toggleTokenVisibility(b.key)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                </div>

                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Assigned Telegram Chat ID</label>
                  <input
                    type="text"
                    placeholder={b.key === 'master' ? 'e.g. 12345678 (whitelist)' : `Defaults to ${botCfg.chatId || 'Master Chat ID'}`}
                    value={botCfg[b.chatField] || ''}
                    onChange={(e) => setBotCfg({ ...botCfg, [b.chatField]: e.target.value.trim() })}
                    style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                  />
                </div>

                {b.key === 'finance' && (
                  <label className="check toggle-row" style={{ margin: '0.2rem 0', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={botCfg.financeSyncEnabled ?? true}
                      onChange={(e) => setBotCfg({ ...botCfg, financeSyncEnabled: e.target.checked })}
                    />
                    <span>
                      Sync with Finance Helper App
                      <small>Auto-records to Finance ledger and Google Drive backup</small>
                    </span>
                  </label>
                )}

                <div style={{ marginTop: 'auto', paddingTop: '0.4rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={!botCfg[b.tokenField] || testingBotKey !== null}
                    onClick={() => testBotIndividual(b.key)}
                    style={{ fontSize: '0.78rem' }}
                  >
                    {isTestingThis ? 'Testing...' : `Test ${b.name.split(' ')[0]} Bot`}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Global Hub Options */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
          <label className="check toggle-row">
            <input
              type="checkbox"
              checked={botCfg.pollingEnabled}
              onChange={(e) => setBotCfg({ ...botCfg, pollingEnabled: e.target.checked })}
            />
            <span>
              Enable Automatic 2-Way Long Polling on Startup
              <small>Allows all configured bots to continuously receive commands and natural expenses in real time.</small>
            </span>
          </label>

          <label className="check toggle-row">
            <input
              type="checkbox"
              checked={botCfg.morningBriefing}
              onChange={(e) => setBotCfg({ ...botCfg, morningBriefing: e.target.checked })}
            />
            <span>
              Morning Briefing Notification
              <small>Delivers your morning agenda, rituals status, and streak affirmations at wake-up time.</small>
            </span>
          </label>

          <label className="check toggle-row">
            <input
              type="checkbox"
              checked={botCfg.eveningNudge}
              onChange={(e) => setBotCfg({ ...botCfg, eveningNudge: e.target.checked })}
            />
            <span>
              Evening Bedtime & Habit Nudge
              <small>Sends nightly habit wrap-up and reminds you to affirm your clean streak and bedtime.</small>
            </span>
          </label>
        </div>

        {botTestResult && (
          <div
            className={`notice ${botTestResult.ok ? 'ok' : 'warn'}`}
            style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}
          >
            {botTestResult.ok ? '✅ ' : '❌ '} {botTestResult.message}
          </div>
        )}

        <div className="row" style={{ marginTop: '1rem', gap: '0.8rem' }}>
          <button className="btn primary" onClick={saveBotArmy}>
            Save All Bot Tokens & Settings
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={testingBotKey !== null}
            onClick={() => testBotIndividual('all')}
          >
            {testingBotKey === 'all' ? 'Testing Army...' : 'Test All Connected Bots'}
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="cloud" /> Data Safety & Automated Regular Backups
          </h2>
          <span className="chip ok">☁️ Turso Cloud Sync: Active</span>
        </header>

        <p className="hint block">
          Your life operating data is critical. Everything is backed up continuously to your Turso Cloud database.
          You can select a dedicated local folder on your PC (or your cloud drive folder) where automated full timestamped backups are saved regularly.
        </p>

        <dl className="facts">
          <dt>Cloud Database</dt>
          <dd className="mono">libsql://life-os-vicuvi1.aws-eu-central-1.turso.io</dd>

          <dt>Local Backup Folder</dt>
          <dd>
            {backupFolderName ? (
              <span className="ok-text" style={{ fontWeight: 600 }}>📁 {backupFolderName}</span>
            ) : (
              <span className="muted">No folder selected yet</span>
            )}
          </dd>

          <dt>Auto-Backup Schedule</dt>
          <dd>
            <select
              value={backupSchedule}
              onChange={(e) => {
                setBackupSchedule(e.target.value)
                localStorage.setItem('life_backup_schedule', e.target.value)
              }}
              style={{ width: 'auto', display: 'inline-block', padding: '4px 10px', fontSize: '13px' }}
            >
              <option value="daily">Every 24 Hours (Daily)</option>
              <option value="12h">Every 12 Hours</option>
              <option value="session">Every Session (On Open)</option>
              <option value="manual">Manual Only</option>
            </select>
          </dd>

          <dt>Last Full Snapshot</dt>
          <dd>{lastBackupTime ? `${timeAgo(lastBackupTime)} (${new Date(lastBackupTime).toLocaleTimeString()})` : 'Ready to create'}</dd>
        </dl>

        <div className="row" style={{ flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
          <button className="btn primary" onClick={handleSelectFolder}>
            📁 {backupFolderName ? 'Change Backup Folder' : 'Select Backup Folder on PC'}
          </button>

          <button className="btn" onClick={handleSaveBackupNow}>
            ⚡ Back Up Now
          </button>

          <button className="btn ghost" onClick={handleDownloadBackupFile}>
            💾 Download Backup (.json)
          </button>

          <label className="btn ghost" style={{ cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center' }}>
            📥 Restore from Backup File
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFileRestore}
            />
          </label>
        </div>

        {backupStatusMsg && (
          <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid #22c55e', borderRadius: '6px', color: '#22c55e', fontSize: '13px' }}>
            {backupStatusMsg}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="list" /> Diagnostics
          </h2>
          <span className={`chip ${logs && logs.some((l) => l.level === 'error') ? 'warn' : 'ok'}`}>{logs && logs.length ? `${logs.length} logged` : 'No problems'}</span>
        </header>
        <p className="hint block">Problems are saved to a log here instead of popping up error windows. If something misbehaves, this is what to send.</p>
        {logs && logs.length > 0 && (
          <ul className="log-list">
            {logs.slice(0, 8).map((l, i) => (
              <li key={i} className={l.level}>
                <span className="log-level">{l.level}</span>
                <span className="log-msg">
                  <b>{l.message}</b>
                  <small>
                    {l.source} · {timeAgo(l.at)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="btn" onClick={() => life.app.openLogs()}>
            Open log folder
          </button>
          <button className="btn ghost" onClick={() => life.app.recentErrors().then(setLogs)}>
            Refresh
          </button>
          {logs && logs.length > 0 && (
            <button
              className="btn ghost"
              onClick={async () => {
                const text = logs.map((l) => `${l.at} ${l.level} [${l.source}] ${l.message}\n${l.detail ?? ''}`).join('\n')
                await act(() => navigator.clipboard.writeText(text), 'Copied')
              }}
            >
              Copy all
            </button>
          )}
        </div>
      </section>

      {prefs && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="bolt" /> Background
            </h2>
          </header>
          <label className="check toggle-row">
            <input type="checkbox" checked={prefs.keepInTray} onChange={(e) => changePrefs({ keepInTray: e.target.checked })} />
            <span>
              Keep running in the tray when the window is closed
              <small>Needed for block reminders. Quit from the tray icon.</small>
            </span>
          </label>
          <label className="check toggle-row">
            <input type="checkbox" checked={prefs.matchAppThemes} onChange={(e) => changePrefs({ matchAppThemes: e.target.checked })} />
            <span>
              Match the apps to Life System's look
              <small>Finance Helper, Waky and MAN use Life System's dark colors and fonts. Picking a theme inside an app overrides it for that app; switching this off and on brings Life System's look back.</small>
            </span>
          </label>
          <label className={`check toggle-row ${prefs.canAutoStart ? '' : 'muted'}`}>
            <input type="checkbox" disabled={!prefs.canAutoStart} checked={prefs.openAtLogin} onChange={(e) => changePrefs({ openAtLogin: e.target.checked })} />
            <span>
              Start with Windows
              <small>{prefs.canAutoStart ? 'Opens quietly when you sign in.' : 'Available once the app is installed (not in dev mode).'}</small>
            </span>
          </label>
        </section>
      )}


    </div>
  )
}
