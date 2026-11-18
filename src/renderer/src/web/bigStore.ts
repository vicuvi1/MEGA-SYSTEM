// The big copies the apps' sync keeps on this device, out of localStorage.
//
// localStorage gives one site about 5 million characters. Money alone was kept
// there up to three times: the app's own data, the copy both sides last agreed
// on (`life_sync_<setting>`), and the copy from before a restore
// (`life_sync_<setting>_before_restore`). The last two now live in IndexedDB
// (no such limit), behind the same getItem / setItem / removeItem the sync
// already used, so nothing that reads them changed.
//
// How it stays safe:
// - Reads and writes are answered from memory at once; the write to IndexedDB
//   follows. `flush()` waits for it and throws if it failed, and the sync
//   calls it before it reports "synced" (never a silent loss).
// - Moving an old copy over: written to IndexedDB, read back in a NEW
//   transaction, compared letter for letter, and only then removed from
//   localStorage. If anything differs, the old copy stays where it is and is
//   used from there.
// - No IndexedDB (a private window, an old browser, a blocked store): the
//   keys stay in localStorage exactly as before.
// - A write still on its way when the page closes is also put in localStorage
//   (if it fits) and picked up on the next start.
// - Another tab's write arrives over a BroadcastChannel.
//
// Losing one of these copies loses no records: without an agreed copy the next
// sync simply merges again (a union), and a restore also leaves a full backup.
// The app's own data (finance-helper.state) is NOT here yet: see DECISIONS.md.

/** The keys that live here: an app's agreed copy and its copy from before a restore. */
export const isBigKey = (key: string): boolean => /^life_sync_app_sync_[a-z]+(_before_restore)?$/.test(key)

const PENDING = 'life_big_pending:'
const DB_NAME = 'life-big-store'
const STORE = 'kv'

export interface BigStoreStatus {
  /** Where the big keys live on this device. */
  mode: 'indexeddb' | 'localStorage'
  /** Why the last write or the move failed (null: all fine). */
  error: string | null
  /** The big keys held (IndexedDB and any still in localStorage). */
  keys: { key: string; chars: number; where: 'indexeddb' | 'localStorage' }[]
}

export interface BigStore extends Storage {
  /** Resolves once the stored copies are loaded (and old ones moved over). Reads before it see only localStorage. */
  ready: Promise<void>
  /** Waits until every write so far is stored; throws when one could not be. */
  flush(): Promise<void>
  status(): BigStoreStatus
}

interface ChannelLike {
  postMessage(m: unknown): void
  onmessage: ((e: { data: any }) => void) | null
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

export function createBigStore(opts: { local: Storage; idb?: IDBFactory | null; isBig?: (key: string) => boolean; name?: string; channel?: ChannelLike | null; onError?: (message: string) => void }): BigStore {
  const { local } = opts
  const big = opts.isBig ?? isBigKey
  const idb = opts.idb === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : opts.idb
  const cache = new Map<string, string>()
  /** Keys written or removed here since the start: the load from disk must not undo them. */
  const touched = new Set<string>()
  /** Keys whose move failed its check: they stay in localStorage and are used from there. */
  const stay = new Set<string>()
  let mode: 'indexeddb' | 'localStorage' = 'localStorage'
  let db: IDBDatabase | null = null
  let error: string | null = null
  /** Keys whose last write is stored nowhere on this device. */
  const failed = new Map<string, Error>()
  let tail: Promise<void> = Promise.resolve()
  const waiting = new Map<string, string | null>()

  const fail = (what: string, e: unknown) => {
    error = `${what}: ${String((e as Error)?.message ?? (e as Error)?.name ?? e)}`.slice(0, 240)
    try {
      opts.onError?.(error)
    } catch {
      /* the listener's problem */
    }
  }
  const safeGet = (k: string): string | null => {
    try {
      return local.getItem(k)
    } catch {
      return null
    }
  }
  const safeDel = (k: string) => {
    try {
      local.removeItem(k)
    } catch {
      /* private window */
    }
  }

  const open = async (): Promise<IDBDatabase> => {
    const r = idb!.open(opts.name ?? DB_NAME, 1)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE)
    }
    return req(r)
  }
  const put = async (key: string, value: string | null): Promise<void> => {
    const tx = db!.transaction(STORE, 'readwrite')
    if (value == null) tx.objectStore(STORE).delete(key)
    else tx.objectStore(STORE).put(value, key)
    await done(tx)
  }
  const read = async (key: string): Promise<string | null> => {
    const v = await req(db!.transaction(STORE).objectStore(STORE).get(key))
    return typeof v === 'string' ? v : null
  }

  /** The write to IndexedDB, in order. A failure keeps the value in localStorage if it fits, and is said out loud. */
  const queue = (key: string, value: string | null) => {
    waiting.set(key, value)
    tail = tail.then(async () => {
      if (!waiting.has(key) || waiting.get(key) !== value) return // a newer write of this key follows
      try {
        await put(key, value)
        if (waiting.get(key) === value) waiting.delete(key)
        safeDel(PENDING + key)
        if (!stay.has(key)) safeDel(key)
        opts.channel?.postMessage({ key })
        failed.delete(key)
      } catch (e) {
        waiting.delete(key)
        // Not lost: back to localStorage, as before this store existed.
        try {
          if (value == null) local.removeItem(key)
          else local.setItem(key, value)
          stay.add(key)
          cache.delete(key)
          failed.delete(key)
          fail(`This device's bigger storage refused a write, so "${key}" is kept in the small one`, e)
        } catch (e2) {
          failed.set(key, new Error(`This device's storage is full (${String((e2 as Error)?.name ?? e2)})`))
          fail(`"${key}" could not be stored on this device`, e2)
        }
      }
    })
  }

  const ready = (async () => {
    if (!idb) return
    try {
      db = await open()
      const tx = db.transaction(STORE)
      const [keys, values] = await Promise.all([req(tx.objectStore(STORE).getAllKeys()), req(tx.objectStore(STORE).getAll())])
      keys.forEach((k, i) => {
        if (typeof k === 'string' && typeof values[i] === 'string' && !touched.has(k)) cache.set(k, values[i])
      })
      mode = 'indexeddb'
    } catch (e) {
      db = null
      fail('IndexedDB is not available here, so the sync copies stay in the small storage', e)
      return
    }
    // A write that was on its way when the page closed last time.
    const names: string[] = []
    try {
      for (let i = 0; i < local.length; i++) {
        const k = local.key(i)
        if (k) names.push(k)
      }
    } catch {
      /* no listing: nothing to move */
    }
    for (const k of names) {
      if (!k.startsWith(PENDING)) continue
      const key = k.slice(PENDING.length)
      const v = safeGet(k)
      if (v != null && big(key) && !touched.has(key)) {
        cache.set(key, v)
        queue(key, v)
      } else safeDel(k)
    }
    // Old copies still in localStorage: moved over, checked, and only then removed there.
    for (const key of names) {
      if (!big(key) || touched.has(key)) continue
      const old = safeGet(key)
      if (old == null) continue
      try {
        await put(key, old)
        const back = await read(key)
        if (back !== old) throw new Error('the copy read back is not the copy written')
        if (!touched.has(key)) cache.set(key, old)
        safeDel(key)
      } catch (e) {
        stay.add(key)
        cache.delete(key)
        fail(`"${key}" could not be moved to the bigger storage and stays where it was`, e)
      }
    }
    await tail
  })()

  if (opts.channel) {
    opts.channel.onmessage = (e) => {
      const key = e?.data?.key
      if (typeof key !== 'string' || !db || waiting.has(key)) return
      void read(key).then((v) => {
        if (waiting.has(key)) return
        if (v == null) cache.delete(key)
        else cache.set(key, v)
      }, () => {})
    }
  }
  // Leaving the page with a write still on its way: keep it where a closing page can (if it fits).
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => {
      for (const [key, value] of waiting) {
        if (value == null) continue
        try {
          local.setItem(PENDING + key, value)
        } catch {
          /* too big for the small storage: the IndexedDB write usually still finishes */
        }
      }
    })
  }

  const inIdb = (key: string) => mode === 'indexeddb' && db != null && big(key) && !stay.has(key)

  const store = {
    ready,
    getItem(key: string): string | null {
      if (!big(key)) return local.getItem(key)
      if (cache.has(key)) return cache.get(key)!
      // Removed here, or never there. An old copy still in localStorage (not moved yet, or kept there) is read as it is.
      return touched.has(key) && inIdb(key) ? null : safeGet(key)
    },
    setItem(key: string, value: string): void {
      if (!big(key)) return local.setItem(key, value)
      if (!inIdb(key) && !(idb && db == null && mode === 'localStorage' && !error)) {
        // No IndexedDB: exactly as before (a full storage throws, as before).
        local.setItem(key, value)
        return
      }
      touched.add(key)
      cache.set(key, String(value))
      if (db) queue(key, String(value))
      else
        void ready.then(() => {
          if (cache.get(key) !== String(value)) return
          if (db) return queue(key, String(value))
          // IndexedDB turned out not to be there: the small storage, as before.
          cache.delete(key)
          try {
            local.setItem(key, String(value))
          } catch (e) {
            cache.set(key, String(value))
            failed.set(key, new Error(`This device's storage is full (${String((e as Error)?.name ?? e)})`))
            fail(`"${key}" could not be stored on this device`, e)
          }
        })
    },
    removeItem(key: string): void {
      if (!big(key)) return local.removeItem(key)
      touched.add(key)
      cache.delete(key)
      safeDel(key)
      safeDel(PENDING + key)
      if (db) queue(key, null)
      else void ready.then(() => db && !cache.has(key) && queue(key, null), () => {})
    },
    clear: () => local.clear(),
    key: (i: number) => local.key(i),
    get length() {
      return local.length
    },
    async flush(): Promise<void> {
      await ready.catch(() => {})
      await tail
      const first = failed.values().next().value
      if (first) throw first
    },
    status(): BigStoreStatus {
      const keys: BigStoreStatus['keys'] = [...cache].map(([key, v]) => ({ key, chars: v.length, where: 'indexeddb' as const }))
      try {
        for (let i = 0; i < local.length; i++) {
          const k = local.key(i)
          if (k && big(k) && !cache.has(k)) keys.push({ key: k, chars: (safeGet(k) ?? '').length, where: 'localStorage' })
        }
      } catch {
        /* no listing */
      }
      return { mode, error, keys }
    }
  }
  return store as unknown as BigStore
}

let host: BigStore | null | undefined
/** This window's store for the sync's copies (null where there is no localStorage: the server). */
export function hostStore(): BigStore | null {
  if (host !== undefined) return host
  if (typeof localStorage === 'undefined') return (host = null)
  let channel: ChannelLike | null = null
  try {
    channel = typeof BroadcastChannel !== 'undefined' ? (new BroadcastChannel('life-big-store') as unknown as ChannelLike) : null
  } catch {
    channel = null
  }
  host = createBigStore({
    local: localStorage,
    channel,
    onError: (message) => {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('life-big-store', { detail: { error: message } }))
    }
  })
  // For the smoke test and for looking at it by hand in the console.
  if (typeof window !== 'undefined') (window as unknown as { __lifeStore?: BigStore }).__lifeStore = host
  return host
}
