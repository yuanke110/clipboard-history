import { clipboard, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { insertOrUpdateRecord } from './database'

let lastText = ''
let lastImageHash = ''
let intervalHandle: ReturnType<typeof setInterval> | null = null
let onNewRecord: (() => void) | null = null

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

function checkClipboard(): void {
  try {
    const text = clipboard.readText()
    if (text && text !== lastText) {
      lastText = text
      lastImageHash = ''
      insertOrUpdateRecord(text, 'text')
      onNewRecord?.()
      return
    }

    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const buf = image.toPNG()
      const hash = simpleHash(buf)
      if (hash !== lastImageHash) {
        lastImageHash = hash
        lastText = ''
        const filename = `${Date.now()}.png`
        const filePath = join(getImagesDir(), filename)
        writeFileSync(filePath, buf)
        insertOrUpdateRecord(null, 'image', filePath)
        onNewRecord?.()
      }
    }
  } catch {
    // Clipboard read may fail intermittently
  }
}

export function startMonitoring(callback?: () => void): void {
  onNewRecord = callback ?? null
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

/** Notify the monitor to skip a text we just wrote ourselves */
export function setLastText(text: string): void {
  lastText = text
}

/** Notify the monitor to skip an image we just wrote ourselves */
export function setLastImageHash(hash: string): void {
  lastImageHash = hash
}
