import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'

let db: SqlJsDatabase | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const DB_FILENAME = 'clipboard-history.db'

export interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

function getWasmPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'sql-wasm.wasm')
  }
  return join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: () => getWasmPath()
  })
  const dbPath = join(app.getPath('userData'), DB_FILENAME)

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      type TEXT NOT NULL DEFAULT 'text',
      image_path TEXT,
      summary TEXT,
      timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
      is_pinned INTEGER DEFAULT 0
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp)')
  db.run('CREATE INDEX IF NOT EXISTS idx_history_type ON history(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_history_is_pinned ON history(is_pinned)')

  saveDatabase()
}

function saveDatabase(): void {
  if (!db) return
  const data = db.export()
  const dbPath = join(app.getPath('userData'), DB_FILENAME)
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(dbPath, Buffer.from(data))
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveDatabase()
    saveTimer = null
  }, 500)
}

export function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveDatabase()
  }
}

export function insertRecord(
  content: string | null,
  type: 'text' | 'image',
  imagePath: string | null = null
): number {
  if (!db) throw new Error('Database not initialized')
  const summary = type === 'text' && content ? content.substring(0, 100) : null
  db.run(
    'INSERT INTO history (content, type, image_path, summary) VALUES (?, ?, ?, ?)',
    [content, type, imagePath, summary]
  )
  scheduleSave()
  const result = db.exec('SELECT last_insert_rowid() as id')
  return result[0].values[0][0] as number
}

export function insertOrUpdateRecord(
  content: string | null,
  type: 'text' | 'image',
  imagePath: string | null = null
): { id: number; isUpdate: boolean } {
  if (!db) throw new Error('Database not initialized')

  // 检查是否已存在相同内容
  let existingId: number | null = null
  if (type === 'text' && content) {
    const result = db.exec('SELECT id FROM history WHERE type = ? AND content = ? LIMIT 1', ['text', content])
    if (result[0]?.values.length) {
      existingId = result[0].values[0][0] as number
    }
  } else if (type === 'image' && imagePath) {
    const result = db.exec('SELECT id FROM history WHERE type = ? AND image_path = ? LIMIT 1', ['image', imagePath])
    if (result[0]?.values.length) {
      existingId = result[0].values[0][0] as number
    }
  }

  if (existingId !== null) {
    // 已存在，更新时间戳（移到顶部）
    db.run('UPDATE history SET timestamp = datetime(\'now\', \'localtime\') WHERE id = ?', [existingId])
    scheduleSave()
    return { id: existingId, isUpdate: true }
  } else {
    // 不存在，插入新记录
    const summary = type === 'text' && content ? content.substring(0, 100) : null
    db.run(
      'INSERT INTO history (content, type, image_path, summary) VALUES (?, ?, ?, ?)',
      [content, type, imagePath, summary]
    )
    scheduleSave()
    const result = db.exec('SELECT last_insert_rowid() as id')
    return { id: result[0].values[0][0] as number, isUpdate: false }
  }
}

export function queryRecords(
  limit: number = 50,
  offset: number = 0,
  type?: 'all' | 'text' | 'image'
): HistoryRecord[] {
  if (!db) throw new Error('Database not initialized')
  let sql = 'SELECT * FROM history'
  const params: unknown[] = []
  if (type && type !== 'all') {
    sql += ' WHERE type = ?'
    params.push(type)
  }
  sql += ' ORDER BY is_pinned DESC, timestamp DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)
  const result = db.exec(sql, params)
  return parseResults(result)
}

export function searchRecords(keyword: string): HistoryRecord[] {
  if (!db) throw new Error('Database not initialized')
  const pattern = `%${keyword}%`
  const result = db.exec(
    'SELECT * FROM history WHERE content LIKE ? OR summary LIKE ? ORDER BY is_pinned DESC, timestamp DESC',
    [pattern, pattern]
  )
  return parseResults(result)
}

export function getRecordById(id: number): HistoryRecord | null {
  if (!db) throw new Error('Database not initialized')
  const result = db.exec('SELECT * FROM history WHERE id = ?', [id])
  if (!result[0]?.values.length) return null
  return rowToRecord(result[0], result[0].values[0])
}

export function deleteRecord(id: number): void {
  if (!db) throw new Error('Database not initialized')
  const record = getRecordById(id)
  if (record?.type === 'image' && record.image_path && existsSync(record.image_path)) {
    try {
      unlinkSync(record.image_path)
    } catch { /* file already gone */ }
  }
  db.run('DELETE FROM history WHERE id = ?', [id])
  scheduleSave()
}

export function togglePin(id: number): number {
  if (!db) throw new Error('Database not initialized')
  db.run(
    'UPDATE history SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id]
  )
  scheduleSave()
  const result = db.exec('SELECT is_pinned FROM history WHERE id = ?', [id])
  return result[0]?.values[0]?.[0] as number ?? 0
}

export function deleteAllNonPinned(): number {
  if (!db) throw new Error('Database not initialized')
  // Clean up image files for non-pinned image records
  const images = db.exec("SELECT image_path FROM history WHERE is_pinned = 0 AND type = 'image' AND image_path IS NOT NULL")
  if (images[0]) {
    for (const row of images[0].values) {
      const path = row[0] as string
      if (path && existsSync(path)) {
        try { unlinkSync(path) } catch { /* file already gone */ }
      }
    }
  }
  const result = db.exec('SELECT COUNT(*) as cnt FROM history WHERE is_pinned = 0')
  const count = result[0].values[0][0] as number
  db.run('DELETE FROM history WHERE is_pinned = 0')
  flushSave()
  return count
}

export function cleanExpired(): void {
  if (!db) throw new Error('Database not initialized')
  // Clean up image files for expired records before deleting
  const images = db.exec(
    "SELECT image_path FROM history WHERE is_pinned = 0 AND type = 'image' AND image_path IS NOT NULL AND timestamp < datetime('now', '-7 days')"
  )
  if (images[0]) {
    for (const row of images[0].values) {
      const path = row[0] as string
      if (path && existsSync(path)) {
        try { unlinkSync(path) } catch { /* file already gone */ }
      }
    }
  }
  db.run("DELETE FROM history WHERE is_pinned = 0 AND timestamp < datetime('now', '-7 days')")
  flushSave()
}

function parseResults(result: unknown[]): HistoryRecord[] {
  if (!result[0]) return []
  const meta = result[0] as { columns: string[]; values: unknown[][] }
  return meta.values.map((row) => rowToRecord(meta, row))
}

function rowToRecord(meta: { columns: string[] }, row: unknown[]): HistoryRecord {
  const record: Record<string, unknown> = {}
  meta.columns.forEach((col, i) => {
    record[col] = row[i]
  })
  return record as HistoryRecord
}
