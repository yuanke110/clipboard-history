import React, { useEffect } from 'react'

interface ImagePreviewProps {
  imagePath: string
  onClose: () => void
}

function ImagePreview({ imagePath, onClose }: ImagePreviewProps): React.ReactElement {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={(e) => e.stopPropagation()}>
        <img className="preview-image" src={`local-file:///${imagePath.replace(/\\/g, '/')}`} alt="预览" />
        <button className="preview-close" onClick={onClose}>×</button>
      </div>
    </div>
  )
}

export default ImagePreview
