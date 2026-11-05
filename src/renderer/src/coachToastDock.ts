// On the Coach page, pop-up notices (NotifToasts) never cover the chat:
// with "Ben's view of today" open they sit at the top of that panel and push
// its cards down; otherwise they become a compact strip under the chat's
// header and the messages move down to make room. The position is measured
// here and handed to CSS as variables on <html> (coachFeed.css).
import { useEffect, type RefObject } from 'react'

const VARS = ['--nt-top', '--nt-left', '--nt-w', '--nt-pad']
const CLASSES = ['nt-dock', 'nt-dock-side', 'nt-dock-strip']

export function useToastDock(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const html = document.documentElement
    let raf = 0
    const place = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = root.current
        const stack = document.querySelector<HTMLElement>('.nt-stack')
        const chat = el?.querySelector<HTMLElement>('.cx-chat')
        const head = el?.querySelector<HTMLElement>('.cf-head')
        if (!el || !stack || !chat || !head) return
        const side = el.querySelector<HTMLElement>('.cf-side')
        const sideOn = !!side && getComputedStyle(side).display !== 'none' && side.offsetWidth > 0
        const h = stack.offsetHeight
        let top: number, left: number, w: number
        if (sideOn) {
          const r = side!.getBoundingClientRect()
          top = r.top + 10
          left = r.left + 14
          w = r.width - 28
        } else {
          const hr = head.getBoundingClientRect()
          const c = chat.getBoundingClientRect()
          w = Math.min(c.width - 16, 760)
          top = hr.bottom + 8
          left = c.left + (c.width - w) / 2
        }
        html.classList.add('nt-dock')
        html.classList.toggle('nt-dock-side', sideOn)
        html.classList.toggle('nt-dock-strip', !sideOn)
        html.style.setProperty('--nt-top', `${Math.round(top)}px`)
        html.style.setProperty('--nt-left', `${Math.round(left)}px`)
        html.style.setProperty('--nt-w', `${Math.round(w)}px`)
        html.style.setProperty('--nt-pad', h > 0 ? `${h + 12}px` : '0px')
      })
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    const stack = document.querySelector('.nt-stack')
    if (stack) ro?.observe(stack)
    if (root.current) ro?.observe(root.current)
    // The side panel opening or closing, the search bar, the drawer.
    const mo = new MutationObserver(place)
    if (root.current) mo.observe(root.current, { attributes: true, attributeFilter: ['class'], childList: true, subtree: false })
    const chat = root.current?.querySelector('.cx-chat')
    if (chat) mo.observe(chat, { childList: true })
    if (stack) mo.observe(stack, { childList: true })
    window.addEventListener('resize', place)
    place()
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', place)
      CLASSES.forEach((c) => html.classList.remove(c))
      VARS.forEach((v) => html.style.removeProperty(v))
    }
  }, [root])
}
