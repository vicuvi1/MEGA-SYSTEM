// The alive island, the app window's side (desktop only). core/islandAlive.ts
// decides (pure, tested); this keeps the switches and the state in this PC's
// storage, reads and writes the real settings for the Lively preset (and puts
// the old values back exactly), and runs one step on every island build.
// It never logs anything by itself: a button on a card does the real log.
import { life } from './bridge'
import { setUiPrefs } from './uiPrefs'
import { playCheck, soundPrefs } from './soundKit'
import { boostNow, loadBoost, saveBoost } from './boost/boostBus'
import { coachOn, setCoach } from './pcCoachFeed'
import { inQuiet } from '@core/benPushes'
import { kitFor } from '@core/launchKit'
import type { IslandAction, IslandAlert } from '@core/islandModel'
import type { IslandMode } from '@core/islandCalm'
import { cleanPushPrefs } from '@core/benPushes'
import {
  aliveStep, cleanAlive, cleanAliveState, cleanPreset, dismissOffer, restorePreset, shouldOffer, startPreset,
  type AliveInput, type AlivePrefs, type AliveState, type PresetState, type PresetValues
} from '@core/islandAlive'

const PREFS = 'ls.islandAlive'
const STATE = 'ls.islandAliveState'
const PRESET = 'ls.islandPreset'
export const ALIVE_EVENT = 'life-alive-changed'

const read = (k: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null')
  } catch {
    return null
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}
const changed = () => {
  window.dispatchEvent(new Event(ALIVE_EVENT))
  window.dispatchEvent(new Event('life-island-refresh'))
}

export const alivePrefs = (): AlivePrefs => cleanAlive(read(PREFS))
export function setAlivePrefs(patch: Partial<AlivePrefs>): AlivePrefs {
  const next = { ...alivePrefs(), ...patch }
  write(PREFS, next)
  changed()
  return next
}
export const presetNow = (): PresetState => cleanPreset(read(PRESET))
const savePreset = (s: PresetState) => write(PRESET, s)

// ---- Island mode (the desktop's own prefs), cached ----

let modeCache: { at: number; mode: IslandMode; peekAlive: boolean } = { at: 0, mode: 'calm', peekAlive: false }
export async function islandModeNow(now = Date.now()): Promise<IslandMode> {
  if (now - modeCache.at > 30_000) {
    const p = await window.desktop?.getIslandPrefs?.().catch(() => null)
    modeCache = { at: now, mode: p?.mode ?? 'calm', peekAlive: p?.peekFor?.alive === true }
  }
  return modeCache.mode
}

// ---- The Lively preset: read and write the real settings ----

export async function readPresetValues(): Promise<PresetValues> {
  const [ip, boost, fit] = await Promise.all([window.desktop?.getIslandPrefs?.().catch(() => null), loadBoost(true).catch(() => boostNow()), life.coach?.lifeFit?.().catch(() => null)])
  const pushes = cleanPushPrefs(fit?.pushes)
  return {
    mode: ip?.mode ?? 'calm',
    sound: soundPrefs().island,
    coach: coachOn(),
    wins: boost.wins.on,
    push: fit?.push ?? 'push',
    brief: pushes.brief,
    shutdown: pushes.shutdown,
    peekAlive: ip?.peekFor?.alive === true,
    alive: alivePrefs()
  }
}

export async function applyPresetValues(v: PresetValues): Promise<void> {
  const ip = await window.desktop?.getIslandPrefs?.().catch(() => null)
  await window.desktop?.setIslandPrefs?.({ mode: v.mode, peekFor: { ...(ip?.peekFor ?? {}), alive: v.peekAlive } as never }).catch(() => null)
  modeCache.at = 0
  setUiPrefs({ sounds: { ...soundPrefs(), island: v.sound } })
  if (coachOn() !== v.coach) await setCoach(v.coach).catch(() => null)
  const boost = boostNow()
  if (boost.wins.on !== v.wins) await saveBoost({ wins: { ...boost.wins, on: v.wins } }).catch(() => null)
  const fit = await life.coach?.lifeFit?.().catch(() => null)
  if (fit && life.coach?.setLifeFit) await life.coach.setLifeFit({ push: v.push, pushes: { ...cleanPushPrefs(fit.pushes), brief: v.brief, shutdown: v.shutdown } }).catch(() => null)
  write(PREFS, v.alive)
  changed()
}

/** The one-time card (it waits as a dot in Calm; one tap sets it all, one tap restores it). */
export function presetOfferAlert(mode: IslandMode): IslandAlert | null {
  if (!shouldOffer(presetNow(), mode)) return null
  const id = 'alive:offer'
  return {
    id, kind: 'suggest', title: 'Make the island more alive?', face: '✦',
    text: 'Pulses, countdowns, streak saves, added tasks and sounds. Back to Calm any time in Settings → Desktop island.',
    actions: [
      { label: 'Balanced', action: { kind: 'alive', op: 'balanced', alertId: id }, primary: true },
      { label: 'Lively', action: { kind: 'alive', op: 'lively', alertId: id } },
      { label: 'No thanks', action: { kind: 'alive', op: 'later', alertId: id } }
    ]
  }
}

/** A tap on the offer card or Settings' switch. Returns what to say. */
export async function aliveAct(a: Extract<IslandAction, { kind: 'alive' }>): Promise<string> {
  const s = presetNow()
  if (a.op === 'later') {
    savePreset(dismissOffer(s))
    changed()
    return 'OK, Calm stays'
  }
  if (a.op === 'calm') {
    const r = restorePreset(s)
    savePreset(r.state)
    if (r.apply) await applyPresetValues(r.apply)
    changed()
    return r.apply ? 'Back to Calm, your old settings are restored' : 'Already calm'
  }
  const current = await readPresetValues()
  const r = startPreset(s, current, a.op)
  savePreset(r.state)
  await applyPresetValues(r.apply)
  changed()
  return a.op === 'lively' ? 'Lively is on' : 'Balanced is on'
}

// ---- One step per island build ----

let state: AliveState | null = null
const load = (): AliveState => (state ??= cleanAliveState(read(STATE)))

export const hasKit = (title: string) => !!kitFor(boostNow().kits, title)

export function aliveQuiet(now: number): boolean {
  const pc = playCheck()
  return inQuiet(now, pc.quiet.on ? pc.quiet : null)
}

/** The final alert for the snapshot (the shield, then a free-slot alive card) and how many cards the shield holds. */
export function aliveTick(i: Omit<AliveInput, 'prefs' | 'hasKit'>): { alert: IslandAlert | null; held: number } {
  const r = aliveStep({ ...i, prefs: alivePrefs(), hasKit }, load())
  state = r.state
  write(STATE, { ...r.state, card: null })
  return { alert: r.alert, held: r.held }
}
