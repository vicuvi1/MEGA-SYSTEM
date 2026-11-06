// One switch for long pages (Today, Insights, Goals, Money, Discipline, Music,
// Rewards and the long Settings sections): a segmented row that stays at the
// top while you scroll, a sliding highlight, small counts, ← / → while it has
// focus, 1–9 on the page, the last tab remembered on this device, and deep
// links (Ctrl+K, ?page=today&tab=body, or openTab('today', 'body')).
// Pages keep every panel mounted and only hide the ones you don't see, so
// nothing reloads or loses what you typed when you switch.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { pickTab, tabFromUrl, tabKey } from '@core/pageTabs'
import './pageTabs.css'
import './pageTabsPages.css'

export interface PageTab {
  id: string
  label: string
  /** A small number (or "1/4") on the tab; nothing for null/undefined/''. */
  count?: number | string | null
  /** Hover text. */
  title?: string
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private window: it just isn't remembered */
  }
}

/** Opens a page on one of its tabs (Ctrl+K, links, Ben). `page` may be `settings.<section>`. */
export function openTab(page: string, tab: string): void {
  write(tabKey(page), tab)
  if (page.startsWith('settings.')) {
    const section = page.slice('settings.'.length)
    write('ls.settingsTab', section)
    window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'settings' }))
    window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: section }))
  } else window.dispatchEvent(new CustomEvent('life-open-page', { detail: page }))
  window.dispatchEvent(new CustomEvent('life-open-tab', { detail: { page, tab } }))
}

/**
 * The tab a page shows. The first time: ?tab= (when the address opened this
 * page), then the last one you used here, then `fallback`. A remembered tab
 * that isn't offered right now (the Day tab on a wide screen) falls back
 * without forgetting it.
 */
export function usePageTab(page: string, ids: string[], fallback?: string, storageKey = tabKey(page)): [string, (id: string) => void] {
  const [want, setWant] = useState<string>(() => {
    const fromUrl = tabFromUrl(typeof window === 'undefined' ? '' : window.location.search, page)
    if (fromUrl) write(storageKey, fromUrl)
    return fromUrl ?? read(storageKey) ?? fallback ?? ids[0] ?? ''
  })
  const set = useCallback(
    (id: string) => {
      setWant(id)
      write(storageKey, id)
    },
    [storageKey]
  )
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { page?: string; tab?: string } | undefined
      if (d?.page === page && d.tab) set(d.tab)
    }
    window.addEventListener('life-open-tab', on)
    return () => window.removeEventListener('life-open-tab', on)
  }, [page, set])
  return [pickTab(want, ids, fallback), set]
}

const typing = (el: Element | null) => !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export function PageTabs({
  page,
  tabs,
  value,
  onChange,
  label,
  keys = true,
  className = '',
  end,
  jump = false
}: {
  page: string
  tabs: PageTab[]
  value: string
  onChange: (id: string) => void
  /** What the switch is called for screen readers ("Today views"). */
  label: string
  /** 1–9 on the page jump to a tab (only the page's main switch). */
  keys?: boolean
  className?: string
  /** Something small at the right end (a sync button). */
  end?: ReactNode
  /** A jump bar (the page scrolls by itself): don't move the page on a switch. */
  jump?: boolean
}) {
  const bar = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const ind = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)

  // The highlight slides under the chosen tab: translate + scale, never width (motion budget).
  const place = useCallback(() => {
    const b = bar.current
    const i = ind.current
    const btn = b?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`)
    if (!b || !i || !btn) return
    i.style.transform = `translateX(${btn.offsetLeft}px) scaleX(${btn.offsetWidth / 100})`
    i.style.opacity = '1'
  }, [value])
  useLayoutEffect(() => {
    place()
    if (!ready) requestAnimationFrame(() => setReady(true))
  }, [place, tabs.length, ready])
  useEffect(() => {
    const b = bar.current
    if (!b || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => place())
    ro.observe(b)
    return () => ro.disconnect()
  }, [place])
  // The chosen tab stays in view when the row scrolls sideways (phone).
  useEffect(() => {
    const btn = bar.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`)
    const row = bar.current
    if (!btn || !row || row.scrollWidth <= row.clientWidth) return
    const left = btn.offsetLeft - 16
    const right = btn.offsetLeft + btn.offsetWidth + 16 - row.clientWidth
    if (row.scrollLeft > left) row.scrollLeft = left
    else if (row.scrollLeft < right) row.scrollLeft = right
  }, [value])

  // The row gets its backdrop only while it is stuck to the top (not as a band over the page).
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const a = anchor.current
    const root = a?.closest('.content') as HTMLElement | null
    if (!a || !root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)), { root, threshold: 0 })
    io.observe(a)
    return () => io.disconnect()
  }, [])

  // A switch while scrolled down starts the new tab at its top (the row stays where it is).
  const choose = useCallback(
    (id: string) => {
      const a = anchor.current
      const scroller = a?.closest('.content') as HTMLElement | null
      if (!jump && a && scroller && a.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
        requestAnimationFrame(() => a.scrollIntoView({ block: 'start' }))
      }
      onChange(id)
    },
    [onChange, jump]
  )

  // 1–9 anywhere on the page (not while typing, not over a task that uses 1–4 itself).
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => {
    if (!keys) return
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || !/^[1-9]$/.test(e.key)) return
      if (typing(document.activeElement) || typing(e.target as Element)) return
      if (!bar.current?.offsetParent) return
      if (document.querySelector('[data-hotkeys]:hover, .sheet, [role="dialog"][aria-modal="true"]')) return
      const t = tabsRef.current[Number(e.key) - 1]
      if (!t) return
      e.preventDefault()
      choose(t.id)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [keys, choose])

  const onKey = (e: React.KeyboardEvent) => {
    const at = tabs.findIndex((t) => t.id === value)
    const go = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (go == null) return
    e.preventDefault()
    const next = tabs[(go + tabs.length) % tabs.length]
    if (!next) return
    choose(next.id)
    bar.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.id)}"]`)?.focus()
  }

  return (
    <>
    <span ref={anchor} className="ptabs-anchor" aria-hidden />
    <div className={`ptabs-wrap ${stuck ? 'stuck' : ''} ${className}`}>
      <div ref={bar} className={`ptabs ${ready ? 'ready' : ''}`} role="tablist" aria-label={label} onKeyDown={onKey}>
        <span ref={ind} className="ptabs-ind" aria-hidden />
        {tabs.map((t, i) => {
          const on = t.id === value
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              id={`ptab-${page}-${t.id}`}
              aria-selected={on}
              aria-controls={`ptp-${page}-${t.id}`}
              tabIndex={on ? 0 : -1}
              className={on ? 'on' : ''}
              title={t.title ?? (keys && i < 9 ? `${t.label} (${i + 1})` : t.label)}
              onClick={() => choose(t.id)}
            >
              <span className="ptabs-l">{t.label}</span>
              {t.count != null && t.count !== '' && <i className="ptabs-n">{t.count}</i>}
            </button>
          )
        })}
      </div>
      {end}
    </div>
    </>
  )
}

/** One tab's content. Every panel stays mounted; the hidden ones are just not shown. */
export function TabPanel({ page, id, value, children, className = '' }: { page: string; id: string; value: string; children: ReactNode; className?: string }) {
  const on = id === value
  return (
    <div role="tabpanel" id={`ptp-${page}-${id}`} aria-labelledby={`ptab-${page}-${id}`} hidden={!on} className={`ptab-panel ${className}`} data-tabpanel={id}>
      {children}
    </div>
  )
}
