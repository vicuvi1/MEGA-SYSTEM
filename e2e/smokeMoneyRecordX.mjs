// Split records, your own fields and colour tags, one smoke step (called from
// e2e/smoke.mjs). A 600 MDL shop record is split 400 Food / 200 Home in the
// form: the categories get 400 and 200, the balance moves once. A "Project"
// pick-list field set in the same form filters the Log ("project:website") and
// goes into the export; the #trip tag shows in its colour on the row and in
// Reports → Tags. Made-up data only; the stored copy is put back at the end.
// Page reloads only to load the seeded copy and to put the original back.

export async function moneyRecordXSteps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  await step('Money split, own fields and colour tags: split 400/200, a Project field filters and exports, #trip in colour', async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 16500 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 22000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    const original = await pg.evaluate((k) => localStorage.getItem(k), KEY)
    const seed = () => pg.evaluate((k) => {
      const st = JSON.parse(localStorage.getItem(k) || 'null')
      const d = new Date()
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-rx-'))
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id
      st.tx.push({ id: 'smoke-rx-1', type: 'expense', amount: 60000, currency: st.settings.currency || 'MDL', rate: 1, base: 60000, date: iso, account: acc, category: 'food', note: 'Smoke supermarket', createdAt: Date.now(), updatedAt: Date.now() })
      st.tx.push({ id: 'smoke-rx-2', type: 'expense', amount: 12300, currency: st.settings.currency || 'MDL', rate: 1, base: 12300, date: iso, account: acc, category: 'food', note: 'Smoke kiosk', createdAt: Date.now(), updatedAt: Date.now() })
      st.settings.customFields = [{ id: 'f-smokeproject', name: 'Smokeproject', type: 'pick', options: ['Website', 'App'], kinds: ['expense', 'income'], updatedAt: 1 }]
      st.settings.tagStyles = { ...(st.settings.tagStyles || {}), smoketrip: { color: 3 } }
      st.settings.logView = 'list'
      st.meta = { ...(st.meta || {}), sheetIntro: 1 }
      st.settings.updatedAt = Date.now()
      localStorage.setItem(k, JSON.stringify(st))
    }, KEY)
    const row = '.tx[data-act="edit"][data-id="smoke-rx-1"]'
    // Seed, reload the app and open the Log on the seeded record. A slow start (or a sync that
    // wrote the stored copy meanwhile) gets one more try with the seed written again.
    const seedAndOpen = async () => {
      for (let attempt = 0; ; attempt++) {
        await seed()
        frame = await financeFrame()
        await frame.evaluate(() => location.reload())
        await pg.waitForTimeout(2800)
        try {
          frame = await financeFrame()
          await frame.waitForFunction(() => !!document.querySelector('#app')?.firstElementChild && !!JSON.parse(localStorage.getItem('finance-helper.state') || '{}').tx?.some((t) => t.id === 'smoke-rx-1'), null, { timeout: 11000 })
          await frame.evaluate(() => { location.hash = '#home'; setTimeout(() => { location.hash = '#log' }, 50) })
          await frame.waitForSelector(row, { timeout: 13200 })
          return
        } catch (e) {
          if (attempt >= 1) throw e
        }
      }
    }
    try {
      await seedAndOpen()
      const month = await frame.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
      const read = () => frame.evaluate(async (m) => {
        const M = await import(new URL('./js/model.js', location.href).href)
        const st = M.normalizeState(JSON.parse(localStorage.getItem('finance-helper.state')))
        const s = M.monthSummary(st, m)
        const by = (id) => s.byCategory.find((r) => r.id === id)?.amount || 0
        const t = st.tx.find((x) => x.id === 'smoke-rx-1')
        return { food: by('food'), home: by('home'), expense: s.expense, bal: JSON.stringify(M.accountBalances(st)), splits: t?.splits || null, fields: t?.fields || null, note: t?.note || '' }
      }, month)
      const before = await read()
      await frame.click(row)
      await frame.waitForSelector('[data-testid="rf-split"]', { timeout: 6600 })
      await frame.click('[data-testid="rf-split"]')
      await frame.waitForSelector('[data-testid="rf-split-box"]', { timeout: 5500 })
      await frame.fill('.rf-line[data-i="0"] .rf-amt', '400')
      await frame.selectOption('.rf-line[data-i="0"] .rf-cat', 'food')
      await frame.selectOption('.rf-line[data-i="1"] .rf-cat', 'home')
      await frame.click('.rf-line[data-i="1"] [data-testid="rf-rest"]')
      const left = await frame.textContent('[data-testid="rf-left"]')
      if (!/adds up/i.test(left || '')) throw new Error(`the live counter says "${left}" after "Put the rest here"`)
      if ((await frame.inputValue('.rf-line[data-i="1"] .rf-amt')).replace(/\s/g, '') !== '200') throw new Error('"Put the rest here" did not fill 200')
      await frame.selectOption('#rf-f-f-smokeproject', 'Website')
      await frame.fill('#tx-note', 'Smoke supermarket #smoketrip')
      await frame.click('#tx-form button[type="submit"]')
      await frame.waitForFunction(() => { const st = JSON.parse(localStorage.getItem('finance-helper.state')); return (st.tx.find((x) => x.id === 'smoke-rx-1')?.splits || []).length === 2 }, null, { timeout: 7700 })
      const after = await read()
      if (after.expense !== before.expense) throw new Error(`Spent changed: ${before.expense} -> ${after.expense}`)
      if (after.food !== before.food - 20000 || after.home !== before.home + 20000) throw new Error(`categories are not 400 / 200: food ${before.food} -> ${after.food}, home ${before.home} -> ${after.home}`)
      if (after.bal !== before.bal) throw new Error('the balances changed (a split must move them once)')
      if (after.fields?.['f-smokeproject'] !== 'Website') throw new Error(`the field value was not saved: ${JSON.stringify(after.fields)}`)
      // The Log row: the lines open under it, the tag in its colour.
      await frame.waitForSelector('[data-testid="rx-lines"][data-id="smoke-rx-1"]', { timeout: 6600 })
      const tagColor = await frame.evaluate(() => {
        const btn = document.querySelector('.tx[data-id="smoke-rx-1"]')
        const chip = [...(btn?.querySelectorAll('.rx-tag') || [])].find((x) => x.textContent === '#smoketrip')
        return chip ? chip.getAttribute('style') : null
      })
      if (!tagColor || !tagColor.includes('--c3')) throw new Error(`the #smoketrip chip is missing or not in its colour: ${tagColor}`)
      // Search by the field: only that record.
      await frame.fill('#search', 'smokeproject:website')
      await frame.waitForFunction(() => { const ids = [...document.querySelectorAll('.tx[data-act="edit"][data-id], #tx-table tr[data-id]')].map((e) => e.dataset.id); return ids.length > 0 && ids.every((id) => id === 'smoke-rx-1') }, null, { timeout: 6600 })
      await frame.fill('#search', '')
      // The export has the field's column.
      const exported = await frame.evaluate(async () => {
        const X = await import(new URL('./js/moneyexport.js', location.href).href)
        const M = await import(new URL('./js/model.js', location.href).href)
        const st = M.normalizeState(JSON.parse(localStorage.getItem('finance-helper.state')))
        const rows = X.txRows(st)
        const col = rows[0].indexOf('Field: Smokeproject')
        return col < 0 ? null : rows.find((r) => r[0] === 'smoke-rx-1')?.[col]
      })
      if (exported !== 'Website') throw new Error(`the export has no Smokeproject value: ${exported}`)
      // Reports → Tags: the tag with its part of the spending.
      await frame.evaluate(() => { location.hash = '#tags' })
      await frame.waitForSelector('[data-testid="tag-report-row"][data-tag="smoketrip"]', { timeout: 8800 })
    } finally {
      if (original != null) {
        await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, original])
        const f = await financeFrame()
        await f.evaluate(() => { location.hash = '#home'; location.reload() })
        await pg.waitForTimeout(1650)
      }
    }
  })
}
