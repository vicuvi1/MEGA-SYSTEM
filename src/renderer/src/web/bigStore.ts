// The big things this device keeps, out of localStorage and in IndexedDB:
// Money's own data, the copies the apps' sync keeps, and the website's changes
// waiting for a connection. The store itself is plain JavaScript in Finance
// Helper (public/apps/finance/js/bigstore.js), because Money opened on its own
// needs the very same one; read how it stays safe there. This file gives it
// types and makes this window's store.
//
// Use `hostStore()` wherever Life reads or writes one of those keys (it is a
// `Storage`; every other key goes straight to localStorage). A plain
// `localStorage.getItem('finance-helper.state')` finds nothing once Money has
// moved. Whoever reports "saved" awaits `flush()` first.

// @ts-ignore plain JS module from the embedded app
import * as impl from '../../public/apps/finance/js/bigstore.js'
// @ts-ignore plain JS module from the embedded app
import { mergeLocal } from '../../public/apps/finance/js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'

/** Money's own data on this device (plain), and its sealed form while Money is locked with its PIN. */
export const MONEY_KEY: string = impl.MONEY_KEY
export const MONEY_ENC: string = impl.MONEY_ENC
/** In localStorage: 'idb' once the new Money has started on this device (only then may its data move). */
export const MONEY_MARK: string = impl.MONEY_MARK
/** The website's changes waiting for a connection (web/mirror.ts). */
export const OUTBOX_KEY: string = impl.OUTBOX_KEY
/** The keys that live in IndexedDB. */
export const isBigKey: (key: string) => boolean = impl.isBigKey
/** Money's own data: moves only after the new Money has started once, and is merged, never replaced. */
export const isAppKey: (key: string) => boolean = impl.isAppKey

export interface BigStoreStatus {
  /** Where the big keys live on this device. */
  mode: 'indexeddb' | 'localStorage'
  /** Why the last write or the move failed (null: all fine). */
  error: string | null
  /** The big keys held (IndexedDB and any still in localStorage). */
  keys: { key: string; chars: number; where: 'indexeddb' | 'localStorage' }[]
  /** Whether the new Money has started on this device (until then its data stays in localStorage). */
  moneyMoved: boolean
}

export interface BigStore extends Storage {
  /** Resolves once the stored copies are loaded (and old ones moved over). Reads before it see only localStorage. */
  ready: Promise<void>
  /** Waits until every write so far is stored; throws when one could not be. */
  flush(): Promise<void>
  status(): BigStoreStatus
  /** The new Money has started here: its data may leave localStorage now. Resolves when it has moved (or stays, with the reason in status()). */
  moveIn(): Promise<void>
  /** The same store for another window of this page (the Money frame): it hears the others' changes, not its own. */
  forWindow(win: Window | null): BigStore
}

interface ChannelLike {
  postMessage(m: unknown): void
  onmessage: ((e: { data: any }) => void) | null
}

export interface BigStoreOptions {
  local: Storage
  idb?: IDBFactory | null
  isBig?: (key: string) => boolean
  /** Keys that move only after `moveIn()` and are merged, never replaced (default: Money's own data). */
  isGated?: (key: string) => boolean
  /** Two texts of one gated key into one (null: they can't be merged). Default: none. */
  merge?: ((key: string, mine: string, theirs: string) => string | null) | null
  name?: string
  channel?: ChannelLike | null
  onError?: (message: string) => void
  /** The window that owns the store (default: this one; null: none, as in tests). */
  win?: Window | null
  /** How long to wait for IndexedDB to open before using localStorage (ms). */
  openWait?: number
}

/** Money's own merge: the newest copy of each record wins, deletions stick (apps/finance/js/sync.js). */
export const moneyMerge: (key: string, mine: string, theirs: string) => string | null = impl.moneyMerge(mergeLocal, normalizeState)

export const createBigStore: (opts: BigStoreOptions) => BigStore = impl.createBigStore

let host: BigStore | null | undefined
let hostLocal: Storage | null = null
/** This window's store (null where there is no localStorage: the server). */
export function hostStore(): BigStore | null {
  const ls = typeof localStorage === 'undefined' ? null : localStorage
  // One per window. (Only a test swaps the localStorage under it.)
  if (host !== undefined && ls === hostLocal) return host
  hostLocal = ls
  if (!ls) return (host = null)
  let channel: ChannelLike | null = null
  try {
    channel = typeof BroadcastChannel !== 'undefined' ? (new BroadcastChannel(impl.CHANNEL) as unknown as ChannelLike) : null
  } catch {
    channel = null
  }
  const root = createBigStore({
    local: ls,
    channel,
    merge: moneyMerge,
    onError: (message) => {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('life-big-store', { detail: { error: message } }))
    }
  })
  // This window hears the Money frame's changes, and the frame hears this window's.
  host = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? root.forWindow(window) : root
  // For the Money frame (it takes this store), the smoke test, and looking at it by hand in the console.
  if (typeof window !== 'undefined') (window as unknown as { __lifeStore?: BigStore }).__lifeStore = host
  return host
}
/** Money's own data as text, from wherever it lives on this device (null: none, or the server). */
export const readMoney = (): string | null => {
  try {
    return hostStore()?.getItem(MONEY_KEY) ?? null
  } catch {
    return null
  }
}
