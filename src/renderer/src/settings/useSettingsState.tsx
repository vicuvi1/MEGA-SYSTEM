// The state behind Settings (LT11): what used to sit at the top of
// pages/Settings.tsx, shared by every section in src/renderer/src/settings/.
import { askConfirm, askText } from '../confirmSheet'
import { useEffect, useState } from 'react'
import { rememberPinLength } from '../pages/LockScreen'
import type { AppPrefs, AuthStatus, BackupStatus, LogEntry, BotBridgeConfig, UpdateStatus, VerifyResult, AIConfig, CalendarConfig, SyncConfig } from '@shared/api'
import { DEFAULT_AI_CONFIG } from '@core/ai'
import { DEFAULT_CALENDAR_CONFIG } from '@shared/api'
import { useUiPrefs } from '../uiPrefs'
import { life } from '../bridge'
import { useSaved } from '../settingsUi'
import { addDays } from '@core/dates'
import { useAction } from '../ui'
import { soundCoin, soundFanfare, soundMechanicalClick, soundSuccess, soundWarning } from '../soundKit'

export function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}


export function openBackupDb(): Promise<IDBDatabase> {
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

export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
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

export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openBackupDb()
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(handle, 'backupFolder')
  } catch {}
}

export interface SettingsProps {
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

/** Everything the Settings sections share: state, saved values and actions (LT11). */
export function useSettingsState({ auth, onAuth, backup, onBackup, onRestored, update, onUpdate, onGo }: SettingsProps) {
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
      const folder = await askText(
        'Which folder on your PC should backups go to? (for example Documents\\LifeSystem Backups)',
        backupFolderName || 'Documents\\LifeSystem Backups'
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

  return { auth, onAuth, backup, onBackup, onRestored, update, onUpdate, onGo, act, pass, setPass, verify, setVerify, names, setNames, restoreName, setRestoreName, restorePass, setRestorePass, prefs, setPrefs, ui, setUi, logs, setLogs, backupFolderName, setBackupFolderName, backupSchedule, setBackupSchedule, cloudSnapshots, setCloudSnapshots, lastBackupTime, setLastBackupTime, backupStatusMsg, setBackupStatusMsg, botCfg, setBotCfg, showTokens, setShowTokens, testingBotKey, setTestingBotKey, botTestResult, setBotTestResult, currentPin, setCurrentPin, newPin, setNewPin, confirmPin, setConfirmPin, pinError, setPinError, pinSuccess, setPinSuccess, isUpdatingPin, setIsUpdatingPin, lookFlash, lookSaved, bgFlash, bgSaved, noPin, setNoPin, offAsk, setOffAsk, offPin, setOffPin, setAskPin, handleUpdatePin, handleLockNow, saveBotArmy, testBotIndividual, toggleTokenVisibility, BOTS_METADATA, aiCfg, setAiCfg, showGemini, setShowGemini, showOr, setShowOr, testingProvider, setTestingProvider, aiTestResult, setAiTestResult, saveAiConfig, testAiConnection, calCfg, setCalCfg, syncingCal, setSyncingCal, calSyncMsg, setCalSyncMsg, syncCfg, setSyncCfg, syncTestMsg, setSyncTestMsg, syncingNow, setSyncingNow, showSyncSecret, setShowSyncSecret, syncInstructionsOpen, setSyncInstructionsOpen, saveSyncConfig, testSyncConnection, pullSyncNow, saveCalendarConfig, syncCalendarNow, changePrefs, saveBackupToHandle, handleDownloadBackupFile, handleSelectFolder, handleSaveBackupNow, handleFileRestore, savePass, restore }
}

export type SettingsState = ReturnType<typeof useSettingsState>
