import React, { useState } from 'react'
import { formatRelativeTime } from '../utils/time'
import { highlightText } from '../utils/highlight'

interface TextCardProps {
  id: number
  content: string
  timestamp: string
  isPinned: boolean
  searchText?: string
  onCopy: (text: string) => void
  onTogglePin: (id: number) => void
  onDelete: (id: number) => void
}

function TextCard({ id, content, timestamp, isPinned, searchText, onCopy, onDelete, onTogglePin }: TextCardProps): React.ReactElement {
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
      <div
        className="card-content"
        dangerouslySetInnerHTML={{ __html: highlightText(content, searchText || '') }}
        onDoubleClick={handleCopy}
        title="双击复制"
      />
      <div className="card-footer">
        <span className="card-time">{formatRelativeTime(timestamp)}</span>
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
