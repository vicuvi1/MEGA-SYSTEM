function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

import { hasPasskeyHere, passkeySupported } from '../web/passkey'
import { askConfirm } from '../confirmSheet'
import { useEffect, useState } from 'react'
import { rememberPinLength } from './LockScreen'
import type { AppPrefs, AuthStatus, BackupStatus, LogEntry, TelegramConfig, BotBridgeConfig, UpdateStatus, VerifyResult, AIConfig, CalendarConfig, SyncConfig, SyncResult } from '@shared/api'
import { POPULAR_MODELS, DEFAULT_AI_CONFIG } from '@core/ai'
import { DEFAULT_CALENDAR_CONFIG } from '@shared/api'
import { UpdatePanel } from '../updates'
import { LayoutEditor } from '../LayoutEditor'
import { useUiPrefs } from '../uiPrefs'
import { features, life } from '../bridge'
import { GooglePanel } from '../GooglePanel'
import { SportyPanel } from '../SportyPanel'
import { DesktopBackupPanel } from '../DesktopBackups'
import { HealthPanel } from '../HealthPanel'
import { IslandLogPanel } from '../IslandLogPanel'
import { IslandSettingsPanel } from '../IslandSettingsPanel'
import { PcPrivacyPanel } from '../PcPrivacyPanel'
import { SettingsShell, type SettingsGroup } from '../SettingsShell'
import { ConnectionsOverview } from '../ConnectionsOverview'
import { NotifSettings } from '../NotifSettings'
import { Row, Saved, Segmented, Switch, useSaved } from '../settingsUi'
import { addDays } from '@core/dates'
import { Icon } from '../Icon'
import { BrainPanel } from '../BrainPanel'
import { DevicesPanel } from '../DevicesPanel'
import { SyncPanel } from '../SyncPanel'
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
  /** Opens the pages that live under Settings (bots, connected apps, point history). */
  onGo?: (p: 'bots' | 'connected' | 'history' | 'coach') => void
}

export function Settings({ auth, onAuth, backup, onBackup, onRestored, update, onUpdate, onGo }: Props) {
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
  const [cloudSnapshots, setCloudSnapshots] = useState<{ day: string; exportedAt: string; sizeBytes: number }[]>([])

  useEffect(() => {
    life.data.cloudSnapshots?.().then((snaps) => {
      if (snaps) setCloudSnapshots(snaps)
    }).catch(() => {})
  }, [])
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
  const [lookFlash, lookSaved] = useSaved()
  const [bgFlash, bgSaved] = useSaved()
  // "Ask for the PIN on this device": off = this device remembers you.
  const [noPin, setNoPin] = useState(false)
  const [offAsk, setOffAsk] = useState(false)
  const [offPin, setOffPin] = useState('')
  useEffect(() => {
    life.auth.remembered?.().then(setNoPin).catch(() => {})
  }, [])
  const setAskPin = async (ask: boolean) => {
    if (!ask && !offAsk) return setOffAsk(true)
    const ok = await act(() => life.auth.setRemembered!(!ask, ask ? undefined : offPin), ask ? 'The PIN is asked again on this device' : 'This device opens without the PIN now')
    if (ok !== null && ok !== undefined) {
      setNoPin(!ask)
      setOffAsk(false)
      setOffPin('')
    }
  }

  async function handleUpdatePin(e: React.FormEvent) {
    e.preventDefault()
    setPinError(null)
    setPinSuccess(null)

    if (auth.pinSet && !currentPin) {
      setPinError('Enter your current PIN')
      soundWarning()
      return
    }

    // New PINs are 6+ digits (an old 4-digit one keeps working until you change it).
    if (!/^\d{6,12}$/.test(newPin)) {
      setPinError('New PIN must be 6 to 12 digits')
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
      rememberPinLength(newPin)
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
      desc: 'Central brain & orchestrator: executes /today status overview, /checkin streak confirmations, /tasks, and emergency /panic protocols.'
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
      badge: 'Training',
      desc: 'Athletic counter & metrics: logs /sport run 5km, /pushups 50, /bench 80kg, body composition (/weight 74.5, /waist 82), and personal records.'
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
      badge: 'AI coach',
      desc: 'Your coach in Telegram: advice from your real data, check-ins and follow-ups.'
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
      let importedType = ''

      // 1. Finance Helper standalone backup (e.g. finance-helper-2026-10-29.json)
      if (data.app === 'finance-helper' || (Array.isArray(data.tx) && data.tx.length > 0)) {
        const count = Array.isArray(data.tx) ? data.tx.length : 0
        if (!await askConfirm(`Import Finance Helper backup from "${file.name}" (${count} transactions)?`)) return
        localStorage.setItem('finance-helper.state', JSON.stringify(data))
        importedType = `Finance Helper (${count} transactions)`
      }
      // 2. Waky sleep companion standalone backup (e.g. waky.json)
      else if (data.days && data.settings) {
        const daysCount = Object.keys(data.days).length
        if (!await askConfirm(`Import Waky sleep backup from "${file.name}" (${daysCount} days logged)?`)) return
        localStorage.setItem('waky_web_data_v2', JSON.stringify(data))
        importedType = `Waky Sleep Companion (${daysCount} days logged)`
      }
      // 3. MAN Spartan discipline backup
      else if (data.streakDays != null) {
        const streak = Number(data.streakDays) || 1
        if (!await askConfirm(`Import MAN Spartan streak from "${file.name}" (Streak: Day ${streak})?`)) return
        // MAN's Day N started N-1 days ago (setting today wiped the streak).
        const d = await life.discipline.state()
        await life.discipline.setStart(addDays(d.today, -streak + 1))
        importedType = `MAN Spartan Discipline (Day ${streak})`
      }
      // 4. Full Life System Unified Backup
      else if (data.tables || data.version || data.financeState || data.wakyState) {
        if (!await askConfirm(`Restore full Life System backup from "${file.name}"? This will update your cloud database and local state.`)) return
        if (data.tables && life.data.restoreSnapshot) {
          // The real thing: every table back, on every device (PIN and bot setup kept).
          await life.data.restoreSnapshot(text)
        } else {
          if (data.financeState) localStorage.setItem('finance-helper.state', JSON.stringify(data.financeState))
          if (data.wakyState) localStorage.setItem('waky_web_data_v2', JSON.stringify(data.wakyState))
        }
        importedType = 'Full Life System backup'
      } else {
        throw new Error('Unrecognized backup format. Please select a valid Life System, Finance Helper, Waky, or MAN export file.')
      }

      setBackupStatusMsg(`🎉 Successfully imported ${importedType} from "${file.name}"! Reloading in 1s...`)
      soundSuccess()
      setTimeout(() => {
        window.location.reload()
      }, 1200)
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
    if (!await askConfirm(`Replace all current data with ${restoreName}? A backup of the current state is made first.`)) return
    const ok = await act(async () => {
      await life.backup.restore(restoreName, restorePass)
      return true
    }, 'Restored')
    if (ok) {
      setRestorePass('')
      onRestored()
    }
  }

  const groups: SettingsGroup[] = [
    {
      id: 'general',
      label: 'General',
      icon: 'lock',
      hint: 'PIN, this device and start-up',
      keywords: 'pin lock security password trusted device remember start windows background tray',
      body: (
        <>
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="lock" /> PIN
          </h2>
          <span className={`chip ${noPin ? 'warn' : 'ok'}`}>{noPin ? 'Not asked on this device' : 'Asked when the app opens'}</span>
        </header>
        <p className="hint block">The PIN keeps your data private. The website is on the internet, so a new device always needs it once; on your own PC or phone you can skip it.</p>
        <Row title="Ask for the PIN on this device" hint={noPin ? 'Never: Life System opens straight away here and stays signed in.' : 'Every time Life System opens.'}>
          {life.auth.setRemembered && (
            <Segmented label="Ask for the PIN on this device" value={noPin ? 'never' : 'always'} options={[['always', 'Always'], ['never', 'Never']]} onChange={(v) => void setAskPin(v === 'always')} />
          )}
        </Row>
        {offAsk && !noPin && (
          <form
            className="set-confirm"
            onSubmit={(e) => {
              e.preventDefault()
              void setAskPin(false)
            }}
          >
            <span>Enter your PIN once to stop asking for it on this device.</span>
            <input autoFocus type="password" inputMode="numeric" value={offPin} maxLength={12} placeholder="Your PIN" onChange={(e) => setOffPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn primary small" disabled={offPin.length < 4}>
              Stop asking
            </button>
            <button type="button" className="btn ghost small" onClick={() => (setOffAsk(false), setOffPin(''))}>
              Cancel
            </button>
          </form>
        )}

        {life.auth.signOutOthers && (
          <div className="row" style={{ gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  await life.auth.signOutOthers!()
                  setPinSuccess('Signed out everywhere else: other devices need the PIN again.')
                } catch (err: any) {
                  setPinError(err.message || 'Sign-out failed')
                }
              }}
            >
              Sign out all other devices
            </button>
            <span className="hint small">A lost phone or an old browser? This ends their access. Changing the PIN does it too.</span>
          </div>
        )}
        <DevicesPanel />
        {life.auth.setupPasskey && passkeySupported() && (
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn small"
              onClick={async () => {
                setPinError(null)
                setPinSuccess(null)
                try {
                  await life.auth.setupPasskey!()
                  setPinSuccess('Fingerprint / face unlock is on for this device. The PIN still works too.')
                } catch (err: any) {
                  setPinError(err.message || 'Could not set it up')
                }
              }}
            >
              🔐 {hasPasskeyHere() ? 'Set up fingerprint / face again' : 'Unlock with fingerprint / face'}
            </button>
            <span className="hint small">Uses this device's fingerprint, face or Windows Hello. The server checks it; the PIN stays as a backup.</span>
          </div>
        )}

        <details className="set-more">
          <summary>Change PIN</summary>
        <form onSubmit={handleUpdatePin} className="pin-settings-form">
          <div className="grid col-3 gap" style={{ gridTemplateColumns: auth.pinSet ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {auth.pinSet && (
              <div className="field">
                <span>Current PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="Current PIN"
                  value={currentPin}
                  maxLength={12}
                  autoComplete="current-password"
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            )}
            <div className="field">
              <span>New PIN (6–12 digits)</span>
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
        </details>
      </section>
      {prefs && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="bolt" /> Apps & start-up
            </h2>
            <Saved show={bgFlash} />
          </header>
          <Row title="Match the apps to Life System's look" hint="Finance Helper, Waky and MAN use the same dark colors and fonts">
            <Switch label="Match the apps to Life System's look" on={prefs.matchAppThemes} onChange={(v) => void changePrefs({ matchAppThemes: v }).then(bgSaved)} />
          </Row>
          {window.desktop ? (
            <Row title="Start with Windows, keep in the tray" hint="In the tray icon's menu (bottom right of the taskbar): Life System keeps running there when you close the window." />
          ) : (
            <>
              {features.updates && (
                <Row title="Keep running in the tray" hint="When the window is closed. Needed for block reminders.">
                  <Switch label="Keep running in the tray" on={prefs.keepInTray} onChange={(v) => void changePrefs({ keepInTray: v }).then(bgSaved)} />
                </Row>
              )}
              {prefs.canAutoStart && (
                <Row title="Start with Windows" hint="Opens quietly when you sign in">
                  <Switch label="Start with Windows" on={prefs.openAtLogin} onChange={(v) => void changePrefs({ openAtLogin: v }).then(bgSaved)} />
                </Row>
              )}
            </>
          )}
        </section>
      )}
        </>
      )
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: 'bell',
      hint: 'Pop-ups, sound, quiet hours',
      keywords: 'notification notifications popup pop-up windows sound chime quiet hours focus disturb alert',
      body: <NotifSettings />
    },
    {
      id: 'look',
      label: 'Look',
      icon: 'sun',
      hint: 'Theme, colors and your Today screen',
      keywords: 'appearance theme dark light color colour today sections layout name',
      body: (
        <>
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="sun" /> Appearance
          </h2>
          <Saved show={lookFlash} />
        </header>
        <Row title="Theme" hint="Dark, light, or follow Windows">
          <Segmented label="Theme" value={ui.theme} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'Like Windows']]} onChange={(v) => (setUi({ theme: v }), lookSaved())} />
        </Row>
        <Row title="Text size" hint="Ctrl + / Ctrl − also work, Ctrl 0 resets">
          <Segmented label="Text size" value={ui.textSize ?? 100} options={[[90, 'Small'], [100, 'Normal'], [110, '110%'], [125, '125%']]} onChange={(v) => (setUi({ textSize: v }), lookSaved())} />
        </Row>
        <Row title="Your name" hint="For the greeting on Today">
          <input className="sx-input" value={ui.name} maxLength={30} placeholder="e.g. Victor" onChange={(e) => setUi({ name: e.target.value })} onBlur={() => lookSaved()} aria-label="Your name" />
        </Row>
        <Row title="Calm mode" hint="Lighter and faster: effects play once, no glass blur">
          <Switch label="Calm mode" on={ui.calm !== false} onChange={(v) => (setUi({ calm: v }), lookSaved())} />
        </Row>
        {!window.desktop && <IslandToggle onSaved={lookSaved} />}
        <Row title="Sounds" hint="Short sounds for done tasks, points and alerts">
          <Switch label="Sounds" on={!!ui.sound} onChange={(v) => (setUi({ sound: v }), lookSaved())} />
        </Row>
        {ui.sound && (
          <Row title="Volume" hint={`${ui.volume ?? 80}%`}>
            <input className="sx-range" type="range" min={0} max={100} step={5} value={ui.volume ?? 80} onChange={(e) => setUi({ volume: Number(e.target.value) })} onMouseUp={() => (soundCoin(), lookSaved())} aria-label="Volume" />
          </Row>
        )}
        {ui.sound && (
          <Row title="Try them" hint="Hear how they sound">
            <div className="sx-try">
              <button type="button" className="btn small ghost" onClick={() => soundSystemOracle()}>Ben</button>
              <button type="button" className="btn small ghost" onClick={() => soundCoin()}>Points</button>
              <button type="button" className="btn small ghost" onClick={() => soundMechanicalClick()}>Click</button>
              <button type="button" className="btn small ghost" onClick={() => soundFanfare()}>Level up</button>
              <button type="button" className="btn small ghost" onClick={() => soundWarning()}>Alert</button>
            </div>
          </Row>
        )}
      </section>
      <LayoutEditor />
        </>
      )
    },
    {
      id: 'ben',
      label: 'Ben',
      icon: 'spark',
      hint: 'Your coach: his brain (model & cost), tone, rhythm',
      keywords: 'coach ai tone style length nudges rhythm model angry brain openrouter price cost usage claude gpt',
      body: (
        <>
          {!features.aiSettings && <BrainPanel />}
          {onGo && (
            <section className="panel">
              <header className="panel-head">
                <h2>
                  <Icon name="spark" /> How Ben talks to you
                </h2>
              </header>
              <p className="hint block">Tone (gentle → drill sergeant), reply length, what he knows about you and his daily rhythm live with Ben. Angry faces only at tone 5.</p>
              <div className="row">
                <button className="btn primary" onClick={() => onGo('coach')}>
                  Open Ben → About you
                </button>
              </div>
            </section>
          )}
      {features.aiSettings && (
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="spark" /> AI coach
          </h2>
          <span className={`chip ${aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'ok' : 'muted'}`}>
            {aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'On' : 'Not set up'}
          </span>
        </header>
        <p className="hint block">
          Connect Google Gemini (official free API keys) or OpenRouter (DeepSeek V3/R1, Claude, GPT) for the AI coach, reward ideas and weekly reports.
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
            <small>Lets Rewards suggest reward ideas and the coach write weekly reports.</small>
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
      )}
        </>
      )
    },
    {
      id: 'connections',
      label: 'Connections',
      icon: 'link',
      hint: 'Google, Todoist, Telegram, Sporty',
      keywords: 'google calendar todoist telegram bots bot token sporty sport connect',
      body: (
        <>
          <ConnectionsOverview onGo={onGo} />
          <h3 className="st-sub">Details</h3>
      <GooglePanel />
      {onGo && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="link" /> Bots & connections
            </h2>
          </header>
          <div className="set-links">
            <button className="set-link" onClick={() => onGo('bots')}>
              <Icon name="bot" size={18} />
              <span>
                <b>Telegram bots</b>
                <small>Mega, Finance and Waky: status, tests, settings</small>
              </span>
            </button>
            <button className="set-link" onClick={() => onGo('connected')}>
              <Icon name="link" size={18} />
              <span>
                <b>Connected apps</b>
                <small>Waky, Finance Helper, Sport Track, MAN</small>
              </span>
            </button>
            <button className="set-link" onClick={() => onGo('history')}>
              <Icon name="list" size={18} />
              <span>
                <b>Point history</b>
                <small>Every point in and out, with undo</small>
              </span>
            </button>
          </div>
        </section>
      )}
      <SportyPanel />
      {features.calendar && (
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
          Connect your Google Calendar so the <b>coach</b> can see your schedule, upcoming commitments, and daily agenda.
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
            <small>The coach includes your agenda in its advice.</small>
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
      )}
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
        </>
      )
    },
    ...(window.desktop
      ? [
    {
      id: 'desktop',
      label: 'Desktop & island',
      icon: 'expand',
      hint: 'The island at the edge of your screen',
      keywords: 'island dynamic size look see-through shortcut sound sections tray',
      body: (
        <>
      <IslandSettingsPanel />
        </>
      )
    },
    {
      id: 'pc',
      label: 'Ben on this PC',
      icon: 'shield',
      hint: 'What the desktop app may see, and what it saw today',
      keywords: 'privacy pc computer app activity focus distraction clipboard idle sensors block sites do not disturb shortcuts',
      body: <PcPrivacyPanel />
    },
        ]
      : []),
    {
      id: 'backups',
      label: 'Backups & data',
      icon: 'shield',
      hint: 'Daily backups, restore, export',
      keywords: 'backup restore export import google drive folder snapshot data',
      body: (
        <>
      <SyncPanel />
      <DesktopBackupPanel />
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

        {cloudSnapshots.length > 0 && (
          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px' }}>
            <h3 style={{ fontSize: '13px', margin: '0 0 8px', color: '#c8f135', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>☁️</span> 30-Day Automated Cloud Snapshot Vault
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {cloudSnapshots.map((snap) => (
                <div key={snap.day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '6px', fontSize: '12px' }}>
                  <span><b>{snap.day}</b> <span className="muted">({Math.round(snap.sizeBytes / 1024)} KB · {timeAgo(snap.exportedAt)})</span></span>
                  <button
                    className="btn small ghost"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onClick={async () => {
                      if (!await askConfirm(`Restore entire system state to ${snap.day}? A full snapshot is restored across all 4 apps.`)) return
                      const ok = await life.data.restoreCloudSnapshot?.(snap.day)
                      if (ok) {
                        setBackupStatusMsg(`🎉 Successfully restored cloud snapshot for ${snap.day}! Reloading...`)
                        soundSuccess()
                        setTimeout(() => window.location.reload(), 1200)
                      }
                    }}
                  >
                    Restore This Day
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {features.cloudflareSync && (
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
      )}
        </>
      )
    },
    ...(features.updates
      ? [
          {
            id: 'updates',
            label: 'Updates',
            icon: 'refresh',
            hint: 'Version and new releases',
            keywords: 'update version release restart new',
            body: <UpdatePanel status={update} onStatus={onUpdate} />
          }
        ]
      : []),
    {
      id: 'health',
      label: 'System health',
      icon: 'chart',
      hint: 'Is every part working',
      keywords: 'health status errors working broken keys',
      body: (
        <>
      <HealthPanel />
        </>
      )
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      icon: 'list',
      hint: 'Island taps and logs',
      keywords: 'logs diagnostics island tap debug',
      advanced: true,
      body: (
        <>
      <IslandLogPanel />
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
          {features.logFolder && (
            <button className="btn" onClick={() => life.app.openLogs()}>
              Open log folder
            </button>
          )}
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
        </>
      )
    },
  ]

  return (
    <div className="settings">
      <SettingsShell groups={groups} />
    </div>
  )
}

/** The focus island on/off (its other options live in its own ⚙). */
function IslandToggle({ onSaved }: { onSaved?: () => void }) {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem('ls.island') || '{}').on !== false
    } catch {
      return true
    }
  }
  const [on, setOn] = useState(read)
  const set = (v: boolean) => {
    try {
      localStorage.setItem('ls.island', JSON.stringify({ ...JSON.parse(localStorage.getItem('ls.island') || '{}'), on: v }))
    } catch {
      /* private window */
    }
    setOn(v)
    window.dispatchEvent(new Event('life-island-prefs'))
    onSaved?.()
  }
  return (
    <Row title="Focus island" hint="A live timer pill at the top of every page; ⚙ inside it to customize">
      <Switch label="Focus island" on={on} onChange={set} />
    </Row>
  )
}
