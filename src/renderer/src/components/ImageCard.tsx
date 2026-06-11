import React, { useState } from 'react'
import { formatRelativeTime } from '../utils/time'

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
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleCopy = (): void => {
    onCopy(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = (): void => {
    setDeleting(true)
    setTimeout(() => onDelete(id), 200)
  }

  // Normalize Windows path to URL format: replace backslashes with forward slashes
  const imageSrc = `local-file:///${imagePath.replace(/\\/g, '/')}`

  return (
    <div className={`card card-image ${deleting ? 'card-deleting' : ''}`}>
      {isPinned && <div className="card-pin-badge">📌 已置顶</div>}
      <div className="card-image-wrap" onClick={() => onPreview(imagePath)} onDoubleClick={handleCopy} title="双击复制">
        <img className="card-thumbnail" src={imageSrc} alt="剪贴板图片" draggable={false} />
      </div>
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

export default ImageCard
