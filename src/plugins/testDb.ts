// Tests only: a settings table with the better-sqlite3 calls the plugins use.
export function fakeDb(): any {
  const rows = new Map<string, string>()
  return {
    rows,
    prepare(sql: string) {
      return {
        get: (key: string) => (/SELECT value FROM settings/.test(sql) && rows.has(key) ? { value: rows.get(key) } : undefined),
        run: (key: string, value: string) => void rows.set(key, value)
      }
    }
  }
}

