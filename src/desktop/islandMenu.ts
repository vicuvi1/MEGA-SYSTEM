// H1: the tray's island items for hiding and moving it (kept apart from main.ts).
import type { MenuItemConstructorOptions } from 'electron'
import { HIDE_LABEL, type HideChoice, type HideState } from '../core/islandMove'

interface IslandMoveApi {
  enabled(): boolean
  hideState(): HideState
  hideLabel(): string
  setHide(choice: HideChoice | null): void
  readonly hideShortcut: string
  startMove(): void
  resetPosition(): void
  dodge(): boolean
  setDodge(on: boolean): void
}

const keyText = (k: string) => (k ? ` (${k.replace('Control', 'Ctrl')})` : '')

export function islandMoveMenu(island: IslandMoveApi, refresh: () => void): MenuItemConstructorOptions[] {
  if (!island.enabled()) return []
  const h = island.hideState()
  const hideItem: MenuItemConstructorOptions = h.mode === 'shown'
    ? { label: `Hide the island${keyText(island.hideShortcut)}`, submenu: (['1h', 'tomorrow', 'manual', 'dot'] as HideChoice[]).map((c) => ({ label: HIDE_LABEL[c], click: () => { island.setHide(c); refresh() } })) }
    : { label: `Bring the island back${keyText(island.hideShortcut)} · ${island.hideLabel()}`, click: () => { island.setHide(null); refresh() } }
  return [
    hideItem,
    { label: 'Move the island (arrow keys, Enter saves)', click: () => { island.startMove(); refresh() } },
    { label: 'Reset position (top centre)', click: () => { island.resetPosition(); refresh() } },
    { label: 'Slide out of the way when the mouse rushes at it', type: 'checkbox', checked: island.dodge(), click: (item) => { island.setDodge(item.checked); refresh() } }
  ]
}
