// Hide or show sidebar pages (Sidebar "Edit menu", Settings → Layout). One list decides it:
// uiPrefs.hiddenPages, read by menuPages() in core/modules.ts in Simple mode and normal mode alike.
// The order never lives here: a page that comes back lands in its module's place.
import { isOn, menuPages, MODULE_LIST, pageModule, type ModuleDef, type ModulesOn } from '@core/modules'

/** Pages that can never leave the menu, so you can't lock yourself out. */
export const LOCKED_PAGES: readonly string[] = ['today', 'settings']

export const canHidePage = (id: string): boolean => !LOCKED_PAGES.includes(id)

/** The new hidden list after hiding or showing one page. A locked page is never added. */
export function setPageHidden(hidden: readonly string[], id: string, hide: boolean): string[] {
  const rest = hidden.filter((x) => x !== id)
  return hide && canHidePage(id) ? [...rest, id] : rest
}

/** Every page edit mode lists: pages of modules that are on, in menu order, hidden ones included. */
export const editablePages = (mods: ModulesOn, known: readonly string[]): string[] => menuPages(mods, known, [])

/** Modules that are off, as Settings → Modules lists them (same MODULE_LIST), so edit mode can turn them on. */
export const offModules = (mods: ModulesOn): ModuleDef[] => MODULE_LIST.filter((d) => !d.locked && !isOn(mods, d.id))

/** The module a menu page belongs to, when it may be turned off (Today's module is locked). */
export function offableModule(page: string): ModuleDef | null {
  const id = pageModule(page)
  const def = id ? MODULE_LIST.find((d) => d.id === id) : undefined
  return def && !def.locked ? def : null
}
