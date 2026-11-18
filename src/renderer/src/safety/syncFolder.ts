// The app's own sync folder client (desktop only), wired to the real bridge.
// Pages import `syncFolder` from here; the logic is syncFolderClient.ts.
import { life } from '../bridge'
import { createSyncFolderClient } from './syncFolderClient'

export const syncFolder = createSyncFolderClient({
  ipc: () => (typeof window !== 'undefined' ? window.desktop?.syncFolder : undefined),
  exportJson: () => life.data.exportJson(),
  restoreSnapshot: async (text) => {
    if (!life.data.restoreSnapshot) throw new Error('Restore is not available here')
    return life.data.restoreSnapshot(text)
  }
})
