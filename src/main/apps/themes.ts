// Life System's look for the apps inside it. Each sheet only overrides the
// app's own color variables and fonts (with !important so it beats the app's
// light/paper themes), and keeps the accent of its section in the sidebar:
// Money gold, Sleep teal, Discipline orange.
import { FINANCE_PARTITION } from './finance'

const UI = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const DISPLAY = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'

const SCROLLBARS = `
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2c3446; border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: #3a4358; background-clip: padding-box; }
`

const FINANCE = `
  :root, :root[data-theme], :root[data-design] {
    --bg: #0b0d12 !important; --surface: #141822 !important; --surface-2: #1a1f2b !important; --surface-3: #222838 !important;
    --side-bg: #0e1118 !important; --line: #242a38 !important; --line-strong: #2c3446 !important;
    --text: #e9ecf3 !important; --muted: #8a93a6 !important; --faint: #5b6376 !important;
    --gold: #f5c84b !important; --gold-soft: rgb(245 200 75 / 12%) !important;
    --btn-bg: #f5c84b !important; --btn-ink: #1d1704 !important; --chart-bar: #5f6b88 !important;
    --income: #4ade80 !important; --income-soft: rgb(74 222 128 / 12%) !important;
    --expense: #ff5d6c !important; --expense-soft: rgb(255 93 108 / 12%) !important;
    --warn: #ff8a3d !important; --warn-soft: rgb(255 138 61 / 12%) !important;
    --info: #7cc4ff !important; --info-soft: rgb(124 196 255 / 12%) !important;
    --c1: #3987e5 !important; --c2: #d95926 !important; --c3: #199e70 !important; --c4: #c98500 !important;
    --c5: #d55181 !important; --c6: #008300 !important; --c7: #9085e9 !important; --c8: #e66767 !important;
    --backdrop: rgb(4 6 10 / 64%) !important; --shadow-pop: 0 20px 60px rgb(0 0 0 / 50%) !important;
    --spot: rgb(245 200 75 / 6%) !important; --ambient: rgb(200 241 53 / 3%) !important;
    --shadow-card: 0 1px 0 rgb(255 255 255 / 3%) inset, 0 10px 30px -18px rgb(0 0 0 / 70%) !important;
    --card-line: #242a38 !important;
    --lift: 0 1px 0 rgb(255 255 255 / 4%) inset, 0 18px 40px -28px rgb(0 0 0 / 75%) !important;
    --font: ${UI} !important; --display: ${DISPLAY} !important;
    --radius: 14px !important; --radius-sm: 10px !important;
    color-scheme: dark !important;
  }
  ${SCROLLBARS}
`

const WAKY = `
  :root, body, body[data-theme] {
    --bg: #0b0d12 !important; --surface: #141822 !important; --surface-2: #1a1f2b !important;
    --line: #242a38 !important; --text: #e9ecf3 !important; --muted: #8a93a6 !important; --missed: #222838 !important;
    --radius: 14px !important;
  }
  body, body[data-theme] { font-family: ${UI} !important; }
  /* The default look takes Sleep's teal; Waky's unlockable reward themes keep theirs. */
  body:not([data-theme]), body[data-theme=""], body[data-theme="dawn"] {
    --sun: #6ee7d8 !important; --sun-2: #a7f3e9 !important;
    background: radial-gradient(1200px 520px at 50% -260px, rgb(110 231 216 / 10%) 0%, transparent 70%), #0b0d12 !important;
  }
  ${SCROLLBARS}
`

const MAN = `
  :root {
    --bg-dark: #0b0d12 !important; --card-bg: #141822 !important; --card-border: #242a38 !important;
    --text-primary: #e9ecf3 !important; --text-secondary: #c3c9d6 !important; --text-muted: #8a93a6 !important;
    --spartan-gold: #ff8a3d !important; --spartan-bronze: #e07a35 !important;
  }
  body { font-family: ${UI} !important; background-color: #0b0d12 !important; }
  ${SCROLLBARS}
`

/** Stylesheet to apply to an embedded app's page, by its storage partition. */
export function themeFor(partition: string): string | null {
  if (partition === FINANCE_PARTITION) return FINANCE
  if (partition === 'persist:waky') return WAKY
  if (partition === 'persist:man') return MAN
  return null
}
