// Live data: run `fn` whenever new data arrives (a bot, the phone, another
// tab: 'life-data-changed'), and with `external` also every ~30 s for changes
// made in Todoist or Google Calendar themselves ('life-external-changed').
import { useEffect, useRef } from 'react'

export function useLive(fn: () => void, opts: { external?: boolean; data?: boolean } = {}): void {
  const ref = useRef(fn)
  ref.current = fn
  const { external = false, data = true } = opts
  useEffect(() => {
    const on = () => ref.current()
    if (data) window.addEventListener('life-data-changed', on)
    if (external) window.addEventListener('life-external-changed', on)
    return () => {
      window.removeEventListener('life-data-changed', on)
      window.removeEventListener('life-external-changed', on)
    }
  }, [external, data])
}
