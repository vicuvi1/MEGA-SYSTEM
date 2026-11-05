import { moduleLabel } from './modules'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LedgerEntry } from '@shared/api'

/** A toast may carry one action (e.g. Undo); it then stays a little longer. */
export type ToastAction = { label: string; run: () => void }
type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info'; action?: ToastAction }
const ToastCtx = createContext<(text: string, tone?: Toast['tone'], action?: ToastAction) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'info', action?: ToastAction) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6500 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} className={`toast ${t.tone} ${t.action ? 'has-action' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
              {t.text}
              {t.action && (
                <button
                  className="toast-act"
                  onClick={() => {
                    t.action!.run()
                    setToasts((x) => x.filter((y) => y.id !== t.id))
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/** Runs an async action and shows its error as a toast. */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const out = await fn()
        if (success) toast(success, 'good')
        return out
      } catch (e) {
        toast((e as Error).message, 'bad')
        return undefined
      }
    },
    [toast]
  )
}

export function Coins({ n, sign = false }: { n: number; sign?: boolean }) {
  const text = `${sign && n > 0 ? '+' : ''}${n.toLocaleString()}`
  return (
    <span className={`coins ${n < 0 ? 'neg' : ''}`}>
      <span className="coin-dot" aria-hidden="true" />
      {text}
    </span>
  )
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function describeEntry(e: LedgerEntry, ruleTitles: Record<string, string>): string {
  if (e.kind === 'undo') return `Undo: ${e.note ?? ''}`
  return (e.ruleId && ruleTitles[e.ruleId]) || e.note || moduleLabel(e.module)
}
