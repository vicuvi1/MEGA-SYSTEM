// Smart island (SI2): what you're doing on the PC, as a kind of work, not a
// window title. Pure and tested. It runs in the desktop's MAIN process (pc.ts,
// next to classifyApp): titles are read there only when the "titles" switch is
// on, and they never cross to a page. What crosses is the kind, how sure it
// is, and at most a short detail, and only when that detail is one of YOUR
// words (a goal, a course, a block's name), never text from the title.

export type ContextKind = 'coding' | 'study' | 'writing' | 'meeting' | 'email' | 'ctf' | 'video' | 'gaming' | 'social' | 'browsing' | 'money' | 'idle' | 'other'

export const CONTEXT_KINDS: ContextKind[] = ['coding', 'study', 'writing', 'meeting', 'email', 'ctf', 'video', 'gaming', 'social', 'browsing', 'money', 'idle', 'other']
export const CONTEXT_LABEL: Record<ContextKind, string> = {
  coding: 'Coding',
  study: 'Studying',
  writing: 'Writing',
  meeting: 'In a meeting',
  email: 'Email',
  ctf: 'CTF / lab',
  video: 'Video',
  gaming: 'Gaming',
  social: 'Chat & social',
  browsing: 'Browsing',
  money: 'Banking',
  idle: 'Away',
  other: 'Something else'
}
export const CONTEXT_ICON: Record<ContextKind, string> = { coding: '⌨️', study: '📚', writing: '✍️', meeting: '🎥', email: '✉️', ctf: '🛡️', video: '📺', gaming: '🎮', social: '💬', browsing: '🌐', money: '🏦', idle: '💤', other: '•' }

/** Work-like kinds: count as real work for drift, breaks and the day's line. */
export const WORK_CONTEXTS: ContextKind[] = ['coding', 'study', 'writing', 'ctf']
/** Kinds that pull you away. */
export const DISTRACT_CONTEXTS: ContextKind[] = ['video', 'gaming', 'social']
export const isWorkContext = (k: ContextKind) => WORK_CONTEXTS.includes(k)
export const isDistractContext = (k: ContextKind) => DISTRACT_CONTEXTS.includes(k)

/** "That's not right": your own fix for an app (its friendly name or process). */
export interface ContextRule { app: string; kind: ContextKind }

export interface ContextInput {
  /** The process name ("Code.exe", "chrome"). */
  proc: string
  /** The friendly name shown to you ("VS Code", "YouTube"): your fixes are kept by it. */
  label?: string
  /** The window title, only when the titles switch is on (else null). */
  title?: string | null
  /** The planned block on now, if any (its title is YOUR word). */
  block?: string | null
  /** A calendar meeting is on now. */
  meeting?: boolean
  hour?: number
  /** The last few kinds seen (newest last), to stay steady on a quick look elsewhere. */
  recent?: ContextKind[]
  /** Your fixes (they win). */
  rules?: ContextRule[]
  /** Your words: goals, courses, subjects. Only these can become the detail. */
  words?: string[]
  /** Your bank sites (titles on): "maib", "moldindconbank"… */
  bankWords?: string[]
}

export interface ContextGuess { kind: ContextKind; detail?: string; conf: number }

const p = (s: string) => s.trim().toLowerCase().replace(/\.exe$/, '')
const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc']
const has = (t: string, list: string[]) => list.some((w) => t.includes(w))

const CODE_APPS = ['code', 'code - insiders', 'cursor', 'devenv', 'idea64', 'pycharm64', 'webstorm64', 'clion64', 'rustrover64', 'goland64', 'rider64', 'sublime_text', 'notepad++', 'nvim-qt', 'zed', 'android studio', 'studio64']
const TERMINALS = ['windowsterminal', 'wt', 'cmd', 'powershell', 'pwsh', 'conhost', 'mintty', 'alacritty', 'wezterm-gui']
const VM_APPS = ['vmware', 'vmplayer', 'vmware-vmx', 'virtualbox', 'virtualboxvm', 'vboxheadless', 'wsl', 'wslhost', 'kali', 'ubuntu', 'wireshark', 'burpsuite', 'burp', 'ghidra', 'ida64', 'ida', 'x64dbg', 'x32dbg', 'cutter', 'putty', 'nmap', 'zenmap', 'hashcat', 'john']
const CTF_WORDS = ['hackthebox', 'hack the box', 'tryhackme', 'picoctf', 'ctf', 'overthewire', 'root-me', 'kali', 'exploit', 'pwn', 'cyberdefenders', 'portswigger']
const PDF_APPS = ['acrord32', 'acrobat', 'sumatrapdf', 'foxitpdfreader', 'foxitreader', 'pdfxedit', 'okular', 'zotero']
const STUDY_WORDS = ['lecture', 'lectur', 'course', 'chapter', 'exam', 'homework', 'assignment', 'seminar', 'lab ', 'tutorial', 'syllabus', 'quiz', 'curs', 'tema', 'laborator', 'coursera', 'udemy', 'edx', 'moodle', 'khan academy', 'khanacademy', 'leetcode', 'brilliant', 'mit opencourseware', 'ocw']
const WRITE_APPS = ['winword', 'obsidian', 'notion', 'typora', 'libreoffice', 'soffice', 'scrivener', 'onenote', 'logseq']
const WRITE_SITES = ['google docs', 'docs.google', 'overleaf', 'notion', 'hackmd']
const MAIL_APPS = ['outlook', 'olk', 'hxoutlook', 'thunderbird', 'mailbird', 'em client', 'mailclient']
const MAIL_SITES = ['gmail', 'inbox', 'outlook.live', 'outlook.office', 'proton mail', 'protonmail', '- mail']
const MEET_APPS = ['zoom', 'teams', 'ms-teams', 'webex', 'ciscowebex', 'skype', 'slack huddle']
const MEET_SITES = ['meet.google', 'google meet', 'zoom meeting', 'microsoft teams', 'jitsi', 'whereby']
const VIDEO_APPS = ['vlc', 'mpc-hc64', 'mpc-hc', 'potplayer', 'potplayermini64', 'netflix', 'disney+', 'primevideo', 'mpv']
const VIDEO_SITES = ['youtube', 'netflix', 'twitch', 'prime video', 'disney+', 'hbo max', 'max |', 'vimeo', 'crunchyroll', 'kick.com']
const GAME_APPS = ['steam', 'steamwebhelper', 'epicgameslauncher', 'battle.net', 'riotclientservices', 'riotclientux', 'leagueclient', 'league of legends', 'valorant', 'valorant-win64-shipping', 'cs2', 'csgo', 'dota2', 'minecraft', 'javaw', 'robloxplayerbeta', 'eadesktop', 'origin', 'ubisoftconnect', 'gog galaxy', 'galaxyclient', 'fortniteclient-win64-shipping', 'fortniteclient-win64-shipping_be', 'fortniteclient-win64-shipping_eac', 'fortnitelauncher', 'leagueoflegends', 'minecraft.windows', 'minecraftlauncher', 'r5apex', 'overwatch', 'rocketleague', 'gta5', 'eldenring', 'xboxapp', 'gamebar']
const SOCIAL_APPS = ['discord', 'telegram', 'whatsapp', 'messenger', 'signal', 'viber', 'instagram', 'tiktok']
const SOCIAL_SITES = ['reddit', 'instagram', 'facebook', 'x.com', '/ x', 'twitter', 'tiktok', 'discord', 'whatsapp', 'telegram', '9gag', 'pinterest']
const CODE_SITES = ['github', 'gitlab', 'stack overflow', 'stackoverflow', 'localhost', '127.0.0.1', 'docs.rs', 'crates.io', 'mdn web docs', 'npm', 'vercel', 'rust-lang']

/** Your word that this text names ("algorithms" in "Algorithms lecture 5.pdf"), in your spelling. */
export function matchWord(text: string, words: string[] | undefined): string | undefined {
  const t = text.toLowerCase()
  const hit = (words ?? [])
    .map((w) => String(w).trim())
    .filter((w) => w.length >= 3 && w.length <= 40)
    .sort((a, b) => b.length - a.length)
    .find((w) => t.includes(w.toLowerCase()))
  return hit ? hit.slice(0, 30) : undefined
}

/** VS Code's "file — repo — Visual Studio Code": the repo part (stays in the main process). */
export function vsCodeRepo(title: string): string | null {
  const parts = title.split(/\s+[—–-]\s+/).map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 3 && /visual studio code|cursor/i.test(parts[parts.length - 1])) return parts[parts.length - 2]
  if (parts.length === 2 && /visual studio code|cursor/i.test(parts[1])) return parts[0]
  return null
}

/**
 * What you're doing: your fixes first, then what the app (and, with titles
 * on, the window) says. Conf is 0..1: under 0.5 the island doesn't act on it.
 */
export function inferContext(i: ContextInput): ContextGuess {
  const name = p(i.proc || '')
  if (!name) return { kind: 'idle', conf: 0.5 }
  const t = (i.title ?? '').toLowerCase()
  const titled = !!t
  const words = [...(i.words ?? []), ...(i.block ? [i.block] : [])]
  const detailOf = (...texts: string[]) => {
    for (const x of texts) {
      const d = matchWord(x, words)
      if (d) return { detail: d }
    }
    return {}
  }
  // 1. Your own fix for this app wins.
  const rule = (i.rules ?? []).find((r) => {
    const a = p(r.app)
    return a && (a === name || (!!i.label && a === p(i.label)) || (BROWSERS.includes(name) && titled && t.includes(a)))
  })
  if (rule) return { kind: rule.kind, conf: 1, ...detailOf(t, i.block ?? '') }
  const browser = BROWSERS.includes(name)
  const blockStudy = !!i.block && has(i.block.toLowerCase(), STUDY_WORDS)

  // 2. A call app, or a meeting site, or your calendar says so with a call app in front.
  if (MEET_APPS.some((a) => name === a || name.startsWith(a))) return { kind: 'meeting', conf: i.meeting ? 0.95 : 0.75 }
  if (browser && titled && has(t, MEET_SITES)) return { kind: 'meeting', conf: 0.85 }

  // 3. CTF / VMs / security tools.
  if (VM_APPS.includes(name)) return { kind: 'ctf', conf: 0.85, ...detailOf(t, i.block ?? '') }
  if (titled && has(t, CTF_WORDS) && (browser || TERMINALS.includes(name))) return { kind: 'ctf', conf: 0.8, ...detailOf(t, i.block ?? '') }
  if (TERMINALS.includes(name)) {
    if (titled && /\b(ssh|nc|netcat|msfconsole|gobuster|sqlmap|kali|htb)\b/.test(t)) return { kind: 'ctf', conf: 0.7 }
    return { kind: 'coding', conf: 0.6, ...detailOf(t, i.block ?? '') }
  }

  // 4. Code editors (VS Code's title names the repo).
  if (CODE_APPS.includes(name)) {
    const repo = titled ? vsCodeRepo(i.title ?? '') : null
    return { kind: 'coding', conf: 0.9, ...detailOf(repo ?? '', t, i.block ?? '') }
  }

  // 5. Bank sites (only with titles on, by your words): "money" (spending check later).
  if (browser && titled && (i.bankWords ?? []).some((w) => w.length >= 3 && t.includes(w.toLowerCase()))) return { kind: 'money', conf: 0.8 }

  // 6. PDFs: study when the name sounds like a course (or matches your words, or the block is a study one).
  const pdf = PDF_APPS.includes(name) || (browser && titled && /\.pdf\b/.test(t))
  if (pdf) {
    const d = detailOf(t, i.block ?? '')
    if ((titled && has(t, STUDY_WORDS)) || d.detail || blockStudy) return { kind: 'study', conf: 0.85, ...d }
    return { kind: 'study', conf: 0.55 }
  }

  // 7. Mail.
  if (MAIL_APPS.includes(name)) return { kind: 'email', conf: 0.9 }
  if (browser && titled && has(t, MAIL_SITES)) return { kind: 'email', conf: 0.8 }

  // 8. Writing.
  if (WRITE_APPS.includes(name)) {
    const d = detailOf(t, i.block ?? '')
    return titled && has(t, STUDY_WORDS) ? { kind: 'study', conf: 0.75, ...d } : { kind: 'writing', conf: 0.8, ...d }
  }
  if (browser && titled && has(t, WRITE_SITES)) return { kind: 'writing', conf: 0.75, ...detailOf(t, i.block ?? '') }

  // 9. Games.
  if (GAME_APPS.includes(name)) return { kind: 'gaming', conf: 0.9 }

  // 10. Video: a lecture on YouTube is study.
  if (VIDEO_APPS.includes(name)) return { kind: 'video', conf: 0.85 }
  if (browser && titled && has(t, VIDEO_SITES)) {
    const d = detailOf(t)
    if (has(t, STUDY_WORDS) || d.detail) return { kind: 'study', conf: 0.6, ...d }
    return { kind: 'video', conf: 0.85 }
  }

  // 11. Study sites, code sites, social.
  if (browser && titled && has(t, STUDY_WORDS)) return { kind: 'study', conf: 0.7, ...detailOf(t, i.block ?? '') }
  if (browser && titled && has(t, CODE_SITES)) return { kind: 'coding', conf: 0.65, ...detailOf(t, i.block ?? '') }
  if (SOCIAL_APPS.includes(name)) return { kind: 'social', conf: 0.85 }
  if (browser && titled && has(t, SOCIAL_SITES)) return { kind: 'social', conf: 0.8 }

  // 12. A browser we can't read: browsing (steady on what you were doing if it was a quick look).
  if (browser) {
    const last = (i.recent ?? []).slice(-3)
    if (!titled && last.length >= 2 && last.every((k) => k === last[0]) && isWorkContext(last[0])) return { kind: last[0], conf: 0.4 }
    return { kind: 'browsing', conf: titled ? 0.6 : 0.4 }
  }
  return { kind: 'other', conf: 0.4 }
}

/** "That's not right": add (or replace) your fix for this app; at most 60 kept. */
export function addContextRule(rules: ContextRule[], app: string, kind: ContextKind): ContextRule[] {
  const a = p(app)
  if (!a || a.length > 40 || !CONTEXT_KINDS.includes(kind)) return rules
  return [...rules.filter((r) => p(r.app) !== a), { app: a, kind }].slice(-60)
}

/** Saved fixes → valid ones only. */
export function cleanContextRules(x: unknown): ContextRule[] {
  if (!Array.isArray(x)) return []
  return x
    .filter((r) => r && typeof r.app === 'string' && CONTEXT_KINDS.includes(r.kind))
    .map((r) => ({ app: p(r.app).slice(0, 40), kind: r.kind as ContextKind }))
    .filter((r) => r.app)
    .slice(-60)
}
