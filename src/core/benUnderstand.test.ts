// Ben understands you (LS2–LS6): pure parts. Made-up data only.
import { describe, expect, it } from 'vitest'
import { canon, commandOf, fuzzyFind, normalize, similarity, stripMarks, sureOf } from './benNormalize'
import { mergeParts, partOf, receiptOf, undoLabel } from './benReceipt'
import { bareAdd, isAsk, readClause, splitIntents, timeIn } from './benSplit'
import { addOffer, addPref, aliasMap, cleanKnow, EMPTY_KNOW, forgetPlan, offerQuestion, prefDuration, prefsForPrompt, prefTime, readCorrection, readForget, readOffer, readOfferAnswer, takeOffer } from './benFacts'

const NOW = new Date(2026, 10, 7, 15, 0)

describe('LS3: messy typing', () => {
  it('diacritics or their absence read the same', () => {
    expect(stripMarks('curăță camera')).toBe('curata camera')
    expect(normalize('  Fă-mi   ZIUA!! ')).toBe('fa-mi ziua!!')
    expect(similarity('curata camera', 'Curăță camera')).toBe(1)
  })

  it('Romanian, Russian and slang command words become plain English; names stay', () => {
    expect(canon('fa-mi ziua').text).toBe('plan my day')
    expect(canon('fă-mi ziua te rog').text).toBe('plan my day te rog')
    expect(canon('curata camera azi').text).toBe('curata camera today')
    expect(canon('завтра спортзал в 18').text).toBe('tomorrow gym at 18')
    expect(canon('спланируй мой день').text).toBe('plan my day')
    expect(canon('muta sala la 18').text).toBe('move gym at 18')
    expect(canon('add milk tmrw pls').text).toBe('add milk tomorrow please')
    expect(canon('aminteste-mi sa sun mama la 20').text).toBe('remind me to sun mama at 20')
    expect(canon('plan my day').changed).toBe(false)
    expect(canon('завтра спортзал в 18').lang).toBe('ru')
    expect(canon('curata camera azi').lang).toBe('ro')
  })

  it('his own aliases win over the built-in ones', () => {
    expect(canon('move biblio to 18', { biblio: 'Reading' }).text).toBe('move Reading to 18')
  })

  it('fuzzy names: one clear match acts, two close ones ask, none goes on', () => {
    const names = ['Lab: Programming', 'Gym', 'Reading', 'Deep block']
    expect(fuzzyFind('labortor programing', names, (x) => x)[0]?.item).toBe('Lab: Programming')
    expect(sureOf(fuzzyFind('gim', names, (x) => x)).kind).toBe('none')
    expect(sureOf(fuzzyFind('readng', names, (x) => x))).toMatchObject({ kind: 'one', hit: { item: 'Reading' } })
    const two = sureOf(fuzzyFind('deep', ['Deep block 1', 'Deep block 2', 'Gym'], (x) => x))
    expect(two.kind).toBe('many')
  })

  it('commands typed badly', () => {
    expect(commandOf('pln my dya')).toBe('plan my day')
    expect(commandOf('waht now')).toBe('what now')
    expect(commandOf('buy milk')).toBeNull()
  })
})

describe('LS2: the receipt', () => {
  it('a calendar block and its Todoist task become one part with both places', () => {
    const now = new Date(2026, 10, 7, 20, 0)
    const done = ['🗓 In your calendar: Read 10 min · 11-07 21:40 (10 min)', '➕ Todoist: Read 10 min (2026-11-07)']
    expect(receiptOf(done, now)).toBe("Added 'Read 10 min' at 21:40 · Calendar ✓ Todoist ✓")
  })

  it('several things: one receipt, parts in order; a failure shows ✗', () => {
    const done = ['➕ Todoist: Laundry', '🗓 Moved: Gym → 11-07 18:00', '⏰ Reminder 20:00: Call mom', "⚠️ Google Calendar isn't connected (Settings in the app)"]
    expect(receiptOf(done, NOW)).toBe("Added 'Laundry' · Todoist ✓; Moved 'Gym' at 18:00 · Calendar ✓; Reminder 'Call mom' at 20:00 · Reminders ✓; ✗ Google Calendar isn't connected (Settings in the app)")
  })

  it('tomorrow is said as a word; plain lines are kept short; nothing done gives null', () => {
    expect(partOf('🗓 In your calendar: Gym · 11-08 18:00 (60 min)', NOW)?.when).toBe('tomorrow 18:00')
    expect(receiptOf(['💧 +250 ml · 1.5 of 2.5 L today'], NOW)).toBe('+250 ml · 1.5 of 2.5 L today')
    expect(receiptOf([], NOW)).toBeNull()
    expect(receiptOf(['(nothing saved)'], NOW)).toBeNull()
    expect(mergeParts([{ verb: 'Added', title: 'Gym', where: [{ name: 'Calendar', ok: true }] }, { verb: 'Added', title: 'gym', where: [{ name: 'Todoist', ok: true }] }])).toHaveLength(1)
    expect(undoLabel(3)).toBe('↩ Undo all 3')
    expect(undoLabel(1)).toBe('↩ Undo')
  })
})

describe('LS4: many things in one message', () => {
  it('splits by commas and "and", keeping "milk and eggs" together', () => {
    expect(splitIntents('add laundry, move gym to 18, and remind me to call mom at 20')).toEqual(['add laundry', 'move gym to 18', 'remind me to call mom at 20'])
    expect(splitIntents('add milk and eggs')).toEqual([])
    expect(splitIntents('add milk and eggs and move gym to 18')).toEqual(['add milk and eggs', 'move gym to 18'])
    expect(splitIntents('how was my day and what now')).toEqual([])
  })

  it('reads each clause', () => {
    expect(readClause('add laundry', NOW)).toEqual({ kind: 'add', title: 'Laundry', when: null, dayWord: null })
    expect(readClause('move gym to 18', NOW)).toMatchObject({ kind: 'move', edit: { target: 'gym', value: '18:00' } })
    expect(readClause('remind me to call mom at 20', NOW)).toEqual({ kind: 'remind', text: 'Call mom', when: { day: '2026-11-07', time: '20:00' } })
    expect(readClause('remind me at 20 to call mom', NOW)).toEqual({ kind: 'remind', text: 'Call mom', when: { day: '2026-11-07', time: '20:00' } })
    expect(readClause('add gym tomorrow at 18', NOW)).toEqual({ kind: 'add', title: 'Gym', when: { day: '2026-11-08', time: '18:00' }, dayWord: 'tomorrow' })
    expect(readClause('think about life', NOW)).toBeNull()
  })

  it('a bare thing with a day is an add; questions and chat are not', () => {
    expect(bareAdd('curata camera today', NOW)).toMatchObject({ kind: 'add', title: 'Curata camera', dayWord: 'today' })
    expect(bareAdd('tomorrow gym at 18', NOW)).toMatchObject({ kind: 'add', title: 'Gym', when: { day: '2026-11-08', time: '18:00' } })
    expect(bareAdd('what about today?', NOW)).toBeNull()
    expect(bareAdd('i am tired today', NOW)).toBeNull()
    expect(bareAdd('water 500 today', NOW)).toBeNull()
  })
})

describe('LS5: unclear times ask instead of guessing', () => {
  it('"at 8" at 07:00 could be 08:00 or 20:00: ask; at 15:00 it is 20:00; "tonight at 8" is 20:00', () => {
    const morning = new Date(2026, 10, 7, 7, 0)
    const a = timeIn('remind me to call mom at 8', morning)
    expect(isAsk(a) && a.options.map((o) => o.time)).toEqual(['08:00', '20:00'])
    expect(timeIn('at 8', NOW)).toEqual({ day: '2026-11-07', time: '20:00' })
    expect(timeIn('tonight at 8', morning)).toEqual({ day: '2026-11-07', time: '20:00' })
    expect(timeIn('at 3', morning)).toEqual({ day: '2026-11-07', time: '15:00' })
    expect(timeIn('at 6pm', morning)).toEqual({ day: '2026-11-07', time: '18:00' })
    expect(timeIn('in 30 min', NOW)).toEqual({ day: '2026-11-07', time: '15:30' })
  })
})

describe('LS6 + ME1: corrections and memory', () => {
  it('reads durations, default times and aliases in three languages', () => {
    expect(readCorrection('no, curata camera takes 40 min')).toEqual({ kind: 'duration', key: 'curata camera', label: 'curata camera', value: 40 })
    expect(readCorrection('Curăță camera durează 40 min')).toMatchObject({ kind: 'duration', key: 'curata camera', value: 40 })
    expect(readCorrection('the essay takes 2 hours')).toMatchObject({ kind: 'duration', key: 'essay', value: 120 })
    expect(readCorrection('gym is always at 18')).toEqual({ kind: 'time', key: 'gym', label: 'gym', value: '18:00' })
    expect(readCorrection('спортзал всегда в 18')).toMatchObject({ kind: 'time', key: 'спортзал', value: '18:00' })
    expect(readCorrection('by biblio I mean Reading')).toMatchObject({ kind: 'alias', key: 'biblio', value: 'reading' })
    expect(readCorrection('how long does the essay take?')).toBeNull()
    expect(readCorrection('it takes 40 min')).toBeNull()
  })

  it('saves them (the newest wins) and the planner and router can read them', () => {
    let k = EMPTY_KNOW
    k = addPref(k, readCorrection('curata camera takes 30 min')!, 'app', NOW).know
    const r = addPref(k, readCorrection('no, curata camera takes 40 min')!, 'telegram', NOW)
    expect(r.prev?.value).toBe(30)
    k = addPref(r.know, readCorrection('gym is always at 18')!, 'app', NOW).know
    k = addPref(k, readCorrection('by biblio I mean Reading')!, 'app', NOW).know
    expect(k.prefs).toHaveLength(3)
    expect(prefDuration(k, 'Curăță camera')).toBe(40)
    expect(prefDuration(k, 'Laundry')).toBeNull()
    expect(prefTime(k, 'Gym')).toBe('18:00')
    expect(aliasMap(k)).toEqual({ biblio: 'reading' })
    expect(prefsForPrompt(k, 'plan my day', 'plan')).toContain('curata camera takes 40 min')
    expect(prefsForPrompt(k, 'how are you', 'chat')).toBe('')
    expect(cleanKnow(JSON.parse(JSON.stringify(k))).prefs).toHaveLength(3)
  })

  it('offers: a shift becomes a question; Yes/No answers are read; nothing is saved without Yes', () => {
    const o = readOffer('my shift is 17-24')
    expect(o).toEqual({ kind: 'work', text: 'Your shift is 17:00–24:00', work: { from: '17:00', to: '24:00' } })
    expect(offerQuestion(o!)).toBe('Remember that your shift is 17:00–24:00?')
    expect(readOffer('lucrez 17-24 weekdays')?.work).toEqual({ from: '17:00', to: '24:00', days: [1, 2, 3, 4, 5] })
    expect(readOffer('my sister is ana')?.text).toBe('Your sister is Ana')
    expect(readOffer('is my shift 17-24?')).toBeNull()
    const a = addOffer(EMPTY_KNOW, o!, 'app', NOW)
    expect(addOffer(a.know, o!, 'app', NOW).offer).toBeNull()
    expect(readOfferAnswer(`Yes, remember it (${a.offer!.id})`)).toEqual({ id: a.offer!.id, yes: true })
    expect(readOfferAnswer(`No, don't remember it (${a.offer!.id})`)).toEqual({ id: a.offer!.id, yes: false })
    expect(takeOffer(a.know, a.offer!.id).know.offers).toHaveLength(0)
  })

  it('forget everything about X: every place, but never a pinned fact', () => {
    expect(readForget('forget everything about Ana')).toBe('Ana')
    expect(readForget('uita tot despre Ana')).toBe('Ana')
    const plan = forgetPlan(
      {
        facts: [{ t: 'Ana is his sister' }, { t: 'Ana studies law', pin: true }, { t: 'Likes coffee' }],
        prefs: [],
        offers: [{ id: 'o1', text: 'Your sister is Ana', kind: 'person', src: 'app', at: '' }],
        people: [{ name: 'Ana', who: 'sister' }],
        goals: [{ text: 'Pass algebra' }],
        blockLines: [{ block: 'People', line: 'Ana: sister, calls on Sundays' }]
      },
      'ana'
    )
    expect(plan.facts).toEqual(['Ana is his sister'])
    expect(plan.offers).toEqual(['o1'])
    expect(plan.people).toEqual(['Ana'])
    expect(plan.goals).toEqual([])
    expect(plan.total).toBe(4)
  })
})
