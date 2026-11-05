import { describe, expect, it } from 'vitest'
import { parseRead, uiaScript, UIA_MAX_CHARS } from './uia'
import { bgraToRgb, ocrScript, parseOcr, sourceMatches } from './capture'
import { MODEL_FILES } from './models'
import { DEFAULT_DENY, denyRegex } from '../../core/eyesGuard'

describe('island eyes on Windows (scripts built here, run only on Windows)', () => {
  it('the window script checks your list before reading, skips passwords and caps the text', () => {
    const s = uiaScript(denyRegex(DEFAULT_DENY))
    expect(s.indexOf('-match')).toBeLessThan(s.indexOf('StringBuilder'))
    expect(s).toContain('IsPassword')
    expect(s).toContain(`$sb.Length -lt ${UIA_MAX_CHARS}`)
    expect(uiaScript('x', false)).not.toContain('StringBuilder')
    // Nothing in your list can close the PowerShell string.
    expect(uiaScript("a'b")).toContain("-match 'a.b'")
  })
  it('reads the script answer, and refuses junk', () => {
    expect(parseRead('noise\n{"proc":"chrome","title":"Two Sum","hwnd":123,"text":"hi"}\n')).toEqual({ proc: 'chrome', title: 'Two Sum', hwnd: 123, text: 'hi' })
    expect(parseRead('{"proc":"Signal","denied":true,"hwnd":0,"title":"","text":""}')).toMatchObject({ denied: true })
    expect(parseRead('{}')).toBeNull()
    expect(parseRead('not json {')).toBeNull()
    expect(parseRead(`{"proc":"x","text":"${'a'.repeat(5000)}"}`)!.text.length).toBe(UIA_MAX_CHARS)
  })
  it('OCR: the picture comes in on stdin and stays in memory', () => {
    const s = ocrScript()
    expect(s).toContain('InMemoryRandomAccessStream')
    expect(s).toContain('[Console]::In.ReadToEnd()')
    expect(s).not.toMatch(/SaveAs|Out-File|Set-Content|\.png/i)
    expect(parseOcr('{"ok":true,"text":"Hello"}')).toEqual({ ok: true, text: 'Hello' })
    expect(parseOcr('{"ok":false,"error":"nolang"}').error).toMatch(/language/)
    expect(parseOcr('').ok).toBe(false)
  })
  it('finds the right window and turns BGRA into RGB', () => {
    expect(sourceMatches('window:123:0', 123)).toBe(true)
    expect(sourceMatches('window:1234:0', 123)).toBe(false)
    expect(sourceMatches('window:0:0', 0)).toBe(false)
    expect([...bgraToRgb(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]), 2, 1)]).toEqual([3, 2, 1, 6, 5, 4])
  })
  it('the downloaded code is pinned by checksum; the model comes only from its own repo', () => {
    for (const f of MODEL_FILES.filter((x) => x.path.startsWith('lib/'))) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
    for (const f of MODEL_FILES) expect(f.url).toMatch(/^https:\/\/(cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@3\.8\.1\/|huggingface\.co\/onnx-community\/Florence-2-base-ft\/resolve\/main\/)/)
  })
})
