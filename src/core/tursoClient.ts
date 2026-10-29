export interface TursoConfig {
  url: string
  authToken: string
}

export class TursoClient {
  private pipelineUrl: string
  private token: string

  constructor(config: TursoConfig) {
    let base = (config.url || '').trim()
    if (base.startsWith('libsql://')) {
      base = 'https://' + base.slice('libsql://'.length)
    }
    if (!base.startsWith('https://') && !base.startsWith('http://')) {
      base = 'https://' + base
    }
    this.pipelineUrl = base.replace(/\/+$/, '') + '/v2/pipeline'
    this.token = (config.authToken || '').trim()
  }

  async execute(sql: string, args: any[] = []): Promise<any> {
    const formattedArgs = args.map((a) => {
      if (a === null || a === undefined) return { type: 'null' }
      if (typeof a === 'number') return { type: Number.isInteger(a) ? 'integer' : 'float', value: String(a) }
      if (typeof a === 'boolean') return { type: 'integer', value: a ? '1' : '0' }
      return { type: 'text', value: String(a) }
    })

    const payload = {
      requests: [
        { type: 'execute', stmt: { sql, args: formattedArgs } },
        { type: 'close' }
      ]
    }

    const res = await fetch(this.pipelineUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Turso HTTP ${res.status}: ${errText || res.statusText}`)
    }

    const json = await res.json()
    const r = json.results?.[0]
    if (!r) throw new Error('Turso returned empty result')
    if (r.type === 'error') throw new Error(r.error?.message || 'Turso query execution error')
    return r.response?.result
  }

  async query<T = any>(sql: string, args: any[] = []): Promise<T[]> {
    const result = await this.execute(sql, args)
    if (!result || !result.cols || !result.rows) return []
    const cols = result.cols.map((c: any) => c.name)
    return result.rows.map((row: any[]) => {
      const obj: any = {}
      for (let i = 0; i < cols.length; i++) {
        const valObj = row[i]
        if (!valObj || valObj.type === 'null') {
          obj[cols[i]] = null
        } else if (valObj.type === 'integer') {
          obj[cols[i]] = parseInt(valObj.value, 10)
        } else if (valObj.type === 'float') {
          obj[cols[i]] = parseFloat(valObj.value)
        } else {
          obj[cols[i]] = valObj.value
        }
      }
      return obj as T
    })
  }

  async batch(statements: Array<{ sql: string; args?: any[] }>): Promise<any[]> {
    if (!statements.length) return []
    const requests = statements.map((s) => ({
      type: 'execute',
      stmt: {
        sql: s.sql,
        args: (s.args || []).map((a) => {
          if (a === null || a === undefined) return { type: 'null' }
          if (typeof a === 'number') return { type: Number.isInteger(a) ? 'integer' : 'float', value: String(a) }
          if (typeof a === 'boolean') return { type: 'integer', value: a ? '1' : '0' }
          return { type: 'text', value: String(a) }
        })
      }
    }))
    requests.push({ type: 'close' } as any)

    const res = await fetch(this.pipelineUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Turso HTTP ${res.status}: ${errText || res.statusText}`)
    }

    const json = await res.json()
    const results = []
    for (const r of json.results || []) {
      if (r.type === 'close') break
      if (r.type === 'error') throw new Error(r.error?.message || 'Turso batch execution error')
      results.push(r.response?.result)
    }
    return results
  }
}
