// AU1: the music on your PC (Windows), pure and tested. The desktop asks
// Windows' own media controls (GlobalSystemMediaTransportControlsSessionManager,
// the same thing the volume flyout shows) through one short PowerShell call
// that prints a line of JSON and exits. Nothing runs in the background: it is
// asked only when a focus block starts or ends (to pause / resume) and every
// 30 s while the island's panel is open. When the media controls can't be
// read, the play/pause/next keys are the fallback (they work with any player,
// but can't tell whether something is playing, so focus never toggles blindly).

export type MediaOp = 'get' | 'toggle' | 'play' | 'pause' | 'next' | 'prev'
export const MEDIA_OPS: MediaOp[] = ['get', 'toggle', 'play', 'pause', 'next', 'prev']

export interface MediaNow {
  /** Something is playing right now. */
  playing: boolean
  title: string
  artist: string
  /** The player's app id, made friendly ("Spotify", "Chrome"). */
  app: string
}

const WINRT_OP: Record<Exclude<MediaOp, 'get'>, string> = {
  toggle: 'TryTogglePlayPauseAsync',
  play: 'TryPlayAsync',
  pause: 'TryPauseAsync',
  next: 'TrySkipNextAsync',
  prev: 'TrySkipPreviousAsync'
}
/** The media keys (virtual-key codes 179 play/pause, 176 next, 177 previous). */
const KEY_OP: Record<Exclude<MediaOp, 'get'>, number> = { toggle: 179, play: 179, pause: 179, next: 176, prev: 177 }

/**
 * The PowerShell for one op. It awaits the WinRT calls with .NET's AsTask
 * (Windows PowerShell 5.1 can't await by itself), then prints one JSON line:
 * {"ok":true,"playing":…,"title":…,"artist":…,"app":…} or {"ok":false}.
 */
export function mediaScript(op: MediaOp): string {
  const act = op === 'get' ? '' : `$null = Await ($s.${WINRT_OP[op]}()) ([bool]); Start-Sleep -Milliseconds 350;`
  return [
    "$ErrorActionPreference='Stop'",
    'try {',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    "$g=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]",
    'function Await($t,$r){$x=$g.MakeGenericMethod($r).Invoke($null,@($t));$null=$x.Wait(4000);$x.Result}',
    '$null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]',
    '$m=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
    '$s=$m.GetCurrentSession()',
    "if(-not $s){'{\"ok\":true,\"playing\":false,\"title\":\"\",\"artist\":\"\",\"app\":\"\"}';exit}",
    act,
    '$p=Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
    '$st=[string]$s.GetPlaybackInfo().PlaybackStatus',
    "@{ok=$true;playing=($st -eq 'Playing');title=[string]$p.Title;artist=[string]$p.Artist;app=[string]$s.SourceAppUserModelId}|ConvertTo-Json -Compress",
    "} catch { '{\"ok\":false}' }"
  ]
    .filter(Boolean)
    .join('\n')
}

/** The fallback: press a media key (any player), no state. */
export function mediaKeyScript(op: Exclude<MediaOp, 'get'>): string {
  return `(New-Object -ComObject WScript.Shell).SendKeys([char]${KEY_OP[op]})`
}

/** "Spotify.exe", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Chrome" → "Spotify" / "Chrome". */
export function playerName(id: string): string {
  const s = String(id ?? '').trim()
  if (!s) return ''
  const known: [RegExp, string][] = [
    [/spotify/i, 'Spotify'],
    [/chrome/i, 'Chrome'],
    [/msedge|edge/i, 'Edge'],
    [/firefox/i, 'Firefox'],
    [/brave/i, 'Brave'],
    [/opera/i, 'Opera'],
    [/zunemusic|groove|media\s*player|zune/i, 'Media Player'],
    [/vlc/i, 'VLC'],
    [/itunes|applemusic/i, 'Apple Music'],
    [/deezer/i, 'Deezer'],
    [/tidal/i, 'Tidal'],
    [/youtube/i, 'YouTube']
  ]
  const hit = known.find(([re]) => re.test(s))
  if (hit) return hit[1]
  const base = s.split(/[!\\/]/).pop()!.replace(/\.exe$/i, '').replace(/_[a-z0-9]{10,}$/i, '')
  return base.slice(0, 24)
}

/** The one JSON line → what's playing; null when Windows couldn't say. Titles are cut to 120 chars. */
export function parseMedia(out: string): MediaNow | null {
  const line = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (!line) return null
  try {
    const j = JSON.parse(line)
    if (!j || j.ok !== true) return null
    return { playing: j.playing === true, title: String(j.title ?? '').slice(0, 120), artist: String(j.artist ?? '').slice(0, 80), app: playerName(String(j.app ?? '')) }
  } catch {
    return null
  }
}

/** "Song — Artist" for the island (or the player when it shows no title). */
export function mediaLine(m: MediaNow | null): string {
  if (!m) return ''
  const t = [m.title, m.artist].filter(Boolean).join(' — ')
  return (t || m.app || '').slice(0, 80)
}

/**
 * Focus started or ended: what to do with the music. Pause only what is
 * really playing (known, not guessed); resume only what WE paused, and only
 * when the focus block is over (not when you paused it yourself meanwhile).
 */
export function focusMediaStep(s: { wasRunning: boolean; running: boolean; media: MediaNow | null; pausedByUs: boolean }): 'pause' | 'resume' | null {
  if (!s.wasRunning && s.running) return s.media?.playing ? 'pause' : null
  if (s.wasRunning && !s.running) return s.pausedByUs && s.media && !s.media.playing ? 'resume' : null
  return null
}
