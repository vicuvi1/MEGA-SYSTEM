// Finance Helper's data, synced through Turso like the other apps, with
// Finance Helper's own merge (the one its Google Drive sync uses): for each
// record the newest copy wins and deletions are remembered. Its PIN, rates,
// theme and log view stay on each device. Skipped while its data is locked
// with a PIN on this device (then it's sealed and can't be merged).
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { normalizeState, SCHEMA_VERSION } from '../../public/apps/finance/js/model.js'
import { gapOf, type AppSyncSpec, type SyncGap } from './appSync'

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
  // Encrypted with a PIN on this device: its data is sealed and can't be read here.
  skip: (store) => !!store.getItem('finance-helper.enc'),
  skipNote: 'Money locked'
}
