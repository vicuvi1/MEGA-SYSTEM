// Stand-ins for the tests of the device store (web/bigStore.ts): a localStorage
// with a quota, and a tiny IndexedDB (one database, one object store, requests
// answered on a later tick) that can be told to fail. Test code only.

export function memLocal(quota = Infinity): Storage {
  const m = new Map<string, string>()
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0)
  const s = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (used() - (m.has(k) ? k.length + m.get(k)!.length : 0) + k.length + String(v).length > quota) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
      m.set(k, String(v))
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    }
  }
  return s as unknown as Storage
}

export interface FakeIdbOptions {
  failOpen?: boolean
  /** Never answers the open request (a browser that hangs). */
  hangOpen?: boolean
  corrupt?: (key: string, value: string) => string
  failPut?: (key: string) => boolean
}

export function fakeIdb(o: FakeIdbOptions = {}) {
  const data = new Map<string, string>()
  /** Every key written, in order. */
  const puts: string[] = []
  const later = (fn: () => void) => void Promise.resolve().then(fn)
  const request = <T,>(get: () => T) => {
    const r: any = { result: undefined, error: null, onsuccess: null, onerror: null }
    later(() => {
      try {
        r.result = get()
        r.onsuccess?.()
      } catch (e) {
        r.error = e
        r.onerror?.()
      }
    })
    return r
  }
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    transaction: (_name: string, mode = 'readonly') => {
      const tx: any = { oncomplete: null, onerror: null, onabort: null, error: null }
      let bad: Error | null = null
      // What this transaction wrote: applied only when it completes (a failed one changes nothing).
      const writes: [string, string | null][] = []
      tx.objectStore = () => ({
        get: (k: string) => request(() => data.get(k)),
        getAll: () => request(() => [...data.values()]),
        getAllKeys: () => request(() => [...data.keys()]),
        put: (v: string, k: string) => {
          if (o.failPut?.(k)) bad = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
          else writes.push([k, o.corrupt ? o.corrupt(k, v) : v])
        },
        delete: (k: string) => void writes.push([k, null])
      })
      if (mode === 'readwrite')
        later(() =>
          later(() => {
            if (bad) {
              tx.error = bad
              tx.onerror?.()
              return
            }
            for (const [k, v] of writes) {
              if (v == null) data.delete(k)
              else {
                data.set(k, v)
                puts.push(k)
              }
            }
            tx.oncomplete?.()
          })
        )
      return tx
    }
  }
  const factory = {
    open: () => {
      const r: any = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      later(() => {
        if (o.hangOpen) return
        if (o.failOpen) {
          r.error = new Error('IndexedDB is blocked')
          r.onerror?.()
        } else {
          r.onupgradeneeded?.()
          r.onsuccess?.()
        }
      })
      return r
    }
  }
  return { factory: factory as unknown as IDBFactory, data, puts }
}

/** Two channel ends that deliver to each other (a BroadcastChannel between two windows). */
export function channelPair() {
  const a: any = { postMessage: (m: unknown) => void Promise.resolve().then(() => b.onmessage?.({ data: m })), onmessage: null }
  const b: any = { postMessage: (m: unknown) => void Promise.resolve().then(() => a.onmessage?.({ data: m })), onmessage: null }
  return [a, b] as const
}

/** A window that records the `storage` events it is sent, and can fire its own listeners. */
export function fakeWindow(local: Storage) {
  const listeners = new Map<string, ((e: any) => void)[]>()
  const heard: { key: string | null; newValue: string | null }[] = []
  const win: any = {
    closed: false,
    localStorage: local,
    location: { href: 'https://life.test/' },
    addEventListener: (type: string, fn: (e: any) => void) => void listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    dispatchEvent: (e: any) => {
      if (e.type === 'storage') heard.push({ key: e.key ?? null, newValue: e.newValue ?? null })
      for (const fn of listeners.get(e.type) ?? []) fn(e)
      return true
    },
    Event: class {
      type: string
      newValue: string | null
      constructor(type: string, init: any = {}) {
        this.type = type
        this.newValue = init.newValue ?? null
      }
    }
  }
  return { win: win as Window, heard, fire: (type: string, e: any = {}) => win.dispatchEvent({ type, ...e }) }
}
