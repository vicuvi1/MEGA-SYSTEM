// EY2 / EY3: a picture of just the window in front, in memory only. It goes
// to Windows' own OCR (EY2) or, made small, to the caption model (EY3), and
// is dropped right after: never written to disk, never sent anywhere.
import { desktopCapturer, type NativeImage } from 'electron'
import { runPowerShell } from './uia'

/** Electron names a window source "window:<handle>:0". */
export const sourceMatches = (id: string, hwnd: number) => hwnd > 0 && id.startsWith(`window:${hwnd}:`)

/** The window with this handle, at most `max` pixels on its long side (null if it can't be found). */
export async function captureWindow(hwnd: number, max: number): Promise<NativeImage | null> {
  if (!hwnd) return null
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: max, height: max }, fetchWindowIcons: false })
    const s = sources.find((x) => sourceMatches(x.id, hwnd))
    return s && !s.thumbnail.isEmpty() ? s.thumbnail : null
  } catch {
    return null
  }
}

/** BGRA (Windows' order) → RGB for the model. */
export function bgraToRgb(bgra: Uint8Array | Buffer, w: number, h: number): Uint8Array {
  const n = w * h
  const out = new Uint8Array(n * 3)
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const k = i * 4
    out[j] = bgra[k + 2]
    out[j + 1] = bgra[k + 1]
    out[j + 2] = bgra[k]
  }
  return out
}

export const OCR_TIMEOUT_MS = 8000

/**
 * Windows.Media.Ocr (built into Windows 10/11, free, offline) from PowerShell.
 * The PNG comes in on stdin as base64 and stays in memory (an in-memory
 * stream); the text comes out, at most `maxChars`.
 */
export function ocrScript(maxChars = 2000): string {
  return [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$null=[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]',
    '$null=[Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]',
    '$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]',
    '$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]',
    "$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    'function Await($op,[Type]$t){ $task=$asTask.MakeGenericMethod($t).Invoke($null,@($op)); [void]$task.Wait(6000); $task.Result }',
    '$b64=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($b64.Trim()); $b64=$null',
    '$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
    "if($engine -eq $null){ @{ok=$false; error='nolang'} | ConvertTo-Json -Compress; exit }",
    '$stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream',
    '$w=New-Object Windows.Storage.Streams.DataWriter($stream.GetOutputStreamAt(0))',
    '$w.WriteBytes($bytes); [void](Await ($w.StoreAsync()) ([UInt32])); $bytes=$null',
    '$stream.Seek(0)',
    '$dec=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '$bmp=Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
    '$res=Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])',
    '$bmp.Dispose(); $stream.Dispose()',
    '$txt=(($res.Lines | ForEach-Object { $_.Text }) -join "`n")',
    `if($txt.Length -gt ${maxChars}){ $txt=$txt.Substring(0,${maxChars}) }`,
    '@{ok=$true; text=$txt} | ConvertTo-Json -Compress'
  ].join('\n')
}

export function parseOcr(out: string): { ok: boolean; text: string; error?: string } {
  const line = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (!line) return { ok: false, text: '', error: 'no answer' }
  try {
    const j = JSON.parse(line)
    if (j?.ok === true) return { ok: true, text: String(j.text ?? '').slice(0, 2000) }
    return { ok: false, text: '', error: j?.error === 'nolang' ? 'Windows has no OCR language installed (Settings → Time & language → Language)' : 'OCR failed' }
  } catch {
    return { ok: false, text: '', error: 'OCR failed' }
  }
}

/** The text in this picture (Windows only). The picture lives only in this call. */
export async function ocrImage(img: NativeImage): Promise<{ ok: boolean; text: string; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, text: '', error: 'Windows only' }
  const b64 = img.toPNG().toString('base64')
  return parseOcr(await runPowerShell(ocrScript(), OCR_TIMEOUT_MS, b64))
}
