// Money receipts (Money v2 plan D6, docs/areas/rewards-money.md "Taxes and receipts"):
// the synced index of receipt files, kept in Life's setting `money_receipts`,
// outside Finance Helper's own data. A Finance record holds only receipt ids
// (t.receipts = ['r-…']); this index says, per id, the file's name, type, size,
// the record it belongs to and, once uploaded, its Google Drive file id.
// Metadata only: never the file. Pure: the IO is renderer/src/money/receipts.ts.
//
// Merge rules (like Photo Locker's vault_index): the later change wins, a
// known Drive id is never lost, a removal (tombstone) wins.

export const MONEY_RECEIPTS_KEY = 'money_receipts'
export const RECEIPT_MAX_BYTES = 20 * 1024 * 1024
export const RECEIPT_INDEX_MAX_BYTES = 400_000
export const RECEIPT_MIME = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/
/** appProperties.lsApp of a receipt file and of the folders the app made for them. */
export const RECEIPT_APP = 'receipt'
export const RECEIPT_FOLDER_APP = 'receipt-folder'
/** The folders in the owner's Drive: Life System / Receipts / YYYY-MM (owner, 2026-11-12). */
export const RECEIPT_ROOT = ['Life System', 'Receipts'] as const

export interface ReceiptEntry {
  /** The Finance record it was attached to (null once unknown). */
  tx: string | null
  name: string
  mime: string
  size: number
  /** The record's date (YYYY-MM-DD): picks the month folder. */
  date: string
  driveId?: string
  uploadedAt?: number
  /** Removed (a tombstone): the time. */
  gone?: number
  updatedAt: number
}

export interface ReceiptIndex {
  v: 1
  items: Record<string, ReceiptEntry>
}

export const emptyReceipts = (): ReceiptIndex => ({ v: 1, items: {} })

export const validReceiptId = (id: unknown): id is string => typeof id === 'string' && /^r-[a-z0-9-]{4,40}$/.test(id)
const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')

function cleanEntry(raw: any): ReceiptEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e: ReceiptEntry = {
    tx: typeof raw.tx === 'string' && raw.tx ? str(raw.tx, 80) : null,
    name: str(raw.name, 120) || 'receipt',
    mime: str(raw.mime, 60),
    size: num(raw.size),
    date: isoDay(raw.date),
    updatedAt: num(raw.updatedAt)
  }
  if (typeof raw.driveId === 'string' && /^[\w-]{1,200}$/.test(raw.driveId)) e.driveId = raw.driveId
  if (num(raw.uploadedAt)) e.uploadedAt = num(raw.uploadedAt)
  if (num(raw.gone)) e.gone = num(raw.gone)
  return e
}

/** Checks a stored index; drops anything malformed, then caps its size. */
export function cleanReceipts(raw: unknown, maxBytes = RECEIPT_INDEX_MAX_BYTES): ReceiptIndex {
  const out = emptyReceipts()
  const items = (raw as any)?.items
  if (items && typeof items === 'object') {
    for (const [id, v] of Object.entries(items)) {
      if (!validReceiptId(id)) continue
      const e = cleanEntry(v)
      if (e) out.items[id] = e
    }
  }
  return capReceipts(out, maxBytes)
}

/** Over the cap, the oldest tombstones go first. A live receipt is never dropped. */
export function capReceipts(ix: ReceiptIndex, maxBytes = RECEIPT_INDEX_MAX_BYTES): ReceiptIndex {
  if (JSON.stringify(ix).length <= maxBytes) return ix
  const items = { ...ix.items }
  const dead = Object.entries(items).filter(([, e]) => e.gone).sort((a, b) => (a[1].gone ?? 0) - (b[1].gone ?? 0))
  for (const [id] of dead) {
    delete items[id]
    if (JSON.stringify({ v: 1, items }).length <= maxBytes) break
  }
  return { v: 1, items }
}

/** One receipt from two copies: the later change wins, a Drive id is never lost, a tombstone wins. */
export function mergeReceipt(a: ReceiptEntry | undefined, b: ReceiptEntry | undefined): ReceiptEntry | undefined {
  if (!a) return b
  if (!b) return a
  const later = b.updatedAt > a.updatedAt ? b : a
  const out: ReceiptEntry = { ...later }
  const driveId = later.driveId ?? a.driveId ?? b.driveId
  if (driveId) out.driveId = driveId
  const uploadedAt = later.uploadedAt ?? a.uploadedAt ?? b.uploadedAt
  if (uploadedAt) out.uploadedAt = uploadedAt
  const gone = Math.max(a.gone ?? 0, b.gone ?? 0)
  if (gone) out.gone = gone
  out.updatedAt = Math.max(a.updatedAt, b.updatedAt)
  return out
}

export function mergeReceipts(a: ReceiptIndex, b: ReceiptIndex): ReceiptIndex {
  const items: Record<string, ReceiptEntry> = {}
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const e = mergeReceipt(a.items[id], b.items[id])
    if (e) items[id] = e
  }
  return capReceipts({ v: 1, items })
}

/** The month folder a receipt goes in: ['Life System', 'Receipts', '2026-11']. */
export function receiptFolderPath(date: string): string[] {
  const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : 'Undated'
  return [...RECEIPT_ROOT, month]
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'application/pdf': 'pdf' }

/** The file name in Drive: "2026-11-03 Printer paper r-ab12cd.pdf" (safe on every OS). */
export function receiptFileName(rid: string, date: string, note: string, mime: string): string {
  const what = str(note, 50).replace(/[^\p{L}\p{N} ,.'&+()-]+/gu, ' ').replace(/\s+/g, ' ').trim() || 'Receipt'
  return `${isoDay(date) || 'undated'} ${what} ${rid}.${EXT[mime] ?? 'bin'}`.slice(0, 120)
}

/** What every receipt file carries in Drive, so it is matched by id and never uploaded twice. */
export const receiptProps = (rid: string, tx: string | null): Record<string, string> => ({ lsApp: RECEIPT_APP, lsId: rid, ...(tx ? { lsTx: tx.slice(0, 100) } : {}) })

export function checkReceipt(mime: string, size: number): string | null {
  if (!RECEIPT_MIME.test(mime)) return 'A receipt is a photo (JPEG, PNG, WebP, HEIC) or a PDF'
  if (!(size > 0)) return 'That file is empty'
  if (size > RECEIPT_MAX_BYTES) return 'That file is over 20 MB'
  return null
}

export interface LocalReceipt {
  id: string
  hasFile: boolean
}

/**
 * What a sync does: link receipts Drive already has (found by their app id: no
 * second upload), upload the rest of this device's files, and count what is
 * still not in Drive (for the warning).
 */
export function planReceiptSync(ix: ReceiptIndex, local: LocalReceipt[], inDrive: Record<string, string>): { uploads: string[]; adopt: { id: string; driveId: string }[]; notInDrive: number } {
  const uploads: string[] = []
  const adopt: { id: string; driveId: string }[] = []
  let notInDrive = 0
  for (const l of local) {
    const e = ix.items[l.id]
    if (e?.gone || e?.driveId) continue
    if (inDrive[l.id]) adopt.push({ id: l.id, driveId: inDrive[l.id] })
    else if (l.hasFile) uploads.push(l.id)
  }
  for (const [id, e] of Object.entries(ix.items)) if (!e.gone && !e.driveId && !adopt.some((a) => a.id === id)) notInDrive++
  return { uploads, adopt, notInDrive }
}

/** The link the accountant export and the record use. */
export const receiptDriveLink = (driveId: string) => `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`
