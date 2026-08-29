import { useEffect, useRef, useState } from 'react'
import type { LogEntry, ShellState } from '@shared/ipc'
import { ChromeBar } from './components/ChromeBar'
import { Landing } from './components/Landing'
import { LogPanel } from './components/LogPanel'

export default function App(): JSX.Element {
  const [state, setState] = useState<ShellState | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    void window.dshShell.getState().then((s) => {
      if (disposed) return
      setState(s)
      setLogs(s.logs)
    })
    const offState = window.dshShell.onStateChanged((s) => {
      if (!disposed) setState(s)
    })
    const offLog = window.dshShell.onLog((entry) => {
      if (!disposed) setLogs((prev) => [...prev.slice(-299), entry])
    })
    return () => {
      disposed = true
      offState()
      offLog()
    }
  }, [])

  // Keep the native content view aligned below the chrome bar.
  useEffect(() => {
    if (state?.phase !== 'connected') {
      void window.dshShell.setChromeHeight(0)
      return
    }
    const el = barRef.current
    if (!el) return
    const report = (): void => void window.dshShell.setChromeHeight(Math.ceil(el.getBoundingClientRect().height))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state?.phase])

  if (!state) {
    return (
      <div className="screen boot">
        <div className="spinner" />
        <p>正在启动 DSH Desktop…</p>
      </div>
    )
  }

  if (state.phase === 'connected') {
    return (
      <div className="app">
        <div className="chrome" ref={barRef}>
          <ChromeBar state={state} />
        </div>
      </div>
    )
  }

  if (state.phase === 'probing') {
    return (
      <div className="screen">
        <div className="hero">
          <div className="logo">DSH</div>
          <h1>DSH Desktop</h1>
          <p className="muted">{busyText(state)}</p>
        </div>
        <div className="probe-log">
          <LogPanel logs={logs} />
        </div>
      </div>
    )
  }

  return <Landing state={state} logs={logs} />
}

function busyText(state: ShellState): string {
  if (state.busy === 'auto-starting') return '已安装 DSH 未运行，正在自动启动本机实例…'
  if (state.busy === 'starting') return '正在启动本机 DSH…'
  if (state.busy === 'installing') return '正在安装 DSH…'
  if (state.busy === 'connecting') return '正在连接…'
  return '正在检测本机 DSH…'
}
