// DX9: opening a launch kit. On the desktop, the apps, folders and links go
// through the automation hub's checked "workspace" call (the never-list,
// http(s) links only, real paths only; src/desktop/automations.ts), and "End
// kit" asks only the apps that call opened to close. On the website only the
// links can open (a browser can't start apps or open folders). The kit's
// music station plays through the one SoundCloud player. Closing other
// browser tabs isn't possible from here (no browser extension).
import { kitWorkspace, webLinks, type LaunchKit } from '@core/launchKit'
import { playUrl, musicPlaying } from './boostBus'

export interface KitResult {
  ok: boolean
  text: string
}

/** Opens a kit now. */
export async function openKit(k: LaunchKit): Promise<KitResult> {
  const said: string[] = []
  let ok = false
  const ws = kitWorkspace(k)
  if (window.desktop?.auto && ws) {
    const r = (await window.desktop.auto('workspace', { id: `kit-${k.id}`, ws }).catch((e: Error) => ({ ok: false, why: e.message }))) as { ok?: boolean; text?: string; why?: string }
    ok = !!r?.ok
    said.push(r?.ok ? r.text ?? 'Opened' : r?.why ?? 'Could not open it')
  } else {
    const links = webLinks(k)
    let opened = 0
    for (const l of links) if (window.open(l, '_blank', 'noopener,noreferrer')) opened++
    ok = opened > 0
    if (links.length) said.push(opened === links.length ? `Opened ${opened} link${opened > 1 ? 's' : ''}` : `Opened ${opened} of ${links.length} links (allow pop-ups for more)`)
    if (k.apps.length || k.folders.length) said.push('apps and folders open in the desktop app only')
  }
  if (k.station && !musicPlaying() && playUrl(k.station, `${k.name} music`)) {
    ok = true
    said.push('music on')
  }
  return { ok, text: `🚀 ${k.name}: ${said.join(' · ') || 'nothing to open'}` }
}

/** When the timer ends: ask the apps this kit opened to close (desktop; never anything else). */
export async function endKit(k: LaunchKit): Promise<string | null> {
  if (!k.closeOnEnd || !window.desktop?.auto) return null
  const r = (await window.desktop.auto('workspaceEnd', { id: `kit-${k.id}` }).catch(() => null)) as { text?: string } | null
  return r?.text ?? null
}
