import { describe, expect, it } from 'vitest'
import { addLog, checkSeen, cleanDeny, cleanEyesPrefs, cleanLog, DEFAULT_DENY, DEFAULT_EYES_PREFS, deniedBy, denyRegex, EYES_LOG_MAX, isPaused, looksSensitive, mayLook, newGuardState, noteLook, PAUSE_FOREVER, pauseLabel, pauseUntil, scrub, skipLine, summarize, whyText, type EyesLogEntry, type EyesPrefs } from './eyesGuard'

const T0 = new Date(2026, 10, 5, 14, 0, 0).getTime()
const on = (p: Partial<EyesPrefs> = {}): EyesPrefs => ({ ...DEFAULT_EYES_PREFS, on: true, read: true, ...p })

describe('island eyes: off by default', () => {
  it('every eye is off until you turn it on', () => {
    const p = cleanEyesPrefs(null)
    expect(p.on).toBe(false)
    expect(p.read).toBe(false)
    expect(p.ocrAuto).toBe(false)
    expect(p.caption).toBe(false)
    expect(p.captionAuto).toBe(false)
    expect(p.shareBen).toBe(false)
    expect(p.deny).toEqual(DEFAULT_DENY)
    expect(mayLook(p, newGuardState(), { kind: 'read', now: T0 })).toEqual({ ok: false, why: 'off' })
    // Not even the button works with the master switch off.
    expect(mayLook(p, newGuardState(), { kind: 'ocr', now: T0, manual: true })).toEqual({ ok: false, why: 'off' })
  })
  it('cleans what was saved: bad values fall back, the caption gap is 5 min at least', () => {
    const p = cleanEyesPrefs({ on: 'yes', read: true, captionEveryMin: 1, pausedUntil: -5, deny: ['  BANK ', '', 'x', 'Foo|  bar  |foo'] })
    expect(p.on).toBe(false)
    expect(p.read).toBe(true)
    expect(p.captionEveryMin).toBe(5)
    expect(p.pausedUntil).toBe(0)
    expect(p.deny).toEqual(['bank', 'foo|bar'])
    expect(cleanEyesPrefs({ captionEveryMin: 999 }).captionEveryMin).toBe(120)
    // An emptied list stays empty (your choice); a missing one is the defaults.
    expect(cleanEyesPrefs({ deny: [] }).deny).toEqual([])
    expect(cleanEyesPrefs({}).deny).toEqual(DEFAULT_DENY)
    // The defaults survive cleaning unchanged (no entry is cut).
    expect(cleanDeny(DEFAULT_DENY)).toEqual(DEFAULT_DENY)
  })
  it('a list typed as lines works too, and stays short', () => {
    expect(cleanDeny('steam\n\nDiscord|slack\n')).toEqual(['steam', 'discord|slack'])
    expect(cleanDeny(Array.from({ length: 100 }, (_, i) => `app${i}`)).length).toBe(60)
    expect(cleanDeny(null)).toEqual([])
  })
})

describe('the private list', () => {
  const deny = DEFAULT_DENY
  it('banking, password managers, private chats, incognito and Windows Security are never read', () => {
    expect(deniedBy({ proc: 'chrome', title: 'Online Banking - My Bank' }, deny)).toBeTruthy()
    expect(deniedBy({ proc: '1Password', title: 'Vault' }, deny)).toBeTruthy()
    expect(deniedBy({ proc: 'Bitwarden' }, deny)).toBeTruthy()
    expect(deniedBy({ proc: 'KeePassXC' }, deny)).toBeTruthy()
    expect(deniedBy({ proc: 'Signal' }, deny)).toBe('signal')
    expect(deniedBy({ proc: 'WhatsApp' }, deny)).toBe('whatsapp')
    expect(deniedBy({ proc: 'Telegram' }, deny)).toBe('telegram')
    expect(deniedBy({ proc: 'msedge', title: 'New InPrivate tab - Microsoft Edge' }, deny)).toBeTruthy()
    expect(deniedBy({ proc: 'chrome', title: 'New Tab - Google Chrome (Incognito)' }, deny)).toBe('incognito')
    expect(deniedBy({ proc: 'firefox', title: 'Mozilla Firefox Private Browsing' }, deny)).toBeTruthy()
    expect(deniedBy({ proc: 'SecHealthUI', title: 'Windows Security' }, deny)).toBeTruthy()
  })
  it('anything with pass, bank, login, 2fa or wallet in the app or title', () => {
    for (const t of ['Reset your password', 'Login – Example', 'Enable 2FA', 'My Wallet', 'Bankrupt? no: bank']) expect(deniedBy({ proc: 'chrome', title: t }, deny)).toBeTruthy()
    expect(deniedBy({ proc: 'chrome', title: 'Two Sum - LeetCode' }, deny)).toBeNull()
    expect(deniedBy({ proc: 'Code', title: 'main.rs — notes — Visual Studio Code' }, deny)).toBeNull()
  })
  it('our own windows are never read', () => {
    expect(deniedBy({ proc: 'Life System' }, [])).toBe('Life System')
    expect(deniedBy({ proc: 'electron' }, [])).toBe('Life System')
  })
  it('your own words work, and an empty list blocks nothing else', () => {
    expect(deniedBy({ proc: 'steam', title: 'Library' }, ['steam'])).toBe('steam')
    expect(deniedBy({ proc: 'chrome', title: 'Online Banking' }, [])).toBeNull()
    expect(deniedBy({}, deny)).toBeNull()
  })
  it('a regex for the desktop check, with nothing that can break out of the PowerShell string', () => {
    const re = denyRegex(['pass|bank', "o'neil", 'a.b', 'c$`d'])
    expect(re).toBe('pass|bank|o.neil|a\\.b|c\\$.d')
    expect(new RegExp(re, 'i').test('My BANK')).toBe(true)
    expect(new RegExp(re, 'i').test('axb')).toBe(false)
    expect(re).not.toMatch(/['"`]/)
    // An empty list matches nothing.
    expect(new RegExp(denyRegex([])).test('anything')).toBe(false)
  })
})

describe('the gate', () => {
  it('pausing stops every eye, and resumes by itself', () => {
    const p = on({ pausedUntil: pauseUntil('1h', T0) })
    expect(isPaused(p, T0 + 59 * 60_000)).toBe(true)
    expect(mayLook(p, newGuardState(), { kind: 'read', now: T0 + 30 * 60_000 })).toEqual({ ok: false, why: 'paused' })
    expect(mayLook(p, newGuardState(), { kind: 'ocr', now: T0 + 30 * 60_000, manual: true })).toEqual({ ok: false, why: 'paused' })
    expect(mayLook(p, newGuardState(), { kind: 'read', now: T0 + 61 * 60_000 }).ok).toBe(true)
    expect(isPaused(on({ pausedUntil: PAUSE_FOREVER }), T0 + 365 * 864e5)).toBe(true)
  })
  it('pause choices and their words', () => {
    expect(pauseUntil('resume', T0)).toBe(0)
    expect(pauseUntil('15m', T0)).toBe(T0 + 15 * 60_000)
    const tomorrow = new Date(pauseUntil('tomorrow', T0))
    expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([6, 6, 0])
    expect(pauseLabel(T0 + 60 * 60_000, T0)).toBe('Paused for 60 min')
    expect(pauseLabel(PAUSE_FOREVER, T0)).toBe('Paused until you resume')
    expect(pauseLabel(pauseUntil('tomorrow', T0), T0)).toBe('Paused until 06:00')
    expect(pauseLabel(T0 - 1, T0)).toBe('')
  })
  it('each eye needs its own switch to look by itself; the button only needs the eyes on', () => {
    const p = on({ read: false })
    const st = newGuardState()
    expect(mayLook(p, st, { kind: 'read', now: T0 })).toMatchObject({ why: 'kindOff' })
    expect(mayLook(p, st, { kind: 'ocr', now: T0 })).toMatchObject({ why: 'kindOff' })
    expect(mayLook(p, st, { kind: 'ocr', now: T0, manual: true }).ok).toBe(true)
    // Captions need the caption switch even from the button (the model must be there).
    expect(mayLook(p, st, { kind: 'caption', now: T0, manual: true })).toMatchObject({ why: 'kindOff' })
    expect(mayLook(on({ caption: true }), st, { kind: 'caption', now: T0, manual: true }).ok).toBe(true)
    expect(mayLook(on({ caption: true }), st, { kind: 'caption', now: T0 })).toMatchObject({ why: 'kindOff' })
    expect(mayLook(on({ caption: true, captionAuto: true }), st, { kind: 'caption', now: T0 }).ok).toBe(true)
  })
  it('a window on your list is refused before anything is read', () => {
    const r = mayLook(on(), newGuardState(), { kind: 'read', now: T0, win: { proc: 'chrome', title: 'Sign in to your account' } })
    expect(r).toMatchObject({ ok: false, why: 'denied' })
    expect(whyText(r)).toMatch(/private list/)
  })
  it('one read per 20 s by itself, one per 5 s from the button; one look at a time', () => {
    let st = newGuardState()
    const p = on({ ocrAuto: true })
    expect(mayLook(p, st, { kind: 'read', now: T0 }).ok).toBe(true)
    st = noteLook(st, 'read', T0)
    const r = mayLook(p, st, { kind: 'read', now: T0 + 5_000 })
    expect(r).toEqual({ ok: false, why: 'rate', waitMs: 15_000 })
    expect(whyText(r)).toBe('Wait 15 s')
    expect(mayLook(p, st, { kind: 'read', now: T0 + 20_000 }).ok).toBe(true)
    expect(mayLook(p, st, { kind: 'read', now: T0 + 6_000, manual: true }).ok).toBe(true)
    // Kinds have their own limits.
    expect(mayLook(p, st, { kind: 'ocr', now: T0 + 1_000 }).ok).toBe(true)
    expect(mayLook(p, st, { kind: 'ocr', now: T0 + 1_000, busy: true })).toEqual({ ok: false, why: 'busy' })
  })
  it('one caption per 5 minutes by itself (or your slower pick)', () => {
    const p = on({ caption: true, captionAuto: true })
    let st = noteLook(newGuardState(), 'caption', T0)
    expect(mayLook(p, st, { kind: 'caption', now: T0 + 4 * 60_000 })).toMatchObject({ why: 'rate' })
    expect(mayLook(p, st, { kind: 'caption', now: T0 + 5 * 60_000 }).ok).toBe(true)
    expect(mayLook({ ...p, captionEveryMin: 15 }, st, { kind: 'caption', now: T0 + 10 * 60_000 })).toMatchObject({ why: 'rate' })
    expect(mayLook(p, st, { kind: 'caption', now: T0 + 20_000, manual: true })).toMatchObject({ why: 'rate' })
    expect(mayLook(p, st, { kind: 'caption', now: T0 + 30_000, manual: true }).ok).toBe(true)
    st = noteLook(st, 'read', T0)
    expect(st.lastAt.caption).toBe(T0)
  })
})

describe('what is kept', () => {
  it('a summary is one line of 120 characters at most, cut at a word', () => {
    const s = summarize('word '.repeat(60))
    expect(s.length).toBeLessThanOrEqual(120)
    expect(s.endsWith('…')).toBe(true)
    expect(s).not.toMatch(/\s…$/)
    expect(summarize('  Two   Sum\n- LeetCode ')).toBe('Two Sum - LeetCode')
    expect(summarize('x'.repeat(500)).length).toBeLessThanOrEqual(120)
  })
  it('emails, links, long numbers and keys are taken out', () => {
    const s = scrub('Mail ana@example.com or see https://example.com/a?b=c card 4111 1111 1111 1111 code 123456 key abcdefghijklmnopqrstuvwxyz1234')
    expect(s).not.toMatch(/@|https|4111|123456|abcdefghijkl/)
    expect(scrub('Room 101, 2026')).toBe('Room 101, 2026')
  })
  it('private-looking text is dropped, not summarized', () => {
    expect(looksSensitive('Enter your password')).toBe(true)
    expect(looksSensitive('Your verification code is')).toBe(true)
    expect(looksSensitive('CVV')).toBe(true)
    expect(looksSensitive('Chapter 3: graphs')).toBe(false)
    expect(checkSeen({ proc: 'chrome', title: 'Checkout', text: 'Card number and CVV' }, [])).toEqual({ outcome: 'sensitive', title: '', text: '' })
  })
  it('the title the eye found is checked against your list again', () => {
    const r = checkSeen({ proc: 'chrome', title: 'Online Banking', text: 'Balance' }, DEFAULT_DENY)
    expect(r.outcome).toBe('denied')
    expect(r.title + r.text).toBe('')
  })
  it('kept: a short title and a short text', () => {
    const r = checkSeen({ proc: 'chrome', title: 'Two Sum - LeetCode', text: 'Given an array of integers '.repeat(20) }, DEFAULT_DENY)
    expect(r.outcome).toBe('kept')
    expect(r.title).toBe('Two Sum - LeetCode')
    expect(r.text.length).toBeLessThanOrEqual(120)
    expect(checkSeen({ proc: 'notepad', title: '', text: '   ' }, []).outcome).toBe('empty')
  })
})

describe('the log', () => {
  const e = (i: number, o: Partial<EyesLogEntry> = {}): EyesLogEntry => ({ at: T0 + i, kind: 'read', app: 'Chrome', summary: `page ${i}`, outcome: 'kept', ...o })
  it('keeps the last 50, newest first, summaries capped', () => {
    let log: EyesLogEntry[] = []
    for (let i = 0; i < 60; i++) log = addLog(log, e(i))
    expect(log.length).toBe(EYES_LOG_MAX)
    expect(log[0].summary).toBe('page 59')
    expect(addLog([], e(1, { summary: 'y '.repeat(400) }))[0].summary.length).toBeLessThanOrEqual(120)
  })
  it('the same skip twice in a row is one line', () => {
    const skip = e(1, { outcome: 'denied', summary: skipLine('denied', 'bank') })
    let log = addLog([], skip)
    log = addLog(log, { ...skip, at: T0 + 50 })
    expect(log.length).toBe(1)
    expect(log[0].at).toBe(T0 + 50)
    expect(log[0].summary).toBe('Not read: on your private list (bank)')
  })
  it('a saved log is cleaned on load', () => {
    const out = cleanLog([e(1), { at: 'x' }, null, { ...e(2), kind: 'photo' }, { ...e(3), summary: 'z '.repeat(300) }])
    expect(out.length).toBe(2)
    expect(out[0].summary).toBe('page 1')
    expect(out[1].summary.length).toBeLessThanOrEqual(120)
    expect(cleanLog('nope')).toEqual([])
  })
  it('skip lines say why in plain words', () => {
    expect(skipLine('sensitive')).toMatch(/looked private/)
    expect(skipLine('empty')).toBe('Nothing to read here')
    expect(skipLine('denied')).toBe('Not read: on your private list')
  })
})
