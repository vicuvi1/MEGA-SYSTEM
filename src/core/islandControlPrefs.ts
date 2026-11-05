// The island's control settings (IC3, IC11, IC18, IC19), kept apart from the
// rest of IslandPrefs: the round menu, the break after a focus block, fading
// while you type in another app, and the profile (Work, Study, Gaming, Night).
// Pure; cleaned like every other island setting.

export type IslandProfileId = 'none' | 'work' | 'study' | 'gaming' | 'night'
export const PROFILE_IDS: IslandProfileId[] = ['none', 'work', 'study', 'gaming', 'night']
export const PROFILE_LABEL: Record<IslandProfileId, string> = { none: 'No profile', work: 'Work', study: 'Study', gaming: 'Gaming', night: 'Night' }

export interface IslandControls {
  /** IC3: hold the pill for the round menu. */
  ring: boolean
  /** IC11: minutes of break after a focus timer started from the island (0 = no break, just "Time is up"). */
  breakMin: number
  /** IC19: fade to ~20% while you type in another app. */
  fadeTyping: boolean
  /** IC18: the profile in use. */
  profile: IslandProfileId
  /** IC18: switch the profile by itself: by the time of day, by the app in front, or not. */
  profileAuto: 'off' | 'time' | 'app'
  /** IC18: programs that mean a profile (lowercase process names, e.g. "steam"). */
  profileApps: Partial<Record<IslandProfileId, string[]>>
}

export const DEFAULT_CONTROLS: IslandControls = {
  ring: true,
  breakMin: 5,
  fadeTyping: true,
  profile: 'none',
  profileAuto: 'off',
  profileApps: { work: ['code', 'excel', 'winword', 'outlook', 'teams', 'slack'], study: ['notion', 'obsidian', 'acrord32', 'anki'], gaming: ['steam', 'epicgameslauncher', 'battle.net', 'riotclientservices', 'leagueclient'] }
}

const isProfile = (v: unknown): v is IslandProfileId => typeof v === 'string' && (PROFILE_IDS as string[]).includes(v)

/** Any saved value → valid controls (missing → defaults). */
export function cleanControls(v: any): IslandControls {
  const d = DEFAULT_CONTROLS
  const apps: Partial<Record<IslandProfileId, string[]>> = {}
  for (const id of PROFILE_IDS) {
    if (id === 'none') continue
    const list = v?.profileApps?.[id]
    const clean = Array.isArray(list)
      ? [...new Set(list.map((x: unknown) => String(x ?? '').trim().toLowerCase().replace(/\.exe$/, '')).filter((x: string) => /^[a-z0-9 ._-]{1,40}$/.test(x)))].slice(0, 20)
      : d.profileApps[id]
    if (clean?.length) apps[id] = clean
  }
  const b = Number(v?.breakMin)
  return {
    ring: v?.ring !== false,
    breakMin: v?.breakMin == null || !Number.isFinite(b) ? d.breakMin : Math.min(30, Math.max(0, Math.round(b))),
    fadeTyping: v?.fadeTyping !== false,
    profile: isProfile(v?.profile) ? v.profile : d.profile,
    profileAuto: v?.profileAuto === 'time' || v?.profileAuto === 'app' ? v.profileAuto : 'off',
    profileApps: apps
  }
}
