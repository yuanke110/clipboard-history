import React, { useState, useEffect, useRef } from 'react'
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
  searchText?: string
  onCopy: (text: string) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
  onLoadMore: () => void
}

function CardList({ records, loading, searchText, onCopy, onDelete, onTogglePin, onLoadMore }: CardListProps): React.ReactElement {
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
    if (!record) return
    if (record.type === 'text' && record.content) {
      onCopy(record.content)
    } else if (record.type === 'image' && record.image_path) {
      window.electronAPI.clipboard.copyImage(record.image_path).catch(console.error)
    }
  }

  if (records.length === 0 && !loading) {
    const isSearching = !!(searchText && searchText.trim())
    return (
      <div className="empty-state">
        <p>{isSearching ? '未找到匹配记录' : '暂无复制记录'}</p>
        <p className="empty-hint">
          {isSearching ? '尝试其他关键词搜索' : '复制文字或图片后，记录将自动显示在这里'}
        </p>
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
                searchText={searchText}
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
                searchText={searchText}
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
