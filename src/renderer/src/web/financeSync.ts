// Finance Helper's data, synced through Turso like the other apps, with
// Finance Helper's own merge (the one its Google Drive sync uses): for each
// record the newest copy wins and deletions are remembered. Its PIN, rates,
// theme and log view stay on each device.
//
// Money locked with its PIN ("Encrypt my data") on a device: only a SEALED
// copy travels (settings.app_sync_finance_sealed: AES-GCM with a key made from
// the Money PIN by Finance Helper's own cipher.js). The server never sees the
// PIN or the plain data. Without the PIN, a locked device still sends its own
// sealed data as it is, but only while the cloud's sealed copy is the one it
// last had (so it never replaces anything new). To take changes from other
// devices, or on a device that is not locked, the Money PIN is asked once
// (Settings → Data safety) and kept only in this window's memory.
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { normalizeState, SCHEMA_VERSION } from '../../public/apps/finance/js/model.js'
// @ts-ignore plain JS module from the embedded app
import { deriveKey, seal, open as openBox, isSealed } from '../../public/apps/finance/js/cipher.js'
import { getSetting, setSetting } from '../../../main/settings'
import { gapOf, type AppSyncContext, type AppSyncRun, type AppSyncSpec, type SyncGap } from './appSync'
import type { Mirror } from './mirror'

const remote = (data: any) => ({ app: 'finance-helper', schema: SCHEMA_VERSION, savedAt: 0, data })
const share = (state: any) => toCloud(normalizeState(state), '').data
// Each device fetches its own rates: compared by their day only (the same day's
// numbers differ a little between devices and must not be sent back and forth).
const withoutRates = ({ lastRates: _rates, ...rest }: any = {}) => rest
const ratesDay = (data: any) => String(data?.lastRates?.date ?? '')

/**
 * What the copy in the cloud (`theirs`) lacks from this device's data: the
 * cloud copy merged with this device's, by Finance Helper's own merge (the
 * cloud's side winning a tie), against the cloud copy, record by record. So a
 * record or a newer edit only here, a deletion only here, or newer settings
 * count; a mere difference in order or a same-day rate never does.
 */
export function financeGap(mine: any, theirs: any): SyncGap {
  const base = normalizeState({ ...(theirs ?? {}), version: SCHEMA_VERSION })
  const mineShared = share(mine)
  const both = mergeStates(base, remote(mineShared)).state
  const gap = gapOf(withoutRates(share(both)), withoutRates(theirs))
  if (ratesDay(mineShared) > ratesDay(theirs)) gap.other++
  return gap
}

export const FINANCE: AppSyncSpec = {
  localKey: 'finance-helper.state',
  setting: 'app_sync_finance',
  label: 'Money',
  legacySetting: 'finance_backup_json',
  event: 'life-finance-changed',
  share,
  fromShared: (data) => normalizeState({ ...data, version: SCHEMA_VERSION }),
  merge: (mine, theirs) => mergeStates(normalizeState(mine), remote(theirs)).state,
  // After a restore: the restored records and shared settings; this device's own settings (PIN, theme…) and rates stay.
  adopt: (mine, data) => {
    const { lastRates: _rates, settings, ...rest } = data ?? {}
    return normalizeState({ ...mine, ...rest, settings: { ...(mine?.settings ?? {}), ...(settings ?? {}) }, version: SCHEMA_VERSION })
  },
  gap: financeGap,
  // Locked with a PIN here, or the cloud copy is sealed: only sealed copies travel (below).
  custom: (ctx) => lockedRound(ctx),
  watch: ['finance-helper.enc']
}

// ---- Money locked with its PIN ----------------------------------------------

export const SEALED_SETTING = 'app_sync_finance_sealed'
const PLAIN_SETTING = 'app_sync_finance'
const LOCAL = 'finance-helper.state'
const ENC = 'finance-helper.enc'
const HEAD = 'finance-helper.head'
const ITER = 310000
// What this device last agreed on, as raw text (never plain data on a locked device):
const SEEN = 'life_sync_app_sync_finance_sealed_seen' // the cloud's sealed copy
const MINE = 'life_sync_app_sync_finance_sealed_mine' // this device's data (sealed here, or plain)
const PLAIN_SEEN = 'life_sync_app_sync_finance_sealed_plain' // the cloud's plain copy (bots add there)
const AGREED = 'life_sync_app_sync_finance' // the usual sync's agreed copy (plain)

export const NEED_PIN = 'Money PIN needed'
export const WRONG_PIN = 'Wrong Money PIN. Nothing was changed.'
export const DIFFERENT_PIN =
  "The cloud copy of Money is locked with a different PIN than this device's Money. Nothing was changed on either side. Use the same Money PIN on both devices, then sync again."
export const WRONG_CLOUD_PIN = 'Wrong Money PIN for the locked cloud copy (or it was locked with another PIN). Nothing was changed.'

// The Money PIN for sync: only in this window's memory, never saved or sent.
let pin: string | null = null
let wanted = false
const keys = new Map<string, Promise<CryptoKey>>()
const keyFor = (p: string, salt: string, iter: number): Promise<CryptoKey> => {
  const id = `${salt}|${iter}|${p}`
  if (!keys.has(id)) keys.set(id, deriveKey(p, salt, iter))
  return keys.get(id)!
}
/** Settings → Data safety: the Money PIN for this window (null forgets it). */
export function setMoneyPin(p: string | null): void {
  pin = p ? String(p) : null
  keys.clear()
}
/** Whether a sync is waiting for the Money PIN, and whether this window has it. */
export function moneyPinState(): { wanted: boolean; held: boolean } {
  return { wanted, held: pin != null }
}

const parseJson = (raw: string | null | undefined): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
const size = (g: SyncGap) => g.records + g.other
const openWith = async (box: any, p: string): Promise<string> => openBox(box, await keyFor(p, box.salt, Number(box.iter) || ITER))

/** Writes the sealed copy only if the cloud still has `expected` (else null: another device wrote first). */
function putSealed(mirror: Mirror, expected: string | null, box: any): Promise<string | null> {
  return mirror.write((db) => {
    const now = getSetting(db as any, SEALED_SETTING)
    if ((now ?? null) !== (expected ?? null)) return null
    const prev = parseJson(now)
    const at = Date.now()
    const text = JSON.stringify({ savedAt: at, editedAt: Math.max(at, (Number(prev?.editedAt) || 0) + 1), box })
    setSetting(db as any, SEALED_SETTING, text)
    return text
  })
}

/**
 * One round while Money is locked here or the cloud copy is sealed; null when
 * neither (the usual round runs). Merge rules stay Finance Helper's: records
 * only added, the newer edit wins, deletions only through tombstones.
 */
export async function lockedRound(ctx: AppSyncContext): Promise<AppSyncRun | null> {
  const { mirror, store, report } = ctx
  const get = (k: string) => {
    try {
      return store.getItem(k)
    } catch {
      return null
    }
  }
  const set = (k: string, v: string) => {
    try {
      store.setItem(k, v)
    } catch {
      /* private window */
    }
  }
  const none: AppSyncRun = { ok: true, sent: 0, changes: 0, confirmed: false, locked: true }
  const head = parseJson(get(HEAD))
  const encRaw = get(ENC)
  const encBox = parseJson(encRaw)
  if (encRaw != null && !(head?.enc?.salt && isSealed(encBox))) {
    // Locked, but the sealed data here can't be read as a box: leave it alone.
    report({ state: 'skipped', note: 'Money locked', error: null })
    return { ...none, skipped: 'Money locked' }
  }
  const here = encRaw != null
  const read = await mirror.read((db) => ({ sealed: getSetting(db as any, SEALED_SETTING), plain: getSetting(db as any, PLAIN_SETTING) }))
  const cloud = parseJson(read.sealed)
  const box = cloud && !cloud.retired && isSealed(cloud.box) ? cloud.box : null
  if (!here && !box) {
    wanted = false
    return null
  }
  // The plain copy (from before the lock, and what bots add) is known when this
  // device last merged it, or when it is exactly what the usual sync last agreed on.
  const plainData = parseJson(read.plain)?.data ?? null
  const plainKnown = read.plain == null || get(PLAIN_SEEN) === read.plain || (get(PLAIN_SEEN) == null && plainData != null && JSON.stringify(plainData) === get(AGREED))
  if (here) {
    if (plainKnown && read.plain != null) set(PLAIN_SEEN, read.plain)
    // A plain copy of locked data must not stay on this device.
    try {
      store.removeItem(AGREED)
      store.removeItem(`${AGREED}_before_restore`)
    } catch {
      /* private window */
    }
  }
  const localRaw = here ? encRaw : get(LOCAL)
  const cloudChanged = !!box && read.sealed !== get(SEEN)
  const localChanged = localRaw !== get(MINE)
  if (!ctx.checking && !cloudChanged && plainKnown && !localChanged && (box || !here)) return none

  const serverHolds = async (expect: string | null): Promise<boolean> => {
    const ok = expect != null && (await mirror.serverSetting(SEALED_SETTING, expect)) === expect
    ctx.unconfirmed(!ok)
    return ok
  }
  const fail = (error: string): AppSyncRun => {
    report({ state: 'error', error, note: null })
    return { ok: false, error, sent: 0, changes: 0, confirmed: false, locked: true }
  }

  if (!pin) {
    // No PIN here: a locked device sends its sealed data as it is, only over the copy it last had.
    let wrote: string | null = null
    const toSend = here && (localChanged || !box)
    if (toSend && !cloudChanged) {
      wrote = await putSealed(mirror, read.sealed, encBox)
      if (wrote) {
        set(SEEN, wrote)
        set(MINE, encRaw!)
      }
    }
    const behind = cloudChanged || (toSend && !wrote) || !plainKnown || (!here && localChanged)
    if (behind) {
      wanted = true
      if (wrote) await serverHolds(wrote).catch(() => ctx.unconfirmed(true))
      report({ state: 'skipped', note: NEED_PIN, error: null })
      return { ...none, skipped: NEED_PIN, changes: wrote ? 1 : 0 }
    }
    wanted = false
    const confirmed = await serverHolds(wrote ?? read.sealed)
    report(confirmed ? { state: 'ok', okAt: Date.now(), error: null, note: null } : { state: 'waiting', error: null, note: null })
    return { ...none, changes: wrote ? 1 : 0, confirmed }
  }

  // With the PIN: open everything in memory, merge, keep this device's copy the
  // way it was kept (sealed here, or plain), and send a sealed copy if the cloud lacks anything.
  let local: any = null
  if (here) {
    try {
      local = normalizeState({ ...JSON.parse(await openWith(encBox, pin)), version: SCHEMA_VERSION })
    } catch {
      setMoneyPin(null)
      wanted = true
      return fail(WRONG_PIN)
    }
  } else {
    const plain = parseJson(localRaw)
    local = plain ? normalizeState({ ...plain, version: SCHEMA_VERSION }) : null
  }
  let theirs: any = null
  if (box) {
    try {
      theirs = share(JSON.parse(await openWith(box, pin)))
    } catch {
      // Here the PIN opened this device's data, so the cloud copy has another PIN: keep it, change nothing.
      if (!here) {
        setMoneyPin(null)
        wanted = true
      }
      return fail(here ? DIFFERENT_PIN : WRONG_CLOUD_PIN)
    }
  }
  wanted = false
  let merged: any = local
  for (const other of [theirs, plainData]) {
    if (!other) continue
    merged = merged ? FINANCE.merge(merged, other, false) : FINANCE.fromShared!(other)
  }
  if (!merged) return none
  const got = local ? financeGap(merged, share(local)) : { records: (merged.tx ?? []).length, other: 1 }
  if (size(got) > 0) {
    // The app saved again while this ran: the next round merges that too (nothing is overwritten).
    if (get(here ? ENC : LOCAL) !== localRaw) {
      ctx.unconfirmed(true)
      report({ state: 'waiting', error: null, note: null })
      return none
    }
    const text = JSON.stringify(merged)
    let kept = text
    try {
      if (here) {
        const salt = String(head.enc.salt)
        const iter = Number(head.enc.iter) || ITER
        const key = await keyFor(pin, salt, iter)
        kept = JSON.stringify(await seal(text, key, salt, iter))
        store.setItem(ENC, kept)
        // Read it back before trusting it.
        JSON.parse(await openBox(JSON.parse(get(ENC) || 'null'), key))
      } else store.setItem(LOCAL, text)
    } catch (e) {
      throw new Error(`This device's storage is full, so Money's newest data couldn't be saved here (${String((e as Error)?.name ?? e)}). The cloud copy has it.`)
    }
    set(MINE, kept)
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('life-finance-changed', { detail: { fromSync: true } }))
  } else set(MINE, localRaw ?? '')
  set(PLAIN_SEEN, read.plain ?? '')

  const lacks = theirs ? financeGap(merged, theirs) : { records: (merged.tx ?? []).length, other: 1 }
  let wrote: string | null = null
  if (size(lacks) > 0) {
    const salt = here ? String(head.enc.salt) : String(box.salt)
    const iter = here ? Number(head.enc.iter) || ITER : Number(box.iter) || ITER
    const sealed = await seal(JSON.stringify(share(merged)), await keyFor(pin, salt, iter), salt, iter)
    wrote = await putSealed(mirror, read.sealed, sealed)
    if (wrote == null) {
      // Another device wrote first: merged on the next round.
      ctx.unconfirmed(true)
      report({ state: 'waiting', error: null, note: null })
      return { ...none, got: got.records }
    }
  }
  set(SEEN, wrote ?? read.sealed ?? '')
  const confirmed = await serverHolds(wrote ?? read.sealed)
  report(confirmed ? { state: 'ok', okAt: Date.now(), error: null, note: null, ...(wrote && lacks.records ? { sent: lacks.records } : {}) } : { state: 'waiting', error: null, note: null })
  return { ok: true, sent: wrote ? lacks.records : 0, changes: wrote ? lacks.other : 0, got: got.records, confirmed, locked: true }
}
