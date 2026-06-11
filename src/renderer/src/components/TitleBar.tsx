import React from 'react'

interface TitleBarProps {
  onSettingsClick?: () => void
  showSettings?: boolean
}

function TitleBar({ onSettingsClick, showSettings }: TitleBarProps): React.ReactElement {
  return (
    <div className="titlebar">
      <span className="titlebar-title">历史粘贴板</span>
      <div className="titlebar-controls">
        <button
          className={`titlebar-btn ${showSettings ? 'active' : ''}`}
          onClick={onSettingsClick}
          title="设置"
        >
          ⚙
        </button>
        <button className="titlebar-btn" onClick={() => window.electronAPI.window.minimize()}>
          _
        </button>
        <button className="titlebar-btn close" onClick={() => window.electronAPI.window.close()}>
          ×
        </button>
      </div>
    </div>
  )
}

export default TitleBar
