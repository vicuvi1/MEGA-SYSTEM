// Settings → Plugins → Notes: pick your Obsidian vault (Windows app only).
import { life } from '../../renderer/src/bridge'
import { timeAgo, useAction } from '../../renderer/src/ui'
import { usePluginData } from '../usePluginData'
import type { VaultData } from './vault'

/** Reads the vault again on this PC and saves the summary (titles and a few lines). */
export async function syncVault(choose = false): Promise<VaultData | null> {
  const d = window.desktop
  if (!d?.vaultScan || !life.plugins) return null
  if (!choose && !(await life.plugins.state()).on.notes) return null
  const data = choose ? await d.vaultChoose!() : await d.vaultScan()
  if (data) await life.plugins.saveData('plugin_notes_data', data)
  return data
}

export function NotesSettings() {
  const act = useAction()
  const vault = usePluginData<VaultData>('plugin_notes_data')
  const desktop = !!window.desktop?.vaultChoose
  return (
    <div className="pl-fields">
      {vault ? (
        <div className="pl-status">
          Vault "{vault.folder}": {vault.count} notes, read {timeAgo(vault.at)}. The newest {vault.notes.length} show in your Notebook.
        </div>
      ) : (
        <div className="pl-muted">No vault yet.</div>
      )}
      {desktop ? (
        <div className="pl-actions">
          <button className="btn small primary" onClick={() => void act(() => syncVault(true), 'Vault read')}>
            {vault ? 'Choose another vault' : 'Choose your vault folder'}
          </button>
          {vault && (
            <button className="btn small" onClick={() => void act(() => syncVault(false), 'Vault read again')}>
              Read it again
            </button>
          )}
          {vault && (
            <button className="btn small ghost" onClick={() => void act(async () => { await window.desktop!.vaultForget!(); await life.plugins!.saveData('plugin_notes_data', null) }, 'Vault removed')}>
              Forget it
            </button>
          )}
        </div>
      ) : (
        <div className="pl-need">Choosing an Obsidian vault works in the Windows app. Notion works everywhere once NOTION_TOKEN is set.</div>
      )}
    </div>
  )
}
