// MC10: honest focus from what's on screen (pure, tested). While a focus
// timer runs, the desktop looks at the app in front every 30 seconds and
// counts the session's minutes on work, distracting and other apps (app names
// only: never window titles or addresses). The share of time NOT in a
// distracting app is the session's focus quality. Drifting for 2+ minutes in a
// row gets one word from the island, once per session.
import { focusQualityPc, type AppKind } from './pcActivity'

export const FOCUS_SAMPLE_SEC = 30
export const DRIFT_WARN_SEC = 120

export interface FocusApps {
  /** The focus timer's start (ms): one record per session. */
  startedAt: number
  subject: string
  workSec: number
  distractSec: number
  neutralSec: number
  /** Seconds in a row in distracting apps, right now. */
  streakSec: number
  /** The drift warning was given this session. */
  warned: boolean
  /** Seconds per app name (the friendly name, never a title). */
  apps: Record<string, number>
}

export const newFocusApps = (startedAt: number, subject: string): FocusApps => ({ startedAt, subject: subject.slice(0, 60), workSec: 0, distractSec: 0, neutralSec: 0, streakSec: 0, warned: false, apps: {} })

/** One sample (the app in front now). `warn` is true once, when a drift reaches 2 minutes. */
export function addFocusSample(s: FocusApps, kind: AppKind, label: string, sec = FOCUS_SAMPLE_SEC): { s: FocusApps; warn: boolean } {
  const name = String(label || 'Unknown').slice(0, 40)
  const apps = Object.keys(s.apps).length >= 30 && !(name in s.apps) ? s.apps : { ...s.apps, [name]: (s.apps[name] ?? 0) + sec }
  const streakSec = kind === 'distract' ? s.streakSec + sec : 0
  const warn = !s.warned && streakSec >= DRIFT_WARN_SEC
  return {
    warn,
    s: {
      ...s,
      apps,
      workSec: s.workSec + (kind === 'work' ? sec : 0),
      distractSec: s.distractSec + (kind === 'distract' ? sec : 0),
      neutralSec: s.neutralSec + (kind === 'neutral' ? sec : 0),
      streakSec,
      warned: s.warned || warn
    }
  }
}

/** Focus quality in % from the apps (null until there are 2 minutes of samples). */
export function focusAppsQuality(s: FocusApps | null): number | null {
  if (!s) return null
  const total = s.workSec + s.distractSec + s.neutralSec
  return total >= 120 ? focusQualityPc(total, 0, s.distractSec) : null
}

const mins = (sec: number) => Math.round(sec / 60)

/** The session's totals, safe to show or (if you share totals) give to Ben. */
export function focusAppsSummary(s: FocusApps | null): { workMin: number; distractMin: number; otherMin: number; pct: number | null } | null {
  if (!s) return null
  return { workMin: mins(s.workSec), distractMin: mins(s.distractSec), otherMin: mins(s.neutralSec), pct: focusAppsQuality(s) }
}

/** "Lab: 42 min on work apps, 8 min on distracting ones · focus quality 84%". */
export function focusAppsLine(s: FocusApps | null): string {
  const t = focusAppsSummary(s)
  if (!s || !t || t.pct == null) return ''
  return `${s.subject}: ${t.workMin} min on work apps, ${t.distractMin} min on distracting ones · focus quality ${t.pct}%`
}
