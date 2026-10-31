// Finance Helper's data, synced through Turso like the other apps, with
// Finance Helper's own merge (the one its Google Drive sync uses): for each
// record the newest copy wins and deletions are remembered. Its PIN, rates,
// theme and log view stay on each device. Skipped while its data is locked
// with a PIN on this device (then it's sealed and can't be merged).
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { normalizeState, SCHEMA_VERSION } from '../../public/apps/finance/js/model.js'
import type { AppSyncSpec } from './appSync'

const remote = (data: any) => ({ app: 'finance-helper', schema: SCHEMA_VERSION, savedAt: 0, data })

export const FINANCE: AppSyncSpec = {
  localKey: 'finance-helper.state',
  setting: 'app_sync_finance',
  legacySetting: 'finance_backup_json',
  event: 'life-finance-changed',
  share: (state) => toCloud(normalizeState(state), '').data,
  fromShared: (data) => normalizeState({ ...data, version: SCHEMA_VERSION }),
  merge: (mine, theirs) => mergeStates(normalizeState(mine), remote(theirs)).state,
  skip: (store) => !!store.getItem('finance-helper.enc')
}
