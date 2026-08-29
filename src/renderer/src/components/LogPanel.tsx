import { useEffect, useRef } from 'react'
import type { LogEntry } from '@shared/ipc'

export function LogPanel({ logs }: { logs: LogEntry[] }): JSX.Element {
  const boxRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  return (
    <details className="log-panel">
      <summary>运行日志{logs.length > 0 ? `（${logs.length}）` : ''}</summary>
      <pre ref={boxRef} className="log-box">
        {logs.length === 0 ? '（暂无日志）' : logs.map((l) => formatLine(l)).join('')}
      </pre>
    </details>
  )
}

function formatLine(l: LogEntry): string {
  const time = new Date(l.ts).toLocaleTimeString()
  const tag = l.source === 'npm' ? 'npm' : l.source === 'dsh' ? 'dsh' : 'shell'
  return `[${time}] [${tag}] ${l.text}\n`
}
