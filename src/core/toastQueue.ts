// Toasts, kept calm (pure, tested in toastQueue.test.ts): at most 2 at a time.
//   - a new note replaces the older note, a new error replaces the older error;
//   - a new "Undo" toast merges with the one before: "2 changes" and one Undo
//     that undoes both (newest first);
//   - an error never pushes an Undo toast away; when more than 2 would show,
//     the oldest one without an Undo goes first.
export type ToastTone = 'good' | 'bad' | 'info'
export interface ToastAction {
  label: string
  run: () => void
}
export interface ToastItem {
  id: number
  text: string
  tone: ToastTone
  action?: ToastAction
  /** How many changes an Undo toast holds (1 when it is a single one). */
  count?: number
}

export const MAX_TOASTS = 2

const kindOf = (t: Pick<ToastItem, 'tone' | 'action'>) => (t.action ? 'undo' : t.tone === 'bad' ? 'error' : 'note')

/** The list after `next` arrives. */
export function addToast(list: ToastItem[], next: ToastItem): ToastItem[] {
  const kind = kindOf(next)
  let out = list
  if (kind === 'undo') {
    const old = list.find((t) => kindOf(t) === 'undo')
    if (old) {
      const count = (old.count ?? 1) + (next.count ?? 1)
      const first = old.action!
      const second = next.action!
      const merged: ToastItem = { ...next, text: `${count} changes`, count, action: { label: second.label, run: () => (second.run(), first.run()) } }
      out = list.filter((t) => t !== old)
      return trim([...out, merged])
    }
    // A note about the same change would only repeat it.
    out = list.filter((t) => kindOf(t) !== 'note')
  } else {
    out = list.filter((t) => kindOf(t) !== kind)
  }
  return trim([...out, next])
}

function trim(list: ToastItem[]): ToastItem[] {
  const out = [...list]
  while (out.length > MAX_TOASTS) {
    const i = out.findIndex((t) => !t.action)
    out.splice(i >= 0 ? i : 0, 1)
  }
  return out
}
