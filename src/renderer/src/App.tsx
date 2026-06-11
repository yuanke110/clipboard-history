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

const BG_COLORS = ['#fff0f0', '#ffffff', '#f0f4ff', '#f0fff4'] as const

function App(): React.ReactElement {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image'>('all')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [bgColor, setBgColor] = useState(BG_COLORS[0])
  const [bgImagePath, setBgImagePath] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [windowMode, setWindowMode] = useState<'compact' | 'fullscreen'>('compact')
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingRef = useRef(false)
  const recordsRef = useRef<HistoryRecord[]>([])
  const settingsLoadedRef = useRef(false)
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  recordsRef.current = records

  const PAGE_SIZE = 30

  const loadRecords = useCallback(async (reset = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const currentRecords = recordsRef.current
      const offset = reset ? 0 : currentRecords.length
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

  // Auto-refresh when window is shown or new clipboard record arrives
  useEffect(() => {
    const cleanups: (() => void)[] = []
    cleanups.push(window.electronAPI.events.onWindowShow(() => {
      loadRecords(true)
    }))
    cleanups.push(window.electronAPI.events.onNewRecord(() => {
      // Only auto-refresh if user is scrolled near the top, to avoid scroll jumps
      const el = contentRef.current
      if (el && el.scrollTop > 50) return
      loadRecords(true)
    }))
    return () => {
      cleanups.forEach(fn => fn())
    }
  }, [loadRecords])

  // Esc to clear search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && searchText) {
        setSearchText('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchText])

  // Load settings on mount
  useEffect(() => {
    async function init() {
      try {
        const saved = await window.electronAPI.settings.get()
        if (saved.bgColor) setBgColor(saved.bgColor as string)
        if (saved.bgImagePath) setBgImagePath(saved.bgImagePath as string)
        if (saved.windowMode) setWindowMode(saved.windowMode as 'compact' | 'fullscreen')
        if (saved.alwaysOnTop) {
          setAlwaysOnTop(true)
          window.electronAPI.window.setAlwaysOnTop(true)
        }
        const al = await window.electronAPI.app.getAutoLaunch()
        setAutoLaunch(al)
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
      settingsLoadedRef.current = true
    }
    init()
  }, [])

  // Save settings with debounce
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current)
    settingsTimerRef.current = setTimeout(() => {
      window.electronAPI.settings.set({ bgColor, bgImagePath, windowMode, alwaysOnTop }).catch(() => {})
    }, 500)
    return () => {
      if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current)
    }
  }, [bgColor, bgImagePath, windowMode, alwaysOnTop])

  useEffect(() => {
    loadRecords(true)
  }, [filterType, loadRecords])

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
  }, [searchText, loadRecords])

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

  const handleClearAll = async (): Promise<void> => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    setConfirmClear(false)
    try {
      const count = await window.electronAPI.db.deleteAll()
      setRecords((prev) => prev.filter((r) => r.is_pinned === 1))
      if (count > 0) {
        // Show brief feedback
        console.log(`Cleared ${count} records`)
      }
    } catch (err) {
      console.error('Clear all failed:', err)
    }
  }

  const handleToggleAlwaysOnTop = async (): Promise<void> => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    try {
      await window.electronAPI.window.setAlwaysOnTop(next)
    } catch (err) {
      console.error('AlwaysOnTop toggle failed:', err)
      setAlwaysOnTop(!next)
    }
  }

  const handleToggleAutoLaunch = async (): Promise<void> => {
    const next = !autoLaunch
    setAutoLaunch(next)
    try {
      await window.electronAPI.app.setAutoLaunch(next)
    } catch (err) {
      console.error('AutoLaunch toggle failed:', err)
      setAutoLaunch(!next)
    }
  }

  const handleSelectBgImage = async (): Promise<void> => {
    try {
      const path = await window.electronAPI.dialog.selectImage()
      if (path) {
        setBgImagePath(path)
        setBgColor('') // clear color when using image
      }
    } catch (err) {
      console.error('Select image failed:', err)
    }
  }

  const handleClearBgImage = (): void => {
    setBgImagePath(null)
    setBgColor(BG_COLORS[0])
  }

  const handleToggleWindowMode = async (): Promise<void> => {
    const next = windowMode === 'compact' ? 'fullscreen' : 'compact'
    setWindowMode(next)
    try {
      await window.electronAPI.window.setMode(next)
    } catch (err) {
      console.error('Window mode toggle failed:', err)
      setWindowMode(windowMode)
    }
  }

  // Compute background style
  const bgStyle: React.CSSProperties = {}
  if (bgImagePath) {
    bgStyle.backgroundImage = `url(local-file:///${bgImagePath.replace(/\\/g, '/')})`
    bgStyle.backgroundSize = 'cover'
    bgStyle.backgroundPosition = 'center'
  } else {
    bgStyle.backgroundColor = bgColor || BG_COLORS[0]
  }

  return (
    <div className="app" style={bgStyle}>
      <TitleBar onSettingsClick={() => setShowSettings(!showSettings)} showSettings={showSettings} />
      {showSettings && (
        <div className="settings-panel">
          {/* Background color swatches */}
          <div className="settings-row">
            <span className="settings-label">背景色：</span>
            {BG_COLORS.map((color) => (
              <button
                key={color}
                className={`color-swatch ${!bgImagePath && bgColor === color ? 'active' : ''}`}
                style={{
                  backgroundColor: color,
                  border: `2px solid ${!bgImagePath && bgColor === color ? '#ffb6c1' : '#f0e0e0'}`
                }}
                onClick={() => { setBgColor(color); setBgImagePath(null) }}
              />
            ))}
          </div>

          {/* Custom background image */}
          <div className="settings-row">
            <span className="settings-label">背景图：</span>
            <button className="settings-btn" onClick={handleSelectBgImage}>
              {bgImagePath ? '更换图片' : '选择图片'}
            </button>
            {bgImagePath && (
              <button className="settings-btn settings-btn-danger" onClick={handleClearBgImage}>
                清除
              </button>
            )}
          </div>

          {/* Auto launch toggle */}
          <div className="settings-row">
            <span className="settings-label">开机自启：</span>
            <button
              className={`settings-toggle ${autoLaunch ? 'on' : ''}`}
              onClick={handleToggleAutoLaunch}
            >
              <span className="settings-toggle-knob" />
            </button>
          </div>

          {/* Window mode toggle */}
          <div className="settings-row">
            <span className="settings-label">窗口模式：</span>
            <button className="settings-btn" onClick={handleToggleWindowMode}>
              {windowMode === 'compact' ? '切换到全屏' : '切换到紧凑'}
            </button>
          </div>

          {/* Always on top toggle */}
          <div className="settings-row">
            <span className="settings-label">窗口置顶：</span>
            <button
              className={`settings-toggle ${alwaysOnTop ? 'on' : ''}`}
              onClick={handleToggleAlwaysOnTop}
            >
              <span className="settings-toggle-knob" />
            </button>
          </div>

          {/* Clear all (except pinned) */}
          <div className="settings-row">
            <span className="settings-label">清空记录：</span>
            <button
              className={`settings-btn settings-btn-danger ${confirmClear ? 'settings-btn-confirm' : ''}`}
              onClick={handleClearAll}
            >
              {confirmClear ? '确认清空？' : '一键清空'}
            </button>
            <span className="settings-hint">保留置顶</span>
          </div>
        </div>
      )}
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
      <div className="content" ref={contentRef}>
        <CardList
          records={records}
          loading={loading}
          searchText={searchText}
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
