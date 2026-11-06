// Long Settings sections get the same switch as the long pages (PageTabs):
// each tab shows the section's cards whose heading it names. Cards keep their
// own code; this only shows or hides them, so nothing is lost and a card
// without a heading stays with the one before it. Desktop & island, one long
// card, gets a jump bar to its parts instead.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { PageTabs, usePageTab } from './PageTabs'

export interface SectionTab {
  id: string
  label: string
  /** Card headings (any part of the text, any case) that open this tab. */
  heads: string[]
}

const headOf = (el: Element) => (el.querySelector('h2, h3')?.textContent ?? '').trim().toLowerCase()

/** Which tab each card of the grid belongs to: by its heading, else the card before it. */
export function cardTabs(heads: string[], tabs: SectionTab[]): string[] {
  let cur = tabs[0]?.id ?? ''
  return heads.map((h) => {
    const t = h && tabs.find((x) => x.heads.some((w) => h.includes(w.toLowerCase())))
    if (t) cur = t.id
    return cur
  })
}

export function SectionTabs({ section, tabs, children }: { section: string; tabs: SectionTab[]; children: ReactNode }) {
  const page = `settings.${section}`
  const grid = useRef<HTMLDivElement>(null)
  const [present, setPresent] = useState<string[]>(() => tabs.map((t) => t.id))
  const ids = tabs.map((t) => t.id).filter((id) => present.includes(id))
  const [tab, setTab] = usePageTab(page, ids, ids[0])
  const tabRef = useRef(tab)
  tabRef.current = tab
  const apply = useCallback(() => {
    const el = grid.current
    if (!el) return
    const kids = Array.from(el.children)
    const owner = cardTabs(kids.map(headOf), tabs)
    kids.forEach((k, i) => (owner[i] === tabRef.current ? k.removeAttribute('data-st-off') : k.setAttribute('data-st-off', '')))
    const have = tabs.map((t) => t.id).filter((id) => owner.includes(id))
    setPresent((p) => (have.length && have.join() !== p.join() ? have : p))
  }, [tabs])
  useLayoutEffect(apply, [apply, tab])
  useEffect(() => {
    const el = grid.current
    if (!el || typeof MutationObserver === 'undefined') return
    // Cards that load later (or get their heading later) are sorted too, at most once a frame.
    let raf = 0
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), apply()))
    })
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [apply])
  return (
    <>
      <div className="st-tabs">
        <PageTabs page={page} label="Parts of this section" tabs={tabs.filter((t) => ids.includes(t.id))} value={tab} onChange={setTab} />
      </div>
      <div className="st-grid st-grid-tabs" ref={grid}>
        {children}
      </div>
    </>
  )
}

/** A jump bar for one long card: its part headings, the one you're reading lit up. */
export function SectionJump({ section, selector, children }: { section: string; selector: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [parts, setParts] = useState<{ id: string; label: string }[]>([])
  const [on, setOn] = useState('')
  useEffect(() => {
    const el = box.current
    if (!el) return
    const read = () => {
      const hs = Array.from(el.querySelectorAll<HTMLElement>(selector))
      const next = hs.map((h, i) => {
        if (!h.id) h.id = `st-${section}-${i}`
        return { id: h.id, label: (h.textContent ?? '').trim() }
      })
      setParts((p) => (p.map((x) => x.id + x.label).join() === next.map((x) => x.id + x.label).join() ? p : next))
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [section, selector])
  useEffect(() => {
    const scroller = box.current?.closest('.content') as HTMLElement | null
    if (!scroller || !parts.length) return
    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top + 90
      let cur = parts[0].id
      for (const p of parts) {
        const h = document.getElementById(p.id)
        if (h && h.getBoundingClientRect().top <= top) cur = p.id
      }
      setOn(cur)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [parts])
  const go = (id: string) => {
    setOn(id)
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <>
      {parts.length > 2 && (
        <div className="st-tabs st-jump">
          <PageTabs page={`settings.${section}`} label="Jump to a part" tabs={parts} value={on || parts[0].id} onChange={go} keys={false} jump />
        </div>
      )}
      <div className="st-grid" ref={box}>
        {children}
      </div>
    </>
  )
}
