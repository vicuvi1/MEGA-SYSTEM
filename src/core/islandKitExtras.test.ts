// Island 2: profiles, the clipboard tray, the file shelf, the mini calendar (made-up data).
import { describe, expect, it } from 'vitest'
import {
  withProfileNudges, cleanKitProfile,
  addClip, addShelf, cleanKitProfiles, cleanPath, cleanShelf, clipAllowed, CLIPS_MAX, dayStrip, dragMinutes, inWindow, parseWifiName, pickKitProfile, pinClip, profileFilter, SHELF_MAX
} from './islandKitExtras'

describe('your own profiles (IN37)', () => {
  const list = cleanKitProfiles([
    { id: 'pgym', name: 'Gym', apps: ['Strava.exe'], nudges: { water: 'peek', move: 'never', junk: 'x' }, tiles: ['t1'] },
    { id: 'pcafe', name: 'Cafe', wifi: ['Corner-Cafe-WiFi'] },
    { id: 'peve', name: 'Evening', from: '19:00', to: '23:30', days: [1, 2, 3, 4, 5] },
    { name: '' }
  ])
  it('cleans them', () => {
    expect(list.map((p) => p.id)).toEqual(['pgym', 'pcafe', 'peve'])
    expect(list[0].apps).toEqual(['strava'])
    expect(list[0].nudges).toEqual({ water: 'peek', move: 'never' })
  })
  it('picks by the app, then the Wi-Fi, then the time', () => {
    const wed8pm = new Date(2026, 10, 4, 20, 0)
    expect(pickKitProfile(list, { app: 'strava', wifi: 'Corner-Cafe-WiFi', now: wed8pm })?.id).toBe('pgym')
    expect(pickKitProfile(list, { app: 'code', wifi: 'corner-cafe-wifi', now: wed8pm })?.id).toBe('pcafe')
    expect(pickKitProfile(list, { app: null, wifi: null, now: wed8pm })?.id).toBe('peve')
    expect(pickKitProfile(list, { app: null, wifi: null, now: new Date(2026, 10, 8, 20, 0) })).toBeNull()
  })
  it('time windows work over midnight', () => {
    expect(inWindow('22:00', '06:00', new Date(2026, 1, 1, 23, 0))).toBe(true)
    expect(inWindow('22:00', '06:00', new Date(2026, 1, 1, 7, 0))).toBe(false)
  })
  it('its own tiles only, or all', () => {
    const all = [{ id: 't1' }, { id: 't2' }]
    expect(profileFilter(all, ['t1'])).toEqual([{ id: 't1' }])
    expect(profileFilter(all, null)).toEqual(all)
  })
  it('reads the Wi-Fi name from netsh', () => {
    expect(parseWifiName('    Name                   : Wi-Fi\r\n    SSID                   : Home-Net\r\n    BSSID                  : 00:11')).toBe('Home-Net')
    expect(parseWifiName('There is no wireless interface on the system.')).toBeNull()
  })
})

describe('the clipboard tray (IN42)', () => {
  it('never inside a password manager, a bank or a private window', () => {
    expect(clipAllowed('meeting notes', { proc: 'code' })).toBe(true)
    expect(clipAllowed('meeting notes', { proc: 'KeePassXC' })).toBe(false)
    expect(clipAllowed('meeting notes', { proc: 'chrome', title: 'Online banking' })).toBe(false)
    expect(clipAllowed('', { proc: 'code' })).toBe(false)
  })
  it('never something that looks like a password or card number', () => {
    expect(clipAllowed('4111 1111 1111 1111', { proc: 'notepad' })).toBe(false)
    expect(clipAllowed('Xk9f2LmQ7pZ', { proc: 'notepad' })).toBe(false)
    expect(clipAllowed('my password is hunter', { proc: 'notepad' })).toBe(false)
    expect(clipAllowed('https://example.com/page2', { proc: 'chrome' })).toBe(true)
  })
  it('keeps the last 5, newest first, and pinned ones stay', () => {
    let l = addClip([], 'one', 1)
    l = pinClip(l, 'one', true)
    for (let i = 2; i <= 8; i++) l = addClip(l, `n${i}`, i)
    expect(l[0]).toEqual({ text: 'one', at: 1, pinned: true })
    expect(l.filter((c) => !c.pinned)).toHaveLength(CLIPS_MAX)
    expect(l[1].text).toBe('n8')
    l = addClip(l, 'n5', 9)
    expect(l.filter((c) => c.text === 'n5')).toHaveLength(1)
    expect(pinClip(l, 'one', false).find((c) => c.text === 'one')?.pinned).toBeUndefined()
  })
})

describe('the file shelf (IN48)', () => {
  it('keeps a reference to real paths only', () => {
    expect(cleanPath('C:\\Users\\sam\\Documents\\plan.pdf')).toBe('C:\\Users\\sam\\Documents\\plan.pdf')
    expect(cleanPath('/home/sam/notes.txt')).toBe('/home/sam/notes.txt')
    expect(cleanPath('https://example.com/x.pdf')).toBeNull()
    expect(cleanPath('file://C:/x')).toBeNull()
    expect(cleanPath('relative/x.txt')).toBeNull()
  })
  it('newest first, no doubles, at most 12', () => {
    let l = addShelf([], 'C:\\a\\one.txt', 1)
    l = addShelf(l, 'C:\\a\\two.txt', 2)
    l = addShelf(l, 'C:\\a\\one.txt', 3)
    expect(l.map((x) => x.name)).toEqual(['one.txt', 'two.txt'])
    for (let i = 0; i < 20; i++) l = addShelf(l, `C:\\b\\f${i}.txt`, i)
    expect(l).toHaveLength(SHELF_MAX)
    expect(cleanShelf([{ path: 'C:\\x\\y.doc', at: 5 }, { path: 'nope' }])).toEqual([{ path: 'C:\\x\\y.doc', name: 'y.doc', at: 5 }])
  })
})

describe('the mini calendar (IN46)', () => {
  const h = (n: number) => new Date(2026, 10, 5, n, 0).getTime()
  const blocks = [
    { title: 'Deep work', start: h(9), end: h(11), id: 'e1', calendarId: 'c' },
    { title: 'Call with team', start: h(11), end: h(12), id: 'e2', calendarId: 'c', call: true },
    { title: 'Evening', start: h(20), end: h(21) }
  ]
  it('lays today out along the strip; only your own focus blocks move', () => {
    const s = dayStrip(blocks, h(8), h(15), h(10))
    expect(s).toHaveLength(2)
    expect(s[0].left).toBeCloseTo(1 / 7)
    expect(s[0].width).toBeCloseTo(2 / 7)
    expect(s[0].movable).toBe(true)
    expect(s[0].now).toBe(true)
    expect(s[1].movable).toBe(false)
  })
  it('a drag moves it in 5-minute steps, at most 3 hours', () => {
    const span = 7 * 3600_000
    expect(dragMinutes(10, 420, span)).toBe(10)
    expect(dragMinutes(-31, 420, span)).toBe(-30)
    expect(dragMinutes(5000, 420, span)).toBe(180)
  })
})

describe("a profile's own nudges", () => {
  it('changes only the kinds it names', () => {
    const prefs = { kinds: { water: { show: 'peek', on: true }, move: { show: 'peek', on: true } } }
    const p = cleanKitProfile({ name: 'Calm', nudges: { water: 'never' } })
    expect(withProfileNudges(prefs, p).kinds).toEqual({ water: { show: 'never', on: false }, move: { show: 'peek', on: true } })
    expect(withProfileNudges(prefs, null)).toBe(prefs)
  })
})
