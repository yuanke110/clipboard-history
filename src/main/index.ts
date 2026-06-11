import {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  nativeImage, ipcMain, clipboard, protocol, screen, dialog
} from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import {
  initDatabase, queryRecords, searchRecords, deleteRecord,
  togglePin, cleanExpired, deleteAllNonPinned, flushSave
} from './database'
import { startMonitoring, setLastText, setLastImageHash } from './clipboard'

// Register privileged scheme for local file protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Auto-hide state
type HideEdge = 'left' | 'right' | 'top' | 'bottom'
let isHidden = false
let hideEdge: HideEdge = 'right'
let mouseCheckTimer: ReturnType<typeof setInterval> | null = null
let hideTimeout: ReturnType<typeof setTimeout> | null = null
let showCooldown = false
let showCooldownTimer: ReturnType<typeof setTimeout> | null = null
let isAutoHiding = false
let savedPos = { x: 0, y: 0 }
const HANDLE_SIZE = 3
const HIDE_DELAY_MS = 1500
const MOUSE_POLL_MS = 200
const WINDOW_WIDTH = 280
const WINDOW_HEIGHT = 200

function getPrimaryDisplayBounds(): Electron.Rectangle {
  return screen.getPrimaryDisplay().bounds
}

function getNearestEdge(bounds: Electron.Rectangle): HideEdge {
  const display = getPrimaryDisplayBounds()
  const distLeft = Math.abs(bounds.x - display.x)
  const distRight = Math.abs(bounds.x + bounds.width - (display.x + display.width))
  const distTop = Math.abs(bounds.y - display.y)
  const distBottom = Math.abs(bounds.y + bounds.height - (display.y + display.height))

  const minDist = Math.min(distLeft, distRight, distTop, distBottom)
  if (minDist === distLeft) return 'left'
  if (minDist === distRight) return 'right'
  if (minDist === distTop) return 'top'
  return 'bottom'
}

function startMouseMonitoring(): void {
  stopMouseMonitoring()
  if (!mainWindow) return

  mouseCheckTimer = setInterval(() => {
    if (!mainWindow) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = mainWindow.getBounds()
    const display = getPrimaryDisplayBounds()

    if (isHidden) {
      if (isCursorNearEdge(cursor, hideEdge, display)) {
        showFromEdge()
      }
    } else {
      const inside =
        cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width &&
        cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height

      if (!inside && !hideTimeout && !showCooldown) {
        hideTimeout = setTimeout(() => {
          savedPos = { x: bounds.x, y: bounds.y }
          hideToEdge()
          hideTimeout = null
        }, HIDE_DELAY_MS)
      } else if (inside && hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }
    }
  }, MOUSE_POLL_MS)
}

function stopMouseMonitoring(): void {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
  if (showCooldownTimer) {
    clearTimeout(showCooldownTimer)
    showCooldownTimer = null
  }
  showCooldown = false
  if (mouseCheckTimer) {
    clearInterval(mouseCheckTimer)
    mouseCheckTimer = null
  }
}

function hideToEdge(): void {
  if (!mainWindow || isHidden) return
  const bounds = mainWindow.getBounds()
  const display = getPrimaryDisplayBounds()
  hideEdge = getNearestEdge(bounds)

  let x = bounds.x, y = bounds.y
  if (hideEdge === 'left') x = display.x - WINDOW_WIDTH + HANDLE_SIZE
  else if (hideEdge === 'right') x = display.x + display.width - HANDLE_SIZE
  else if (hideEdge === 'top') y = display.y - WINDOW_HEIGHT + HANDLE_SIZE
  else if (hideEdge === 'bottom') y = display.y + display.height - HANDLE_SIZE

  // Suppress move event from saving this edge position
  isAutoHiding = true
  mainWindow.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
  // Release flag after move event would have fired
  setTimeout(() => { isAutoHiding = false }, 500)
  isHidden = true
}

function showFromEdge(): void {
  if (!mainWindow || !isHidden) return
  mainWindow.setBounds({ x: savedPos.x, y: savedPos.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
  isHidden = false
  // Cooldown: prevent immediate re-hide while user moves cursor from edge to window
  showCooldown = true
  if (showCooldownTimer) clearTimeout(showCooldownTimer)
  showCooldownTimer = setTimeout(() => {
    showCooldown = false
  }, 1000)
}

function isCursorNearEdge(cursor: Electron.Point, edge: HideEdge, display: Electron.Rectangle): boolean {
  const threshold = 10
  if (edge === 'left') return Math.abs(cursor.x - display.x) <= threshold
  if (edge === 'right') return Math.abs(cursor.x - (display.x + display.width)) <= threshold
  if (edge === 'top') return Math.abs(cursor.y - display.y) <= threshold
  if (edge === 'bottom') return Math.abs(cursor.y - (display.y + display.height)) <= threshold
  return false
}

// Settings persistence
interface AppSettings {
  bgImagePath?: string
  bgColor?: string
  windowMode?: 'compact' | 'fullscreen'
  compactPosX?: number
  compactPosY?: number
}

function getSettingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    const p = getSettingsPath()
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {}
  } catch { return {} }
}

function saveSettings(settings: AppSettings): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2))
}

function createWindow(): void {
  const display = getPrimaryDisplayBounds()
  const saved = loadSettings()
  // Guard against off-screen position saved by old auto-hide bug
  let posX = saved.compactPosX ?? Math.round(display.width * 0.72 - WINDOW_WIDTH / 2)
  let posY = saved.compactPosY ?? 60
  const maxX = display.x + display.width - WINDOW_WIDTH - HANDLE_SIZE
  const minX = display.x - HANDLE_SIZE
  if (posX < minX || posX > maxX) posX = Math.round(display.width * 0.72 - WINDOW_WIDTH / 2)
  if (posY < display.y + HANDLE_SIZE || posY > display.y + display.height - WINDOW_HEIGHT - HANDLE_SIZE) {
    posY = 60
  }

  const savedMode = saved.windowMode

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: posX,
    y: posY,
    minWidth: 160,
    minHeight: 140,
    maxWidth: savedMode === 'fullscreen' ? undefined : WINDOW_WIDTH,
    maxHeight: savedMode === 'fullscreen' ? undefined : WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: savedMode === 'fullscreen',
    skipTaskbar: savedMode !== 'fullscreen',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (savedMode === 'fullscreen') {
    mainWindow.maximize()
  }

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

  mainWindow.on('show', () => {
    mainWindow?.webContents.send('window:show')
  })

  // Save window position on move (compact mode only, exclude auto-hide movements)
  let moveTimer: ReturnType<typeof setTimeout> | null = null
  mainWindow.on('move', () => {
    if (isAutoHiding) return
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (!mainWindow) return
      const mode = loadSettings().windowMode
      if (mode !== 'fullscreen') {
        const bounds = mainWindow.getBounds()
        const s = loadSettings()
        s.compactPosX = bounds.x
        s.compactPosY = bounds.y
        saveSettings(s)
      }
    }, 300)
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
    if (isHidden) {
      showFromEdge()
      mainWindow?.focus()
    } else if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

function registerShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+Z', () => {
    if (isHidden) {
      showFromEdge()
      mainWindow?.show()
      mainWindow?.focus()
    } else if (mainWindow?.isVisible()) {
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
    setLastText(text)
  })

  ipcMain.handle('clipboard:copyImage', async (_event, imagePath: string) => {
    try {
      const data = await readFile(imagePath)
      const img = nativeImage.createFromBuffer(data)
      clipboard.writeImage(img)
      // Prevent re-detection: hash the image we just wrote and notify monitor
      const written = clipboard.readImage()
      if (!written.isEmpty()) {
        const buf = written.toPNG()
        let hash = 0
        for (let i = 0; i < Math.min(buf.length, 1024); i++) {
          hash = ((hash << 5) - hash) + buf[i]
          hash |= 0
        }
        setLastImageHash(hash.toString(36))
      }
    } catch (err) {
      console.error('Failed to copy image:', err)
    }
  })

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

  ipcMain.handle('db:deleteAll', () => {
    return deleteAllNonPinned()
  })

  ipcMain.handle('app:setAutoLaunch', (_event, enable: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enable,
      path: process.execPath
    })
  })

  ipcMain.handle('app:getAutoLaunch', () => {
    return app.getLoginItemSettings().openAtLogin
  })

  // Settings storage
  ipcMain.handle('settings:get', () => {
    return loadSettings()
  })

  ipcMain.handle('settings:set', (_event, settings: AppSettings) => {
    saveSettings(settings)
  })

  // Window mode toggle
  ipcMain.handle('window:setMode', (_event, mode: 'compact' | 'fullscreen') => {
    if (!mainWindow) return
    if (mode === 'compact') {
      mainWindow.setFullScreen(false)
      mainWindow.unmaximize()
      mainWindow.setResizable(false)
      mainWindow.setSkipTaskbar(true)
      mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
      const s = loadSettings()
      const display = getPrimaryDisplayBounds()
      const x = s.compactPosX ?? Math.round(display.width * 0.72 - WINDOW_WIDTH / 2)
      const y = s.compactPosY ?? 60
      mainWindow.setPosition(x, y)
      startMouseMonitoring()
    } else {
      // Save current position before maximizing
      const bounds = mainWindow.getBounds()
      const s = loadSettings()
      s.compactPosX = bounds.x
      s.compactPosY = bounds.y
      saveSettings(s)
      stopMouseMonitoring()
      mainWindow.setFullScreen(false)
      mainWindow.setResizable(true)
      mainWindow.setSkipTaskbar(false)
      mainWindow.maximize()
    }
    const s = loadSettings()
    s.windowMode = mode
    saveSettings(s)
  })

  // File dialog for background image selection
  ipcMain.handle('dialog:selectImage', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择背景图片',
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Always on top
  ipcMain.handle('window:setAlwaysOnTop', (_event, enable: boolean) => {
    mainWindow?.setAlwaysOnTop(enable)
  })
}

function registerProtocol(): void {
  protocol.handle('local-file', async (request) => {
    try {
      let filePath = decodeURIComponent(request.url.slice('local-file://'.length))
      // Strip leading slash from triple-slash URLs (local-file:///C:/... → C:/...)
      if (filePath.startsWith('/')) filePath = filePath.slice(1)
      // Normalize Windows backslashes to forward slashes (Node.js handles forward slashes on Windows)
      filePath = filePath.replace(/\\/g, '/')
      const data = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase()
      const mime =
        ext === 'png' ? 'image/png' :
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
        ext === 'gif' ? 'image/gif' :
        ext === 'bmp' ? 'image/bmp' :
        'application/octet-stream'
      return new Response(data, { headers: { 'Content-Type': mime } })
    } catch (err) {
      console.error('local-file protocol error:', err)
      return new Response(null, { status: 404 })
    }
  })
}

app.whenReady().then(async () => {
  await initDatabase()
  cleanExpired()
  setInterval(() => cleanExpired(), 60 * 60 * 1000)

  registerProtocol()
  createWindow()
  // Auto-hide only in compact mode
  const initialMode = loadSettings().windowMode
  if (initialMode !== 'fullscreen') {
    setTimeout(() => startMouseMonitoring(), 3000)
  }
  createTray()
  registerShortcuts()
  setupIPC()
  startMonitoring(() => {
    if (mainWindow) {
      mainWindow.webContents.send('clipboard:new-record')
    }
  })
})

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
})

app.on('will-quit', () => {
  flushSave()
  globalShortcut.unregisterAll()
})
