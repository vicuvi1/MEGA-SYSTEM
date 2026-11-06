// PL5: safe user scripts for custom tiles ("show X when Y"). A script is a
// few lines of JavaScript that run in a fresh Web Worker each time (no page,
// no DOM, no storage, no network unless you allow hosts), with a small API:
//
//   life.now, life.hour, life.minute, life.weekday   the time
//   life.today                                        the same read-only data widgets get
//   show(text, icon?)                                 what the tile shows (no show = the tile hides)
//   notify(text)                                      a short notice on the island (once a run)
//   addTask(text)                                     asks you first, then adds it to Todoist
//   await fetch(url)                                  only https hosts you listed; text back
//
// The worker is ended after a short time limit (TIME_MS), memory-heavy calls
// are capped, and a fresh worker runs each time, so nothing piles up. Pure
// and tested (scripts.test.ts runs real workers).
import { isPublicHost } from './manifest'

export interface UserScript {
  id: string
  name: string
  icon: string
  code: string
  on: boolean
  /** The island page its tile is on. */
  page: string
  /** How often it runs (seconds, 60 … 3600). */
  every: number
  /** Hosts it may fetch (empty: no network). */
  hosts: string[]
  /** May it ask to add tasks (you still confirm each). */
  add: boolean
}

export const SCRIPT_CODE_MAX = 2000
export const SCRIPTS_MAX = 8
/** How long one run may take (ms of the worker's life). */
export const TIME_MS = 250
/** Extra time while waiting for a fetch the host is making. */
export const FETCH_WAIT_MS = 5000
/** The biggest buffer, typed array, array or string a script may make. */
export const MEM_CAP = 1_000_000

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, n) : '')

export function cleanScript(v: any, i = 0): UserScript | null {
  const code = clip(v?.code, SCRIPT_CODE_MAX)
  if (!code.trim()) return null
  const every = Math.round(Number(v?.every))
  return {
    id: typeof v?.id === 'string' && /^[a-z0-9-]{1,24}$/.test(v.id) ? v.id : `s${i}`,
    name: clip(v?.name, 30).trim() || 'My tile',
    icon: clip(v?.icon, 4).trim() || '✨',
    code,
    on: v?.on !== false,
    page: typeof v?.page === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(v.page) ? v.page : 'pc',
    every: Number.isFinite(every) ? Math.max(60, Math.min(3600, every)) : 300,
    hosts: (Array.isArray(v?.hosts) ? v.hosts : []).map((h: unknown) => String(h).toLowerCase().trim()).filter(isPublicHost).slice(0, 5),
    add: v?.add === true
  }
}

export function cleanScripts(v: unknown): UserScript[] {
  const out: UserScript[] = []
  for (const [i, s] of (Array.isArray(v) ? v : []).entries()) {
    const c = cleanScript(s, i)
    if (c && !out.some((x) => x.id === c.id)) out.push(c)
  }
  return out.slice(0, SCRIPTS_MAX)
}

/** What a run gives back (after checking). */
export interface ScriptResult {
  show: { text: string; icon: string } | null
  notify: string | null
  error?: string
}

export function readResult(v: any): ScriptResult {
  const show = v?.show && typeof v.show.text === 'string' && v.show.text.trim() ? { text: clip(v.show.text, 60).trim(), icon: clip(v.show.icon, 4).trim() } : null
  const notify = typeof v?.notify === 'string' && v.notify.trim() ? clip(v.notify, 120).trim() : null
  return { show, notify, ...(typeof v?.error === 'string' ? { error: clip(v.error, 120) } : {}) }
}

/**
 * The worker's own code: it locks the worker down (network, storage, other
 * workers and channels gone; memory-heavy calls capped), then runs your
 * script once with the API above. Messages: in {t:'run', input}, {t:'reply',
 * id, ok, value|error}; out {t:'call', id, op, …}, {t:'done', show, notify},
 * {t:'fail', error}.
 */
export function workerSource(code: string): string {
  if (code.length > SCRIPT_CODE_MAX) throw new Error('Script too long')
  return `"use strict";
(() => {
const G = globalThis;
const post = G.postMessage.bind(G);
const CAP = ${MEM_CAP};
const GONE = ['fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','BroadcastChannel','MessageChannel','importScripts','indexedDB','caches','Worker','SharedWorker','RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','Request','Notification','FileReaderSync','close','require','process','Buffer'];
for (let p = G; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
  for (const k of GONE) { try { if (Object.getOwnPropertyDescriptor(p, k)) Object.defineProperty(p, k, { value: undefined, writable: false, configurable: false }); } catch (e) {} }
}
try { if (G.navigator) { const N = Object.getPrototypeOf(G.navigator); for (const k of ['serviceWorker','storage','locks','sendBeacon','connection','gpu','usb','hid','serial','bluetooth']) { try { Object.defineProperty(N, k, { get: () => undefined, configurable: false }); } catch (e) {} } } } catch (e) {}
const tooBig = (n) => typeof n === 'number' && n > CAP;
const capCtor = (name) => { const C = G[name]; if (typeof C !== 'function') return; const P = new Proxy(C, { construct(t, a, nt) { if (tooBig(a[0]) || (a[0] && tooBig(a[0].length)) || (a[0] && tooBig(a[0].byteLength))) throw new RangeError('Too much memory for a script'); return Reflect.construct(t, a, nt); }, apply(t, self, a) { if (tooBig(a[0])) throw new RangeError('Too much memory for a script'); return Reflect.apply(t, self, a); } }); try { Object.defineProperty(G, name, { value: P, writable: false, configurable: false }); } catch (e) {} };
for (const n of ['ArrayBuffer','SharedArrayBuffer','Array','Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array']) capCtor(n);
const S = String.prototype;
for (const k of ['repeat','padStart','padEnd']) { const f = S[k]; Object.defineProperty(S, k, { value: function (...a) { const n = k === 'repeat' ? this.length * Number(a[0]) : Number(a[0]); if (n > CAP) throw new RangeError('Too much memory for a script'); return f.apply(this, a); }, writable: false, configurable: false }); }
let shown = null, note = null, seq = 0, started = false;
const waits = new Map();
const call = (op, extra) => new Promise((ok, no) => { const id = ++seq; waits.set(id, { ok, no }); post({ t: 'call', id, op, ...extra }); });
const api = {
  show(text, icon) { shown = { text: String(text).slice(0, 60), icon: icon == null ? '' : String(icon).slice(0, 4) }; },
  notify(text) { if (note == null) note = String(text).slice(0, 120); },
  addTask(text) { return call('addTask', { text: String(text).slice(0, 200) }); },
  fetch(url) { return call('fetch', { url: String(url).slice(0, 500) }); }
};
const onMsg = (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'reply') { const w = waits.get(m.id); if (!w) return; waits.delete(m.id); return m.ok ? w.ok(m.value) : w.no(new Error(String(m.error || 'Refused'))); }
  if (m.t !== 'run' || started) return;
  started = true;
  const input = m.input || {};
  const life = Object.freeze({ now: input.now, hour: input.hour, minute: input.minute, weekday: input.weekday, today: input.today == null ? null : input.today });
  Promise.resolve().then(() => __user(life, api.show, api.notify, api.addTask, api.fetch))
    .then(() => post({ t: 'done', show: shown, notify: note }), (e) => post({ t: 'fail', error: String((e && e.message) || e).slice(0, 120), show: shown, notify: note }));
};
if (typeof G.addEventListener === 'function') G.addEventListener('message', (e) => onMsg(e.data));
G.__onHostMessage = onMsg;
})();
// Your script: outside the lock-down code, so it sees only the API above.
const __user = async function (life, show, notify, addTask, fetch) {
${code}
};
`
}
