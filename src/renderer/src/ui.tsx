import { moduleLabel } from './modules'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useFlip, useLeaving, useSwipeDismiss } from './toastMotion'
import type { LedgerEntry } from '@shared/api'
import { play } from './soundKit'
import { useCountUp } from './motionKit'

/** A toast may carry one action (e.g. Undo); it then stays a little longer. */
export type ToastAction = { label: string; run: () => void }
type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info'; action?: ToastAction }
const ToastCtx = createContext<(text: string, tone?: Toast['tone'], action?: ToastAction) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const { leaving, leave } = useLeaving()
  const drop = useCallback((id: number) => leave(id, () => setToasts((t) => t.filter((x) => x.id !== id))), [leave])
  const push = useCallback((text: string, tone: Toast['tone'] = 'info', action?: ToastAction) => {
    const id = Date.now() + Math.random()
    // Something went wrong: a soft low thud (and a short buzz on phones).
    if (tone === 'bad') play('error')
    setToasts((t) => [...t, { id, text, tone, action }])
    setTimeout(() => drop(id), action ? 6500 : 3200)
  }, [drop])
  const box = useRef<HTMLDivElement>(null)
  useFlip(box, toasts)
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite" ref={box}>
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} out={leaving.has(t.id)} onDismiss={() => drop(t.id)} onAct={() => (t.action!.run(), setToasts((x) => x.filter((y) => y.id !== t.id)))} />
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** One toast: springs in, can be swiped away, fades out (AF8). */
function ToastCard({ t, out, onDismiss, onAct }: { t: Toast; out: boolean; onDismiss: () => void; onAct: () => void }) {
  const swipe = useSwipeDismiss(onDismiss)
  return (
    <div data-flip={t.id} className={`toast t-in ${out ? 't-out' : ''} ${t.tone} ${t.action ? 'has-action' : ''}`} {...swipe}>
      {t.text}
      {t.action && (
        <button className="toast-act" onClick={onAct}>
          {t.action.label}
        </button>
      )}
    </div>
  )
}

export const useToast = () => useContext(ToastCtx)

/** Runs an async action and shows its error as a toast. */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((out: T) => string)): Promise<T | undefined> => {
      try {
        const out = await fn()
        const said = typeof success === 'function' ? success(out) : success
        if (said) toast(said, 'good')
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
  // Points count to their new value (AF7).
  const v = Math.round(useCountUp(n))
  const text = `${sign && v > 0 ? '+' : ''}${v.toLocaleString()}`
  return (
    <span className={`coins num ${n < 0 ? 'neg' : ''}`}>
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
