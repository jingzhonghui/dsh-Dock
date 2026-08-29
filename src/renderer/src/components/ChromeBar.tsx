import { useEffect, useRef, useState } from 'react'
import type { ConnectionSource, Endpoint, ShellState } from '@shared/ipc'

const SOURCE_LABEL: Record<ConnectionSource, string> = {
  'local-external': '本机 · 运行中',
  'local-spawned': '本机 · 壳启动',
  manual: '远程 / 手动'
}

export function ChromeBar({ state }: { state: ShellState }): JSX.Element {
  const connection = state.connection
  const [menuOpen, setMenuOpen] = useState(false)
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [keepRunning, setKeepRunning] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    void window.dshShell.listEndpoints().then((s) => setEndpoints(s.endpoints))
    void window.dshShell.getSettings().then((s) => setKeepRunning(s.keepDshRunning))
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  if (!connection) return <div className="chrome-bar" />

  return (
    <div className="chrome-bar">
      <button className="icon-btn" title="后退" onClick={() => void window.dshShell.goBack()}>
        ←
      </button>
      <button className="icon-btn" title="前进" onClick={() => void window.dshShell.goForward()}>
        →
      </button>
      <button className="icon-btn" title="刷新" onClick={() => void window.dshShell.reload()}>
        ⟳
      </button>

      <span className={`badge badge-${connection.source}`}>{SOURCE_LABEL[connection.source]}</span>
      <input className="address" readOnly value={connection.url} title={connection.url} onFocus={(e) => e.target.select()} />

      <button className="icon-btn" title="开发者工具" onClick={() => void window.dshShell.toggleDevTools()}>
        ⚙
      </button>

      <div className="menu-wrap" ref={menuRef}>
        <button className="icon-btn" title="菜单" onClick={() => setMenuOpen((o) => !o)}>
          ⋯
        </button>
        {menuOpen && (
          <div className="menu">
            <div className="menu-title">切换连接</div>
            {endpoints.length === 0 && <div className="menu-empty">暂无保存的连接</div>}
            {endpoints.map((ep) => (
              <button
                key={ep.id}
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  void window.dshShell.connect(ep.url)
                }}
              >
                <span className="menu-item-label">{ep.label}</span>
                <span className="menu-item-url">{ep.url}</span>
              </button>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                setMenuOpen(false)
                void window.dshShell.openExternal(connection.url)
              }}
            >
              在系统浏览器中打开
            </button>
            {connection.source === 'local-spawned' && (
              <>
                <label className="menu-item menu-check">
                  <input
                    type="checkbox"
                    checked={keepRunning}
                    onChange={(e) => {
                      const next = e.target.checked
                      setKeepRunning(next)
                      void window.dshShell.setSettings({ keepDshRunning: next })
                    }}
                  />
                  <span>退出壳时保持 DSH 运行</span>
                </label>
                <button
                  className="menu-item danger"
                  onClick={() => {
                    setMenuOpen(false)
                    void window.dshShell.stopLocal()
                  }}
                >
                  停止本机 DSH
                </button>
              </>
            )}
            <button
              className="menu-item danger"
              onClick={() => {
                setMenuOpen(false)
                void window.dshShell.goHome()
              }}
            >
              断开连接
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
