import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { isFlowRule } from '@core/rules'
import type { Rule, ShopState } from '@shared/api'
import type { TodoTask } from '@core/todoist'
import { Icon, type IconName } from './Icon'
import { MODULES, SYSTEM_PAGES, type PageId } from './modules'
import { TAB_LINKS } from '@core/pageTabs'
import { openTab } from './PageTabs'

export interface Command {
  id: string
  label: string
  hint?: string
  group: 'Go to' | 'Log' | 'Tasks' | 'Schedule' | 'Shop' | 'Actions'
  icon: IconName
  color?: string
  run: () => void | Promise<unknown>
}

interface Sources {
  rules: Rule[]
  /** Today's Todoist (the one task system). */
  todo: TodoTask[] | null
  shop: ShopState | null
  go: (page: PageId, view?: 'app' | 'system') => void
  award: (rule: Rule) => Promise<unknown>
  completeTodo: (t: TodoTask) => Promise<unknown>
  actions: Command[]
  /** The module switch (core/modules.ts pageOn): a page of a module that is off is not offered. Missing = every page. */
  pageOn?: (page: string) => boolean
}

/** Everything the palette can do right now. */
export function buildCommands(s: Sources): Command[] {
  const out: Command[] = []
  const on = s.pageOn ?? (() => true)
  for (const m of [...MODULES, ...SYSTEM_PAGES]) {
    if (m.phase > 0 || !on(m.id)) continue
    out.push({ id: `go:${m.id}`, label: m.label, hint: m.blurb, group: 'Go to', icon: m.icon, color: m.color, run: () => s.go(m.id) })
  }
  // A page's own tab, straight away ("water" opens Today on Body).
  for (const l of TAB_LINKS) {
    if (!on(l.page)) continue
    const m = [...MODULES, ...SYSTEM_PAGES].find((x) => x.id === l.page)
    out.push({ id: `tab:${l.page}:${l.tab}`, label: l.label, hint: l.hint, group: 'Go to', icon: m?.icon ?? 'list', color: m?.color, run: () => openTab(l.page, l.tab) })
  }
  out.push(
    { id: 'go:finance', label: 'Finance Helper', hint: 'Open the app', group: 'Go to', icon: 'coin', color: '#F5C84B', run: () => s.go('money', 'app') },
    { id: 'go:waky', label: 'Waky', hint: 'Open the app', group: 'Go to', icon: 'moon', color: '#6EE7D8', run: () => s.go('sleep', 'app') },
    { id: 'go:man', label: 'MAN', hint: 'Open the app', group: 'Go to', icon: 'shield', color: '#FF8A3D', run: () => s.go('discipline', 'app') }
  )
  for (const r of s.rules.filter((r) => r.enabled && !isFlowRule(r.id))) {
    out.push({ id: `log:${r.id}`, label: r.title, hint: `${r.coins > 0 ? '+' : ''}${r.coins} points`, group: 'Log', icon: 'plus', run: () => s.award(r) })
  }
  for (const t of on('tasks') ? s.todo ?? [] : []) {
    out.push({ id: `todo:${t.id}`, label: t.content, hint: `Done in Todoist${t.dueTime ? ` · ${t.dueTime}` : ''}`, group: 'Tasks', icon: 'check', run: () => s.completeTodo(t) })
  }
  for (const r of on('shop') ? s.shop?.rewards ?? [] : []) {
    out.push({ id: `reward:${r.id}`, label: r.title, hint: `${r.price} points`, group: 'Shop', icon: 'gift', run: () => s.go('shop') })
  }
  return [...out, ...s.actions]
}

/** Scores a label against the typed text: every letter in order, earlier and tighter is better. */
export function fuzzyScore(label: string, q: string): number {
  if (!q) return 1
  const l = label.toLowerCase()
  const query = q.toLowerCase().trim()
  if (l.includes(query)) return 100 - l.indexOf(query)
  let i = 0
  let gaps = 0
  for (const ch of query) {
    const at = l.indexOf(ch, i)
    if (at === -1) return 0
    gaps += at - i
    i = at + 1
  }
  return Math.max(1, 50 - gaps)
}

export function Palette({ open, onClose, commands, onFreeText, live }: { open: boolean; onClose: () => void; commands: Command[]; onFreeText?: (text: string) => void; live?: (q: string) => Promise<Command | null> }) {
  const [q, setQ] = useState('')
  // A line that is money ("45 food", "+500 salary") gets its own top row (MF1).
  const [extra, setExtra] = useState<Command | null>(null)
  useEffect(() => {
    if (!live || !/\d/.test(q)) return setExtra(null)
    let on = true
    const id = setTimeout(() => void live(q.trim()).then((c) => on && setExtra(c)).catch(() => on && setExtra(null)), 120)
    return () => {
      on = false
      clearTimeout(id)
    }
  }, [q, live])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => input.current?.focus(), 10)
    }
  }, [open])

  const results = useMemo(() => {
    const scored = commands.map((c) => ({ c, s: Math.max(fuzzyScore(c.label, q), fuzzyScore(`${c.group} ${c.label}`, q) * 0.8) })).filter((x) => x.s > 0)
    if (q) scored.sort((a, b) => b.s - a.s)
    const list = scored.slice(0, 40).map((x) => x.c)
    return extra && q ? [extra, ...list] : list
  }, [commands, q, extra])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    list.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  function run(c: Command | undefined) {
    if (!c) return
    onClose()
    void c.run()
  }

  return (
    <AnimatePresence>
      {open && (
        <m.div className="palette-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onMouseDown={onClose}>
          <m.div
            className="palette"
            role="dialog"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="palette-input">
              <Icon name="search" size={16} />
              <input
                ref={input}
                value={q}
                placeholder="Jump to, log, complete, start…"
                aria-label="Search commands"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSel((s) => Math.min(results.length - 1, s + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSel((s) => Math.max(0, s - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    // Nothing matches: it's a capture ("45 lunch", "water 500", "call mom tomorrow").
                    if (!results.length && q.trim() && onFreeText) {
                      onClose()
                      onFreeText(q.trim())
                    } else run(results[sel])
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    onClose()
                  }
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="palette-list" ref={list} role="listbox">
              {results.length === 0 && <div className="palette-empty">{onFreeText ? <>Enter adds “{q}” (money, water, reps, a task, or a note for Ben).</> : <>Nothing matches “{q}”.</>}</div>}
              {results.map((c, i) => (
                <div key={c.id}>
                  {(i === 0 || results[i - 1].group !== c.group) && !q && <div className="palette-group">{c.group}</div>}
                  <button
                    role="option"
                    aria-selected={i === sel}
                    data-sel={i === sel}
                    className={`palette-item ${i === sel ? 'sel' : ''}`}
                    style={{ ['--c' as string]: c.color ?? 'var(--lime)' }}
                    onMouseMove={() => setSel(i)}
                    onClick={() => run(c)}
                  >
                    <span className="pi-icon">
                      <Icon name={c.icon} size={15} />
                    </span>
                    <span className="pi-label">{c.label}</span>
                    {q && <span className="pi-group">{c.group}</span>}
                    {c.hint && <span className="pi-hint">{c.hint}</span>}
                  </button>
                </div>
              ))}
            </div>
            <div className="palette-foot">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> move
              </span>
              <span>
                <kbd>Enter</kbd> run
              </span>
              <span>
                <kbd>Ctrl</kbd> <kbd>K</kbd> open anywhere
              </span>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
