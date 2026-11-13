// Made-up payment notifications for payNotify.test.ts: the shapes maib,
// Google Wallet, Revolut and Paynet use, with invented shops, amounts and
// card digits. This repo is public: never paste a real notification as it is.
//
// ── ADD REAL SHAPES HERE ────────────────────────────────────────────────────
// When a real notification is read wrong (Settings → Phone payments shows
// the last 5 with what was read), copy its WORDING into REAL_SHAPES below,
// but change the shop name, the amount, the card's last 4 digits, any balance
// and any date to made-up ones. Then set `want` to what it should read.
// The test runs every entry in FIXTURES and REAL_SHAPES.
// ─────────────────────────────────────────────────────────────────────────────
import type { PayNotice, PaySource } from './payNotify'

export interface PayFixture {
  name: string
  n: PayNotice
  /** What it should read; null kind = not a payment (with that kind). */
  want: { amount: number; currency: string; merchant: string; source: PaySource; last4?: string; refund?: boolean } | { kind: 'declined' | 'not-payment' | 'unreadable'; source?: PaySource }
}

export const REAL_SHAPES: PayFixture[] = [
  // { name: 'maib, shape seen on <date>', n: { app: 'maib', title: '…', text: '…' }, want: { amount: 0, currency: 'MDL', merchant: '…', source: 'maib' } },
]

export const FIXTURES: PayFixture[] = [
  // maib, Romanian
  { name: 'maib RO: Plată with la and card', n: { app: 'maib', title: 'maib', text: 'Plată: 123,45 MDL la LINELLA 23 CHISINAU MD. Card *4821. Sold: 3 210,50 MDL' }, want: { amount: 12345, currency: 'MDL', merchant: 'LINELLA 23', source: 'maib', last4: '4821' } },
  { name: 'maib RO: Tranzacție reușită, shop on its own line', n: { app: 'maib', title: 'Tranzacție reușită', text: 'Suma: 89,90 lei\nKAFFEE HAUS SRL\nCard Visa *1937\nDisponibil 1.204,10 MDL' }, want: { amount: 8990, currency: 'MDL', merchant: 'KAFFEE HAUS SRL', source: 'maib', last4: '1937' } },
  { name: 'maib RO: thousands with a space', n: { app: 'maib', title: 'maib', text: 'Plată 1 250,00 MDL, Comerciant: ELECTRO MARKET; card *5502' }, want: { amount: 125000, currency: 'MDL', merchant: 'ELECTRO MARKET', source: 'maib', last4: '5502' } },
  { name: 'maib RO: thousands with a dot', n: { app: 'maib', title: 'Plată', text: 'Achitare la FARMACIA VERDE: 1.020,30 MDL. Card *7710' }, want: { amount: 102030, currency: 'MDL', merchant: 'FARMACIA VERDE', source: 'maib', last4: '7710' } },
  { name: 'maib RO: in euro abroad', n: { app: 'maib', title: 'maib', text: 'Plată 20,00 EUR la CAFE CENTRAL VIENNA (412,60 MDL). Card *4821' }, want: { amount: 2000, currency: 'EUR', merchant: 'CAFE CENTRAL VIENNA', source: 'maib', last4: '4821' } },
  { name: 'maib RO: refund', n: { app: 'maib', title: 'maib', text: 'Rambursare +45,00 MDL de la BOOK CORNER. Card *4821' }, want: { amount: 4500, currency: 'MDL', merchant: 'BOOK CORNER', source: 'maib', last4: '4821', refund: true } },
  { name: 'maib RO: declined', n: { app: 'maib', title: 'maib', text: 'Tranzacție respinsă: 310,00 MDL la SHOE PLANET. Fonduri insuficiente.' }, want: { kind: 'declined', source: 'maib' } },
  { name: 'maib RO: money in', n: { app: 'maib', title: 'maib', text: 'Ați primit 500,00 MDL pe card *4821 de la Ion P.' }, want: { kind: 'not-payment', source: 'maib' } },
  { name: 'maib RO: a 3-D Secure code', n: { app: 'maib', title: 'maib', text: 'Codul de confirmare 3-D Secure: 482193 pentru 79,00 MDL la SHOP ONLINE' }, want: { kind: 'not-payment', source: 'maib' } },
  // maib, Russian
  { name: 'maib RU: Оплата в', n: { app: 'maib', title: 'maib', text: 'Оплата 64,50 MDL в KAUFLAND 3. Карта *4821. Остаток: 2 145,95 MDL' }, want: { amount: 6450, currency: 'MDL', merchant: 'KAUFLAND 3', source: 'maib', last4: '4821' } },
  { name: 'maib RU: lei word, merchant label', n: { app: 'maib', title: 'Покупка', text: 'Сумма: 230 лей\nМесто: PIZZA NAPOLI\nКарта *3304' }, want: { amount: 23000, currency: 'MDL', merchant: 'PIZZA NAPOLI', source: 'maib', last4: '3304' } },
  { name: 'maib RU: declined', n: { app: 'maib', title: 'maib', text: 'Операция отклонена: 1 500,00 MDL в TECH STORE. Недостаточно средств' }, want: { kind: 'declined', source: 'maib' } },
  { name: 'maib RU: refund', n: { app: 'maib', title: 'maib', text: 'Возврат 120,00 MDL от SPORT LIFE. Карта *4821' }, want: { amount: 12000, currency: 'MDL', merchant: 'SPORT LIFE', source: 'maib', last4: '4821', refund: true } },
  // Google Wallet
  { name: 'Google Wallet: shop in the title, MDL first', n: { app: 'Google Wallet', title: 'Linella', text: 'MDL 123.45 with Visa •••• 4821' }, want: { amount: 12345, currency: 'MDL', merchant: 'Linella', source: 'gwallet', last4: '4821' } },
  { name: 'Google Wallet: euro sign', n: { app: 'Google Wallet', title: 'Green Bean Coffee', text: '€4.20 with Mastercard •••• 9012' }, want: { amount: 420, currency: 'EUR', merchant: 'Green Bean Coffee', source: 'gwallet', last4: '9012' } },
  { name: 'Google Wallet: Paid at', n: { app: 'Wallet', title: 'Google Wallet', text: 'Paid 56,00 MDL at Bus Ticket Office' }, want: { amount: 5600, currency: 'MDL', merchant: 'Bus Ticket Office', source: 'gwallet' } },
  { name: 'Google Wallet: card name says maib (still Wallet)', n: { app: 'Google Wallet', title: 'Andys Pizza', text: 'MDL 210.00 with maib Visa •••• 4821' }, want: { amount: 21000, currency: 'MDL', merchant: 'Andys Pizza', source: 'gwallet', last4: '4821' } },
  { name: 'Google Wallet: thousands with a comma', n: { app: 'Google Wallet', title: 'Furniture World', text: 'MDL 2,499.00 with Visa •••• 4821' }, want: { amount: 249900, currency: 'MDL', merchant: 'Furniture World', source: 'gwallet', last4: '4821' } },
  // Revolut
  { name: 'Revolut: You paid … at', n: { app: 'Revolut', title: 'Revolut', text: 'You paid €12.50 at Corner Bakery' }, want: { amount: 1250, currency: 'EUR', merchant: 'Corner Bakery', source: 'revolut' } },
  { name: 'Revolut: Payment to', n: { app: 'Revolut', title: 'Payment to City Bikes', text: '€3.00 paid with your card ··7731' }, want: { amount: 300, currency: 'EUR', merchant: 'City Bikes', source: 'revolut', last4: '7731' } },
  { name: 'Revolut: decimal comma and MDL', n: { app: 'Revolut', title: 'Revolut', text: 'You paid 150,00 MDL at Cinema Star' }, want: { amount: 15000, currency: 'MDL', merchant: 'Cinema Star', source: 'revolut' } },
  { name: 'Revolut: refund', n: { app: 'Revolut', title: 'Revolut', text: 'Refund of €9.99 from Music Shop' }, want: { amount: 999, currency: 'EUR', merchant: 'Music Shop', source: 'revolut', refund: true } },
  { name: 'Revolut: declined', n: { app: 'Revolut', title: 'Revolut', text: 'Payment of €45.00 at Gadget Hub was declined' }, want: { kind: 'declined', source: 'revolut' } },
  { name: 'Revolut: money in', n: { app: 'Revolut', title: 'Revolut', text: 'You received €50.00 from Ana' }, want: { kind: 'not-payment', source: 'revolut' } },
  // Paynet
  { name: 'Paynet: Plată', n: { app: 'Paynet', title: 'Paynet', text: 'Plată reușită: 200,00 MDL către ORANGE MOLDOVA' }, want: { amount: 20000, currency: 'MDL', merchant: 'ORANGE', source: 'paynet' } },
  // Generic fallback
  { name: 'Other app: payment words and an amount', n: { app: 'Some Bank', title: 'Card payment', text: 'Purchase 75.30 USD at Book Shop' }, want: { amount: 7530, currency: 'USD', merchant: 'Book Shop', source: 'generic' } },
  { name: 'Other app: no payment words', n: { app: 'Shop App', title: 'Sale!', text: 'Everything 20,00 MDL off today' }, want: { kind: 'not-payment', source: 'generic' } },
  { name: 'Other app: no currency', n: { app: 'Some Bank', title: 'Payment', text: 'You paid 120 at the market' }, want: { kind: 'unreadable', source: 'generic' } },
  { name: 'MacroDroid placeholder not filled in', n: { app: 'maib', title: '[notification_title]', text: '[notification]' }, want: { kind: 'unreadable', source: 'maib' } }
]
