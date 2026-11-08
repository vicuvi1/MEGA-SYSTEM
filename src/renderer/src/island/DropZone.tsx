// Island v2: the drop zone. While something is dragged over the island it
// shows two targets, Task (left) and Note (right), with a preview of what
// will be saved; the half under the pointer lights up. Pure parsing lives in
// core/islandDrop.ts; this is only the look and the DataTransfer reading.
import { motion } from 'framer-motion'
import { dropTarget, parseDrop, type DropData, type DropPlan, type DropTo } from '@core/islandDrop'
import { useFeel } from '../islandFeel'

/** Read what the browser gives for a drop (or a drag, where only the types are known). */
export function dropDataOf(dt: DataTransfer | null): DropData {
  if (!dt) return {}
  const files = [...(dt.files ?? [])].map((f) => ({ name: f.name, size: f.size, type: f.type }))
  const get = (t: string) => {
    try {
      return dt.getData(t)
    } catch {
      return ''
    }
  }
  return { uris: (get('text/uri-list') || '').split(/\r?\n/), text: get('text/plain'), html: get('text/html'), files }
}

/** Something the island can take is being dragged (types only: the data is hidden until the drop). */
export function canTake(dt: DataTransfer | null): boolean {
  return !!dt && [...dt.types].some((t) => t === 'text/plain' || t === 'text/uri-list' || t === 'Files' || t === 'text/html')
}

export { dropTarget, parseDrop }
export type { DropPlan, DropTo }

/**
 * `card`: the pill itself grows into the two targets (the shape morphs to
 * this size); otherwise they cover the open peek or panel.
 */
export function DropZoneView({ over, card = false }: { over: DropTo | null; card?: boolean }) {
  const f = useFeel()
  return (
    <motion.div
      className={`v2-drop ${card ? 'card' : 'overlay'}`}
      data-drop-zone
      aria-live="polite"
      initial={f.mode === 'off' ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={f.pop}
    >
      <div className={`v2-drop-t ${over === 'task' ? 'on' : ''}`} data-drop-target="task">
        <b>☑ Task</b>
        <small>Todoist</small>
      </div>
      <div className={`v2-drop-t ${over === 'note' ? 'on' : ''}`} data-drop-target="note">
        <b>📓 Note</b>
        <small>Notebook → Inbox</small>
      </div>
    </motion.div>
  )
}
