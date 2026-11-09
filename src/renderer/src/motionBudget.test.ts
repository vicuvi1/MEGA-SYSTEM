// The motion & sound budget (docs/AI_HANDOFF.md, "Motion & sound budget"):
// animations move things with transform and fade them with opacity, so the
// page never re-lays itself or repaints big areas every frame. This test reads
// every app stylesheet and fails on the costly patterns.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)
const ROOT = join(__dirname, '..', '..', '..')

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, ext, out)
    else if (ext.test(name)) out.push(p)
  }
  return out
}

// The embedded apps' own stylesheets (public/apps/*/css) run inside Life
// too, so the same budget holds for them.
const APPS = join(__dirname, '..', 'public', 'apps')
const appCss = readdirSync(APPS).flatMap((app) => {
  const dir = join(APPS, app, 'css')
  try {
    return statSync(dir).isDirectory() ? files(dir, /\.css$/) : []
  } catch {
    return []
  }
})
const cssFiles = [...files(SRC, /\.css$/), ...appCss]
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `@keyframes name { ... }` block with its body. */
export function keyframeBlocks(css: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const re = /@keyframes\s+([\w-]+)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    out.push({ name: m[1], body: css.slice(re.lastIndex, i - 1) })
    re.lastIndex = i
  }
  return out
}

/** Property names used inside a keyframes body. */
export function keyframeProps(body: string): string[] {
  const props = new Set<string>()
  for (const m of body.matchAll(/([a-z-]+)\s*:(?!:)/g)) props.add(m[1])
  return [...props]
}

// Cheap for the browser: the compositor runs these without layout or paint.
const ALLOWED = new Set(['transform', 'opacity', 'translate', 'scale', 'rotate', 'animation-timing-function', 'offset-distance'])

// Documented exceptions: each is tiny (a few px), one-shot, or SVG-only.
// Add one here only with a reason next to it.
const EXCEPTIONS: Record<string, string[]> = {
  // AF6: a checkbox tick draws its 14 px SVG stroke once.
  'fx-tick-draw': ['stroke-dashoffset'],
  // AF20: chart lines draw in once, on first view.
  'chart-draw': ['stroke-dashoffset'],
  // The island timer ring: a 20 px SVG arc, only while a timer runs.
  'isl-ring-in': ['stroke-dashoffset'],
  // Finance Helper (public/apps/finance): SVG lines that draw in once.
  draw: ['stroke-dashoffset'], // a chart line, on first view
  'g-draw': ['stroke-dashoffset'], // a goal ring
  'spark-draw': ['stroke-dashoffset'], // the small balance line
  'toast-check': ['stroke-dashoffset'], // the 14 px tick in a toast
  'dn-draw': ['stroke-dasharray'], // Finance donut segments, drawn once on open
}

describe('motion budget', () => {
  it('finds the stylesheets', () => {
    expect(cssFiles.length).toBeGreaterThan(10)
  })

  it('keyframes only animate transform and opacity (plus documented exceptions)', () => {
    const bad: string[] = []
    for (const f of cssFiles) {
      const css = stripComments(readFileSync(f, 'utf8'))
      for (const { name, body } of keyframeBlocks(css)) {
        const extra = EXCEPTIONS[name] ?? []
        for (const p of keyframeProps(body)) if (!ALLOWED.has(p) && !extra.includes(p)) bad.push(`${relative(SRC, f)} @keyframes ${name}: ${p}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no `transition: all` (name the properties that change)', () => {
    const bad: string[] = []
    for (const f of cssFiles) {
      const css = stripComments(readFileSync(f, 'utf8'))
      css.split('\n').forEach((line, i) => {
        if (/transition(-property)?\s*:\s*all\b/.test(line)) bad.push(`${relative(SRC, f)}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })

  it('no transitions on width, height or other layout properties', () => {
    const bad: string[] = []
    const layout = /\b(width|height|max-height|min-height|max-width|margin(-\w+)?|padding(-\w+)?|top|left|right|bottom|flex-basis|grid-template-columns)\b/
    for (const f of cssFiles) {
      const css = stripComments(readFileSync(f, 'utf8'))
      for (const m of css.matchAll(/transition\s*:\s*([^;}]+)/g)) {
        // each comma-separated part starts with its property name
        for (const part of m[1].split(',')) {
          const prop = part.trim().split(/\s+/)[0]
          if (layout.test(prop) && !/^border/.test(prop)) bad.push(`${relative(SRC, f)}: transition ${prop}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('no will-change on layout properties', () => {
    const bad: string[] = []
    for (const f of cssFiles) {
      const css = stripComments(readFileSync(f, 'utf8'))
      for (const m of css.matchAll(/will-change\s*:\s*([^;}]+)/g)) if (/\b(width|height|top|left|right|bottom|margin|padding)\b/.test(m[1])) bad.push(`${relative(SRC, f)}: will-change ${m[1].trim()}`)
    }
    expect(bad).toEqual([])
  })

  it('backdrop blur stays at 12px or less', () => {
    const bad: string[] = []
    for (const f of cssFiles) {
      const css = stripComments(readFileSync(f, 'utf8'))
      for (const m of css.matchAll(/backdrop-filter\s*:\s*([^;}]+)/g)) {
        for (const b of m[1].matchAll(/blur\((\d+(?:\.\d+)?)px\)/g)) if (Number(b[1]) > 12) bad.push(`${relative(SRC, f)}: ${m[1].trim()}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('sound: new audio contexts are made only by the sound module', () => {
    // One shared AudioContext per page, owned by soundKit.ts (it serves the
    // app, the island and the embedded apps).
    const allowed = new Set(['soundKit.ts'])
    const bad: string[] = []
    for (const f of files(join(ROOT, 'src'), /\.(ts|tsx)$/)) {
      if (/\.test\.ts$/.test(f)) continue
      const name = f.split(/[\\/]/).pop()!
      if (allowed.has(name)) continue
      const src = readFileSync(f, 'utf8')
      if (/new\s+(window\.)?(webkit)?AudioContext\b|window\.(webkit)?AudioContext\b/.test(src)) bad.push(relative(ROOT, f))
    }
    expect(bad).toEqual([])
  })

  it('the embedded apps stop endless animations in calm mode', () => {
    // An app that loops an animation forever must also have a calm rule
    // (html[data-calm]) that plays each loop once, as Finance Helper does
    // inside Life System.
    const bad: string[] = []
    for (const f of appCss) {
      const css = stripComments(readFileSync(f, 'utf8'))
      if (!/\binfinite\b/.test(css)) continue
      if (!/html\[data-calm\][^{]*\{[^}]*animation-iteration-count:\s*1/.test(css)) bad.push(relative(SRC, f))
    }
    expect(bad).toEqual([])
  })

  it('the parser reads keyframes as expected', () => {
    const blocks = keyframeBlocks('@keyframes a { from { opacity: 0 } 50% { transform: scale(1.1); } } .x{} @keyframes b{to{width:10px}}')
    expect(blocks.map((b) => b.name)).toEqual(['a', 'b'])
    expect(keyframeProps(blocks[0].body).sort()).toEqual(['opacity', 'transform'])
    expect(keyframeProps(blocks[1].body)).toEqual(['width'])
  })
})
