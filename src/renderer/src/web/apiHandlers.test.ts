// The API's doors: no session, no data; the tick needs a session or the secret to run often.
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain JS API modules
import dbHandler from '../../../../api/db.mjs'
// @ts-expect-error plain JS API modules
import configHandler from '../../../../api/config.mjs'

function call(handler: (req: any, res: any) => Promise<void>, req: Partial<{ method: string; headers: Record<string, string>; url: string }>) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k] = v
      },
      end(b?: string) {
        resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null })
      },
      writeHead(code: number) {
        this.statusCode = code
      }
    }
    void handler({ method: 'POST', headers: {}, url: '/', on: () => {}, ...req }, res)
  })
}

const saved = { url: process.env.TURSO_URL, token: process.env.TURSO_TOKEN }
afterAll(() => {
  if (saved.url === undefined) delete process.env.TURSO_URL
  else process.env.TURSO_URL = saved.url
  if (saved.token === undefined) delete process.env.TURSO_TOKEN
  else process.env.TURSO_TOKEN = saved.token
})

describe('API doors', () => {
  it('the database proxy refuses requests without a valid session', async () => {
    process.env.TURSO_URL = 'libsql://fake.turso.io'
    process.env.TURSO_TOKEN = 'k'
    const r = await call(dbHandler, { headers: { authorization: 'Bearer forged.token' } })
    expect(r.status).toBe(401)
  })
  it('the bot config needs a session too', async () => {
    const r = await call(configHandler, { method: 'GET', headers: {} })
    expect(r.status).toBe(401)
  })
})
