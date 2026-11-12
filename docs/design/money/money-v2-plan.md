# Money v2: design and build plan for phases 2–5

> Status: plan only (2026-11-12). Nothing here is built yet. Phase 1 (monthly reconciliation,
> CSV/XLSX export and import, totals proven by tests, and the data-safety layer) is being built
> on `money-trust-phase1`; this plan builds on top of it and does not change it.
> Wireframes: [wireframes.md](wireframes.md). Area doc: [../../areas/rewards-money.md](../../areas/rewards-money.md).
> Every example below uses made-up data.

**What the owner asked for:** Money is his money tool for life and business, for decades. That gives two
rules that come before every feature in this plan:
1. **No phase may lose, double or quietly change a record.** That covers every device and every app
   version still out there (an older Windows build, the server's bot bundle, Finance Helper's own
   Drive sync).
2. **Every phase is optional and switched off until he turns it on.** With the new parts off, all
   totals stay exactly what they are today, and a test proves it.

---

## 0. Where the data lives today (what this plan has to respect)

| Data | Where | How it merges | Who writes it |
|---|---|---|---|
| Finance Helper state (`tx`, `people`, `recurring`, `invoices`, `netWorth`, `goals`, `goalAllocations`, `deleted`, `settings`) | the browser's `finance-helper.state`, shared as `settings.app_sync_finance` in Turso, plus Finance's own Drive file (`drive.appdata`) | `sync.js mergeStates`: the newest copy of each record wins (by `updatedAt`), deletions stick (`deleted[id]`). Settings scalars come from whichever settings copy is newer. Settings lists (`accounts`, `categories`, `jars`, `subcats`) merge with `mergeList` | the Finance page (iframe), `web/financeBot.ts` (Telegram, **also bundled into `api/_bot/bot.mjs`**), `web/financeInbox.ts` |
| Telegram inbox | `settings.finance_inbox_json` | by id; dropped only once Finance has it | the server and the bot |
| Photo Locker index | `settings.vault_index` | `mergeIndex` (the later change wins, a known Drive link is never lost, a tombstone wins) | Life host |

What the code shows, and why it matters for this plan:
- **`normalizeState` keeps unknown fields on records and in settings, but drops unknown top-level keys.**
  It spreads `...t`, `...r`, `...i`, `...a` and `...s`, yet the object it returns lists the top-level
  keys by name, and so does `toCloud`. An older build (the desktop before its update, or a bot bundle
  that was not rebuilt) would quietly drop any **new top-level collection** the next time it saves.
- **Life's sync does not pass on the schema number.** `financeSync.ts remote()` stamps the *local*
  `SCHEMA_VERSION` on the other side's copy, so the "saved by a newer version" guard in `mergeStates`
  never fires through Life's sync. It only works for Finance's own Drive sync.
- **The server writes the whole blob.** `financeBot.save` writes `toCloud(normalizeState(...)).data`,
  so a stale `bot.mjs` acts as an "old client" after every Telegram message.
- **Most of what phase 2 needs already exists in some form:**
  - `ACCOUNT_KINDS` already has `business`.
  - `isWorkIncome`, `isWorkCost` and `personalMonth` split work money from personal money.
  - `payyourself.js` already does salary transfers (`t.salary`), with a buffer account and runway.
  - `invoices.js` already has `clientStats` and `invoiceStatus`, which knows "overdue".
  - `workhours.js` already has `hourlyRate`.
  - `yearreview.js` already has a `taxSummary` of income.
  - `settings.rules` and `subMemory` already learn merchants.
  - `recurring.js` already has `dueItems`, `auto`, and fixed ids (`rec-<rule>-<date>`).

## 1. Key design decisions (with the options weighed)

### D1. No new top-level keys in the Finance blob (forward-compatible by construction)
- **Options:**
  - (a) Add new top-level collections (`receipts`, `inbox`, `taxTags`) and bump the schema.
  - (b) Keep all new data as optional fields on existing records, plus keys inside `settings`.
    Bigger new data goes into separate Life settings keys outside the blob.
  - (c) Change `normalizeState` to pass unknown top-level keys through.
- **Pick: (b), with (c) added as a belt-and-braces safety net.** Today's code (v3) already keeps
  unknown fields on records and in settings. So none of the phase 2–5 data can be dropped by an old
  desktop build or a stale bot bundle, and that holds from day one without waiting for every device
  to update.
- Option (c) ships in step 2.0 so that any later mistake is also survivable.
- **What stays in the blob:**
  - fields on `tx`, accounts, categories, recurring rules and people;
  - `settings.books`, `settings.tax`, `settings.rules` (already there) and `settings.captureAccounts`.
- **What goes outside the blob:**
  - receipt metadata, in Life `settings.money_receipts`;
  - the phone capture "to sort" inbox, in Life `settings.money_tosort`.
  - Both are written only by the Life host or the server, with their own merge rules (D6, D9).

### D2. Finance `SCHEMA_VERSION` stays 3 through phases 2–5
- Each addition is an optional field that v3 code keeps and can ignore. So a bump would only make
  older Finance Drive-sync clients refuse to sync, for no safety gain.
- A bump is needed only if a later change makes old code *misread* data. No phase here does that:
  an old build shows the "Both" view, which is today's app.
- Step 2.0 also makes Life's sync pass on the real schema (`share` adds `_schema`, `merge` checks it),
  so a future v4 is protected on both sync paths.
- **Blob version marker for humans and support:** `settings.v2` = `{ books: 1, tax: 1, learn: 1 }`.
  It records which features have ever been turned on. It is informational only and is never used to
  skip data.

### D3. A record's book comes from its account unless the record says otherwise
- **Options:**
  - (a) A book field written on every record (a migration writes thousands of records).
  - (b) The book on the account only (fails for a card used for both).
  - (c) The book on the category only (income and costs become ambiguous).
  - (d) The account sets the default, and a record can override it.
- **Pick (d):**
  - `bookOfAccount(a) = a.book || 'personal'`
  - `bookOf(state, t) = t.book || bookOfAccount(account of t)`
- What this gives:
  - **All existing data is Personal with zero writes**, because no account has a `book`.
  - Marking one account Business is a single field change (one undo).
  - A record is only written when it differs from its account (for example, a business tool paid
    with a personal card).
  - Moving records sets or clears `t.book` and keeps `t.moved = {from, at, batch}`, so "Undo move"
    can put them back exactly.
- Book ids are strings. v2 ships exactly two, `personal` and `business`, listed in `settings.books`.
  The model allows more later without a migration; the UI shows only two.
- Categories get `book: 'personal' | 'business' | 'both'`. When it is missing, the category shows in
  both books, so nothing hides by surprise.
- Budgets:
  - `category.budget` stays the Personal budget, so old builds keep working.
  - `category.budgetBiz` is the Business budget.

### D4. Book views are read-only, derived states, and every existing report runs on them unchanged
- `bookView(state, book)` returns a frozen, shallow copy whose `tx` and accounts are those of the book.
  Cross-book money becomes **synthetic** records marked `synthetic` with `of: <real id>`:

| Real record | Personal view | Business view | Both view |
|---|---|---|---|
| Transfer business → personal (**pay yourself / draw**, including today's `t.salary`) | income "From your business" (counts as personal income) | transfer out, "Paid to you" line, **not a cost** | plain transfer (not income, not spending) |
| Transfer personal → business (**put money in**) | transfer out, "Put into business" line, not spending | transfer in, "Owner money in", not income | plain transfer |
| Business expense paid with a personal account | transfer out (balance moves, not spending), "Paid for business" line | the expense (a cost); the account is outside the view, so no balance effect | the expense, once |
| Business income received into a personal account | income "From your business" (a draw) | the income; the account is outside the view | the income, once |
| Personal expense paid from a business account | expense | transfer out "Paid to you" (a draw), not a cost | the expense, once |

- **"Both" is today's app.** It is the full state with no synthetic records.
- **Writes never go to a view:**
  - `store.save` refuses a state with `_view`.
  - Synthetic rows open the *real* record when tapped (the lookup is by `of` in `ctx.state`).
- Invariants, proven by tests for random states:
  1. Each account's balance in its own book's view equals its balance in Both.
  2. Both external income = Personal external income + Business external income (draws and
     owner money are left out).
  3. Both spending = Personal spending + Business costs.
  4. In no view are a draw and its source income both counted as income. (This is the "never
     double-counted" rule.)
  5. With no `book` anywhere, Personal view = Both = today, and every report is equal.
- `personalMonth` (used by jars, `expectedIncome` and `suggestSalary`) keeps today's logic while
  books are off. Once books are on, it is computed from the Personal view. That is the single place
  where the switch happens.

### D5. The switch is per device; Personal is the default
- Finance Helper adds `ui.book` (device-only, added to `LOCAL_SETTINGS` like `logView`).
- The Life Money page adds `localStorage money_book`.
- Ben, Today's spending pill, Safe to spend and points always use the **Personal** view once books
  are on. Business money is never "spending" for no-spend days or the fun budget.

### D6. Receipts: device to the owner's Drive, metadata outside the blob, Money owns the upload
- Finance runs in an iframe. It sends the file to the Life host (`FINANCE_RECEIPT_ADD`, same origin,
  an ArrayBuffer).
- The host does three things:
  1. It shrinks images (reusing `vault/mediaPrep.ts`; EXIF is dropped, so no location is kept).
  2. It keeps a copy in IndexedDB `life-receipts`.
  3. It uploads to a folder the app makes in his Drive (`Receipts/<year>`), with `drive.file`, the
     same key route as Photo Locker (`/api/google {op:'driveToken'}`) and
     `appProperties {lsApp:'receipt', lsId, lsTx}`.
- **The file never touches our server.**
- The record keeps only ids: `t.receipts = ['r-…']`.
- Metadata goes in Life `settings.money_receipts`: name, type, size, sha256, driveId, uploadedAt and
  tombstones. It merges like `vault_index`: the later change wins, a known driveId is never lost, a
  tombstone wins.
- Receipt upload is **Money's** job in `core/modules.ts`, so it runs even while Photo Locker is off.
  Photo Locker's own uploads stay Photo Locker's.

### D7. Tax numbers are data, dated, sourced and editable; every screen says "not tax advice"
- `taxprofiles.js` holds year-stamped profiles. Each has a `checked` date and `source` links.
- The owner's overrides live in `settings.tax`.
- Rates are stored as whole basis points (`1200` = 12%) and money in bani. There are no floats in
  stored data.
- The default profile is `none`: it shows tagged totals and no estimate.

### D8. Learned rules are derived, not stored; only explicit rules are stored
- Merchant → category, subcategory and book confidence is computed from his own records each time
  (cached like `wordStats`). Nothing learned needs syncing or can clash.
- Explicit rules stay in `settings.rules`. From phase 5 they become a merged list: ids, `updatedAt`,
  and tombstones in `deleted`.

### D9. Phone capture lands in an inbox, never straight into the books
- A captured payment is an inbox item in Life `settings.money_tosort` until he taps a category. Only
  then does it become a record, with the fixed id `cap-<itemId>`. Two devices sorting the same item
  therefore make one record.
- **Honest points:**
  - A captured or auto-logged record counts as "logged on the day" only by its `confirmedAt` (his tap),
    never by its `createdAt` (`core/moneyDays.ts`).
  - An unconfirmed one counts as imported.

---

## 2. Data model changes (complete list)

All fields are optional. "Missing" always means today's behaviour.

### 2.1 Inside the Finance blob (`finance-helper.state` / `app_sync_finance`)

| Where | Field | Phase | Meaning when missing | Merge |
|---|---|---|---|---|
| `settings.books` | `{ on: bool, list: [{id:'personal',name}, {id:'business',name}], updatedAt }` | 2 | books off | settings scalar (newer settings wins); it is one small object edited rarely |
| account | `book: 'personal'\|'business'` | 2 | personal | per account, `mergeList` (already) |
| category | `book: 'personal'\|'business'\|'both'`, `budgetBiz` (bani) | 2 | shown in both books, no business budget | per category, `mergeList` (already) |
| `tx` | `book` (only when it differs from the account) | 2 | the account's book | per record, newest `updatedAt` (already) |
| `tx` | `moved: {from, at, batch}` | 2 | never moved | per record |
| transfer `tx` | `draw: true` (marks an owner draw even inside one book, optional) | 2 | worked out from the account books | per record |
| recurring rule | `book` | 2 | the rule account's book | per rule |
| `settings.tax` | `{ profile, year overrides: {'2026': {...}}, tags: [{id,name,kind}], set: {pct} }` | 3 | profile `none`, the built-in tags | settings scalar |
| category | `tax: <tag id>` | 3 | untagged | per category |
| `tx` | `tax: <tag id>` (override) | 3 | the category's tag | per record |
| `tx` | `receipts: ['r-…']` | 3 | no receipt | per record (a list of ids; the newest record wins, which is enough because one person attaches) |
| invoice | `tax` | 3 | the payment record's tag | per invoice |
| `settings.rules[]` | adds `updatedAt`, `book?`, `sub?`, `tax?`, `account?`, `min?`/`max?` (amount band) | 5 | as today | **becomes `mergeList` plus tombstones** (today it is a whole-scalar) |
| `tx` | `source: 'auto'\|'capture'\|…` (already used for `bank`/`import`), `confirmedAt`, `catBy: 'you'\|'rule'\|'learned'\|'auto'` | 5 | a hand-made record | per record |
| recurring rule | `confirm: true` (auto-log, then ask) | 5 | today's `auto` behaviour | per rule |
| `settings.captureAccounts` | `{ maib: accId, gwallet: accId, revolut: accId }` | 5 | ask on the first sort | settings scalar |
| `settings.v2` | `{books, tax, learn}` levels (informational) | 2–5 | none on | settings scalar |

Nothing new at the top level. No change to the Life SQL schema (`src/core/schema.ts`), so no
`SCHEMA_VERSION` bump in `api/_schema.mjs`.

### 2.2 New Life settings keys (register in `src/core/settingsKeys.ts`)

| Key | Phase | Shape | Merge | Cap |
|---|---|---|---|---|
| `money_receipts` | 3 | `{ folderId?, items: { [rid]: { tx, name, mime, size, sha, driveId?, uploadedAt?, gone?, updatedAt } } }` | `core/receiptIndex.ts mergeReceipts` (vault rules), always read → merge → write | 400 KB; old tombstones go first; a live item is never dropped |
| `money_tosort` | 5 | `{ items: [{ id, at, source, amount, currency, merchant, raw?, kind, state:'new'\|'sorted'\|'dismissed', txId?, dupOf?, updatedAt }] }` | `core/moneyToSort.ts mergeToSort`: by id; the state only moves forward (`new` → `sorted`/`dismissed`); later `updatedAt` wins inside a state | `new` items are kept for ever (warn from day 50, like the inbox). Sorted/dismissed items go after 30 days once Finance has `txId` (or it is deleted there) |

Both are written only through read-merge-write helpers (like `life.vault.saveIndex`). The desktop
offline merge therefore sees whole, already-merged values.

### 2.3 Versioning and migration steps (append-only, reversible)
There is **no data migration that rewrites records**. Each phase is turned on by a setting, and each
bulk change is a reviewed, undoable batch:

| Step | What changes | How to undo it | Safety |
|---|---|---|---|
| 2.0 | Code only: unknown top-level keys pass through `normalizeState`/`toCloud`/`mergeStates` (kept in `state.extra`, written back as they were); Life's sync passes on `_schema` | revert the code; data untouched | the frozen v3 old-client test (§7) |
| 2.1 | Settings → Books → "Use business books" sets `settings.books.on` | switch off: every view returns to today; fields stay | invariant 5 |
| 2.2 | "Make this account Business" sets `account.book` (the sheet shows "214 past records move to Business") | Undo toast, or set it back to Personal | phase 1 safety snapshot first |
| 2.3 | "Move to Business/Personal" on selected records sets or clears `t.book`, writes `t.moved` with one `batch` id | "Undo move" restores `t.moved.from` for the batch, unless a record was edited after the move (that one keeps the edit, like re-price) | snapshot first |
| 2.4 | "Add business categories" **only adds** starter categories (`book:'business'`) | delete them (a category in use cannot be deleted, as today) | add-only |
| 3.1 | Tax profile and tags in `settings.tax`; tagging categories (one tap per category) | clear the tag | totals unchanged (tags do not change money) |
| 5.1 | Rules get `updatedAt`. On the first phase 5 save, rules without it get `updatedAt = settings.updatedAt` (in memory, saved with the next normal save) | not needed (an added field) | the merge test with an old copy |

"Phase 1 safety snapshot" means phase 1's data-safety layer (a saved copy before any bulk change).
Phases 2–5 call it and **never add a second backup mechanism**. If its API name differs from what this
plan assumes, use the real one.

### 2.4 Sync merge per new field (summary)
- Record fields (`book`, `moved`, `tax`, `receipts`, `source`, `confirmedAt`, `catBy`): the whole
  record follows the existing rule (the newest `updatedAt` wins, deletions stick). Every write that
  changes one of them must `touch` the record. A test checks each new writer.
- `settings.books`, `settings.tax`, `settings.captureAccounts` and `settings.v2`: whole-object, from
  the newer settings. These are rare, single-person edits. A test covers "an old client edits another
  setting and keeps `books`".
- `settings.rules` (phase 5): `mergeList` plus tombstones. Old clients still treat it as a scalar, so
  an old client's save can bring back a stale list. New clients merge by id and drop tombstoned ids,
  so no rule is lost and no deleted rule returns. (Test: "old client stale rules list".)
- `money_receipts` and `money_tosort`: their own pure merges (D6, D9).

---

## 3. Phase 2: business and personal books (estimate **L**)

### User stories
1. As the owner, I switch Personal / Business / Both at the top of Finance Helper and of the Money page,
   and every list, total, budget and report follows.
2. I mark my business account(s) as Business once, and their past records move with one undoable step.
3. When I log a cost, the book comes from the account. One tap changes it (a tool paid with my
   personal card is still a business cost).
4. On the Business view I see:
   - this month's profit;
   - income per client;
   - unpaid and overdue invoices;
   - hours billed and what an hour earned;
   - costs by category;
   - business cash.
5. When I pay myself, Personal shows it as income, Business shows it as "Paid to you" (not a cost),
   and Both counts the client money once.
6. I select records in the Log and move them to the other book. I can undo it now or later.
7. Nothing changes until I turn books on.

### Screens
Wireframes W2.1–W2.5 in [wireframes.md](wireframes.md):
- W2.1: the book switch in the header (Finance and Life).
- W2.2: Business home.
- W2.3: the add sheet with a book chip.
- W2.4: moving records (Log select → move → Undo).
- W2.5: Settings → Books, the first-run review ("Which accounts are business?", "Is your Pay-yourself
  buffer a business account?", "Add business categories?").

```
┌ Finance Helper ───────────────── [ Personal | Business | Both ] ┐
│ Business · November 2026                                        │
│ Profit 18 400 MDL   Income 31 000  Costs 4 600  Paid to you 8 000│
│ Unpaid invoices  2 · 1 450 USD   ⚠ 1 overdue (INV-2026-014)      │
│ Income per client (2026)   Acme Studio ███████ 210 400 MDL       │
│ Hours → money   52 h billed · 590 MDL/h · this year 610 h        │
└─────────────────────────────────────────────────────────────────┘
```

### Core pure modules

New `src/renderer/public/apps/finance/js/books.js`:
```js
export const BOOKS = ['personal', 'business'];
export const booksOn = (state) => boolean;
export const bookOfAccount = (state, accountId) => 'personal' | 'business';
export function bookOf(state, t) => 'personal' | 'business';                 // income/expense
export function transferBooks(state, t) => { from: book, to: book };
export function crossKind(state, t) => null | 'draw' | 'ownerIn' | 'paidForBiz' | 'bizIncomeToPersonal' | 'personalFromBiz';
export function bookView(state, book /* 'personal'|'business'|'both' */) => FrozenState; // §D4
export function bookTotals(state, from, to, book) => { income, extIncome, spent, draws, ownerIn, net, savingsRate };
export function categoriesFor(state, book, type) => Category[];
export function defaultBook(state, { account, category, uiBook }) => book;
export function moveToBook(state, ids, book, now) => { moved: number, batch: string };   // sets/clears t.book, t.moved
export function undoMove(state, batch, now) => { restored: number, keptEdited: number };
export function setAccountBook(state, accountId, book, now) => { before, records: number };
export const STARTER_BUSINESS_CATEGORIES = [...];  // add-only, made-up names
```

New `src/renderer/public/apps/finance/js/business.js` (pure; reuses `invoices.js` and `workhours.js`):
```js
export function businessMonth(state, key) => { income, costs, profit, draws, ownerIn, byCost: [...], byClient: [...] };
export function clientIncome(state, from, to) => [{ person, amount, invoices, share }];
export function openInvoices(state, today) => { count, total, byCurrency, overdue: Invoice[] };
export function hoursMoney(state, from, to, today) => { hours, earned, perHour, source: 'invoices'|'income'|'manual' };
export function businessCash(state) => { total, byAccount };
```

Changes:
- `model.js personalMonth` gets a books-on branch, which uses `bookTotals(…, 'personal')`.
- `store.js save` refuses a state with `_view`.

### Tests
New files:
- `src/renderer/src/web/financeBooks.test.ts`
- `financeBusiness.test.ts`
- `financeForwardCompat.test.ts`

Named cases:
- `books off: every report equals today's (golden fixture)`, which is invariant 5.
- `no book field anywhere: personal view equals both`.
- `account balance is the same in its own book and in both`, run over random states (seeded generator).
- `both income = personal external + business external`.
- `both spending = personal spending + business costs`.
- `pay yourself: draw is personal income, business "paid to you", never income twice`.
- `old salary transfers become draws once the buffer is business`.
- `business cost paid with personal card: business cost, personal balance moves, not personal spending`.
- `client paid into personal card: business income, personal draw`.
- `move to business then undo restores exactly`.
- `undo keeps a record edited after the move`.
- `move survives a sync with an older copy`.
- `setAccountBook counts the records it moves`.
- `defaultBook: account, then category, then switch`.
- `categoriesFor hides business-only categories in personal`.
- `store refuses to save a book view`.
- `a synthetic row opens the real record`.
- `personalMonth unchanged while books are off`.
- `jars use personal view when books are on`.
- `businessMonth profit = income − costs, draws excluded`.
- `openInvoices: overdue only when sent and past due`.
- `hoursMoney falls back like hourlyRate`.
- Forward-compat cases:
  - `v3 old client keeps book/tax/receipts fields` (frozen copy, §7).
  - `stale bot bundle round-trip keeps book`.
  - `unknown top-level key passes through normalize and merge`.
  - `Life sync refuses a newer _schema (no write, status line)`.

### Smoke steps
In `e2e/smoke.mjs`, area `money`:
- **"Money books"**:
  1. Turn books on with a made-up fixture.
  2. Mark "Studio account" as Business; expect "12 past records move" and an Undo.
  3. Check that the Business home shows profit and 1 overdue invoice.
  4. Switch to Personal; expect the draw shown as income and the business costs gone.
  5. Switch to Both; expect today's totals.
  6. Undo the move; expect the totals back.
- **"Money page books"**: the Life Money page switch defaults to Personal; the business strip shows
  profit.

### Risks to existing data, and their mitigations
| Risk | Mitigation |
|---|---|
| An old desktop or a stale bot drops new data | D1: only record and settings fields (kept by v3 code), plus step 2.0 passthrough; frozen-v3 test; `build:bot` is part of the phase's done list |
| A view saved by mistake writes synthetic records | `_view` flag, a frozen view, `store.save` refuses, and a test |
| Marking an account moves history silently | A confirm sheet with the count, a phase 1 snapshot, Undo, and a single field to reverse |
| Totals change for an owner who never turns books on | Invariant 5 golden test on a large made-up fixture |
| `app.js` hotspot: a render path keeps using `ctx.state` and mixes books | One `ctx.view()` getter. The test `every Home/Log/Reports number comes from the view` drives a fixture with books on and compares each card with `bookTotals` |
| Pay-yourself numbers shift | Books off: `personalMonth` unchanged (test). Books on: the salary comes from the draw rule, and the same fixture gives the same personal income as today when the buffer is business |

---

## 4. Phase 3: taxes and paperwork (estimate **L**; can split into 3a tax **M** and 3b receipts **M**)

### User stories
1. I tag income and costs for tax once per category (and override one record when needed).
2. In Taxes I pick my situation (or "not set"). I see my year: taxable income, deductible costs, an
   estimate, the deadlines, and how much to set aside each month. It is clearly marked "not tax advice".
3. I export everything my accountant needs for a year: one XLSX (and CSV) with income, costs, invoices,
   receipts (with Drive links), totals per tag and per month.
4. I add a receipt photo or PDF to an expense. It goes to my Google Drive (never to the server) and
   shows on the record. A missing upload is warned about.
5. Deleting a record with a receipt asks "Delete the receipt from Drive too?".

### Moldova basics the summary needs (not tax advice; checked 2026-11-12; every number is editable)
Stored in `taxprofiles.js`, each entry with its `checked` date and sources:
- **Personal income tax** for individuals: **12%**.
- **Annual personal exemption:** 27,000 MDL is the figure reported for 2025, and some groups get
  31,500 MDL. It is not available once taxable income reaches 360,000 MDL. The 2026 figure was not
  confirmed when this was checked, so the owner must confirm it.
- **The individual's yearly declaration (CET18)** is due **30 April** of the next year. It is needed
  when tax was not withheld at source (for example, income from foreign clients).
- **Companies and individual entrepreneurs** file their income tax declaration by **25 March**.
- **IT Park (MITP) residents** (legal entities or individual entrepreneurs that meet Law 77/2016):
  - a single tax of **7% of sales revenue**, with a monthly minimum per employee set at 30% of the
    average monthly salary in the economy;
  - it replaces corporate income tax, employees' income tax, and social and medical contributions;
  - it is reported monthly on **IU17 by the 25th** of the next month.
- **The health-insurance fixed sum** for people who insure themselves: the amount is left for the
  owner to enter, with no default.

Sources:
- the State Tax Service on the 30 April deadline (monitorul.fisc.md);
- logos-pres.md (25 March);
- mitp.md and invest.gov.md (IT Park).

Profiles: `none` (default), `individual` (12% on taxable income minus the exemption, CET18),
`entrepreneur` (12% on income minus deductible costs, 25 March), `itpark` (7% of turnover, monthly
IU17). Every screen footer says: *"Not tax advice. Numbers from <source>, checked <date>. Check with
the State Tax Service (sfs.md) or your accountant."*

### Screens
- W3.1: Taxes (year summary).
- W3.2: Tag categories (a list with one chip each).
- W3.3: Accountant export sheet.
- W3.4: the record sheet with receipts (add, view, upload state).
- W3.5: the Money page warning "3 receipts not in Drive yet".

```
┌ Taxes 2026 ─────────────── profile: Individual (foreign income) ▾┐
│ Taxable income      214 300 MDL   (12 records tagged "Taxable")  │
│ − Personal exemption 27 000 MDL   (check: 2026 not confirmed)    │
│ Estimate (12%)       22 476 MDL   Set aside so far 18 000 MDL    │
│ Deadline: CET18 by 30 Apr 2027    ⓘ Not tax advice …             │
│ [ Tag categories ]  [ Accountant export ]                        │
└─────────────────────────────────────────────────────────────────┘
```

### Core pure modules

New `js/taxprofiles.js` (data only, no logic):
```js
export const TAX_TAGS = [{id:'taxable',kind:'income'},{id:'exempt',kind:'income'},{id:'deductible',kind:'expense'},{id:'not-deductible',kind:'expense'},{id:'turnover',kind:'income'}];
export const PROFILES = { none: {...}, individual: { years: { 2025: { pitBp: 1200, exemption: 2700000, exemptionCap: 36000000, deadline: '04-30', checked: '2026-11-12', sources: [...] } } }, entrepreneur: {...}, itpark: { years: { 2026: { turnoverBp: 700, monthlyDeadlineDay: 25, minPerEmployee: null } } } };
```

New `js/tax.js`:
```js
export function taxTagOf(state, t) => tagId | null;     // t.tax ?? category.tax ?? invoice tax
export function setTaxTag(state, ids, tag, now) => number;
export function profileFor(state, year) => { id, numbers, overridden: string[], checked, sources, unconfirmed: string[] };
export function taxYear(state, year, today) => {
  rows, byTag, byMonth, taxable, deductible, base, estimate, setAside, perMonthToSetAside, deadlines: [{date,label}], warnings: string[]
};   // business book when books are on and the profile is entrepreneur/itpark; income tagged 'taxable' otherwise
export function untagged(state, year) => { income: Tx[], expense: Tx[] };
```

New `js/accountant.js`:
```js
export function accountantSheets(state, year, receiptIndex) => [{ name, rows }];  // for phase 1's xlsx writer / csv.js
export const ACCOUNTANT_COLUMNS = ['Date','Book','Type','Amount','Currency','Rate','MDL','Category','Tax tag','Client/Person','Invoice','Note','Receipt link'];
```

New Life core module `src/core/receiptIndex.ts`:
```ts
export function mergeReceipts(a, b): ReceiptIndex
export function cleanReceipts(idx, maxBytes = 400_000): ReceiptIndex
export function planReceiptSync(idx, local: LocalReceipt[], drive: DriveFile[]): { uploads, adopt, drops, warn: { notUploaded: number } }
export function receiptName(tx, r, base): string   // "2026-11-03 Software 245,00 MDL r-ab12.jpg"
```

IO, Life side: `src/renderer/src/money/receipts.ts`. It does IndexedDB `life-receipts`, the upload
through `vault/driveApi.ts`, the year folder and the bridge handlers. It has no logic of its own; the
decisions come from `planReceiptSync`.

Bridge messages (`EmbedHost.tsx`):
- `FINANCE_RECEIPT_ADD {txId, name, mime, bytes}` → `LIFE_FINANCE_RECEIPT {rid, status}`
- `FINANCE_RECEIPT_OPEN {rid}`
- `FINANCE_RECEIPT_INDEX` → `{items}` (for the export and the badges)
- `FINANCE_RECEIPT_REMOVE {rid, fromDrive}`

Finance standalone (outside Life) hides the receipt button.

### Tests
New files:
- `src/renderer/src/web/financeTax.test.ts`
- `financeAccountant.test.ts`
- `src/core/receiptIndex.test.ts`

Named cases:
- `untagged categories give no estimate, only totals`.
- `record tag overrides category tag`.
- `individual 2025: 12% of (taxable − 27 000) with made-up income`.
- `exemption dropped at 360 000 or more`.
- `itpark: 7% of turnover by month, deadline 25th next month`.
- `entrepreneur: deductible business costs reduce base`.
- `owner override wins and is listed as overridden`.
- `unconfirmed year shows a warning, never a silent number`.
- `amounts are integers (bani, basis points)`.
- `tax tags never change any money total` (all phase 2 invariants rerun with tags).
- `accountant export: one row per record, MDL = base, receipt link from index`.
- `export of a year with a re-priced record uses the new rate and lists it`.
- `mergeReceipts: later change wins, driveId never lost, tombstone wins`.
- `cap drops old tombstones first, never a live receipt`.
- `planReceiptSync uploads once by lsId, adopts an existing Drive file`.
- `receiptName has no personal data beyond date, category and amount`.
- `delete record asks; yes = tombstone + Drive bin`.
- `receipt upload runs while Photo Locker is off` (modules test).

### Smoke steps
- **"Money taxes"**:
  1. Pick the Individual profile.
  2. Tag "Client work" as Taxable.
  3. Check the made-up estimate and the "Not tax advice" footer.
  4. Run the accountant export and check that the file has the expected sheets and row count. It is
     read back with phase 1's XLSX reader.
- **"Money receipt"**:
  1. Attach a small made-up PNG to an expense with Drive stubbed (`E2E` route).
  2. Check the badge "in Drive".
  3. Delete the record; expect the "Delete from Drive too?" prompt.

### Risks to existing data, and their mitigations
| Risk | Mitigation |
|---|---|
| Wrong tax numbers taken as fact | Dated, sourced, editable numbers; an "unconfirmed" warning; a footer on every screen; profile `none` by default |
| Receipt images bloat the synced blob or reach the server | Only ids in `tx`; metadata in its own capped key; bytes only in IndexedDB and Drive; a test that `toCloud` output has no `data:` or base64 |
| Receipts lost when only on one device | A badge plus the Money page warning, the same pattern as Photo Locker; never dropped before a driveId exists |
| A receipt orphaned by a deleted record | The prompt on delete; a "Receipts without a record" list in Taxes → Receipts |
| Bigger `app.js` | All new UI in `screens/tax.js` and `screens/receipts.js`; `app.js` gets only the route and one button in the record sheet |

---

## 5. Phase 4: the long view (estimate **M**)

### User stories
1. I see my net worth month by month since my first record, and year by year, and I can tell a real
   snapshot from a month rebuilt from records.
2. I see my savings rate per month and per year (Personal by default).
3. I compare this year with last year per category, for the same days of the year.
4. I see my runway in months:
   - Personal: money I can reach ÷ my usual monthly spending.
   - Business: business cash ÷ (costs + what I pay myself).

### Screens
W4.1: Reports → **Long view**, a new sub-tab next to "Year in review". It has four cards: Net worth,
Savings rate, This year vs last, Runway. W4.2: the Money page's runway line in the hero.

```
┌ Long view ─────────────────────────── [ Personal | Business | Both ]┐
│ Net worth  ▁▂▂▃▄▄▅▆▆▇█  412 300 MDL   +38% vs a year ago            │
│            months ● snapshot ○ rebuilt (rates of that day)          │
│ Savings rate 2026  31%   2025  22%     ▂▃▅▃▄▆▅▆▇▅▆                  │
│ This year vs last (1 Jan–12 Nov)   Food 14 200 → 12 900  −9%        │
│ Runway  Personal 7.5 months · Business 4 months                     │
└────────────────────────────────────────────────────────────────────┘
```

### Core pure modules
New `js/longview.js`:
```js
export function monthlyLedger(state) => { months: string[], byAccount: Map<accId, Int32Array /*delta per month*/> };  // one pass, cached by (tx.length, max updatedAt)
export function netWorthMonths(state, today, { book = 'both' } = {}) => [{ key, value, source: 'snapshot'|'rebuilt'|'today', rateDay }];
export function netWorthYears(state, today, opts) => [{ year, end, change, changePct }];
export function savingsRates(state, today, { book = 'personal', months = 24 } = {}) => [{ key, income, spent, rate }];
export function yearVsYear(state, today, { book = 'personal' } = {}) => [{ category, now, before, delta, pct }];   // same day range
export function runway(state, today, { book = 'personal' } = {}) => { months, reachable, burn, basisMonths, note };
```
- Rebuilt months use that day's rate from `rates.history` when it is there. Otherwise they use today's
  rate, and the point says so (`rateDay: null`).
- Personal burn = the average of the last 6 full months of personal spending (bills included).
- Business burn = costs + draws.
- With Pay yourself on, the business runway is today's buffer ÷ salary, the same numbers as
  `payStatus`.

### Tests
New file: `src/renderer/src/web/financeLongView.test.ts`. Named cases:
- `net worth months start at the first record`.
- `snapshot wins over rebuilt in its month`.
- `rebuilt month uses that day's saved rate`.
- `last point equals totalBalance today`.
- `years: end of each year and change`.
- `savings rate personal uses draws as income, never business income`.
- `savings rate null for a month without income`.
- `year vs year compares same days, not whole last year`.
- `runway personal = reachable ÷ 6-month average`.
- `runway business matches payStatus when pay yourself is on`.
- `30 years × 3 000 records: under 200 ms` (pin the clock; ≥10% headroom for the Windows build).
- `book views: personal + business net worth = both`.

### Smoke steps
- **"Money long view"**:
  1. Open Reports → Long view on the fixture.
  2. Check the four cards, the snapshot/rebuilt legend, and the switch to Business changing the runway
     line.
  3. Check the page height at 1280 with ≥10% headroom.

### Risks to existing data, and their mitigations
| Risk | Mitigation |
|---|---|
| Read-only phase: risk to data is near zero | No new stored fields (only `ui` prefs) |
| Slow on decades of data | One-pass ledger with a cache; the performance test |
| Misleading history from today's rates | Saved daily rates first; rebuilt points are labelled |

---

## 6. Phase 5: less typing (estimate **L**; split 5a rules, bills and Telegram **M**; 5b phone capture inbox **M**)

### User stories
1. When I type or forward "Glovo 145", the category, subcategory, book and tax tag come filled in
   from what I chose before. I can see how sure the app is.
2. A rule I make ("bolt → Transport › Taxi, Personal") always wins and syncs. Deleting it sticks.
3. Fixed bills log themselves on the due day and ask me to confirm. Bills that change each time
   ask for the amount.
4. On Telegram, quick add uses the same rules. When it is not sure, it replies with three category
   buttons.
5. Payments my phone sees (maib, Google Wallet, Revolut notifications) land in **To sort**. One tap
   files each one. The same payment seen twice shows once.
6. Nothing captured or auto-logged pays "spending logged" points unless I confirmed it that day.

### Screens
- W5.1: **To sort** (Finance Home card plus its own screen):
  - captures and records still in Other;
  - one tap per suggestion chip, "Other…", and swipe to dismiss.
- W5.2: Due bills / auto-logged confirm card.
- W5.3: the add sheet showing the suggestion with "sure / maybe / guess".
- W5.4: Settings → Rules (with learned merchants, read-only, and "Make a rule").
- W5.5: the Money page card "4 to sort".
- W5.6: Telegram reply with buttons.

```
┌ To sort · 4 ─────────────────────────────────────────────────────┐
│ 🏦 maib  · Today 12:41   GLOVO*KITCHEN       145,00 MDL          │
│   [ Food › Delivery  ●●● ] [ Fun ] [ Other… ]        ✕ not mine  │
│ 💳 Revolut · Yesterday   FIGMA               15,00 USD           │
│   [ Software (Business) ●●○ ] [ Subscriptions ] [ Other… ]       │
└──────────────────────────────────────────────────────────────────┘
```

### Core pure modules

New `js/learn.js`, which replaces nothing at first. In 5a, `suggestCategory` becomes a thin wrapper
over `suggest`, and every old `suggestCategory` test case must still pass.
```js
export function choiceTable(state, { halfLifeDays = 180 } = {}) => Map<merchantKey, { cat: Map, sub: Map, book: Map, n, last }>; // cached; skips catBy 'auto' and unconfirmed captures
export function suggest(state, { note, amount, type, account, at }) => {
  category, sub, book, tax, account, confidence /*0..1*/, level /*'sure'|'maybe'|'guess'*/, why /*'rule'|'merchant'|'word'|'keyword'*/, alternatives: [{category, sub, confidence}]
};   // sure: ≥0.9 and n≥3 (or a rule); maybe: ≥0.6; else guess
export function addRule2(state, { match, type, category, sub, book, tax, min, max }, now) => Rule;   // updatedAt; replaces same match+type
export function removeRule2(state, id, now) => void;   // tombstone in state.deleted
```

`recurring.js` additions:
```js
export function confirmItems(state, today) => [{ tx, rule }];   // records with source 'auto' and no confirmedAt
export function confirmTx(state, id, patch, now) => Tx;          // sets confirmedAt, may change amount
```

New Life core module `src/core/paymentCapture.ts` (also in the bot bundle):
```ts
export type Capture = { source: 'maib'|'gwallet'|'revolut'|'unknown', kind: 'debit'|'credit'|'refund'|'ignore', amount: number /*bani*/, currency: string, merchant: string, at: number }
export function parseNotification(app: string, title: string, text: string, at: number): Capture | null   // OTP, balance, declined → ignore
export function captureId(c: Capture): string   // stable hash: source + at(minute) + amount + currency + merchant
```

New Life core module `src/core/moneyToSort.ts`:
```ts
export function mergeToSort(a, b): ToSort
export function addCaptures(list, captures, now): { list, added, dupes }   // same amount+currency within 3 min and a fuzzy merchant = one item with dupOf
export function keepToSort(list, finance, now): ToSort                      // never drops a 'new' item
export function toSortWarning(list, now): null | { count, oldestDays }
export function itemToTx(state, item, choice, now): Tx                       // id cap-<item.id>, source 'capture', confirmedAt now, account from captureAccounts
```

Other changes:
- `src/core/moneyDays.ts liveLog` / `isImported`: `source` `auto` or `capture` count as live only by
  `confirmedAt`.
- `web/financeBot.ts`: quick add uses `suggest()`. When the level is `guess`, it replies with
  `categoryKeyboard` and the record gets `catBy:'auto'`. The word `biz` at the end sets the book
  (`telegram.js parseQuick` learns `biz` / `business`).
- **Transport for phone capture:** an Android automation (the same idea as today's phone health keys,
  `api/_health.mjs`) posts `{app, title, text, at}` to the existing `/api/cron` with its **own key
  kind**, so a health key can never post money.
  - The server parses the post, adds it to `money_tosort` and keeps nothing else.
  - The raw text is cut to 200 characters and cleared once the item is sorted.
  - There is no new `api/` file. The owner is asked to choose the app (open question 2).

### Tests
New files:
- `src/renderer/src/web/financeLearn.test.ts`
- `financeBills.test.ts`
- `src/core/paymentCapture.test.ts`
- `src/core/moneyToSort.test.ts`

Additions to `web/financeBot.test.ts` and `core/moneyDays.test.ts`.

Named cases:
- `all old suggestCategory cases still pass through suggest`.
- `rule beats merchant beats word beats keyword`.
- `confidence: 3 of 3 = sure, 3 of 5 = maybe`.
- `recent choices outweigh old ones (half-life)`.
- `auto and unconfirmed captures are not evidence`.
- `suggest learns the book per merchant`.
- `rules merge as a list; a deleted rule stays deleted after an old client's save`.
- `old client stale rules list cannot bring a rule back`.
- `auto bill logs once with id rec-<rule>-<date> on two devices`.
- `confirm sets confirmedAt; "didn't happen" deletes with undo and does not re-log`.
- `variable bill never auto-logs`.
- `auto record is not a live log until confirmed that day` (moneyDays).
- `capture sorted the same day counts as live; next day does not`.
- Parser cases (made-up texts):
  - `maib debit parsed (made-up text)`;
  - `google wallet debit parsed`;
  - `revolut foreign currency parsed`;
  - `OTP / balance / declined ignored`;
  - `unknown format keeps raw, no amount guess beyond a clear number`.
- `same payment from maib and wallet = one item`.
- `two devices sort the same item → one record cap-<id>`.
- `new items never dropped; warning from day 50`.
- `raw text cleared after sorting`.
- `capture key cannot read anything and a health key cannot post captures`.
- Telegram cases:
  - `telegram "figma 15 usd biz" → business, Software`;
  - `telegram low confidence shows 3 buttons`.
- `captured record dedupes against a later bank import (±1 day, same amount)`. This uses phase 1's
  import dedupe and only adds the capture case to it.

### Smoke steps
- **"Money to sort"**: seed two made-up captures (one a duplicate). Expect one row. Tap the suggested
  chip; expect the record in the Log with "from maib" and the item gone.
- **"Money bills confirm"**: an auto rule due today shows the confirm card. Confirm it; the card goes.
- **"Money suggest"**: type "glovo" in the add sheet; expect "Food › Delivery" with "sure".
- Telegram and server parts are covered by unit tests (desktop-first rule: no new web-only smoke).

### Risks to existing data, and their mitigations
| Risk | Mitigation |
|---|---|
| Captures double-count with bank imports or a hand-typed record | The inbox, not the books; dedupe on add; a "Looks like a record you already have" hint when sorting (same amount within 1 day); import dedupe covers `cap-` records |
| Points paid for things the owner did not do | `confirmedAt` rule in `moneyDays.ts`; tests |
| Phone notification text is private data on the server | Only parsed fields plus 200 characters of raw text, cleared after sorting; no logs of the text; owner chat or key only; never in the public repo (made-up fixtures) |
| Rules list changes from scalar to list breaks older devices | Old devices still read it as a scalar list (same shape plus fields); new merge plus tombstones (test) |
| A wrong learned suggestion files silently | Captures and guesses are never filed without a tap; "sure" only pre-fills the sheet; the owner always sees the chip |

---

## 7. Cross-phase safety net (built once in step 2.0, used by every phase)
1. **Frozen old client.** `src/renderer/src/web/fixtures/financeV3.js` is a verbatim copy of today's
   (v3) `normalizeState`, `toCloud` and `mergeStates`, marked "frozen, never edit".
   `financeForwardCompat.test.ts` round-trips every phase's new fields through it (load → edit another
   record → save → merge back) and asserts that nothing is lost. **Each phase adds its fields to this
   test.**
2. **Golden totals.** A large made-up fixture (`fixtures/financeGolden.json`, about 2 000 records over
   4 years, made by a seeded generator). The test checks its month totals, reports, jars, safe to spend
   and net worth, recorded before phase 2. With every new feature off, these must stay equal for ever.
3. **Bot bundle check.** Every phase that touches `apps/finance/js/model.js`, `sync.js`, `telegram.js`
   or `books.js` runs `npm run build:bot` and commits `api/_bot/bot.mjs`. A test fails when
   `bot.mjs`'s copy of `normalizeState` drops a field the frozen-v3 test lists (grep for the passthrough
   marker).
4. **Phase 1's safety snapshot** before every bulk change (account book, move, tag many, apply rule to
   many).
5. **Durable undo** for every bulk change, by batch (`moved`), in addition to the session undo in
   `history.js`.

---

## 8. Build order and file ownership

**Order: Phase 1 (in progress) → 2.0 → 2 → 3a → 3b → 4 → 5a → 5b.** Ship each one as soon as it is
green (cost rule: 2–4 features per batch). Phase 4 may run in parallel with 3b *only* if `app.js` is
untouched by one of them (4 needs only the `SUB_TABS`/`SCREENS` lines; give `app.js` to 3b and let 4
add its two lines after 3b merges).

Feature freeze: the freeze runs until about 2026-11-25. These phases start when the owner says so,
since he approved them by name.

| File | P1 | 2.0 | 2 | 3a | 3b | 4 | 5a | 5b |
|---|---|---|---|---|---|---|---|---|
| `finance/js/model.js` | ? | **own** | **own** (`personalMonth` branch) | | | | | |
| `finance/js/sync.js` | ? | **own** | **own** (`settings.books`) | | | | **own** (rules list) | |
| `finance/js/store.js` | ? | | **own** (`_view` refusal) | | | | | |
| `finance/js/history.js` | | | **own** | | | | | |
| `finance/js/importer.js` / export | **P1 owns** | | Book column (after P1 merges) | Tax tag column | Receipt column | | | |
| `finance/js/books.js` (new) | | | **own** | | | read | read | read |
| `finance/js/business.js` (new) | | | **own** | | | | | |
| `finance/js/screens/books.js`, `screens/business.js` (new) | | | **own** | | | | | |
| `finance/js/taxprofiles.js`, `tax.js`, `accountant.js`, `screens/tax.js` (new) | | | | **own** | | | | |
| `finance/js/screens/receipts.js` (new) | | | | | **own** | | | |
| `finance/js/longview.js`, `screens/longview.js` (new) | | | | | | **own** | | |
| `finance/js/learn.js` (new), `screens/tosort.js` (new) | | | | | | | **own** | **own** |
| `finance/js/recurring.js`, `screens/plan.js` | | | | | | | **own** | |
| `finance/js/telegram.js` (`parseQuick`) | | | | | | | **own** | |
| `finance/js/app.js` (hotspot, one owner at a time) | ? | | **own** | **own** | **own** | 2 lines | **own** | **own** |
| `finance/css/app.css` | | | add `.bk-*` | `.tx-*` | `.rc-*` | `.lv-*` | `.ts-*` | |
| `src/renderer/src/web/financeSync.ts` | | **own** | | | | | | |
| `src/renderer/src/web/moneyHub.ts`, `src/core/moneyHub.ts` | | | **own** | | | **own** | | **own** |
| `src/renderer/src/pages/Money.tsx` | | | **own** | | **own** (warning) | **own** (runway) | | **own** (to sort card) |
| `src/renderer/src/EmbedHost.tsx` | | | | | **own** | | | |
| `src/renderer/src/money/receipts.ts` (new), `src/core/receiptIndex.ts` (new) | | | | | **own** | | | |
| `src/core/settingsKeys.ts` | | | | | **own** | | | **own** |
| `src/core/modules.ts` | | | | | **own** (receipt job) | | | |
| `src/core/moneyDays.ts` | | | | | | | **own** | |
| `src/renderer/src/web/financeBot.ts` (+ `build:bot`) | | | | | | | **own** | |
| `src/core/paymentCapture.ts`, `src/core/moneyToSort.ts` (new), `web/moneyToSort.ts` (new) | | | | | | | | **own** |
| `api/cron.mjs`, `api/_health.mjs` (capture key kind) (+ `build:bot`) | | | | | | | | **own** |
| `e2e/smoke.mjs` (hotspot) | ? | | step | step | step | step | step | step |
| `docs/areas/rewards-money.md`, `docs/harness/feature_list.json` | ? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `docs/DECISIONS.md` | | D1/D2 | D3–D5 | D7 | D6 | | D8 | D9 |

`?` means phase 1 may touch it. Phase 2 rebases on phase 1 first and re-reads those files with
`git log`. Not touched by any phase: `webBots.ts`, `telegramBot.ts`, `DesktopIsland.tsx`,
`IslandFeed.tsx`, `src/core/schema.ts`, `api/_schema.mjs`, and no new function file in `api/`.

Agent routing:
- `architect` (Opus): 2.0, the sync/merge part of 2 and 5a, `receiptIndex` and the capture key.
- `builder` (Sonnet): screens, tests, smoke steps, the long view and the tax profiles.

## 9. Decisions to record when each phase ships
Add these to `docs/DECISIONS.md` as each phase ships (not now):
- D1/D2: no new top-level keys; schema stays 3.
- D3/D4: book from the account, read-only views, draws never income twice.
- D6: receipts device-to-Drive, Money owns the upload.
- D7: tax numbers dated, sourced, editable, not advice.
- D8: learned rules derived.
- D9: captures only through To sort; points by `confirmedAt`.

## 10. Open questions for the owner (5)
1. **Your tax situation:** individual with foreign clients, individual entrepreneur, or IT Park
   resident (or "not sure yet": totals only)? This picks the Taxes profile.
2. **Phone capture:** which Android app may forward bank notifications (for example MacroDroid or
   Tasker, with its own key), or do you want a small app of our own later?
3. **Business currency:** should Business reports show MDL (like today) or USD (your clients' money),
   with MDL as a second line?
4. **Which accounts are Business today?** And is your Pay-yourself buffer a business account? (This
   decides how old salary transfers show.)
5. **Accountant export:** is one XLSX with Drive links to receipts enough, or does your accountant want
   the receipt files too (a ZIP made on your device)?
