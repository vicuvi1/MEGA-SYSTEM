// What the island window takes from the widget platform: the pager (PL6),
// the widget pages (PL1, PL5) and the script clock (PL5). One import keeps
// the hook-in in DesktopIsland.tsx small.
import './widgetPages'
export { IslandPager, registerIslandPage, type IslandPage, type IslandPageCtx } from './islandPages'
export { useScriptClock } from './scriptRunner'
