// The app's own sync folder client (desktop only), wired to the real bridge.
// Pages import `syncFolder` from here; the logic is syncFolderClient.ts.
import { life } from '../bridge'
import { createSyncFolderClient } from './syncFolderClient'

/** The desktop's sync folder calls, or undefined (the website, an older desktop, a stand-in desktop in a test). */
export function syncFolderIpc() {
  const ipc = typeof window !== 'undefined' ? window.desktop?.syncFolder : undefined
  return ipc && typeof ipc.status === 'function' && typeof ipc.onWant === 'function' ? ipc : undefined
}

export const syncFolder = createSyncFolderClient({
  ipc: syncFolderIpc,
  exportJson: () => life.data.exportJson(),
  restoreSnapshot: async (text) => {
    if (!life.data.restoreSnapshot) throw new Error('Restore is not available here')
    return life.data.restoreSnapshot(text)
  }
})
