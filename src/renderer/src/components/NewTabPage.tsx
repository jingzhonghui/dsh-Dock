import { useState } from 'react'
import type { TabState } from '@shared/ipc'

export function NewTabPage({ tab }: { tab: TabState }): JSX.Element {
  const [url, setUrl] = useState(tab.url ?? '')
  const busy = tab.phase === 'connecting'
  const isError = tab.phase === 'error'

  const doConnect = (): void => {
    const u = url.trim()
    if (!u || busy) return
    void window.dshShell.connectTab(tab.id, u)
  }

  return (
    <div className="screen">
      <div className="new-tab">
        <img className="logo" src="./icon.png" alt="DSHDock" />
        <h1>新标签页</h1>
        {isError ? (
          <p className="error-text">连接失败：{tab.error}</p>
        ) : (
          <p className="muted">输入 DeepSeek Harness 的地址以连接</p>
        )}
        <div className="row new-tab-row">
          <input
            className="text-input"
            placeholder="例如 http://127.0.0.1:3080 或 http://<host>:<port>"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doConnect()
            }}
            disabled={busy}
            autoFocus
          />
          <button className="primary" disabled={!url.trim() || busy} onClick={doConnect}>
            {busy ? '连接中…' : '连接'}
          </button>
        </div>
      </div>
    </div>
  )
}
