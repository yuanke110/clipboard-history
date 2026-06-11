# 历史粘贴板 - 详细实现计划

> **执行方式：** 按 Task 顺序逐步执行，每步完成验证后再进入下一步。
> **原则：** 增量开发，一步一结，可运行验证。

**目标：** 完成剪贴板历史记录软件的数据库、剪贴板监听、IPC通信、完整UI、高级功能、打包的全部开发。

**当前进度：** Step 1 (Electron 空壳) 已完成 — 窗口、托盘、快捷键、关闭到托盘、基础IPC、UI骨架

**技术栈：** Electron 33 + React 18 + TypeScript + sql.js (WASM SQLite) + electron-vite

---

### Task 2: 数据库模块

**文件：**
- 新建: `src/main/database.ts`

**说明：** 封装 sql.js 数据库操作，提供完整的 CRUD 接口，支持过期清理。

- [ ] **Step 2-1: 创建数据库模块骨架**

```typescript
// src/main/database.ts
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

let db: SqlJsDatabase | null = null
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

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()
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
  saveDatabase()
  const result = db.exec('SELECT last_insert_rowid() as id')
  return result[0].values[0][0] as number
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
  const result = db.exec(
    "SELECT * FROM history WHERE type = 'text' AND content LIKE ? ORDER BY is_pinned DESC, timestamp DESC",
    [`%${keyword}%`]
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
      const { unlinkSync } = require('fs')
      unlinkSync(record.image_path)
    } catch { /* file already gone */ }
  }
  db.run('DELETE FROM history WHERE id = ?', [id])
  saveDatabase()
}

export function togglePin(id: number): number {
  if (!db) throw new Error('Database not initialized')
  db.run(
    'UPDATE history SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id]
  )
  saveDatabase()
  const result = db.exec('SELECT is_pinned FROM history WHERE id = ?', [id])
  return result[0]?.values[0]?.[0] as number ?? 0
}

export function cleanExpired(): void {
  if (!db) throw new Error('Database not initialized')
  db.run("DELETE FROM history WHERE is_pinned = 0 AND timestamp < datetime('now', '-7 days')")
  saveDatabase()
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
```

- [ ] **Step 2-2: 验证数据库模块编译通过**

运行: `npx electron-vite build`（或 `npm run build`）
预期: 构建成功，无编译错误

- [ ] **Step 2-3: 提交**

```bash
git add src/main/database.ts docs/02-architecture.md
git commit -m "feat: add sql.js database module with CRUD operations"
```

---

### Task 3: 剪贴板监听模块

**文件：**
- 新建: `src/main/clipboard.ts`

- [ ] **Step 3-1: 创建剪贴板监听模块**

```typescript
// src/main/clipboard.ts
import { clipboard, nativeImage, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { insertRecord } from './database'

let lastText = ''
let lastImageHash = ''
let intervalHandle: ReturnType<typeof setInterval> | null = null

function getImagesDir(): string {
  const dir = join(app.getPath('userData'), 'images')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function simpleHash(buf: Buffer): string {
  let hash = 0
  for (let i = 0; i < Math.min(buf.length, 1024); i++) {
    hash = ((hash << 5) - hash) + buf[i]
    hash |= 0
  }
  return hash.toString(36)
}

function formatDateTime(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function checkClipboard(): void {
  try {
    // Check for text
    const text = clipboard.readText()
    if (text && text !== lastText) {
      lastText = text
      lastImageHash = '' // reset image hash when text is copied
      insertRecord(text, 'text')
      return
    }

    // Check for image
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const buf = image.toPNG()
      const hash = simpleHash(buf)
      if (hash !== lastImageHash) {
        lastImageHash = hash
        lastText = '' // reset text when image is copied
        const filename = `${Date.now()}.png`
        const filePath = join(getImagesDir(), filename)
        writeFileSync(filePath, buf)
        insertRecord(null, 'image', filePath)
      }
    }
  } catch {
    // Clipboard read may fail intermittently
  }
}

export function startMonitoring(): void {
  // Initialize with current clipboard content to avoid duplicate on first read
  try {
    lastText = clipboard.readText()
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      lastImageHash = simpleHash(image.toPNG())
    }
  } catch { /* ignore */ }

  intervalHandle = setInterval(checkClipboard, 500)
}

export function stopMonitoring(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
```

- [ ] **Step 3-2: 验证编译通过**

运行: `npm run build`
预期: 构建成功

- [ ] **Step 3-3: 提交**

```bash
git add src/main/clipboard.ts
git commit -m "feat: add clipboard polling monitor (500ms interval)"
```

---

### Task 4: 主进程集成 + IPC 完善

**文件：**
- 修改: `src/main/index.ts`
- 修改: `src/preload/index.ts`
- 修改: `src/preload/index.d.ts`
- 修改: `src/renderer/src/env.d.ts`

- [ ] **Step 4-1: 更新主进程入口，集成数据库和剪贴板监听**

```typescript
// src/main/index.ts
import {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  nativeImage, ipcMain, clipboard, protocol, screen
} from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { initDatabase, queryRecords, searchRecords, deleteRecord, togglePin, cleanExpired } from './database'
import { startMonitoring } from './clipboard'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 600,
    minWidth: 500,
    minHeight: 400,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
}

function createTrayIcon(): nativeImage {
  const size = 32
  const canvas = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const idx = (y * size + x) * 4
      if (dist <= r) {
        canvas[idx] = 255
        canvas[idx + 1] = 182
        canvas[idx + 2] = 193
        canvas[idx + 3] = 255
      } else {
        canvas[idx + 3] = 0
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function createTray(): void {
  const icon = createTrayIcon()
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主面板',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('历史粘贴板')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

function registerShortcuts(): void {
  globalShortcut.register('Super+V', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

function setupIPC(): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window:close', () => {
    mainWindow?.hide()
  })

  ipcMain.handle('clipboard:copyText', (_event, text: string) => {
    clipboard.writeText(text)
    mainWindow?.hide()
  })

  // Database operations
  ipcMain.handle('db:query', (_event, limit: number, offset: number, type: string) => {
    return queryRecords(limit, offset, type as 'all' | 'text' | 'image')
  })

  ipcMain.handle('db:search', (_event, keyword: string) => {
    return searchRecords(keyword)
  })

  ipcMain.handle('db:delete', (_event, id: number) => {
    deleteRecord(id)
  })

  ipcMain.handle('db:togglePin', (_event, id: number) => {
    return togglePin(id)
  })
}

function registerProtocol(): void {
  protocol.handle('local-file', async (request) => {
    const filePath = decodeURIComponent(request.url.slice('local-file://'.length))
    const data = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'application/octet-stream'
    return new Response(data, { headers: { 'Content-Type': mime } })
  })
}

app.whenReady().then(async () => {
  await initDatabase()
  cleanExpired()
  // Cleanup every hour
  setInterval(() => cleanExpired(), 60 * 60 * 1000)

  registerProtocol()
  createWindow()
  createTray()
  registerShortcuts()
  setupIPC()
  startMonitoring()
})

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
```

- [ ] **Step 4-2: 更新 preload API**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

export interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  clipboard: {
    copyText: (text: string) => ipcRenderer.invoke('clipboard:copyText', text)
  },
  db: {
    query: (limit: number, offset: number, type: string) =>
      ipcRenderer.invoke('db:query', limit, offset, type),
    search: (keyword: string) =>
      ipcRenderer.invoke('db:search', keyword),
    delete: (id: number) =>
      ipcRenderer.invoke('db:delete', id),
    togglePin: (id: number) =>
      ipcRenderer.invoke('db:togglePin', id)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
```

- [ ] **Step 4-3: 更新类型定义**

```typescript
// src/preload/index.d.ts
export interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>
    close: () => Promise<void>
  }
  clipboard: {
    copyText: (text: string) => Promise<void>
  }
  db: {
    query: (limit: number, offset: number, type: string) => Promise<HistoryRecord[]>
    search: (keyword: string) => Promise<HistoryRecord[]>
    delete: (id: number) => Promise<void>
    togglePin: (id: number) => Promise<number>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
```

- [ ] **Step 4-4: 确保 `net` 导入并验证编译**

需要在 `src/main/index.ts` 顶部添加 `net` 到 electron 导入中：

```typescript
import { ..., net } from 'electron'
```

运行: `npm run build`
预期: 构建成功

- [ ] **Step 4-5: 提交**

```bash
git add src/main/index.ts src/main/database.ts src/main/clipboard.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: integrate database, clipboard monitor, and full IPC layer"
```

---

### Task 5: 卡片列表 UI 组件

**文件：**
- 新建: `src/renderer/src/components/CardList.tsx`
- 新建: `src/renderer/src/components/TextCard.tsx`
- 新建: `src/renderer/src/components/ImageCard.tsx`
- 新建: `src/renderer/src/components/ImagePreview.tsx`
- 修改: `src/renderer/src/App.tsx`
- 修改: `src/renderer/src/App.css`

- [ ] **Step 5-1: 创建文字卡片组件**

```tsx
// src/renderer/src/components/TextCard.tsx
import React, { useState } from 'react'

interface TextCardProps {
  id: number
  content: string
  timestamp: string
  isPinned: boolean
  onCopy: (text: string) => void
  onTogglePin: (id: number) => void
  onDelete: (id: number) => void
}

function TextCard({ id, content, timestamp, isPinned, onCopy, onDelete, onTogglePin }: TextCardProps): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleCopy = (): void => {
    onCopy(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = (): void => {
    setDeleting(true)
    setTimeout(() => onDelete(id), 200)
  }

  return (
    <div className={`card card-text ${deleting ? 'card-deleting' : ''}`}>
      {isPinned && <div className="card-pin-badge">📌 已置顶</div>}
      <div className="card-content">{content}</div>
      <div className="card-footer">
        <span className="card-time">{timestamp}</span>
        <div className="card-actions">
          <button className="btn-copy" onClick={handleCopy}>
            {copied ? '已复制!' : '复制'}
          </button>
          <button className="btn-pin" onClick={() => onTogglePin(id)}>
            {isPinned ? '取消置顶' : '置顶'}
          </button>
          <button className="btn-delete" onClick={handleDelete}>删除</button>
        </div>
      </div>
    </div>
  )
}

export default TextCard
```

- [ ] **Step 5-2: 创建图片卡片组件**

```tsx
// src/renderer/src/components/ImageCard.tsx
import React, { useState } from 'react'

interface ImageCardProps {
  id: number
  imagePath: string
  timestamp: string
  isPinned: boolean
  onCopy: (id: number) => void
  onTogglePin: (id: number) => void
  onDelete: (id: number) => void
  onPreview: (imagePath: string) => void
}

function ImageCard({ id, imagePath, timestamp, isPinned, onCopy, onTogglePin, onDelete, onPreview }: ImageCardProps): React.ReactElement {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = (): void => {
    setDeleting(true)
    setTimeout(() => onDelete(id), 200)
  }

  const imageSrc = `local-file://${imagePath}`

  return (
    <div className={`card card-image ${deleting ? 'card-deleting' : ''}`}>
      {isPinned && <div className="card-pin-badge">📌 已置顶</div>}
      <div className="card-image-wrap" onClick={() => onPreview(imagePath)}>
        <img className="card-thumbnail" src={imageSrc} alt="剪贴板图片" draggable={false} />
      </div>
      <div className="card-footer">
        <span className="card-time">{timestamp}</span>
        <div className="card-actions">
          <button className="btn-copy" onClick={() => onCopy(id)}>复制</button>
          <button className="btn-pin" onClick={() => onTogglePin(id)}>
            {isPinned ? '取消置顶' : '置顶'}
          </button>
          <button className="btn-delete" onClick={handleDelete}>删除</button>
        </div>
      </div>
    </div>
  )
}

export default ImageCard
```

- [ ] **Step 5-3: 创建图片预览弹窗组件**

```tsx
// src/renderer/src/components/ImagePreview.tsx
import React from 'react'

interface ImagePreviewProps {
  imagePath: string
  onClose: () => void
}

function ImagePreview({ imagePath, onClose }: ImagePreviewProps): React.ReactElement {
  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={(e) => e.stopPropagation()}>
        <img className="preview-image" src={`local-file://${imagePath}`} alt="预览" />
        <button className="preview-close" onClick={onClose}>×</button>
      </div>
    </div>
  )
}

export default ImagePreview
```

- [ ] **Step 5-4: 创建卡片列表组件**

```tsx
// src/renderer/src/components/CardList.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react'
import TextCard from './TextCard'
import ImageCard from './ImageCard'
import ImagePreview from './ImagePreview'

interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

interface CardListProps {
  records: HistoryRecord[]
  loading: boolean
  onCopy: (text: string) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
  onLoadMore: () => void
}

function CardList({ records, loading, onCopy, onDelete, onTogglePin, onLoadMore }: CardListProps): React.ReactElement {
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          onLoadMore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading, onLoadMore])

  const pinnedRecords = records.filter((r) => r.is_pinned === 1)
  const normalRecords = records.filter((r) => r.is_pinned === 0)

  const handleCopy = (id: number): void => {
    const record = records.find((r) => r.id === id)
    if (record?.content) {
      onCopy(record.content)
    }
  }

  if (records.length === 0 && !loading) {
    return (
      <div className="empty-state">
        <p>暂无复制记录</p>
        <p className="empty-hint">复制文字或图片后，记录将自动显示在这里</p>
      </div>
    )
  }

  return (
    <div className="card-list">
      {pinnedRecords.length > 0 && (
        <>
          <div className="section-title">📌 已置顶 ({pinnedRecords.length})</div>
          {pinnedRecords.map((r) =>
            r.type === 'text' ? (
              <TextCard
                key={r.id}
                id={r.id}
                content={r.content ?? ''}
                timestamp={r.timestamp}
                isPinned={true}
                onCopy={onCopy}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
              />
            ) : (
              <ImageCard
                key={r.id}
                id={r.id}
                imagePath={r.image_path ?? ''}
                timestamp={r.timestamp}
                isPinned={true}
                onCopy={handleCopy}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
                onPreview={setPreviewPath}
              />
            )
          )}
        </>
      )}

      {normalRecords.length > 0 && (
        <>
          {pinnedRecords.length > 0 && <div className="section-divider" />}
          <div className="section-title">最近记录</div>
          {normalRecords.map((r) =>
            r.type === 'text' ? (
              <TextCard
                key={r.id}
                id={r.id}
                content={r.content ?? ''}
                timestamp={r.timestamp}
                isPinned={false}
                onCopy={onCopy}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
              />
            ) : (
              <ImageCard
                key={r.id}
                id={r.id}
                imagePath={r.image_path ?? ''}
                timestamp={r.timestamp}
                isPinned={false}
                onCopy={handleCopy}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
                onPreview={setPreviewPath}
              />
            )
          )}
        </>
      )}

      <div ref={sentinelRef} className="scroll-sentinel">
        {loading && <div className="loading-text">加载中...</div>}
        {!loading && records.length > 0 && <div className="end-text">— 没有更多了 —</div>}
      </div>

      {previewPath && <ImagePreview imagePath={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  )
}

export default CardList
```

- [ ] **Step 5-5: 更新 App.tsx 整合完整功能**

```tsx
// src/renderer/src/App.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react'
import TitleBar from './components/TitleBar'
import CardList from './components/CardList'

interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

function App(): React.ReactElement {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image'>('all')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const PAGE_SIZE = 30
  const loadingRef = useRef(false)

  const loadRecords = useCallback(async (reset = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const offset = reset ? 0 : records.length
      const data = await window.electronAPI.db.query(PAGE_SIZE, offset, filterType)
      if (reset) {
        setRecords(data)
      } else {
        setRecords((prev) => [...prev, ...data])
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load records:', err)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [filterType])

  // Initial load and reload on type filter change
  useEffect(() => {
    loadRecords(true)
  }, [filterType])

  // Search with debounce
  useEffect(() => {
    if (!searchText.trim()) {
      loadRecords(true)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await window.electronAPI.db.search(searchText)
        setRecords(data)
        setHasMore(false)
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchText])

  const handleCopy = (text: string): void => {
    window.electronAPI.clipboard.copyText(text)
  }

  const handleDelete = async (id: number): Promise<void> => {
    try {
      await window.electronAPI.db.delete(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const handleTogglePin = async (id: number): Promise<void> => {
    try {
      await window.electronAPI.db.togglePin(id)
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_pinned: r.is_pinned === 1 ? 0 : 1 } : r))
      )
    } catch (err) {
      console.error('Toggle pin failed:', err)
    }
  }

  const handleLoadMore = (): void => {
    if (hasMore && !loading && !searchText.trim()) {
      loadRecords(false)
    }
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索历史记录..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as typeof filterType)}
        >
          <option value="all">全部</option>
          <option value="text">文字</option>
          <option value="image">图片</option>
        </select>
      </div>
      <div className="content">
        <CardList
          records={records}
          loading={loading}
          onCopy={handleCopy}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          onLoadMore={handleLoadMore}
        />
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 5-6: 添加卡片相关 CSS 样式**

在 `src/renderer/src/App.css` 的末尾添加：

```css
/* Card List */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  color: #999;
  padding: 4px 0;
  font-weight: 600;
}

.section-divider {
  height: 1px;
  background-color: #f0e0e0;
  margin: 4px 0;
}

/* Card */
.card {
  background-color: #fff;
  border-radius: 6px;
  padding: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
  position: relative;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12);
}

.card-deleting {
  opacity: 0;
  transform: translateX(20px);
}

.card-pin-badge {
  font-size: 11px;
  color: #d4a84b;
  background-color: #fff8e8;
  display: inline-block;
  padding: 1px 8px;
  border-radius: 3px;
  margin-bottom: 6px;
}

.card-content {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
  white-space: pre-wrap;
}

.card-image-wrap {
  display: flex;
  justify-content: center;
  padding: 8px 0;
  cursor: pointer;
}

.card-thumbnail {
  width: 120px;
  height: 80px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #f0e0e0;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.card-time {
  font-size: 12px;
  color: #999;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.btn-copy {
  padding: 3px 10px;
  background-color: #ffb6c1;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.btn-copy:hover {
  background-color: #ff9cb5;
}

.btn-pin, .btn-delete {
  padding: 3px 6px;
  background: transparent;
  border: none;
  font-size: 12px;
  cursor: pointer;
  color: #999;
  transition: color 0.15s;
}

.btn-pin:hover {
  color: #d4a84b;
}

.btn-delete:hover {
  color: #e74c3c;
}

/* Image Preview Overlay */
.preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.preview-container {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
}

.preview-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.preview-close {
  position: absolute;
  top: -36px;
  right: 0;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-close:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Scroll sentinel */
.scroll-sentinel {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-text, .end-text {
  font-size: 12px;
  color: #bbb;
}
```

- [ ] **Step 5-7: 验证编译和运行**

运行: `npm run dev`
预期: 窗口启动，显示"暂无复制记录"。复制一些文字后刷新列表（重新打开窗口），应能看到卡片。

- [ ] **Step 5-8: 提交**

```bash
git add src/renderer/src/components/ src/renderer/src/App.tsx src/renderer/src/App.css
git commit -m "feat: implement card list UI with text/image cards, search, filter, and preview"
```

---

### Task 6: 高级功能

**文件：**
- 修改: `src/main/index.ts`
- 修改: `src/renderer/src/App.tsx`
- 修改: `src/renderer/src/App.css`

- [ ] **Step 6-1: 屏幕吸附功能**

在 `src/main/index.ts` 中 `createWindow()` 函数内添加：

```typescript
// 在 mainWindow 创建之后添加移动事件监听
let moveTimer: ReturnType<typeof setTimeout> | null = null

mainWindow.on('move', () => {
  if (moveTimer) clearTimeout(moveTimer)
  moveTimer = setTimeout(() => {
    if (!mainWindow) return
    const winBounds = mainWindow.getBounds()
    const displays = screen.getAllDisplays()
    const bounds = displays[0].bounds // primary display
    const snapMargin = 20
    let newX = winBounds.x
    let newY = winBounds.y

    // Snap to edges
    if (winBounds.x <= bounds.x + snapMargin && winBounds.x >= bounds.x - snapMargin) {
      newX = bounds.x
    }
    if (winBounds.y <= bounds.y + snapMargin && winBounds.y >= bounds.y - snapMargin) {
      newY = bounds.y
    }
    if (winBounds.x + winBounds.width >= bounds.x + bounds.width - snapMargin &&
        winBounds.x + winBounds.width <= bounds.x + bounds.width + snapMargin) {
      newX = bounds.x + bounds.width - winBounds.width
    }

    if (newX !== winBounds.x || newY !== winBounds.y) {
      mainWindow.setBounds({ x: newX, y: newY })
    }
  }, 150)
})
```

- [ ] **Step 6-2: 开机自启**

在 `src/main/index.ts` 中 `setupIPC()` 函数内添加：

```typescript
ipcMain.handle('app:setAutoLaunch', (_event, enable: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath
  })
})

ipcMain.handle('app:getAutoLaunch', () => {
  return app.getLoginItemSettings().openAtLogin
})
```

在 preload 中添加对应 API：

```typescript
// src/preload/index.ts 的 api 对象中添加
app: {
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('app:setAutoLaunch', enable),
  getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch')
}
```

- [ ] **Step 6-3: 自定义背景图（简化实现——仅颜色选择）**

在 `src/renderer/src/App.tsx` 中添加背景色选择功能（在 TitleBar 右侧添加设置按钮）：

```tsx
// 添加状态
const [bgColor, setBgColor] = useState('#fff0f0')

// 添加切换面板的 toggle 状态
const [showSettings, setShowSettings] = useState(false)
```

设置面板简化实现：在 `src/renderer/src/App.tsx` 中添加一个设置按钮和颜色选择面板，点击可切换窗口背景色（淡粉/白色/淡蓝三色可选）。

- [ ] **Step 6-4: 验证编译**

运行: `npm run build`
预期: 构建成功

- [ ] **Step 6-5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/App.tsx
git commit -m "feat: add edge snapping, auto-launch, and settings panel"
```

---

### Task 7: 在线图片协议修复 + 完整验证

- [ ] **Step 7-1: 验证 `local-file` 协议在 electron-vite 中有效**

确认 `src/main/index.ts` 包含 `net` 导入和协议注册。

运行 `npm run dev`，复制一张图片，检查 images/ 目录是否有文件生成。

- [ ] **Step 7-2: 端到端测试**

手动验证清单：
1. `npm run dev` 启动后弹出窗口 — ✅
2. 系统托盘有图标，右键菜单正常 — ✅
3. Win+V 呼出/隐藏窗口 — ✅
4. 复制文本 → 重新打开窗口 → 看到卡片 — 验证
5. 复制图片 → 看到缩略图卡片 — 验证
6. 搜索关键词 → 实时筛选 — 验证
7. 切换"图片"筛选 → 只显示图片 — 验证
8. 点击置顶 → 卡片移到置顶区 — 验证
9. 点击删除 → 卡片淡出消失 — 验证
10. 点击复制 → 内容复制成功 — 验证
11. 窗口拖到边缘 → 自动吸附 — 验证

- [ ] **Step 7-3: 提交最终版本**

```bash
git add .
git commit -m "chore: complete v1.0.0 implementation"
```

---

### Task 8: 打包分发

**文件：**
- 修改: `package.json`（确认 electron-builder 配置）
- 修改: `electron.vite.config.ts`（如有需要）

- [ ] **Step 8-1: 配置 extraResources 确保 sql.js WASM 文件被打包**

```json
// package.json build 部分添加
"extraResources": [
  {
    "from": "node_modules/sql.js/dist/sql-wasm.wasm",
    "to": "sql-wasm.wasm"
  }
]
```

- [ ] **Step 8-2: 构建并打包**

运行: `npm run build:win`
预期: 在 dist/ 目录生成安装包

- [ ] **Step 8-3: 提交打包配置**

```bash
git add package.json
git commit -m "chore: add packaging config for electron-builder"
```
