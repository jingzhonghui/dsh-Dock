import { useEffect, useRef, useState } from 'react'
import type { ShellState, TabState } from '@shared/ipc'
import { ChromeBar } from './components/ChromeBar'
import { Landing } from './components/Landing'
import { NewTabPage } from './components/NewTabPage'

export default function App(): JSX.Element {
  const [state, setState] = useState<ShellState | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    void window.dshShell.getState().then((s) => {
      if (disposed) return
      setState(s)
    })
    const offState = window.dshShell.onStateChanged((s) => {
      if (!disposed) setState(s)
    })
    return () => {
      disposed = true
      offState()
    }
  }, [])

  // Keep the native content view aligned below the chrome bar.
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const report = (): void => void window.dshShell.setChromeHeight(Math.ceil(el.getBoundingClientRect().height))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state?.activeTabId])

  if (!state) {
    return (
      <div className="screen boot">
        <div className="spinner" />
        <p>正在启动 DSH Desktop…</p>
      </div>
    )
  }

  const active = state.tabs.find((t) => t.id === state.activeTabId)

  return (
    <div className="app">
      <div className="chrome" ref={barRef}>
        <ChromeBar state={state} active={active} />
      </div>
      <div className="content">{renderContent(state, active)}</div>
    </div>
  )
}

function renderContent(state: ShellState, active: TabState | undefined): JSX.Element | null {
  if (!active) return null
  switch (active.phase) {
    case 'connected':
      // The native WebContentsView is positioned below the chrome bar by main.
      return null
    case 'probing':
      return (
        <div className="screen">
          <div className="hero">
            <div className="logo">DSH</div>
            <h1>DSH Desktop</h1>
            <p className="muted">{busyText(state)}</p>
          </div>
        </div>
      )
    case 'landing':
      return <Landing state={state} activeTab={active} />
    default:
      // 'new' | 'connecting' | 'error'
      return <NewTabPage tab={active} />
  }
}

function busyText(state: ShellState): string {
  if (state.busy === 'auto-starting') return '已安装 DSH 未运行，正在自动启动本机实例…'
  if (state.busy === 'starting') return '正在启动本机 DSH…'
  if (state.busy === 'installing') return '正在安装 DSH…'
  return '正在检测本机 DSH…'
}
