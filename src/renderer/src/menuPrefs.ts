// Hide or show sidebar pages (Sidebar "Edit menu", Settings → Layout). One list decides it:
// uiPrefs.hiddenPages, read by menuPages() in core/modules.ts in Simple mode and normal mode alike.
// The order never lives here: a page that comes back lands in its module's place.
import { menuPages, type ModulesOn } from '@core/modules'

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
