import type { ConnectionSource, ShellState, TabState } from '@shared/ipc'

const SOURCE_LABEL: Record<ConnectionSource, string> = {
  'local-external': '本机 · 运行中',
  'local-spawned': '本机 · 由壳启动',
  manual: '远程/手动'
}

export function ChromeBar({ state, active }: { state: ShellState; active?: TabState }): JSX.Element {
  return (
    <div className="chrome-bar">
      <div className="tab-strip">
        {state.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === state.activeTabId}
            isBoot={tab.id === state.bootTabId}
          />
        ))}
        <button className="tab-add" title="新建标签页" onClick={() => void window.dshShell.createTab()}>
          +
        </button>
      </div>
      <div className="chrome-actions">
        <button
          className="icon-btn"
          title="开发者工具（活动标签页）"
          disabled={active?.phase !== 'connected'}
          onClick={() => void window.dshShell.toggleDevTools()}
        >
          ⚙
        </button>
      </div>
    </div>
  )
}

function TabItem({ tab, isActive, isBoot }: { tab: TabState; isActive: boolean; isBoot: boolean }): JSX.Element {
  const connected = tab.phase === 'connected'
  return (
    <div
      className={`tab${isActive ? ' active' : ''}`}
      title={tab.url ?? ''}
      onClick={() => void window.dshShell.switchTab(tab.id)}
    >
      <span className="tab-label">{tabLabel(tab)}</span>
      {connected && tab.source && (
        <span className={`tab-badge badge badge-${tab.source}`}>{SOURCE_LABEL[tab.source]}</span>
      )}
      {connected && (
        <button
          className="tab-refresh"
          title="刷新该页面"
          onClick={(e) => {
            e.stopPropagation()
            void window.dshShell.reloadTab(tab.id)
          }}
        >
          ⟳
        </button>
      )}
      {!isBoot && (
        <button
          className="tab-close"
          title="关闭标签页"
          onClick={(e) => {
            e.stopPropagation()
            void window.dshShell.closeTab(tab.id)
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function tabLabel(t: TabState): string {
  if (t.title) return t.title
  if (t.phase === 'connected' && t.url) return t.url.replace(/^https?:\/\//, '')
  if (t.phase === 'connecting') return '连接中…'
  if (t.phase === 'error') return '连接失败'
  if (t.phase === 'probing') return '正在检测…'
  if (t.kind === 'boot') return '本机 DSH'
  return '新标签页'
}
