// Ben 2 chat: answer chips, chat search, pins, link and file reading, web
// search, email drafts, Telegram plan buttons, feedback learning, basic mode
// and the cost line. All made-up data; clocks pinned where it matters.
import { describe, expect, it } from 'vitest'
import { answerKind, chipsFor, copyText } from './answerChips'
import { fold, joinSources, logSource, markParts, queryTerms, searchChat, type ChatDoc } from './chatSearch'
import { cleanPins, isPinned, pinTitle, togglePin } from './chatPins'
import { captionUrl, fileKind, fileProblem, findLinks, htmlToPage, packFile, pageForBen, privateHost, readNote, splitFile, transcriptFromXml, youtubeId, LIMITS, fileLine } from './readLinks'
import { mergeResults, parseDuckDuckGo, parseWikipedia, resultsForBen, searchUrls, sourcesLine, wantsWebSearch } from './webSearch'
import { draftNote, mailtoLink, parseDraft, readDraftAsk, templateDraft } from './emailDraft'
import { blockMarkId, fitsCallback, movedStart, planKeyboard, readPlanTap, receiptLine, withReceipt } from './tgPlan'
import { cleanFeedback, feedbackPrompt, learnedRules, weeklyMisses, type FeedbackItem } from './feedbackLearn'
import { basicLabel, basicReason, enqueue, freshQueue, matchMustDo, readBasic } from './offlineMode'
import { answerMeta, budgetBar, budgetMode, costLine, keepMeta, money, shortModel } from './answerCost'
import { profileNames, speakBody, speakMs, VOICEBOX_ORIGIN } from './voicebox'

describe('TV3 Voicebox (optional local voice)', () => {
  it('reads its profiles in either shape and builds the speak body', () => {
    expect(profileNames([{ id: 'a1', name: 'Morgan' }, 'Ava', { id: 'z9' }])).toEqual(['Morgan', 'Ava', 'z9'])
    expect(profileNames({ profiles: [{ name: 'Morgan' }] })).toEqual(['Morgan'])
    expect(profileNames(null)).toEqual([])
    expect(speakBody('  Hello   there ', '')).toEqual({ text: 'Hello there' })
    expect(speakBody('Hi', 'Morgan')).toEqual({ text: 'Hi', profile: 'Morgan' })
    expect(speakMs('one two three four five six')).toBeGreaterThanOrEqual(1200)
    expect(VOICEBOX_ORIGIN).toBe('http://127.0.0.1:17493')
  })
})

describe('CH2 answer chips', () => {
  it('a waiting plan gets Approve / Change / Make it lighter, then Copy', () => {
    const c = chipsFor({ text: "Here's today's plan.", show: ['plan'], planWaiting: true })
    expect(c.map((x) => x.id)).toEqual(['approve', 'change', 'lighter', 'copy'])
    expect(c[0].primary).toBe(true)
  })
  it('no second Approve when the plan card shows its own', () => {
    expect(chipsFor({ text: 'Plan', show: ['plan'], planWaiting: true, planCardShown: true }).map((x) => x.id)).toEqual(['lighter', 'copy'])
  })
  it('a draft gets Shorter / More formal; a quick answer from the fallback gets Think harder first', () => {
    expect(chipsFor({ text: 'Subject: Missed class\n\nDear Ms Popa,\n\nI was ill.\n\nVictor' }).map((x) => x.id)).toEqual(['shorter', 'formal', 'copy'])
    const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ')
    expect(chipsFor({ text: long, chips: ['Think harder'] }).map((x) => x.id)).toEqual(['harder', 'shorter', 'copy'])
  })
  it('a short done line only offers Copy; a list offers Turn into tasks', () => {
    expect(chipsFor({ text: '💧 500 ml in.', done: ['💧 +500 ml'] }).map((x) => x.id)).toEqual(['copy'])
    expect(answerKind({ text: 'Try:\n- one\n- two\n- three' })).toBe('list')
    expect(chipsFor({ text: 'Try:\n- one\n- two\n- three' })[0].id).toBe('tasks')
    expect(chipsFor({ text: '🟢 Yes, it fits.\n• one\n• two\n• three' }).map((x) => x.id)).toEqual(['copy'])
  })
  it('copy text drops markdown and keeps what was done', () => {
    expect(copyText('**Do** the `essay` now', ['✅ Focus started', '⚠️ failed'])).toBe('Do the essay now\n\n✅ Focus started')
  })
})

describe('CH3 chat search', () => {
  const docs: ChatDoc[] = [
    { id: 'a', at: '2026-11-01T08:00:00.000Z', role: 'me', text: 'Plan my day around the ședință at 10' },
    { id: 'b', at: '2026-11-02T08:00:00.000Z', role: 'coach', text: 'Deep work block at 09:00, then the meeting.' },
    { id: 'c', at: '2026-11-03T08:00:00.000Z', role: 'me', text: 'deep work again tomorrow? planning is hard' }
  ]
  it('folds accents and case without moving letters', () => {
    expect(fold('Ședință ÎN')).toBe('sedinta in')
    expect(fold('Ședință').length).toBe('Ședință'.length)
  })
  it('every word must match; quotes keep words together', () => {
    expect(queryTerms('plan "deep work"')).toEqual(['plan', 'deep work'])
    expect(searchChat(docs, 'sedinta').map((h) => h.id)).toEqual(['a'])
    expect(searchChat(docs, '"deep work"').map((h) => h.id).sort()).toEqual(['b', 'c'])
    expect(searchChat(docs, 'deep tomorrow').map((h) => h.id)).toEqual(['c'])
    expect(searchChat(docs, 'x')).toEqual([])
  })
  it('whole words rank above parts, and hits carry highlight ranges', () => {
    const h = searchChat(docs, 'plan')
    expect(h[0].id).toBe('a')
    const parts = markParts(h[0].snippet, h[0].ranges)
    expect(parts.find((p) => p.hit)?.t.toLowerCase()).toBe('plan')
  })
  it('sources join without duplicates', async () => {
    const one = logSource(() => docs)
    const two = { name: 'store', search: async () => [{ id: 'b', at: docs[1].at, role: 'coach' as const, snippet: 'x', ranges: [], score: 9 }] }
    const all = await joinSources([one, two]).search('deep', 10)
    expect(all.filter((x) => x.id === 'b')).toHaveLength(1)
  })
})

describe('CH4 pins', () => {
  const m = { at: '2026-11-05T10:00:00.000Z', role: 'coach' as const, text: 'Your **exam** plan: 3 blocks a week' }
  it('toggles, keeps a copy, cleans junk', () => {
    const a = togglePin([], m, new Date('2026-11-05T11:00:00Z'))
    expect(isPinned(a, m.at)).toBe(true)
    expect(pinTitle(a[0])).toBe('Your exam plan: 3 blocks a week')
    expect(togglePin(a, m)).toEqual([])
    expect(cleanPins([null, { at: 'bad', text: 'x' }, { at: m.at, text: '' }, { at: m.at, text: 'ok', role: 'me' }])).toHaveLength(1)
  })
})

describe('TL4 links and files', () => {
  it('finds links, drops private hosts and punctuation', () => {
    expect(findLinks('read https://example.com/a?b=1). and http://127.0.0.1/x and https://localhost/x')).toEqual(['https://example.com/a?b=1'])
    expect(privateHost('192.168.1.4')).toBe(true)
    expect(privateHost('example.org')).toBe(false)
  })
  it('reads YouTube ids', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toBe('abcdefghijk')
    expect(youtubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://example.com/watch?v=abcdefghijk')).toBeNull()
  })
  it('turns a page into text without scripts and menus', () => {
    const p = htmlToPage('<html><head><title>Study &amp; tips</title><meta name="description" content="Five tips"></head><body><nav>Menu</nav><article><h1>Tips</h1><p>Sleep 8 hours.</p><script>evil()</script><ul><li>Review notes</li></ul></article><footer>©</footer></body></html>', 'https://example.com/t')
    expect(p.title).toBe('Study & tips')
    expect(p.description).toBe('Five tips')
    expect(p.text).toContain('Sleep 8 hours.')
    expect(p.text).toContain('- Review notes')
    expect(p.text).not.toMatch(/evil|Menu/)
    expect(pageForBen(p)).toMatch(/DATA he shared/)
  })
  it('cuts long text at the limit', () => {
    const p = htmlToPage(`<p>${'A sentence here. '.repeat(1500)}</p>`, 'https://example.com')
    expect(p.cut).toBe(true)
    expect(p.text.length).toBeLessThanOrEqual(LIMITS.textChars + 2)
  })
  it('reads a caption track and its transcript', () => {
    const html = `xx"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=ro","languageCode":"ro"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en","languageCode":"en"}],"x"`
    expect(captionUrl(html)).toBe('https://www.youtube.com/api/timedtext?v=1&lang=en')
    expect(captionUrl('nothing')).toBeNull()
    expect(transcriptFromXml('<transcript><text start="0">Hello &amp;amp; welcome</text><text start="2">to the &lt;b&gt;course&lt;/b&gt;</text></transcript>')).toBe('Hello & welcome to the course')
  })
  it('packs a file into the message and back out', () => {
    const msg = packFile('turn this into tasks', { name: 'syllabus.pdf', kind: 'pdf', text: 'Week 1: read chapter 1\nWeek 2: lab', pages: 2 })
    const s = splitFile(msg)
    expect(s.text).toBe('turn this into tasks')
    expect(s.file).toMatchObject({ name: 'syllabus.pdf', kind: 'pdf', pages: 2 })
    expect(s.file!.text).toContain('Week 2: lab')
    expect(fileLine(s.file!)).toBe('📎 syllabus.pdf (2 pages)')
    expect(splitFile('plain').file).toBeNull()
  })
  it('knows file kinds and limits', () => {
    expect(fileKind('a.PDF')).toBe('pdf')
    expect(fileKind('notes.md')).toBe('text')
    expect(fileKind('x', 'image/png')).toBe('image')
    expect(fileProblem('a.zip', '', 10)).toMatch(/PDFs, pictures and text/)
    expect(fileProblem('a.pdf', '', 50 * 1024 * 1024)).toMatch(/most I take/)
    expect(fileProblem('a.pdf', '', 1000)).toBeNull()
  })
  it('the note asks for tasks only when he did', () => {
    expect(readNote('summarise this')).toMatch(/Summarise/)
    expect(readNote('make tasks from this')).toMatch(/"task: <text>"/)
  })
})

describe('TL7 web search', () => {
  it('only when asked', () => {
    expect(wantsWebSearch('search the web for rust 2024 edition')).toBe('rust 2024 edition')
    expect(wantsWebSearch('google CTF schedule')).toBe('CTF schedule')
    expect(wantsWebSearch('look up my water this week')).toBeNull()
    expect(wantsWebSearch('how was my week?')).toBeNull()
  })
  it('parses DuckDuckGo and Wikipedia, merges, cites', () => {
    const d = parseDuckDuckGo({ Heading: 'Rust', AbstractText: 'Rust is a language.', AbstractURL: 'https://en.wikipedia.org/wiki/Rust_(programming_language)', RelatedTopics: [{ Text: 'Cargo - the package manager', FirstURL: 'https://duckduckgo.com/Cargo' }, { Name: 'x', Topics: [{ Text: 'Ferris - mascot', FirstURL: 'https://duckduckgo.com/Ferris' }] }] })
    expect(d.map((r) => r.title)).toEqual(['Rust', 'Cargo', 'Ferris'])
    const w = parseWikipedia({ query: { pages: { 1: { title: 'Rust (programming language)', extract: 'Rust is fast.', index: 1 }, 2: { title: 'Rust', extract: 'Iron oxide.', index: 2 } } } })
    expect(w[0].url).toBe('https://en.wikipedia.org/wiki/Rust_(programming_language)')
    const all = mergeResults(d, w)
    expect(all.filter((r) => /Rust_\(programming/.test(r.url))).toHaveLength(1)
    expect(resultsForBen('rust', all)).toMatch(/\[1\] Rust/)
    expect(sourcesLine(all)).toMatch(/^Sources:\n\[1\]/)
    expect(resultsForBen('zzz', [])).toMatch(/NOTHING found/)
    expect(searchUrls('a b').ddg).toContain('q=a%20b')
  })
})

describe('TL8 email drafts', () => {
  it('reads the ask', () => {
    expect(readDraftAsk('write an email to my teacher about missing Monday’s lab')).toEqual({ kind: 'email', to: 'my teacher', about: 'missing Monday’s lab', tone: 'formal' })
    expect(readDraftAsk('draft a friendly message to Leo asking to move our call')).toMatchObject({ kind: 'message', to: 'Leo', tone: 'friendly' })
    expect(readDraftAsk('scrie un email către profesor despre examen')).toMatchObject({ kind: 'email', to: 'profesor', about: 'examen' })
    expect(readDraftAsk('how do I write better?')).toBeNull()
  })
  it('parses a draft and builds a safe mailto link', () => {
    const d = parseDraft('Subject: Missed lab on Monday\n\nDear Ms Popa,\n\nI missed the lab because I was ill.\n\nKind regards,\nVictor')!
    expect(d.subject).toBe('Missed lab on Monday')
    expect(d.body.startsWith('Dear Ms Popa')).toBe(true)
    expect(mailtoLink(d)).toMatch(/^mailto:\?subject=Missed%20lab%20on%20Monday&body=Dear%20Ms%20Popa/)
    expect(mailtoLink(d, 'prof@example.edu')).toMatch(/^mailto:prof@example\.edu\?/)
    expect(mailtoLink({ subject: 's', body: 'x'.repeat(5000) }).length).toBeLessThanOrEqual(1800)
    expect(parseDraft('Just a normal reply.')).toBeNull()
  })
  it('the note never lets Ben send or invent', () => {
    const n = draftNote({ kind: 'email', to: 'my employer', about: 'a day off', tone: 'formal' })
    expect(n).toMatch(/Subject:/)
    expect(n).toMatch(/never send/i)
    expect(templateDraft({ kind: 'email', to: 'my teacher', about: 'the deadline', tone: 'formal' }).body).toMatch(/\[teacher's name\]/)
  })
})

describe('TV1 Telegram plan buttons', () => {
  const plan = { blocks: [{ start: '09:00', minutes: 60, title: 'Deep work: essay' }, { start: '14:00', minutes: 50, title: 'Lab report' }] }
  it('reads taps and refuses junk', () => {
    expect(readPlanTap('pb|m|1|-30')).toEqual({ op: 'move', i: 1, delta: -30 })
    expect(readPlanTap('pb|d|0')).toEqual({ op: 'done', i: 0 })
    expect(readPlanTap('pb|n')).toEqual({ op: 'now' })
    expect(readPlanTap('pb|m|1|7')).toBeNull()
    expect(readPlanTap('pb|m|99|30')).toBeNull()
    expect(readPlanTap('rb|a')).toBeNull()
    expect(readPlanTap('pb|r')).toEqual({ op: 'replan' })
    expect(readPlanTap('pb|t')).toEqual({ op: 'toomuch' })
    expect(readPlanTap('pb|w|1')).toEqual({ op: 'tomorrow', i: 1 })
    expect(readPlanTap('pb|z|abc')).toEqual({ op: 'back', at: parseInt('abc', 36) })
    expect(readPlanTap('pb|c')).toEqual({ op: 'check' })
  })
  it('one row per block, then Approve · Shift · Change; marked blocks show Undo', () => {
    const k = planKeyboard(plan, { late: true })
    expect(k.inline_keyboard).toHaveLength(4)
    // A draft block also moves to tomorrow (the app card's ⋯ menu).
    expect(k.inline_keyboard[0].map((b) => b.callback_data)).toEqual(['pb|m|0|-30', 'pb|m|0|30', 'pb|d|0', 'pb|s|0', 'pb|w|0'])
    expect(k.inline_keyboard[2].map((b) => b.text)).toEqual(['✅ Approve', '⏩ Shift to now', '✏️ Change'])
    expect(k.inline_keyboard[3].map((b) => b.callback_data)).toEqual(['pb|r', 'pb|t'])
    const marked = planKeyboard(plan, { approved: true, marks: { 0: 'done' } })
    expect(marked.inline_keyboard[0][1]).toEqual({ text: '↩ Undo', callback_data: 'pb|u|0' })
    expect(marked.inline_keyboard[2].map((b) => b.text)).not.toContain('✅ Approve')
    // An approved plan has no "Tomorrow" on its blocks (only drafts move).
    expect(marked.inline_keyboard[1].map((b) => b.callback_data)).not.toContain('pb|w|1')
    expect(k.inline_keyboard.flat().every((b) => fitsCallback(b.callback_data))).toBe(true)
  })
  it('moves stay inside the day; receipts stay short', () => {
    expect(movedStart({ start: '09:00', minutes: 60 }, 30)).toBe('09:30')
    expect(movedStart({ start: '05:10', minutes: 30 }, -30)).toBeNull()
    expect(blockMarkId(plan.blocks[0])).toBe('plan:09:00 Deep work: essay')
    expect(blockMarkId(plan.blocks[0], 'ev1')).toBe('ev1')
    let t = 'Your day'
    for (let i = 0; i < 5; i++) t = withReceipt(t, receiptLine({ op: 'done', i: 0 }, plan.blocks[0]))
    expect(t.split('\n').filter((l) => l.startsWith('✅'))).toHaveLength(3)
  })
})

describe('QA2 feedback learning', () => {
  const now = new Date('2026-11-07T12:00:00Z')
  const f = (at: string, kind: FeedbackItem['kind'], reason?: FeedbackItem['reason']): FeedbackItem => ({ at, kind, text: 'A long answer about the plan', ...(reason ? { reason } : {}) })
  const list = [f('2026-11-01T10:00:00Z', 'long'), f('2026-11-05T10:00:00Z', 'down', 'long'), f('2026-11-06T10:00:00Z', 'down', 'notdone'), f('2026-11-06T11:00:00Z', 'up'), f('2026-10-01T10:00:00Z', 'down', 'wrong')]
  it('two "too long" in two weeks becomes "keep answers short"', () => {
    const rules = learnedRules(list, now)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatch(/^Keep answers short/)
    expect(feedbackPrompt(list, now)).toMatch(/Learned from his ratings/)
  })
  it('the weekly list counts reasons and skips older ones', () => {
    const w = weeklyMisses(list, now)
    expect(w.misses.map((m) => m.reason)).toEqual(["Didn't do it", 'Too long', 'Too long'])
    expect(w.byReason).toEqual([{ label: 'Too long', n: 2 }, { label: "Didn't do it", n: 1 }])
    expect(w.ups).toBe(1)
  })
  it('cleans a saved rating', () => {
    expect(cleanFeedback({ at: 'x' })).toBeNull()
    expect(cleanFeedback({ at: '2026-11-01T00:00:00Z', kind: 'down', reason: 'nope', note: ' too vague ' })).toEqual({ at: '2026-11-01T00:00:00Z', kind: 'down', text: '', note: 'too vague' })
  })
})

describe('QA3 basic mode', () => {
  it('reads the basic commands', () => {
    expect(readBasic('start focus 45 on algebra')).toEqual({ k: 'focus', subject: 'algebra', minutes: 45 })
    expect(readBasic('focus')).toEqual({ k: 'focus', subject: 'Focus', minutes: 25 })
    expect(readBasic('add task buy printer paper')).toEqual({ k: 'task', text: 'buy printer paper' })
    expect(readBasic('done essay intro')).toEqual({ k: 'done', what: 'essay intro' })
    expect(readBasic('water 500')).toEqual({ k: 'quick', text: 'water 500' })
    expect(readBasic('stop the timer')).toEqual({ k: 'stop' })
  })
  it('matches a must-do by its words', () => {
    const items = [{ text: 'Essay intro', done: false }, { text: 'Gym session', done: false }, { text: 'Call Leo', done: true }]
    expect(matchMustDo(items, 'essay')).toBe(0)
    expect(matchMustDo(items, 'leo')).toBe(-1)
    expect(matchMustDo(items, 'groceries')).toBe(-1)
  })
  it('queues without doubles and drops old ones', () => {
    const now = new Date('2026-11-07T10:00:00Z')
    let q = enqueue([], { text: 'how was my week?', to: 'ben' }, now)
    q = enqueue(q, { text: 'how was my week?', to: 'ben' }, new Date('2026-11-07T10:05:00Z'))
    expect(q).toHaveLength(1)
    expect(freshQueue([{ text: 'x', to: 'ben', at: '2026-11-01T00:00:00Z' }, ...q], now)).toHaveLength(1)
    expect(basicReason({ online: false, budgetUsedUp: true })).toBe('offline')
    expect(basicReason({ online: true, budgetUsedUp: true, override: true })).toBeNull()
    expect(basicLabel('offline')).toBe('Offline — basic mode')
  })
})

describe('QA4 cost and budget', () => {
  it('sums one answer and names the model that wrote it', () => {
    const m = answerMeta([
      { model: 'deepseek/deepseek-v4.1-pro', kind: 'chat-deep', prompt: 2000, completion: 300, cost: null },
      { model: 'deepseek/deepseek-v4.1-flash', kind: 'chat', prompt: 1800, completion: 200, cost: 0.0004 }
    ])
    expect(m).toEqual({ model: 'deepseek-v4.1-flash', calls: 2, tokens: 4300, cost: 0.0004 })
    expect(costLine(m)).toBe('deepseek-v4.1-flash · 2 calls · 4.3k tokens · $0.0004')
    expect(costLine(answerMeta([]))).toBe('Answered from your data · no AI · $0')
    expect(shortModel('google/gemini-3.5-flash')).toBe('gemini-3.5-flash')
    expect(money(0.00001)).toBe('<$0.0001')
  })
  it('steps down near and at the budget', () => {
    expect(budgetMode({ tier: 'normal', spent: 1, budget: 10 })).toBe('normal')
    expect(budgetMode({ tier: 'save', spent: 8.5, budget: 10 })).toBe('cheap')
    expect(budgetMode({ tier: 'minimal', spent: 10, budget: 10 })).toBe('basic')
    expect(budgetMode({ tier: 'minimal', spent: 10, budget: 10 }, true)).toBe('cheap')
    expect(budgetBar({ spent: 8.5, budget: 10 })).toMatchObject({ level: 'near', fill: 0.85 })
  })
  it('keeps the newest 200 metas', () => {
    let all = {}
    for (let i = 0; i < 205; i++) all = keepMeta(all, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), { model: 'm', calls: 1, tokens: 1, cost: 0 })
    expect(Object.keys(all)).toHaveLength(200)
  })
})
