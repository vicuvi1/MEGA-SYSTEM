// Money v2 phase 3 smoke steps (called from e2e/smoke.mjs, kept here so the
// big file only gains one line): a tax tag on a record and on several at once,
// then the year summary (not-advice line, tiles, estimate, per book, month by
// month), then the accountant export (one .xlsx with Entries and Totals).
// Made-up data only (the seeded Finance Helper records). Every tag set here is
// put back at the end, so later steps see the data as it was.
import { readFileSync } from 'node:fs'

export async function taxSteps({ step, pg, open, financeFrame, storedTx }) {
  await step('Money taxes: a tax tag on one record and on several, the year summary, the accountant export, a receipt kept on this device', async () => {
    await open('money')
    // The Money hub, or Finance Helper already open from an earlier step.
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    // The first open of Finance Helper takes a moment longer (a slow Windows runner even more).
    let frame = null
    for (const end = Date.now() + 20000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    await frame.evaluate(() => { location.hash = '#taxes' })
    await frame.waitForSelector('[data-testid="tax-not-advice"]', { timeout: 10000 })
    if (!/Not tax advice: check with an accountant\./.test(await frame.locator('[data-testid="tax-not-advice"]').first().innerText())) throw new Error('no "Not tax advice" line')
    if (!(await frame.locator('.subtabs a[aria-current="page"]', { hasText: 'Taxes' }).count())) throw new Error('Taxes is not a tab under Reports')
    const year = Number((await frame.locator('header.top h1').innerText()).replace(/\D/g, ''))
    // 1. Tax tags. "All" lists this year's income and costs.
    await frame.click('[data-act="tax-filter"][data-f="all"]')
    await frame.waitForSelector('.tax-records .tax-list li', { timeout: 5000 })
    const pick = await frame.evaluate(() => {
      const rows = [...document.querySelectorAll('.tax-records .tax-list li')]
      const inc = rows.find((li) => li.querySelector('.amount.income'))
      const costs = rows.filter((li) => !li.querySelector('.amount.income')).slice(0, 2)
      return { inc: inc?.dataset.id, costs: costs.map((li) => li.dataset.id) }
    })
    if (!pick.inc || pick.costs.length < 2) throw new Error(`not enough records this year to tag (${JSON.stringify(pick)})`)
    const tagOf = async (id) => (await storedTx()).find((t) => t.id === id)?.tax
    const waitTag = (id, tag) => pg.waitForFunction(([id, tag]) => JSON.parse(localStorage.getItem('finance-helper.state') || '{"tx":[]}').tx.find((t) => t.id === id)?.tax === tag, [id, tag], { timeout: 6000 })
    // One record: its own select.
    await frame.selectOption(`[data-taxone="${pick.inc}"]`, 'taxable')
    await waitTag(pick.inc, 'taxable').catch(async () => { throw new Error(`the income record was not tagged (${await tagOf(pick.inc)})`) })
    // Several at once: tick, pick the tag, Set.
    await frame.click('[data-act="tax-filter"][data-f="all"]')
    for (const id of pick.costs) await frame.check(`[data-taxsel="${id}"]`)
    await frame.selectOption('[data-taxbulkpick]', 'deductible')
    await frame.click('[data-testid="tax-apply"]')
    for (const id of pick.costs) await waitTag(id, 'deductible').catch(async () => { throw new Error(`a ticked cost was not tagged (${await tagOf(id)})`) })
    // 2. The summary: tiles, the entrepreneur estimate, per book, 12 months.
    await frame.waitForFunction(() => /\d/.test(document.querySelector('[data-tax="taxable"]')?.textContent || '') && !/^0\s/.test((document.querySelector('[data-tax="deductible"]')?.textContent || '').trim()), null, { timeout: 5000 })
    const sum = await frame.evaluate(() => ({
      taxable: document.querySelector('[data-tax="taxable"]')?.textContent || '',
      deductible: document.querySelector('[data-tax="deductible"]')?.textContent || '',
      estimate: document.querySelector('[data-testid="tax-estimate"]')?.textContent || '',
      books: [...document.querySelectorAll('.tax-books tbody tr')].map((r) => r.cells[0].textContent),
      months: document.querySelectorAll('.tax-months tbody tr').length,
    }))
    if (!/[1-9]/.test(sum.taxable) || !/MDL/.test(sum.taxable)) throw new Error(`taxable income tile: ${sum.taxable}`)
    if (!/[1-9]/.test(sum.deductible)) throw new Error(`deductible costs tile: ${sum.deductible}`)
    if (!/Individual entrepreneur/.test(sum.estimate) || !/12%/.test(sum.estimate)) throw new Error(`no entrepreneur estimate: ${sum.estimate.slice(0, 160)}`)
    if (sum.books[0] !== 'Personal') throw new Error(`per-book table: ${sum.books.join(', ')}`)
    if (sum.months !== 12) throw new Error(`month by month has ${sum.months} rows`)
    if (process.env.TAX_SHOTS) {
      await frame.locator('[data-testid="tax-summary"]').scrollIntoViewIfNeeded()
      await pg.waitForTimeout(500)
      await pg.screenshot({ path: `${process.env.TAX_SHOTS}/money-taxes.png` })
    }
    // Totals in USD too (at today's rate), then back to MDL.
    await frame.click('[data-act="tax-cur"][data-cur="USD"]')
    await frame.waitForFunction(() => /USD|no USD rate/.test(document.querySelector('[data-tax="taxable"]')?.textContent || ''), null, { timeout: 4000 })
    await frame.click('[data-act="tax-cur"][data-cur="MDL"]')
    // 3. The accountant export: one .xlsx, Entries + Totals, only the tagged records.
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), frame.click('[data-testid="tax-export"]')])
    if (dl.suggestedFilename() !== `taxes-${year}-for-accountant.xlsx`) throw new Error(`file name ${dl.suggestedFilename()}`)
    const buf = readFileSync(await dl.path())
    if (buf.toString('latin1', 0, 2) !== 'PK') throw new Error('the export is not an xlsx (zip)')
    const xml = buf.toString('utf8')
    for (const w of ['Entries', 'Totals', 'Receipt link', 'Tax tag', 'Not tax advice: check with an accountant.', 'Taxable income', 'Deductible cost']) if (!xml.includes(w)) throw new Error(`the export has no "${w}"`)
    const entryRows = (/<sheetData>(.*?)<\/sheetData>/s.exec(xml)?.[1].match(/<row /g) || []).length
    if (entryRows !== 4) throw new Error(`the Entries sheet has ${entryRows - 1} records, want the 3 tagged ones`)
    // Put the tags back (the category default: no tag), so later steps see the data as it was.
    await frame.click('[data-act="tax-filter"][data-f="tagged"]')
    for (const id of [pick.inc, ...pick.costs]) {
      if (!(await frame.$(`[data-taxone="${id}"]`))) await frame.click('[data-act="tax-filter"][data-f="all"]')
      await frame.selectOption(`[data-taxone="${id}"]`, 'auto')
      await pg.waitForFunction((id) => !('tax' in (JSON.parse(localStorage.getItem('finance-helper.state') || '{"tx":[]}').tx.find((t) => t.id === id) || {})), id, { timeout: 6000 })
    }
    // 4. A receipt on a cost, from its edit sheet: Life keeps it on this device (Drive is not
    // connected here), the record holds only its id, and editing the record keeps it.
    await frame.evaluate(() => { location.hash = '#log' })
    await frame.waitForFunction(() => location.hash === '#log', null, { timeout: 5000 })
    const costId = pick.costs[0]
    // Open its edit sheet the way a record row does (data-act="edit"), whichever month it is in.
    const openEdit = (id) => frame.evaluate((id) => { const b = document.createElement('button'); b.dataset.act = 'edit'; b.dataset.id = id; document.getElementById('app').appendChild(b); b.click(); b.remove() }, id)
    await openEdit(costId)
    await frame.waitForSelector('.sheet [data-testid="rc-add"]', { timeout: 5000 })
    if (!(await frame.$('.sheet [data-sheettax]'))) throw new Error('the record sheet has no tax tag choice')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await frame.setInputFiles('.sheet [data-rcfile]', { name: 'made-up-receipt.png', mimeType: 'image/png', buffer: png })
    const rid = await pg.waitForFunction((id) => JSON.parse(localStorage.getItem('finance-helper.state') || '{"tx":[]}').tx.find((t) => t.id === id)?.receipts?.[0] || null, costId, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => null)
    if (!rid || !/^r-/.test(rid)) throw new Error('the receipt id did not reach the record')
    await frame.waitForSelector(`.sheet .rc-chip.local[data-rid="${rid}"]`, { timeout: 8000 }).catch(async () => { throw new Error(`the receipt does not say it waits for Google Drive: ${await frame.locator('.sheet .rc-row').innerText().catch(() => '')}`) })
    // Kept on this device by Life (IndexedDB life-receipts), never in Finance's data.
    const kept = await pg.evaluate((rid) => new Promise((ok) => { const r = indexedDB.open('life-receipts', 1); r.onsuccess = () => { const g = r.result.transaction('items').objectStore('items').get(rid); g.onsuccess = () => ok(!!g.result?.blob); g.onerror = () => ok(false) }; r.onerror = () => ok(false) }), rid)
    if (!kept) throw new Error('the receipt is not kept on this device')
    if (/data:image|base64/.test(await pg.evaluate(() => localStorage.getItem('finance-helper.state') || ''))) throw new Error('image data went into Finance Helper\'s data')
    // Save the record: the receipt id stays.
    await frame.click('.sheet button[type="submit"]')
    await pg.waitForTimeout(600)
    if (((await storedTx()).find((t) => t.id === costId)?.receipts || [])[0] !== rid) throw new Error('saving the record dropped its receipt')
    // Take it off again (the file stays): the record is as it was.
    await openEdit(costId)
    await frame.waitForSelector(`.sheet [data-rc="remove"][data-rid="${rid}"]`, { timeout: 5000 })
    await frame.click(`.sheet [data-rc="remove"][data-rid="${rid}"]`)
    // The first tap asks, the second takes it off.
    if ((await storedTx()).find((t) => t.id === costId)?.receipts?.[0] !== rid) throw new Error('one tap took the receipt off without asking')
    await frame.click(`.sheet [data-rc="remove"][data-rid="${rid}"]`)
    await pg.waitForFunction((id) => !('receipts' in (JSON.parse(localStorage.getItem('finance-helper.state') || '{"tx":[]}').tx.find((t) => t.id === id) || {})), costId, { timeout: 6000 })
    await frame.click('.sheet .icon-btn[data-close]').catch(() => {})
  })
}
