import { describe, expect, it } from 'vitest'
import { cleanEyesPrefs, DEFAULT_DENY } from './eyesGuard'
import { lastMessage, mayReply, parseReplies, peopleNote, replyApp, replyPrompt, REPLY_GAP_MS, textForAi } from './replyHelper'

describe('replyApp', () => {
  it('knows the chat and mail apps', () => {
    expect(replyApp('Telegram')).toBe('Telegram')
    expect(replyApp('WhatsApp.Root')).toBe('WhatsApp')
    expect(replyApp('Discord')).toBe('Discord')
    expect(replyApp('olk')).toBe('Mail')
    expect(replyApp('thunderbird')).toBe('Mail')
    expect(replyApp('notepad')).toBeNull()
  })
  it('a browser counts only by its title', () => {
    expect(replyApp('chrome', 'WhatsApp - Google Chrome')).toBe('WhatsApp')
    expect(replyApp('msedge', 'Inbox (3) - Gmail')).toBe('Mail')
    expect(replyApp('chrome', null)).toBeNull()
    expect(replyApp('chrome', 'Lecture notes - Docs')).toBeNull()
  })
})

describe('lastMessage', () => {
  it('drops the buttons and times, keeps the newest lines', () => {
    const text = ['Chats', 'Search', 'Sam', 'Are we still on for the library?', '18:42', 'I can bring the notes', 'Type a message', 'Send'].join('\n')
    expect(lastMessage(text)).toBe('Sam\nAre we still on for the library?\nI can bring the notes')
  })
  it('stays within the limit', () => {
    expect(lastMessage(['x'.repeat(50), 'y'.repeat(50)].join('\n'), 60)).toBe('y'.repeat(50))
  })
})

describe('textForAi', () => {
  it('never sends text that looks private', () => {
    expect(textForAi('Your verification code is 123456')).toBeNull()
    expect(textForAi('my password is hunter2')).toBeNull()
  })
  it('takes out emails and links', () => {
    expect(textForAi('mail me at sam@example.com or see https://example.com/x')).toBe('mail me at … or see …')
  })
})

describe('mayReply', () => {
  const prefs = cleanEyesPrefs({ deny: ['bank'] })
  it('the eyes pause stops it', () => {
    expect(mayReply({ prefs: { ...prefs, pausedUntil: 10_000 }, lastAt: 0, now: 5000, proc: 'Discord', app: 'Discord' }).ok).toBe(false)
  })
  it('your private list stops it, and says how to change that', () => {
    const r = mayReply({ prefs: cleanEyesPrefs(null), lastAt: 0, now: 5000, proc: 'Telegram', app: 'Telegram' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.said).toMatch(/private list.*Settings → Island eyes/)
    expect(DEFAULT_DENY.join('|')).toMatch(/telegram/)
  })
  it('a title on the list stops it too', () => {
    expect(mayReply({ prefs, lastAt: 0, now: 5000, proc: 'olk', app: 'Mail', title: 'Your bank statement' }).ok).toBe(false)
  })
  it('one read every 10 seconds', () => {
    expect(mayReply({ prefs, lastAt: 1000, now: 1000 + REPLY_GAP_MS - 1, proc: 'Discord', app: 'Discord' }).ok).toBe(false)
    expect(mayReply({ prefs, lastAt: 1000, now: 1000 + REPLY_GAP_MS, proc: 'Discord', app: 'Discord' }).ok).toBe(true)
  })
})

describe('the prompt and the answer', () => {
  it('peopleNote reads Ben’s People note', () => {
    expect(peopleNote([{ name: 'About you', text: 'x' }, { name: 'People', text: 'Sam: study buddy' }])).toBe('Sam: study buddy')
    expect(peopleNote(null)).toBe('')
  })
  it('the prompt has the app, the message and the people note', () => {
    const p = replyPrompt({ app: 'Discord', message: 'Are we still on?', people: 'Sam: study buddy' })
    expect(p).toContain('in Discord')
    expect(p).toContain('Are we still on?')
    expect(p).toContain('Sam: study buddy')
    expect(p).toContain('{"replies"')
  })
  it('parses JSON, numbered lines, and keeps 3 one-line replies', () => {
    expect(parseReplies('```json\n{"replies":["Yes, see you at 6!","Which room?","Can we do tomorrow?","extra"]}\n```')).toEqual(['Yes, see you at 6!', 'Which room?', 'Can we do tomorrow?'])
    expect(parseReplies('1. "Sure"\n2. Maybe later\n3. Sure')).toEqual(['Sure', 'Maybe later'])
    expect(parseReplies('{"replies":["two\\nlines"]}')).toEqual(['two lines'])
    expect(parseReplies('nothing useful')).toEqual([])
  })
})
