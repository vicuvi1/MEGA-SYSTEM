// The desktop app (Electron) has no browser pop-ups: window.prompt returns
// null and confirm/alert show nothing, so a button that uses them silently
// does nothing there. Every question must be asked in the page instead
// (askConfirm/askText in src/renderer/src/confirmSheet.tsx, or the small
// dialog helper each embedded app has). This test fails if one comes back.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const exts = /\.(ts|tsx|js|mjs|html)$/
const skip = /(\.test\.|[\\/]node_modules[\\/]|[\\/]vendor[\\/]|\.min\.js$)/

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, out)
    else if (exts.test(name) && !skip.test(p)) out.push(p)
  }
  return out
}

// A call like prompt(...), window.confirm(...) or alert(...), but not a method
// on something else (installPrompt.prompt()) and not inside a comment.
const call = /(^|[^.\w$])(prompt|confirm|alert)\s*\(|\b(window|self|globalThis)\.(prompt|confirm|alert)\s*\(/

function stripComments(line: string): string {
  const t = line.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  return line.replace(/\s\/\/.*$/, '')
}

describe('no browser pop-ups', () => {
  it('src/ never calls prompt(), confirm() or alert()', () => {
    const found: string[] = []
    for (const f of files(join(root, 'src'))) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (call.test(stripComments(line))) found.push(`${relative(root, f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
        })
    }
    expect(found).toEqual([])
  })
})
