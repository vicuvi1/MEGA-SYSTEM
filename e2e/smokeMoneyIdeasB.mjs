// Money ideas B smoke steps (called from e2e/smoke.mjs): the one-line quick add,
// the salary watch, price memory and Ask about your money. Made-up data only:
// the step puts a small seeded Finance Helper state on this device, checks the
// screens against it and puts the old data back at the end (records the steps
// made through the app are removed too). Dates come from the real today.
// Screenshots (1920 wide) go to MONEYIDEASB_SHOTS when it is set.

const KEY = 'finance-helper.state'

export async function moneyIdeasBSteps({ step, pg, open, financeFrame, storedTx }) {
  let original = null
  let origIds = []
  const tag = `b${Date.now().toString(36)}`
  let askMonth = { key: '', label: '' }

  const frameNow = async () => {
    let frame = null
    for (const end = Date.now() + 25000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    return frame
  }
  const reloadFrame = async () => {
    const f = await financeFrame()
    await f.evaluate(() => location.reload())
    await pg.waitForTimeout(2500)
    return frameNow()
  }
  const openFinance = async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    return frameNow()
  }
  const shot = async (loc, name) => { if (process.env.MONEYIDEASB_SHOTS) await loc.screenshot({ path: `${process.env.MONEYIDEASB_SHOTS}/${name}.png` }) }
  const idsNow = async () => (await storedTx()).map((t) => t.id)
  const settle = () => pg.waitForTimeout(1200) // the save waits a moment before it writes

  await step('Money quick add: "120 quokka" saves in the learned category, "3000 salary +" is income, bad input saves nothing, Undo works', async () => {
    await pg.setViewportSize({ width: 1920, height: 1080 })
    let frame = await openFinance()
    await pg.waitForTimeout(1500)
    const seeded = await frame.evaluate(([KEY, tag]) => {
      const pad = (n) => String(n).padStart(2, '0')
      const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const ago = (n) => iso(new Date(Date.now() - n * 864e5))
      const now = new Date()
      // 30 months back, whatever day it is: a month with no real records.
      const old = new Date(now.getFullYear(), now.getMonth() - 30, 1)
      const askKey = `${old.getFullYear()}-${pad(old.getMonth() + 1)}`
      // Anything waiting to be saved goes out first, so the page cannot write its old copy over the seed on reload.
      window.dispatchEvent(new Event('pagehide'))
      const raw = localStorage.getItem(KEY)
      const base = JSON.parse(raw)
      const t = (id, date, amount, extra = {}) => ({ id: `${id}-${tag}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, category: 'food', account: 'card', note: '', createdAt: 1, updatedAt: 1, ...extra })
      const next = {
        ...base,
        // A salary that no record matches (an odd amount), pay day on the 1st: late from the 4th on.
        settings: { ...base.settings, salary: { amount: 98765432, currency: 'MDL', day: 1, account: 'card' }, updatedAt: Date.now() },
        tx: [...base.tx,
          t('mb-1', ago(3), 9000, { category: 'fun', note: 'Quokka' }), t('mb-2', ago(5), 9500, { category: 'fun', note: 'quokka' }), t('mb-3', ago(7), 8800, { category: 'fun', note: 'Quokka' }),
          t('mb-4', ago(9), 14800, { note: 'Linella 23' }), t('mb-5', ago(14), 13200, { note: 'Linella' }), t('mb-6', ago(21), 14100, { note: 'Linella #4411' }),
          t('mb-7', `${askKey}-03`, 30000, { note: 'Shop' }), t('mb-8', `${askKey}-17`, 20000, { note: 'Shop' }),
          t('mb-9', `${askKey}-20`, 50000, { type: 'income', category: 'work', note: 'Old job' }),
        ],
      }
      localStorage.setItem(KEY, JSON.stringify(next))
      setTimeout(() => location.reload(), 0)
      const label = new Date(old.getFullYear(), old.getMonth(), 1).toLocaleString('en-US', { month: 'long' })
      return { raw, askKey, label: `${label} ${old.getFullYear()}`, today: iso(now), day: now.getDate() }
    }, [KEY, tag])
    original = JSON.parse(seeded.raw).settings
    askMonth = { key: seeded.askKey, label: seeded.label }
    await pg.waitForTimeout(2500)
    frame = await frameNow()
    const seenIds = await idsNow()
    if (!seenIds.some((id) => id.endsWith(`-${tag}`))) throw new Error(`the seeded records are gone after a reload (${seenIds.length} records)`)
    origIds = seenIds.filter((id) => !id.endsWith(`-${tag}`))
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.waitForSelector('#qa-input', { timeout: 10000 })

    // Live preview: amount, type, learned category, account, note.
    await frame.fill('#qa-input', '120 quokka')
    await frame.waitForSelector('[data-testid="qa-preview"]', { timeout: 3000 })
    const txt = async (id) => (await frame.locator(`[data-testid="${id}"]`).innerText()).replace(/\s+/g, ' ').trim()
    if (!/^120 MDL$/.test(await txt('qa-amount'))) throw new Error(`amount preview: ${await txt('qa-amount')}`)
    if (!/Expense/.test(await txt('qa-kind'))) throw new Error('the preview does not say Expense')
    if ((await frame.locator('#qa-cat').inputValue()) !== 'fun') throw new Error(`guessed category ${await frame.locator('#qa-cat').inputValue()}, expected fun (what you chose before for quokka)`)
    if (!/quokka/.test(await txt('qa-note'))) throw new Error('the preview does not show the note')
    await shot(frame.locator('main#app'), 'money-ideasB-quick-add')

    const before = (await idsNow()).length
    await frame.press('#qa-input', 'Enter')
    await settle()
    let list = await storedTx()
    if (list.length !== before + 1) throw new Error(`Enter saved ${list.length - before} records, expected 1`)
    const lunch = list.find((x) => !x.id.endsWith(`-${tag}`) && !origIds.includes(x.id))
    if (!lunch || lunch.amount !== 12000 || lunch.type !== 'expense' || lunch.category !== 'fun' || lunch.note !== 'quokka') throw new Error(`saved record: ${JSON.stringify(lunch)}`)
    if ((await frame.locator('#qa-input').inputValue()) !== '') throw new Error('the box is not cleared after saving')

    // Undo from the toast.
    await frame.waitForSelector('#toast button', { timeout: 3000 })
    await frame.click('#toast button')
    await settle()
    if ((await idsNow()).length !== before) throw new Error('Undo did not remove the quick record')

    // Income: "3000 salary +".
    await frame.fill('#qa-input', '3000 salary +')
    if (!/Income/.test(await txt('qa-kind'))) throw new Error('"+" is not income in the preview')
    await frame.press('#qa-input', 'Enter')
    await settle()
    const inc = (await storedTx()).find((x) => !origIds.includes(x.id) && !x.id.endsWith(`-${tag}`))
    if (!inc || inc.type !== 'income' || inc.amount !== 300000) throw new Error(`income record: ${JSON.stringify(inc)}`)
    // A refund: "-300 tech refund" is money back that lowers spending, not income.
    await frame.fill('#qa-input', '-300 tech refund')
    if (!/Refund/.test(await txt('qa-kind'))) throw new Error('a minus is not a refund in the preview')
    await frame.press('#qa-input', 'Escape')
    if ((await frame.locator('#qa-input').inputValue()) !== '') throw new Error('Esc does not clear the box')

    // Bad input saves nothing and says what is missing.
    const count = (await idsNow()).length
    await frame.fill('#qa-input', 'lunch')
    if (!/amount/i.test(await txt('qa-missing'))) throw new Error('no "missing amount" message')
    await frame.press('#qa-input', 'Enter')
    await frame.fill('#qa-input', '120 and 45 lunch')
    await frame.press('#qa-input', 'Enter')
    await settle()
    if ((await idsNow()).length !== count) throw new Error('bad input saved a record')
    // Tab moves to the category; changing it is kept.
    await frame.fill('#qa-input', '50 taxi')
    await frame.press('#qa-input', 'ArrowDown')
    await frame.selectOption('#qa-cat', 'fun')
    await frame.press('#qa-cat', 'Enter')
    await settle()
    const taxi = (await storedTx()).find((x) => x.note === 'taxi')
    if (!taxi || taxi.category !== 'fun') throw new Error(`the category you picked was not kept: ${JSON.stringify(taxi)}`)
  })

  await step('Money salary watch: a "Salary not in yet" card, the settings card, the setting is kept after a reload', async () => {
    let frame = await frameNow()
    const day = new Date().getDate()
    const card = frame.locator('[data-testid="salary-late"]')
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.waitForSelector('[data-testid="quick-add"]', { timeout: 10000 })
    if (day >= 4) {
      if (!(await card.count())) throw new Error(`no "Salary not in yet" card though the pay day (the 1st) + 2 days has passed (day ${day}, ${JSON.stringify(await frame.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.salary, KEY))}, ${(await frame.locator('[data-testid="salary-hourly"]').count())})`)
      if (!/Salary not in yet \(due 1 /.test((await card.innerText()).replace(/\s+/g, ' '))) throw new Error(`card: ${await card.innerText()}`)
    } else if (await card.count()) throw new Error('the salary card shows before pay day + 3')
    await frame.evaluate(() => { location.hash = '#settings' })
    await frame.waitForSelector('[data-testid="salary-settings"]', { timeout: 10000 })
    const amount = await frame.locator('[data-sal="amount"]').inputValue()
    if (amount !== '987654.32') throw new Error(`salary amount in settings: ${amount}`)
    await frame.fill('[data-sal="day"]', '2')
    await frame.press('[data-sal="day"]', 'Tab')
    await settle()
    frame = await reloadFrame()
    const saved = await frame.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.salary, KEY)
    if (!saved || saved.day !== 2 || saved.amount !== 98765432) throw new Error(`salary setting after reload: ${JSON.stringify(saved)}`)
  })

  await step('Money price memory: the usual price for a payee, "Higher than usual", nothing stored', async () => {
    const frame = await frameNow()
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.waitForSelector('[data-act="add"]', { timeout: 10000 })
    const stored = JSON.stringify(await storedTx())
    await frame.click('[data-act="add"]')
    await frame.waitForSelector('#tx-note', { timeout: 5000 })
    await frame.fill('#tx-note', 'Linella')
    await frame.fill('#tx-amount', '140')
    await frame.waitForSelector('[data-testid="price-line"]', { timeout: 3000 })
    const line = (await frame.locator('[data-testid="price-line"]').innerText()).replace(/\s+/g, ' ')
    if (!/^Usually \d+–\d+ at Linella \(last 3: 148, 132, 141\)$/.test(line)) throw new Error(`price line: ${line}`)
    if (await frame.locator('[data-testid="price-high"]').count()) throw new Error('"Higher than usual" shows for a normal price')
    await frame.fill('#tx-amount', '250')
    await frame.waitForSelector('[data-testid="price-high"]', { timeout: 3000 })
    await shot(frame.locator('.sheet'), 'money-ideasB-price-memory')
    await frame.click('.sheet button[data-close]')
    await settle()
    if (JSON.stringify(await storedTx()) !== stored) throw new Error('price memory changed or stored a record')
  })

  await step('Money Ask: the four example questions are answered locally with the right numbers, and open the Log', async () => {
    const frame = await frameNow()
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.waitForSelector('[data-testid="ask-input"]', { timeout: 10000 })
    const ask = async (q) => {
      await frame.fill('[data-testid="ask-input"]', q)
      await frame.press('[data-testid="ask-input"]', 'Enter')
      await frame.waitForSelector('[data-testid="ask-number"], [data-testid="ask-cant"]', { timeout: 3000 })
    }
    const num = async () => (await frame.locator('[data-testid="ask-number"]').innerText()).replace(/\s+/g, ' ').trim()
    const list = await storedTx()
    const month = (t) => t.date.startsWith(askMonth.key)
    const sum = (f) => list.filter(f).reduce((a, t) => a + (t.base ?? t.amount), 0)
    const fmt = (c) => {
      const w = Math.floor(Math.abs(c) / 100)
      const f = Math.abs(c) % 100
      return `${w.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `,${String(f).padStart(2, '0')}` : ''} MDL`
    }
    await ask(`how much on food in ${askMonth.label}?`)
    const foodWant = sum((t) => month(t) && t.type === 'expense' && t.category === 'food' && !t.loan && !t.reconcile && !String(t.id).startsWith('life-reward-')) - sum((t) => month(t) && t.type === 'income' && t.refund === true && t.category === 'food')
    if ((await num()) !== fmt(foodWant) || foodWant < 50000) throw new Error(`food in ${askMonth.label}: "${await num()}", expected ${fmt(foodWant)}`)
    await shot(frame.locator('[data-testid="ask-money"]'), 'money-ideasB-ask')
    await ask(`how much did I earn in ${askMonth.key.slice(0, 4)}`)
    const earnWant = sum((t) => t.date.startsWith(askMonth.key.slice(0, 4)) && t.type === 'income' && !t.loan && !t.reconcile && t.refund !== true)
    if ((await num()) !== fmt(earnWant) || earnWant < 50000) throw new Error(`earned in ${askMonth.key.slice(0, 4)}: "${await num()}", expected ${fmt(earnWant)}`)
    await ask('biggest expense this month')
    if (!(await num()) || !/Biggest expense this month/.test(await frame.locator('[data-testid="ask-detail"]').innerText())) throw new Error('no biggest expense answer')
    await ask('average spending per day last month')
    if (!/ \/ day$/.test(await num())) throw new Error(`average answer: ${await num()}`)
    await ask('what is the weather like')
    if (!/I can answer questions about amounts, categories and months\./.test(await frame.locator('[data-testid="ask-cant"]').innerText())) throw new Error('no honest "can\'t answer" message')
    // Tap to open the Log filtered to the records behind the number.
    await ask(`how much on food in ${askMonth.label}`)
    if (!(await frame.locator('[data-testid="ask-log"]').count())) throw new Error(`no Log button: ${await frame.locator('#ask-out').innerHTML()}`)
    await frame.waitForSelector('[data-testid="ask-log"]', { timeout: 3000 }).catch(async () => { throw new Error(`Log button gone: ${await frame.locator('#ask-out').innerHTML()} | ${await frame.evaluate(() => location.hash)}`) })
    await frame.click('[data-testid="ask-log"]', { timeout: 5000 })
    await frame.waitForSelector('#search', { timeout: 5000 })
    const q = await frame.locator('#search').inputValue()
    if (!/cat:food/.test(q) || !q.includes(`from:${askMonth.key}-01`)) throw new Error(`the Log search is "${q}"`)
  })

  // Put this device's own Finance Helper data back, whatever the steps above did.
  await step('Money ideas B: this device\'s own Finance Helper data is put back', async () => {
    if (original === null) return
    const frame = await financeFrame()
    await pg.waitForTimeout(1500)
    await frame.evaluate(([KEY, settings, tag, keep]) => {
      const s = JSON.parse(localStorage.getItem(KEY))
      const mine = (x) => x.id.endsWith(`-${tag}`) || !keep.includes(x.id)
      s.deleted = { ...(s.deleted || {}) }
      for (const x of s.tx.filter(mine)) s.deleted[x.id] = Date.now()
      s.tx = s.tx.filter((x) => !mine(x))
      if ('salary' in settings) s.settings.salary = settings.salary; else delete s.settings.salary
      s.settings.updatedAt = Date.now()
      localStorage.setItem(KEY, JSON.stringify(s))
    }, [KEY, original, tag, origIds])
    await reloadFrame()
    const left = (await storedTx()).filter((x) => x.id.endsWith(`-${tag}`) || !origIds.includes(x.id)).length
    if (left) throw new Error(`${left} seeded or quick records are still on this device`)
    await pg.setViewportSize({ width: 1440, height: 900 })
  })
}
