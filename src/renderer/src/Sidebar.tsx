import { useEffect, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Icon, Logo } from './Icon'
import { MODULES, type ModuleDef, type PageId } from './modules'
import { useUiPrefs } from './uiPrefs'
import { useModules } from './useModules'
import { menuPages } from '@core/modules'
import { canHidePage, editablePages, offableModule, offModules, setPageHidden } from './menuPrefs'
import { life } from './bridge'
import { useToast } from './ui'
import type { ModuleId } from '@core/modules'

export type Badge = { n?: number; dot?: 'lime' | 'warn' }

interface Props {
  page: PageId
  onPage: (p: PageId) => void
  collapsed: boolean
  onToggle: () => void
  badges: Partial<Record<PageId, Badge>>
}

/** Every page the sidebar can draw (core/modules.ts decides which show and in what order). */
export const SIDEBAR_PAGES: PageId[] = MODULES.map((x) => x.id)

export function Sidebar({ page, onPage, collapsed, onToggle, badges }: Props) {
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null)
  const open = !collapsed
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<PageId, ModuleDef>
  const [ui, setUi] = useUiPrefs()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [ctx, setCtx] = useState<{ id: PageId; x: number; y: number } | null>(null)
  // The module switch (Settings → Modules): only the pages of modules that are on, in module order.
  // A module that is off is not here at all (no Archive); its data waits untouched until it is on again.
  const mods = useModules()
  const ids = menuPages(mods, SIDEBAR_PAGES, ui.hiddenPages ?? []) as PageId[]
  const hiddenList = ui.hiddenPages ?? []
  const editIds = editablePages(mods, SIDEBAR_PAGES) as PageId[]
  const setHidden = (id: PageId, hide: boolean) => setUi({ hiddenPages: setPageHidden(hiddenList, id, hide) })
  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', key)
    }
  }, [ctx])
  const setModuleOn = async (id: ModuleId, on: boolean, label: string) => {
    const next = await life.modules?.set(id, on).catch(() => null)
    if (next) toast(on ? `${label} is on, with all its data` : `${label} is off. Nothing was deleted`, 'good')
    else toast(`Couldn't change ${label}. Try again`, 'bad')
  }
  const turnedOff = offModules(mods)
  let index = 0

  const showTip = (label: string, el: HTMLElement) => {
    if (open) return
    const r = el.getBoundingClientRect()
    setTip({ label, y: r.top + r.height / 2 })
  }

  const go = (p: PageId) => onPage(p)

  return (
    <div className="side-cell">
      <aside
        className={`sb ${collapsed ? 'collapsed' : ''}`}
        onMouseLeave={() => setTip(null)}
      >
        <div className="sb-glow" aria-hidden="true" />

        <div className="sb-brand" title="LIFE — Real Growth">
          <span className="sb-mark" aria-hidden="true">
            <Logo size={22} />
          </span>
          <div className="sb-brand-info">
            <span className="sb-label sb-word">LIFE</span>
            <span className="sb-label sb-tagline">REAL GROWTH</span>
          </div>
        </div>

        <nav className="sb-nav" aria-label="Sections">
          {editing && (
            <div className="sb-group sb-edit" data-testid="sb-edit-list">
              {editIds.map((id) => {
                const m = byId[id]
                if (!m) return null
                const shown = !hiddenList.includes(id)
                const locked = !canHidePage(id)
                return (
                  <div
                    key={id}
                    className={`sb-erow ${shown ? '' : 'off'}`}
                    data-page={id}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtx({ id, x: e.clientX, y: e.clientY })
                    }} style={{ ['--c' as string]: m.color }}>
                    <span className="sb-tile">
                      <Icon name={m.icon} size={17} />
                    </span>
                    <span className="sb-label sb-name">{m.label}</span>
                    <button
                      className="sb-eye"
                      aria-pressed={shown}
                      aria-label={`${shown ? 'Hide' : 'Show'} ${m.label} in the menu`}
                      disabled={locked}
                      title={locked ? `${m.label} can't be hidden` : shown ? 'Hide from menu' : 'Show in menu'}
                      onClick={() => setHidden(id, shown)}
                    >
                      <Icon name="eye" size={15} />
                    </button>
                  </div>
                )
              })}
              {turnedOff.length > 0 && (
                <div className="sb-off" data-testid="sb-off-list">
                  <p className="sb-off-title">Turned off</p>
                  {turnedOff.map((d) => (
                    <div key={d.id} className="sb-erow" data-module={d.id}>
                      <span className="sb-label sb-name">{d.label}</span>
                      <button className="sb-turn" aria-label={`Turn on ${d.label}`} title={d.line} onClick={() => void setModuleOn(d.id, true, d.label)}>
                        Turn on
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="sb-group" data-testid="sb-modules" hidden={editing}>
            {ids.map((id) => {
              const m = byId[id]
              if (!m) return null
              // Alt+number goes to the n-th page here, the same as App's shortcut (core/modules.ts altPage).
              const n = ++index
              const on = page === id
              const soon = m.phase > 0
              const b = badges[id]
              return (
                <button
                  key={id}
                  aria-label={m.label}
                  aria-current={on ? 'page' : undefined}
                  className={`sb-item ${on ? 'on' : ''} ${soon ? 'soon' : ''}`}
                  style={{ ['--c' as string]: m.color }}
                  onClick={() => go(id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setCtx({ id, x: e.clientX, y: e.clientY })
                  }}
                  onMouseEnter={(e) => showTip(`${m.label}${soon ? ' · soon' : ''}${n < 10 ? `  Alt+${n}` : ''}`, e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                >
                  {on && <span className="sb-active" />}
                  <span className="sb-tile">
                    <Icon name={m.icon} size={17} duo={on} />
                    {b && <i className={`sb-dot ${b.dot ?? ''}`} />}
                  </span>
                  <span className="sb-label sb-name">{m.label}</span>
                  {soon && (
                    <span className="sb-label sb-lock" title="Coming soon">
                      <Icon name="lock" size={12} />
                    </span>
                  )}
                  {!soon && b?.n ? <span className="sb-label sb-count">{b.n}</span> : null}
                  {!soon && !b?.n && open && n < 10 && <kbd className="sb-label sb-key">{n}</kbd>}
                </button>
              )
            })}
          </div>
          <button
            className={`sb-item sb-more ${page === 'data' ? 'on' : ''}`}
            style={{ ['--c' as string]: '#6EE7D8' }}
            data-testid="sb-data-center"
            aria-label="Data center"
            aria-current={page === 'data' ? 'page' : undefined}
            onClick={() => go('data')}
            onMouseEnter={(e) => showTip('Data center: space left, backups, sync and clean-up', e.currentTarget)}
            onMouseLeave={() => setTip(null)}
            title="Data center: how safe your data is, how much room is left, backups, sync and clean-up"
          >
            {page === 'data' && <span className="sb-active" />}
            <span className="sb-tile">
              <Icon name="shield" size={17} duo={page === 'data'} />
              {badges.data && <i className={`sb-dot ${badges.data.dot ?? ''}`} />}
            </span>
            <span className="sb-label sb-name">Data center</span>
          </button>
          <button
            className="sb-item sb-more"
            style={{ ['--c' as string]: 'var(--muted)' }}
            data-testid="sb-modules-link"
            onClick={() => {
              try {
                localStorage.setItem('ls.settingsTab', 'modules')
              } catch {
                /* this visit only */
              }
              go('settings')
              window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: 'modules' }))
            }}
            onMouseEnter={(e) => showTip('Modules: turn parts of the app on or off', e.currentTarget)}
            onMouseLeave={() => setTip(null)}
            title="Turn parts of the app on or off (Settings → Modules)"
          >
            <span className="sb-tile">
              <Icon name="sliders" size={17} />
            </span>
            <span className="sb-label sb-name">Modules</span>
          </button>
          <button
            className="sb-item sb-edit-btn"
            style={{ ['--c' as string]: 'var(--muted)' }}
            data-testid={editing ? 'sb-edit-done' : 'sb-edit-open'}
            aria-label={editing ? 'Done editing the menu' : 'Edit menu'}
            onClick={() => setEditing((v) => !v)}
            onMouseEnter={(e) => showTip(editing ? 'Done' : 'Edit menu: hide or show pages', e.currentTarget)}
            onMouseLeave={() => setTip(null)}
            title={editing ? 'Done' : 'Edit menu: hide or show pages'}
          >
            <span className="sb-tile">
              <Icon name={editing ? 'check' : 'edit'} size={17} />
            </span>
            <span className="sb-label sb-name">{editing ? 'Done' : 'Edit menu'}</span>
          </button>
        </nav>

        {ctx && (
          <div className="sb-ctx" role="menu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            <button
              role="menuitem"
              disabled={!canHidePage(ctx.id)}
              title={canHidePage(ctx.id) ? undefined : `${byId[ctx.id]?.label} can't be hidden`}
              onClick={() => (setHidden(ctx.id, true), setCtx(null))}
            >
              Hide from menu
            </button>
            {(() => {
              const def = offableModule(ctx.id)
              return (
                <button role="menuitem" disabled={!def} title={def ? undefined : `${byId[ctx.id]?.label} can't be turned off`} onClick={() => (def && void setModuleOn(def.id, false, def.label), setCtx(null))}>
                  {def ? `Turn off ${def.label}` : "Can't be turned off"}
                </button>
              )
            })()}
          </div>
        )}

        <button className="sb-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'} title={collapsed ? 'Expand (Ctrl+B)' : 'Collapse (Ctrl+B)'}>
          <span className={collapsed ? 'flip' : ''}>‹</span>
        </button>
      </aside>

      <AnimatePresence>
        {tip && !open && (
          <m.div className="sb-tip" style={{ top: tip.y }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {tip.label}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
