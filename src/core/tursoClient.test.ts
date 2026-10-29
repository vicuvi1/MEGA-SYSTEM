import { describe, expect, it, vi } from 'vitest'
import { TursoClient } from './tursoClient'

describe('TursoClient Core Logic', () => {
  it('normalizes libsql:// protocol to https:// URL correctly', () => {
    const client = new TursoClient({
      url: 'libsql://my-db.turso.io',
      authToken: 'test-token'
    })
    expect((client as any).pipelineUrl).toBe('https://my-db.turso.io/v2/pipeline')
  })

  it('normalizes bare hostname to https://', () => {
    const client = new TursoClient({
      url: 'my-db.turso.io/',
      authToken: 'test-token'
    })
    expect((client as any).pipelineUrl).toBe('https://my-db.turso.io/v2/pipeline')
  })

  it('parses column names and rows into typed objects', async () => {
    const client = new TursoClient({
      url: 'https://test.turso.io',
      authToken: 'token'
    })

    const mockResponse = {
      results: [
        {
          type: 'ok',
          response: {
            result: {
              cols: [{ name: 'id' }, { name: 'coins' }, { name: 'note' }],
              rows: [
                [
                  { type: 'integer', value: '1' },
                  { type: 'integer', value: '50' },
                  { type: 'text', value: 'Reward' }
                ],
                [
                  { type: 'integer', value: '2' },
                  { type: 'integer', value: '10' },
                  { type: 'null' }
                ]
              ]
            }
          }
        }
      ]
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    } as any)

    const rows = await client.query('SELECT * FROM ledger')
    expect(rows).toEqual([
      { id: 1, coins: 50, note: 'Reward' },
      { id: 2, coins: 10, note: null }
    ])
  })

  it('throws descriptive error on HTTP failure', async () => {
    const client = new TursoClient({
      url: 'https://test.turso.io',
      authToken: 'token'
    })

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid authentication token'
    } as any)

    await expect(client.execute('SELECT 1')).rejects.toThrow('Turso HTTP 401: Invalid authentication token')
  })
})
