// Finance Helper's receipt messages (Money v2 plan D6), answered by this page.
// EmbedHost passes every message from our own embedded apps here first.
//   FINANCE_RECEIPT_ADD     {req, rid, txId, date, note, name, mime, bytes} → keep it, upload later
//   FINANCE_RECEIPT_INDEX   {req, ids?}                                     → what is known about them
//   FINANCE_RECEIPT_OPEN    {req, rid}                                      → the file (this device or Drive)
//   FINANCE_RECEIPT_CONNECT {req}                                           → sign in again with Drive
// Answers: {type: 'LIFE_FINANCE_RECEIPT', req, ok, error?, items?, …}. After an
// upload, every Finance frame on the page hears the new index (no req).
import { life } from '../bridge'
import { bridgeIndex, createReceiptDrive, createReceipts, idbReceiptStore, type Receipts } from './receipts'

let api: Receipts | null = null
let key: { token: string; expiresAt: number } | null = null
const folders = new Map<string, string>()

async function token(): Promise<string> {
  if (key && key.expiresAt - Date.now() > 120_000) return key.token
  if (!life.google?.driveToken) throw new Error('Google Drive works in the website and the desktop app')
  key = await life.google.driveToken()
  return key.token
}

async function connected(): Promise<boolean> {
  try {
    const st = await life.google?.status()
    return !!(st?.connected && st.drive)
  } catch {
    return false
  }
}

async function shrink(blob: Blob): Promise<{ blob: Blob; mime: string }> {
  // Photo Locker's photo step: at most 2000 px, re-drawn (so EXIF, and any location in it, is gone).
  const { prepPhoto } = await import('../vault/mediaPrep')
  const p = await prepPhoto(blob)
  return { blob: p.blob, mime: p.blob.type || 'image/jpeg' }
}

function receipts(): Receipts {
  return (api ??= createReceipts({
    store: idbReceiptStore,
    index: bridgeIndex(life.moneyReceipts),
    drive: async () => (navigator.onLine !== false && (await connected()) ? createReceiptDrive(token, undefined, undefined, folders) : null),
    shrink
  }))
}

function tellFrames(items: Record<string, unknown>) {
  for (const f of document.querySelectorAll('iframe')) {
    try {
      f.contentWindow?.postMessage({ type: 'LIFE_FINANCE_RECEIPT', items }, window.location.origin)
    } catch {
      /* another origin */
    }
  }
}

let uploadTimer: ReturnType<typeof setTimeout> | null = null
/** Uploads what waits, then tells Finance. Soon, not at once (a burst of adds is one run). */
export function uploadSoon(ms = 1500): void {
  if (uploadTimer) clearTimeout(uploadTimer)
  uploadTimer = setTimeout(async () => {
    uploadTimer = null
    try {
      const r = await receipts().uploadPending()
      if (r.uploaded) tellFrames(await receipts().entries())
    } catch {
      /* tried again later */
    }
  }, ms)
}

let started = false
/** On app start: try waiting uploads, again when back online and every 30 minutes. */
export function startReceiptUploads(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  const kick = () => uploadSoon(500)
  const t0 = setTimeout(kick, 20_000)
  const every = setInterval(kick, 30 * 60_000)
  window.addEventListener('online', kick)
  return () => {
    started = false
    clearTimeout(t0)
    clearInterval(every)
    window.removeEventListener('online', kick)
  }
}

/** True when the message was a receipt message (and is answered here). */
export function handleReceiptMessage(data: any, source: Window | null): boolean {
  const action = data?.type === 'LIFE_SYSTEM_BRIDGE' ? String(data.action || '') : ''
  if (!action.startsWith('FINANCE_RECEIPT_')) return false
  const p = data.payload ?? {}
  const answer = (body: Record<string, unknown>, transfer?: Transferable[]) => {
    try {
      source?.postMessage({ type: 'LIFE_FINANCE_RECEIPT', req: p.req, ...body }, window.location.origin, transfer ?? [])
    } catch {
      /* the frame went away */
    }
  }
  const run = async () => {
    try {
      if (action === 'FINANCE_RECEIPT_ADD') {
        const r = await receipts().add({ rid: p.rid, txId: String(p.txId || ''), date: String(p.date || ''), note: String(p.note || ''), name: String(p.name || 'receipt'), mime: String(p.mime || ''), bytes: p.bytes })
        answer({ ok: true, rid: r.rid, items: await receipts().entries([r.rid]) })
        uploadSoon()
      } else if (action === 'FINANCE_RECEIPT_INDEX') {
        answer({ ok: true, items: await receipts().entries(Array.isArray(p.ids) ? p.ids : null) })
        uploadSoon(3000)
      } else if (action === 'FINANCE_RECEIPT_OPEN') {
        const f = await receipts().open(String(p.rid || ''))
        answer({ ok: true, ...f }, [f.bytes])
      } else if (action === 'FINANCE_RECEIPT_CONNECT') {
        if (!life.google?.connectDrive) throw new Error('Google Drive works in the website and the desktop app')
        await life.google.connectDrive()
        answer({ ok: true })
        uploadSoon(500)
      } else answer({ ok: false, error: 'Unknown receipt request' })
    } catch (err) {
      answer({ ok: false, error: (err as Error).message || 'Something went wrong with the receipt' })
    }
  }
  void run()
  return true
}
